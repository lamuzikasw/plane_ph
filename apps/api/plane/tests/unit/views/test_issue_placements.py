# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueComment, IssuePlacement, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.issue_placements import attach_issue, detach_issue

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def shared_work():
    actor = UserFactory(username=str(uuid4()))
    workspace = WorkspaceFactory(owner=actor)
    WorkspaceMember.objects.create(workspace=workspace, member=actor, role=20)
    projects = []
    for identifier in ("B2B", "CRM"):
        project = Project.objects.create(
            workspace=workspace, name=identifier, identifier=identifier, issue_placements_enabled=True
        )
        ProjectMember.objects.create(project=project, member=actor, role=20)
        for group, name in (("unstarted", "Todo"), ("started", "In progress"), ("completed", "Done")):
            State.objects.create(project=project, name=name, group=group, color="#60646C", default=group == "unstarted")
        projects.append(project)
    source, target = projects
    # Different counters are intentional: this detects accidental number reuse.
    Issue.objects.create(project=target, name="Existing CRM work")
    issue = Issue.objects.create(project=source, name="Shared integration")
    with patch("celery.app.task.Task.delay"):
        yield actor, workspace, source, target, issue


def client_for(actor):
    client = APIClient()
    client.force_authenticate(actor)
    return client


def url(workspace, project, suffix=""):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{suffix}"


def test_numbers_are_local_reserved_and_restored(shared_work):
    actor, _, source, target, issue = shared_work
    placement = attach_issue(issue=issue, project=target, actor=actor)
    assert issue.sequence_id == 1
    assert placement.sequence_id == 2
    assert attach_issue(issue=issue, project=target, actor=actor).id == placement.id
    assert Issue.objects.count() == 2  # attaching never duplicates content
    detach_issue(placement=placement, actor=actor)
    next_issue = Issue.objects.create(project=target, name="Next native work")
    assert next_issue.sequence_id == 3
    assert attach_issue(issue=issue, project=target, actor=actor).sequence_id == 2
    assert IssuePlacement.objects.count() == 1


def test_list_board_filter_and_identifier(shared_work):
    actor, workspace, _, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    client = client_for(actor)
    response = client.get(url(workspace, target), {"group_by": "state_id"})
    assert response.status_code == 200, response.data
    assert response.data["grouped_by"] == "state_id"
    rows = response.data["results"][str(entry.state_id)]["results"]
    projected = next(row for row in rows if str(row["id"]) == str(entry.id))
    assert projected["sequence_id"] == 2
    assert str(projected["canonical_issue_id"]) == str(issue.id)
    assert str(projected["project_id"]) == str(target.id)
    response = client.get(url(workspace, target), {"filters": '{"state_id":"' + str(entry.state_id) + '"}'})
    assert response.status_code == 200, response.data
    assert str(entry.id) in [str(row["id"]) for row in response.data["results"]]
    response = client.get(f"/api/workspaces/{workspace.slug}/work-items/CRM-2/")
    assert response.status_code == 307, response.data
    response = client.get(response["Location"])
    assert response.status_code == 200, response.data
    assert str(response.data["id"]) == str(entry.id)
    assert response.data["name"] == issue.name
    response = client.get(url(workspace, target, f"{entry.id}/meta/"))
    assert response.status_code == 200, response.data
    assert response.data == {"sequence_id": 2, "project_identifier": "CRM"}


def test_destination_member_edits_shared_content_and_comments(shared_work):
    actor, workspace, source, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    teammate = UserFactory(username=str(uuid4()))
    WorkspaceMember.objects.create(workspace=workspace, member=teammate, role=15)
    ProjectMember.objects.create(project=target, member=teammate, role=15)
    client = client_for(teammate)
    response = client.patch(url(workspace, target, f"{entry.id}/"), {"name": "Updated from CRM"}, format="json")
    assert response.status_code == 204, response.data
    issue.refresh_from_db()
    assert issue.name == "Updated from CRM"
    assert issue.project_id == source.id
    response = client.get(url(workspace, target, f"{entry.id}/"))
    assert response.status_code == 200, response.data
    assert response.data["sequence_id"] == 2
    response = client.post(
        url(workspace, target, f"{entry.id}/comments/"), {"comment_html": "<p>Shared comment</p>"}, format="json"
    )
    assert response.status_code == 201, response.data
    assert IssueComment.objects.get(issue=issue).comment_html == "<p>Shared comment</p>"
    response = client.get(url(workspace, target, f"{entry.id}/comments/"))
    assert response.status_code == 200, response.data
    assert len(response.data) == 1


def test_shared_status_and_detach_do_not_delete_content(shared_work):
    actor, workspace, source, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    client = client_for(actor)
    active = State.objects.get(project=target, group="started")
    response = client.patch(url(workspace, target, f"{entry.id}/"), {"state_id": str(active.id)}, format="json")
    assert response.status_code == 204, response.data
    issue.refresh_from_db()
    entry.refresh_from_db()
    assert issue.state.project_id == source.id
    assert issue.state.group == entry.state.group == "started"
    response = client.delete(url(workspace, target, f"{entry.id}/"))
    assert response.status_code == 403
    response = client.delete(url(workspace, source, f"{issue.id}/placements/{entry.id}/"))
    assert response.status_code == 204, response.data
    assert Issue.objects.filter(pk=issue.id).exists()
    assert client.get(url(workspace, target, f"{entry.id}/")).status_code == 404


def test_permissions_and_rollout_are_enforced(shared_work):
    actor, workspace, source, target, issue = shared_work
    target.issue_placements_enabled = False
    target.save()
    client = client_for(actor)
    response = client.post(
        url(workspace, source, f"{issue.id}/placements/"), {"project_id": str(target.id)}, format="json"
    )
    assert response.status_code == 400
    target.issue_placements_enabled = True
    target.save()
    entry = attach_issue(issue=issue, project=target, actor=actor)
    stranger = UserFactory(username=str(uuid4()))
    WorkspaceMember.objects.create(workspace=workspace, member=stranger, role=15)
    client = client_for(stranger)
    assert client.get(url(workspace, target, f"{entry.id}/")).status_code == 403
    assert client.get(url(workspace, target)).status_code == 403
    ProjectMember.objects.create(project=target, member=stranger, role=5)
    assert client.patch(url(workspace, target, f"{entry.id}/"), {"name": "Denied"}, format="json").status_code == 403
    assert client.get(url(workspace, source, f"{issue.id}/")).status_code == 403


def test_secondary_list_endpoints_and_local_ordering(shared_work):
    actor, workspace, source, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    client = client_for(actor)
    response = client.get(url(workspace, target, "list/"), {"issues": str(entry.id)})
    assert response.status_code == 200, response.data
    assert str(response.data[0]["id"]) == str(entry.id)
    for suffix in ("v2/issues/", "issues-detail/"):
        response = client.get(f"/api/workspaces/{workspace.slug}/projects/{target.id}/{suffix}")
        assert response.status_code == 200, response.data
        assert str(entry.id) in [str(row["id"]) for row in response.data["results"]]
    original_order = issue.sort_order
    response = client.patch(url(workspace, target, f"{entry.id}/"), {"sort_order": 123.5}, format="json")
    assert response.status_code == 204, response.data
    entry.refresh_from_db()
    issue.refresh_from_db()
    assert entry.sort_order == 123.5
    assert issue.sort_order == original_order
    response = client.get(url(workspace, source), {"group_by": "state_id", "sub_group_by": "priority"})
    assert response.status_code == 200, response.data


def test_search_and_add_from_destination(shared_work):
    actor, workspace, source, target, issue = shared_work
    client = client_for(actor)
    endpoint = f"/api/workspaces/{workspace.slug}/projects/{target.id}/shared-issues/"
    response = client.get(endpoint, {"search": issue.name})
    assert response.status_code == 200, response.data
    assert response.data["results"][0]["id"] == str(issue.id)
    response = client.post(endpoint, {"issue_id": str(issue.id)}, format="json")
    assert response.status_code == 201, response.data
    entry_id = response.data["id"]
    response = client.get(
        f"/api/workspaces/{workspace.slug}/search/",
        {"entities": "issue", "search": "CRM-2", "workspace_search": "true"},
    )
    assert response.status_code == 200, response.data
    assert str(response.data["results"]["issue"][0]["id"]) == entry_id
    response = client.get(endpoint)
    assert response.data["results"] == []
    # Native project identifier remains valid.
    response = client.get(f"/api/workspaces/{workspace.slug}/work-items/{source.identifier}-1/")
    assert response.status_code == 200, response.data
    assert str(response.data["id"]) == str(issue.id)


def test_source_status_updates_and_failed_transition_are_atomic(shared_work):
    actor, workspace, source, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    client = client_for(actor)
    started = State.objects.get(project=source, group="started")
    response = client.patch(url(workspace, source, f"{issue.id}/"), {"state_id": str(started.id)}, format="json")
    assert response.status_code == 204, response.data
    entry.refresh_from_db()
    assert entry.state.group == "started"
    cancelled = State.objects.create(project=source, name="Cancelled", group="cancelled", color="#60646C")
    response = client.patch(url(workspace, source, f"{issue.id}/"), {"state_id": str(cancelled.id)}, format="json")
    assert response.status_code == 400, response.data
    issue.refresh_from_db()
    entry.refresh_from_db()
    assert issue.state_id == started.id
    assert entry.state.group == "started"


def test_tenant_boundary_and_guest_visibility(shared_work):
    actor, workspace, source, target, issue = shared_work
    client = client_for(actor)
    other_workspace = WorkspaceFactory(owner=actor)
    foreign_project = Project.objects.create(
        workspace=other_workspace, name="Private", identifier="PRIVATE", issue_placements_enabled=True
    )
    response = client.post(
        url(workspace, source, f"{issue.id}/placements/"), {"project_id": str(foreign_project.id)}, format="json"
    )
    assert response.status_code == 404
    entry = attach_issue(issue=issue, project=target, actor=actor)
    target.guest_view_all_features = False
    target.save()
    guest = UserFactory(username=str(uuid4()))
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    ProjectMember.objects.create(project=target, member=guest, role=5)
    guest_client = client_for(guest)
    assert guest_client.get(url(workspace, target, f"{entry.id}/")).status_code == 403
    response = guest_client.get(url(workspace, target))
    assert response.status_code == 200
    assert response.data["results"] == []


def test_shared_attachments_use_one_content_record(shared_work):
    actor, workspace, _, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    client = client_for(actor)
    endpoint = f"/api/assets/v2/workspaces/{workspace.slug}/projects/{target.id}/issues/{entry.id}/attachments/"
    with patch("plane.app.views.issue.attachment.S3Storage") as storage:
        storage.return_value.generate_presigned_post.return_value = {
            "url": "https://storage.invalid/upload",
            "fields": {},
        }
        response = client.post(endpoint, {"name": "test.txt", "type": "text/plain", "size": 12}, format="json")
    assert response.status_code == 200, response.data
    from plane.db.models import FileAsset

    asset = FileAsset.objects.get(pk=response.data["asset_id"])
    assert asset.issue_id == issue.id
    response = client.patch(f"{endpoint}{asset.id}/", {}, format="json")
    assert response.status_code == 204, response.data
    response = client.get(endpoint)
    assert response.status_code == 200, response.data
    assert len(response.data) == 1


def test_pilot_setup_is_explicit_and_idempotent(shared_work):
    from io import StringIO
    from django.core.management import call_command

    actor, workspace, source, _, _ = shared_work
    options = {
        "workspace": workspace.slug,
        "project_id": str(source.id),
        "actor_id": str(actor.id),
        "stdout": StringIO(),
    }
    before = Issue.objects.count()
    call_command("setup_issue_placement_demo", **options)
    assert Issue.objects.count() == before
    call_command("setup_issue_placement_demo", apply=True, **options)
    call_command("setup_issue_placement_demo", apply=True, **options)
    assert Issue.objects.count() == before + 1
    assert Project.objects.filter(workspace=workspace, identifier="MPTST").count() == 1


def test_create_in_multiple_projects_is_atomic(shared_work):
    actor, workspace, source, target, _ = shared_work
    client = client_for(actor)
    response = client.post(
        url(workspace, source), {"name": "Create shared", "additional_project_ids": [str(target.id)]}, format="json"
    )
    assert response.status_code == 201, response.data
    issue = Issue.objects.get(name="Create shared")
    assert IssuePlacement.objects.filter(issue=issue, project=target, is_active=True).count() == 1
    target.issue_placements_enabled = False
    target.save()
    response = client.post(
        url(workspace, source), {"name": "Must roll back", "additional_project_ids": [str(target.id)]}, format="json"
    )
    assert response.status_code == 400, response.data
    assert not Issue.objects.filter(name="Must roll back").exists()


@pytest.mark.parametrize("change_status", [True, False])
def test_board_drag_accepts_local_identity_and_keeps_order_local(shared_work, change_status):
    actor, workspace, source, target, issue = shared_work
    for project in (source, target):
        State.objects.create(project=project, name="Backlog", group="backlog", color="#60646C")
    entry = attach_issue(issue=issue, project=target, actor=actor)
    original_order = issue.sort_order
    target_state = State.objects.get(project=target, group="backlog" if change_status else "unstarted")
    payload = {"id": str(entry.id), "project_id": str(target.id), "sort_order": 1234.5}
    if change_status:
        payload["state_id"] = str(target_state.id)
    client = client_for(actor)
    response = client.patch(url(workspace, target, f"{entry.id}/"), payload, format="json")
    assert response.status_code == 204, response.data
    issue.refresh_from_db()
    entry.refresh_from_db()
    assert issue.sort_order == original_order
    assert entry.sort_order == 1234.5
    assert entry.state_id == target_state.id
    assert issue.state.group == target_state.group
    response = client.get(url(workspace, target), {"group_by": "state_id"})
    assert response.status_code == 200
    rows = response.data["results"][str(target_state.id)]["results"]
    assert str(entry.id) in [str(row["id"]) for row in rows]


@pytest.mark.parametrize("field", ["id", "project_id"])
def test_board_drag_cannot_change_placement_identity(shared_work, field):
    actor, workspace, _, target, issue = shared_work
    entry = attach_issue(issue=issue, project=target, actor=actor)
    previous_order = entry.sort_order
    response = client_for(actor).patch(
        url(workspace, target, f"{entry.id}/"),
        {field: str(uuid4()), "sort_order": 1234.5},
        format="json",
    )
    assert response.status_code == 400
    entry.refresh_from_db()
    assert entry.sort_order == previous_order
