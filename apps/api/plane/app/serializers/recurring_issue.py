# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import Issue, RecurringIssueSchedule
from plane.utils.recurring_issue import calculate_next_run, valid_timezone


class RecurringIssueScheduleSerializer(serializers.ModelSerializer):
    source_issue_id = serializers.PrimaryKeyRelatedField(source="source_issue", queryset=Issue.objects.all())
    source_issue_name = serializers.CharField(source="source_issue.name", read_only=True)
    source_issue_sequence_id = serializers.IntegerField(source="source_issue.sequence_id", read_only=True)
    project_identifier = serializers.CharField(source="project.identifier", read_only=True)
    occurrence_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = RecurringIssueSchedule
        fields = [
            "id",
            "source_issue_id",
            "source_issue_name",
            "source_issue_sequence_id",
            "project_identifier",
            "frequency",
            "interval",
            "weekdays",
            "start_date",
            "end_date",
            "run_time",
            "timezone",
            "due_offset_days",
            "due_time",
            "is_active",
            "next_run_at",
            "last_run_at",
            "last_error",
            "occurrence_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "timezone",
            "next_run_at",
            "last_run_at",
            "last_error",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        instance = self.instance
        project = self.context["project"]
        source_issue = attrs.get("source_issue", getattr(instance, "source_issue", None))
        frequency = attrs.get("frequency", getattr(instance, "frequency", "daily"))
        interval = attrs.get("interval", getattr(instance, "interval", 1))
        weekdays = attrs.get("weekdays", getattr(instance, "weekdays", []))
        start_date = attrs.get("start_date", getattr(instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(instance, "end_date", None))
        run_time = attrs.get("run_time", getattr(instance, "run_time", None))
        due_time = attrs.get("due_time", getattr(instance, "due_time", None))
        due_offset_days = attrs.get("due_offset_days", getattr(instance, "due_offset_days", 0))

        if not source_issue or source_issue.project_id != project.id:
            raise serializers.ValidationError({"source_issue_id": "Work item must belong to this project."})
        if interval < 1 or interval > 365:
            raise serializers.ValidationError({"interval": "Interval must be between 1 and 365."})
        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError({"end_date": "End date cannot precede start date."})
        if due_offset_days == 0 and run_time and due_time and due_time < run_time:
            raise serializers.ValidationError({"due_time": "The due time must be later than the creation time."})
        if frequency == RecurringIssueSchedule.Frequency.WEEKLY:
            normalized = sorted({int(day) for day in weekdays if isinstance(day, int) and 0 <= day <= 6})
            if not normalized:
                raise serializers.ValidationError({"weekdays": "Select at least one weekday."})
            attrs["weekdays"] = normalized
        else:
            attrs["weekdays"] = []
        attrs["timezone"] = valid_timezone(project.timezone or "UTC")
        return attrs

    def _set_next_run(self, schedule):
        schedule.next_run_at = (
            calculate_next_run(
                frequency=schedule.frequency,
                interval=schedule.interval,
                weekdays=schedule.weekdays,
                start_date=schedule.start_date,
                end_date=schedule.end_date,
                run_time=schedule.run_time,
                timezone_name=schedule.timezone,
            )
            if schedule.is_active
            else None
        )
        if schedule.is_active and schedule.next_run_at is None:
            schedule.is_active = False
        schedule.last_error = ""
        schedule.save(update_fields=["next_run_at", "is_active", "last_error", "updated_at"])
        return schedule

    def create(self, validated_data):
        schedule = RecurringIssueSchedule.objects.create(project=self.context["project"], **validated_data)
        return self._set_next_run(schedule)

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        return self._set_next_run(instance)
