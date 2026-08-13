# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import Count
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectEntityPermission
from plane.app.serializers import RecurringIssueScheduleSerializer
from plane.db.models import Project, RecurringIssueSchedule

from .base import BaseViewSet


class RecurringIssueScheduleViewSet(BaseViewSet):
    model = RecurringIssueSchedule
    serializer_class = RecurringIssueScheduleSerializer
    permission_classes = [ProjectEntityPermission]

    def get_queryset(self):
        queryset = (
            RecurringIssueSchedule.objects.filter(
                workspace__slug=self.kwargs.get("slug"),
                project_id=self.kwargs.get("project_id"),
            )
            .select_related("source_issue", "project")
            .annotate(occurrence_count=Count("occurrences"))
        )
        source_issue_id = self.request.query_params.get("source_issue_id")
        return queryset.filter(source_issue_id=source_issue_id) if source_issue_id else queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["project"] = Project.objects.get(
            id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )
        return context

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        self.get_object().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
