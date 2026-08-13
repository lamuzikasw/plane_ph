# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models

from .project import ProjectBaseModel


class RecurringIssueSchedule(ProjectBaseModel):
    class Frequency(models.TextChoices):
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"

    source_issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_schedules",
    )
    frequency = models.CharField(max_length=16, choices=Frequency.choices, default=Frequency.DAILY)
    interval = models.PositiveSmallIntegerField(default=1)
    weekdays = models.JSONField(default=list, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    run_time = models.TimeField()
    timezone = models.CharField(max_length=64, default="UTC")
    due_offset_days = models.PositiveSmallIntegerField(default=0)
    due_time = models.TimeField()
    is_active = models.BooleanField(default=True)
    next_run_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "recurring_issue_schedules"
        ordering = ("next_run_at", "created_at")
        indexes = [
            models.Index(fields=["is_active", "next_run_at"], name="rec_issue_active_next_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["source_issue"],
                condition=models.Q(deleted_at__isnull=True),
                name="rec_issue_unique_source",
            )
        ]


class RecurringIssueOccurrence(ProjectBaseModel):
    schedule = models.ForeignKey(
        RecurringIssueSchedule,
        on_delete=models.CASCADE,
        related_name="occurrences",
    )
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_occurrence",
    )
    scheduled_for = models.DateTimeField()

    class Meta:
        db_table = "recurring_issue_occurrences"
        ordering = ("-scheduled_for",)
        constraints = [
            models.UniqueConstraint(
                fields=["schedule", "scheduled_for"],
                name="rec_issue_occurrence_unique_run",
            )
        ]
