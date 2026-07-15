# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import csv
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from plane.app.analytics.management import ManagementAnalyticsService, ManagementAnalyticsValidationError
from plane.app.views.analytic.management import (
    ManagementAnalyticsEndpoint,
    ManagementAnalyticsSettingsEndpoint,
)
from plane.db.models import (
    Estimate,
    EstimatePoint,
    Issue,
    IssueAssignee,
    IssueBlocker,
    IssueRelation,
    ManagementAnalyticsSettings,
    Project,
    State,
    Workspace,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory


pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def make_workspace(slug="analytics"):
    owner = UserFactory(email=f"{slug}@plane.so", username=f"{slug}@plane.so")
    workspace = WorkspaceFactory(slug=slug, owner=owner, timezone="UTC")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=20)
    return workspace, owner


def make_project(workspace: Workspace, name="Analytics Project"):
    project = Project.objects.create(
        workspace=workspace,
        name=name,
        identifier=name[:4].upper(),
        network=2,
        project_lead=workspace.owner,
    )
    backlog = State.objects.create(
        workspace=workspace,
        project=project,
        name="Backlog",
        color="#60646C",
        group="backlog",
        default=True,
    )
    started = State.objects.create(
        workspace=workspace,
        project=project,
        name="Started",
        color="#F59E0B",
        group="started",
    )
    completed = State.objects.create(
        workspace=workspace,
        project=project,
        name="Done",
        color="#46A758",
        group="completed",
    )
    project.default_state = backlog
    project.save(update_fields=["default_state", "updated_at"])
    return project, backlog, started, completed


def make_issue(workspace, project, state, name, **kwargs):
    issue = Issue.objects.create(workspace=workspace, project=project, state=state, name=name, **kwargs)
    return issue


def make_estimate_point(workspace, project, key=1, value="1"):
    estimate = Estimate.objects.create(
        workspace=workspace, project=project, name=f"Points {key} {value}", type="points"
    )
    return EstimatePoint.objects.create(workspace=workspace, project=project, estimate=estimate, key=key, value=value)


def test_on_time_delivery_uses_completed_work_items_with_target_date():
    workspace, _ = make_workspace("delivery")
    project, _, _, completed = make_project(workspace)
    now = timezone.now()
    make_issue(
        workspace,
        project,
        completed,
        "On time",
        target_date=now + timedelta(days=1),
        completed_at=now,
    )
    make_issue(
        workspace,
        project,
        completed,
        "Late",
        target_date=now - timedelta(days=1),
        completed_at=now,
    )
    make_issue(workspace, project, completed, "No target", completed_at=now)

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})

    assert service.delivery()["metrics"]["on_time_delivery_percent"] == 50.0


def test_workload_uses_planned_estimate_against_member_capacity():
    workspace, member = make_workspace("workload")
    project, _, started, _ = make_project(workspace)
    now = timezone.now()
    issue = make_issue(
        workspace,
        project,
        started,
        "Planned work",
        point=15,
        target_date=now + timedelta(days=1),
    )
    IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=member)

    service = ManagementAnalyticsService(workspace.slug, {"period": "current_week"})
    service.update_settings({"default_weekly_capacity": 30})

    row = service.workload()["results"][0]
    assert row["workload"]["percent"] == 50.0
    assert row["workload"]["level"] == "available"


def test_workload_uses_active_estimate_points_outside_current_week():
    workspace, member = make_workspace("workload-estimate-point")
    project, _, started, _ = make_project(workspace)
    estimate_point = make_estimate_point(workspace, project, key=8, value="8")
    issue = make_issue(
        workspace,
        project,
        started,
        "Future active work",
        estimate_point=estimate_point,
        target_date=timezone.now() + timedelta(days=14),
    )
    IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=member)

    service = ManagementAnalyticsService(workspace.slug, {"period": "current_week"})
    service.update_settings({"default_weekly_capacity": 40})

    row = service.workload()["results"][0]
    assert row["planned_work"] == 8.0
    assert row["workload"]["percent"] == 20.0


def test_project_progress_uses_estimate_points():
    workspace, _ = make_workspace("progress-estimate-point")
    project, _, started, completed = make_project(workspace)
    remaining_estimate = make_estimate_point(workspace, project, key=9, value="9")
    completed_estimate = make_estimate_point(workspace, project, key=3, value="3")
    make_issue(workspace, project, started, "Remaining", estimate_point=remaining_estimate)
    make_issue(
        workspace, project, completed, "Completed", estimate_point=completed_estimate, completed_at=timezone.now()
    )

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    project_row = service.projects()["results"][0]

    assert project_row["progress"]["method"] == "estimate"
    assert project_row["progress"]["value"] == 25.0


def test_estimate_point_is_not_counted_as_missing_estimate():
    workspace, _ = make_workspace("quality-estimate-point")
    project, _, started, _ = make_project(workspace)
    estimate_point = make_estimate_point(workspace, project, key=5, value="5")
    make_issue(workspace, project, started, "Estimated", estimate_point=estimate_point)
    make_issue(workspace, project, started, "Unestimated")

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    overview_kpis = {kpi["key"]: kpi["value"] for kpi in service.overview()["kpis"]}
    checks = {check["key"]: check["count"] for check in service.data_quality()["checks"]}

    assert overview_kpis["unestimated_work_items"] == 1
    assert checks["missing_estimate"] == 1


def test_project_risk_marks_overdue_project_as_high():
    workspace, member = make_workspace("risk")
    project, _, started, _ = make_project(workspace)
    now = timezone.now()
    for index in range(5):
        issue = make_issue(
            workspace,
            project,
            started,
            f"Overdue {index}",
            target_date=now - timedelta(days=1),
        )
        IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=member)
        blocker = make_issue(workspace, project, started, f"Blocker {index}")
        IssueBlocker.objects.create(workspace=workspace, project=project, block=issue, blocked_by=blocker)

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    project_row = service.projects()["results"][0]

    assert project_row["risk"]["level"] == "high"
    assert "overdue_ratio" in project_row["risk"]["reasons"]


def test_data_quality_reports_missing_target_date():
    workspace, _ = make_workspace("quality")
    project, _, started, _ = make_project(workspace)
    make_issue(workspace, project, started, "No target date")

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    checks = {check["key"]: check["count"] for check in service.data_quality()["checks"]}

    assert checks["missing_target_date"] == 1


def test_drilldown_reports_data_quality_issue_rows():
    workspace, _ = make_workspace("quality-drilldown")
    project, _, started, _ = make_project(workspace)
    issue = make_issue(workspace, project, started, "No assignee")

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    payload = service.drilldown("missing_assignee")

    assert payload["entity"] == "issue"
    assert payload["count"] == 1
    assert payload["rows"][0]["id"] == str(issue.id)


def test_drilldown_reports_blocked_issue_rows_from_legacy_and_relation_models():
    workspace, _ = make_workspace("blocked-drilldown")
    project, _, started, _ = make_project(workspace)
    legacy_blocked = make_issue(workspace, project, started, "Legacy blocked")
    legacy_blocker = make_issue(workspace, project, started, "Legacy blocker")
    relation_blocked = make_issue(workspace, project, started, "Relation blocked")
    relation_blocker = make_issue(workspace, project, started, "Relation blocker")
    IssueBlocker.objects.create(workspace=workspace, project=project, block=legacy_blocked, blocked_by=legacy_blocker)
    IssueRelation.objects.create(
        workspace=workspace,
        project=project,
        issue=relation_blocked,
        related_issue=relation_blocker,
        relation_type="blocked_by",
    )

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    payload = service.drilldown("blocked_work_items")
    row_ids = {row["id"] for row in payload["rows"]}

    assert payload["entity"] == "issue"
    assert str(legacy_blocked.id) in row_ids
    assert str(relation_blocked.id) in row_ids


def test_drilldown_reports_delivery_and_risk_rows():
    workspace, _ = make_workspace("delivery-risk-drilldown")
    project, _, started, completed = make_project(workspace)
    now = timezone.now()
    completed_issue = make_issue(workspace, project, completed, "Delivered", completed_at=now, target_date=now)
    for index in range(5):
        blocked = make_issue(workspace, project, started, f"Overdue {index}", target_date=now - timedelta(days=1))
        blocker = make_issue(workspace, project, started, f"Blocker {index}")
        IssueBlocker.objects.create(workspace=workspace, project=project, block=blocked, blocked_by=blocker)

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})
    throughput = service.drilldown("throughput")
    high_risk = service.drilldown("high")

    assert throughput["entity"] == "issue"
    assert throughput["rows"][0]["id"] == str(completed_issue.id)
    assert high_risk["entity"] == "project"
    assert high_risk["count"] == 1


def test_workspace_isolation_keeps_other_workspace_out():
    workspace, _ = make_workspace("isolated-a")
    project, _, started, _ = make_project(workspace)
    make_issue(workspace, project, started, "Visible")

    other_workspace, _ = make_workspace("isolated-b")
    other_project, _, other_started, _ = make_project(other_workspace)
    make_issue(other_workspace, other_project, other_started, "Hidden")

    service = ManagementAnalyticsService(workspace.slug, {"period": "last_30_days"})

    assert service.overview()["kpis"][2]["value"] == 1


@pytest.mark.parametrize(
    "params",
    [
        {"period": "unknown"},
        {"period": "custom", "start_date": "2026-07-01"},
        {"period": "custom", "start_date": "invalid", "end_date": "2026-07-02"},
        {"period": "custom", "start_date": "2026-07-02", "end_date": "2026-07-01"},
        {"period": "custom", "start_date": "2025-01-01", "end_date": "2026-07-02"},
    ],
)
def test_invalid_analytics_periods_are_rejected(params):
    workspace, _ = make_workspace(f"period-{abs(hash(str(params))) % 100000}")

    with pytest.raises(ManagementAnalyticsValidationError):
        ManagementAnalyticsService(workspace.slug, params)


def test_custom_date_period_includes_the_selected_end_day():
    workspace, _ = make_workspace("custom-period-end")

    service = ManagementAnalyticsService(
        workspace.slug,
        {"period": "custom", "start_date": "2026-07-01", "end_date": "2026-07-02"},
    )

    assert service.period.end - service.period.start == timedelta(days=2)


@pytest.mark.parametrize(
    "params",
    [
        {"project_ids": "not-a-uuid"},
        {"member_ids": "not-a-uuid"},
        {"priorities": "critical"},
        {"planned": "sometimes"},
    ],
)
def test_invalid_analytics_filters_are_rejected_before_querying(params):
    workspace, _ = make_workspace(f"filter-{abs(hash(str(params))) % 100000}")
    service = ManagementAnalyticsService(workspace.slug, params)

    with pytest.raises(ManagementAnalyticsValidationError):
        service.overview()


@pytest.mark.parametrize(
    "payload",
    [
        {"unknown_setting": 1},
        {"default_weekly_capacity": 0},
        {"stale_work_days": 1.5},
        {"low_utilization_threshold": 100, "high_utilization_threshold": 90},
        {"risk_weights": {"invented_weight": 10}},
        {"member_weekly_capacity": {"not-a-uuid": 30}},
        {"hidden_analytics_blocks": {"invented-section": ["summary"]}},
    ],
)
def test_invalid_analytics_settings_are_rejected_without_persisting(payload):
    workspace, _ = make_workspace(f"settings-{abs(hash(str(payload))) % 100000}")
    service = ManagementAnalyticsService(workspace.slug)
    original_config = ManagementAnalyticsSettings.objects.get(workspace=workspace).config

    with pytest.raises(ManagementAnalyticsValidationError):
        service.update_settings(payload)

    assert ManagementAnalyticsSettings.objects.get(workspace=workspace).config == original_config


def test_valid_partial_analytics_settings_are_merged():
    workspace, _ = make_workspace("valid-settings")
    service = ManagementAnalyticsService(workspace.slug)

    updated = service.update_settings(
        {
            "default_weekly_capacity": 40,
            "hidden_analytics_blocks": {"overview": ["attention"]},
        }
    )

    assert updated["default_weekly_capacity"] == 40
    assert updated["hidden_analytics_blocks"] == {"overview": ["attention"]}
    assert updated["overload_threshold"] == 110


def test_unknown_drilldown_metric_and_export_section_are_rejected():
    workspace, _ = make_workspace("unknown-analytics-contract")
    service = ManagementAnalyticsService(workspace.slug)

    with pytest.raises(ManagementAnalyticsValidationError):
        service.drilldown("invented-metric")
    with pytest.raises(ManagementAnalyticsValidationError):
        service.export_csv("invented-section")


def test_csv_export_escapes_cells_that_spreadsheets_treat_as_formulas():
    workspace, member = make_workspace("safe-csv")
    member.display_name = '=HYPERLINK("https://example.com")'
    member.save(update_fields=["display_name", "updated_at"])

    rows = list(csv.reader(ManagementAnalyticsService(workspace.slug).export_csv("team").splitlines()))

    assert rows[1][0] == '\'=HYPERLINK("https://example.com")'


def test_management_analytics_api_returns_400_for_invalid_input():
    workspace, user = make_workspace("analytics-api-validation")
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=30)
    factory = APIRequestFactory()
    invalid_period_request = factory.get(
        "/api/workspaces/analytics-api-validation/management-analytics/overview/",
        {"period": "custom", "start_date": "bad", "end_date": "2026-07-02"},
    )
    force_authenticate(invalid_period_request, user=user)
    invalid_settings_request = factory.patch(
        "/api/workspaces/analytics-api-validation/management-analytics-settings/",
        {"default_weekly_capacity": 0},
        format="json",
    )
    force_authenticate(invalid_settings_request, user=user)

    period_response = ManagementAnalyticsEndpoint.as_view()(
        invalid_period_request,
        slug=workspace.slug,
        section="overview",
    )
    settings_response = ManagementAnalyticsSettingsEndpoint.as_view()(
        invalid_settings_request,
        slug=workspace.slug,
    )

    assert period_response.status_code == 400
    assert period_response.data["error"] == "Invalid start_date"
    assert settings_response.status_code == 400
    assert settings_response.data["error"] == "Invalid default_weekly_capacity"
