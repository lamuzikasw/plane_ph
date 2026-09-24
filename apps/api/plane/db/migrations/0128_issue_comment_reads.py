import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0127_issue_placements"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueCommentRead",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("read_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("comment", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="read_receipts", to="db.issuecomment")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="comment_reads", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "issue_comment_reads",
                "constraints": [models.UniqueConstraint(fields=("comment", "user"), name="unique_comment_reader")],
            },
        ),
    ]
