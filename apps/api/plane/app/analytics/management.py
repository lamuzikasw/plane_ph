# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import csv
import io
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as datetime_timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from django.db.models import Count, Max, Q
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueRelation,
    ManagementAnalyticsSettings,
    Project,
    ProjectMember,
    State,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.analytic import get_default_management_analytics_config


OPEN_STATE_GROUPS = ["backlog", "unstarted", "started"]
DONE_STATE_GROUPS = ["completed", "cancelled"]
MANAGEMENT_ANALYTICS_SECTIONS = {
    "overview",
    "team",
    "projects",
    "workload",
    "delivery",
    "risks",
    "data-quality",
}
MANAGEMENT_ANALYTICS_PERIODS = {
    "current_week",
    "previous_week",
    "last_14_days",
    "last_30_days",
    "current_month",
    "previous_month",
    "current_quarter",
    "custom",
}
MANAGEMENT_ANALYTICS_DRILLDOWN_METRICS = {
    "active_work_items",
    "work_items_in_progress",
    "work_items_in_review",
    "blocked_work_items",
    "overdue_work_items",
    "unassigned_work_items",
    "unestimated_work_items",
    "unscheduled_work_items",
    "completed_work_items",
    "throughput",
    "on_time_delivery_percent",
    "lead_time_hours",
    "cycle_time_hours",
    "reopened_work_items",
    "missing_assignee",
    "missing_module",
    "missing_type",
    "missing_estimate",
    "missing_start_date",
    "missing_target_date",
    "missing_priority",
    "started_without_assignee",
    "blocked_without_reason",
    "stale_work_items",
    "large_work_items",
    "invalid_dates",
    "active_members",
    "average_team_workload_percent",
    "overloaded_members",
    "members_with_capacity",
    "active_projects",
    "high",
    "medium",
    "low",
    "high_risk_projects",
    "average_cycle_time_hours",
}


class ManagementAnalyticsValidationError(ValueError):
    pass


@dataclass(frozen=True)
class PeriodRange:
    start: datetime
    end: datetime
    previous_start: datetime
    previous_end: datetime
    key: str


class ManagementAnalyticsService:
    def __init__(self, workspace_slug: str, params: dict[str, Any] | None = None):
        self.workspace = Workspace.objects.get(slug=workspace_slug)
        self.params = params or {}
        self.timezone = ZoneInfo(self.workspace.timezone or "UTC")
        self.period = self._resolve_period()
        self.settings = self.get_settings()

    def get_settings(self) -> dict[str, Any]:
        settings, _ = ManagementAnalyticsSettings.objects.get_or_create(workspace=self.workspace)
        defaults = get_default_management_analytics_config()
        return self._deep_merge(defaults, settings.config or {})

    def update_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._validate_settings_update(payload)
        settings, _ = ManagementAnalyticsSettings.objects.get_or_create(workspace=self.workspace)
        settings.config = self._deep_merge(settings.config or get_default_management_analytics_config(), payload)
        settings.save()
        self.settings = self._deep_merge(get_default_management_analytics_config(), settings.config)
        return self.settings

    def overview(self) -> dict[str, Any]:
        current = self._filtered_issues()
        previous = self._filtered_issues(period="previous")
        snapshot = self._filtered_issues(include_period=False)
        now = timezone.now()
        open_current = current.filter(state__group__in=OPEN_STATE_GROUPS)
        blocked_current = self._blocked_issues(snapshot)
        overdue_current = current.filter(state__group__in=OPEN_STATE_GROUPS, target_date__lt=now)
        completed_current = current.filter(state__group="completed", completed_at__isnull=False)
        completed_previous = previous.filter(state__group="completed", completed_at__isnull=False)
        team_rows = self.team()["results"]
        project_rows = self.projects()["results"]
        risk_high = len([project for project in project_rows if project["risk"]["level"] == "high"])
        avg_workload = self._average([row["workload"]["percent"] for row in team_rows])

        return {
            "period": self._period_payload(),
            "history": self._history_payload(),
            "kpis": [
                self._kpi("active_members", self._active_members_count(), None, "workspace_member"),
                self._kpi("active_projects", self._active_projects_count(), None, "project"),
                self._kpi("work_items_in_progress", open_current.filter(state__group="started").count(), None, "issue"),
                self._kpi("work_items_in_review", self._review_issues(current).count(), None, "issue"),
                self._kpi("blocked_work_items", blocked_current.count(), None, "issue"),
                self._kpi("overdue_work_items", overdue_current.count(), None, "issue"),
                self._kpi(
                    "unassigned_work_items",
                    open_current.filter(assignees__isnull=True).distinct().count(),
                    None,
                    "issue",
                ),
                self._kpi(
                    "unestimated_work_items",
                    open_current.filter(Q(point__isnull=True) & Q(estimate_point__isnull=True)).count(),
                    None,
                    "issue",
                ),
                self._kpi(
                    "unscheduled_work_items", open_current.filter(target_date__isnull=True).count(), None, "issue"
                ),
                self._kpi("completed_work_items", completed_current.count(), completed_previous.count(), "issue"),
                self._kpi(
                    "average_cycle_time_hours",
                    self._cycle_time_hours(current),
                    self._cycle_time_hours(previous),
                    "issue",
                    value_type="duration",
                ),
                self._kpi(
                    "on_time_delivery_percent",
                    self._on_time_delivery(current),
                    self._on_time_delivery(previous),
                    "issue",
                    value_type="percent",
                ),
                self._kpi("average_team_workload_percent", avg_workload, None, "member", value_type="percent"),
                self._kpi("high_risk_projects", risk_high, None, "project"),
            ],
            "attention": self._attention_items(team_rows, project_rows, current),
            "team_snapshot": team_rows[:10],
            "project_health": project_rows[:10],
        }

    def drilldown(self, metric: str) -> dict[str, Any]:
        if metric not in MANAGEMENT_ANALYTICS_DRILLDOWN_METRICS:
            raise ManagementAnalyticsValidationError("Unknown analytics metric")
        current = self._filtered_issues()
        snapshot = self._filtered_issues(include_period=False)
        now = timezone.now()
        open_current = current.filter(state__group__in=OPEN_STATE_GROUPS)
        all_open = snapshot.filter(state__group__in=OPEN_STATE_GROUPS)

        issue_metrics = {
            "active_work_items": all_open,
            "work_items_in_progress": open_current.filter(state__group="started"),
            "work_items_in_review": self._review_issues(current),
            "blocked_work_items": self._blocked_issues(snapshot),
            "overdue_work_items": open_current.filter(target_date__lt=now),
            "unassigned_work_items": open_current.filter(assignees__isnull=True).distinct(),
            "unestimated_work_items": open_current.filter(Q(point__isnull=True) & Q(estimate_point__isnull=True)),
            "unscheduled_work_items": open_current.filter(target_date__isnull=True),
            "completed_work_items": current.filter(state__group="completed", completed_at__isnull=False),
            "throughput": current.filter(state__group="completed", completed_at__isnull=False),
            "on_time_delivery_percent": current.filter(
                state__group="completed",
                completed_at__isnull=False,
                target_date__isnull=False,
                completed_at__lte=models_f("target_date"),
            ),
            "lead_time_hours": current.filter(state__group="completed", completed_at__isnull=False),
            "cycle_time_hours": current.filter(state__group="completed", completed_at__isnull=False),
            "reopened_work_items": self._reopened_issues(),
            "missing_assignee": snapshot.filter(state__group__in=OPEN_STATE_GROUPS, assignees__isnull=True).distinct(),
            "missing_module": snapshot.filter(issue_module__isnull=True).distinct(),
            "missing_type": snapshot.filter(type__isnull=True),
            "missing_estimate": snapshot.filter(Q(point__isnull=True) & Q(estimate_point__isnull=True)),
            "missing_start_date": snapshot.filter(start_date__isnull=True),
            "missing_target_date": snapshot.filter(target_date__isnull=True),
            "missing_priority": snapshot.filter(Q(priority__isnull=True) | Q(priority="none")),
            "started_without_assignee": snapshot.filter(state__group="started", assignees__isnull=True).distinct(),
            "blocked_without_reason": self._blocked_issues(snapshot),
            "stale_work_items": snapshot.filter(
                state__group__in=OPEN_STATE_GROUPS,
                updated_at__lt=now - timedelta(days=self.settings["stale_work_days"]),
            ),
            "large_work_items": snapshot.filter(point__gt=self.settings["large_task_estimate_threshold"]),
            "invalid_dates": snapshot.filter(
                start_date__isnull=False,
                target_date__isnull=False,
                target_date__lt=models_f("start_date"),
            ),
        }

        if metric == "active_members":
            rows = self.team()["results"]
            return {
                "metric": metric,
                "entity": "member",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric == "average_team_workload_percent":
            rows = sorted(self.team()["results"], key=lambda row: row["workload"]["percent"] or 0, reverse=True)
            return {
                "metric": metric,
                "entity": "member",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric == "overloaded_members":
            rows = [row for row in self.team()["results"] if self._is_overloaded(row["workload"]["percent"])]
            return {
                "metric": metric,
                "entity": "member",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric == "members_with_capacity":
            rows = [row for row in self.team()["results"] if row["workload"]["level"] == "available"]
            return {
                "metric": metric,
                "entity": "member",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric == "active_projects":
            rows = self.projects()["results"]
            return {
                "metric": metric,
                "entity": "project",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric in ["high", "medium", "low"]:
            rows = [project for project in self.projects()["results"] if project["risk"]["level"] == metric]
            return {
                "metric": metric,
                "entity": "project",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric == "high_risk_projects":
            rows = [project for project in self.projects()["results"] if project["risk"]["level"] == "high"]
            return {
                "metric": metric,
                "entity": "project",
                "period": self._period_payload(),
                "count": len(rows),
                "rows": rows,
            }

        if metric == "average_cycle_time_hours":
            queryset = current.filter(state__group="completed", completed_at__isnull=False)
            return {
                "metric": metric,
                "entity": "issue",
                "period": self._period_payload(),
                "count": queryset.count(),
                "rows": [
                    self._issue_drilldown_payload(issue, now) for issue in self._issue_queryset_for_drilldown(queryset)
                ],
            }

        queryset = issue_metrics.get(metric)
        if queryset is None:
            return {"metric": metric, "entity": "unknown", "period": self._period_payload(), "count": 0, "rows": []}

        return {
            "metric": metric,
            "entity": "issue",
            "period": self._period_payload(),
            "count": queryset.count(),
            "rows": [
                self._issue_drilldown_payload(issue, now) for issue in self._issue_queryset_for_drilldown(queryset)
            ],
        }

    def team(self) -> dict[str, Any]:
        issues = self._filtered_issues(include_period=False)
        period_issues = self._filtered_issues()
        blocked_ids = set(self._blocked_issues(issues).values_list("id", flat=True))
        now = timezone.now()
        rows = []

        members = (
            WorkspaceMember.objects.filter(workspace=self.workspace, is_active=True, member__is_bot=False)
            .select_related("member")
            .order_by("member__display_name", "member__email")
        )
        for workspace_member in members:
            member = workspace_member.member
            assigned = issues.filter(assignees=member).distinct()
            active = assigned.filter(state__group__in=OPEN_STATE_GROUPS)
            period_completed = period_issues.filter(assignees=member, state__group="completed").distinct()
            project_ids = list(active.values_list("project_id", flat=True).distinct())
            estimate = self._estimate_sum(active)
            capacity = self._member_capacity(member.id)
            workload_percent = round((estimate / capacity) * 100, 1) if capacity else None
            latest = assigned.aggregate(last=Max("updated_at"))["last"]
            main_issue = active.order_by("-priority", "target_date", "-updated_at").first()

            rows.append(
                {
                    "id": str(member.id),
                    "display_name": member.display_name or member.email,
                    "email": member.email,
                    "role": workspace_member.role,
                    "avatar_url": member.avatar_url,
                    "main_work_item": self._issue_payload(main_issue),
                    "active_projects": len(project_ids),
                    "active_project_ids": [str(project_id) for project_id in project_ids],
                    "active_work_items": active.count(),
                    "review_work_items": self._review_issues(active).count(),
                    "blocked_work_items": active.filter(id__in=blocked_ids).count(),
                    "overdue_work_items": active.filter(target_date__lt=now).count(),
                    "completed_work_items": period_completed.count(),
                    "planned_work": estimate,
                    "actual_work": None,
                    "cycle_time_hours": self._cycle_time_hours(period_completed),
                    "on_time_delivery_percent": self._on_time_delivery(period_completed),
                    "estimate_accuracy_percent": None,
                    "last_updated_at": latest.isoformat() if latest else None,
                    "workload": self._workload_payload(workload_percent, capacity, estimate),
                    "history_status": "partial",
                }
            )

        return {"period": self._period_payload(), "results": rows, "count": len(rows)}

    def projects(self) -> dict[str, Any]:
        rows = []
        issues = self._filtered_issues(include_period=False)
        period_issues = self._filtered_issues()
        blocked_ids = set(self._blocked_issues(issues).values_list("id", flat=True))
        now = timezone.now()

        for project in Project.objects.filter(workspace=self.workspace).select_related(
            "project_lead", "default_assignee"
        ):
            project_issues = issues.filter(project=project)
            period_project_issues = period_issues.filter(project=project)
            total = project_issues.count()
            completed = project_issues.filter(state__group__in=DONE_STATE_GROUPS).count()
            total_estimate = self._estimate_sum(project_issues)
            completed_estimate = self._estimate_sum(project_issues.filter(state__group__in=DONE_STATE_GROUPS))
            progress_method = "estimate" if total_estimate else "count"
            progress = (
                round((completed_estimate / total_estimate) * 100, 1)
                if total_estimate
                else round((completed / total) * 100, 1)
                if total
                else 0
            )
            active = project_issues.filter(state__group__in=OPEN_STATE_GROUPS)
            overdue = active.filter(target_date__lt=now).count()
            blocked = active.filter(id__in=blocked_ids).count()
            missing_estimate = active.filter(Q(point__isnull=True) & Q(estimate_point__isnull=True)).count()
            team_count = ProjectMember.objects.filter(project=project, is_active=True, member__is_bot=False).count()
            latest = project_issues.aggregate(last=Max("updated_at"))["last"]
            risk = self._project_risk(
                project=project,
                total_open=active.count(),
                overdue=overdue,
                blocked=blocked,
                missing_estimate=missing_estimate,
                latest=latest,
                issues=active,
            )

            rows.append(
                {
                    "id": str(project.id),
                    "identifier": project.identifier,
                    "name": project.name,
                    "owner": self._user_payload(project.project_lead or project.default_assignee),
                    "technical_lead": self._user_payload(project.project_lead),
                    "team_count": team_count,
                    "status": self._project_status(risk["level"], active.count()),
                    "priority": "none",
                    "start_date": self._safe_iso(project_issues.aggregate(first=MinDate("start_date"))["first"]),
                    "target_date": self._safe_iso(project_issues.aggregate(last=Max("target_date"))["last"]),
                    "forecast_date": self._forecast_date(project, active, period_project_issues),
                    "progress": {"value": progress, "method": progress_method},
                    "total_work_items": total,
                    "work_items_in_progress": active.filter(state__group="started").count(),
                    "work_items_in_review": self._review_issues(active).count(),
                    "blocked_work_items": blocked,
                    "overdue_work_items": overdue,
                    "scope_change": self._scope_change(project),
                    "risk": risk,
                    "state_distribution": list(
                        project_issues.values("state__group").annotate(count=Count("id")).order_by("state__group")
                    ),
                    "last_updated_at": latest.isoformat() if latest else None,
                }
            )

        rows.sort(key=lambda item: ({"high": 0, "medium": 1, "low": 2}[item["risk"]["level"]], item["name"]))
        return {"period": self._period_payload(), "results": rows, "count": len(rows)}

    def workload(self) -> dict[str, Any]:
        team = self.team()["results"]
        return {
            "period": self._period_payload(),
            "unit": self.settings["estimation_unit"],
            "thresholds": {
                "low": self.settings["low_utilization_threshold"],
                "high": self.settings["high_utilization_threshold"],
                "overload": self.settings["overload_threshold"],
            },
            "results": team,
            "summary": {
                "average_workload_percent": self._average([row["workload"]["percent"] for row in team]),
                "overloaded_members": len([row for row in team if self._is_overloaded(row["workload"]["percent"])]),
                "members_with_capacity": len([row for row in team if row["workload"]["level"] == "available"]),
            },
        }

    def delivery(self) -> dict[str, Any]:
        issues = self._filtered_issues()
        return {
            "period": self._period_payload(),
            "history": self._history_payload(),
            "metrics": {
                "cycle_time_hours": self._cycle_time_hours(issues),
                "lead_time_hours": self._lead_time_hours(issues),
                "throughput": issues.filter(state__group="completed", completed_at__isnull=False).count(),
                "on_time_delivery_percent": self._on_time_delivery(issues),
                "estimate_accuracy_percent": None,
                "flow_efficiency_percent": None,
                "reopened_work_items": self._reopened_count(),
            },
            "grouped_throughput": list(
                issues.filter(state__group="completed", completed_at__isnull=False)
                .values("project_id", "project__name")
                .annotate(count=Count("id"))
                .order_by("-count")
            ),
            "insufficient_data": ["estimate_accuracy_percent", "flow_efficiency_percent"],
        }

    def risks(self) -> dict[str, Any]:
        projects = self.projects()["results"]
        return {
            "period": self._period_payload(),
            "results": projects,
            "summary": {
                "high": len([item for item in projects if item["risk"]["level"] == "high"]),
                "medium": len([item for item in projects if item["risk"]["level"] == "medium"]),
                "low": len([item for item in projects if item["risk"]["level"] == "low"]),
            },
            "weights": self.settings["risk_weights"],
            "thresholds": self.settings["risk_thresholds"],
        }

    def data_quality(self) -> dict[str, Any]:
        issues = self._filtered_issues(include_period=False)
        now = timezone.now()
        checks = [
            self._quality_check(
                "missing_assignee", issues.filter(state__group__in=OPEN_STATE_GROUPS, assignees__isnull=True).distinct()
            ),
            self._quality_check("missing_module", issues.filter(issue_module__isnull=True).distinct()),
            self._quality_check("missing_type", issues.filter(type__isnull=True)),
            self._quality_check(
                "missing_estimate", issues.filter(Q(point__isnull=True) & Q(estimate_point__isnull=True))
            ),
            self._quality_check("missing_start_date", issues.filter(start_date__isnull=True)),
            self._quality_check("missing_target_date", issues.filter(target_date__isnull=True)),
            self._quality_check("missing_priority", issues.filter(Q(priority__isnull=True) | Q(priority="none"))),
            self._quality_check(
                "started_without_assignee", issues.filter(state__group="started", assignees__isnull=True).distinct()
            ),
            self._quality_check("blocked_without_reason", self._blocked_issues(issues)),
            self._quality_check(
                "stale_work_items",
                issues.filter(
                    state__group__in=OPEN_STATE_GROUPS,
                    updated_at__lt=now - timedelta(days=self.settings["stale_work_days"]),
                ),
            ),
            self._quality_check(
                "large_work_items", issues.filter(point__gt=self.settings["large_task_estimate_threshold"])
            ),
            self._quality_check(
                "invalid_dates",
                issues.filter(
                    start_date__isnull=False, target_date__isnull=False, target_date__lt=models_f("start_date")
                ),
            ),
        ]
        total_issues = issues.count()
        weighted_violations = sum(item["count"] for item in checks)
        denominator = max(total_issues * max(len(checks), 1), 1)
        score = max(0, round(100 - (weighted_violations / denominator) * 100, 1))
        return {"score": score, "total_work_items": total_issues, "checks": checks}

    def export_csv(self, section: str) -> str:
        payload = self.section(section)
        output = io.StringIO()
        writer = csv.writer(output)
        if section == "team":
            self._write_csv_row(
                writer,
                ["member", "email", "active_projects", "active_work_items", "blocked", "overdue", "workload_percent"],
            )
            for row in payload["results"]:
                self._write_csv_row(
                    writer,
                    [
                        row["display_name"],
                        row["email"],
                        row["active_projects"],
                        row["active_work_items"],
                        row["blocked_work_items"],
                        row["overdue_work_items"],
                        row["workload"]["percent"],
                    ],
                )
        elif section in ["projects", "risks"]:
            self._write_csv_row(
                writer,
                ["project", "identifier", "progress", "blocked", "overdue", "risk_level", "risk_score"],
            )
            for row in payload["results"]:
                self._write_csv_row(
                    writer,
                    [
                        row["name"],
                        row["identifier"],
                        row["progress"]["value"],
                        row["blocked_work_items"],
                        row["overdue_work_items"],
                        row["risk"]["level"],
                        row["risk"]["score"],
                    ],
                )
        elif section == "data-quality":
            self._write_csv_row(writer, ["check", "count"])
            for row in payload["checks"]:
                self._write_csv_row(writer, [row["key"], row["count"]])
        else:
            self._write_csv_row(writer, ["metric", "value"])
            for row in payload.get("kpis", []):
                self._write_csv_row(writer, [row["key"], row["value"]])
        return output.getvalue()

    def section(self, section: str) -> dict[str, Any]:
        sections = {
            "overview": self.overview,
            "team": self.team,
            "projects": self.projects,
            "workload": self.workload,
            "delivery": self.delivery,
            "risks": self.risks,
            "data-quality": self.data_quality,
        }
        if section not in MANAGEMENT_ANALYTICS_SECTIONS:
            raise ManagementAnalyticsValidationError("Unknown analytics section")
        return sections[section]()

    def _filtered_issues(self, period: str = "current", include_period: bool = True):
        queryset = Issue.issue_objects.filter(workspace=self.workspace)
        if include_period:
            start = self.period.previous_start if period == "previous" else self.period.start
            end = self.period.previous_end if period == "previous" else self.period.end
            snapshot_end = min(end, timezone.now())
            queryset = queryset.filter(
                Q(
                    state__group__in=OPEN_STATE_GROUPS,
                    created_at__lt=snapshot_end,
                )
                | Q(
                    state__group="completed",
                    completed_at__gte=start,
                    completed_at__lt=end,
                )
            )
        project_ids = self._uuid_csv("project_ids")
        member_ids = self._uuid_csv("member_ids") or self._uuid_csv("assignee_ids")
        state_ids = self._uuid_csv("state_ids")
        priorities = self._choice_csv("priorities", {"urgent", "high", "medium", "low", "none"})
        label_ids = self._uuid_csv("label_ids")
        module_ids = self._uuid_csv("module_ids")
        cycle_ids = self._uuid_csv("cycle_ids")
        planned = self.params.get("planned")
        if planned not in {None, "", "planned", "unplanned"}:
            raise ManagementAnalyticsValidationError("Invalid planned filter")

        if project_ids:
            queryset = queryset.filter(project_id__in=project_ids)
        if member_ids:
            queryset = queryset.filter(assignees__id__in=member_ids)
        if state_ids:
            queryset = queryset.filter(state_id__in=state_ids)
        if priorities:
            queryset = queryset.filter(priority__in=priorities)
        if label_ids:
            queryset = queryset.filter(labels__id__in=label_ids, label_issue__deleted_at__isnull=True)
        if module_ids:
            queryset = queryset.filter(issue_module__module_id__in=module_ids, issue_module__deleted_at__isnull=True)
        if cycle_ids:
            queryset = queryset.filter(issue_cycle__cycle_id__in=cycle_ids, issue_cycle__deleted_at__isnull=True)
        if planned == "planned":
            queryset = queryset.filter(issue_cycle__isnull=False)
        if planned == "unplanned":
            queryset = queryset.filter(issue_cycle__isnull=True)
        return queryset.distinct()

    def _resolve_period(self) -> PeriodRange:
        now = timezone.now().astimezone(self.timezone)
        key = self.params.get("period", "current_week")
        if key not in MANAGEMENT_ANALYTICS_PERIODS:
            raise ManagementAnalyticsValidationError("Unknown analytics period")
        start = None
        end = None
        if key == "previous_week":
            start = (now - timedelta(days=now.weekday() + 7)).replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=7)
        elif key == "last_14_days":
            start = now - timedelta(days=14)
            end = now
        elif key == "last_30_days":
            start = now - timedelta(days=30)
            end = now
        elif key == "current_month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = now
        elif key == "previous_month":
            current_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = current_month
            start = (current_month - timedelta(days=1)).replace(day=1)
        elif key == "current_quarter":
            quarter_month = ((now.month - 1) // 3) * 3 + 1
            start = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
            end = now
        elif key == "custom":
            if not self.params.get("start_date") or not self.params.get("end_date"):
                raise ManagementAnalyticsValidationError("Custom period requires start_date and end_date")
            start = self._parse_period_boundary(self.params["start_date"], "start_date")
            end = self._parse_period_boundary(self.params["end_date"], "end_date", end_of_date=True)
        else:
            start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=7)
            key = "current_week"
        delta = end - start
        if delta <= timedelta(0):
            raise ManagementAnalyticsValidationError("Analytics period end must be after start")
        if key == "custom" and delta > timedelta(days=366):
            raise ManagementAnalyticsValidationError("Custom analytics period cannot exceed 366 days")
        return PeriodRange(
            start=start.astimezone(datetime_timezone.utc),
            end=end.astimezone(datetime_timezone.utc),
            previous_start=(start - delta).astimezone(datetime_timezone.utc),
            previous_end=start.astimezone(datetime_timezone.utc),
            key=key,
        )

    def _period_payload(self):
        return {
            "key": self.period.key,
            "start": self.period.start.isoformat(),
            "end": self.period.end.isoformat(),
            "previous_start": self.period.previous_start.isoformat(),
            "previous_end": self.period.previous_end.isoformat(),
            "timezone": self.workspace.timezone,
        }

    def _history_payload(self):
        has_state_history = IssueActivity.objects.filter(workspace=self.workspace, field="state").exists()
        return {
            "status": "available" if has_state_history else "partial",
            "message": (
                "IssueActivity is used for state history; metrics are partial for work items without activity rows."
            ),
        }

    def _csv(self, key: str) -> list[str]:
        value = self.params.get(key)
        if not value:
            return []
        if isinstance(value, list):
            values = value
        else:
            values = str(value).split(",")
        cleaned = [str(item).strip() for item in values if str(item).strip()]
        if len(cleaned) > 500 or any(len(item) > 255 for item in cleaned):
            raise ManagementAnalyticsValidationError(f"Invalid {key} filter")
        return cleaned

    def _uuid_csv(self, key):
        values = self._csv(key)
        for value in values:
            try:
                UUID(value)
            except (TypeError, ValueError) as error:
                raise ManagementAnalyticsValidationError(f"Invalid {key} filter") from error
        return values

    def _choice_csv(self, key, allowed_values):
        values = self._csv(key)
        if any(value not in allowed_values for value in values):
            raise ManagementAnalyticsValidationError(f"Invalid {key} filter")
        return values

    def _parse_period_boundary(self, raw_value, field_name, end_of_date=False):
        value = str(raw_value).strip()
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (TypeError, ValueError) as error:
            raise ManagementAnalyticsValidationError(f"Invalid {field_name}") from error

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=self.timezone)
        else:
            parsed = parsed.astimezone(self.timezone)
        if end_of_date and len(value) == 10:
            parsed += timedelta(days=1)
        return parsed

    def _validate_settings_update(self, payload):
        if not isinstance(payload, dict):
            raise ManagementAnalyticsValidationError("Analytics settings must be an object")
        try:
            payload_size = len(json.dumps(payload, ensure_ascii=False))
        except (TypeError, ValueError) as error:
            raise ManagementAnalyticsValidationError("Analytics settings must be valid JSON") from error
        if payload_size > 65536:
            raise ManagementAnalyticsValidationError("Analytics settings payload is too large")

        defaults = get_default_management_analytics_config()
        unknown_keys = set(payload) - set(defaults)
        if unknown_keys:
            raise ManagementAnalyticsValidationError("Unknown analytics setting")

        fixed_nested_keys = {"risk_weights", "risk_thresholds", "unplanned_work"}
        for key in fixed_nested_keys & payload.keys():
            value = payload[key]
            if not isinstance(value, dict) or set(value) - set(defaults[key]):
                raise ManagementAnalyticsValidationError(f"Invalid {key}")

        merged = self._deep_merge(self.settings, payload)
        numeric_ranges = {
            "default_weekly_capacity": (0, 10000),
            "low_utilization_threshold": (0, 1000),
            "high_utilization_threshold": (0, 1000),
            "overload_threshold": (0, 1000),
            "estimate_accuracy_min": (0, 1000),
            "estimate_accuracy_max": (0, 1000),
            "stale_work_days": (1, 3650),
            "max_wip_age_days": (1, 3650),
            "large_task_estimate_threshold": (0, 1000000),
        }
        for key, (minimum, maximum) in numeric_ranges.items():
            self._validate_number(merged.get(key), key, minimum, maximum)
        for key in {"stale_work_days", "max_wip_age_days"}:
            if isinstance(merged[key], bool) or not isinstance(merged[key], int):
                raise ManagementAnalyticsValidationError(f"Invalid {key}")

        if not (
            merged["low_utilization_threshold"] <= merged["high_utilization_threshold"] <= merged["overload_threshold"]
        ):
            raise ManagementAnalyticsValidationError("Utilization thresholds must be ordered")
        if merged["estimate_accuracy_min"] > merged["estimate_accuracy_max"]:
            raise ManagementAnalyticsValidationError("Estimate accuracy thresholds must be ordered")

        if merged.get("estimation_unit") not in {"points", "hours"}:
            raise ManagementAnalyticsValidationError("Invalid estimation_unit")
        self._validate_string_list(merged.get("review_state_groups"), "review_state_groups", 10)
        self._validate_string_list(merged.get("testing_state_groups"), "testing_state_groups", 10)
        self._validate_string_list(merged.get("overview_hidden_kpis"), "overview_hidden_kpis", 100)
        self._validate_string_list(merged.get("required_issue_fields"), "required_issue_fields", 50)

        working_days = merged.get("working_days")
        if (
            not isinstance(working_days, list)
            or len(working_days) > 7
            or any(isinstance(day, bool) or not isinstance(day, int) or day < 0 or day > 6 for day in working_days)
        ):
            raise ManagementAnalyticsValidationError("Invalid working_days")

        member_capacity = merged.get("member_weekly_capacity")
        if not isinstance(member_capacity, dict) or len(member_capacity) > 1000:
            raise ManagementAnalyticsValidationError("Invalid member_weekly_capacity")
        for member_id, capacity in member_capacity.items():
            try:
                UUID(str(member_id))
            except (TypeError, ValueError) as error:
                raise ManagementAnalyticsValidationError("Invalid member capacity id") from error
            self._validate_number(capacity, "member capacity", 0, 10000)

        hidden_blocks = merged.get("hidden_analytics_blocks")
        if not isinstance(hidden_blocks, dict) or set(hidden_blocks) - MANAGEMENT_ANALYTICS_SECTIONS:
            raise ManagementAnalyticsValidationError("Invalid hidden_analytics_blocks")
        for section, blocks in hidden_blocks.items():
            self._validate_string_list(blocks, f"hidden blocks for {section}", 100)

        for key, value in merged.get("risk_weights", {}).items():
            self._validate_number(value, f"risk weight {key}", 0, 100)
        for key, value in merged.get("risk_thresholds", {}).items():
            self._validate_number(value, f"risk threshold {key}", 0, 10000)
        if merged["risk_thresholds"]["medium"] >= merged["risk_thresholds"]["high"]:
            raise ManagementAnalyticsValidationError("Risk thresholds must be ordered")

        unplanned_work = merged.get("unplanned_work")
        self._validate_string_list(unplanned_work.get("label_ids"), "unplanned label_ids", 1000)
        self._validate_string_list(unplanned_work.get("sources"), "unplanned sources", 100)
        if not isinstance(unplanned_work.get("cycle_rule"), str) or len(unplanned_work["cycle_rule"]) > 100:
            raise ManagementAnalyticsValidationError("Invalid unplanned cycle_rule")

    def _validate_number(self, value, key, minimum, maximum):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum < value <= maximum:
            raise ManagementAnalyticsValidationError(f"Invalid {key}")

    def _validate_string_list(self, value, key, maximum_items):
        if (
            not isinstance(value, list)
            or len(value) > maximum_items
            or any(not isinstance(item, str) or not item or len(item) > 255 for item in value)
        ):
            raise ManagementAnalyticsValidationError(f"Invalid {key}")

    def _write_csv_row(self, writer, values):
        writer.writerow([self._safe_csv_cell(value) for value in values])

    def _safe_csv_cell(self, value):
        if not isinstance(value, str):
            return value
        if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
            return f"'{value}"
        return value

    def _kpi(self, key, value, previous_value, entity, value_type="number"):
        return {
            "key": key,
            "value": value,
            "previous_value": previous_value,
            "delta_percent": self._delta(value, previous_value),
            "value_type": value_type,
            "formula": f"management_analytics.formulas.{key}",
            "drilldown": {"entity": entity, "filters": {"metric": key, "period": self.period.key}},
        }

    def _delta(self, value, previous):
        if previous in [None, 0] or value is None:
            return None
        return round(((value - previous) / previous) * 100, 1)

    def _blocked_issues(self, queryset):
        blocked_issue_ids = IssueRelation.objects.filter(
            workspace=self.workspace,
            relation_type="blocked_by",
            issue__state__group__in=OPEN_STATE_GROUPS,
        ).values("issue_id")
        return (
            queryset.filter(Q(id__in=blocked_issue_ids) | Q(blocker_issues__isnull=False))
            .exclude(state__group__in=DONE_STATE_GROUPS)
            .distinct()
        )

    def _review_issues(self, queryset):
        return queryset.filter(state__group__in=self.settings["review_state_groups"]).distinct()

    def _estimate_sum(self, queryset):
        total = 0.0
        for point, estimate_value, estimate_key in queryset.values_list(
            "point", "estimate_point__value", "estimate_point__key"
        ):
            total += self._estimate_value(point, estimate_value, estimate_key)
        return total

    def _estimate_value(self, point, estimate_value, estimate_key):
        if point is not None:
            return float(point)
        if estimate_value not in [None, ""]:
            try:
                return float(estimate_value)
            except (TypeError, ValueError):
                pass
        return float(estimate_key or 0)

    def _member_capacity(self, member_id):
        return float(
            self.settings.get("member_weekly_capacity", {}).get(
                str(member_id), self.settings["default_weekly_capacity"]
            )
        )

    def _workload_payload(self, percent, capacity, planned):
        if percent is None:
            level = "unknown"
        elif percent < self.settings["low_utilization_threshold"]:
            level = "available"
        elif percent < self.settings["high_utilization_threshold"]:
            level = "healthy"
        elif percent <= self.settings["overload_threshold"]:
            level = "high"
        else:
            level = "overloaded"
        return {"percent": percent, "capacity": capacity, "planned": planned, "level": level}

    def _is_overloaded(self, percent):
        return percent is not None and percent > self.settings["overload_threshold"]

    def _cycle_time_hours(self, queryset):
        issue_ids = list(queryset.filter(state__group="completed").values_list("id", flat=True)[:1000])
        if not issue_ids:
            return None
        starts = self._first_activity_by_issue(issue_ids, "state", ["started"])
        completes = self._first_activity_by_issue(issue_ids, "state", ["completed"])
        durations = []
        for issue_id, start in starts.items():
            completed = completes.get(issue_id)
            if completed and completed > start:
                durations.append((completed - start).total_seconds() / 3600)
        return round(self._average(durations), 1) if durations else None

    def _lead_time_hours(self, queryset):
        completed = queryset.filter(state__group="completed", completed_at__isnull=False)
        durations = [
            (issue.completed_at - issue.created_at).total_seconds() / 3600
            for issue in completed.only("created_at", "completed_at")[:1000]
            if issue.completed_at
        ]
        return round(self._average(durations), 1) if durations else None

    def _first_activity_by_issue(self, issue_ids, field, target_values):
        rows = (
            IssueActivity.objects.filter(issue_id__in=issue_ids, field=field)
            .order_by("issue_id", "created_at")
            .values("issue_id", "created_at", "new_value", "new_identifier")
        )
        result = {}
        for row in rows:
            if row["issue_id"] in result:
                continue
            if self._activity_state_group(row["new_value"], row["new_identifier"]) in target_values:
                result[row["issue_id"]] = row["created_at"]
        return result

    def _on_time_delivery(self, queryset):
        completed = queryset.filter(state__group="completed", completed_at__isnull=False, target_date__isnull=False)
        total = completed.count()
        if not total:
            return None
        on_time = completed.filter(completed_at__lte=models_f("target_date")).count()
        return round((on_time / total) * 100, 1)

    def _reopened_count(self):
        return len(self._reopened_issue_ids())

    def _reopened_issues(self):
        return self._filtered_issues(include_period=False).filter(id__in=self._reopened_issue_ids())

    def _reopened_issue_ids(self):
        rows = IssueActivity.objects.filter(
            workspace=self.workspace,
            field="state",
            created_at__gte=self.period.start,
            created_at__lt=self.period.end,
        ).values("issue_id", "old_value", "new_value", "old_identifier", "new_identifier")
        issue_ids = set()
        for row in rows:
            old_group = self._activity_state_group(row["old_value"], row["old_identifier"])
            new_group = self._activity_state_group(row["new_value"], row["new_identifier"])
            if old_group in DONE_STATE_GROUPS and new_group == "started":
                issue_ids.add(row["issue_id"])
        return issue_ids

    def _activity_state_group(self, value, identifier):
        if not hasattr(self, "_state_groups_by_id"):
            states = State.objects.filter(workspace=self.workspace).values("id", "name", "group")
            self._state_groups_by_id = {str(state["id"]): state["group"] for state in states}
            groups_by_name = {}
            for state in states:
                groups_by_name.setdefault(str(state["name"]).strip().casefold(), set()).add(state["group"])
            self._state_groups_by_name = {
                name: next(iter(groups)) for name, groups in groups_by_name.items() if len(groups) == 1
            }

        if identifier:
            group = self._state_groups_by_id.get(str(identifier))
            if group:
                return group
        normalized = str(value or "").strip().casefold()
        if normalized in {*OPEN_STATE_GROUPS, *DONE_STATE_GROUPS}:
            return normalized
        return self._state_groups_by_name.get(normalized)

    def _active_members_count(self):
        return WorkspaceMember.objects.filter(workspace=self.workspace, is_active=True, member__is_bot=False).count()

    def _previous_active_members_count(self):
        return self._active_members_count()

    def _active_projects_count(self):
        return Project.objects.filter(workspace=self.workspace, archived_at__isnull=True).count()

    def _previous_active_projects_count(self):
        return self._active_projects_count()

    def _project_risk(self, project, total_open, overdue, blocked, missing_estimate, latest, issues):
        score = 0
        reasons = []
        weights = self.settings["risk_weights"]
        thresholds = self.settings["risk_thresholds"]
        overdue_ratio = (overdue / total_open) * 100 if total_open else 0
        missing_estimate_ratio = (missing_estimate / total_open) * 100 if total_open else 0
        if overdue_ratio > thresholds["overdue_ratio"]:
            score += weights["overdue_ratio"]
            reasons.append("overdue_ratio")
        if blocked:
            score += weights["blocked_work"]
            reasons.append("blocked_work")
        if missing_estimate_ratio > thresholds["missing_estimate_ratio"]:
            score += weights["missing_estimate_ratio"]
            reasons.append("missing_estimate_ratio")
        if latest and latest < timezone.now() - timedelta(days=thresholds["stale_project_days"]):
            score += weights["stale_project"]
            reasons.append("stale_project")
        bus_factor = self._bus_factor_ratio(issues)
        if bus_factor > thresholds["bus_factor_ratio"]:
            score += weights["bus_factor"]
            reasons.append("bus_factor")
        level = "high" if score >= thresholds["high"] else "medium" if score >= thresholds["medium"] else "low"
        return {"score": score, "level": level, "reasons": reasons, "bus_factor_ratio": round(bus_factor, 1)}

    def _bus_factor_ratio(self, queryset):
        total_estimate = self._estimate_sum(queryset)
        if not total_estimate:
            total = queryset.count()
            if not total:
                return 0
            top = (
                IssueAssignee.objects.filter(issue__in=queryset)
                .values("assignee_id")
                .annotate(count=Count("issue_id", distinct=True))
                .order_by("-count")
                .first()
            )
            return ((top["count"] if top else 0) / total) * 100
        totals_by_assignee: dict[str, float] = {}
        for row in IssueAssignee.objects.filter(issue__in=queryset).values(
            "assignee_id",
            "issue__point",
            "issue__estimate_point__value",
            "issue__estimate_point__key",
        ):
            assignee_id = str(row["assignee_id"])
            totals_by_assignee[assignee_id] = totals_by_assignee.get(assignee_id, 0) + self._estimate_value(
                row["issue__point"],
                row["issue__estimate_point__value"],
                row["issue__estimate_point__key"],
            )
        top_total = max(totals_by_assignee.values(), default=0)
        return (top_total / total_estimate) * 100 if top_total else 0

    def _scope_change(self, project):
        before = Issue.issue_objects.filter(project=project, created_at__lt=self.period.start).count()
        added = Issue.issue_objects.filter(
            project=project, created_at__gte=self.period.start, created_at__lte=self.period.end
        ).count()
        growth = round((added / before) * 100, 1) if before else None
        return {"baseline_work_items": before, "added_work_items": added, "growth_percent": growth}

    def _forecast_date(self, project, active, period_issues):
        remaining = self._estimate_sum(active)
        completed = period_issues.filter(state__group="completed")
        throughput = completed.count()
        if remaining <= 0:
            return {"status": "on_track", "date": None, "reason": None}
        if throughput < 3:
            return {"status": "insufficient_data", "date": None, "reason": "throughput"}
        days = max((self.period.end - self.period.start).days, 1)
        remaining_issues = active.count()
        forecast_days = round((remaining_issues / throughput) * days)
        forecast = timezone.now() + timedelta(days=forecast_days)
        planned = active.aggregate(target=Max("target_date"))["target"]
        status = "delayed" if planned and forecast > planned else "on_track"
        return {"status": status, "date": forecast.isoformat(), "reason": None}

    def _project_status(self, risk_level, open_count):
        if open_count == 0:
            return "completed"
        return "at_risk" if risk_level == "high" else "active"

    def _attention_items(self, team_rows, project_rows, issues):
        items = []
        for row in team_rows:
            if self._is_overloaded(row["workload"]["percent"]):
                items.append(
                    {
                        "key": "member_overloaded",
                        "severity": "high",
                        "entity": "member",
                        "entity_id": row["id"],
                        "label": row["display_name"],
                    }
                )
            if row["active_projects"] > 3:
                items.append(
                    {
                        "key": "too_many_parallel_projects",
                        "severity": "medium",
                        "entity": "member",
                        "entity_id": row["id"],
                        "label": row["display_name"],
                    }
                )
        for row in project_rows:
            if row["risk"]["level"] == "high":
                items.append(
                    {
                        "key": "project_high_risk",
                        "severity": "high",
                        "entity": "project",
                        "entity_id": row["id"],
                        "label": row["name"],
                    }
                )
        stale = issues.filter(
            state__group__in=OPEN_STATE_GROUPS,
            updated_at__lt=timezone.now() - timedelta(days=self.settings["stale_work_days"]),
        )[:10]
        for issue in stale:
            items.append(
                {
                    "key": "stale_work_item",
                    "severity": "medium",
                    "entity": "issue",
                    "entity_id": str(issue.id),
                    "label": issue.name,
                }
            )
        return items[:20]

    def _quality_check(self, key, queryset):
        sample = list(queryset.values("id", "name", "project_id", "project__identifier")[:20])
        return {"key": key, "count": queryset.count(), "sample": sample}

    def _issue_payload(self, issue):
        if not issue:
            return None
        return {
            "id": str(issue.id),
            "name": issue.name,
            "sequence_id": issue.sequence_id,
            "project_id": str(issue.project_id),
            "project_identifier": issue.project.identifier,
            "state_group": issue.state.group if issue.state else None,
            "priority": issue.priority,
            "start_date": self._safe_iso(issue.start_date),
            "target_date": self._safe_iso(issue.target_date),
        }

    def _issue_queryset_for_drilldown(self, queryset):
        return (
            queryset.select_related("project", "state", "estimate_point")
            .prefetch_related("assignees")
            .order_by("target_date", "-priority", "-updated_at")[:200]
        )

    def _issue_drilldown_payload(self, issue, now):
        target_date = issue.target_date
        days_overdue = None
        if target_date and target_date < now and issue.state and issue.state.group in OPEN_STATE_GROUPS:
            days_overdue = max((now.date() - target_date.date()).days, 0)

        return {
            **self._issue_payload(issue),
            "project_name": issue.project.name,
            "state_name": issue.state.name if issue.state else None,
            "assignees": [self._user_payload(user) for user in issue.assignees.all()],
            "completed_at": self._safe_iso(issue.completed_at),
            "created_at": self._safe_iso(issue.created_at),
            "updated_at": self._safe_iso(issue.updated_at),
            "days_overdue": days_overdue,
            "estimate": self._estimate_value(
                issue.point, getattr(issue.estimate_point, "value", None), getattr(issue.estimate_point, "key", None)
            ),
        }

    def _user_payload(self, user):
        if not user:
            return None
        return {
            "id": str(user.id),
            "display_name": user.display_name or user.email,
            "email": user.email,
            "avatar_url": user.avatar_url,
        }

    def _safe_iso(self, value):
        return value.isoformat() if value else None

    def _average(self, values):
        filtered = [value for value in values if value is not None]
        return round(sum(filtered) / len(filtered), 1) if filtered else None

    def _deep_merge(self, defaults, overrides):
        merged = dict(defaults)
        for key, value in (overrides or {}).items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged


def models_f(field: str):
    from django.db.models import F

    return F(field)


def MinDate(field: str):
    from django.db.models import Min

    return Min(field)
