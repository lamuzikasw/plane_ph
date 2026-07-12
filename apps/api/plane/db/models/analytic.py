# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django models
from django.db import models

from .base import BaseModel


class AnalyticView(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="analytics", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    query = models.JSONField()
    query_dict = models.JSONField(default=dict)

    class Meta:
        verbose_name = "Analytic"
        verbose_name_plural = "Analytics"
        db_table = "analytic_views"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the analytic view"""
        return f"{self.name} <{self.workspace.name}>"


def get_default_management_analytics_config():
    return {
        "estimation_unit": "points",
        "default_weekly_capacity": 30,
        "member_weekly_capacity": {},
        "low_utilization_threshold": 70,
        "high_utilization_threshold": 90,
        "overload_threshold": 110,
        "estimate_accuracy_min": 80,
        "estimate_accuracy_max": 120,
        "stale_work_days": 3,
        "max_wip_age_days": 5,
        "working_days": [0, 1, 2, 3, 4],
        "review_state_groups": ["started"],
        "testing_state_groups": ["started"],
        "overview_hidden_kpis": [],
        "required_issue_fields": [
            "assignee",
            "estimate",
            "start_date",
            "target_date",
            "priority",
        ],
        "large_task_estimate_threshold": 8,
        "unplanned_work": {
            "label_ids": [],
            "sources": ["incident", "support"],
            "cycle_rule": "added_after_cycle_start",
        },
        "risk_weights": {
            "overdue_ratio": 3,
            "blocked_work": 2,
            "overloaded_member": 2,
            "missing_estimate_ratio": 1,
            "stale_project": 1,
            "scope_growth": 1,
            "forecast_delay": 1,
            "bus_factor": 1,
        },
        "risk_thresholds": {
            "medium": 3,
            "high": 6,
            "overdue_ratio": 20,
            "missing_estimate_ratio": 20,
            "stale_project_days": 3,
            "scope_growth": 15,
            "bus_factor_ratio": 30,
        },
    }


class ManagementAnalyticsSettings(BaseModel):
    workspace = models.OneToOneField(
        "db.Workspace",
        related_name="management_analytics_settings",
        on_delete=models.CASCADE,
    )
    config = models.JSONField(default=get_default_management_analytics_config)

    class Meta:
        verbose_name = "Management Analytics Settings"
        verbose_name_plural = "Management Analytics Settings"
        db_table = "management_analytics_settings"
        ordering = ("-created_at",)

    def __str__(self):
        return f"Management analytics settings <{self.workspace.name}>"
