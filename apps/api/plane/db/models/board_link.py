import secrets

from django.conf import settings
from django.db import models


def board_link_token():
    return secrets.token_urlsafe(9)


class BoardLink(models.Model):
    """An immutable, project-scoped snapshot. A link never grants access to a project."""

    token = models.CharField(primary_key=True, max_length=12, default=board_link_token, editable=False)
    fingerprint = models.CharField(max_length=64, unique=True)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="board_links")
    cycle = models.ForeignKey("db.Cycle", null=True, blank=True, on_delete=models.CASCADE, related_name="board_links")
    filters = models.JSONField(default=dict)
    display = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)

    class Meta:
        db_table = "board_links"
