import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from plane.db.models import TelegramBotState, TelegramConnection, TelegramDelivery, TelegramEvent
from plane.utils.telegram import TelegramError, bot_request, deliver_connection, handle_update

logger = logging.getLogger(__name__)


@shared_task
def dispatch_telegram():
    if not settings.TELEGRAM_ENABLED:
        return
    # Recover a worker crash without blindly repeating a possibly accepted send.
    stale = TelegramDelivery.objects.filter(status="sending", created_at__lt=timezone.now() - timedelta(minutes=5))
    TelegramEvent.objects.filter(delivery__in=stale, status="sending").update(status="unknown")
    stale.update(status="unknown", error_code="worker_interrupted")
    ids = (
        TelegramConnection.objects.filter(
            enabled=True,
            confirmed_at__isnull=False,
            blocked_at__isnull=True,
            events__status="pending",
            events__due_at__lte=timezone.now(),
        )
        .values_list("id", flat=True)
        .distinct()[:100]
    )
    for connection_id in ids:
        deliver_connection(connection_id)


def poll_telegram_once():
    # Lock the cursor to prevent two local pollers handling an update twice.
    bot_id = int(settings.TELEGRAM_BOT_TOKEN.split(":", 1)[0])
    TelegramBotState.objects.get_or_create(bot_id=bot_id)
    with transaction.atomic():
        state = TelegramBotState.objects.select_for_update().get(bot_id=bot_id)
        updates = bot_request(
            "getUpdates", {"offset": state.offset, "timeout": 0, "allowed_updates": ["message", "callback_query"]}
        )
        for update in updates:
            try:
                handle_update(update)
            except TelegramError as exc:
                # A failed acknowledgement must not replay a consumed link.
                logger.warning("Telegram acknowledgement failed: %s", exc.code)
            state.offset = max(state.offset, update["update_id"] + 1)
            state.save(update_fields=["offset"])
