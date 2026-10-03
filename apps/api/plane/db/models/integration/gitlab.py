"""Read-only GitLab development data, scoped to one Plane workspace."""

from django.conf import settings
from django.db import models

from plane.db.models.base import BaseModel


class GitLabIntegration(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="gitlab_integrations")
    base_url = models.URLField(max_length=500)
    name = models.CharField(max_length=200, default="GitLab")
    token_encrypted = models.TextField()
    webhook_secret_encrypted = models.TextField()
    client_id = models.TextField(blank=True)
    client_secret_encrypted = models.TextField(blank=True)
    enabled = models.BooleanField(default=True)
    status = models.CharField(max_length=30, default="pending")
    error_code = models.CharField(max_length=60, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "gitlab_integrations"
        unique_together = [("workspace", "base_url")]


class GitLabRepository(BaseModel):
    integration = models.ForeignKey(GitLabIntegration, on_delete=models.CASCADE, related_name="repositories")
    gitlab_id = models.BigIntegerField()
    path = models.CharField(max_length=1000)
    web_url = models.URLField(max_length=1500)
    enabled = models.BooleanField(default=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_reconciled_at = models.DateTimeField(null=True, blank=True)
    discovery_heads = models.JSONField(default=dict)
    error_code = models.CharField(max_length=60, blank=True)

    class Meta:
        db_table = "gitlab_repositories"
        unique_together = [("integration", "gitlab_id")]


class GitLabUserConnection(BaseModel):
    integration = models.ForeignKey(GitLabIntegration, on_delete=models.CASCADE, related_name="user_connections")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    gitlab_user_id = models.BigIntegerField()
    username = models.CharField(max_length=255)
    token_encrypted = models.TextField()
    refresh_token_encrypted = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    redirect_uri = models.URLField(max_length=1500, blank=True)

    class Meta:
        db_table = "gitlab_user_connections"
        unique_together = [("integration", "user")]


class GitLabOAuthAttempt(BaseModel):
    integration = models.ForeignKey(GitLabIntegration, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    nonce_hash = models.CharField(max_length=64, unique=True)
    session_hash = models.CharField(max_length=64)
    verifier_encrypted = models.TextField()
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "gitlab_oauth_attempts"


class GitLabObject(BaseModel):
    KINDS = [(kind, kind) for kind in ("mr", "commit", "pipeline", "job", "branch")]
    repository = models.ForeignKey(GitLabRepository, on_delete=models.CASCADE, related_name="development_objects")
    kind = models.CharField(max_length=20, choices=KINDS)
    external_id = models.CharField(max_length=128)
    # Only explicitly selected metadata is cached: never variables, traces or files.
    data = models.JSONField(default=dict)
    source_updated_at = models.DateTimeField(null=True, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "gitlab_objects"
        unique_together = [("repository", "kind", "external_id")]


class GitLabObjectRelation(BaseModel):
    parent = models.ForeignKey(GitLabObject, on_delete=models.CASCADE, related_name="child_relations")
    child = models.ForeignKey(GitLabObject, on_delete=models.CASCADE, related_name="parent_relations")

    class Meta:
        db_table = "gitlab_object_relations"
        unique_together = [("parent", "child")]


class GitLabIssueLink(BaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="gitlab_links")
    object = models.ForeignKey(GitLabObject, on_delete=models.CASCADE, related_name="issue_links")
    origins = models.JSONField(default=list)
    # A tombstone prevents repeated events from restoring an explicitly removed link.
    suppressed = models.BooleanField(default=False)
    pinned = models.BooleanField(default=False)

    class Meta:
        db_table = "gitlab_issue_links"
        unique_together = [("issue", "object")]


class GitLabWebhookEvent(BaseModel):
    integration = models.ForeignKey(GitLabIntegration, on_delete=models.CASCADE)
    repository = models.ForeignKey(GitLabRepository, on_delete=models.CASCADE)
    fingerprint = models.CharField(max_length=64)
    event_type = models.CharField(max_length=80)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default="pending", db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=60, blank=True)

    class Meta:
        db_table = "gitlab_webhook_events"
        unique_together = [("integration", "fingerprint")]


class GitLabDiagnostic(BaseModel):
    repository = models.ForeignKey(GitLabRepository, on_delete=models.CASCADE)
    marker = models.CharField(max_length=80)
    external_id = models.CharField(max_length=128)
    kind = models.CharField(max_length=20)
    code = models.CharField(max_length=40, default="issue_not_found")

    class Meta:
        db_table = "gitlab_diagnostics"
        unique_together = [("repository", "marker", "external_id", "kind")]
