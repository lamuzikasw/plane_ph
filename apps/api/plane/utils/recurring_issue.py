# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone


def valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
        return value
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return "UTC"


def calculate_next_run(
    *,
    frequency: str,
    interval: int,
    weekdays: list[int],
    start_date: date,
    end_date: date | None,
    run_time: time,
    timezone_name: str,
    after: datetime | None = None,
) -> datetime | None:
    """Return the first valid scheduled instant strictly after ``after``."""
    tz = ZoneInfo(valid_timezone(timezone_name))
    reference = after or timezone.now()
    if timezone.is_naive(reference):
        reference = timezone.make_aware(reference, timezone=tz)
    local_reference = reference.astimezone(tz)
    interval = max(1, min(int(interval), 365))
    selected_weekdays = sorted({int(day) for day in weekdays if 0 <= int(day) <= 6})

    candidate_date = max(start_date, local_reference.date())
    start_week = start_date - timedelta(days=start_date.weekday())

    for _ in range(3660):
        if end_date and candidate_date > end_date:
            return None

        if frequency == "weekly":
            week_index = (candidate_date - start_week).days // 7
            date_matches = (
                week_index >= 0 and week_index % interval == 0 and candidate_date.weekday() in selected_weekdays
            )
        else:
            day_index = (candidate_date - start_date).days
            date_matches = day_index >= 0 and day_index % interval == 0

        if date_matches:
            candidate = datetime.combine(candidate_date, run_time, tzinfo=tz)
            if candidate > local_reference:
                return candidate.astimezone(ZoneInfo("UTC"))

        candidate_date += timedelta(days=1)

    return None
