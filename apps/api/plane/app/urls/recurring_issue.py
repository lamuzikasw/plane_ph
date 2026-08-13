# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from plane.app.views import RecurringIssueScheduleViewSet


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/recurring-work-items/",
        RecurringIssueScheduleViewSet.as_view({"get": "list", "post": "create"}),
        name="recurring-work-items",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/recurring-work-items/<uuid:pk>/",
        RecurringIssueScheduleViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="recurring-work-item-detail",
    ),
]
