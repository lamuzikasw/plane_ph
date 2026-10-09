from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import Page, PageFolder, Project, ProjectMember, ProjectPage, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def docs():
    with patch("celery.app.task.Task.delay"):
        owner = UserFactory(username=str(uuid4()))
        other = UserFactory(username=str(uuid4()))
        workspace = WorkspaceFactory(owner=owner)
        for user in (owner, other):
            WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        project = Project.objects.create(workspace=workspace, name="Docs", identifier="DOC", page_view=True)
        for user in (owner, other):
            ProjectMember.objects.create(project=project, member=user, role=15)
        page = Page.objects.create(workspace=workspace, name="Architecture", owned_by=owner)
        ProjectPage.objects.create(workspace=workspace, project=project, page=page)
        client = APIClient()
        client.force_authenticate(owner)
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
        yield client, project, page, owner, other, base


def new_folder(docs, name="Engineering", parent=None):
    client, _, _, _, _, base = docs
    response = client.post(f"{base}/page-folders/", {"name": name, "parent": parent}, format="json")
    assert response.status_code == 201, response.data
    return response.data["id"]


def test_create_nested_folders_and_rename(docs):
    root = new_folder(docs)
    child = new_folder(docs, "Architecture", root)
    client, _, _, _, _, base = docs
    response = client.patch(f"{base}/page-folders/{child}/", {"name": "  Backend  "}, format="json")
    assert response.status_code == 200
    assert response.data["name"] == "Backend"
    assert response.data["parent"] == root


@pytest.mark.parametrize("name", ["", "   ", "x" * 256])
def test_invalid_folder_names(docs, name):
    client, _, _, _, _, base = docs
    assert client.post(f"{base}/page-folders/", {"name": name}, format="json").status_code == 400


def test_cycles_and_missing_parents_rejected(docs):
    root = new_folder(docs)
    child = new_folder(docs, "Nested", root)
    client, _, _, _, _, base = docs
    for parent in (root, child):
        response = client.patch(f"{base}/page-folders/{root}/", {"parent": parent}, format="json")
        assert response.status_code == 400
    assert client.patch(f"{base}/page-folders/{root}/", {"parent": str(uuid4())}, format="json").status_code == 404
    assert PageFolder.objects.get(id=root).parent_id is None


def test_move_document_preserves_content_and_url_identity(docs):
    folder = new_folder(docs)
    client, project, page, _, _, base = docs
    response = client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": folder}, format="json")
    assert response.status_code == 200
    assert ProjectPage.objects.get(project=project, page=page).folder_id == PageFolder.objects.get(id=folder).id
    assert client.get(f"{base}/pages/{page.id}/").status_code == 200
    assert str(client.get(f"{base}/pages/").data[0]["id"]) == str(page.id)
    assert client.get(f"{base}/page-folders/").data["locations"][str(page.id)]["folder_id"] == folder
    assert client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": None}, format="json").status_code == 200
    page.refresh_from_db()
    assert page.name == "Architecture" and page.parent_id is None


def test_delete_folder_lifts_documents_and_subfolders_without_deletion(docs):
    root = new_folder(docs)
    folder = new_folder(docs, "Middle", root)
    child = new_folder(docs, "Child", folder)
    client, project, page, _, _, base = docs
    private = Page.objects.create(workspace=project.workspace, name="Private", owned_by=docs[4], access=1)
    ProjectPage.objects.create(workspace=project.workspace, project=project, page=private, folder_id=folder)
    ProjectPage.objects.filter(project=project, page=page).update(folder_id=folder)
    assert client.delete(f"{base}/page-folders/{folder}/").status_code == 204
    assert not PageFolder.objects.filter(id=folder).exists()
    assert str(PageFolder.objects.get(id=child).parent_id) == root
    assert set(ProjectPage.objects.filter(project=project).values_list("folder_id", flat=True)) == {
        PageFolder.objects.get(id=root).id
    }
    assert Page.objects.filter(id__in=[page.id, private.id]).count() == 2
    assert client.delete(f"{base}/page-folders/{root}/").status_code == 204
    assert ProjectPage.objects.get(project=project, page=page).folder_id is None
    assert PageFolder.objects.get(id=child).parent_id is None


def test_create_document_inside_folder_and_reject_foreign_folder(docs):
    folder = new_folder(docs)
    client, project, _, _, _, base = docs
    response = client.post(f"{base}/pages/", {"name": "New doc", "folder_id": folder}, format="json")
    assert response.status_code == 201, response.data
    assert str(ProjectPage.objects.get(page_id=response.data["id"], project=project).folder_id) == folder
    foreign_project = Project.objects.create(workspace=project.workspace, name="Other", identifier="OTH")
    foreign_folder = PageFolder.objects.create(workspace=project.workspace, project=foreign_project, name="Other")
    assert (
        client.post(
            f"{base}/pages/", {"name": "Invalid", "folder_id": str(foreign_folder.id)}, format="json"
        ).status_code
        == 400
    )
    assert not Page.objects.filter(name="Invalid").exists()
    assert (
        client.post(
            f"{base}/page-folders/", {"name": "Invalid", "parent": str(foreign_folder.id)}, format="json"
        ).status_code
        == 404
    )


def test_private_document_hidden_and_move_denied(docs):
    client, project, page, _, other, base = docs
    page.access = 1
    page.save()
    client.force_authenticate(other)
    assert str(page.id) not in client.get(f"{base}/page-folders/").data["locations"]
    assert client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": None}, format="json").status_code == 403


def test_locked_document_cannot_move(docs):
    client, _, page, _, _, base = docs
    page.is_locked = True
    page.save()
    assert client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": None}, format="json").status_code == 400


def test_guest_reads_structure_but_cannot_change_it(docs):
    folder = new_folder(docs)
    client, project, page, owner, _, base = docs
    ProjectMember.objects.filter(project=project, member=owner).update(role=5)
    assert client.get(f"{base}/page-folders/").status_code == 200
    assert client.post(f"{base}/page-folders/", {"name": "Guest"}, format="json").status_code == 403
    assert client.patch(f"{base}/page-folders/{folder}/", {"name": "Guest"}, format="json").status_code == 403
    assert client.delete(f"{base}/page-folders/{folder}/").status_code == 403
    assert client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": folder}, format="json").status_code == 403


def test_restricted_guest_only_receives_own_document_locations(docs):
    client, project, page, _, other, base = docs
    project.guest_view_all_features = False
    project.save()
    ProjectMember.objects.filter(project=project, member=other).update(role=5)
    client.force_authenticate(other)
    assert str(page.id) not in client.get(f"{base}/page-folders/").data["locations"]


def test_nonmember_disabled_project_and_wrong_workspace_denied(docs):
    client, project, _, owner, other, base = docs
    ProjectMember.objects.filter(project=project, member=other).delete()
    client.force_authenticate(other)
    assert client.get(f"{base}/page-folders/").status_code == 403
    client.force_authenticate(owner)
    project.page_view = False
    project.save()
    assert client.get(f"{base}/page-folders/").status_code == 403
    assert client.get(f"/api/workspaces/wrong/projects/{project.id}/page-folders/").status_code == 403
    assert APIClient().get(f"{base}/page-folders/").status_code in (401, 403)


def test_folder_is_scoped_to_project_membership(docs):
    folder = new_folder(docs)
    client, project, page, _, _, base = docs
    second = Project.objects.create(workspace=project.workspace, name="Second", identifier="SEC")
    second_location = ProjectPage.objects.create(workspace=project.workspace, project=second, page=page)
    assert client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": folder}, format="json").status_code == 200
    second_location.refresh_from_db()
    assert second_location.folder_id is None
    assert client.post(f"{base}/pages/{page.id}/folder/", {}, format="json").status_code == 400
    foreign = PageFolder.objects.create(project=second, workspace=project.workspace, name="Foreign")
    assert (
        client.post(f"{base}/pages/{page.id}/folder/", {"folder_id": str(foreign.id)}, format="json").status_code == 404
    )


def test_document_activity_is_enqueued_only_after_commit(docs, django_capture_on_commit_callbacks):
    client, _, _, _, _, base = docs
    with patch("plane.app.views.page.base.page_transaction.delay") as delay:
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post(f"{base}/pages/", {"name": "Committed doc"}, format="json")
            assert response.status_code == 201
            assert not delay.called
        delay.assert_called_once()
        assert str(delay.call_args.kwargs["page_id"]) == str(response.data["id"])
