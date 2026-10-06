from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueComment,
    IssueCommentRead,
    IssueSubscriber,
    Project,
    ProjectMember,
    State,
    TelegramConnection,
    TelegramDelivery,
    TelegramMute,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.telegram import (
    TelegramError,
    begin_link,
    deliver_connection,
    enqueue_activities,
    handle_update,
    next_allowed,
)
from plane.bgtasks.telegram_task import dispatch_telegram

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def setup(settings):
    settings.TELEGRAM_ENABLED = True
    settings.TELEGRAM_BOT_TOKEN = "123:test-token"
    settings.TELEGRAM_BOT_USERNAME = "test_bot"
    settings.WEB_URL = "http://localhost:3000"
    with patch("celery.app.task.Task.delay"):
        user = UserFactory(username=str(uuid4()))
        settings.TELEGRAM_DELIVERY_USER_IDS = [str(user.id)]
        actor = UserFactory(username=str(uuid4()))
        workspace = WorkspaceFactory(owner=user)
        project = Project.objects.create(workspace=workspace, name="Telegram", identifier="TG")
        for member in (user, actor):
            WorkspaceMember.objects.create(workspace=workspace, member=member, role=20)
            ProjectMember.objects.create(project=project, member=member, role=20)
        State.objects.create(project=project, name="Todo", group="unstarted", color="#60646C", default=True)
        issue = Issue.objects.create(project=project, name="Telegram task")
        IssueAssignee.objects.create(project=project, issue=issue, assignee=user)
        c = TelegramConnection.objects.create(user=user, telegram_id=1234, confirmed_at=timezone.now(), scheduled=False)
        client = APIClient()
        client.force_authenticate(user)
        yield c, actor, issue, client


def comment_event(setup, mentioned=False, parent=None, reply_to=None, verb="created", old="", existing=None):
    c, actor, issue, _ = setup
    content = (
        f'<mention-component entity_name="user_mention" entity_identifier="{c.user_id}">@User</mention-component>'
        if mentioned
        else "<p>Update &amp; details</p>"
    )
    comment = existing or IssueComment.objects.create(
        project=issue.project, issue=issue, actor=actor, parent=parent, reply_to=reply_to, comment_html=content
    )
    if existing:
        comment.comment_html = content
        comment.save()
    activity = IssueActivity.objects.create(
        project=issue.project,
        issue=issue,
        actor=actor,
        field="comment",
        verb=verb,
        issue_comment=comment,
        new_value=content,
        old_value=old,
    )
    enqueue_activities([activity])
    return activity, comment


def make_due(c):
    c.events.filter(status="pending").update(due_at=timezone.now() - timedelta(seconds=1))


def test_link_requires_private_start_and_explicit_authenticated_confirmation(setup):
    c, _, _, client = setup
    url = begin_link(c)
    token = url.split("start=")[1]
    c.refresh_from_db()
    assert token not in c.token_hash
    with patch("plane.utils.telegram.bot_request") as send:
        handle_update(
            {"message": {"chat": {"type": "group", "id": -10}, "from": {"id": 5678}, "text": f"/start {token}"}}
        )
        assert not send.called
        handle_update(
            {
                "message": {
                    "chat": {"type": "private", "id": 5678},
                    "from": {"id": 5678, "username": "demo"},
                    "text": f"/start {token}",
                }
            }
        )
    c.refresh_from_db()
    assert c.telegram_id == 1234
    assert c.pending_id == 5678
    assert c.token_hash == ""
    assert (
        client.post("/api/users/me/telegram/", {"action": "confirm", "pending_id": "wrong"}, format="json").status_code
        == 400
    )
    assert (
        client.post("/api/users/me/telegram/", {"action": "confirm", "pending_id": "5678"}, format="json").status_code
        == 200
    )
    c.refresh_from_db()
    assert c.telegram_id == 5678
    assert c.pending_id is None


def test_expired_and_used_link_cannot_be_replayed(setup):
    c, _, _, _ = setup
    token = begin_link(c).split("start=")[1]
    c.token_expires_at = timezone.now() - timedelta(seconds=1)
    c.save()
    with patch("plane.utils.telegram.bot_request"):
        handle_update(
            {"message": {"chat": {"type": "private", "id": 5678}, "from": {"id": 5678}, "text": f"/start {token}"}}
        )
    c.refresh_from_db()
    assert c.pending_id is None


def test_settings_validate_schedule_and_are_private(setup):
    _, _, _, client = setup
    url = "/api/users/me/telegram/"
    assert APIClient().get(url).status_code in (401, 403)
    for data in ({"timezone": "Mars/Nowhere"}, {"start_hour": 22, "end_hour": 8}, {"end_hour": 25}):
        assert client.patch(url, data, format="json").status_code == 400
    response = client.get(url)
    assert response.status_code == 200
    assert "token_hash" not in response.data and "telegram_id" not in response.data


def test_assignment_and_self_actions(setup):
    c, actor, issue, _ = setup
    activity = IssueActivity.objects.create(
        project=issue.project, issue=issue, actor=actor, field="assignees", verb="updated", new_identifier=c.user_id
    )
    enqueue_activities([activity, activity])
    assert list(c.events.values_list("kind", flat=True)) == ["assignment"]
    activity.actor_id = c.user_id
    c.events.all().delete()
    enqueue_activities([activity])
    assert not c.events.exists()


def test_mention_reply_assignee_produce_one_event_and_address_selected_author(setup):
    c, actor, issue, _ = setup
    root = IssueComment.objects.create(project=issue.project, issue=issue, actor=actor)
    child = IssueComment.objects.create(project=issue.project, issue=issue, actor=c.user, parent=root)
    activity, _ = comment_event(setup, mentioned=True, parent=root, reply_to=child)
    enqueue_activities([activity])
    assert list(c.events.values_list("kind", flat=True)) == ["mention"]
    c.events.all().delete()
    comment_event(setup, parent=root, reply_to=child)
    assert list(c.events.values_list("kind", flat=True)) == ["reply"]


def test_comment_edit_only_new_mentions_promote_unsent_digest(setup):
    c, _, _, _ = setup
    _, comment = comment_event(setup)
    assert c.events.get().kind == "comment"
    comment_event(setup, mentioned=True, existing=comment, verb="updated", old="<p>Update</p>")
    assert c.events.count() == 1 and c.events.get().kind == "mention"
    c.events.update(status="sent")
    comment_event(setup, mentioned=True, existing=comment, verb="updated", old="")
    assert c.events.count() == 1 and c.events.get().status == "sent"


def test_read_comments_cancel_delivery(setup):
    c, _, _, _ = setup
    _, comment = comment_event(setup)
    IssueCommentRead.objects.create(user=c.user, comment=comment)
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().status == "skipped"


@pytest.mark.parametrize(
    "change", ["comment_deleted", "mention_removed", "membership_removed", "disabled_user", "assignment_removed"]
)
def test_recheck_before_send(setup, change):
    c, actor, issue, _ = setup
    _, comment = comment_event(setup, mentioned=True)
    if change == "comment_deleted":
        comment.delete()
    elif change == "mention_removed":
        comment.comment_html = "<p>Changed</p>"
        comment.save()
    elif change == "membership_removed":
        ProjectMember.objects.filter(project=issue.project, member=c.user).update(is_active=False)
    elif change == "disabled_user":
        c.user.is_active = False
        c.user.save()
    else:
        c.events.all().delete()
        activity = IssueActivity.objects.create(
            project=issue.project, issue=issue, actor=actor, field="assignees", verb="updated", new_identifier=c.user_id
        )
        enqueue_activities([activity])
        IssueAssignee.objects.filter(issue=issue).delete()
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called


def test_internal_comments_not_sent_to_guest(setup):
    c, _, issue, _ = setup
    ProjectMember.objects.filter(project=issue.project, member=c.user).update(role=5)
    WorkspaceMember.objects.filter(workspace=issue.workspace, member=c.user).update(role=5)
    issue.project.guest_view_all_features = True
    issue.project.save()
    comment_event(setup, mentioned=True)
    assert not c.events.exists()


def test_digest_combines_messages_and_links_to_exact_comment(setup):
    c, _, _, _ = setup
    _, first = comment_event(setup)
    comment_event(setup)
    make_due(c)
    with patch("plane.utils.telegram.bot_request", return_value={"message_id": 90}) as send:
        deliver_connection(c.pk)
        deliver_connection(c.pk)
    assert send.call_count == 1
    body = send.call_args.args[1]
    assert f"#comment-{first.id}" in body["text"]
    assert "Update &amp; details" in body["text"]
    assert c.events.filter(status="sent").count() == 2


def test_global_limit_and_pause_keep_events_pending(setup):
    c, _, _, _ = setup
    comment_event(setup, mentioned=True)
    make_due(c)
    for _ in range(5):
        TelegramDelivery.objects.create(connection=c, status="sent", sent_at=timezone.now())
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().status == "pending"
    c.deliveries.all().delete()
    c.paused_until = timezone.now() + timedelta(hours=1)
    c.save()
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().due_at >= c.paused_until


def test_weekend_and_timezone_schedule(setup):
    from datetime import datetime

    c, _, _, _ = setup
    c.scheduled = True
    c.timezone = "Europe/Moscow"
    friday_night = datetime.fromisoformat("2026-10-02T21:00:00+03:00")
    assert next_allowed(c, friday_night).isoformat() == "2026-10-05T10:00:00+03:00"
    inside = datetime.fromisoformat("2026-10-05T11:00:00+03:00")
    assert next_allowed(c, inside) == inside


@pytest.mark.parametrize(
    "code, expected", [("429", "pending"), ("500", "pending"), ("403", "failed"), ("unknown", "unknown")]
)
def test_delivery_failures_do_not_blindly_repeat(setup, code, expected):
    c, _, _, _ = setup
    comment_event(setup, mentioned=True)
    make_due(c)
    with patch("plane.utils.telegram.bot_request", side_effect=TelegramError(code, 300)) as send:
        deliver_connection(c.pk)
        deliver_connection(c.pk)
    assert send.call_count == 1
    assert c.events.get().status == expected
    c.refresh_from_db()
    assert bool(c.blocked_at) == (code == "403")


def test_worker_crash_is_visible_without_duplicate_send(setup):
    c, _, _, _ = setup
    comment_event(setup)
    delivery = TelegramDelivery.objects.create(connection=c, created_at=timezone.now() - timedelta(minutes=6))
    c.events.update(delivery=delivery, status="sending")
    dispatch_telegram()
    assert c.events.get().status == "unknown"


def test_mute_preserves_mentions_and_disconnect_cancels_queue(setup):
    c, _, issue, client = setup
    TelegramMute.objects.create(connection=c, issue=issue)
    comment_event(setup)
    assert not c.events.exists()
    comment_event(setup, mentioned=True)
    assert c.events.count() == 1
    assert client.delete("/api/users/me/telegram/").status_code == 204
    c.refresh_from_db()
    assert c.telegram_id is None
    assert c.events.get().status == "skipped"


def test_reply_target_must_belong_to_thread(setup):
    c, actor, issue, client = setup
    root = IssueComment.objects.create(project=issue.project, issue=issue, actor=actor)
    target = IssueComment.objects.create(project=issue.project, issue=issue, actor=actor, parent=root)
    foreign = IssueComment.objects.create(project=issue.project, issue=issue, actor=actor)
    url = f"/api/workspaces/{issue.workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/comments/"
    payload = {"parent": str(root.pk), "reply_to": str(target.pk), "comment_html": "<p>Answer</p>"}
    response = client.post(url, payload, format="json")
    assert response.status_code == 201, response.data
    assert str(response.data["reply_to"]) == str(target.pk)
    payload["reply_to"] = str(foreign.pk)
    assert client.post(url, payload, format="json").status_code == 400


def test_no_delivery_outside_explicit_pilot(setup, settings):
    c, _, _, _ = setup
    settings.TELEGRAM_DELIVERY_USER_IDS = []
    comment_event(setup, mentioned=True)
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().status == "pending"


@pytest.mark.parametrize("confirmed", [True, False])
def test_production_delivery_still_requires_confirmed_connection(setup, settings, confirmed):
    c, _, _, _ = setup
    settings.TELEGRAM_DELIVERY_USER_IDS = ["*"]
    comment_event(setup, mentioned=True)
    make_due(c)
    if not confirmed:
        c.confirmed_at = None
        c.save(update_fields=["confirmed_at"])
    with patch("plane.utils.telegram.bot_request", return_value={"message_id": 91}) as send:
        deliver_connection(c.pk)
    assert send.called is confirmed
    assert c.events.get().status == ("sent" if confirmed else "pending")


def test_comments_share_first_digest_window(setup):
    c, _, _, _ = setup
    now = timezone.now()
    with patch("plane.utils.telegram.timezone.now", return_value=now):
        comment_event(setup)
    with patch("plane.utils.telegram.timezone.now", return_value=now + timedelta(minutes=5)):
        comment_event(setup)
    assert c.events.values("due_at").distinct().count() == 1


def test_assignment_activity_retry_does_not_duplicate(setup):
    c, actor, issue, _ = setup
    for _ in range(2):
        activity = IssueActivity.objects.create(
            project=issue.project,
            issue=issue,
            actor=actor,
            field="assignees",
            verb="updated",
            new_identifier=c.user_id,
            epoch=12345,
        )
        enqueue_activities([activity])
    assert c.events.count() == 1


def test_notification_read_and_snooze_are_respected(setup):
    from plane.db.models import Notification

    c, _, issue, _ = setup
    activity, _ = comment_event(setup)
    notification = Notification.objects.create(
        workspace=issue.workspace,
        project=issue.project,
        receiver=c.user,
        entity_identifier=issue.pk,
        entity_name="issue",
        title="Mention",
        sender="mentioned",
        data={"issue_activity": {"id": str(activity.pk)}},
        snoozed_till=timezone.now() + timedelta(hours=2),
    )
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().due_at == notification.snoozed_till
    notification.read_at = timezone.now()
    notification.save()
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().status == "skipped"


def test_activity_pipeline_enqueues_actual_created_comment(setup):
    import json
    from plane.bgtasks.issue_activities_task import issue_activity

    c, actor, issue, _ = setup
    comment = IssueComment.objects.create(
        project=issue.project,
        issue=issue,
        actor=actor,
        comment_html=(
            f'<mention-component entity_name="user_mention" entity_identifier="{c.user_id}">@User</mention-component>'
        ),
    )
    issue_activity(
        type="comment.activity.created",
        issue_id=str(issue.pk),
        actor_id=str(actor.pk),
        project_id=str(issue.project_id),
        epoch=12345,
        current_instance=None,
        requested_data=json.dumps({"id": str(comment.pk), "comment_html": comment.comment_html}),
    )
    assert c.events.count() == 1
    assert c.events.get().kind == "mention"


def test_read_receipt_before_delayed_enqueue_still_suppresses(setup):
    c, _, _, _ = setup
    _, comment = comment_event(setup)
    IssueCommentRead.objects.create(user=c.user, comment=comment)
    c.events.update(created_at=timezone.now() + timedelta(seconds=5))
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    assert not send.called
    assert c.events.get().status == "skipped"


@pytest.mark.parametrize("kind", ["mention", "reply"])
@pytest.mark.parametrize("read_source", ["comment", "notification", "both"])
def test_direct_events_are_delivered_even_when_read_in_plane(setup, kind, read_source):
    from plane.db.models import Notification

    c, actor, issue, _ = setup
    root = IssueComment.objects.create(project=issue.project, issue=issue, actor=actor)
    target = IssueComment.objects.create(project=issue.project, issue=issue, actor=c.user, parent=root)
    activity, comment = comment_event(setup, mentioned=kind == "mention", parent=root, reply_to=target)
    assert c.events.get().kind == kind
    if read_source in ("comment", "both"):
        IssueCommentRead.objects.create(user=c.user, comment=comment)
    if read_source in ("notification", "both"):
        Notification.objects.create(
            workspace=issue.workspace,
            project=issue.project,
            receiver=c.user,
            entity_identifier=issue.pk,
            entity_name="issue",
            title="Direct reply",
            sender="commented",
            data={"issue_activity": {"id": str(activity.pk)}},
            read_at=timezone.now(),
        )
    make_due(c)
    with patch("plane.utils.telegram.bot_request", return_value={"message_id": 92}) as send:
        deliver_connection(c.pk)
        deliver_connection(c.pk)
    send.assert_called_once()
    assert f"#comment-{comment.id}" in send.call_args.args[1]["text"]
    assert c.events.get().status == "sent"


@pytest.mark.parametrize("kind", ["mention", "reply"])
@pytest.mark.parametrize("action", ["archive", "snooze"])
def test_read_direct_events_still_respect_explicit_archive_and_snooze(setup, kind, action):
    from plane.db.models import Notification

    c, _, issue, _ = setup
    target = IssueComment.objects.create(project=issue.project, issue=issue, actor=c.user)
    activity, comment = comment_event(setup, mentioned=kind == "mention", parent=target, reply_to=target)
    IssueCommentRead.objects.create(user=c.user, comment=comment)
    until = timezone.now() + timedelta(hours=2)
    notification = Notification.objects.create(
        workspace=issue.workspace,
        project=issue.project,
        receiver=c.user,
        entity_identifier=issue.pk,
        entity_name="issue",
        title="Direct reply",
        sender="commented",
        data={"issue_activity": {"id": str(activity.pk)}},
        read_at=timezone.now(),
        archived_at=timezone.now() if action == "archive" else None,
        snoozed_till=until if action == "snooze" else None,
    )
    make_due(c)
    with patch("plane.utils.telegram.bot_request") as send:
        deliver_connection(c.pk)
    send.assert_not_called()
    event = c.events.get()
    assert event.status == ("skipped" if action == "archive" else "pending")
    if action == "snooze":
        assert event.due_at == notification.snoozed_till


def callback(c, action, message_id=90):
    return {
        "callback_query": {
            "id": "callback",
            "from": {"id": c.telegram_id},
            "data": action,
            "message": {"message_id": message_id, "chat": {"type": "private", "id": c.telegram_id}},
        }
    }


def test_digest_links_every_comment_in_body_without_duplicate_buttons(setup):
    c, _, _, _ = setup
    _, first = comment_event(setup)
    _, second = comment_event(setup)
    make_due(c)
    with patch("plane.utils.telegram.bot_request", return_value={"message_id": 90}) as send:
        deliver_connection(c.pk)
    payload = send.call_args.args[1]
    links = [b for row in payload["reply_markup"]["inline_keyboard"] for b in row if "url" in b]
    assert links == []
    assert f'#comment-{first.id}">' in payload["text"]
    assert f'#comment-{second.id}">' in payload["text"]
    assert "<b>1.</b>" in payload["text"] and "<b>2.</b>" in payload["text"]


def test_pause_adds_persistent_resume_button_and_resume_releases_old_pending_events(setup):
    c, _, _, _ = setup
    comment_event(setup, mentioned=True)
    make_due(c)
    with patch("plane.utils.telegram.bot_request", return_value={"message_id": 90}):
        deliver_connection(c.pk)
    comment_event(setup, mentioned=True)
    c.events.filter(status="pending").update(
        created_at=timezone.now() - timedelta(minutes=2), due_at=timezone.now() + timedelta(hours=1)
    )
    with patch("plane.utils.telegram.bot_request") as send:
        handle_update(callback(c, "pause:60"))
    c.refresh_from_db()
    assert c.paused_until > timezone.now()
    method, payload = send.call_args.args
    assert method == "editMessageReplyMarkup"
    buttons = [b for row in payload["reply_markup"]["inline_keyboard"] for b in row]
    assert any(b.get("callback_data") == "pause:resume" for b in buttons)
    assert any("⏸ Пауза до" in b["text"] for b in buttons)
    with patch("plane.utils.telegram.bot_request") as send:
        handle_update(callback(c, "pause:resume"))
    c.refresh_from_db()
    assert c.paused_until is None
    assert c.events.get(status="pending").due_at <= timezone.now()
    buttons = [b for row in send.call_args.args[1]["reply_markup"]["inline_keyboard"] for b in row]
    assert any(b.get("callback_data", "").startswith("pause:until:") for b in buttons)


def test_resume_keeps_working_hours_and_retry_backoff(setup):
    from plane.utils.telegram import pause_status, resume_connection
    from datetime import datetime

    c, _, _, _ = setup
    now = datetime.fromisoformat("2026-10-02T22:00:00+03:00")
    c.scheduled = True
    c.paused_until = now + timedelta(hours=1)
    c.save()
    comment_event(setup, mentioned=True)
    due = now + timedelta(hours=2)
    c.events.update(attempts=1, due_at=due)
    resume_connection(c, now)
    assert c.events.get().due_at == due
    assert next_allowed(c, now).isoformat() == "2026-10-05T10:00:00+03:00"
    assert "05.10, 10:00" in pause_status(c, now)


def test_dated_pause_button_matches_exact_time_and_old_buttons_do_not_shift_dates(setup):
    from plane.utils.telegram import pause_buttons
    from datetime import datetime

    c, _, _, _ = setup
    c.scheduled = True
    now = datetime.fromisoformat("2026-10-02T15:00:00+03:00")
    button = pause_buttons(c, now)[0][1]
    assert "05.10, 10:00" in button["text"]
    with patch("plane.utils.telegram.timezone.now", return_value=now), patch("plane.utils.telegram.bot_request"):
        handle_update(callback(c, button["callback_data"]))
    c.refresh_from_db()
    assert int(c.paused_until.timestamp()) == int(button["callback_data"].rsplit(":", 1)[1])
    old_pause = c.paused_until
    with (
        patch("plane.utils.telegram.timezone.now", return_value=now + timedelta(days=5)),
        patch("plane.utils.telegram.bot_request"),
    ):
        handle_update(callback(c, button["callback_data"]))
    c.refresh_from_db()
    assert c.paused_until == old_pause


def capture_app_issue_creation(setup, payload, creator=None):
    c, actor, issue, client = setup
    client.force_authenticate(creator or actor)
    path = f"/api/workspaces/{issue.workspace.slug}/projects/{issue.project_id}/issues/"
    with patch("plane.app.views.issue.base.issue_activity.delay") as activity:
        response = client.post(path, payload, format="json")
    assert response.status_code == 201, response.data
    assert activity.call_count == 1
    arguments = activity.call_args.kwargs
    assert arguments["type"] == "issue.activity.created"
    return Issue.objects.get(pk=response.data["id"]), arguments


def run_captured_issue_activity(arguments):
    from plane.bgtasks.issue_activities_task import issue_activity

    with (
        patch("plane.bgtasks.issue_activities_task.notifications.delay"),
        patch("plane.bgtasks.issue_activities_task.redis_instance"),
        patch("plane.bgtasks.issue_activities_task.log_exception") as failure,
        patch("plane.utils.telegram.bot_request") as send,
    ):
        issue_activity(**arguments)
    failure.assert_not_called()
    send.assert_not_called()


@pytest.mark.parametrize("raw_assignees", ["omitted", "empty", "filtered", "explicit"])
def test_creation_assignment_uses_saved_assignees_and_deduplicates_retries(setup, raw_assignees):
    import json

    c, actor, source, _ = setup
    source.project.default_assignee = c.user
    source.project.save(update_fields=["default_assignee"])
    payload = {"name": "Created with an initial assignee"}
    if raw_assignees == "empty":
        payload["assignee_ids"] = []
    elif raw_assignees == "filtered":
        outsider = UserFactory(username=str(uuid4()))
        payload["assignee_ids"] = [str(outsider.pk)]
    elif raw_assignees == "explicit":
        payload["assignee_ids"] = [str(c.user_id)]
    created, arguments = capture_app_issue_creation(setup, payload)
    assert list(created.issue_assignee.values_list("assignee_id", flat=True)) == [c.user_id]
    before = timezone.now()
    run_captured_issue_activity(arguments)
    after = timezone.now()
    event = c.events.get(issue=created)
    assert event.kind == "assignment"
    assert event.status == "pending"
    assert event.activity.field == "assignees"
    assert event.activity.new_identifier == c.user_id
    assert event.activity.actor_id == actor.pk
    assert before + timedelta(seconds=60) <= event.due_at <= after + timedelta(seconds=60)
    assert json.loads(arguments["requested_data"])["assignee_ids"] == [str(c.user_id)]
    assert IssueSubscriber.objects.filter(issue=created, subscriber_id=c.user_id).count() == 1
    run_captured_issue_activity(arguments)
    assert c.events.filter(issue=created).count() == 1
    assert c.events.get(issue=created).pk == event.pk
    assert IssueSubscriber.objects.filter(issue=created, subscriber_id=c.user_id).count() == 1


@pytest.mark.parametrize("assigned", [False, True])
def test_creation_assignment_does_not_notify_self_or_unassigned_issue(setup, assigned):
    c, actor, source, _ = setup
    source.project.default_assignee = c.user if assigned else None
    source.project.save(update_fields=["default_assignee"])
    created, arguments = capture_app_issue_creation(
        setup, {"name": "Self-assigned or unassigned creation"}, creator=c.user if assigned else actor
    )
    assert created.issue_assignee.exists() == assigned
    run_captured_issue_activity(arguments)
    assert not c.events.filter(issue=created).exists()


def test_creation_assignment_snapshot_excludes_later_assignee_and_later_assignment_is_distinct(setup, settings):
    import json

    c, actor, source, _ = setup
    later_user = UserFactory(username=str(uuid4()))
    WorkspaceMember.objects.create(workspace=source.workspace, member=later_user, role=20)
    ProjectMember.objects.create(project=source.project, member=later_user, role=20)
    later_connection = TelegramConnection.objects.create(
        user=later_user, telegram_id=5678, confirmed_at=timezone.now(), scheduled=False
    )
    settings.TELEGRAM_DELIVERY_USER_IDS = ["*"]
    source.project.default_assignee = c.user
    source.project.save(update_fields=["default_assignee"])
    created, creation = capture_app_issue_creation(setup, {"name": "Queued initial assignment"})
    initial = json.loads(creation["requested_data"])
    # A later edit commits before the asynchronous creation activity is consumed.
    created.issue_assignee.all().delete()
    IssueAssignee.objects.create(project=created.project, issue=created, assignee=later_user)
    run_captured_issue_activity(creation)
    assert initial["assignee_ids"] == [str(c.user_id)]
    assert not later_connection.events.filter(issue=created).exists()
    assert not c.events.filter(issue=created).exists()
    assert list(created.issue_activity.filter(field="assignees").values_list("new_identifier", flat=True)) == [
        c.user_id
    ]
    later_assignment = {
        **creation,
        "type": "issue.activity.updated",
        "current_instance": json.dumps({"assignee_ids": [str(c.user_id)]}),
        "requested_data": json.dumps({"assignee_ids": [str(later_user.pk)]}),
        "epoch": creation["epoch"] + 1,
    }
    run_captured_issue_activity(later_assignment)
    event = later_connection.events.get(issue=created)
    assert event.kind == "assignment"
    assert event.activity.new_identifier == later_user.pk
    run_captured_issue_activity(later_assignment)
    assert later_connection.events.filter(issue=created).count() == 1


def test_creation_assignment_and_later_reassignment_have_distinct_events(setup):
    c, actor, _, client = setup
    created, creation = capture_app_issue_creation(
        setup, {"name": "Initial and later assignment", "assignee_ids": [str(c.user_id)]}
    )
    run_captured_issue_activity(creation)
    initial = c.events.get(issue=created)
    client.force_authenticate(actor)
    path = f"/api/workspaces/{created.workspace.slug}/projects/{created.project_id}/issues/{created.pk}/"
    with patch("plane.app.views.issue.base.issue_activity.delay") as activity:
        response = client.patch(path, {"assignee_ids": []}, format="json")
    assert response.status_code == 204, response.data
    assert not created.issue_assignee.exists()
    run_captured_issue_activity(activity.call_args.kwargs)
    with (
        patch("plane.app.views.issue.base.timezone.now", return_value=timezone.now() + timedelta(seconds=2)),
        patch("plane.app.views.issue.base.issue_activity.delay") as activity,
    ):
        response = client.patch(path, {"assignee_ids": [str(c.user_id)]}, format="json")
    assert response.status_code == 204, response.data
    reassignment = activity.call_args.kwargs
    run_captured_issue_activity(reassignment)
    assert c.events.filter(issue=created).count() == 2
    assert c.events.filter(issue=created).exclude(pk=initial.pk).get().kind == "assignment"


def test_creation_assignment_notifies_each_saved_assignee_once(setup, settings):
    import json

    c, actor, source, _ = setup
    teammate = UserFactory(username=str(uuid4()))
    WorkspaceMember.objects.create(workspace=source.workspace, member=teammate, role=20)
    ProjectMember.objects.create(project=source.project, member=teammate, role=20)
    teammate_connection = TelegramConnection.objects.create(
        user=teammate, telegram_id=6789, confirmed_at=timezone.now(), scheduled=False
    )
    actor_connection = TelegramConnection.objects.create(
        user=actor, telegram_id=7890, confirmed_at=timezone.now(), scheduled=False
    )
    settings.TELEGRAM_DELIVERY_USER_IDS = ["*"]
    recipients = [str(c.user_id), str(teammate.pk), str(actor.pk)]
    created, arguments = capture_app_issue_creation(
        setup, {"name": "Multiple initial assignees", "assignee_ids": recipients}
    )
    assert set(json.loads(arguments["requested_data"])["assignee_ids"]) == set(recipients)
    run_captured_issue_activity(arguments)
    run_captured_issue_activity(arguments)
    assert c.events.get(issue=created).kind == "assignment"
    assert teammate_connection.events.get(issue=created).kind == "assignment"
    assert not actor_connection.events.filter(issue=created).exists()
    assert IssueSubscriber.objects.filter(issue=created).count() == 3


def test_creation_assignment_snapshot_preserves_payload_and_excludes_deleted_membership(setup):
    import json
    from datetime import date
    from copy import deepcopy
    from plane.utils.issue_activity import serialize_issue_creation_activity

    c, actor, issue, _ = setup
    removed = IssueAssignee.objects.create(project=issue.project, issue=issue, assignee=actor)
    removed.delete()
    payload = {
        "name": "Snapshot payload",
        "assignees": [actor.pk],
        "target_date": date(2026, 10, 20),
        "issue": {"name": "Nested intake payload"},
    }
    original = deepcopy(payload)
    serialized = serialize_issue_creation_activity(issue, payload)
    assert payload == original
    assert "assignee_ids" not in payload
    # Snapshot remains fixed after the request boundary despite later edits.
    IssueAssignee.objects.filter(issue=issue).delete()
    IssueAssignee.objects.create(project=issue.project, issue=issue, assignee=actor)
    result = json.loads(serialized)
    assert result["assignee_ids"] == [str(c.user_id)]
    assert result["assignees"] == [str(actor.pk)]
    assert result["target_date"] == "2026-10-20"
    assert result["issue"] == original["issue"]


def test_public_creation_assignment_supports_assignees_alias(setup):
    import json
    from plane.db.models.api import APIToken

    c, actor, source, _ = setup
    client = APIClient()
    token = APIToken.objects.create(user=actor, label="Telegram assignment regression", token=f"test-{uuid4()}")
    client.credentials(HTTP_X_API_KEY=token.token)
    path = f"/api/v1/workspaces/{source.workspace.slug}/projects/{source.project_id}/work-items/"
    with patch("plane.api.views.issue.issue_activity.delay") as activity:
        response = client.post(
            path, {"name": "Public initial assignment", "assignees": [str(c.user_id)]}, format="json"
        )
    assert response.status_code == 201, response.data
    assert activity.call_count == 1
    arguments = activity.call_args.kwargs
    run_captured_issue_activity(arguments)
    created = Issue.objects.get(pk=response.data["id"])
    assert c.events.get(issue=created).kind == "assignment"
    assert json.loads(arguments["requested_data"])["assignee_ids"] == [str(c.user_id)]
