from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import IssueActivity, TelegramQuietPeriod, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.tests.unit.views.test_telegram import setup, comment_event, make_due
from plane.utils.telegram import deliver_connection, enqueue_activities, is_quiet_activity

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def admin_client(actor):
    client = APIClient()
    client.force_authenticate(actor)
    return client


def start(setup):
    c, actor, issue, _ = setup
    client = admin_client(actor)
    url = f"/api/workspaces/{issue.workspace.slug}/telegram-quiet-periods/"
    response = client.post(url, {"recipient": str(c.user_id)}, format="json")
    assert response.status_code == 200, response.data
    return client, url, response.data


def assignment(c, actor, issue, epoch=None):
    return IssueActivity.objects.create(
        project=issue.project,
        issue=issue,
        actor=actor,
        field="assignees",
        verb="updated",
        new_identifier=str(c.user_id),
        epoch=timezone.now().timestamp() if epoch is None else epoch,
    )


@pytest.mark.parametrize("role", [5, 15])
def test_member_cannot_start_read_or_stop_quiet_period(setup, role):
    c, actor, issue, _ = setup
    client, url, period = start(setup)
    WorkspaceMember.objects.filter(member=actor, workspace=issue.workspace).update(role=role)
    assert client.get(url).status_code == 403
    assert client.post(url, {"recipient": str(c.user_id)}, format="json").status_code == 403
    assert client.delete(f"{url}{period['id']}/").status_code == 403
    assert TelegramQuietPeriod.objects.get(pk=period["id"]).stopped_at is None


def test_workspace_and_actor_are_enforced_and_no_preferences_change(setup):
    c, actor, issue, _ = setup
    client, url, period = start(setup)
    before = {field.name: getattr(c, field.name) for field in c._meta.fields}
    assert client.post(url, {"recipient": str(c.user_id)}, format="json").data["id"] == period["id"]
    assert client.post(url, {"recipient": str(uuid4())}, format="json").status_code == 400
    assert client.post(url, {"recipient": str(actor.id)}, format="json").status_code == 400
    assert client.post(url, {"recipient": "bad"}, format="json").status_code == 400
    other_admin = admin_client(c.user)
    assert other_admin.get(url).data["periods"] == []
    assert other_admin.delete(f"{url}{period['id']}/").status_code == 404
    with patch("celery.app.task.Task.delay"):
        elsewhere = WorkspaceFactory(owner=actor)
    assert client.get(f"/api/workspaces/{elsewhere.slug}/telegram-quiet-periods/").status_code == 403
    c.refresh_from_db()
    assert {field.name: getattr(c, field.name) for field in c._meta.fields} == before
    WorkspaceMember.objects.filter(workspace=issue.workspace, member=c.user).update(is_active=False)
    assert client.post(url, {"recipient": str(c.user_id)}, format="json").status_code == 400


def test_super_admin_can_use_quiet_mode(setup):
    _, actor, issue, _ = setup
    WorkspaceMember.objects.filter(workspace=issue.workspace, member=actor).update(role=30)
    start(setup)


def test_fifteen_assignments_leave_history_without_telegram_or_late_digest(setup):
    c, actor, issue, _ = setup
    client, url, period = start(setup)
    occurred_at = timezone.now()
    activities = [assignment(c, actor, issue, occurred_at.timestamp() + i / 1000) for i in range(15)]
    # Finish, then let a delayed worker process all edits. The historical interval
    # must survive both explicit stop and the one-hour expiry.
    with patch(
        "plane.app.views.notification.telegram_quiet.timezone.now", return_value=occurred_at + timedelta(seconds=2)
    ):
        assert client.delete(f"{url}{period['id']}/").status_code == 204
    with patch("plane.utils.telegram.timezone.now", return_value=occurred_at + timedelta(hours=2)):
        enqueue_activities(activities)
        with patch("plane.utils.telegram.bot_request") as send:
            deliver_connection(c.pk)
            send.assert_not_called()
    assert not c.events.exists()
    assert IssueActivity.objects.filter(pk__in=[a.pk for a in activities]).count() == 15
    assert client.get(url).data["periods"] == []
    stopped = TelegramQuietPeriod.objects.get(pk=period["id"]).stopped_at
    assert client.delete(f"{url}{period['id']}/").status_code == 204
    assert TelegramQuietPeriod.objects.get(pk=period["id"]).stopped_at == stopped


def test_expiry_and_stop_only_cover_request_time_not_worker_time(setup):
    c, actor, issue, _ = setup
    _, _, result = start(setup)
    period = TelegramQuietPeriod.objects.get(pk=result["id"])
    inside = assignment(c, actor, issue, period.started_at.timestamp() + 1)
    before = assignment(c, actor, issue, period.started_at.timestamp() - 1)
    after = assignment(c, actor, issue, period.expires_at.timestamp() + 1)
    assert is_quiet_activity(inside, c.user_id)
    assert not is_quiet_activity(before, c.user_id)
    assert not is_quiet_activity(after, c.user_id)
    # An expired period is still consulted for asynchronous activities.
    with patch("plane.utils.telegram.timezone.now", return_value=period.expires_at + timedelta(hours=1)):
        enqueue_activities([inside, before, after])
    assert set(c.events.values_list("activity_id", flat=True)) == {before.id, after.id}


def test_other_actors_recipients_and_workspaces_are_not_silenced(setup):
    c, actor, issue, _ = setup
    start(setup)
    a = assignment(c, actor, issue)
    assert is_quiet_activity(a, c.user_id)
    assert not is_quiet_activity(a, uuid4())
    a.workspace_id = uuid4()
    assert not is_quiet_activity(a, c.user_id)
    a.workspace_id = issue.workspace_id
    with patch("celery.app.task.Task.delay"):
        colleague = UserFactory(username=str(uuid4()))
    a.actor = colleague
    a.save()
    enqueue_activities([a])
    assert c.events.filter(activity=a).exists()


def test_comments_are_quiet_but_existing_queue_is_preserved(setup):
    c, actor, issue, _ = setup
    # A pre-existing assignment must still be delivered normally.
    old = assignment(c, actor, issue, (timezone.now() - timedelta(minutes=1)).timestamp())
    enqueue_activities([old])
    start(setup)
    comment_event(setup, mentioned=True)
    comment_event(setup)
    make_due(c)
    with patch("plane.utils.telegram.bot_request", return_value={"message_id": 1}) as send:
        deliver_connection(c.pk)
        assert send.call_count == 1
    assert list(c.events.values_list("activity_id", flat=True)) == [old.id]


def test_delivery_rechecks_quiet_period_for_already_enqueued_event(setup):
    c, actor, issue, _ = setup
    a = assignment(c, actor, issue)
    enqueue_activities([a])
    # Simulate an event queued before the quiet-period transaction was visible.
    TelegramQuietPeriod.objects.create(
        workspace=issue.workspace,
        actor=actor,
        recipient=c.user,
        started_at=timezone.now() - timedelta(seconds=2),
        expires_at=timezone.now() + timedelta(hours=1),
    )
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
        send.assert_not_called()
    assert c.events.get().status == "skipped"
