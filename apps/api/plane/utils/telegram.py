"""Telegram delivery policy. Never log Bot API URLs: they contain credentials."""

import hashlib
import html
import logging
import secrets
from datetime import datetime, timedelta, timezone as datetime_timezone
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from plane.db.models import (
    IssueAssignee,
    IssueCommentRead,
    IssueSubscriber,
    Notification,
    TelegramConnection,
    TelegramDelivery,
    TelegramEvent,
    TelegramMute,
)
from plane.utils.issue_placements import require_project_access


class TelegramError(Exception):
    def __init__(self, code, retry_after=60):
        self.code = str(code)
        self.retry_after = retry_after
        super().__init__(f"Telegram error {self.code}")


def bot_request(method, data=None):
    if not settings.TELEGRAM_ENABLED or not settings.TELEGRAM_BOT_TOKEN:
        raise TelegramError("disabled")
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/{method}",
            json=data or {},
            timeout=(5, 35),
        )
        payload = response.json()
    except requests.RequestException:
        # Delivery might have succeeded. Do not blindly retry a sendMessage.
        raise TelegramError("unknown") from None
    except ValueError:
        raise TelegramError("unknown") from None
    if not payload.get("ok"):
        raise TelegramError(
            payload.get("error_code", response.status_code), payload.get("parameters", {}).get("retry_after", 60)
        )
    return payload["result"]


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def begin_link(connection):
    token = secrets.token_urlsafe(32)
    connection.token_hash = token_digest(token)
    connection.token_expires_at = timezone.now() + timedelta(minutes=10)
    connection.pending_id = None
    connection.pending_name = ""
    connection.save()
    return f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={token}"


def mention_ids(content):
    soup = BeautifulSoup(content or "", "html.parser")
    return {
        tag.get("entity_identifier")
        for tag in soup.select('mention-component[entity_name="user_mention"]')
        if tag.get("entity_identifier")
    }


def accessible(connection, issue, comment=None):
    if not connection.user.is_active or issue.deleted_at or issue.is_draft:
        return False
    try:
        role = require_project_access(connection.user, issue.project, issue=issue)
    except PermissionDenied:
        return False
    if comment:
        if comment.deleted_at or (comment.access == "INTERNAL" and role <= 5):
            return False
        if comment.parent_id and comment.parent.access == "INTERNAL" and role <= 5:
            return False
    return True


def enqueue_activities(activities):
    """Called in the transaction that stores activities; no network calls here."""
    if not settings.TELEGRAM_ENABLED:
        return
    now = timezone.now()
    connections = list(
        TelegramConnection.objects.filter(
            confirmed_at__isnull=False,
            enabled=True,
            blocked_at__isnull=True,
        ).select_related("user")
    )
    if not connections:
        return
    for activity in activities:
        if activity.field not in ("comment", "assignees") or activity.verb == "deleted":
            continue
        issue = activity.issue
        comment = activity.issue_comment if activity.field == "comment" else None
        assignees = set(
            str(pk) for pk in IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)
        )
        mentions = mention_ids(activity.new_value) if comment else set()
        old_mentions = mention_ids(activity.old_value) if comment else set()
        target = (comment.reply_to or comment.parent) if comment else None
        for connection in connections:
            user_id = str(connection.user_id)
            if user_id == str(activity.actor_id) or not accessible(connection, issue, comment):
                continue
            kind = None
            if comment:
                if user_id in mentions - old_mentions:
                    kind = "mention"
                elif activity.verb == "created":
                    if target and user_id == str(target.actor_id):
                        kind = "reply"
                    elif user_id in assignees or (
                        connection.watching
                        and (
                            issue.created_by_id == connection.user_id
                            or IssueSubscriber.objects.filter(issue=issue, subscriber_id=connection.user_id).exists()
                        )
                    ):
                        kind = "comment"
            elif str(activity.new_identifier) == user_id and user_id in assignees:
                kind = "assignment"
            if not kind or not getattr(
                connection,
                {"mention": "mentions", "reply": "replies", "assignment": "assignments", "comment": "comments"}[kind],
            ):
                continue
            if kind == "comment" and TelegramMute.objects.filter(connection=connection, issue=issue).exists():
                continue
            key = f"comment:{comment.id}" if comment else f"assignment:{issue.id}:{activity.actor_id}:{activity.epoch}"
            due_at = now + timedelta(seconds=600 if kind == "comment" else 60)
            if kind == "comment":
                batch = (
                    TelegramEvent.objects.filter(connection=connection, issue=issue, kind="comment", status="pending")
                    .order_by("due_at")
                    .first()
                )
                if batch:
                    due_at = max(now + timedelta(seconds=60), batch.due_at)
            event, created = TelegramEvent.objects.get_or_create(
                connection=connection,
                dedup_key=key,
                defaults={
                    "activity": activity,
                    "issue": issue,
                    "comment": comment,
                    "kind": kind,
                    "due_at": due_at,
                },
            )
            # A new explicit mention promotes an unsent digest entry; never re-ping
            # someone for editing the same comment after delivery.
            if not created and event.status == "pending" and kind == "mention" and event.kind != "mention":
                event.kind = "mention"
                event.activity = activity
                event.due_at = min(event.due_at, now + timedelta(seconds=60))
                event.save(update_fields=["kind", "activity", "due_at"])


def next_allowed(connection, now):
    candidate = max(now, connection.paused_until) if connection.paused_until else now
    if not connection.scheduled:
        return candidate
    tz = ZoneInfo(connection.timezone)
    # Iterate local dates so DST changes do not drift the workday.
    local = candidate.astimezone(tz)
    for _ in range(8):
        start = local.replace(hour=connection.start_hour, minute=0, second=0, microsecond=0)
        end = local.replace(hour=connection.end_hour, minute=0, second=0, microsecond=0)
        if (not connection.weekdays_only or local.weekday() < 5) and local < end:
            return max(local, start)
        local = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return candidate + timedelta(days=1)


def next_day_pause_until(connection, now):
    local = now.astimezone(ZoneInfo(connection.timezone))
    target = (local + timedelta(days=1)).replace(hour=connection.start_hour, minute=0, second=0, microsecond=0)
    while connection.scheduled and connection.weekdays_only and target.weekday() >= 5:
        target += timedelta(days=1)
    return target


def format_local(connection, value):
    return value.astimezone(ZoneInfo(connection.timezone)).strftime("%d.%m, %H:%M")


def resume_connection(connection, now):
    connection.paused_until = None
    connection.save(update_fields=["paused_until"])
    # Undo only policy deferral. Retry backoff remains intact, and dispatch
    # rechecks quiet hours, the rolling budget and notification snoozes.
    for event in connection.events.filter(status="pending", attempts=0):
        grace = timedelta(minutes=10) if event.kind == "comment" else timedelta(seconds=60)
        event.due_at = max(now, event.created_at + grace)
        event.save(update_fields=["due_at"])


def pause_status(connection, now):
    if not connection.enabled:
        return "Уведомления выключены в Plane."
    allowed = next_allowed(connection, now)
    zone = connection.timezone
    if connection.paused_until and connection.paused_until > now:
        return (
            f"Пауза до {format_local(connection, connection.paused_until)} ({zone}). "
            f"Доставка — с {format_local(connection, allowed)}. События сохраняются."
        )
    if allowed > now:
        return f"Пауза снята. По рабочему расписанию доставка — с {format_local(connection, allowed)} ({zone})."
    return "Уведомления возобновлены. Накопленные события придут сводкой с учётом лимита."


def pause_buttons(connection, now):
    if connection.paused_until and connection.paused_until > now:
        return [
            [
                {
                    "text": f"⏸ Пауза до {format_local(connection, connection.paused_until)}",
                    "callback_data": "pause:status",
                }
            ],
            [{"text": "▶ Возобновить уведомления", "callback_data": "pause:resume"}],
        ]
    target = next_day_pause_until(connection, now)
    return [
        [
            {"text": "Пауза на час", "callback_data": "pause:60"},
            {
                "text": f"Пауза до {format_local(connection, target)}",
                "callback_data": f"pause:until:{int(target.timestamp())}",
            },
        ],
    ]


def notification_markup(connection, events, now):
    keys = pause_buttons(connection, now)
    if events and len({event.issue_id for event in events}) == 1:
        keys.append([{"text": "Без обсуждений этой задачи", "callback_data": f"mute:{events[0].issue_id.hex}"}])
    return {"inline_keyboard": keys}


def refresh_delivery_keyboard(connection, message_id):
    delivery = connection.deliveries.filter(message_id=message_id, status="sent").first()
    if not delivery:
        return
    events = list(
        delivery.events.select_related(
            "issue__project", "issue__workspace", "comment__parent", "activity__actor"
        ).order_by("due_at", "created_at")
    )
    events = [e for e in events if accessible(connection, e.issue, e.comment)]
    try:
        bot_request(
            "editMessageReplyMarkup",
            {
                "chat_id": connection.telegram_id,
                "message_id": message_id,
                "reply_markup": notification_markup(connection, events, timezone.now()),
            },
        )
    except TelegramError as exc:
        # Telegram returns 400 when a repeated click leaves markup unchanged.
        if exc.code != "400":
            logging.getLogger(__name__).warning("Telegram keyboard refresh failed: %s", exc.code)


def event_is_valid(event, now):
    c, issue, comment = event.connection, event.issue, event.comment
    if not accessible(c, issue, comment):
        return False
    if not getattr(
        c, {"mention": "mentions", "reply": "replies", "assignment": "assignments", "comment": "comments"}[event.kind]
    ):
        return False
    if event.kind == "assignment" and not IssueAssignee.objects.filter(issue=issue, assignee_id=c.user_id).exists():
        return False
    if event.kind == "mention" and str(c.user_id) not in mention_ids(comment.comment_html):
        return False
    if event.kind == "comment":
        if TelegramMute.objects.filter(connection=c, issue=issue).exists():
            return False
        assigned = IssueAssignee.objects.filter(issue=issue, assignee_id=c.user_id).exists()
        watching = c.watching and (
            issue.created_by_id == c.user_id
            or IssueSubscriber.objects.filter(issue=issue, subscriber_id=c.user_id).exists()
        )
        if not (assigned or watching):
            return False
    if (
        comment
        and IssueCommentRead.objects.filter(
            comment=comment, user_id=c.user_id, read_at__gte=comment.updated_at
        ).exists()
    ):
        return False
    notification = Notification.objects.filter(
        receiver_id=c.user_id, entity_identifier=issue.id, data__issue_activity__id=str(event.activity_id)
    )
    if notification.filter(Q(read_at__isnull=False) | Q(archived_at__isnull=False)).exists():
        return False
    snooze = notification.filter(snoozed_till__gt=now).order_by("-snoozed_till").first()
    if snooze:
        event.due_at = snooze.snoozed_till
        event.save(update_fields=["due_at"])
        return None
    return True


def event_text(event):
    issue = event.issue
    name = f"{issue.project.identifier}-{issue.sequence_id} · {issue.name}"
    actor = event.activity.actor.display_name if event.activity.actor else "Участник"
    reason = {
        "assignment": "назначил(а) вам задачу",
        "mention": "упомянул(а) вас",
        "reply": "ответил(а) вам",
        "comment": "оставил(а) комментарий",
    }[event.kind]
    base = settings.WEB_URL or settings.APP_BASE_URL
    url = f"{base.rstrip('/')}/{issue.workspace.slug}/browse/{issue.project.identifier}-{issue.sequence_id}/"
    if event.comment_id:
        url += f"#comment-{event.comment_id}"
    text = (
        f"<b>{html.escape(actor[:80])}</b> {reason}\n"
        f'<a href="{html.escape(url, quote=True)}">{html.escape(name[:160])}</a>'
    )
    if event.comment:
        snippet = " ".join(html.unescape(event.comment.comment_stripped).split())[:240]
        text += f"\n{html.escape(snippet or 'Изображение или вложение — откройте комментарий')}"
    elif issue.target_date:
        text += f"\nСрок: {issue.target_date:%d.%m.%Y}"
    return text, url


def deliver_connection(connection_id):
    now = timezone.now()
    # A database row lock serializes scheduled workers, settings and callbacks.
    # Persist the claim before the network request: an ambiguous send is never
    # retried automatically, even if the worker dies after Telegram accepts it.
    with transaction.atomic():
        c = TelegramConnection.objects.select_for_update().select_related("user").get(pk=connection_id)
        recipients = settings.TELEGRAM_DELIVERY_USER_IDS
        if "*" not in recipients and str(c.user_id) not in recipients:
            return
        if not c.enabled or not c.confirmed_at or c.blocked_at:
            return
        if TelegramDelivery.objects.filter(connection=c, status="sending").exists():
            return
        allowed = next_allowed(c, now)
        if allowed > now:
            TelegramEvent.objects.filter(connection=c, status="pending", due_at__lt=allowed).update(due_at=allowed)
            return
        recent = TelegramDelivery.objects.filter(connection=c, created_at__gt=now - timedelta(minutes=30)).exclude(
            status="failed"
        )
        if recent.count() >= 5:
            due = recent.order_by("created_at").first().created_at + timedelta(minutes=30, seconds=1)
            TelegramEvent.objects.filter(connection=c, status="pending", due_at__lt=due).update(due_at=due)
            return
        events = list(
            TelegramEvent.objects.filter(connection=c, status="pending", due_at__lte=now)
            .select_related("issue__project", "issue__workspace", "comment__parent", "activity__actor")
            .order_by("due_at", "created_at")[:100]
        )
        selected, texts = [], []
        for event in events:
            event.connection = c
            valid = event_is_valid(event, now)
            if valid is False:
                event.status = "skipped"
                event.save(update_fields=["status"])
                continue
            if valid is None:
                continue
            text, _ = event_text(event)
            if sum(len(t) for t in texts) + len(text) > 3500:
                break
            selected.append(event)
            texts.append(f"<b>{len(selected)}.</b> {text}")
            if len(selected) >= 6:
                break
        if not selected:
            return
        delivery = TelegramDelivery.objects.create(connection=c)
        ids = [event.pk for event in selected]
        TelegramEvent.objects.filter(pk__in=ids).update(status="sending", delivery=delivery)
        payload = {
            "chat_id": c.telegram_id,
            "text": "\n\n".join(texts),
            "parse_mode": "HTML",
            "link_preview_options": {"is_disabled": True},
            "reply_markup": notification_markup(c, selected, now),
        }
    try:
        result = bot_request("sendMessage", payload)
    except TelegramError as exc:
        with transaction.atomic():
            c = TelegramConnection.objects.select_for_update().get(pk=connection_id)
            delivery.status = "unknown" if exc.code == "unknown" else "failed"
            delivery.error_code = exc.code
            delivery.save(update_fields=["status", "error_code"])
            if exc.code == "403":
                c.blocked_at = now
                c.save(update_fields=["blocked_at"])
            for event in selected:
                event.attempts += 1
                retry = (exc.code == "429" or exc.code.startswith("5")) and event.attempts < 5
                event.status = "pending" if retry and c.enabled and c.confirmed_at else delivery.status
                event.due_at = now + timedelta(seconds=max(exc.retry_after, 60 * 2 ** min(event.attempts, 6)))
                event.save(update_fields=["attempts", "status", "due_at"])
        return
    delivery.status = "sent"
    delivery.sent_at = timezone.now()
    delivery.message_id = result["message_id"]
    delivery.save(update_fields=["status", "sent_at", "message_id"])
    TelegramEvent.objects.filter(pk__in=ids).update(status="sent")


def handle_update(update):
    message = update.get("message", {})
    chat = message.get("chat", {})
    sender = message.get("from", {})
    if chat.get("type") == "private" and chat.get("id") == sender.get("id"):
        text = message.get("text", "")
        if text.startswith("/start "):
            with transaction.atomic():
                c = (
                    TelegramConnection.objects.select_for_update()
                    .filter(
                        token_hash=token_digest(text.split(" ", 1)[1]),
                        token_expires_at__gt=timezone.now(),
                    )
                    .first()
                )
                if c:
                    c.pending_id = sender["id"]
                    c.pending_name = (
                        "@" + sender["username"] if sender.get("username") else sender.get("first_name", "Telegram")
                    )[:255]
                    c.token_hash = ""  # consume once; confirmation happens in Plane
                    c.save(update_fields=["pending_id", "pending_name", "token_hash"])
            # No account data or workspace names are sent before confirmation.
            bot_request(
                "sendMessage",
                {
                    "chat_id": chat["id"],
                    "text": "Вернитесь в настройки Plane и подтвердите подключение Telegram."
                    if c
                    else "Ссылка истекла. Создайте новую в настройках уведомлений Plane.",
                },
            )
        elif text in ("/stop", "/pause", "/resume", "/start", "/settings", "/help"):
            c = TelegramConnection.objects.filter(telegram_id=sender["id"], confirmed_at__isnull=False).first()
            if text == "/stop" and c:
                with transaction.atomic():
                    c = TelegramConnection.objects.select_for_update().get(pk=c.pk)
                    c.enabled = False
                    c.save(update_fields=["enabled"])
                    c.events.filter(status="pending").update(status="skipped")
            elif text in ("/pause", "/resume") and c:
                with transaction.atomic():
                    c = TelegramConnection.objects.select_for_update().get(pk=c.pk)
                    if text == "/resume":
                        resume_connection(c, timezone.now())
                    else:
                        c.paused_until = timezone.now() + timedelta(hours=1)
                        c.save(update_fields=["paused_until"])
            if c:
                response = pause_status(c, timezone.now())
                markup = {"inline_keyboard": pause_buttons(c, timezone.now())}
            else:
                response = "Подключите Telegram в настройках уведомлений Plane."
                markup = {"inline_keyboard": []}
            bot_request("sendMessage", {"chat_id": chat["id"], "text": response, "reply_markup": markup})
    callback = update.get("callback_query")
    if not callback:
        return
    callback_chat = callback.get("message", {}).get("chat", {})
    sender_id = callback.get("from", {}).get("id")
    if callback_chat.get("type") != "private" or callback_chat.get("id") != sender_id:
        return
    response = "Подключите Telegram в Plane."
    with transaction.atomic():
        c = (
            TelegramConnection.objects.select_for_update()
            .filter(telegram_id=sender_id, confirmed_at__isnull=False)
            .first()
        )
        if c:
            action = callback.get("data", "")
            now = timezone.now()
            if action == "pause:resume":
                resume_connection(c, now)
                response = pause_status(c, now)
            elif action == "pause:status":
                response = pause_status(c, now)
            elif action in ("pause:60", "pause:tomorrow") or action.startswith("pause:until:"):
                until = now + timedelta(hours=1)
                if action == "pause:tomorrow":
                    until = next_day_pause_until(c, now)
                elif action.startswith("pause:until:"):
                    try:
                        until = datetime.fromtimestamp(int(action.rsplit(":", 1)[1]), tz=datetime_timezone.utc)
                    except (ValueError, OverflowError, OSError):
                        until = now
                if now < until <= now + timedelta(days=8):
                    c.paused_until = until
                    c.save(update_fields=["paused_until"])
                    response = pause_status(c, now)
                else:
                    response = "Это время уже прошло. Кнопки обновлены — выберите новую паузу."
            elif action.startswith("mute:"):
                # Only mute an issue that this account has actually received.
                event = (
                    c.events.filter(issue_id=action[5:], status="sent").select_related("issue__project").first()
                    if len(action[5:]) == 32 and all(ch in "0123456789abcdef" for ch in action[5:])
                    else None
                )
                if event and accessible(c, event.issue):
                    TelegramMute.objects.get_or_create(connection=c, issue=event.issue)
                    response = "Обсуждения выключены. Упоминания и ответы останутся."
    bot_request(
        "answerCallbackQuery", {"callback_query_id": callback["id"], "text": response[:200], "show_alert": True}
    )
    if c:
        message_id = callback.get("message", {}).get("message_id")
        delivery = c.deliveries.filter(message_id=message_id, status="sent").first()
        if delivery:
            refresh_delivery_keyboard(c, message_id)
        elif message_id:
            bot_request(
                "editMessageReplyMarkup",
                {
                    "chat_id": c.telegram_id,
                    "message_id": message_id,
                    "reply_markup": {"inline_keyboard": pause_buttons(c, timezone.now())},
                },
            )
