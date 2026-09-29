import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class TelegramConnection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    telegram_id = models.BigIntegerField(null=True, unique=True)
    telegram_name = models.CharField(max_length=255, blank=True)
    confirmed_at = models.DateTimeField(null=True)
    blocked_at = models.DateTimeField(null=True)
    token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    token_expires_at = models.DateTimeField(null=True)
    pending_id = models.BigIntegerField(null=True)
    pending_name = models.CharField(max_length=255, blank=True)
    enabled = models.BooleanField(default=True)
    assignments = models.BooleanField(default=True)
    mentions = models.BooleanField(default=True)
    replies = models.BooleanField(default=True)
    comments = models.BooleanField(default=True)
    watching = models.BooleanField(default=False)
    scheduled = models.BooleanField(default=True)
    timezone = models.CharField(max_length=64, default="Europe/Moscow")
    weekdays_only = models.BooleanField(default=True)
    start_hour = models.PositiveSmallIntegerField(default=10)
    end_hour = models.PositiveSmallIntegerField(default=19)
    paused_until = models.DateTimeField(null=True)

    class Meta:
        db_table = "telegram_connections"


class TelegramDelivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    connection = models.ForeignKey(TelegramConnection, on_delete=models.CASCADE, related_name="deliveries")
    created_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, db_index=True)
    status = models.CharField(max_length=20, default="sending")
    message_id = models.BigIntegerField(null=True)
    error_code = models.CharField(max_length=40, blank=True)

    class Meta:
        db_table = "telegram_deliveries"


class TelegramEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    connection = models.ForeignKey(TelegramConnection, on_delete=models.CASCADE, related_name="events")
    activity = models.ForeignKey("db.IssueActivity", on_delete=models.CASCADE)
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE)
    comment = models.ForeignKey("db.IssueComment", null=True, on_delete=models.CASCADE)
    delivery = models.ForeignKey(TelegramDelivery, null=True, on_delete=models.SET_NULL, related_name="events")
    dedup_key = models.CharField(max_length=120)
    kind = models.CharField(max_length=20)
    created_at = models.DateTimeField(default=timezone.now)
    due_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=20, default="pending", db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "telegram_events"
        constraints = [models.UniqueConstraint(fields=["connection", "dedup_key"], name="telegram_event_dedup")]


class TelegramMute(models.Model):
    connection = models.ForeignKey(TelegramConnection, on_delete=models.CASCADE)
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE)

    class Meta:
        db_table = "telegram_mutes"
        constraints = [models.UniqueConstraint(fields=["connection", "issue"], name="telegram_mute_unique")]


class TelegramBotState(models.Model):
    # A durable getUpdates cursor, scoped to the bot (never store its token).
    bot_id = models.BigIntegerField(primary_key=True)
    offset = models.BigIntegerField(default=0)
