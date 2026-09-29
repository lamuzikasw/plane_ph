import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from plane.bgtasks.telegram_task import dispatch_telegram, poll_telegram_once
from plane.utils.telegram import TelegramError, bot_request


class Command(BaseCommand):
    help = "Run Telegram polling and dispatch; use one process per bot. Does not change existing webhooks."

    def handle(self, *args, **options):
        if not settings.TELEGRAM_ENABLED or not settings.TELEGRAM_BOT_TOKEN:
            raise CommandError("Configure TELEGRAM_ENABLED and TELEGRAM_BOT_TOKEN.")
        try:
            if bot_request("getWebhookInfo").get("url"):
                raise CommandError("This bot already has a webhook. Use a separate development bot.")
            bot = bot_request("getMe")
        except TelegramError as exc:
            raise CommandError(str(exc)) from None
        self.stdout.write(f"Telegram worker ready: @{bot['username']}")
        while True:
            try:
                poll_telegram_once()
                dispatch_telegram()
            except TelegramError as exc:
                self.stderr.write(str(exc))
                time.sleep(max(5, min(exc.retry_after, 60)))
            time.sleep(2)
