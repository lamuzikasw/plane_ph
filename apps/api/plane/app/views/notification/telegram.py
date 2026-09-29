from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import TelegramConnection, TelegramMute
from plane.utils.telegram import accessible, begin_link, next_day_pause_until, resume_connection


class TelegramSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = TelegramConnection
        fields = [
            "enabled",
            "assignments",
            "mentions",
            "replies",
            "comments",
            "watching",
            "scheduled",
            "timezone",
            "weekdays_only",
            "start_hour",
            "end_hour",
        ]

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError("Unknown timezone.")
        return value

    def validate(self, attrs):
        start = attrs.get("start_hour", self.instance.start_hour)
        end = attrs.get("end_hour", self.instance.end_hour)
        if not 0 <= start < end <= 23:
            raise serializers.ValidationError("Working hours must be between 00:00 and 23:00, with start before end.")
        return attrs


def connection_data(c):
    pending = c.pending_id is not None and c.token_expires_at and c.token_expires_at > timezone.now()
    deliveries = list(c.deliveries.order_by("-created_at").values("id", "created_at", "status", "error_code")[:5])
    mutes = []
    for mute in TelegramMute.objects.filter(connection=c).select_related("issue__project"):
        if accessible(c, mute.issue):
            mutes.append(
                {
                    "issue_id": str(mute.issue_id),
                    "name": f"{mute.issue.project.identifier}-{mute.issue.sequence_id} · {mute.issue.name}",
                }
            )
    return {
        **TelegramSettingsSerializer(c).data,
        "available": bool(settings.TELEGRAM_ENABLED and settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_BOT_USERNAME),
        "connected": bool(c.confirmed_at),
        "telegram_name": c.telegram_name,
        "pending_name": c.pending_name if pending else None,
        "pending_id": str(c.pending_id) if pending else None,
        "blocked": bool(c.blocked_at),
        "paused_until": c.paused_until,
        "next_day_pause_until": next_day_pause_until(c, timezone.now()),
        "queued_count": c.events.filter(status="pending").count(),
        "deliveries": deliveries,
        "mutes": mutes,
    }


class TelegramSettingsEndpoint(BaseAPIView):
    def get(self, request):
        c, _ = TelegramConnection.objects.get_or_create(user=request.user)
        return Response(connection_data(c))

    def patch(self, request):
        with transaction.atomic():
            c, _ = TelegramConnection.objects.get_or_create(user=request.user)
            c = TelegramConnection.objects.select_for_update().get(pk=c.pk)
            serializer = TelegramSettingsSerializer(c, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            if not c.enabled:
                c.events.filter(status="pending").update(status="skipped")
        return Response(connection_data(c))

    def post(self, request):
        action = request.data.get("action")
        with transaction.atomic():
            c, _ = TelegramConnection.objects.get_or_create(user=request.user)
            c = TelegramConnection.objects.select_for_update().get(pk=c.pk)
            if action == "link":
                if not (settings.TELEGRAM_ENABLED and settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_BOT_USERNAME):
                    return Response({"error": "Telegram is not configured."}, status=503)
                return Response({"url": begin_link(c)})
            if action == "confirm":
                if (
                    not c.pending_id
                    or not c.token_expires_at
                    or c.token_expires_at <= timezone.now()
                    or str(c.pending_id) != request.data.get("pending_id")
                ):
                    return Response({"error": "Link expired. Start again."}, status=400)
                if TelegramConnection.objects.exclude(pk=c.pk).filter(telegram_id=c.pending_id).exists():
                    return Response({"error": "Telegram is already linked to another account."}, status=409)
                c.telegram_id = c.pending_id
                c.telegram_name = c.pending_name
                c.confirmed_at = timezone.now()
                c.blocked_at = None
                c.enabled = True
                c.token_hash, c.pending_name = "", ""
                c.pending_id, c.token_expires_at = None, None
                c.events.filter(status="pending").update(status="skipped")
                try:
                    with transaction.atomic():
                        c.save()
                except IntegrityError:
                    return Response({"error": "Telegram is already linked to another account."}, status=409)
            elif action in ("pause", "resume"):
                duration = request.data.get("duration", "hour")
                if duration not in ("hour", "tomorrow"):
                    return Response(status=status.HTTP_400_BAD_REQUEST)
                now = timezone.now()
                until = now + timedelta(hours=1)
                if duration == "tomorrow":
                    until = (
                        serializers.DateTimeField().run_validation(request.data["until"])
                        if request.data.get("until")
                        else next_day_pause_until(c, now)
                    )
                    if not now < until <= now + timedelta(days=8):
                        return Response({"error": "Pause time expired. Refresh settings."}, status=400)
                if action == "resume":
                    resume_connection(c, now)
                else:
                    c.paused_until = until
                    c.save(update_fields=["paused_until"])
            elif action == "unmute":
                issue_id = serializers.UUIDField().run_validation(request.data.get("issue_id"))
                TelegramMute.objects.filter(connection=c, issue_id=issue_id).delete()
            else:
                return Response({"error": "Unknown action."}, status=400)
        return Response(connection_data(c))

    def delete(self, request):
        with transaction.atomic():
            c = TelegramConnection.objects.select_for_update().filter(user=request.user).first()
            if c:
                c.events.filter(status="pending").update(status="skipped")
                c.telegram_id = c.pending_id = c.confirmed_at = c.token_expires_at = c.blocked_at = None
                c.telegram_name = c.pending_name = c.token_hash = ""
                c.enabled = False
                c.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
