import pytest

from plane.db.models import Label, Project, ProjectMember, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("role", [15, 5])
def test_active_project_participant_can_create_label(api_client, role):
    user = UserFactory(email=f"label-member-{role}@plane.so", username=f"label-member-{role}@plane.so")
    workspace = WorkspaceFactory(slug=f"label-member-{role}", owner=user)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    project = Project.objects.create(workspace=workspace, name="Label permissions", identifier="LP")
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=role)
    api_client.force_authenticate(user=user)

    response = api_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issue-labels/",
        {"name": f"Created by role {role}", "color": "#60646C"},
        format="json",
    )

    assert response.status_code == 201
    assert Label.objects.filter(project=project, name=f"Created by role {role}").exists()
