# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueAssignee, ProjectMember, State, WorkspaceMember
from plane.tests.factories import ProjectFactory
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture(
    params=[
        ("Europe/Moscow", date(2026, 10, 21)),
        ("America/New_York", date(2026, 10, 21)),
        ("Europe/Berlin", date(2026, 10, 25)),
    ],
    ids=["moscow", "new-york", "dst-transition"],
)
def scheduled_issues(request):
    timezone_name, day = request.param
    tz = ZoneInfo(timezone_name)
    midnight = datetime.combine(day, time.min, tzinfo=tz)
    next_midnight = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    project = ProjectFactory()
    state = State.objects.create(project=project, name="Backlog", group="backlog", default=True)
    periods = {
        "spans-day": (midnight - timedelta(days=2), next_midnight + timedelta(days=2)),
        "starts-today": (next_midnight - timedelta(microseconds=1), next_midnight + timedelta(days=2)),
        "ends-today": (midnight - timedelta(days=2), midnight),
        "same-day": (midnight, next_midnight - timedelta(microseconds=1)),
        "past": (midnight - timedelta(days=3), midnight - timedelta(microseconds=1)),
        "future": (next_midnight, next_midnight + timedelta(days=2)),
        "deadline-today": (None, next_midnight - timedelta(microseconds=1)),
        "deadline-future": (None, next_midnight),
        "deadline-past": (None, midnight - timedelta(microseconds=1)),
        "start-only": (midnight, None),
        "unscheduled": (None, None),
    }
    for name, (start, end) in periods.items():
        Issue.objects.create(project=project, state=state, name=name, start_date=start, target_date=end)

    with timezone.override(tz):
        yield SimpleNamespace(
            queryset=Issue.issue_objects.filter(project=project),
            project=project,
            timezone_name=timezone_name,
            day=day,
            midnight=midnight,
            next_midnight=next_midnight,
            periods=periods,
        )


def filter_names(issues, expression):
    queryset = ComplexFilterBackend().filter_queryset(
        None,
        issues.queryset,
        SimpleNamespace(filterset_class=IssueFilterSet),
        filter_data=expression,
    )
    return set(queryset.values_list("name", flat=True))


@pytest.mark.parametrize("lookup", ["target_date", "target_date__exact", "target_date__range"])
def test_day_filter_includes_execution_period_and_both_boundaries(scheduled_issues, lookup):
    day = scheduled_issues.day.isoformat()
    value = f"{day},{day}" if lookup.endswith("__range") else day
    assert filter_names(scheduled_issues, {lookup: value}) == {
        "spans-day",
        "starts-today",
        "ends-today",
        "same-day",
        "deadline-today",
    }


@pytest.mark.parametrize("offset", [-2, -1, 0, 1, 2, 3])
def test_spanning_task_appears_on_every_day_of_its_period(scheduled_issues, offset):
    day = (scheduled_issues.day + timedelta(days=offset)).isoformat()
    assert "spans-day" in filter_names(scheduled_issues, {"target_date__exact": day})


@pytest.mark.parametrize("offset", [-3, 4])
def test_spanning_task_is_excluded_outside_its_period(scheduled_issues, offset):
    day = (scheduled_issues.day + timedelta(days=offset)).isoformat()
    assert "spans-day" not in filter_names(scheduled_issues, {"target_date__exact": day})


def test_range_matches_periods_that_overlap_without_ending_in_range(scheduled_issues):
    first_day = scheduled_issues.day.isoformat()
    last_day = (scheduled_issues.day + timedelta(days=1)).isoformat()
    assert filter_names(scheduled_issues, {"target_date__range": f"{first_day},{last_day}"}) == {
        "spans-day",
        "starts-today",
        "ends-today",
        "same-day",
        "future",
        "deadline-today",
        "deadline-future",
    }


def test_explicit_timestamp_still_matches_only_the_deadline(scheduled_issues):
    timestamp = scheduled_issues.periods["ends-today"][1].isoformat()
    assert filter_names(scheduled_issues, {"target_date__exact": timestamp}) == {"ends-today"}


def test_start_date_filter_still_matches_only_the_start_day(scheduled_issues):
    assert filter_names(scheduled_issues, {"start_date__exact": scheduled_issues.day.isoformat()}) == {
        "starts-today",
        "same-day",
        "start-only",
    }


def test_period_filter_composes_with_other_conditions_and_negation(scheduled_issues):
    day_filter = {"target_date__exact": scheduled_issues.day.isoformat()}
    assert filter_names(
        scheduled_issues, {"and": [day_filter, {"not": {"start_date__exact": scheduled_issues.day.isoformat()}}]}
    ) == {
        "spans-day",
        "ends-today",
        "deadline-today",
    }
    assert filter_names(scheduled_issues, {"not": day_filter}) == {
        "past",
        "future",
        "deadline-future",
        "deadline-past",
        "start-only",
        "unscheduled",
    }


def test_reversed_range_remains_empty(scheduled_issues):
    first_day = scheduled_issues.day.isoformat()
    last_day = (scheduled_issues.day - timedelta(days=1)).isoformat()
    assert filter_names(scheduled_issues, {"target_date__range": f"{first_day},{last_day}"}) == set()


def test_filterset_queryset_uses_same_period_semantics(scheduled_issues):
    queryset = IssueFilterSet(
        {"target_date__exact": scheduled_issues.day.isoformat()}, queryset=scheduled_issues.queryset
    ).qs
    assert set(queryset.values_list("name", flat=True)) == {
        "spans-day",
        "starts-today",
        "ends-today",
        "same-day",
        "deadline-today",
    }


@pytest.mark.parametrize("grouped", [False, True], ids=["list", "board"])
def test_issue_endpoint_combines_day_and_assignee_filters(scheduled_issues, grouped):
    project = scheduled_issues.project
    actor = project.workspace.owner
    actor.user_timezone = scheduled_issues.timezone_name
    actor.save()
    WorkspaceMember.objects.create(workspace=project.workspace, member=actor, role=20)
    ProjectMember.objects.create(project=project, member=actor, role=20)
    for issue in scheduled_issues.queryset.filter(name__in=["spans-day", "past", "future"]):
        IssueAssignee.objects.create(project=project, issue=issue, assignee=actor)
    params = {
        "filters": json.dumps(
            {
                "target_date__exact": scheduled_issues.day.isoformat(),
                "assignee_id__in": str(actor.pk),
            }
        ),
    }
    if grouped:
        params["group_by"] = "state_id"
    client = APIClient()
    client.force_authenticate(actor)
    with patch("celery.app.task.Task.delay"):
        response = client.get(f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/issues/", params)
    assert response.status_code == 200, response.data
    rows = response.data["results"]
    if grouped:
        rows = [row for group in rows.values() for row in group["results"]]
    assert [row["name"] for row in rows] == ["spans-day"]
