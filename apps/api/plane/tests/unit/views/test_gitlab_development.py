from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone

from plane.db.models import (
    GitLabDiagnostic,
    GitLabIntegration,
    GitLabIssueLink,
    GitLabObject,
    GitLabObjectRelation,
    GitLabOAuthAttempt,
    GitLabRepository,
    GitLabUserConnection,
    GitLabWebhookEvent,
    Issue,
    Project,
    ProjectMember,
    WorkspaceMember,
)
from plane.license.utils.encryption import encrypt_data
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.gitlab.client import GitLabClient, GitLabError, validate_base_url
from plane.utils.gitlab.presentation import development_data
from plane.utils.gitlab.sync import (
    RepositorySync,
    associate,
    branch_id,
    branch_keys,
    marker_links,
    markers,
    snapshot,
    sync_repository,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]
SHA = "a" * 40


@pytest.fixture
def pilot(api_client):
    user = UserFactory(username="pilot-owner")
    workspace = WorkspaceFactory(owner=user)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(workspace=workspace, name="Pilot", identifier="DEV")
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20)
    issue = Issue.objects.create(project=project, workspace=workspace, name="First")
    second = Issue.objects.create(project=project, workspace=workspace, name="Second")
    integration = GitLabIntegration.objects.create(
        workspace=workspace,
        base_url="https://gitlab.example.com",
        token_encrypted=encrypt_data("service-secret"),
        webhook_secret_encrypted=encrypt_data("hook-secret"),
        client_id="app-id",
        client_secret_encrypted=encrypt_data("app-secret"),
    )
    repository = GitLabRepository.objects.create(
        integration=integration, gitlab_id=83, path="team/pilot", web_url="https://gitlab.example.com/team/pilot"
    )
    api_client.force_authenticate(user=user)
    return api_client, user, workspace, project, issue, second, integration, repository


def endpoint(pilot):
    _, _, workspace, project, issue, *_ = pilot
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/development/"


def object_for(pilot, kind="commit", external_id=SHA, **data):
    return GitLabObject.objects.create(repository=pilot[-1], kind=kind, external_id=external_id, data=data)


@pytest.mark.parametrize(
    "text, expected",
    [
        ("plane:DEV-1 plane:DEV-1 plane:DEV-2", {("DEV", 1), ("DEV", 2)}),
        ("(plane:dev-1),\nplane:A_B-12", {("DEV", 1), ("A_B", 12)}),
        ("xplane:DEV-1 plane:DEV-0 plane:DEV-01 plane:DEV-1more plane:DEV-1-2", set()),
    ],
)
def test_markers_have_boundaries_and_deduplicate(text, expected):
    assert markers(text) == expected


def test_markers_link_multiple_issues_and_unknown_is_diagnostic(pilot):
    obj = object_for(pilot)
    for _ in range(2):
        marker_links(pilot[-1], obj, "plane:DEV-1 plane:DEV-2 plane:DEV-999")
    assert GitLabIssueLink.objects.count() == 2
    assert GitLabDiagnostic.objects.count() == 1
    assert Issue.objects.count() == 2


def test_same_marker_never_links_other_workspace(pilot):
    other = WorkspaceFactory(owner=UserFactory(username="other-owner"))
    project = Project.objects.create(workspace=other, name="Other", identifier="DEV")
    Issue.objects.create(workspace=other, project=project, name="Other issue")
    obj = object_for(pilot)
    marker_links(pilot[-1], obj, "plane:DEV-1")
    assert list(GitLabIssueLink.objects.values_list("issue_id", flat=True)) == [pilot[4].id]


def test_unlink_tombstone_survives_auto_sync_and_manual_restore(pilot):
    obj = object_for(pilot)
    link = associate(pilot[4], obj, "marker")
    link.suppressed = True
    link.save()
    marker_links(pilot[-1], obj, "plane:DEV-1")
    link.refresh_from_db()
    assert link.suppressed
    link = associate(pilot[4], obj, "manual", restore=True)
    assert not link.suppressed
    assert link.origins == ["manual", "marker"]


def test_snapshot_never_copies_job_logs_variables_or_artifact_contents():
    data = snapshot(
        "job",
        {
            "id": 1,
            "name": "test",
            "trace": "secret-log",
            "variables": [{"value": "secret"}],
            "artifacts": [
                {"file_type": "trace", "filename": "job.log"},
                {"file_type": "archive", "filename": "output.zip", "size": 42, "content": "secret"},
            ],
        },
    )
    assert "secret" not in str(data)
    assert data["artifacts"] == [{"file_type": "archive", "filename": "output.zip", "size": 42}]


def test_old_source_snapshot_cannot_regress_state(pilot):
    sync = RepositorySync(pilot[-1])
    obj = sync.save("pipeline", {"id": 1, "status": "success", "updated_at": "2026-10-03T10:00:00Z"})
    sync.save("pipeline", {"id": 1, "status": "running", "updated_at": "2026-10-03T09:00:00Z"})
    obj.refresh_from_db()
    assert obj.data["status"] == "success"


def test_unconnected_user_sees_no_repository_metadata(pilot):
    obj = object_for(pilot, message="private message")
    associate(pilot[4], obj, "manual")
    data = development_data(pilot[4], pilot[1])
    assert data["objects"] == [] and data["links"] == []
    assert data["access_errors"] == ["user_not_connected"]
    assert "private message" not in str(data)
    assert "service-secret" not in str(data) and "app-secret" not in str(data)


@pytest.mark.parametrize("code", ["access_denied", "token_invalid", "unavailable"])
def test_permission_failures_hide_cached_metadata(pilot, code):
    associate(pilot[4], object_for(pilot, message="private"), "marker")
    with patch("plane.utils.gitlab.presentation.capabilities", side_effect=GitLabError(code)):
        result = development_data(pilot[4], pilot[1])
    assert result["objects"] == [] and result["access_errors"] == [code]


def test_guest_ci_access_without_code_access_is_insufficient(pilot):
    from plane.utils.gitlab.access import capabilities

    GitLabUserConnection.objects.create(
        integration=pilot[-2],
        user=pilot[1],
        gitlab_user_id=2,
        username="guest",
        token_encrypted=encrypt_data("guest-token"),
    )
    with patch("plane.utils.gitlab.access.GitLabClient") as client:
        client.return_value.get.side_effect = GitLabError("access_denied", 403)
        with pytest.raises(GitLabError):
            capabilities(pilot[-1], pilot[1])
        assert client.return_value.get.call_count == 1
        assert client.call_args.args[1] == "guest-token"


def test_pinned_original_job_keeps_context_and_retry_is_separate(pilot):
    commit = object_for(pilot)
    pipeline = object_for(pilot, "pipeline", "1", sha=SHA)
    old = object_for(pilot, "job", "10", name="build", retried=True)
    retry = object_for(pilot, "job", "11", name="build", retried=False)
    for parent, child in [(commit, pipeline), (pipeline, old), (pipeline, retry)]:
        GitLabObjectRelation.objects.create(parent=parent, child=child)
    associate(pilot[4], old, "pin", pinned=True)
    with patch("plane.utils.gitlab.presentation.capabilities", return_value={"commit", "pipeline", "job"}):
        result = development_data(pilot[4], pilot[1])
    assert {obj["external_id"] for obj in result["objects"]} == {SHA, "1", "10", "11"}
    assert [link["object_id"] for link in result["links"] if link["pinned"]] == [str(old.id)]


def test_suppressed_inherited_object_is_hidden(pilot):
    mr = object_for(pilot, "mr", "1")
    commit = object_for(pilot)
    GitLabObjectRelation.objects.create(parent=mr, child=commit)
    associate(pilot[4], mr, "marker")
    link = associate(pilot[4], commit, "manual")
    link.suppressed = True
    link.save()
    with patch("plane.utils.gitlab.presentation.capabilities", return_value={"mr", "commit"}):
        assert [obj["kind"] for obj in development_data(pilot[4], pilot[1])["objects"]] == ["mr"]


def test_synthetic_merge_pipeline_is_attached_directly_to_mr(pilot):
    sync = RepositorySync(pilot[-1])

    def one(path):
        if path.endswith("merge_requests/1"):
            return {"id": 30, "iid": 1, "title": "plane:DEV-1"}
        if path.endswith("pipelines/5"):
            return {"id": 5, "sha": "b" * 40, "status": "success"}
        raise GitLabError("not_found", 404)

    sync.client.one = one
    sync.client.all = lambda path, params=None: [{"id": 5}] if path.endswith("merge_requests/1/pipelines") else []
    mr = sync.mr(1)
    assert GitLabObjectRelation.objects.get(parent=mr).child.kind == "pipeline"
    assert GitLabObject.objects.filter(kind="commit").count() == 0


def test_job_event_does_not_advance_commit_discovery_cursor(pilot):
    repository = pilot[-1]
    repository.last_reconciled_at = timezone.now() - timedelta(days=1)
    repository.save()
    previous = repository.last_reconciled_at
    with patch("plane.utils.gitlab.sync.RepositorySync.job"):
        sync_repository(repository.id, event={"build_id": 10}, event_type="Job Hook")
    repository.refresh_from_db()
    assert repository.last_reconciled_at == previous
    assert repository.last_synced_at > previous


def test_failed_sync_rolls_back_partial_data_and_records_health(pilot):
    def fail(sync):
        sync.save("commit", {"id": SHA, "message": "new"})
        raise GitLabError("token_invalid", 401)

    with patch.object(RepositorySync, "reconcile", fail), pytest.raises(GitLabError):
        sync_repository(pilot[-1].id)
    assert not GitLabObject.objects.exists()
    pilot[-2].refresh_from_db()
    assert pilot[-2].error_code == "token_invalid"


def test_webhook_auth_allowlist_dedup_and_outbox(pilot):
    client = pilot[0]
    url = f"/api/integrations/gitlab/{pilot[-2].id}/webhook/"
    payload = {"project": {"id": 83}, "object_attributes": {"id": 5}}
    assert client.post(url, payload, format="json", HTTP_X_GITLAB_EVENT="Pipeline Hook").status_code == 403
    with patch("plane.bgtasks.gitlab_task.enqueue_event"):
        for _ in range(2):
            assert (
                client.post(
                    url, payload, format="json", HTTP_X_GITLAB_EVENT="Pipeline Hook", HTTP_X_GITLAB_TOKEN="hook-secret"
                ).status_code
                == 202
            )
    assert GitLabWebhookEvent.objects.count() == 1
    assert GitLabWebhookEvent.objects.get().status == "pending"
    assert (
        client.post(
            url, {"project_id": 84}, format="json", HTTP_X_GITLAB_EVENT="Push Hook", HTTP_X_GITLAB_TOKEN="hook-secret"
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"project_id": "bad"},
        {"project": []},
        {"project_id": 83, "object_attributes": "bad"},
        {"project_id": 83, "object_attributes": {"id": "bad"}},
    ],
)
def test_malformed_webhooks_return_400(pilot, payload):
    response = pilot[0].post(
        f"/api/integrations/gitlab/{pilot[-2].id}/webhook/",
        payload,
        format="json",
        HTTP_X_GITLAB_EVENT="Pipeline Hook",
        HTTP_X_GITLAB_TOKEN="hook-secret",
    )
    assert response.status_code == 400


def test_done_webhook_is_not_processed_twice(pilot):
    from plane.bgtasks.gitlab_task import process_gitlab_event

    event = GitLabWebhookEvent.objects.create(
        integration=pilot[-2],
        repository=pilot[-1],
        fingerprint="one",
        event_type="Push Hook",
        payload={},
        status="done",
    )
    with patch("plane.bgtasks.gitlab_task.sync_repository") as sync:
        process_gitlab_event(str(event.id))
        sync.assert_not_called()


def test_untrusted_url_does_not_make_network_request(pilot):
    with (
        patch("plane.app.views.gitlab.capabilities") as permissions,
        patch("plane.app.views.gitlab.RepositorySync") as sync,
    ):
        response = pilot[0].post(
            endpoint(pilot), {"url": f"https://attacker.example/team/pilot/-/commit/{SHA}"}, format="json"
        )
    assert response.status_code == 404
    permissions.assert_not_called()
    sync.assert_not_called()


def test_guest_cannot_mutate_links(pilot):
    ProjectMember.objects.filter(project=pilot[3], member=pilot[1]).update(role=5)
    WorkspaceMember.objects.filter(workspace=pilot[2], member=pilot[1]).update(role=5)
    with patch("plane.app.views.gitlab.RepositorySync") as sync:
        response = pilot[0].post(
            endpoint(pilot), {"url": f"https://gitlab.example.com/team/pilot/-/commit/{SHA}"}, format="json"
        )
    assert response.status_code in (403, 404)
    sync.assert_not_called()


def test_non_admin_cannot_configure_connection(pilot):
    WorkspaceMember.objects.filter(workspace=pilot[2], member=pilot[1]).update(role=15)
    response = pilot[0].post(f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/", {}, format="json")
    assert response.status_code == 403


def test_oauth_state_rejects_other_session_replay_and_external_return(pilot):
    start = f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/{pilot[-2].id}/connect/"
    assert pilot[0].post(start, {"return_path": "//evil.example/"}, format="json").status_code == 400
    response = pilot[0].post(start, {}, format="json")
    assert response.status_code == 200
    from urllib.parse import parse_qs, urlsplit

    state = parse_qs(urlsplit(response.data["url"]).query)["state"][0]
    other = UserFactory(username="oauth-other")
    pilot[0].force_authenticate(user=other)
    assert pilot[0].get("/api/integrations/gitlab/callback/", {"state": state, "code": "code"}).status_code == 403
    pilot[0].force_authenticate(user=pilot[1])
    with (
        patch(
            "plane.app.views.gitlab.oauth_token",
            return_value={"access_token": "personal", "refresh_token": "refresh", "expires_in": 7200},
        ),
        patch("plane.app.views.gitlab.GitLabClient") as client,
    ):
        client.return_value.one.return_value = {"id": 1, "username": "developer"}
        assert pilot[0].get("/api/integrations/gitlab/callback/", {"state": state, "code": "code"}).status_code == 302
        assert pilot[0].get("/api/integrations/gitlab/callback/", {"state": state, "code": "code"}).status_code == 400
    assert GitLabUserConnection.objects.get().token_encrypted != "personal"


def test_oauth_attempt_survives_stale_session_save_and_is_session_bound(pilot):
    from urllib.parse import parse_qs, urlsplit
    from rest_framework.test import APIClient

    client = pilot[0]
    stale_session = client.session
    start = f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/{pilot[-2].id}/connect/"
    response = client.post(start, {}, format="json")
    state = parse_qs(urlsplit(response.data["url"]).query)["state"][0]
    # Simulate another tab writing the session snapshot it read before OAuth.
    stale_session.save()
    another_session = APIClient()
    another_session.force_authenticate(user=pilot[1])
    with (
        patch(
            "plane.app.views.gitlab.oauth_token",
            return_value={"access_token": "personal", "refresh_token": "refresh", "expires_in": 7200},
        ) as exchange,
        patch("plane.app.views.gitlab.GitLabClient") as gitlab,
    ):
        gitlab.return_value.one.return_value = {"id": 1, "username": "developer"}
        callback = "/api/integrations/gitlab/callback/"
        assert another_session.get(callback, {"state": state, "code": "code"}).status_code == 400
        exchange.assert_not_called()
        assert client.get(callback, {"state": state, "code": "code"}).status_code == 302
        assert exchange.call_args.kwargs["code_verifier"]
    assert GitLabOAuthAttempt.objects.get().consumed_at is not None


def test_expired_oauth_attempt_cannot_exchange_tokens(pilot):
    from urllib.parse import parse_qs, urlsplit

    start = f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/{pilot[-2].id}/connect/"
    response = pilot[0].post(start, {}, format="json")
    state = parse_qs(urlsplit(response.data["url"]).query)["state"][0]
    GitLabOAuthAttempt.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    with patch("plane.app.views.gitlab.oauth_token") as exchange:
        assert pilot[0].get("/api/integrations/gitlab/callback/", {"state": state, "code": "code"}).status_code == 400
        exchange.assert_not_called()


@pytest.mark.parametrize(
    "url",
    [
        "http://gitlab.example.com",
        "https://user:password@gitlab.example.com",
        "https://gitlab.example.com/path",
        "https://gitlab.example.com?x=y",
    ],
)
def test_only_configured_https_origin_is_accepted(url):
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        validate_base_url(url)


def test_pagination_follows_all_pages_and_preserves_filters():
    client = GitLabClient("https://gitlab.example.com", "token")
    client.get = Mock(side_effect=[([{"id": 1}], {"X-Next-Page": "2"}), ([{"id": 2}], {"X-Next-Page": ""})])
    assert client.all("projects/83/pipelines", {"sha": SHA}) == [{"id": 1}, {"id": 2}]
    assert client.get.call_args.args[1] == {"sha": SHA, "page": 2, "per_page": 100}


def test_current_jobs_and_retries_are_both_cached(pilot):
    sync = RepositorySync(pilot[-1])
    sync.client.one = lambda path: {"id": 5, "sha": SHA} if path.endswith("pipelines/5") else {"id": SHA, "message": ""}
    sync.client.all = lambda path, params=None: (
        [{"id": 10, "name": "build"}, {"id": 11, "name": "build"}] if params else [{"id": 11, "name": "build"}]
    )
    sync.pipeline(5)
    assert GitLabObject.objects.get(kind="job", external_id="10").data["retried"] is True
    assert GitLabObject.objects.get(kind="job", external_id="11").data["retried"] is False


def test_pipeline_is_not_duplicated_directly_under_mr_and_commit(pilot):
    mr = object_for(pilot, "mr", "1")
    commit = object_for(pilot)
    pipeline = object_for(pilot, "pipeline", "5")
    for parent, child in [(mr, commit), (mr, pipeline), (commit, pipeline)]:
        GitLabObjectRelation.objects.create(parent=parent, child=child)
    associate(pilot[4], mr, "marker")
    with patch("plane.utils.gitlab.presentation.capabilities", return_value={"mr", "commit", "pipeline"}):
        data = development_data(pilot[4], pilot[1])
    assert {(edge["parent"], edge["child"]) for edge in data["relations"]} == {
        (str(mr.id), str(commit.id)),
        (str(commit.id), str(pipeline.id)),
    }


def test_all_pipeline_runs_for_a_sha_are_fetched(pilot):
    sync = RepositorySync(pilot[-1])
    sync.client.one = lambda path: {"id": SHA, "message": "plane:DEV-1"}
    sync.client.all = Mock(return_value=[{"id": 5}, {"id": 6}, {"id": 7}])
    sync.pipeline = Mock()
    commit = sync.commit(SHA)
    assert [call.args[0] for call in sync.pipeline.call_args_list] == [5, 6, 7]
    assert all(call.kwargs["commit"] == commit for call in sync.pipeline.call_args_list)


def test_mr_inherits_commits_without_markers(pilot):
    sync = RepositorySync(pilot[-1])
    sync.client.one = (
        lambda path: {"id": 1, "iid": 1, "title": "plane:DEV-1"}
        if path.endswith("merge_requests/1")
        else {"id": SHA, "message": "no marker"}
    )
    sync.client.all = lambda path, params=None: [{"id": SHA}] if path.endswith("merge_requests/1/commits") else []
    mr = sync.mr(1)
    assert GitLabObjectRelation.objects.get(parent=mr).child.external_id == SHA
    assert list(GitLabIssueLink.objects.values_list("object__kind", flat=True)) == ["mr"]


def test_manual_link_and_pin_operations_require_gitlab_and_plane_permissions(pilot):
    job = object_for(pilot, "job", "10")
    commit = object_for(pilot)
    with (
        patch("plane.app.views.gitlab.capabilities", return_value={"commit", "job"}),
        patch("plane.utils.gitlab.presentation.capabilities", return_value={"commit", "job"}),
        patch("plane.app.views.gitlab.RepositorySync") as sync,
    ):
        sync.return_value.object.return_value = commit
        response = pilot[0].post(
            endpoint(pilot), {"url": f"https://gitlab.example.com/team/pilot/-/commit/{SHA}"}, format="json"
        )
        assert response.status_code == 200
        assert GitLabIssueLink.objects.get(object=commit).origins == ["manual"]
        sync.return_value.object.return_value = job
        assert (
            pilot[0].post(endpoint(pilot), {"object_id": str(job.id), "action": "pin"}, format="json").status_code
            == 200
        )
        assert GitLabIssueLink.objects.get(object=job).pinned
        assert (
            pilot[0].post(endpoint(pilot), {"object_id": str(job.id), "action": "unpin"}, format="json").status_code
            == 200
        )
        assert not GitLabIssueLink.objects.get(object=job).pinned
        assert (
            pilot[0].post(endpoint(pilot), {"object_id": str(commit.id), "action": "unlink"}, format="json").status_code
            == 200
        )
        assert GitLabIssueLink.objects.get(object=commit).suppressed
    with patch("plane.app.views.gitlab.capabilities", side_effect=GitLabError("access_denied", 403)):
        assert (
            pilot[0].post(endpoint(pilot), {"object_id": str(job.id), "action": "pin"}, format="json").status_code
            == 403
        )


def test_webhook_outbox_does_not_copy_variables_or_descriptions(pilot):
    response = pilot[0].post(
        f"/api/integrations/gitlab/{pilot[-2].id}/webhook/",
        {
            "project_id": 83,
            "object_attributes": {"id": 5, "description": "private"},
            "variables": [{"value": "secret"}],
        },
        format="json",
        HTTP_X_GITLAB_EVENT="Pipeline Hook",
        HTTP_X_GITLAB_TOKEN="hook-secret",
    )
    assert response.status_code == 202
    assert GitLabWebhookEvent.objects.get().payload == {"project_id": 83, "object_attributes": {"id": 5}}


def test_personal_oauth_token_is_refreshed_without_using_service_token(pilot):
    from plane.utils.gitlab.access import user_client

    connection = GitLabUserConnection.objects.create(
        integration=pilot[-2],
        user=pilot[1],
        gitlab_user_id=1,
        username="developer",
        token_encrypted=encrypt_data("old"),
        refresh_token_encrypted=encrypt_data("refresh"),
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    with patch(
        "plane.utils.gitlab.access.oauth_token",
        return_value={"access_token": "new-personal", "refresh_token": "new-refresh", "expires_in": 7200},
    ) as oauth:
        assert user_client(pilot[-2], pilot[1]).token == "new-personal"
        assert oauth.call_args.kwargs["refresh_token"] == "refresh"
    connection.refresh_from_db()
    assert connection.expires_at > timezone.now()
    assert connection.token_encrypted != "new-personal"


def test_connection_can_be_paused_during_a_gitlab_outage(pilot):
    with patch("plane.app.views.gitlab.GitLabClient") as client:
        response = pilot[0].post(
            f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/",
            {
                "id": str(pilot[-2].id),
                "base_url": pilot[-2].base_url,
                "repository_ids": [83],
                "enabled": False,
            },
            format="json",
        )
        assert response.status_code == 201
        client.assert_not_called()
    pilot[-2].refresh_from_db()
    assert not pilot[-2].enabled and pilot[-2].status == "paused"


def test_success_in_one_repository_does_not_hide_another_repository_error(pilot):
    GitLabRepository.objects.create(integration=pilot[-2], gitlab_id=84, path="team/other", error_code="access_denied")
    with patch.object(RepositorySync, "reconcile"):
        sync_repository(pilot[-1].id)
    pilot[-2].refresh_from_db()
    assert pilot[-2].status == "error" and pilot[-2].error_code == "access_denied"


@pytest.mark.parametrize(
    "scopes,role",
    [(["api"], 20), (["read_api", "api"], 20), (["read_api"], 10), (["read_api"], 30), (["read_api"], 40)],
)
def test_configuration_rejects_broad_tokens_and_non_reporter_roles(pilot, scopes, role):
    with patch("plane.app.views.gitlab.GitLabClient") as client:
        client.return_value.one.side_effect = [
            {"scopes": scopes},
            {"id": 83, "permissions": {"project_access": {"access_level": role}}},
        ]
        response = pilot[0].post(
            f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/",
            {"base_url": pilot[-2].base_url, "repository_ids": [83], "token": "candidate-token"},
            format="json",
        )
    assert response.status_code == 400
    assert "candidate-token" not in str(response.data)


def test_even_admin_configuration_reads_do_not_serialize_credentials(pilot):
    response = pilot[0].get(f"/api/workspaces/{pilot[2].slug}/gitlab-integrations/")
    assert response.status_code == 200
    assert response.data["can_configure"]
    assert response.data["integrations"][0]["repository_ids"] == [83]
    for secret in ("service-secret", "app-secret", "hook-secret", "token_encrypted", "client_secret_encrypted"):
        assert secret not in str(response.data)


def test_job_timestamps_prevent_a_delayed_snapshot_regressing_a_finished_run(pilot):
    sync = RepositorySync(pilot[-1])
    obj = sync.save(
        "job",
        {
            "id": 10,
            "status": "success",
            "created_at": "2026-10-03T09:00:00Z",
            "started_at": "2026-10-03T09:01:00Z",
            "finished_at": "2026-10-03T09:02:00Z",
        },
    )
    sync.save(
        "job",
        {"id": 10, "status": "running", "created_at": "2026-10-03T09:00:00Z", "started_at": "2026-10-03T09:01:00Z"},
    )
    obj.refresh_from_db()
    assert obj.data["status"] == "success"


def test_child_pipeline_discovery_is_explicit_paginated_and_deduplicated(pilot):
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(side_effect=[[{"id": 5}], [{"id": 5}, {"id": 6}]])
    assert [run["id"] for run in sync.pipelines_for_sha(SHA)] == [5, 6]
    assert sync.client.all.call_args.args[1] == {"sha": SHA, "source": "parent_pipeline"}
    sync.pipelines_for_sha(SHA)
    assert sync.client.all.call_count == 2


@pytest.mark.parametrize("pause_integration", [False, True])
def test_sync_rechecks_enabled_after_acquiring_repository_lock(pilot, pause_integration):
    repository = pilot[-1]
    stale = GitLabRepository.objects.select_related("integration").get(pk=repository.id)
    if pause_integration:
        GitLabIntegration.objects.filter(pk=pilot[-2].id).update(enabled=False)
    else:
        GitLabRepository.objects.filter(pk=repository.id).update(enabled=False)
    with (
        patch.object(GitLabRepository.objects, "select_related") as before_lock,
        patch("plane.utils.gitlab.sync.RepositorySync") as sync,
    ):
        before_lock.return_value.get.return_value = stale
        sync_repository(repository.id)
        sync.assert_not_called()
    repository.refresh_from_db()
    assert repository.last_synced_at is None


def test_backdated_commit_discovery_uses_revision_range_without_date_filter(pilot):
    old, new, other_parent = SHA, "b" * 40, "c" * 40
    pilot[-1].discovery_heads = {"branches:main": old}
    pilot[-1].last_reconciled_at = timezone.now()
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(
        side_effect=[
            [{"name": "main", "commit": {"id": new}}],
            [],
            [
                {"id": new, "message": "plane:DEV-1", "committed_date": "2000-01-01T00:00:00Z"},
                {"id": other_parent, "message": "plane:DEV-2", "committed_date": "1999-01-01T00:00:00Z"},
            ],
        ]
    )
    sync.commit = Mock()
    sync.discover_commits()
    assert sync.client.all.call_args.args[1] == {"ref_name": f"{old}..{new}", "order": "topo"}
    assert [call.args[0] for call in sync.commit.call_args_list] == [new, other_parent]
    assert pilot[-1].discovery_heads == {"branches:main": new}


def test_unchanged_frontiers_do_not_rescan_commit_history(pilot):
    pilot[-1].discovery_heads = {"branches:main": SHA}
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(side_effect=[[{"name": "main", "commit": {"id": SHA}}], []])
    sync.commit = Mock()
    sync.discover_commits()
    assert sync.client.all.call_count == 2
    sync.commit.assert_not_called()


def test_new_tag_discovers_old_commits_against_a_completed_frontier(pilot):
    tip = "b" * 40
    pilot[-1].discovery_heads = {"branches:main": SHA}
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(
        side_effect=[
            [{"name": "main", "commit": {"id": SHA}}],
            [{"name": "historical", "commit": {"id": tip}}],
            [{"id": tip, "message": "plane:DEV-2"}],
        ]
    )
    sync.commit = Mock()
    sync.discover_commits()
    assert sync.client.all.call_args.args[1] == {"ref_name": f"{SHA}..{tip}", "order": "topo"}
    sync.commit.assert_called_once_with(tip)
    assert pilot[-1].discovery_heads == {"branches:main": SHA, "tags:historical": tip}


def test_missing_old_frontier_scans_only_the_changed_ref(pilot):
    tip = "b" * 40
    pilot[-1].discovery_heads = {"branches:main": SHA}
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(
        side_effect=[
            [{"name": "main", "commit": {"id": tip}}],
            [],
            GitLabError("not_found", 404),
            [{"id": tip, "message": "plane:DEV-1"}],
        ]
    )
    sync.commit = Mock()
    sync.discover_commits()
    assert sync.client.all.call_args.args[1] == {"ref_name": tip, "order": "topo"}
    sync.commit.assert_called_once_with(tip)


def test_partial_discovery_cannot_advance_durable_frontiers(pilot):
    repository = pilot[-1]
    tip = "b" * 40
    repository.discovery_heads = {"branches:main": SHA}
    repository.save()
    with patch("plane.utils.gitlab.sync.GitLabClient") as client:
        client.return_value.all.side_effect = [
            [{"name": "main", "commit": {"id": tip}}],
            [],
            GitLabError("pagination_limit"),
        ]
        with pytest.raises(GitLabError, match="pagination_limit"):
            sync_repository(repository.id)
    repository.refresh_from_db()
    assert repository.discovery_heads == {"branches:main": SHA}
    assert repository.last_reconciled_at is None
    assert repository.error_code == "pagination_limit"


def test_mr_snapshot_preserves_creation_date_for_history_order():
    assert snapshot("mr", {"iid": 1, "created_at": "2000-01-01T00:00:00Z"})["created_at"] == "2000-01-01T00:00:00Z"


def test_fork_pipeline_is_not_fetched_using_target_project_id(pilot):
    sync = RepositorySync(pilot[-1])

    def one(path):
        if path.endswith("merge_requests/1"):
            return {"id": 30, "iid": 1, "title": "plane:DEV-1"}
        if path.endswith("pipelines/5"):
            return {"id": 5, "sha": SHA, "status": "success"}
        if path.endswith(f"repository/commits/{SHA}"):
            return {"id": SHA, "message": "unmarked"}
        raise AssertionError(f"Unexpected API request: {path}")

    sync.client.one = Mock(side_effect=one)
    sync.client.all = lambda path, params=None: (
        [{"id": 6, "project_id": 84}, {"id": 5, "project_id": 83}]
        if path.endswith("merge_requests/1/pipelines")
        else []
    )
    mr = sync.mr(1)
    assert mr is not None
    assert GitLabIssueLink.objects.filter(issue=pilot[4], object=mr).exists()
    assert list(GitLabObject.objects.filter(kind="pipeline").values_list("external_id", flat=True)) == ["5"]
    assert "projects/83/pipelines/6" not in [call.args[0] for call in sync.client.one.call_args_list]
    assert GitLabObjectRelation.objects.filter(parent=mr, child__kind="pipeline", child__external_id="5").exists()


@pytest.mark.parametrize("event_type", ["Push Hook", "Tag Push Hook"])
def test_push_outbox_preserves_only_valid_revision_ids(pilot, event_type):
    before, after = "A" * 40, "b" * 40
    response = pilot[0].post(
        f"/api/integrations/gitlab/{pilot[-2].id}/webhook/",
        {
            "project_id": 83,
            "before": before,
            "after": after,
            "ref": "refs/heads/private-branch",
            "commits": [{"id": after, "message": "private message"}],
            "variables": [{"value": "private variable"}],
        },
        format="json",
        HTTP_X_GITLAB_EVENT=event_type,
        HTTP_X_GITLAB_TOKEN="hook-secret",
    )
    assert response.status_code == 202
    assert GitLabWebhookEvent.objects.get().payload == {"project_id": 83, "before": before.lower(), "after": after}


@pytest.mark.parametrize("field,value", [("before", "main..secret"), ("after", "short"), ("after", None)])
def test_push_outbox_rejects_invalid_revision_ids(pilot, field, value):
    payload = {"project_id": 83, "before": SHA, "after": "b" * 40, field: value}
    response = pilot[0].post(
        f"/api/integrations/gitlab/{pilot[-2].id}/webhook/",
        payload,
        format="json",
        HTTP_X_GITLAB_EVENT="Push Hook",
        HTTP_X_GITLAB_TOKEN="hook-secret",
    )
    assert response.status_code == 400
    assert not GitLabWebhookEvent.objects.exists()


def test_queued_push_binds_markers_after_current_refs_change_without_manual_url(pilot):
    from plane.bgtasks.gitlab_task import process_gitlab_event

    after, intermediate, current = "b" * 40, "c" * 40, "d" * 40
    repository = pilot[-1]
    repository.discovery_heads = {"branches:main": current}
    repository.save()
    response = pilot[0].post(
        f"/api/integrations/gitlab/{pilot[-2].id}/webhook/",
        {"project_id": 83, "before": SHA, "after": after},
        format="json",
        HTTP_X_GITLAB_EVENT="Push Hook",
        HTTP_X_GITLAB_TOKEN="hook-secret",
    )
    assert response.status_code == 202

    def all_objects(path, params=None):
        if path.endswith("repository/branches"):
            # The pushed feature SHA is no longer a current branch/tag tip.
            return [{"name": "main", "commit": {"id": current}}]
        if path.endswith("repository/commits"):
            assert params == {"ref_name": f"{SHA}..{after}", "order": "topo"}
            return [
                {"id": after, "message": "plane:DEV-1 plane:DEV-1"},
                {"id": intermediate, "message": "plane:DEV-2"},
            ]
        return []

    def one(path):
        key = path.rsplit("/", 1)[-1]
        assert key in (after, intermediate)
        return {"id": key, "message": "plane:DEV-1" if key == after else "plane:DEV-2"}

    with patch("plane.utils.gitlab.sync.GitLabClient") as client:
        client.return_value.all.side_effect = all_objects
        client.return_value.one.side_effect = one
        event = GitLabWebhookEvent.objects.get()
        process_gitlab_event(str(event.id))
        process_gitlab_event(str(event.id))
    event.refresh_from_db()
    assert event.status == "done" and event.attempts == 1
    assert set(GitLabIssueLink.objects.values_list("issue_id", "object__external_id")) == {
        (pilot[4].id, after),
        (pilot[5].id, intermediate),
    }
    assert all(link.origins == ["marker"] for link in GitLabIssueLink.objects.all())


def test_zero_after_revision_does_not_fetch_a_deleted_ref(pilot):
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock()
    sync.pushed_commits({"before": SHA, "after": "0" * 40})
    sync.client.all.assert_not_called()


def test_failed_push_range_stays_durable_for_retry(pilot):
    from plane.bgtasks.gitlab_task import process_gitlab_event

    event = GitLabWebhookEvent.objects.create(
        integration=pilot[-2],
        repository=pilot[-1],
        fingerprint="push-retry",
        event_type="Push Hook",
        payload={"project_id": 83, "before": SHA, "after": "b" * 40},
    )
    with patch("plane.utils.gitlab.sync.GitLabClient") as client:
        client.return_value.all.side_effect = GitLabError("pagination_limit")
        process_gitlab_event(str(event.id))
    event.refresh_from_db()
    assert event.status == "failed" and event.error_code == "pagination_limit"
    assert event.attempts == 1
    pilot[-1].refresh_from_db()
    assert pilot[-1].discovery_heads == {} and pilot[-1].last_reconciled_at is None


def test_description_only_mr_marker_inherits_future_unmarked_commits(pilot):
    later = "b" * 40
    commits = [SHA]
    sync = RepositorySync(pilot[-1])

    def one(path):
        if path.endswith("merge_requests/1"):
            return {"id": 30, "iid": 1, "title": "Unmarked title", "description": "Implements plane:DEV-1"}
        key = path.rsplit("/", 1)[-1]
        assert key in (SHA, later)
        return {"id": key, "message": "unmarked commit"}

    sync.client.one = one
    sync.client.all = lambda path, params=None: (
        [{"id": key} for key in commits] if path.endswith("merge_requests/1/commits") else []
    )
    mr = sync.mr(1)
    commits.append(later)
    sync.mr(1)
    with patch("plane.utils.gitlab.presentation.capabilities", return_value={"mr", "commit"}):
        data = development_data(pilot[4], pilot[1])
    assert {obj["external_id"] for obj in data["objects"]} == {"1", SHA, later}
    assert list(GitLabIssueLink.objects.values_list("object_id", "origins")) == [(mr.id, ["marker"])]


def test_cached_commit_marker_recovers_a_late_created_issue_without_ci(pilot):
    obj = object_for(pilot, message="plane:DEV-3")
    marker_links(pilot[-1], obj, obj.data["message"])
    assert not GitLabIssueLink.objects.exists()
    assert GitLabDiagnostic.objects.filter(marker="DEV-3").exists()
    issue = Issue.objects.create(project=pilot[3], workspace=pilot[2], name="Late issue")
    assert issue.sequence_id == 3
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(return_value=[])
    sync.client.one = Mock()
    sync.reconcile()
    sync.client.one.assert_not_called()
    assert GitLabIssueLink.objects.get().issue == issue


def branch_raw(name="feature/DEV-1-title", sha=SHA):
    return {
        "name": name,
        "protected": False,
        "default": False,
        "web_url": f"https://gitlab.example.com/team/pilot/-/tree/{name}",
        "commit": {"id": sha, "author_name": "Developer", "committed_date": "2026-10-03T10:00:00Z"},
    }


@pytest.mark.parametrize(
    "name,expected",
    [
        ("feature/DEV-1-title", {("DEV", 1)}),
        ("feature/dev-1-dev-2-title", {("DEV", 1), ("DEV", 2)}),
        ("feature/A_B-12-title", {("A_B", 12)}),
        ("feature/DEV-1x", set()),
        ("feature/DEV-01-title", set()),
        ("feature/DEV-1-2", set()),
        ("feature/DEV-123-4", set()),
        ("feature/DEV-01-2", set()),
        ("feature/DEV-0x-2", set()),
        ("feature/DEV-01abc-2", set()),
        ("feature/123-4-title", {("123", 4)}),
        ("feature/unmarked", set()),
    ],
)
def test_branch_keys_accept_issue_slugs_and_reject_ambiguous_fragments(name, expected):
    assert branch_keys(name) == expected
    assert markers(name) == set()


def test_unchanged_branch_tip_links_before_any_mr_without_shared_history(pilot):
    raw = branch_raw()
    pilot[-1].discovery_heads = {"branches:main": SHA}
    sync = RepositorySync(pilot[-1])
    sync.client.all = Mock(side_effect=[[raw], [], [], []])
    sync.client.one = Mock()
    sync.reconcile()
    sync.client.one.assert_not_called()
    branch = GitLabObject.objects.get()
    assert branch.kind == "branch" and branch.external_id == branch_id(raw["name"])
    assert len(branch.external_id) == 64
    assert branch.data["name"] == raw["name"] and branch.data["state"] == "active"
    assert branch.data["sha"] == SHA
    assert GitLabIssueLink.objects.get().origins == ["branch"]
    assert not GitLabObjectRelation.objects.exists()
    assert not GitLabObject.objects.filter(kind__in=["mr", "commit", "pipeline", "job"]).exists()


def test_branch_tip_update_preserves_identity_and_does_not_inherit_ancestors(pilot):
    sync = RepositorySync(pilot[-1])
    obj = sync.save_branch(branch_raw())
    changed = branch_raw(sha="b" * 40)
    changed["commit"]["message"] = "Do not cache this unmarked head message"
    sync.sync_branches([changed])
    obj.refresh_from_db()
    assert obj.data["sha"] == "b" * 40 and obj.data["state"] == "active"
    assert "message" not in obj.data
    assert GitLabObject.objects.count() == 1 and GitLabIssueLink.objects.count() == 1
    assert not GitLabObjectRelation.objects.exists()


def test_source_branch_key_links_unmarked_mr_and_inherits_only_mr_commits(pilot):
    sync = RepositorySync(pilot[-1])
    branch = sync.save_branch(branch_raw())

    def one(path):
        if path.endswith("merge_requests/1"):
            return {
                "id": 30,
                "iid": 1,
                "title": "DEV-2 ordinary title",
                "description": "DEV-2 ordinary description",
                "source_branch": branch.data["name"],
                "target_branch": "main",
                "source_project_id": 83,
            }
        assert path.endswith(f"repository/commits/{SHA}")
        return {"id": SHA, "message": "DEV-2 ordinary message"}

    sync.client.one = one
    sync.client.all = lambda path, params=None: [{"id": SHA}] if path.endswith("merge_requests/1/commits") else []
    mr = sync.mr(1)
    assert mr is not None
    assert set(GitLabIssueLink.objects.values_list("issue_id", "object_id")) == {
        (pilot[4].id, branch.id),
        (pilot[4].id, mr.id),
    }
    assert all(link.origins == ["branch"] for link in GitLabIssueLink.objects.all())
    assert list(GitLabObjectRelation.objects.values_list("parent__kind", "child__kind")) == [("mr", "commit")]


def test_foreign_fork_source_branch_cannot_create_a_target_branch_association(pilot):
    sync = RepositorySync(pilot[-1])
    raw = {"id": 30, "iid": 1, "title": "Unmarked", "source_branch": "feature/DEV-1-title", "source_project_id": 84}
    sync.client.one = Mock(return_value=raw)
    sync.client.all = Mock(return_value=[])
    assert sync.mr(1) is None
    assert not GitLabIssueLink.objects.exists()
    raw["title"] = "Explicit plane:DEV-2"
    mr = sync.mr(1)
    link = GitLabIssueLink.objects.get()
    assert link.issue == pilot[5] and link.object == mr and link.origins == ["marker"]


def test_canonical_branch_api_encodes_full_unicode_slash_and_percent_name(pilot):
    name = "feature/DEV-1-ветка/part%literal"
    sync = RepositorySync(pilot[-1])
    sync.client.one = Mock(return_value=branch_raw(name))
    obj = sync.object("branch", name)
    sync.client.one.assert_called_once_with(
        "projects/83/repository/branches/feature%2FDEV-1-%D0%B2%D0%B5%D1%82%D0%BA%D0%B0%2Fpart%25literal"
    )
    assert obj.external_id == branch_id(name) and obj.data["name"] == name


def test_unchanged_branch_keys_recover_a_late_created_issue(pilot):
    raw = branch_raw("feature/DEV-3-late")
    repository = pilot[-1]
    repository.discovery_heads = {f"branches:{raw['name']}": SHA}
    sync = RepositorySync(repository)
    sync.save_branch(raw)
    assert not GitLabIssueLink.objects.exists()
    issue = Issue.objects.create(project=pilot[3], workspace=pilot[2], name="Late branch issue")
    sync.client.all = Mock(side_effect=[[raw], []])
    sync.discover_commits()
    assert GitLabIssueLink.objects.get().issue == issue
    assert GitLabIssueLink.objects.get().origins == ["branch"]


def test_missing_branch_retains_snapshot_and_recreation_preserves_tombstone(pilot):
    sync = RepositorySync(pilot[-1])
    raw = branch_raw()
    obj = sync.save_branch(raw)
    link = GitLabIssueLink.objects.get()
    link.suppressed = True
    link.save()
    sync.sync_branches([])
    obj.refresh_from_db()
    assert obj.data["state"] == "deleted" and obj.data["sha"] == SHA
    assert GitLabObject.objects.count() == 1 and GitLabIssueLink.objects.count() == 1
    recreated = sync.save_branch(branch_raw(sha="b" * 40))
    assert recreated.id == obj.id and recreated.data["state"] == "active"
    link.refresh_from_db()
    assert link.suppressed
    associate(pilot[4], recreated, "manual", restore=True)
    link.refresh_from_db()
    assert not link.suppressed and link.origins == ["branch", "manual"]


def test_failed_branch_page_cannot_mark_cached_branches_deleted_or_advance_heads(pilot):
    repository = pilot[-1]
    obj = RepositorySync(repository).save_branch(branch_raw())
    repository.discovery_heads = {"branches:feature/DEV-1-title": SHA}
    repository.save()
    with patch("plane.utils.gitlab.sync.GitLabClient") as client:
        client.return_value.all.side_effect = GitLabError("pagination_limit")
        with pytest.raises(GitLabError, match="pagination_limit"):
            sync_repository(repository.id)
    obj.refresh_from_db()
    repository.refresh_from_db()
    assert obj.data["state"] == "active" and obj.data["sha"] == SHA
    assert repository.discovery_heads == {"branches:feature/DEV-1-title": SHA}


def test_old_unchanged_mr_is_discovered_via_its_keyed_source_branch(pilot):
    raw = branch_raw()
    pilot[-1].discovery_heads = {f"branches:{raw['name']}": SHA}
    pilot[-1].last_reconciled_at = timezone.now()
    sync = RepositorySync(pilot[-1])

    def all_objects(path, params=None):
        if path.endswith("repository/branches"):
            return [raw]
        if path.endswith("merge_requests") and params.get("source_branch") == raw["name"]:
            return [{"iid": 1}]
        return []

    sync.client.all = Mock(side_effect=all_objects)
    sync.client.one = Mock(
        return_value={"id": 30, "iid": 1, "title": "Unmarked", "source_branch": raw["name"], "source_project_id": 83}
    )
    sync.reconcile()
    assert set(GitLabIssueLink.objects.values_list("object__kind", flat=True)) == {"branch", "mr"}
    assert all(link.origins == ["branch"] for link in GitLabIssueLink.objects.all())


def test_rejected_branch_fragments_cannot_link_to_existing_numeric_projects(pilot):
    numeric = Project.objects.create(workspace=pilot[2], name="Numeric", identifier="123")
    leading_zero = Project.objects.create(workspace=pilot[2], name="Leading zero", identifier="01")
    mixed_numeric = Project.objects.create(workspace=pilot[2], name="Mixed numeric", identifier="0X")
    for index in range(4):
        Issue.objects.create(workspace=pilot[2], project=numeric, name=f"Numeric issue {index + 1}")
    for index in range(2):
        Issue.objects.create(workspace=pilot[2], project=leading_zero, name=f"Zero issue {index + 1}")
        Issue.objects.create(workspace=pilot[2], project=mixed_numeric, name=f"Mixed issue {index + 1}")
    sync = RepositorySync(pilot[-1])
    sync.save_branch(branch_raw("feature/DEV-123-4"))
    sync.save_branch(branch_raw("feature/DEV-01-2"))
    sync.save_branch(branch_raw("feature/DEV-0x-2"))
    assert not GitLabIssueLink.objects.exists()
    sync.save_branch(branch_raw("feature/123-4-title"))
    link = GitLabIssueLink.objects.get()
    assert link.issue.project == numeric and link.issue.sequence_id == 4


def test_branch_key_resolution_and_identity_preserve_workspace_and_exact_name(pilot):
    other = WorkspaceFactory(owner=UserFactory(username="branch-other-owner"))
    project = Project.objects.create(workspace=other, name="Other", identifier="DEV")
    Issue.objects.create(workspace=other, project=project, name="Other issue")
    sync = RepositorySync(pilot[-1])
    upper = sync.save_branch(branch_raw("feature/DEV-1-title"))
    lower = sync.save_branch(branch_raw("feature/dev-1-title"))
    assert upper.external_id != lower.external_id
    assert upper.external_id == branch_id("feature/DEV-1-title")
    assert lower.external_id == branch_id("feature/dev-1-title")
    assert set(GitLabIssueLink.objects.values_list("issue_id", flat=True)) == {pilot[4].id}


@pytest.mark.parametrize("source_project_id", [None, 84])
def test_mr_branch_inference_requires_explicit_local_source_project(pilot, source_project_id):
    sync = RepositorySync(pilot[-1])
    raw = {"id": 30, "iid": 1, "title": "Unmarked", "source_branch": "feature/DEV-1-title"}
    if source_project_id is not None:
        raw["source_project_id"] = source_project_id
    sync.client.one = Mock(return_value=raw)
    sync.client.all = Mock(return_value=[])
    assert sync.mr(1) is None
    assert not GitLabIssueLink.objects.exists()


def test_plain_mr_title_and_keyed_target_branch_do_not_create_an_auto_link(pilot):
    sync = RepositorySync(pilot[-1])
    sync.client.one = Mock(
        return_value={
            "id": 30,
            "iid": 1,
            "title": "DEV-1 plain title",
            "description": "DEV-1 plain description",
            "source_branch": "feature/unmarked",
            "target_branch": "feature/DEV-1-target",
            "source_project_id": 83,
        }
    )
    sync.client.all = Mock()
    assert sync.mr(1) is None
    sync.client.all.assert_not_called()
    assert not GitLabIssueLink.objects.exists()


def test_branch_category_denial_hides_cached_data_and_rejects_link_writes(pilot):
    obj = RepositorySync(pilot[-1]).save_branch(branch_raw())
    original = GitLabIssueLink.objects.get().origins
    personal = Mock()

    def get(path, params=None):
        if path.endswith("repository/branches"):
            raise GitLabError("access_denied", 403)
        return [], {}

    personal.get.side_effect = get
    with (
        patch("plane.utils.gitlab.access.user_client", return_value=personal),
        patch("plane.app.views.gitlab.RepositorySync") as sync,
    ):
        response = pilot[0].get(endpoint(pilot))
        assert response.status_code == 200 and response.data["objects"] == [] and response.data["links"] == []
        response = pilot[0].post(endpoint(pilot), {"object_id": str(obj.id), "action": "restore"}, format="json")
        assert response.status_code == 403
        sync.assert_not_called()
    obj.refresh_from_db()
    assert obj.data["state"] == "active"
    assert GitLabIssueLink.objects.get().origins == original


def test_code_access_guard_hides_branches_before_requesting_branch_permissions(pilot):
    RepositorySync(pilot[-1]).save_branch(branch_raw())
    personal = Mock()
    personal.get.side_effect = GitLabError("access_denied", 403)
    with patch("plane.utils.gitlab.access.user_client", return_value=personal):
        response = pilot[0].get(endpoint(pilot))
    assert response.status_code == 200 and response.data["objects"] == []
    personal.get.assert_called_once_with("projects/83/repository/commits", {"per_page": 1})


@pytest.mark.parametrize(
    "suffix,name",
    [
        ("feature/DEV-1/topic", "feature/DEV-1/topic"),
        ("feature/DEV-1/-/topic", "feature/DEV-1/-/topic"),
        ("feature%2FDEV-1%2Ftopic", "feature/DEV-1/topic"),
        ("feature/DEV-1/percent%252Fliteral", "feature/DEV-1/percent%2Fliteral"),
        ("b" * 64, "b" * 64),
    ],
)
def test_manual_branch_url_preserves_full_suffix_and_decodes_exactly_once(pilot, suffix, name):
    obj = RepositorySync(pilot[-1]).save_branch(branch_raw(name))
    with (
        patch("plane.app.views.gitlab.capabilities", return_value={"branch"}),
        patch("plane.utils.gitlab.presentation.capabilities", return_value={"branch"}),
        patch("plane.app.views.gitlab.RepositorySync") as sync,
    ):
        sync.return_value.object.return_value = obj
        response = pilot[0].post(
            endpoint(pilot), {"url": f"https://gitlab.example.com/team/pilot/-/tree/{suffix}"}, format="json"
        )
    assert response.status_code == 200
    sync.return_value.object.assert_called_once_with("branch", name)
    assert "manual" in GitLabIssueLink.objects.get(object=obj).origins


def test_missing_branch_url_name_is_rejected_without_network_requests(pilot):
    with (
        patch("plane.app.views.gitlab.capabilities") as permissions,
        patch("plane.app.views.gitlab.RepositorySync") as sync,
    ):
        response = pilot[0].post(
            endpoint(pilot), {"url": "https://gitlab.example.com/team/pilot/-/tree/"}, format="json"
        )
    assert response.status_code == 400
    permissions.assert_not_called()
    sync.assert_not_called()


def test_branch_restore_by_object_id_uses_full_name_and_branch_cannot_be_pinned(pilot):
    name = "feature/DEV-1/topic"
    obj = RepositorySync(pilot[-1]).save_branch(branch_raw(name))
    link = GitLabIssueLink.objects.get()
    link.suppressed = True
    link.save()
    with (
        patch("plane.app.views.gitlab.capabilities", return_value={"branch"}),
        patch("plane.utils.gitlab.presentation.capabilities", return_value={"branch"}),
        patch("plane.app.views.gitlab.RepositorySync") as sync,
    ):
        sync.return_value.object.return_value = obj
        response = pilot[0].post(endpoint(pilot), {"object_id": str(obj.id), "action": "restore"}, format="json")
        assert response.status_code == 200
        sync.return_value.object.assert_called_once_with("branch", name)
        link.refresh_from_db()
        assert not link.suppressed and link.origins == ["branch", "manual"]
        sync.return_value.object.reset_mock()
        response = pilot[0].post(endpoint(pilot), {"object_id": str(obj.id), "action": "pin"}, format="json")
        assert response.status_code == 400
        sync.return_value.object.assert_not_called()
    link.refresh_from_db()
    assert not link.pinned


def test_permission_categories_run_concurrently_only_after_code_access_passes(pilot):
    from threading import Barrier, Event, Lock, get_ident
    from plane.utils.gitlab.access import capabilities

    request_thread = get_ident()
    code_verified = Event()
    categories_ready = Barrier(4, timeout=10)
    lock = Lock()
    threads = set()
    paths = []
    client = GitLabClient("https://gitlab.example.com", "personal-token")

    def network(url, **kwargs):
        path = url.split("/api/v4/", 1)[1]
        assert kwargs["headers"] == {"Authorization": "Bearer personal-token"}
        with lock:
            paths.append(path)
        if path.endswith("repository/commits"):
            assert get_ident() == request_thread
            assert len(paths) == 1
            code_verified.set()
        else:
            assert code_verified.is_set()
            assert get_ident() != request_thread
            with lock:
                threads.add(get_ident())
            # A sequential implementation cannot reach this barrier's four
            # participants. No assertions depend on elapsed request duration.
            categories_ready.wait()
        response = Mock(status_code=200, headers={})
        response.json.return_value = []
        return response

    with (
        patch("plane.utils.gitlab.access.user_client", return_value=client) as credentials,
        patch("plane.utils.gitlab.client.requests.get", side_effect=network),
    ):
        allowed = capabilities(pilot[-1], pilot[1])
    credentials.assert_called_once_with(pilot[-2], pilot[1])
    assert allowed == {"commit", "branch", "mr", "pipeline", "job"}
    assert paths[0] == "projects/83/repository/commits"
    assert set(paths[1:]) == {
        "projects/83/repository/branches",
        "projects/83/merge_requests",
        "projects/83/pipelines",
        "projects/83/jobs",
    }
    assert len(threads) == 4
    assert client.base_url == "https://gitlab.example.com" and client.token == "personal-token"


@pytest.mark.parametrize("code", ["access_denied", "not_found"])
def test_parallel_permission_denial_hides_only_its_category(pilot, code):
    from plane.utils.gitlab.access import capabilities

    client = Mock()

    def get(path, params=None):
        if path.endswith("pipelines"):
            raise GitLabError(code)
        return [], {}

    client.get.side_effect = get
    with patch("plane.utils.gitlab.access.user_client", return_value=client):
        assert capabilities(pilot[-1], pilot[1]) == {"commit", "branch", "mr", "job"}


@pytest.mark.parametrize("code", ["token_invalid", "unavailable", "rate_limited", "invalid_response"])
def test_parallel_permission_uncertainty_fails_closed_for_all_metadata(pilot, code):
    client = Mock()
    RepositorySync(pilot[-1]).save_branch(branch_raw())

    def get(path, params=None):
        if path.endswith("pipelines"):
            raise GitLabError(code)
        return [], {}

    client.get.side_effect = get
    with patch("plane.utils.gitlab.access.user_client", return_value=client):
        data = development_data(pilot[4], pilot[1])
    assert data["objects"] == [] and data["links"] == [] and data["access_errors"] == [code]


def test_gitlab_get_transport_has_bounded_tls_read_and_sanitized_failures():
    from requests.exceptions import ConnectTimeout

    response = Mock(status_code=200, headers={"X-Next-Page": ""})
    response.json.return_value = [{"id": 83}]
    client = GitLabClient("https://gitlab.example.com", "fixture-token")
    assert client.session is None
    with patch("plane.utils.gitlab.client.requests.get", return_value=response) as request:
        data, headers = client.get("projects/83/repository/branches", {"per_page": 1})
        assert data == [{"id": 83}] and headers == {"X-Next-Page": ""}
        assert request.call_args.args == ("https://gitlab.example.com/api/v4/projects/83/repository/branches",)
        options = request.call_args.kwargs
        assert options["timeout"] == (15, 20)
        assert options["allow_redirects"] is False
        assert options.get("verify", True) is not False
        assert options["params"] == {"per_page": 1}
        assert set(options["headers"]) == {"Authorization"}
        request.side_effect = ConnectTimeout("private transport detail")
        with pytest.raises(GitLabError) as failure:
            client.get("projects/83/repository/branches", {"per_page": 1})
        assert failure.value.code == "unavailable" and str(failure.value) == "unavailable"
        assert failure.value.__suppress_context__


def test_gitlab_oauth_transport_has_bounded_tls_read_and_sanitized_failures(pilot):
    from requests.exceptions import ReadTimeout
    from plane.utils.gitlab.client import oauth_token

    response = Mock(status_code=200)
    response.json.return_value = {"access_token": "fixture-access"}
    with patch("plane.utils.gitlab.client.requests.post", return_value=response) as request:
        result = oauth_token(pilot[-2], grant_type="authorization_code", code="fixture-code")
        assert "access_token" in result
        assert request.call_args.args == ("https://gitlab.example.com/oauth/token",)
        options = request.call_args.kwargs
        assert options["timeout"] == (15, 20)
        assert options["allow_redirects"] is False
        assert options.get("verify", True) is not False
        assert set(options["data"]) == {"client_id", "client_secret", "grant_type", "code"}
        assert options["data"]["grant_type"] == "authorization_code"
        request.side_effect = ReadTimeout("private transport detail")
        with pytest.raises(GitLabError) as failure:
            oauth_token(pilot[-2], grant_type="authorization_code", code="fixture-code")
        assert failure.value.code == "unavailable" and str(failure.value) == "unavailable"
        assert failure.value.__suppress_context__


def test_serial_repository_sync_reuses_one_session_for_two_gets_and_closes_it(pilot):
    response = Mock(status_code=200, headers={})
    response.json.return_value = []
    session = Mock()
    session.get.return_value = response
    with patch("plane.utils.gitlab.sync.requests.Session", return_value=session) as factory:
        with RepositorySync(pilot[-1]) as sync:
            assert sync.client.session is session
            sync.client.get("projects/83/repository/branches")
            sync.client.get("projects/83/merge_requests")
        assert sync.client.session is None and sync.session is None
    factory.assert_called_once_with()
    assert session.get.call_count == 2
    for call in session.get.call_args_list:
        assert call.kwargs["timeout"] == (15, 20)
        assert call.kwargs["allow_redirects"] is False
        assert call.kwargs.get("verify", True) is not False
    session.close.assert_called_once_with()


@pytest.mark.parametrize("fails", [False, True])
def test_repository_task_closes_owned_session_after_success_or_error(pilot, fails):
    session = Mock()
    with (
        patch("plane.utils.gitlab.sync.requests.Session", return_value=session) as factory,
        patch.object(RepositorySync, "reconcile", side_effect=GitLabError("unavailable") if fails else None),
    ):
        if fails:
            with pytest.raises(GitLabError, match="unavailable"):
                sync_repository(pilot[-1].id)
        else:
            sync_repository(pilot[-1].id)
    factory.assert_called_once_with()
    session.close.assert_called_once_with()


@pytest.mark.parametrize("fails", [False, True])
def test_manual_link_closes_owned_session_after_success_or_error(pilot, fails):
    session = Mock()
    obj = object_for(pilot)
    with (
        patch("plane.utils.gitlab.sync.requests.Session", return_value=session) as factory,
        patch.object(
            RepositorySync, "object", return_value=obj, side_effect=GitLabError("unavailable") if fails else None
        ),
        patch("plane.app.views.gitlab.capabilities", return_value={"commit"}),
        patch("plane.utils.gitlab.presentation.capabilities", return_value={"commit"}),
    ):
        response = pilot[0].post(
            endpoint(pilot), {"url": f"https://gitlab.example.com/team/pilot/-/commit/{SHA}"}, format="json"
        )
    assert response.status_code == (503 if fails else 200)
    factory.assert_called_once_with()
    session.close.assert_called_once_with()
    assert GitLabIssueLink.objects.count() == (0 if fails else 1)
