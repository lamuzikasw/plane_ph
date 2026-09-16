from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueComment, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.issue_comment_counts import with_comment_count

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def discussion():
    actor = UserFactory(username=str(uuid4()))
    workspace = WorkspaceFactory(owner=actor)
    WorkspaceMember.objects.create(workspace=workspace, member=actor, role=20)
    project = Project.objects.create(workspace=workspace, name="Discussion", identifier="DISC")
    ProjectMember.objects.create(project=project, member=actor, role=20)
    State.objects.create(project=project, name="Todo", group="unstarted", color="#60646C", default=True)
    issue = Issue.objects.create(project=project, name="Discuss this task")
    with patch("celery.app.task.Task.delay"):
        yield actor, workspace, project, issue


def test_counts_live_comments_in_one_query(discussion, django_assert_num_queries):
    actor, _, project, issue = discussion
    empty = Issue.objects.create(project=project, name="No discussion")
    for text in ("First", "Second", "Deleted"):
        comment = IssueComment.objects.create(project=project, issue=issue, actor=actor, comment_html=f"<p>{text}</p>")
    IssueComment.objects.filter(pk=comment.pk).update(deleted_at=timezone.now())
    with django_assert_num_queries(1):
        counts = dict(with_comment_count(Issue.objects.filter(pk__in=[issue.pk, empty.pk])).values_list("id", "comment_count"))
    assert counts == {issue.pk: 2, empty.pk: 0}


@pytest.mark.parametrize("grouped", [False, True])
def test_board_returns_comment_count_and_excludes_deleted_comments(discussion, grouped):
    actor, workspace, project, issue = discussion
    comment = IssueComment.objects.create(project=project, issue=issue, actor=actor, comment_html="<p>Discussion</p>")
    client = APIClient()
    client.force_authenticate(actor)
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    params = {"group_by": "state_id"} if grouped else {}
    for expected in (1, 0):
        response = client.get(url, params)
        assert response.status_code == 200
        rows = response.data["results"]
        if grouped:
            rows = [row for group in rows.values() for row in group["results"]]
        assert next(row for row in rows if str(row["id"]) == str(issue.id))["comment_count"] == expected
        IssueComment.objects.filter(pk=comment.pk).update(deleted_at=timezone.now())
