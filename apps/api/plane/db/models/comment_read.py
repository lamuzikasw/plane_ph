from uuid import uuid4

from django.conf import settings
from django.db import models
from django.utils import timezone


class IssueCommentRead(models.Model):
    """Private receipts for replies actually seen by a user, not a thread-wide cursor."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    comment = models.ForeignKey("db.IssueComment", on_delete=models.CASCADE, related_name="read_receipts")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comment_reads")
    read_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "issue_comment_reads"
        constraints = [models.UniqueConstraint(fields=["comment", "user"], name="unique_comment_reader")]
