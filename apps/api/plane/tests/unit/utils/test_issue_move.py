# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueRelation,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.issue_completion import IssueCompletionRequirementsError
from plane.utils.issue_move import move_issue_to_project
from plane.utils.permissions.super_admin import (
    grant_project_access_to_workspace_super_admins,
    grant_workspace_super_admin_access,
    revoke_workspace_super_admin_access,
)


def _project(workspace, lead, name, identifier):
    project = Project.objects.create(
        workspace=workspace,
        project_lead=lead,
        name=name,
        identifier=identifier,
    )
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
    )
    return project, state


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_move_issue_is_atomic_and_removes_inaccessible_assignees():
    actor = UserFactory(email="move-actor@plane.so", username="move-actor@plane.so")
    outsider = UserFactory(email="move-outsider@plane.so", username="move-outsider@plane.so")
    workspace = WorkspaceFactory(slug="atomic-move", owner=actor)
    WorkspaceMember.objects.create(workspace=workspace, member=actor, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)
    source, source_state = _project(workspace, actor, "Source", "SRC")
    target, target_state = _project(workspace, actor, "Target", "DST")
    ProjectMember.objects.create(workspace=workspace, project=source, member=actor, role=20)
    ProjectMember.objects.create(workspace=workspace, project=source, member=outsider, role=15)
    ProjectMember.objects.create(workspace=workspace, project=target, member=actor, role=20)

    issue = Issue.objects.create(project=source, state=source_state, name="Move safely")
    related = Issue.objects.create(project=source, state=source_state, name="Related")
    IssueAssignee.objects.create(project=source, issue=issue, assignee=actor)
    IssueAssignee.objects.create(project=source, issue=issue, assignee=outsider)
    activity = IssueActivity.objects.create(project=source, issue=issue, actor=actor, verb="updated")
    relation = IssueRelation.objects.create(
        project=source,
        issue=issue,
        related_issue=related,
        relation_type="relates_to",
    )

    move_issue_to_project(issue=issue, target_project=target, target_state=target_state, actor=actor)

    issue.refresh_from_db()
    activity.refresh_from_db()
    relation.refresh_from_db()
    assert issue.project_id == target.id
    assert issue.state_id == target_state.id
    assert activity.project_id == target.id
    assert relation.project_id == target.id
    assert list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)) == [actor.id]


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_move_to_completed_state_validates_effective_destination_assignees_before_mutation():
    actor = UserFactory(email="move-done@plane.so", username="move-done@plane.so")
    outsider = UserFactory(email="move-done-outsider@plane.so", username="move-done-outsider@plane.so")
    workspace = WorkspaceFactory(slug="move-done", owner=actor)
    WorkspaceMember.objects.create(workspace=workspace, member=actor, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)
    source, source_state = _project(workspace, actor, "Source completion", "SCMP")
    target, _ = _project(workspace, actor, "Target completion", "TCMP")
    target_done = State.objects.create(
        workspace=workspace,
        project=target,
        name="Done",
        group="completed",
        color="#46A758",
    )
    ProjectMember.objects.create(workspace=workspace, project=source, member=actor, role=20)
    ProjectMember.objects.create(workspace=workspace, project=source, member=outsider, role=15)
    ProjectMember.objects.create(workspace=workspace, project=target, member=actor, role=20)

    issue = Issue.objects.create(
        project=source,
        state=source_state,
        name="Cannot silently lose assignee",
        target_date=timezone.now(),
        priority="high",
    )
    IssueAssignee.objects.create(project=source, issue=issue, assignee=outsider)

    with pytest.raises(IssueCompletionRequirementsError) as exc_info:
        move_issue_to_project(issue=issue, target_project=target, target_state=target_done, actor=actor)

    issue.refresh_from_db()
    assert exc_info.value.missing_fields == ["assignee"]
    assert issue.project_id == source.id
    assert issue.state_id == source_state.id
    assert IssueAssignee.objects.filter(issue=issue, assignee=outsider).exists()


@pytest.mark.unit
@pytest.mark.django_db
def test_super_admin_grants_are_complete_and_revocation_preserves_explicit_membership():
    leader = UserFactory(email="leader-role@plane.so", username="leader-role@plane.so")
    workspace = WorkspaceFactory(slug="super-admin-access", owner=leader)
    WorkspaceMember.objects.create(workspace=workspace, member=leader, role=30)
    explicit_project, _ = _project(workspace, leader, "Explicit", "EXP")
    inactive_project, _ = _project(workspace, leader, "Inactive explicit", "INACTIVE")
    implicit_project, _ = _project(workspace, leader, "Implicit", "IMP")
    explicit = ProjectMember.objects.create(
        workspace=workspace,
        project=explicit_project,
        member=leader,
        role=20,
    )
    inactive_explicit = ProjectMember.objects.create(
        workspace=workspace,
        project=inactive_project,
        member=leader,
        role=15,
        is_active=False,
    )

    grant_workspace_super_admin_access(workspace, leader)

    implicit = ProjectMember.objects.get(project=implicit_project, member=leader)
    inactive_explicit.refresh_from_db()
    assert explicit.is_super_admin_access is False
    assert inactive_explicit.is_active is True
    assert inactive_explicit.is_super_admin_access is True
    assert implicit.is_super_admin_access is True

    new_project, _ = _project(workspace, leader, "New", "NEW")
    grant_project_access_to_workspace_super_admins(new_project)
    assert ProjectMember.objects.filter(
        project=new_project,
        member=leader,
        is_super_admin_access=True,
        is_active=True,
    ).exists()

    revoke_workspace_super_admin_access(workspace, leader)
    explicit.refresh_from_db()
    inactive_explicit.refresh_from_db()
    assert explicit.is_active is True
    assert inactive_explicit.is_active is False
    assert not ProjectMember.objects.filter(member=leader, is_super_admin_access=True, is_active=True).exists()

    grant_workspace_super_admin_access(workspace, leader)
    restored_implicit = ProjectMember.objects.get(project=implicit_project, member=leader)
    assert restored_implicit.id == implicit.id
    assert restored_implicit.is_active is True
    assert restored_implicit.deleted_at is None
    assert ProjectMember.objects.filter(project=implicit_project, member=leader).count() == 1
