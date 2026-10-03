import base64
import hashlib
import json
import re
import secrets
from datetime import timedelta
from urllib.parse import unquote, urlencode, urlsplit

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.views.issue.placement import resolve_issue
from plane.db.models import (
    GitLabIntegration,
    GitLabRepository,
    GitLabUserConnection,
    GitLabOAuthAttempt,
    GitLabObject,
    GitLabIssueLink,
    GitLabWebhookEvent,
    WorkspaceMember,
)
from plane.license.utils.encryption import encrypt_data, decrypt_data
from plane.utils.gitlab.access import capabilities
from plane.utils.gitlab.client import GitLabClient, GitLabError, validate_base_url, oauth_token
from plane.utils.gitlab.presentation import development_data, integration_info
from plane.utils.gitlab.sync import RepositorySync, associate, record_error


def workspace_member(slug, user, *, admin=False):
    member = WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True).first()
    if not member or (admin and member.role < 20):
        raise PermissionDenied(
            "Workspace administrator access is required." if admin else "Workspace access is required."
        )
    return member


class GitLabAPIView(BaseAPIView):
    def handle_exception(self, exc):
        if isinstance(exc, GitLabError):
            status = 403 if exc.code in ("access_denied", "user_not_connected", "user_reconnect_required") else 503
            return Response({"error": exc.code}, status=status)
        return super().handle_exception(exc)


class ConfigurationInput(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    base_url = serializers.CharField(max_length=500)
    name = serializers.CharField(max_length=200, default="GitLab")
    token = serializers.CharField(required=False, write_only=True, trim_whitespace=True, max_length=5000)
    repository_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=100)
    client_id = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    client_secret = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=5000)
    enabled = serializers.BooleanField(default=True)

    def validate_base_url(self, value):
        return validate_base_url(value)


class GitLabIntegrationsEndpoint(GitLabAPIView):
    def get(self, request, slug):
        member = workspace_member(slug, request.user)
        integrations = list(GitLabIntegration.objects.filter(workspace=member.workspace))
        result = []
        for integration in integrations:
            item = integration_info(integration, request.user)
            if member.role >= 20:
                item.update(
                    {
                        "repository_ids": list(
                            integration.repositories.filter(enabled=True).values_list("gitlab_id", flat=True)
                        ),
                        "client_id": integration.client_id,
                        "webhook_url": request.build_absolute_uri(
                            f"/api/integrations/gitlab/{integration.id}/webhook/"
                        ),
                        "callback_url": request.build_absolute_uri("/api/integrations/gitlab/callback/"),
                    }
                )
            result.append(item)
        return Response({"integrations": result, "can_configure": member.role >= 20})

    def post(self, request, slug):
        member = workspace_member(slug, request.user, admin=True)
        serializer = ConfigurationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        existing = GitLabIntegration.objects.filter(workspace=member.workspace, base_url=data["base_url"]).first()
        if data.get("id") and (not existing or existing.id != data["id"]):
            raise ValidationError("Integration does not belong to this workspace/origin.")
        if existing and not data["enabled"]:
            # Pausing must work even when GitLab or its expired technical token is unavailable.
            existing.enabled = False
            existing.status = "paused"
            existing.save(update_fields=["enabled", "status", "updated_at"])
            return Response(
                {
                    **integration_info(existing, request.user),
                    "webhook_secret": decrypt_data(existing.webhook_secret_encrypted),
                },
                status=201,
            )
        token = data.get("token") or (decrypt_data(existing.token_encrypted) if existing else "")
        client = GitLabClient(data["base_url"], token)
        try:
            token_info = client.one("personal_access_tokens/self")
            if set(token_info.get("scopes", [])) != {"read_api"}:
                raise ValidationError({"token": "Use a separate token with read_api only."})
            repositories = []
            for key in sorted(set(data["repository_ids"])):
                repository = client.one(f"projects/{key}")
                permissions = repository.get("permissions") or {}
                roles = [
                    (permissions.get(level) or {}).get("access_level", 0)
                    for level in ("project_access", "group_access")
                ]
                if max(roles) != 20:
                    raise ValidationError(
                        {"token": "The technical account must have Reporter access in every repository."}
                    )
                repositories.append(repository)
        except GitLabError as error:
            if existing:
                record_error(existing.id, error)
            raise ValidationError({"token": error.code}) from None
        with transaction.atomic():
            integration, _ = GitLabIntegration.objects.get_or_create(
                workspace=member.workspace,
                base_url=data["base_url"],
                defaults={
                    "token_encrypted": encrypt_data(token),
                    "webhook_secret_encrypted": encrypt_data(secrets.token_urlsafe(32)),
                },
            )
            integration.name = data["name"]
            integration.enabled = data["enabled"]
            integration.token_encrypted = encrypt_data(token)
            if "client_id" in data:
                integration.client_id = data["client_id"]
            if data.get("client_secret"):
                integration.client_secret_encrypted = encrypt_data(data["client_secret"])
            integration.status = "pending" if integration.enabled else "paused"
            integration.error_code = ""
            integration.save()
            integration.repositories.exclude(gitlab_id__in=data["repository_ids"]).update(enabled=False)
            for repository in repositories:
                GitLabRepository.objects.update_or_create(
                    integration=integration,
                    gitlab_id=repository["id"],
                    defaults={
                        "path": repository["path_with_namespace"],
                        "web_url": repository["web_url"],
                        "enabled": True,
                    },
                )
        from plane.bgtasks.gitlab_task import reconcile_gitlab_integration

        try:
            reconcile_gitlab_integration.delay(str(integration.id))
        except Exception:
            # The periodic reconciler recovers saved configurations after broker outages.
            pass
        return Response(
            {
                **integration_info(integration, request.user),
                "webhook_secret": decrypt_data(integration.webhook_secret_encrypted),
            },
            status=201,
        )


class GitLabOAuthStartEndpoint(GitLabAPIView):
    def post(self, request, slug, integration_id):
        workspace_member(slug, request.user)
        integration = get_object_or_404(GitLabIntegration, pk=integration_id, workspace__slug=slug)
        if not integration.client_id or not integration.client_secret_encrypted:
            raise ValidationError("An administrator must configure the GitLab OAuth application first.")
        return_path = request.data.get("return_path", f"/{slug}/settings/integrations/")
        if not isinstance(return_path, str) or not return_path.startswith(f"/{slug}/") or urlsplit(return_path).netloc:
            raise ValidationError("Invalid return path.")
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        callback = request.build_absolute_uri("/api/integrations/gitlab/callback/")
        state = signing.dumps(
            {
                "integration": str(integration.id),
                "user": str(request.user.id),
                "nonce": nonce,
                "return": return_path,
                "callback": callback,
            },
            salt="gitlab-development",
        )
        if not request.session.session_key:
            request.session.create()
        # Read-only requests save sessions too. Keep one-use OAuth state outside
        # the session so a concurrent stale session save cannot erase it.
        GitLabOAuthAttempt.objects.create(
            integration=integration,
            user=request.user,
            nonce_hash=hashlib.sha256(nonce.encode()).hexdigest(),
            session_hash=hashlib.sha256(request.session.session_key.encode()).hexdigest(),
            verifier_encrypted=encrypt_data(verifier),
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        return Response(
            {
                "url": f"{integration.base_url}/oauth/authorize?"
                + urlencode(
                    {
                        "client_id": integration.client_id,
                        "redirect_uri": callback,
                        "response_type": "code",
                        "scope": "read_api",
                        "state": state,
                        "code_challenge": challenge,
                        "code_challenge_method": "S256",
                    }
                )
            }
        )


class GitLabOAuthCallbackEndpoint(GitLabAPIView):
    def get(self, request):
        try:
            state = signing.loads(request.query_params.get("state", ""), salt="gitlab-development", max_age=600)
        except signing.BadSignature:
            raise ValidationError("Invalid or expired OAuth state.") from None
        if state.get("user") != str(request.user.id):
            raise PermissionDenied("OAuth account does not match the current Plane session.")
        integration = get_object_or_404(GitLabIntegration, pk=state["integration"])
        workspace_member(integration.workspace.slug, request.user)
        with transaction.atomic():
            attempt = (
                GitLabOAuthAttempt.objects.select_for_update()
                .filter(
                    integration=integration,
                    user=request.user,
                    nonce_hash=hashlib.sha256(state["nonce"].encode()).hexdigest(),
                    session_hash=hashlib.sha256((request.session.session_key or "").encode()).hexdigest(),
                    consumed_at__isnull=True,
                    expires_at__gt=timezone.now(),
                )
                .first()
            )
            if not attempt:
                raise ValidationError("OAuth state has already been used or belongs to another session.")
            attempt.consumed_at = timezone.now()
            attempt.save(update_fields=["consumed_at", "updated_at"])
            verifier = decrypt_data(attempt.verifier_encrypted)
        if request.query_params.get("error") or not request.query_params.get("code"):
            raise ValidationError("GitLab authorization was not completed.")
        tokens = oauth_token(
            integration,
            grant_type="authorization_code",
            code=request.query_params["code"],
            redirect_uri=state["callback"],
            code_verifier=verifier,
        )
        identity = GitLabClient(integration.base_url, tokens["access_token"]).one("user")
        GitLabUserConnection.objects.update_or_create(
            integration=integration,
            user=request.user,
            defaults={
                "gitlab_user_id": identity["id"],
                "username": identity["username"],
                "token_encrypted": encrypt_data(tokens["access_token"]),
                "refresh_token_encrypted": encrypt_data(tokens.get("refresh_token", "")),
                "expires_at": timezone.now() + timedelta(seconds=tokens.get("expires_in", 7200)),
                "redirect_uri": state["callback"],
            },
        )
        return HttpResponseRedirect(settings.WEB_URL.rstrip("/") + state["return"])


class LinkInput(serializers.Serializer):
    url = serializers.URLField(max_length=2000, required=False)
    object_id = serializers.UUIDField(required=False)
    action = serializers.ChoiceField(choices=["add", "pin", "unpin", "unlink", "restore"], default="add")


class GitLabDevelopmentEndpoint(GitLabAPIView):
    def get(self, request, slug, project_id, issue_id):
        issue, _, _ = resolve_issue(slug, project_id, issue_id, request.user)
        return Response(development_data(issue, request.user))

    def post(self, request, slug, project_id, issue_id):
        issue, _, project = resolve_issue(slug, project_id, issue_id, request.user, write=True)
        if issue.archived_at or project.archived_at:
            raise PermissionDenied("Archived work items cannot be edited.")
        serializer = LinkInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        obj = None
        if data.get("object_id"):
            obj = get_object_or_404(
                GitLabObject,
                pk=data["object_id"],
                repository__integration__workspace=issue.workspace,
                repository__enabled=True,
            )
            repository = obj.repository
            kind, key = obj.kind, obj.external_id
            if kind == "branch":
                # Branch identities are hashes; GitLab's API accepts the complete name.
                key = obj.data.get("name")
                if not isinstance(key, str) or not key:
                    raise ValidationError("Invalid GitLab branch name.")
        elif data.get("url"):
            url = urlsplit(data["url"])
            if url.username or url.password or "/-/" not in url.path:
                raise ValidationError("Paste a GitLab branch, MR, commit, pipeline or job URL.")
            path, object_path = url.path.split("/-/", 1)
            parts = object_path.strip("/").split("/")
            kinds = {
                "tree": "branch",
                "merge_requests": "mr",
                "commit": "commit",
                "pipelines": "pipeline",
                "jobs": "job",
            }
            if len(parts) < 2 or parts[0] not in kinds:
                raise ValidationError("Unsupported GitLab URL.")
            kind = kinds[parts[0]]
            key = unquote("/".join(parts[1:])) if kind == "branch" else parts[1]
            if kind == "branch":
                if not key or len(key) > 1000 or re.search(r"[\x00-\x20\x7f]", key):
                    raise ValidationError("Invalid GitLab branch name.")
            elif len(parts) != 2 or not re.fullmatch(
                r"(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})" if kind == "commit" else r"[1-9]\d*", key
            ):
                raise ValidationError("Invalid GitLab object ID.")
            repository = get_object_or_404(
                GitLabRepository,
                integration__workspace=issue.workspace,
                integration__base_url=f"{url.scheme}://{url.netloc}",
                path=path.strip("/"),
                enabled=True,
            )
        else:
            raise ValidationError("Specify url or object_id.")
        if kind not in capabilities(repository, request.user):
            raise PermissionDenied("GitLab does not grant access to this object.")
        with transaction.atomic():
            # The same lock as webhook processing prevents late snapshots overwriting new ones.
            repository = (
                GitLabRepository.objects.select_for_update().select_related("integration").get(pk=repository.id)
            )
            action = data["action"]
            if action in ("add", "pin", "restore"):
                if action == "pin" and kind != "job":
                    raise ValidationError("Only job runs can be pinned.")
                sync = RepositorySync(repository)
                with sync:
                    obj = sync.object(kind, key)
                associate(issue, obj, "pin" if kind == "job" else "manual", restore=True, pinned=kind == "job")
            else:
                if obj is None:
                    raise ValidationError("An existing object_id is required.")
                # Unlinking creates a tombstone even for an object inherited through an MR.
                link, _ = GitLabIssueLink.objects.get_or_create(issue=issue, object=obj)
                link.pinned = False
                if action == "unlink":
                    link.suppressed = True
                elif action == "unpin":
                    link.origins = [origin for origin in link.origins if origin != "pin"]
                link.save()
        return Response(development_data(issue, request.user))


class GitLabWebhookEndpoint(BaseAPIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, integration_id):
        if len(request.body) > 1024 * 1024:
            return Response(status=413)
        integration = get_object_or_404(GitLabIntegration, pk=integration_id, enabled=True)
        supplied = request.headers.get("X-Gitlab-Token", "")
        if not supplied or not secrets.compare_digest(supplied, decrypt_data(integration.webhook_secret_encrypted)):
            return Response(status=403)
        payload = request.data
        if not isinstance(payload, dict):
            return Response(status=400)
        event_type = request.headers.get("X-Gitlab-Event", "")
        if event_type not in ("Push Hook", "Tag Push Hook", "Merge Request Hook", "Pipeline Hook", "Job Hook"):
            return Response(status=202)
        project = payload.get("project") or {}
        attributes = payload.get("object_attributes") or {}
        if not isinstance(project, dict) or not isinstance(attributes, dict):
            return Response(status=400)
        project_id = payload.get("project_id") or project.get("id")
        if not isinstance(project_id, int) or isinstance(project_id, bool) or project_id < 1:
            return Response(status=400)
        repository = integration.repositories.filter(gitlab_id=project_id, enabled=True).first()
        if not repository:
            return Response(status=403)
        key = (
            attributes.get("iid")
            if event_type == "Merge Request Hook"
            else attributes.get("id")
            if event_type == "Pipeline Hook"
            else payload.get("build_id")
            if event_type == "Job Hook"
            else 1
        )
        if not isinstance(key, int) or isinstance(key, bool) or key < 1:
            return Response(status=400)
        fingerprint = hashlib.sha256((event_type + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
        # The outbox needs identifiers only. Never retain webhook variables, traces,
        # commit messages, descriptions or other unnecessary private payload fields.
        event_payload = {"project_id": project_id}
        if event_type in ("Merge Request Hook", "Pipeline Hook"):
            event_payload["object_attributes"] = {"iid" if event_type == "Merge Request Hook" else "id": key}
            mr = payload.get("merge_request")
            if isinstance(mr, dict) and isinstance(mr.get("iid"), int):
                event_payload["merge_request"] = {"iid": mr["iid"]}
        elif event_type == "Job Hook":
            event_payload["build_id"] = key
        elif event_type in ("Push Hook", "Tag Push Hook"):
            # Keep only revision identifiers. A queued push may no longer be
            # reachable from current refs by the time a worker processes it.
            for field in ("before", "after"):
                if field in payload:
                    sha = payload[field]
                    if not isinstance(sha, str) or not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", sha):
                        return Response(status=400)
                    event_payload[field] = sha.lower()
        with transaction.atomic():
            event, _ = GitLabWebhookEvent.objects.get_or_create(
                integration=integration,
                fingerprint=fingerprint,
                defaults={"repository": repository, "event_type": event_type, "payload": event_payload},
            )
            from plane.bgtasks.gitlab_task import enqueue_event

            transaction.on_commit(lambda: enqueue_event(str(event.id)))
        return Response(status=202)
