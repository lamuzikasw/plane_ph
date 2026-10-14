from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import TelegramQuietPeriod, WorkspaceMember


class QuietPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = TelegramQuietPeriod
        fields = ["id", "recipient", "started_at", "expires_at", "stopped_at"]
        read_only_fields = fields


class StartQuietPeriodSerializer(serializers.Serializer):
    recipient = serializers.UUIDField()


class TelegramQuietPeriodsEndpoint(BaseAPIView):
    """Workspace admins may silence only their own future edits, for one hour."""

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        members = WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).select_related("member")
        periods = TelegramQuietPeriod.objects.filter(
            workspace__slug=slug, actor=request.user, stopped_at__isnull=True, expires_at__gt=timezone.now()
        ).order_by("started_at")
        return Response(
            {
                "periods": QuietPeriodSerializer(periods, many=True).data,
                "members": [
                    {"id": str(m.member_id), "name": m.member.display_name or m.member.first_name or str(m.member_id)}
                    for m in members
                    if m.member_id != request.user.id
                ],
            }
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        serializer = StartQuietPeriodSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Serialize repeated clicks without changing another admin's scope.
            membership = WorkspaceMember.objects.select_for_update().get(
                workspace__slug=slug, member=request.user, is_active=True
            )
            if membership.role < ROLE.ADMIN.value:
                return Response(status=403)
            recipient = serializer.validated_data["recipient"]
            if (
                recipient == request.user.id
                or not WorkspaceMember.objects.filter(
                    workspace_id=membership.workspace_id, member_id=recipient, is_active=True
                ).exists()
            ):
                return Response({"error": "Choose another active workspace member."}, status=400)
            now = timezone.now()
            period = TelegramQuietPeriod.objects.filter(
                workspace_id=membership.workspace_id,
                actor=request.user,
                recipient_id=recipient,
                stopped_at__isnull=True,
                expires_at__gt=now,
            ).first()
            if not period:
                period = TelegramQuietPeriod.objects.create(
                    workspace_id=membership.workspace_id,
                    actor=request.user,
                    recipient_id=recipient,
                    started_at=now.replace(microsecond=0),
                    expires_at=now + timedelta(hours=1),
                )
        return Response(QuietPeriodSerializer(period).data)


class TelegramQuietPeriodDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk):
        # Keep the record for delayed workers; stopping is idempotent.
        period = TelegramQuietPeriod.objects.filter(pk=pk, workspace__slug=slug, actor=request.user)
        if not period.exists():
            return Response(status=404)
        period.filter(stopped_at__isnull=True).update(stopped_at=timezone.now())
        return Response(status=204)
