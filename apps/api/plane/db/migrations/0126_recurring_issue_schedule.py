# Generated manually for the Community recurring work item implementation.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0125_align_management_analytics_audit_fields")]

    operations = [
        migrations.CreateModel(
            name="RecurringIssueSchedule",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("frequency", models.CharField(choices=[("daily", "Daily"), ("weekly", "Weekly")], default="daily", max_length=16)),
                ("interval", models.PositiveSmallIntegerField(default=1)),
                ("weekdays", models.JSONField(blank=True, default=list)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField(blank=True, null=True)),
                ("run_time", models.TimeField()),
                ("timezone", models.CharField(default="UTC", max_length=64)),
                ("due_offset_days", models.PositiveSmallIntegerField(default=0)),
                ("due_time", models.TimeField()),
                ("is_active", models.BooleanField(default=True)),
                ("next_run_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("last_run_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.TextField(blank=True, default="")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_%(class)s", to="db.project")),
                ("source_issue", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurring_schedules", to="db.issue")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_%(class)s", to="db.workspace")),
            ],
            options={"db_table": "recurring_issue_schedules", "ordering": ("next_run_at", "created_at")},
        ),
        migrations.CreateModel(
            name="RecurringIssueOccurrence",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("scheduled_for", models.DateTimeField()),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("issue", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurring_occurrence", to="db.issue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_%(class)s", to="db.project")),
                ("schedule", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="occurrences", to="db.recurringissueschedule")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_%(class)s", to="db.workspace")),
            ],
            options={"db_table": "recurring_issue_occurrences", "ordering": ("-scheduled_for",)},
        ),
        migrations.AddIndex(model_name="recurringissueschedule", index=models.Index(fields=["is_active", "next_run_at"], name="rec_issue_active_next_idx")),
        migrations.AddConstraint(model_name="recurringissueschedule", constraint=models.UniqueConstraint(condition=models.Q(("deleted_at__isnull", True)), fields=("source_issue",), name="rec_issue_unique_source")),
        migrations.AddConstraint(model_name="recurringissueoccurrence", constraint=models.UniqueConstraint(fields=("schedule", "scheduled_for"), name="rec_issue_occurrence_unique_run")),
    ]
