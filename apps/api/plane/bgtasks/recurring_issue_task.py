# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueLabel,
    ModuleIssue,
    ProjectMember,
    RecurringIssueOccurrence,
    RecurringIssueSchedule,
    State,
)
from plane.utils.exception_logger import log_exception
from plane.utils.recurring_issue import calculate_next_run, valid_timezone


def _create_issue_from_schedule(schedule, scheduled_for):
    source = schedule.source_issue
    project = schedule.project
    if source is None:
        raise ValueError("The source work item no longer exists")

    initial_state = (
        project.default_state
        or State.objects.filter(project=project, is_triage=False, default=True).first()
        or State.objects.filter(project=project, is_triage=False).first()
    )
    if initial_state is None:
        raise ValueError("The project has no initial state")

    local_tz = ZoneInfo(valid_timezone(schedule.timezone))
    local_run = scheduled_for.astimezone(local_tz)
    due_date = local_run.date() + timedelta(days=schedule.due_offset_days)
    target_date = datetime.combine(due_date, schedule.due_time, tzinfo=local_tz)
    issue = Issue(
        project=project,
        workspace=project.workspace,
        name=source.name,
        description_json=source.description_json,
        description_html=source.description_html,
        description_binary=source.description_binary,
        priority=source.priority,
        estimate_point=source.estimate_point,
        type=source.type,
        state=initial_state,
        start_date=local_run,
        target_date=target_date,
    )
    issue.save(created_by_id=schedule.created_by_id)

    audit_fields = {
        "project_id": project.id,
        "workspace_id": project.workspace_id,
        "created_by_id": schedule.created_by_id,
    }
    assignee_ids = ProjectMember.objects.filter(
        project=project,
        member_id__in=source.issue_assignee.values_list("assignee_id", flat=True),
        role__gte=15,
        is_active=True,
    ).values_list("member_id", flat=True)
    IssueAssignee.objects.bulk_create(
        [IssueAssignee(issue=issue, assignee_id=value, **audit_fields) for value in assignee_ids],
        ignore_conflicts=True,
    )
    IssueLabel.objects.bulk_create(
        [
            IssueLabel(issue=issue, label_id=value, **audit_fields)
            for value in source.label_issue.values_list("label_id", flat=True)
        ],
        ignore_conflicts=True,
    )
    ModuleIssue.objects.bulk_create(
        [
            ModuleIssue(issue=issue, module_id=value, **audit_fields)
            for value in source.issue_module.values_list("module_id", flat=True)
        ],
        ignore_conflicts=True,
    )
    return issue


def process_recurring_schedule(schedule_id):
    with transaction.atomic():
        schedule = (
            RecurringIssueSchedule.objects.select_for_update(of=("self",))
            .select_related("source_issue", "project", "project__default_state", "project__workspace")
            .get(id=schedule_id)
        )
        if not schedule.is_active or schedule.next_run_at is None or schedule.next_run_at > timezone.now():
            return None

        scheduled_for = schedule.next_run_at
        occurrence = RecurringIssueOccurrence.objects.filter(schedule=schedule, scheduled_for=scheduled_for).first()
        if occurrence is None:
            issue = _create_issue_from_schedule(schedule, scheduled_for)
            RecurringIssueOccurrence.objects.create(
                schedule=schedule,
                issue=issue,
                project=schedule.project,
                scheduled_for=scheduled_for,
                created_by_id=schedule.created_by_id,
            )
        else:
            issue = occurrence.issue

        schedule.last_run_at = scheduled_for
        schedule.next_run_at = calculate_next_run(
            frequency=schedule.frequency,
            interval=schedule.interval,
            weekdays=schedule.weekdays,
            start_date=schedule.start_date,
            end_date=schedule.end_date,
            run_time=schedule.run_time,
            timezone_name=schedule.timezone,
            after=max(scheduled_for, timezone.now()),
        )
        schedule.is_active = schedule.next_run_at is not None
        schedule.last_error = ""
        schedule.save(update_fields=["last_run_at", "next_run_at", "is_active", "last_error", "updated_at"])
        return issue.id if issue else None


@shared_task
def create_due_recurring_issues():
    schedule_ids = list(
        RecurringIssueSchedule.objects.filter(is_active=True, next_run_at__lte=timezone.now())
        .order_by("next_run_at")
        .values_list("id", flat=True)[:200]
    )
    for schedule_id in schedule_ids:
        try:
            process_recurring_schedule(schedule_id)
        except Exception as exc:
            log_exception(exc)
            update = {"last_error": str(exc)[:2000]}
            if isinstance(exc, ValueError):
                update.update({"is_active": False, "next_run_at": None})
            RecurringIssueSchedule.objects.filter(id=schedule_id).update(**update)
