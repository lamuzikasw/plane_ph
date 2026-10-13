# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import Cycle, CycleIssue, Issue, IssueAssignee, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.grouper import issue_group_values

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture(params=[False, True], ids=["native", "placements"])
def board(request):
    actor = UserFactory(username=str(uuid4()))
    teammate = UserFactory(username=str(uuid4()))
    workspace = WorkspaceFactory(owner=actor)
    project = Project.objects.create(
        workspace=workspace,
        name="Assignee grouping",
        identifier="GROUP",
        issue_placements_enabled=request.param,
    )
    for member in (actor, teammate):
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=20)
        ProjectMember.objects.create(project=project, member=member, role=20)
    state = State.objects.create(project=project, name="Backlog", group="backlog", default=True)
    cycle = Cycle.objects.create(project=project, name="Current sprint", owned_by=actor)
    unassigned = [Issue.objects.create(project=project, state=state, name=f"Unassigned {i}") for i in range(3)]
    # Removing the last assignee keeps a soft-deleted relation in the database.
    IssueAssignee.objects.create(project=project, issue=unassigned[0], assignee=actor)
    IssueAssignee.objects.filter(issue=unassigned[0]).delete()
    assigned = Issue.objects.create(project=project, state=state, name="Two assignees")
    IssueAssignee.objects.create(project=project, issue=assigned, assignee=actor)
    IssueAssignee.objects.filter(issue=assigned).delete()
    for member in (actor, teammate):
        IssueAssignee.objects.create(project=project, issue=assigned, assignee=member)
    for issue in [*unassigned, assigned]:
        CycleIssue.objects.create(project=project, cycle=cycle, issue=issue)
    client = APIClient()
    client.force_authenticate(actor)
    with patch("celery.app.task.Task.delay"):
        yield SimpleNamespace(
            client=client,
            workspace=workspace,
            project=project,
            cycle=cycle,
            state=state,
            members=(actor, teammate),
            assigned=assigned,
            unassigned=unassigned,
        )


@pytest.mark.parametrize("endpoint", ["project", "cycle"])
@pytest.mark.parametrize(
    "group_by,sub_group_by",
    [("assignees__id", None), ("assignees__id", "state_id"), ("state_id", "assignees__id")],
    ids=["assignees", "assignees-then-state", "state-then-assignees"],
)
def test_unassigned_issues_are_visible_and_paginated_in_none(board, endpoint, group_by, sub_group_by):
    path = f"/api/workspaces/{board.workspace.slug}/projects/{board.project.id}/"
    path += f"cycles/{board.cycle.id}/cycle-issues/" if endpoint == "cycle" else "issues/"
    params = {"group_by": group_by, "order_by": "-created_at", "per_page": 2}
    if sub_group_by:
        params["sub_group_by"] = sub_group_by

    def assignee_group(data, member_id):
        if group_by == "state_id":
            return data["results"][str(board.state.id)]["results"][member_id]
        group = data["results"][member_id]
        if sub_group_by:
            return group["results"][str(board.state.id)]
        return group

    response = board.client.get(path, params)
    assert response.status_code == 200, response.data
    none_group = assignee_group(response.data, "None")
    assert none_group["total_results"] == 3
    assert len(none_group["results"]) == 2
    assert all(issue["assignee_ids"] == [] for issue in none_group["results"])
    if group_by == "assignees__id":
        assert response.data["results"]["None"]["total_results"] == 3

    member_ids = {str(member.id) for member in board.members}
    for member_id in member_ids:
        assigned_group = assignee_group(response.data, member_id)
        assert assigned_group["total_results"] == 1
        assert [str(issue["id"]) for issue in assigned_group["results"]] == [str(board.assigned.id)]
        assert set(assigned_group["results"][0]["assignee_ids"]) == member_ids

    assert response.data["next_page_results"] is True
    next_response = board.client.get(path, {**params, "cursor": response.data["next_cursor"]})
    assert next_response.status_code == 200, next_response.data
    next_group = assignee_group(next_response.data, "None")
    assert next_group["total_results"] == 3
    assert len(next_group["results"]) == 1
    assert next_group["results"][0]["assignee_ids"] == []
    assert next_response.data["next_page_results"] is False
    rows = none_group["results"] + next_group["results"]
    assert {str(issue["id"]) for issue in rows} == {str(issue.id) for issue in board.unassigned}


@pytest.mark.parametrize("scope", ["project", "workspace"])
def test_assignee_group_keys_include_none_at_both_scopes(board, scope):
    groups = issue_group_values(
        field="assignees__id",
        slug=board.workspace.slug,
        project_id=board.project.id if scope == "project" else None,
    )
    assert {str(value) for value in groups} == {"None", *(str(member.id) for member in board.members)}
