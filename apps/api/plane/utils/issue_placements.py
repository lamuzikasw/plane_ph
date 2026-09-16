# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import connection, transaction
from django.db.models import Exists, F, Max, OuterRef, Q, Subquery, Value, UUIDField
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import (
    Issue,
    IssueActivity,
    IssuePlacement,
    IssueSequence,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
)
from plane.utils.uuid import convert_uuid_to_integer


def project_role(user, project):
    workspace_role = (
        WorkspaceMember.objects.filter(workspace_id=project.workspace_id, member=user, is_active=True)
        .values_list("role", flat=True)
        .first()
    )
    if workspace_role is None:
        return 0
    if workspace_role == 30:
        return 30
    role = (
        ProjectMember.objects.filter(project=project, member=user, is_active=True)
        .values_list("role", flat=True)
        .first()
    )
    return max(role or 0, 20 if role and workspace_role == 20 else 0)


def require_project_access(user, project, write=False, issue=None):
    role = project_role(user, project)
    if project.archived_at or project.deleted_at or role < (15 if write else 5):
        raise PermissionDenied("You do not have access to this project.")
    if role == 5 and not project.guest_view_all_features and issue and issue.created_by_id != user.id:
        raise PermissionDenied("You do not have access to this work item.")
    return role


def matching_state(project_id, state):
    states = State.objects.filter(project_id=project_id, group=state.group, is_triage=False)
    return (
        states.filter(name__iexact=state.name).order_by("sequence", "id").first()
        or states.order_by("sequence", "id").first()
    )


@transaction.atomic
def attach_issue(*, issue, project, actor):
    # The issue lock makes attach/detach and simultaneous duplicate requests serial.
    issue = Issue.objects.select_for_update(of=("self",)).select_related("project", "state").get(pk=issue.pk)
    require_project_access(actor, issue.project, write=True, issue=issue)
    require_project_access(actor, project, write=True)
    if issue.workspace_id != project.workspace_id:
        raise ValidationError("Projects must belong to the same workspace.")
    if not issue.project.issue_placements_enabled or not project.issue_placements_enabled:
        raise ValidationError("Shared work items are not enabled for these projects.")
    if issue.project_id == project.id:
        raise ValidationError("The work item already belongs to this project.")
    if issue.archived_at or issue.is_draft:
        raise ValidationError("Publish or restore the work item before adding it to a project.")
    state = matching_state(project.id, issue.state)
    if not state:
        raise ValidationError("The target project needs a status in the same category as this work item.")
    placement = IssuePlacement.objects.filter(issue=issue, project=project).first()
    if placement and placement.is_active:
        return placement
    if placement:
        placement.is_active = True
        placement.state = state
        placement.save(update_fields=["is_active", "state", "updated_at"])
    else:
        # Same advisory lock and number ledger used by Issue.save().
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [convert_uuid_to_integer(project.id)])
        sequence = (IssueSequence.objects.filter(project=project).aggregate(value=Max("sequence"))["value"] or 0) + 1
        IssueSequence.objects.create(project=project, issue=issue, sequence=sequence)
        placement = IssuePlacement.objects.create(issue=issue, project=project, sequence_id=sequence, state=state)
    IssueActivity.objects.create(
        issue=issue,
        project=issue.project,
        actor=actor,
        verb="created",
        field="project",
        new_value=f"{project.identifier}-{placement.sequence_id}",
        new_identifier=project.id,
        comment="added the work item to a project",
    )
    Issue.objects.filter(pk=issue.pk).update(updated_at=timezone.now())
    return placement


@transaction.atomic
def detach_issue(*, placement, actor):
    issue = Issue.objects.select_for_update(of=("self",)).select_related("project").get(pk=placement.issue_id)
    require_project_access(actor, placement.project, write=True, issue=issue)
    placement.refresh_from_db()
    if not placement.is_active:
        return
    IssuePlacement.objects.filter(pk=placement.pk).update(is_active=False, updated_at=timezone.now())
    IssueActivity.objects.create(
        issue=issue,
        project=issue.project,
        actor=actor,
        verb="deleted",
        field="project",
        old_value=f"{placement.project.identifier}-{placement.sequence_id}",
        old_identifier=placement.project_id,
        comment="removed the work item from a project",
    )
    Issue.objects.filter(pk=issue.pk).update(updated_at=timezone.now())


def sync_placement_states(issue):
    """Called in the same transaction as canonical status changes."""
    for placement in IssuePlacement.objects.filter(issue=issue, is_active=True).select_related("state"):
        if placement.state.group == issue.state.group:
            continue
        state = matching_state(placement.project_id, issue.state)
        if not state:
            raise ValidationError("A linked project has no status in this category.")
        IssuePlacement.objects.filter(pk=placement.pk).update(state=state, updated_at=timezone.now())


def placement_queryset(queryset, project_id):
    """Project lists include shared content, annotated with local presentation fields."""
    if not Project.objects.filter(pk=project_id, issue_placements_enabled=True).exists():
        return queryset.filter(project_id=project_id)
    placements = IssuePlacement.objects.filter(
        issue_id=OuterRef("pk"),
        project_id=project_id,
        is_active=True,
        project__archived_at__isnull=True,
        project__deleted_at__isnull=True,
    )
    return queryset.filter(Q(project_id=project_id) | Exists(placements)).annotate(
        placement_id=Coalesce(Subquery(placements.values("id")[:1]), F("id")),
        placement_sequence_id=Coalesce(Subquery(placements.values("sequence_id")[:1]), F("sequence_id")),
        placement_state_id=Coalesce(
            Subquery(placements.values("state_id")[:1]), F("state_id"), output_field=UUIDField()
        ),
        placement_sort_order=Coalesce(Subquery(placements.values("sort_order")[:1]), F("sort_order")),
        placement_project_id=Value(project_id, output_field=UUIDField()),
    )


def placement_filter_key(key):
    field, *lookups = key.split("__")
    local = PLACEMENT_FIELDS.get(field, field)
    return "__".join([local, *lookups])


PLACEMENT_FIELDS = {
    "id": "placement_id",
    "sequence_id": "placement_sequence_id",
    "state_id": "placement_state_id",
    "sort_order": "placement_sort_order",
    "project_id": "placement_project_id",
}


def project_issue_values(queryset, fields):
    from plane.utils.issue_comment_counts import with_comment_count

    queryset = with_comment_count(queryset)
    fields = list(dict.fromkeys([*fields, "comment_count"]))
    if "placement_id" not in queryset.query.annotations:
        return list(queryset.values(*fields))
    rows = list(queryset.values(*dict.fromkeys([*fields, *PLACEMENT_FIELDS, *PLACEMENT_FIELDS.values()])))
    for row in rows:
        row["canonical_issue_id"] = row["id"]
        row["canonical_project_id"] = row["project_id"]
        row["canonical_sequence_id"] = row["sequence_id"]
        for field, local in PLACEMENT_FIELDS.items():
            row[field] = row[local]
        if row["id"] != row["canonical_issue_id"]:
            row.update(cycle_id=None, module_ids=[], label_ids=[], estimate_point=None, parent_id=None)
        # Keep annotation keys used by the grouped paginator until it has grouped results.
    return rows


def present_placement(data, placement):
    allowed = {
        "id",
        "name",
        "description_html",
        "state_id",
        "sort_order",
        "completed_at",
        "estimate_point",
        "priority",
        "start_date",
        "target_date",
        "sequence_id",
        "project_id",
        "parent_id",
        "cycle_id",
        "module_ids",
        "label_ids",
        "assignee_ids",
        "sub_issues_count",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "attachment_count",
        "comment_count",
        "link_count",
        "is_draft",
        "archived_at",
        "is_subscribed",
        "issue_reactions",
        "issue_attachments",
        "issue_link",
        "state__group",
    }
    data = {key: value for key, value in data.items() if key in allowed}
    data.update(
        canonical_issue_id=str(placement.issue_id),
        canonical_project_id=str(placement.issue.project_id),
        canonical_sequence_id=placement.issue.sequence_id,
        id=str(placement.id),
        project_id=str(placement.project_id),
        sequence_id=placement.sequence_id,
        state_id=str(placement.state_id),
        sort_order=placement.sort_order,
    )
    # These belong to the original project's workflow, not the destination.
    data.update(cycle_id=None, module_ids=[], label_ids=[], estimate_point=None, parent_id=None, parent=None)
    return data


def project_issue_representation(data, issue):
    if not hasattr(issue, "placement_id"):
        return data
    data.update(
        canonical_issue_id=str(issue.id),
        canonical_project_id=str(issue.project_id),
        canonical_sequence_id=issue.sequence_id,
    )
    for field, local in PLACEMENT_FIELDS.items():
        value = getattr(issue, local)
        data[field] = str(value) if field in ("id", "project_id", "state_id") else value
    if str(issue.placement_id) != str(issue.id):
        for key in ("issue_relation", "issue_related", "project", "project_detail", "parent"):
            data.pop(key, None)
        data.update(cycle_id=None, module_ids=[], label_ids=[], estimate_point=None, parent_id=None)
    return data


def search_placements(*, user, slug, query, project_id=None):
    """Search only active placements in projects the requesting user can see."""
    import re

    entries = IssuePlacement.objects.filter(
        workspace__slug=slug,
        is_active=True,
        issue__deleted_at__isnull=True,
        issue__archived_at__isnull=True,
        issue__is_draft=False,
        issue__project__archived_at__isnull=True,
        issue__project__deleted_at__isnull=True,
        project__archived_at__isnull=True,
        project__deleted_at__isnull=True,
        project__project_projectmember__member=user,
        project__project_projectmember__is_active=True,
    ).filter(
        Q(project__project_projectmember__role__gte=15)
        | Q(project__guest_view_all_features=True)
        | Q(issue__created_by=user)
    )
    if not WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True).exists():
        return []
    if project_id:
        entries = entries.filter(project_id=project_id)
    if query:
        exact = re.fullmatch(r"(.+)-(\d+)", query.strip())
        if exact:
            entries = entries.filter(project__identifier__iexact=exact[1], sequence_id=int(exact[2]))
        else:
            entries = entries.filter(Q(issue__name__icontains=query) | Q(project__identifier__icontains=query))
    return [
        {
            "name": entry.issue.name,
            "id": entry.id,
            "canonical_issue_id": entry.issue_id,
            "sequence_id": entry.sequence_id,
            "project__identifier": entry.project.identifier,
            "project_id": entry.project_id,
            "workspace__slug": slug,
            "priority": entry.issue.priority,
            "state_id": entry.state_id,
            "type_id": None,
        }
        for entry in entries.select_related("issue", "project").distinct().order_by("-updated_at")[:100]
    ]
