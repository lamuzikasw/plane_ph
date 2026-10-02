from copy import deepcopy
import re

import pytest

from plane.db.models import BoardLink, Cycle, Project, ProjectMember, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def board(api_client):
    user = UserFactory(username="board-owner")
    workspace = WorkspaceFactory(owner=user)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(workspace=workspace, name="Shared board", identifier="SHR")
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20)
    api_client.force_authenticate(user=user)
    payload = {
        "filters": {"priority__in": "high,urgent"},
        "display": {
            "displayFilters": {"layout": "kanban", "group_by": "assignees", "sub_group_by": "state"},
            "displayProperties": {"key": False},
        },
    }
    return api_client, user, workspace, project, payload


def create_path(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/board-links/"


def detail_path(token):
    return f"/api/board-links/{token}/"


def test_project_and_cycle_snapshots_are_immutable_and_deduplicated(board):
    client, user, workspace, project, payload = board
    response = client.post(create_path(workspace, project), payload, format="json")
    assert response.status_code == 201
    token = response.data["token"]
    assert re.fullmatch(r"[A-Za-z0-9_-]{12}", token)
    assert response.data["path"] == f"/{workspace.slug}/projects/{project.id}/issues/"
    assert client.get(detail_path(token)).data == response.data
    repeated = client.post(create_path(workspace, project), deepcopy(payload), format="json")
    assert repeated.status_code == 200
    assert repeated.data["token"] == token
    changed = deepcopy(payload)
    changed["display"]["displayFilters"]["group_by"] = "priority"
    assert client.post(create_path(workspace, project), changed, format="json").data["token"] != token
    assert client.get(detail_path(token)).data["display"] == payload["display"]
    assert client.patch(detail_path(token), changed, format="json").status_code == 405
    cycle = Cycle.objects.create(project=project, name="Sprint", owned_by=user)
    cycle_payload = {**payload, "cycle_id": str(cycle.id)}
    cycle_response = client.post(create_path(workspace, project), cycle_payload, format="json")
    assert cycle_response.status_code == 201
    assert cycle_response.data["path"] == f"/{workspace.slug}/projects/{project.id}/cycles/{cycle.id}/"
    assert cycle_response.data["token"] != token


def test_token_does_not_grant_project_access_and_revocation_takes_effect(board):
    client, user, workspace, project, payload = board
    token = client.post(create_path(workspace, project), payload, format="json").data["token"]
    outsider = UserFactory(username="board-outsider")
    client.force_authenticate(user=outsider)
    assert client.get(detail_path(token)).status_code == 404
    assert client.post(create_path(workspace, project), payload, format="json").status_code == 404
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)
    assert client.get(detail_path(token)).status_code == 404
    membership = ProjectMember.objects.create(workspace=workspace, project=project, member=outsider, role=15)
    assert client.get(detail_path(token)).status_code == 200
    membership.is_active = False
    membership.save()
    assert client.get(detail_path(token)).status_code == 404
    client.force_authenticate(user=None)
    assert client.get(detail_path(token)).status_code in (401, 403)
    assert client.post(create_path(workspace, project), payload, format="json").status_code in (401, 403)


def test_cycle_must_belong_to_project_and_deleted_cycle_cannot_resolve(board):
    client, user, workspace, project, payload = board
    other = Project.objects.create(workspace=workspace, name="Other", identifier="OTH")
    foreign_cycle = Cycle.objects.create(project=other, name="Foreign", owned_by=user)
    assert (
        client.post(
            create_path(workspace, project), {**payload, "cycle_id": str(foreign_cycle.id)}, format="json"
        ).status_code
        == 404
    )
    cycle = Cycle.objects.create(project=project, name="Current", owned_by=user)
    token = client.post(create_path(workspace, project), {**payload, "cycle_id": str(cycle.id)}, format="json").data[
        "token"
    ]
    cycle.delete()
    assert client.get(detail_path(token)).status_code == 404


@pytest.mark.parametrize(
    "patch",
    [
        {"filters": []},
        {"filters": {"a": "x" * 33000}},
        {"display": {}},
        {"display": {"displayFilters": [], "displayProperties": {}}},
        {"cycle_id": "not-a-uuid"},
    ],
)
def test_invalid_snapshots_are_rejected(board, patch):
    client, _, workspace, project, payload = board
    assert client.post(create_path(workspace, project), {**payload, **patch}, format="json").status_code == 400
    assert not BoardLink.objects.exists()


def test_project_from_other_workspace_and_missing_tokens_are_rejected(board):
    client, user, workspace, project, payload = board
    other_workspace = WorkspaceFactory(owner=user)
    assert client.post(create_path(other_workspace, project), payload, format="json").status_code == 404
    assert client.get(detail_path("missingtoken")).status_code == 404
