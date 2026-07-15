# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response

from plane.app.analytics.management import (
    MANAGEMENT_ANALYTICS_SECTIONS,
    ManagementAnalyticsService,
    ManagementAnalyticsValidationError,
)
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView


class ManagementAnalyticsEndpoint(BaseAPIView):
    @allow_permission([ROLE.SUPER_ADMIN], level="WORKSPACE")
    def get(self, request, slug, section):
        if section not in MANAGEMENT_ANALYTICS_SECTIONS:
            return Response({"error": "Invalid analytics section"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
            return Response(service.section(section), status=status.HTTP_200_OK)
        except ManagementAnalyticsValidationError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)


class ManagementAnalyticsDrilldownEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        metric = request.GET.get("metric")
        if not metric:
            return Response({"error": "metric is required"}, status=status.HTTP_400_BAD_REQUEST)

        workspace_role = (
            request.user.member_workspace.filter(
                workspace__slug=slug,
                is_active=True,
            )
            .values_list("role", flat=True)
            .first()
        )
        if workspace_role != ROLE.SUPER_ADMIN.value:
            personal_metrics = {"active_work_items", "blocked_work_items"}
            requested_members = {value for value in request.GET.get("member_ids", "").split(",") if value}
            if metric not in personal_metrics or requested_members != {str(request.user.id)}:
                return Response(
                    {"error": "Management analytics is available only to OG users"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
            return Response(service.drilldown(metric), status=status.HTTP_200_OK)
        except ManagementAnalyticsValidationError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)


class ManagementAnalyticsSettingsEndpoint(BaseAPIView):
    @allow_permission([ROLE.SUPER_ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        try:
            service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
            return Response(service.get_settings(), status=status.HTTP_200_OK)
        except ManagementAnalyticsValidationError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.SUPER_ADMIN], level="WORKSPACE")
    def patch(self, request, slug):
        try:
            service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
            return Response(service.update_settings(request.data), status=status.HTTP_200_OK)
        except ManagementAnalyticsValidationError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)


class ManagementAnalyticsExportEndpoint(BaseAPIView):
    @allow_permission([ROLE.SUPER_ADMIN], level="WORKSPACE")
    def get(self, request, slug, section):
        if section not in MANAGEMENT_ANALYTICS_SECTIONS:
            return Response({"error": "Invalid analytics section"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
            content = service.export_csv(section)
        except ManagementAnalyticsValidationError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        response = HttpResponse(content, content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{slug}-{section}-analytics.csv"'
        return response
