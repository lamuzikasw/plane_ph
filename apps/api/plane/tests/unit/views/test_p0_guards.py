# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from types import SimpleNamespace

import pytest
from rest_framework.test import APIRequestFactory

from plane.app.views.analytic.management import ManagementAnalyticsEndpoint
from plane.app.views.issue.base import IssueBulkUpdateDateEndpoint
from plane.app.views.issue.relation import IssueRelationViewSet
from plane.app.views.project.member import ProjectMemberViewSet
from plane.db.models import Issue, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory


def _setup_project(slug):
    user = UserFactory(email=f"{slug}@plane.so", username=f"{slug}@plane.so")
    workspace = WorkspaceFactory(slug=slug, owner=user, timezone="Europe/Moscow")
    project = Project.objects.create(
        workspace=workspace,
        project_lead=user,
        name="P0 project",
        identifier="PZERO",
    )
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20)
    return user, workspace, project, state


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_bulk_datetime_preserves_time_and_rejects_partial_unknown_id(monkeypatch):
    user, workspace, project, state = _setup_project("bulk-datetime")
    issue = Issue.objects.create(project=project, state=state, name="Timed work")
    monkeypatch.setattr("plane.app.views.issue.base.issue_activity.delay", lambda **_kwargs: None)
    endpoint = IssueBulkUpdateDateEndpoint()

    response = endpoint.post(
        SimpleNamespace(
            user=user,
            data={"updates": [{"id": str(issue.id), "target_date": "2026-07-15T18:30:00+03:00"}]},
        ),
        slug=workspace.slug,
        project_id=project.id,
    )
    assert response.status_code == 200
    issue.refresh_from_db()
    assert issue.target_date.hour == 15  # stored in UTC
    assert issue.target_date.minute == 30

    old_target = issue.target_date
    response = endpoint.post(
        SimpleNamespace(
            user=user,
            data={
                "updates": [
                    {"id": str(issue.id), "target_date": "2026-07-16T19:00:00+03:00"},
                    {"id": "00000000-0000-0000-0000-000000000000", "target_date": "2026-07-16"},
                ]
            },
        ),
        slug=workspace.slug,
        project_id=project.id,
    )
    assert response.status_code == 404
    issue.refresh_from_db()
    assert issue.target_date == old_target


@pytest.mark.unit
@pytest.mark.django_db
def test_relation_creation_rejects_an_inaccessible_target():
    user, workspace, project, state = _setup_project("relation-idor")
    source = Issue.objects.create(project=project, state=state, name="Visible")
    hidden_project = Project.objects.create(
        workspace=workspace,
        project_lead=user,
        name="Hidden",
        identifier="HIDDEN",
    )
    hidden_state = State.objects.create(
        workspace=workspace,
        project=hidden_project,
        name="Todo",
        group="unstarted",
        color="#60646C",
    )
    hidden = Issue.objects.create(project=hidden_project, state=hidden_state, name="Hidden target")

    response = IssueRelationViewSet().create(
        SimpleNamespace(
            user=user,
            data={"relation_type": "relates_to", "issues": [str(hidden.id)]},
        ),
        slug=workspace.slug,
        project_id=project.id,
        issue_id=source.id,
    )

    assert response.status_code == 404


@pytest.mark.unit
@pytest.mark.django_db
def test_management_analytics_is_denied_to_admin_and_available_to_super_admin():
    admin = UserFactory(email="analytics-admin@plane.so", username="analytics-admin@plane.so")
    leader = UserFactory(email="analytics-leader@plane.so", username="analytics-leader@plane.so")
    workspace = WorkspaceFactory(slug="analytics-role-boundary", owner=leader)
    WorkspaceMember.objects.create(workspace=workspace, member=admin, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=leader, role=30)
    factory = APIRequestFactory()

    admin_request = factory.get("/analytics/overview")
    admin_request.user = admin
    denied = ManagementAnalyticsEndpoint().get(admin_request, slug=workspace.slug, section="overview")
    assert denied.status_code == 403

    leader_request = factory.get("/analytics/overview")
    leader_request.user = leader
    allowed = ManagementAnalyticsEndpoint().get(leader_request, slug=workspace.slug, section="overview")
    assert allowed.status_code == 200


@pytest.mark.unit
@pytest.mark.django_db
def test_project_settings_cannot_change_or_remove_og_access():
    og = UserFactory(email="project-og@plane.so", username="project-og@plane.so")
    workspace = WorkspaceFactory(slug="project-og-boundary", owner=og)
    project = Project.objects.create(
        workspace=workspace,
        project_lead=og,
        name="OG project",
        identifier="OGP",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=og, role=30)
    project_member = ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=og,
        role=20,
    )
    request = SimpleNamespace(user=og, data={"role": 15})
    view = ProjectMemberViewSet()

    update_response = view.partial_update(
        request,
        slug=workspace.slug,
        project_id=project.id,
        pk=project_member.id,
    )
    assert update_response.status_code == 403
    assert update_response.data["error"] == "OG access is managed at workspace level"

    remove_response = view.destroy(
        SimpleNamespace(user=og),
        slug=workspace.slug,
        project_id=project.id,
        pk=project_member.id,
    )
    assert remove_response.status_code == 403
    project_member.refresh_from_db()
    assert project_member.is_active is True
