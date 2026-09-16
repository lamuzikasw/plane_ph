import pytest
from django.utils import timezone

from plane.db.models import Issue, IssueComment
from plane.tests.unit.views.test_issue_placements import shared_work, client_for, url
from plane.utils.issue_comment_counts import with_comment_count
from plane.utils.issue_placements import attach_issue

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


def test_counts_live_comments_without_extra_queries(shared_work, django_assert_num_queries):
    actor, _, source, _, issue = shared_work
    empty = Issue.objects.create(project=source, name="No discussion")
    for text in ("First", "Second", "Deleted"):
        comment = IssueComment.objects.create(project=source, issue=issue, actor=actor, comment_html=f"<p>{text}</p>")
    IssueComment.objects.filter(pk=comment.pk).update(deleted_at=timezone.now())
    with django_assert_num_queries(1):
        counts = dict(with_comment_count(Issue.objects.filter(pk__in=[issue.pk, empty.pk])).values_list("id", "comment_count"))
    assert counts == {issue.pk: 2, empty.pk: 0}


@pytest.mark.parametrize("grouped", [False, True])
def test_native_and_shared_boards_return_the_same_count(shared_work, grouped):
    actor, workspace, source, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    comment = IssueComment.objects.create(project=source, issue=issue, actor=actor, comment_html="<p>Discussion</p>")
    client = client_for(actor)
    for project, issue_id in ((source, issue.id), (target, entry.id)):
        response = client.get(url(workspace, project), {"group_by": "state_id"} if grouped else {})
        assert response.status_code == 200
        rows = response.data["results"]
        if grouped:
            rows = [row for group in rows.values() for row in group["results"]]
        row = next(row for row in rows if str(row["id"]) == str(issue_id))
        assert row["comment_count"] == 1
    IssueComment.objects.filter(pk=comment.pk).update(deleted_at=timezone.now())
    response = client.get(url(workspace, target))
    row = next(row for row in response.data["results"] if str(row["id"]) == str(entry.id))
    assert row["comment_count"] == 0
