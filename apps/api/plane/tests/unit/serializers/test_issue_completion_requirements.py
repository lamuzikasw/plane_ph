# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.api.serializers.issue import IssueSerializer as PublicIssueSerializer
from plane.app.serializers.issue import IssueCreateSerializer
from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory


def _setup_project():
    user = UserFactory(email="completion@plane.so", username="completion@plane.so")
    workspace = WorkspaceFactory(slug="completion-requirements", owner=user)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(
        workspace=workspace,
        project_lead=user,
        name="Completion requirements",
        identifier="DONE",
    )
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20)
    todo = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
    )
    done = State.objects.create(
        workspace=workspace,
        project=project,
        name="Done",
        group="completed",
        color="#46A758",
    )
    return user, workspace, project, todo, done


@pytest.mark.unit
@pytest.mark.django_db
def test_app_serializer_rejects_incomplete_transition_to_done():
    _, _, project, todo, done = _setup_project()
    issue = Issue.objects.create(project=project, state=todo, name="Incomplete work item")

    serializer = IssueCreateSerializer(
        issue,
        data={"state_id": str(done.id)},
        partial=True,
        context={"project_id": project.id},
    )

    assert serializer.is_valid() is False
    assert str(serializer.errors["code"][0]) == "completion_requirements_missing"
    assert [str(field) for field in serializer.errors["missing_fields"]] == [
        "assignee",
        "target_date",
        "priority",
    ]


@pytest.mark.unit
@pytest.mark.django_db
def test_app_serializer_accepts_requirements_supplied_with_done_transition():
    user, _, project, todo, done = _setup_project()
    issue = Issue.objects.create(project=project, state=todo, name="Ready work item")

    serializer = IssueCreateSerializer(
        issue,
        data={
            "state_id": str(done.id),
            "assignee_ids": [str(user.id)],
            "target_date": (timezone.now() + timedelta(days=1)).isoformat(),
            "priority": "high",
        },
        partial=True,
        context={"project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
    updated_issue = serializer.save()
    assert updated_issue.state_id == done.id
    assert IssueAssignee.objects.filter(issue=issue, assignee=user).exists()


@pytest.mark.unit
@pytest.mark.django_db
def test_public_api_serializer_enforces_completion_requirements():
    _, workspace, project, todo, done = _setup_project()
    issue = Issue.objects.create(project=project, state=todo, name="Public API work item")

    serializer = PublicIssueSerializer(
        issue,
        data={"state": str(done.id)},
        partial=True,
        context={"workspace_id": workspace.id, "project_id": project.id},
    )

    assert serializer.is_valid() is False
    assert str(serializer.errors["code"][0]) == "completion_requirements_missing"


@pytest.mark.unit
@pytest.mark.django_db
def test_app_serializer_allows_og_to_complete_without_deadline_or_priority():
    user, workspace, project, todo, done = _setup_project()
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=30)
    issue = Issue.objects.create(project=project, state=todo, name="OG work item")
    IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=user)

    serializer = IssueCreateSerializer(
        issue,
        data={"state_id": str(done.id)},
        partial=True,
        context={
            "project_id": project.id,
            "workspace_id": workspace.id,
            "actor": user,
        },
    )

    assert serializer.is_valid(), serializer.errors
    updated_issue = serializer.save()
    assert updated_issue.state_id == done.id
    assert updated_issue.target_date is None
    assert updated_issue.priority == "none"


@pytest.mark.unit
@pytest.mark.django_db
def test_app_serializer_still_requires_assignee_when_og_completes_work_item():
    user, workspace, project, todo, done = _setup_project()
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=30)
    issue = Issue.objects.create(project=project, state=todo, name="Unassigned OG work item")

    serializer = IssueCreateSerializer(
        issue,
        data={"state_id": str(done.id)},
        partial=True,
        context={
            "project_id": project.id,
            "workspace_id": workspace.id,
            "actor": user,
        },
    )

    assert serializer.is_valid() is False
    assert [str(field) for field in serializer.errors["missing_fields"]] == ["assignee"]


@pytest.mark.unit
@pytest.mark.django_db
def test_public_api_serializer_applies_og_completion_exception():
    user, workspace, project, todo, done = _setup_project()
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=30)
    issue = Issue.objects.create(project=project, state=todo, name="Public OG work item")
    IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=user)

    serializer = PublicIssueSerializer(
        issue,
        data={"state": str(done.id)},
        partial=True,
        context={
            "workspace_id": workspace.id,
            "project_id": project.id,
            "actor": user,
        },
    )

    assert serializer.is_valid(), serializer.errors


@pytest.mark.unit
@pytest.mark.django_db
def test_legacy_completed_issue_can_still_be_edited_without_required_fields():
    _, _, project, _, done = _setup_project()
    issue = Issue.objects.create(project=project, state=done, name="Legacy completed work item")

    serializer = IssueCreateSerializer(
        issue,
        data={"state_id": str(done.id), "name": "Updated legacy work item"},
        partial=True,
        context={"project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
