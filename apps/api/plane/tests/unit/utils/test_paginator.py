# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from django.db.models import Q
from django.utils import timezone

from plane.db.models import Issue, Project, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.paginator import Cursor, GroupedOffsetPaginator, SubGroupedOffsetPaginator


def _create_project():
    user = UserFactory(email="calendar-pagination@plane.so", username="calendar-pagination@plane.so")
    workspace = WorkspaceFactory(
        slug="calendar-pagination",
        owner=user,
        timezone="Europe/Moscow",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(
        workspace=workspace,
        project_lead=user,
        name="Calendar pagination",
        identifier="CAL",
        timezone="Europe/Moscow",
    )
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
    )
    return workspace, project, state


@pytest.mark.unit
@pytest.mark.django_db
def test_target_date_groups_use_local_calendar_date_and_share_pagination():
    workspace, project, state = _create_project()
    target_dates = [
        datetime(2026, 8, 19, 21, 30, tzinfo=ZoneInfo("UTC")),
        datetime(2026, 8, 20, 6, 0, tzinfo=ZoneInfo("UTC")),
        datetime(2026, 8, 20, 9, 0, tzinfo=ZoneInfo("UTC")),
        datetime(2026, 8, 20, 12, 0, tzinfo=ZoneInfo("UTC")),
        datetime(2026, 8, 20, 20, 59, tzinfo=ZoneInfo("UTC")),
    ]
    for index, target_date in enumerate(target_dates, start=1):
        Issue.objects.create(
            workspace=workspace,
            project=project,
            state=state,
            name=f"Calendar issue {index}",
            target_date=target_date,
        )

    queryset = Issue.issue_objects.filter(project=project)
    paginator = GroupedOffsetPaginator(
        queryset=queryset,
        group_by_field_name="target_date",
        group_by_fields=list(queryset.values_list("target_date", flat=True).distinct()),
        count_filter=Q(),
        order_by="target_date",
        on_results=lambda issues: list(issues.values("id", "target_date")),
    )

    with timezone.override(ZoneInfo("Europe/Moscow")):
        first_page = paginator.get_result(limit=4, cursor=Cursor(4, 0, False))
        grouped_results = paginator.process_results(paginator.on_results(first_page.results))

    assert set(grouped_results) == {"2026-08-20"}
    assert len(grouped_results["2026-08-20"]["results"]) == 4
    assert grouped_results["2026-08-20"]["total_results"] == 5
    assert first_page.next.has_results is True


@pytest.mark.unit
@pytest.mark.django_db
def test_target_date_subgroups_use_the_same_calendar_date_key():
    workspace, project, state = _create_project()
    for index, target_date in enumerate(
        [
            datetime(2026, 8, 20, 6, 0, tzinfo=ZoneInfo("UTC")),
            datetime(2026, 8, 20, 20, 59, tzinfo=ZoneInfo("UTC")),
        ],
        start=1,
    ):
        Issue.objects.create(
            workspace=workspace,
            project=project,
            state=state,
            name=f"Subgrouped calendar issue {index}",
            target_date=target_date,
        )

    queryset = Issue.issue_objects.filter(project=project)
    paginator = SubGroupedOffsetPaginator(
        queryset=queryset,
        group_by_field_name="target_date",
        sub_group_by_field_name="state__group",
        group_by_fields=list(queryset.values_list("target_date", flat=True).distinct()),
        sub_group_by_fields=["unstarted"],
        count_filter=Q(),
        order_by="target_date",
        on_results=lambda issues: list(issues.values("id", "target_date", "state__group")),
    )

    with timezone.override(ZoneInfo("Europe/Moscow")):
        first_page = paginator.get_result(limit=4, cursor=Cursor(4, 0, False))
        grouped_results = paginator.process_results(paginator.on_results(first_page.results))

    assert set(grouped_results) == {"2026-08-20"}
    assert len(grouped_results["2026-08-20"]["results"]["unstarted"]["results"]) == 2
    assert grouped_results["2026-08-20"]["total_results"] == 2
