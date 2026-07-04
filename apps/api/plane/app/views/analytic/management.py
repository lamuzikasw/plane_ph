# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response

from plane.app.analytics.management import ManagementAnalyticsService
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView


class ManagementAnalyticsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, section):
        service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
        section_map = {
            "overview": service.overview,
            "team": service.team,
            "projects": service.projects,
            "workload": service.workload,
            "delivery": service.delivery,
            "risks": service.risks,
            "data-quality": service.data_quality,
        }
        if section not in section_map:
            return Response({"error": "Invalid analytics section"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(section_map[section](), status=status.HTTP_200_OK)


class ManagementAnalyticsSettingsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
        return Response(service.get_settings(), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug):
        service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
        return Response(service.update_settings(request.data), status=status.HTTP_200_OK)


class ManagementAnalyticsExportEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, section):
        service = ManagementAnalyticsService(workspace_slug=slug, params=request.GET)
        content = service.export_csv(section)
        response = HttpResponse(content, content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{slug}-{section}-analytics.csv"'
        return response
