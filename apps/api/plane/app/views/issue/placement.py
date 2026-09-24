# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, IssuePlacement, Project, State
from plane.utils.issue_placements import (
    attach_issue,
    detach_issue,
    matching_state,
    present_placement,
    project_role,
    require_project_access,
)


class PlacementInputSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()


def resolve_issue(slug, project_id, issue_id, user, write=False):
    project = get_object_or_404(Project, pk=project_id, workspace__slug=slug)
    require_project_access(user, project, write=write)
    placement = (
        IssuePlacement.objects.select_related("issue__project", "project", "state")
        .filter(
            pk=issue_id,
            project=project,
            is_active=True,
            issue__deleted_at__isnull=True,
            issue__project__deleted_at__isnull=True,
        )
        .first()
    )
    issue = placement.issue if placement else get_object_or_404(Issue, pk=issue_id, project=project)
    require_project_access(user, project, write=write, issue=issue)
    return issue, placement, project


class IssuePlacementsEndpoint(BaseAPIView):
    def get(self, request, slug, project_id, issue_id):
        issue, _, project = resolve_issue(slug, project_id, issue_id, request.user)
        if not project.issue_placements_enabled:
            return Response({"enabled": False, "can_manage": False, "placements": [], "available_projects": []})
        entries = []
        if project_role(request.user, issue.project) >= 5:
            entries.append(
                {
                    "id": str(issue.id),
                    "project_id": str(issue.project_id),
                    "project_name": issue.project.name,
                    "identifier": issue.project.identifier,
                    "sequence_id": issue.sequence_id,
                    "is_original": True,
                    "can_remove": False,
                }
            )
        for entry in IssuePlacement.objects.filter(issue=issue, is_active=True).select_related("project"):
            if project_role(request.user, entry.project) < 5 or entry.project.archived_at:
                continue
            entries.append(
                {
                    "id": str(entry.id),
                    "project_id": str(entry.project_id),
                    "project_name": entry.project.name,
                    "identifier": entry.project.identifier,
                    "sequence_id": entry.sequence_id,
                    "is_original": False,
                    "can_remove": project_role(request.user, entry.project) >= 15,
                }
            )
        targets = Project.objects.filter(
            workspace=project.workspace, issue_placements_enabled=True, archived_at__isnull=True
        )
        attached_ids = [entry["project_id"] for entry in entries]
        available = [
            {"id": str(target.id), "name": target.name, "identifier": target.identifier}
            for target in targets.order_by("name")
            if str(target.id) not in attached_ids and project_role(request.user, target) >= 15
        ]
        return Response(
            {
                "enabled": project.issue_placements_enabled,
                "placements": entries,
                "available_projects": available,
                "can_manage": project_role(request.user, issue.project) >= 15
                and project_role(request.user, project) >= 15,
            }
        )

    def post(self, request, slug, project_id, issue_id):
        issue, _, _ = resolve_issue(slug, project_id, issue_id, request.user, write=True)
        payload = PlacementInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        project = get_object_or_404(Project, pk=payload.validated_data["project_id"], workspace__slug=slug)
        placement = attach_issue(issue=issue, project=project, actor=request.user)
        return Response(
            {"id": str(placement.id), "project_id": str(project.id), "sequence_id": placement.sequence_id}, status=201
        )

    def delete(self, request, slug, project_id, issue_id, placement_id):
        issue, _, _ = resolve_issue(slug, project_id, issue_id, request.user, write=True)
        placement = get_object_or_404(IssuePlacement.objects.select_related("project"), pk=placement_id, issue=issue)
        detach_issue(placement=placement, actor=request.user)
        return Response(status=204)


class ExistingIssueInputSerializer(serializers.Serializer):
    issue_id = serializers.UUIDField()


class ProjectSharedIssuesEndpoint(BaseAPIView):
    def get(self, request, slug, project_id):
        project = get_object_or_404(Project, pk=project_id, workspace__slug=slug)
        role = require_project_access(request.user, project)
        if not project.issue_placements_enabled or role < 15:
            return Response({"enabled": False, "results": []})
        candidates = (
            Issue.issue_objects.filter(
                workspace=project.workspace,
                project__issue_placements_enabled=True,
            )
            .exclude(project=project)
            .exclude(placements__project=project, placements__is_active=True)
        )
        query = request.query_params.get("search", "").strip()[:255]
        if query:
            from plane.utils.issue_search import search_issues

            candidates = search_issues(query, candidates)
        # Sharing is a write action in the source project as well.
        from plane.db.models import ProjectMember

        allowed_projects = ProjectMember.objects.filter(member=request.user, is_active=True, role__gte=15).values(
            "project_id"
        )
        if role != 30:
            candidates = candidates.filter(project_id__in=allowed_projects)
        results = [
            {"id": str(issue.id), "name": issue.name, "identifier": f"{issue.project.identifier}-{issue.sequence_id}"}
            for issue in candidates.select_related("project").order_by("-updated_at")[:30]
        ]
        targets = Project.objects.filter(
            workspace=project.workspace, issue_placements_enabled=True, archived_at__isnull=True
        ).exclude(pk=project.pk)
        available = [str(target.id) for target in targets if project_role(request.user, target) >= 15]
        return Response({"enabled": True, "results": results, "available_project_ids": available})

    def post(self, request, slug, project_id):
        project = get_object_or_404(Project, pk=project_id, workspace__slug=slug)
        require_project_access(request.user, project, write=True)
        payload = ExistingIssueInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        issue = get_object_or_404(Issue, pk=payload.validated_data["issue_id"], workspace__slug=slug)
        entry = attach_issue(issue=issue, project=project, actor=request.user)
        return Response({"id": str(entry.id), "sequence_id": entry.sequence_id}, status=201)


class IssuePlacementContextMixin:
    """Resolve an explicitly shared issue before existing content endpoints run.

    Opt-in only: bulk, project settings, archive and delete endpoints never inherit
    this mixin. Permissions remain scoped to the destination project and one issue.
    """

    placement_context = None

    @property
    def project_id(self):
        if self.placement_context:
            return self.placement_context.project_id
        return super().project_id

    def initial(self, request, *args, **kwargs):
        self.perform_authentication(request)
        issue_key = next((key for key in ("issue_id", "work_item_id", "pk") if key in self.kwargs), "pk")
        issue_id = self.kwargs.get(issue_key)
        if request.user.is_authenticated and issue_id and self.kwargs.get("project_id"):
            entry = (
                IssuePlacement.objects.select_related("issue__project", "issue__state", "project", "state")
                .filter(
                    pk=issue_id,
                    project_id=self.kwargs["project_id"],
                    workspace__slug=self.kwargs.get("slug"),
                    is_active=True,
                    issue__deleted_at__isnull=True,
                    issue__project__deleted_at__isnull=True,
                    issue__project__archived_at__isnull=True,
                )
                .first()
            )
            if entry:
                require_project_access(
                    request.user,
                    entry.project,
                    write=request.method not in ("GET", "HEAD", "OPTIONS")
                    and getattr(self, "action", None) != "mark_read",
                    issue=entry.issue,
                )
                if issue_key == "pk" and request.method not in ("GET", "HEAD", "OPTIONS", "PATCH"):
                    raise PermissionDenied(
                        "Remove the placement using Projects. "
                        "Deleting the shared work item requires access to its original project."
                    )
                self.placement_context = entry
                self.kwargs[issue_key] = entry.issue_id
                self.kwargs["project_id"] = entry.issue.project_id
                if issue_key == "pk" and request.method == "PATCH":
                    # Board drag payloads echo the local identity alongside edits.
                    # Accept only the current placement/project, never a move or rename.
                    for field, expected in (("id", entry.id), ("project_id", entry.project_id)):
                        if field in request.data:
                            supplied = serializers.UUIDField().run_validation(request.data.pop(field))
                            if supplied != expected:
                                raise ValidationError({field: "The work item identity cannot be changed."})
                    allowed = {
                        "name",
                        "description_html",
                        "description_json",
                        "priority",
                        "start_date",
                        "target_date",
                        "state_id",
                        "sort_order",
                        "assignee_ids",
                        "skip_activity",
                    }
                    if set(request.data) - allowed:
                        raise ValidationError("Change project-specific properties in the original project.")
                    if "state_id" in request.data:
                        local_state = get_object_or_404(State, pk=request.data["state_id"], project=entry.project)
                        source_state = matching_state(entry.issue.project_id, local_state)
                        if not source_state:
                            raise ValidationError("The original project has no matching status category.")
                        request.data["state_id"] = str(source_state.id)
                        self.placement_state_id = local_state.id
                    if "sort_order" in request.data:
                        self.placement_sort_order = serializers.FloatField().run_validation(
                            request.data.pop("sort_order")
                        )
        super().initial(request, *args, **kwargs)

    def finalize_response(self, request, response, *args, **kwargs):
        entry = self.placement_context
        if entry and 200 <= response.status_code < 300:
            if hasattr(self, "placement_state_id"):
                IssuePlacement.objects.filter(pk=entry.pk).update(state_id=self.placement_state_id)
            if hasattr(self, "placement_sort_order"):
                IssuePlacement.objects.filter(pk=entry.pk).update(sort_order=self.placement_sort_order)
            if isinstance(getattr(response, "data", None), dict) and str(response.data.get("id")) == str(
                entry.issue_id
            ):
                entry.refresh_from_db()
                response.data = present_placement(response.data, entry)
        if isinstance(getattr(response, "data", None), dict):
            for field in ("grouped_by", "sub_grouped_by"):
                value = response.data.get(field)
                if isinstance(value, str) and value.startswith("placement_"):
                    response.data[field] = value.removeprefix("placement_")
        return super().finalize_response(request, response, *args, **kwargs)


def content_membership_filters(view):
    if getattr(view, "placement_context", None):
        return {"project__archived_at__isnull": True}
    return {
        "project__project_projectmember__member": view.request.user,
        "project__project_projectmember__is_active": True,
        "project__archived_at__isnull": True,
    }
