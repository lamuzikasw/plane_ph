from datetime import date, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from plane.bgtasks.recurring_issue_task import process_recurring_schedule
from plane.db.models import (
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    RecurringIssueOccurrence,
    RecurringIssueSchedule,
    State,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_due_schedule_creates_one_fresh_work_item_with_exact_times():
    owner = UserFactory(email="recurring-owner@plane.so", username="recurring-owner@plane.so")
    workspace = WorkspaceFactory(slug="recurring-work-items", owner=owner, timezone="Europe/Moscow")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=20)
    project = Project.objects.create(workspace=workspace, name="Daily operations", identifier="DAY")
    ProjectMember.objects.create(workspace=workspace, project=project, member=owner, role=20)
    todo = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
        default=True,
    )
    project.default_state = todo
    project.save(update_fields=["default_state"])
    source = Issue.objects.create(project=project, state=todo, name="Send daily report", priority="high")
    IssueAssignee.objects.create(project=project, issue=source, assignee=owner)
    scheduled_for = timezone.now() - timedelta(minutes=1)
    schedule = RecurringIssueSchedule.objects.create(
        project=project,
        source_issue=source,
        frequency="daily",
        interval=1,
        weekdays=[],
        start_date=date.today(),
        run_time=time(9, 0),
        timezone="Europe/Moscow",
        due_offset_days=0,
        due_time=time(18, 30),
        next_run_at=scheduled_for,
        created_by=owner,
    )

    created_issue_id = process_recurring_schedule(schedule.id)
    created = Issue.objects.get(id=created_issue_id)
    occurrence = RecurringIssueOccurrence.objects.get(schedule=schedule)

    assert created.name == source.name
    assert created.state_id == todo.id
    assert created.priority == "high"
    assert created.start_date == scheduled_for
    assert created.target_date.astimezone(ZoneInfo(project.timezone)).time().replace(tzinfo=None) == time(18, 30)
    assert list(created.assignees.values_list("id", flat=True)) == [owner.id]
    assert occurrence.issue_id == created.id

    process_recurring_schedule(schedule.id)
    assert RecurringIssueOccurrence.objects.filter(schedule=schedule).count() == 1
