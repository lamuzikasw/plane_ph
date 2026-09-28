# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueAssignee, IssueLabel, Label, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def picker():
    actor = UserFactory(username=str(uuid4()))
    colleague = UserFactory(username=str(uuid4()))
    workspace = WorkspaceFactory(owner=actor)
    WorkspaceMember.objects.create(workspace=workspace, member=actor, role=20)
    projects = []
    for identifier in ("ONE", "TWO", "PRIVATE"):
        project = Project.objects.create(workspace=workspace, name=identifier, identifier=identifier)
        if identifier != "PRIVATE":
            ProjectMember.objects.create(project=project, member=actor, role=20)
        State.objects.create(project=project, name="Todo", group="unstarted", default=True)
        projects.append(project)
    client = APIClient()
    client.force_authenticate(actor)
    with patch("celery.app.task.Task.delay"):
        yield client, workspace, projects, actor, colleague


def search(picker, **params):
    client, workspace, projects, *_ = picker
    return client.get(f"/api/workspaces/{workspace.slug}/projects/{projects[0].id}/search-issues/", params)


def ids(response):
    assert response.status_code == 200, response.data
    return {str(row["id"]) for row in response.data}


def test_filters_apply_before_limit_and_pages_do_not_overlap(picker):
    _, _, (project, *_), actor, _ = picker
    wanted = Issue.objects.create(project=project, name="Needle", priority="urgent")
    IssueAssignee.objects.create(project=project, issue=wanted, assignee=actor)
    label = Label.objects.create(project=project, name="Backend")
    IssueLabel.objects.create(project=project, issue=wanted, label=label)
    for number in range(102):
        Issue.objects.create(project=project, name=f"Other {number}", priority="low")
    first = search(picker)
    assert len(first.data) == 100
    assert str(wanted.id) not in ids(first)
    second = search(picker, offset=100)
    assert len(second.data) == 3
    assert ids(first).isdisjoint(ids(second))
    assert str(wanted.id) in ids(second)
    response = search(
        picker, priorities="urgent", state_groups="unstarted", assignee_ids=str(actor.id), label_ids=str(label.id)
    )
    assert ids(response) == {str(wanted.id)}
    assert response.data[0]["assignee_ids"] == [actor.id]
    assert ids(search(picker, search="Needle", priorities="urgent")) == {str(wanted.id)}
    assert ids(search(picker, search="Other", priorities="urgent")) == set()


def test_project_scope_and_permission_cannot_be_widened_by_filters(picker):
    _, _, (one, two, private), *_ = picker
    a = Issue.objects.create(project=one, name="First")
    b = Issue.objects.create(project=two, name="Second")
    Issue.objects.create(project=private, name="Secret")
    assert ids(search(picker, project_ids=str(two.id))) == set()
    assert ids(search(picker, workspace_search="true", project_ids=str(two.id))) == {str(b.id)}
    assert ids(search(picker, workspace_search="true", project_ids=f"{one.id},{two.id},{private.id}")) == {
        str(a.id),
        str(b.id),
    }


def test_multi_select_is_or_within_filter_and_ignores_deleted_assignments(picker):
    _, _, (project, *_), actor, colleague = picker
    mine = Issue.objects.create(project=project, name="Mine")
    theirs = Issue.objects.create(project=project, name="Theirs")
    free = Issue.objects.create(project=project, name="Unassigned")
    IssueAssignee.objects.create(project=project, issue=mine, assignee=actor)
    IssueAssignee.objects.create(project=project, issue=mine, assignee=colleague)
    IssueAssignee.objects.create(project=project, issue=theirs, assignee=colleague)
    deleted = IssueAssignee.objects.create(project=project, issue=free, assignee=actor)
    IssueAssignee.objects.filter(pk=deleted.pk).update(deleted_at=timezone.now())
    response = search(picker, assignee_ids=str(actor.id), unassigned="true")
    assert len(response.data) == 2
    assert ids(response) == {str(mine.id), str(free.id)}
    assert ids(search(picker, assignee_ids=f"{actor.id},{colleague.id}")) == {str(mine.id), str(theirs.id)}
    assert ids(search(picker, unassigned="true")) == {str(free.id)}


def test_existing_sub_item_and_relation_exclusions_are_preserved(picker):
    _, _, (project, *_), *_ = picker
    parent = Issue.objects.create(project=project, name="Parent")
    child = Issue.objects.create(project=project, name="Child", parent=parent)
    candidate = Issue.objects.create(project=project, name="Candidate", priority="high")
    assert ids(search(picker, issue_id=str(parent.id), sub_issue="true", priorities="high")) == {str(candidate.id)}
    result = ids(search(picker, issue_id=str(parent.id), sub_issue="true"))
    assert str(parent.id) not in result and str(child.id) not in result


@pytest.mark.parametrize(
    "params",
    [
        {"offset": -1},
        {"offset": "abc"},
        {"limit": 101},
        {"limit": 0},
        {"project_ids": "invalid"},
        {"assignee_ids": "invalid"},
        {"label_ids": "invalid"},
        {"state_groups": "invalid"},
        {"priorities": "invalid"},
    ],
)
def test_invalid_filters_return_400(picker, params):
    assert search(picker, **params).status_code == 400
