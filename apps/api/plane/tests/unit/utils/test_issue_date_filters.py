# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import Issue, State
from plane.tests.factories import ProjectFactory
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet

pytestmark = [pytest.mark.unit, pytest.mark.django_db]
DATE_FIELDS = ("start_date", "target_date", "created_at", "updated_at")


@pytest.fixture(
    params=[
        ("Europe/Moscow", date(2026, 10, 16)),
        ("America/New_York", date(2026, 10, 16)),
        ("Europe/Berlin", date(2026, 10, 25)),  # Daylight saving time ends.
    ],
    ids=["moscow", "new-york", "dst-transition"],
)
def calendar_issues(request):
    timezone_name, day = request.param
    tz = ZoneInfo(timezone_name)
    midnight = datetime.combine(day, time.min, tzinfo=tz)
    next_midnight = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    project = ProjectFactory()
    state = State.objects.create(project=project, name="Backlog", group="backlog", default=True)
    timestamps = {
        "previous-day": midnight - timedelta(microseconds=1),
        "midnight": midnight,
        "midday": datetime.combine(day, time(12), tzinfo=tz),
        "reported-deadline": datetime.combine(day, time(23, 59), tzinfo=tz),
        "last-instant": next_midnight - timedelta(microseconds=1),
        "next-day": next_midnight,
        "no-deadline": None,
    }
    for name, value in timestamps.items():
        issue = Issue.objects.create(project=project, state=state, name=name)
        Issue.objects.filter(pk=issue.pk).update(
            start_date=value,
            target_date=value,
            created_at=value or next_midnight,
            updated_at=value or next_midnight,
        )

    with timezone.override(tz):
        yield SimpleNamespace(
            queryset=Issue.issue_objects.filter(project=project),
            day=day.isoformat(),
            midnight=midnight,
            next_midnight=next_midnight,
            timestamps=timestamps,
        )


def _filter_names(issues, expression):
    queryset = ComplexFilterBackend().filter_queryset(
        None,
        issues.queryset,
        SimpleNamespace(filterset_class=IssueFilterSet),
        filter_data=expression,
    )
    return set(queryset.values_list("name", flat=True))


@pytest.mark.parametrize("field", DATE_FIELDS)
@pytest.mark.parametrize("suffix", ["", "__exact"])
def test_exact_date_matches_entire_local_day(calendar_issues, field, suffix):
    assert _filter_names(calendar_issues, {f"{field}{suffix}": calendar_issues.day}) == {
        "midnight",
        "midday",
        "reported-deadline",
        "last-instant",
    }


@pytest.mark.parametrize("field", DATE_FIELDS)
def test_date_range_includes_entire_last_day(calendar_issues, field):
    previous_day = (calendar_issues.midnight.date() - timedelta(days=1)).isoformat()
    assert _filter_names(calendar_issues, {f"{field}__range": f"{previous_day},{calendar_issues.day}"}) == {
        "previous-day",
        "midnight",
        "midday",
        "reported-deadline",
        "last-instant",
    }
    assert _filter_names(
        calendar_issues, {f"{field}__range": f"{calendar_issues.day},{calendar_issues.day}"}
    ) == _filter_names(calendar_issues, {f"{field}__exact": calendar_issues.day})


@pytest.mark.parametrize("field", DATE_FIELDS)
def test_explicit_timestamps_keep_time_precision(calendar_issues, field):
    deadline = calendar_issues.timestamps["reported-deadline"].isoformat()
    assert _filter_names(calendar_issues, {f"{field}__exact": deadline}) == {"reported-deadline"}
    assert _filter_names(
        calendar_issues,
        {f"{field}__range": f"{calendar_issues.timestamps['midday'].isoformat()},{deadline}"},
    ) == {"midday", "reported-deadline"}


def test_date_conditions_compose_with_negation_and_other_filters(calendar_issues):
    assert _filter_names(
        calendar_issues,
        {
            "and": [
                {"target_date__exact": calendar_issues.day},
                {"not": {"start_date__exact": calendar_issues.timestamps["midnight"].isoformat()}},
            ]
        },
    ) == {"midday", "reported-deadline", "last-instant"}


def test_invalid_date_still_returns_validation_error(calendar_issues):
    with pytest.raises(ValidationError):
        _filter_names(calendar_issues, {"target_date__exact": "2026-02-30"})
