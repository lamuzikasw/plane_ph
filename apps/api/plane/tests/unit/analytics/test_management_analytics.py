# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.app.analytics.management import ManagementAnalyticsService
from plane.db.models import (
    Estimate,
    EstimatePoint,
    Issue,
    IssueAssignee,
    IssueBlocker,
    IssueRelation,
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
    estimate = Estimate.objects.create(workspace=workspace, project=project, name=f"Points {key} {value}", type="points")
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
    make_issue(workspace, project, completed, "Completed", estimate_point=completed_estimate, completed_at=timezone.now())

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
