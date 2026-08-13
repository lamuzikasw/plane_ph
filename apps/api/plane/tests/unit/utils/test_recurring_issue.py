from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from plane.utils.recurring_issue import calculate_next_run


def test_daily_schedule_uses_exact_local_time():
    result = calculate_next_run(
        frequency="daily",
        interval=1,
        weekdays=[],
        start_date=date(2026, 8, 13),
        end_date=None,
        run_time=time(10, 0),
        timezone_name="Europe/Moscow",
        after=datetime(2026, 8, 13, 6, 30, tzinfo=ZoneInfo("UTC")),
    )

    assert result == datetime(2026, 8, 13, 7, 0, tzinfo=ZoneInfo("UTC"))


def test_daily_schedule_moves_to_next_interval_after_time_passes():
    result = calculate_next_run(
        frequency="daily",
        interval=2,
        weekdays=[],
        start_date=date(2026, 8, 13),
        end_date=None,
        run_time=time(9, 0),
        timezone_name="Europe/Moscow",
        after=datetime(2026, 8, 13, 7, 0, tzinfo=ZoneInfo("UTC")),
    )

    assert result == datetime(2026, 8, 15, 6, 0, tzinfo=ZoneInfo("UTC"))


def test_weekly_schedule_selects_requested_weekdays():
    result = calculate_next_run(
        frequency="weekly",
        interval=1,
        weekdays=[0, 2, 4],
        start_date=date(2026, 8, 13),
        end_date=None,
        run_time=time(9, 30),
        timezone_name="Europe/Moscow",
        after=datetime(2026, 8, 13, 8, 0, tzinfo=ZoneInfo("UTC")),
    )

    assert result == datetime(2026, 8, 14, 6, 30, tzinfo=ZoneInfo("UTC"))


def test_schedule_stops_after_end_date():
    result = calculate_next_run(
        frequency="daily",
        interval=1,
        weekdays=[],
        start_date=date(2026, 8, 13),
        end_date=date(2026, 8, 13),
        run_time=time(9, 0),
        timezone_name="Europe/Moscow",
        after=datetime(2026, 8, 13, 7, 0, tzinfo=ZoneInfo("UTC")),
    )

    assert result is None


def test_schedule_respects_dst_timezone_offset():
    result = calculate_next_run(
        frequency="daily",
        interval=1,
        weekdays=[],
        start_date=date(2026, 10, 26),
        end_date=None,
        run_time=time(9, 0),
        timezone_name="Europe/Berlin",
        after=datetime(2026, 10, 26, 6, 0, tzinfo=ZoneInfo("UTC")),
    )

    assert result == datetime(2026, 10, 26, 8, 0, tzinfo=ZoneInfo("UTC"))
