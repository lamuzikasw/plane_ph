from datetime import date, timedelta

import pytest

from plane.db.models import Issue, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_project_member_can_create_and_read_recurring_schedule(api_client):
    user = UserFactory(email="recurring-api@plane.so", username="recurring-api@plane.so")
    workspace = WorkspaceFactory(slug="recurring-api", owner=user, timezone="Europe/Moscow")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(workspace=workspace, name="Recurring API", identifier="RAPI")
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20)
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
        default=True,
    )
    source = Issue.objects.create(project=project, state=state, name="Daily report")
    api_client.force_authenticate(user=user)
    path = f"/api/workspaces/{workspace.slug}/projects/{project.id}/recurring-work-items/"

    response = api_client.post(
        path,
        {
            "source_issue_id": str(source.id),
            "frequency": "weekly",
            "interval": 1,
            "weekdays": [0, 1, 2, 3, 4],
            "start_date": date.today().isoformat(),
            "end_date": (date.today() + timedelta(days=30)).isoformat(),
            "run_time": "09:00",
            "due_offset_days": 0,
            "due_time": "18:00",
            "is_active": True,
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.data["timezone"] == "Europe/Moscow"
    assert response.data["source_issue_name"] == "Daily report"
    assert response.data["next_run_at"] is not None

    list_response = api_client.get(path, {"source_issue_id": str(source.id)})
    assert list_response.status_code == 200
    assert len(list_response.data) == 1
    assert list_response.data[0]["id"] == response.data["id"]
