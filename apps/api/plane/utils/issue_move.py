# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import connection, transaction
from django.db.models import Max

from plane.db.models import (
    CommentReaction,
    CycleIssue,
    Description,
    FileAsset,
    GithubIssueSync,
    IntakeIssue,
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueBlocker,
    IssueComment,
    IssueDescriptionVersion,
    IssueLabel,
    IssueLink,
    IssueMention,
    IssueReaction,
    IssueRelation,
    IssueSequence,
    IssueSubscriber,
    IssueVersion,
    IssueVote,
    ModuleIssue,
    ProjectMember,
)
from plane.db.models.issue import IssueAttachment
from plane.utils.uuid import convert_uuid_to_integer
from plane.utils.issue_completion import ensure_completion_requirements


class IssueMoveConflict(Exception):
    """The work item cannot be moved without breaking an external binding."""


@transaction.atomic
def move_issue_to_project(*, issue, target_project, target_state, actor):
    """Move one issue and every project-scoped child record atomically."""
    # IssueManager joins nullable state/project tables for visibility filters;
    # PostgreSQL cannot lock the nullable side of that outer join. Lock the
    # issue row through the soft-delete manager instead.
    issue = Issue.objects.select_for_update().get(pk=issue.pk)

    if GithubIssueSync.objects.filter(issue=issue).exists():
        raise IssueMoveConflict("Disconnect the GitHub integration before moving this work item")
    if IntakeIssue.objects.filter(issue=issue).exists():
        raise IssueMoveConflict("Remove the work item from Intake before moving it to another project")

    lock_key = convert_uuid_to_integer(target_project.id)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_key])

    last_sequence = IssueSequence.objects.filter(project=target_project).aggregate(largest=Max("sequence"))["largest"]
    next_sequence = last_sequence + 1 if last_sequence else 1
    target_member_ids = set(
        ProjectMember.objects.filter(
            workspace=target_project.workspace,
            project=target_project,
            is_active=True,
            role__gte=15,
        ).values_list("member_id", flat=True)
    )

    # Moving a work item can also change its state and remove assignees that do
    # not belong to the destination project. Validate the effective destination
    # data before mutating any project-scoped records.
    has_target_assignee = IssueAssignee.objects.filter(
        issue=issue,
        assignee_id__in=target_member_ids,
    ).exists()
    ensure_completion_requirements(
        current_state_group=issue.state.group if issue.state else None,
        target_state_group=target_state.group if target_state else None,
        has_assignee=has_target_assignee,
        target_date=issue.target_date,
        priority=issue.priority,
    )

    # Project-specific planning metadata cannot be carried across projects.
    CycleIssue.objects.filter(issue=issue).delete()
    ModuleIssue.objects.filter(issue=issue).delete()
    IssueLabel.objects.filter(issue=issue).delete()

    # Keep only people who may access the destination project.
    IssueAssignee.objects.filter(issue=issue).exclude(assignee_id__in=target_member_ids).delete()
    IssueSubscriber.objects.filter(issue=issue).exclude(subscriber_id__in=target_member_ids).delete()
    IssueMention.objects.filter(issue=issue).exclude(mention_id__in=target_member_ids).delete()

    common_update = {
        "project_id": target_project.id,
        "workspace_id": target_project.workspace_id,
    }
    IssueAssignee.objects.filter(issue=issue).update(**common_update, updated_by_id=actor.id)
    IssueSubscriber.objects.filter(issue=issue).update(**common_update, updated_by_id=actor.id)
    IssueMention.objects.filter(issue=issue).update(**common_update, updated_by_id=actor.id)

    # Preserve the complete issue history and content under the new project.
    issue_child_models = (
        IssueLink,
        IssueAttachment,
        IssueActivity,
        IssueComment,
        IssueReaction,
        IssueVote,
        IssueVersion,
        IssueDescriptionVersion,
    )
    for model in issue_child_models:
        model.objects.filter(issue=issue).update(**common_update)

    comment_ids = IssueComment.objects.filter(issue=issue).values_list("id", flat=True)
    description_ids = IssueComment.objects.filter(issue=issue).exclude(description_id__isnull=True).values_list(
        "description_id", flat=True
    )
    Description.objects.filter(id__in=description_ids).update(**common_update)
    CommentReaction.objects.filter(comment_id__in=comment_ids).update(**common_update)
    FileAsset.objects.filter(issue=issue).update(**common_update)
    FileAsset.objects.filter(comment_id__in=comment_ids).update(**common_update)

    # A relation belongs to its source issue. Moving the related target must not
    # rewrite the source project's ownership metadata.
    IssueRelation.objects.filter(issue=issue).update(**common_update)
    IssueBlocker.objects.filter(block=issue).update(**common_update)

    # A child cannot keep a parent that now belongs to another project.
    Issue.issue_objects.filter(parent=issue).update(parent=None)

    issue.project = target_project
    issue.workspace = target_project.workspace
    issue.state = target_state
    issue.sequence_id = next_sequence
    issue.parent = None
    issue.estimate_point = None
    issue.updated_by = actor
    issue.save(
        update_fields=[
            "project",
            "workspace",
            "state",
            "sequence_id",
            "parent",
            "estimate_point",
            "updated_by",
            "updated_at",
        ]
    )
    IssueSequence.objects.create(issue=issue, sequence=next_sequence, project=target_project)
    return issue
