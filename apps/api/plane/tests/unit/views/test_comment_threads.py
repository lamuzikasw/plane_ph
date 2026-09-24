import json
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder
from rest_framework.test import APIClient

from plane.app.serializers import IssueActivitySerializer
from plane.bgtasks.deletion_task import hard_delete, soft_delete_related_objects
from plane.bgtasks.notification_task import notifications
from plane.db.models import (
    Issue,
    IssueActivity,
    IssueComment,
    IssueCommentRead,
    IssueSubscriber,
    Notification,
    EmailNotificationLog,
    Project,
    ProjectMember,
    State,
    UserNotificationPreference,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.issue_comment_counts import with_comment_count

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def discussion():
    with patch("celery.app.task.Task.delay"):
        author = UserFactory(username=str(uuid4()))
        actor = UserFactory(username=str(uuid4()))
        workspace = WorkspaceFactory(owner=author)
        project = Project.objects.create(workspace=workspace, name="Threads", identifier="THREAD")
        for user in (author, actor):
            WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
            ProjectMember.objects.create(project=project, member=user, role=20)
            UserNotificationPreference.objects.get_or_create(user=user)
        State.objects.create(project=project, name="Todo", group="unstarted", color="#60646C", default=True)
        issue = Issue.objects.create(project=project, name="Discuss this task")
        root = IssueComment.objects.create(project=project, issue=issue, actor=author, comment_html="<p>Question</p>")
        client = APIClient()
        client.force_authenticate(actor)
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/comments/"
        yield client, url, root, actor


def reply(discussion, **extra):
    client, url, root, _ = discussion
    return client.post(url, {"parent": str(root.id), "comment_html": "<p>Answer</p>", **extra}, format="json")


def test_create_reply_and_flat_history_contract(discussion):
    client, url, root, actor = discussion
    response = reply(discussion)
    assert response.status_code == 201, response.data
    assert response.data["parent"] == root.id
    assert response.data["actor"] == actor.id
    history = client.get(url.replace("/comments/", "/history/"), {"activity_type": "issue-comment"})
    assert history.status_code == 200
    assert len(history.data) == 2
    assert with_comment_count(Issue.objects.filter(pk=root.issue_id)).get().comment_count == 2


def test_reply_inherits_public_visibility(discussion):
    _, _, root, _ = discussion
    root.access = "EXTERNAL"
    root.save()
    response = reply(discussion)
    assert response.status_code == 201
    assert response.data["access"] == "EXTERNAL"


def test_rejects_foreign_parent(discussion):
    _, _, root, _ = discussion
    other_issue = Issue.objects.create(project=root.project, name="Other issue")
    other = IssueComment.objects.create(project=root.project, issue=other_issue, actor=root.actor)
    response = reply(discussion, parent=str(other.id))
    assert response.status_code == 400
    assert "parent" in response.data


def test_rejects_nested_replies_and_reparenting(discussion):
    client, url, root, _ = discussion
    created = reply(discussion).data
    assert reply(discussion, parent=str(created["id"])).status_code == 400
    response = client.patch(f"{url}{created['id']}/", {"parent": None}, format="json")
    assert response.status_code == 400
    response = client.patch(f"{url}{root.id}/", {"parent": str(root.id)}, format="json")
    assert response.status_code == 400


def test_rejects_independent_reply_visibility(discussion):
    client, url, root, _ = discussion
    assert reply(discussion, access="EXTERNAL").status_code == 400
    created = reply(discussion).data
    assert client.patch(f"{url}{created['id']}/", {"access": "EXTERNAL"}, format="json").status_code == 400
    assert client.patch(f"{url}{root.id}/", {"access": "EXTERNAL"}, format="json").status_code == 200
    assert IssueComment.objects.get(pk=created["id"]).access == "EXTERNAL"


def test_rejects_deleted_parent(discussion):
    _, _, root, _ = discussion
    IssueComment.objects.filter(pk=root.id).update(deleted_at=timezone.now())
    assert reply(discussion).status_code == 400


def test_outsider_cannot_reply(discussion):
    client, _, _, _ = discussion
    client.force_authenticate(UserFactory(username=str(uuid4())))
    assert reply(discussion).status_code == 403


def test_delete_root_keeps_replies_and_hides_deleted_content(discussion):
    client, url, root, _ = discussion
    created = reply(discussion).data
    assert client.delete(f"{url}{root.id}/").status_code == 204
    soft_delete_related_objects.run("db", "issuecomment", root.id)
    assert IssueComment.objects.filter(pk=created["id"]).exists()
    history_url = url.replace("/comments/", "/history/")
    history = client.get(history_url, {"activity_type": "issue-comment"}).data
    tombstone = next(row for row in history if str(row["id"]) == str(root.id))
    assert tombstone["deleted_at"]
    assert tombstone["comment_html"] == ""
    assert tombstone["comment_stripped"] == ""
    assert tombstone["description"] is None
    assert with_comment_count(Issue.objects.filter(pk=root.issue_id)).get().comment_count == 1
    # Live replies are still editable after the parent is deleted.
    assert (
        client.patch(f"{url}{created['id']}/", {"comment_html": "<p>Edited answer</p>"}, format="json").status_code
        == 200
    )
    assert client.delete(f"{url}{created['id']}/").status_code == 204
    assert client.get(history_url, {"activity_type": "issue-comment"}).data == []


def test_hard_delete_does_not_purge_live_thread(discussion, settings):
    _, _, root, _ = discussion
    created = reply(discussion).data
    settings.HARD_DELETE_AFTER_DAYS = 1
    IssueComment.objects.filter(pk=root.id).update(deleted_at=timezone.now() - timezone.timedelta(days=3))
    hard_delete.run()
    assert IssueComment.all_objects.filter(pk=root.id).exists()
    assert IssueComment.objects.filter(pk=created["id"]).exists()


def test_issue_deletion_still_cascades_to_replies(discussion):
    _, _, root, _ = discussion
    created = reply(discussion).data
    Issue.objects.filter(pk=root.issue_id).update(deleted_at=timezone.now())
    soft_delete_related_objects.run("db", "issuecomment", root.id)
    assert not IssueComment.objects.filter(pk=created["id"]).exists()


@pytest.mark.parametrize("subscribed,mentioned", [(False, False), (True, False), (True, True)])
def test_notifies_original_author_once(discussion, subscribed, mentioned):
    _, _, root, actor = discussion
    IssueSubscriber.objects.filter(issue=root.issue).delete()
    UserNotificationPreference.objects.filter(user=root.actor).update(comment=True, mention=True)
    if subscribed:
        IssueSubscriber.objects.create(project=root.project, issue=root.issue, subscriber=root.actor)
    html = "<p>Answer</p>"
    if mentioned:
        html += (
            f'<mention-component entity_name="user_mention" entity_identifier="{root.actor_id}"></mention-component>'
        )
    created = reply(discussion, comment_html=html).data
    activity = IssueActivity.objects.create(
        issue=root.issue,
        project=root.project,
        actor=actor,
        field="comment",
        verb="created",
        comment="created a comment",
        issue_comment_id=created["id"],
        new_identifier=created["id"],
        new_value=html,
    )
    notifications.run(
        type="comment.activity.created",
        issue_id=str(root.issue_id),
        project_id=str(root.project_id),
        actor_id=str(actor.id),
        subscriber=True,
        issue_activities_created=json.dumps(IssueActivitySerializer([activity], many=True).data, cls=DjangoJSONEncoder),
        requested_data=json.dumps({"parent": str(root.id)}),
        current_instance=None,
    )
    alerts = Notification.objects.filter(receiver=root.actor)
    assert alerts.count() == 1
    assert alerts.get().data["issue_activity"]["new_identifier"] == str(created["id"])
    assert not Notification.objects.filter(receiver=actor).exists()
    assert EmailNotificationLog.objects.filter(receiver=root.actor).count() == 1


def test_visibility_invariant_applies_outside_app_serializer(discussion):
    _, _, root, actor = discussion
    child = IssueComment.objects.create(
        project=root.project, issue=root.issue, actor=actor, parent=root, access="EXTERNAL"
    )
    assert child.access == root.access
    root.access = "EXTERNAL"
    root.save(update_fields=["access"])
    child.refresh_from_db()
    assert child.access == "EXTERNAL"


def test_public_serializer_does_not_allow_thread_reparenting(discussion):
    from plane.space.serializer.issue import IssueCommentSerializer

    _, _, root, _ = discussion
    serializer = IssueCommentSerializer(data={"parent": str(root.id), "comment_html": "<p>Public comment</p>"})
    assert serializer.is_valid(), serializer.errors
    assert "parent" not in serializer.validated_data


def test_email_digest_links_to_latest_reply():
    from plane.bgtasks.email_notification_task import create_payload

    payload = create_payload(
        {
            "author": [
                {
                    "issue_activity": {
                        "field": "comment",
                        "new_value": "<p>First</p>",
                        "new_identifier": "reply-1",
                        "activity_time": "2026-09-24T10:00:00Z",
                    }
                },
                {
                    "issue_activity": {
                        "field": "comment",
                        "new_value": "<p>Second</p>",
                        "new_identifier": "reply-2",
                        "activity_time": "2026-09-24T11:00:00Z",
                    }
                },
            ]
        }
    )
    assert payload["author"]["comment"]["comment_id"] == "reply-2"
    assert len(payload["author"]["comment"]["new_value"]) == 2


def test_read_receipts_are_private_persistent_and_idempotent(discussion):
    client, url, root, actor = discussion
    own = reply(discussion).data
    foreign = IssueComment.objects.create(project=root.project, issue=root.issue, parent=root, actor=root.actor)
    history_url = url.replace("/comments/", "/history/")
    history = client.get(history_url, {"activity_type": "issue-comment"}).data
    unread = {str(row["id"]): row["is_unread"] for row in history}
    assert unread == {str(root.id): False, str(own["id"]): False, str(foreign.id): True}
    for _ in range(2):
        response = client.post(
            f"{url}read/", {"comment_ids": [str(foreign.id)], "user": str(root.actor_id)}, format="json"
        )
        assert response.status_code == 200, response.data
    assert IssueCommentRead.objects.filter(user=actor, comment=foreign).count() == 1
    assert not IssueCommentRead.objects.filter(user=root.actor).exists()
    history = client.get(history_url, {"activity_type": "issue-comment"}).data
    assert not any(row["is_unread"] for row in history)
    client.force_authenticate(root.actor)
    history = client.get(history_url, {"activity_type": "issue-comment"}).data
    assert [str(row["id"]) for row in history if row["is_unread"]] == [str(own["id"])]


def test_reading_visible_reply_does_not_read_unseen_or_later_replies(discussion):
    client, url, root, actor = discussion
    replies = [
        IssueComment.objects.create(project=root.project, issue=root.issue, parent=root, actor=root.actor)
        for _ in range(2)
    ]
    assert client.post(f"{url}read/", {"comment_ids": [str(replies[1].id)]}, format="json").status_code == 200
    later = IssueComment.objects.create(project=root.project, issue=root.issue, parent=root, actor=root.actor)
    replies[1].comment_html = "<p>Edited</p>"
    replies[1].save()
    history = client.get(url.replace("/comments/", "/history/"), {"activity_type": "issue-comment"}).data
    assert {str(row["id"]) for row in history if row["is_unread"]} == {str(replies[0].id), str(later.id)}


def test_read_receipts_reject_outsiders_and_cross_issue_ids(discussion):
    client, url, root, actor = discussion
    other_issue = Issue.objects.create(project=root.project, name="Other")
    other_root = IssueComment.objects.create(project=root.project, issue=other_issue, actor=actor)
    other_reply = IssueComment.objects.create(project=root.project, issue=other_issue, parent=other_root, actor=actor)
    assert client.post(f"{url}read/", {"comment_ids": [str(other_reply.id)]}, format="json").status_code == 400
    assert client.post(f"{url}read/", {"comment_ids": [str(root.id)]}, format="json").status_code == 400
    child = reply(discussion).data
    client.force_authenticate(UserFactory(username=str(uuid4())))
    assert client.post(f"{url}read/", {"comment_ids": [str(child["id"])]}, format="json").status_code == 403
    assert not IssueCommentRead.objects.exists()


@pytest.mark.parametrize("ids", [[], ["invalid"], None, [str(uuid4())] * 101])
def test_read_receipt_input_validation(discussion, ids):
    client, url, _, _ = discussion
    assert client.post(f"{url}read/", {"comment_ids": ids}, format="json").status_code == 400
