# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Cycle, CycleIssue, Issue, Project, ProjectMember, State, WorkspaceMember
from plane.db.models.api import APIToken
from plane.tests.factories import UserFactory, WorkspaceFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def cycle_work():
    user = UserFactory(username="cycle-move-owner")
    workspace = WorkspaceFactory(owner=user)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(workspace=workspace, name="Cycle moves", identifier="MOVE")
    ProjectMember.objects.create(project=project, member=user, role=20)
    state = State.objects.create(project=project, name="Todo", group="unstarted", default=True)
    now = timezone.now()
    snapshot = {
        "total_issues": 2,
        "unstarted_issues": 2,
        "completed_issues": 0,
        "distribution": {"labels": [], "assignees": [], "completion_chart": {"remaining": [2, 2]}},
    }
    source = Cycle.objects.create(
        project=project,
        name="Completed sprint",
        owned_by=user,
        start_date=now - timedelta(days=8),
        end_date=now - timedelta(days=1),
        progress_snapshot=deepcopy(snapshot),
    )
    target = Cycle.objects.create(
        project=project,
        name="Current sprint",
        owned_by=user,
        start_date=now - timedelta(hours=1),
        end_date=now + timedelta(days=7),
    )
    issue = Issue.objects.create(project=project, state=state, name="Move this work")
    other_issue = Issue.objects.create(project=project, state=state, name="Keep this work in the old sprint")
    link = CycleIssue.objects.create(project=project, cycle=source, issue=issue)
    other_link = CycleIssue.objects.create(project=project, cycle=source, issue=other_issue)
    with patch("celery.app.task.Task.delay"):
        yield SimpleNamespace(
            user=user,
            workspace=workspace,
            project=project,
            source=source,
            target=target,
            issue=issue,
            link=link,
            other_link=other_link,
            snapshot=snapshot,
        )


@pytest.fixture(params=["app", "public"])
def endpoint(request, cycle_work):
    client = APIClient()
    if request.param == "app":
        client.force_authenticate(user=cycle_work.user)
        prefix, success_status = "/api", 201
    else:
        token = APIToken.objects.create(user=cycle_work.user, label="Cycle move regression", token=f"test-{uuid4()}")
        client.credentials(HTTP_X_API_KEY=token.token)
        prefix, success_status = "/api/v1", 200
    path = (
        f"{prefix}/workspaces/{cycle_work.workspace.slug}/projects/{cycle_work.project.id}"
        f"/cycles/{cycle_work.target.id}/cycle-issues/"
    )
    return client, path, success_status


def test_one_issue_moves_from_completed_cycle_without_changing_other_work_or_snapshot(cycle_work, endpoint):
    client, path, success_status = endpoint
    response = client.post(path, {"issues": [str(cycle_work.issue.id)]}, format="json")
    assert response.status_code == success_status, response.data
    cycle_work.link.refresh_from_db()
    cycle_work.other_link.refresh_from_db()
    cycle_work.source.refresh_from_db()
    cycle_work.target.refresh_from_db()
    assert cycle_work.link.cycle_id == cycle_work.target.id
    assert cycle_work.other_link.cycle_id == cycle_work.source.id
    assert CycleIssue.objects.filter(issue=cycle_work.issue).count() == 1
    assert cycle_work.source.progress_snapshot == cycle_work.snapshot
    assert cycle_work.target.progress_snapshot == {}
    assert cycle_work.source.end_date < timezone.now()


def test_completed_destination_rejects_move_without_changing_membership(cycle_work, endpoint):
    client, path, _ = endpoint
    cycle_work.target.end_date = timezone.now() - timedelta(minutes=1)
    cycle_work.target.save(update_fields=["end_date"])
    response = client.post(path, {"issues": [str(cycle_work.issue.id)]}, format="json")
    assert response.status_code == 400, response.data
    cycle_work.link.refresh_from_db()
    cycle_work.other_link.refresh_from_db()
    cycle_work.source.refresh_from_db()
    assert cycle_work.link.cycle_id == cycle_work.source.id
    assert cycle_work.other_link.cycle_id == cycle_work.source.id
    assert cycle_work.source.progress_snapshot == cycle_work.snapshot
    assert not CycleIssue.objects.filter(cycle=cycle_work.target).exists()


@pytest.mark.parametrize("foreign_workspace", [False, True], ids=["other-project", "other-workspace"])
def test_existing_foreign_cycle_membership_cannot_be_moved_into_current_project(
    cycle_work, endpoint, foreign_workspace
):
    client, path, success_status = endpoint
    workspace = WorkspaceFactory(owner=cycle_work.user) if foreign_workspace else cycle_work.workspace
    foreign_project = Project.objects.create(workspace=workspace, name="Private work", identifier="PRIVATE")
    foreign_state = State.objects.create(project=foreign_project, name="Todo", group="unstarted", default=True)
    foreign_cycle = Cycle.objects.create(project=foreign_project, name="Private sprint", owned_by=cycle_work.user)
    foreign_issue = Issue.objects.create(project=foreign_project, state=foreign_state, name="Private task")
    foreign_link = CycleIssue.objects.create(project=foreign_project, cycle=foreign_cycle, issue=foreign_issue)
    response = client.post(path, {"issues": [str(cycle_work.issue.id), str(foreign_issue.id)]}, format="json")
    assert response.status_code == success_status, response.data
    cycle_work.link.refresh_from_db()
    foreign_link.refresh_from_db()
    assert cycle_work.link.cycle_id == cycle_work.target.id
    assert foreign_link.cycle_id == foreign_cycle.id
    assert foreign_link.project_id == foreign_project.id
    assert foreign_link.workspace_id == workspace.id
    assert CycleIssue.objects.filter(issue=foreign_issue).count() == 1
    assert not CycleIssue.objects.filter(cycle=cycle_work.target, issue=foreign_issue).exists()
