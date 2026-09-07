# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest

from plane.api.serializers.issue import IssueSerializer as PublicIssueSerializer
from plane.app.serializers.issue import IssueCreateSerializer
from plane.db.models import Issue, Project, ProjectMember, State, WorkspaceMember
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
    return workspace, project, todo, done


@pytest.mark.unit
@pytest.mark.django_db
def test_app_serializer_allows_incomplete_transition_to_done():
    _, project, todo, done = _setup_project()
    issue = Issue.objects.create(project=project, state=todo, name="Incomplete work item")

    serializer = IssueCreateSerializer(
        issue,
        data={"state_id": str(done.id)},
        partial=True,
        context={"project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
    updated_issue = serializer.save()
    assert updated_issue.state_id == done.id
    assert updated_issue.target_date is None
    assert updated_issue.priority == "none"


@pytest.mark.unit
@pytest.mark.django_db
def test_public_api_serializer_allows_incomplete_transition_to_done():
    workspace, project, todo, done = _setup_project()
    issue = Issue.objects.create(project=project, state=todo, name="Public API work item")

    serializer = PublicIssueSerializer(
        issue,
        data={"state": str(done.id)},
        partial=True,
        context={"workspace_id": workspace.id, "project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
    updated_issue = serializer.save()
    assert updated_issue.state_id == done.id
