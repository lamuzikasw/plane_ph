"""Permissions are checked with the end user's credentials, never the service token."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from plane.db.models import GitLabUserConnection
from plane.license.utils.encryption import decrypt_data, encrypt_data
from .client import GitLabClient, GitLabError, oauth_token


def user_client(integration, user):
    connection = GitLabUserConnection.objects.filter(integration=integration, user=user).first()
    if not connection:
        raise GitLabError("user_not_connected", 403)
    if connection.expires_at and connection.expires_at <= timezone.now() + timedelta(seconds=60):
        with transaction.atomic():
            connection = GitLabUserConnection.objects.select_for_update().get(pk=connection.pk)
            if connection.expires_at <= timezone.now() + timedelta(seconds=60):
                if not connection.refresh_token_encrypted:
                    raise GitLabError("user_reconnect_required", 403)
                tokens = oauth_token(
                    integration,
                    grant_type="refresh_token",
                    refresh_token=decrypt_data(connection.refresh_token_encrypted),
                    redirect_uri=connection.redirect_uri,
                )
                connection.token_encrypted = encrypt_data(tokens["access_token"])
                connection.refresh_token_encrypted = encrypt_data(tokens["refresh_token"])
                connection.expires_at = timezone.now() + timedelta(seconds=tokens.get("expires_in", 7200))
                connection.save()
    return GitLabClient(integration.base_url, decrypt_data(connection.token_encrypted))


def capabilities(repository, user) -> set[str]:
    client = user_client(repository.integration, user)
    prefix = f"projects/{repository.gitlab_id}"
    # Guest may see a private project's CI while having no repository access.
    # A successful GET /projects/:id or a membership role is insufficient.
    client.get(f"{prefix}/repository/commits", {"per_page": 1})
    allowed = {"commit"}
    categories = [
        ("branch", "repository/branches"),
        ("mr", "merge_requests"),
        ("pipeline", "pipelines"),
        ("job", "jobs"),
    ]
    # OAuth lookup/refresh and the mandatory code-access guard stay on the
    # request thread. GitLabClient.get only reads credentials and performs an
    # independent requests.get, so these category probes share no ORM/session.
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="gitlab-permissions") as executor:
        probes = [(kind, executor.submit(client.get, f"{prefix}/{path}", {"per_page": 1})) for kind, path in categories]
        for kind, probe in probes:
            try:
                probe.result()
                allowed.add(kind)
            except GitLabError as error:
                if error.code not in ("access_denied", "not_found"):
                    # Fail closed on outages, expired credentials and ambiguous responses.
                    raise
    return allowed
