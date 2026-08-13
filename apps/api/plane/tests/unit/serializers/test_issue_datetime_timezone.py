# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import datetime

import pytest
import pytz

from plane.api.serializers.issue import IssueSerializer as PublicIssueSerializer
from plane.app.serializers.issue import IssueCreateSerializer
from plane.db.models import Issue, Project, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory


def _setup_project(timezone="Europe/Moscow"):
    user = UserFactory(email="datetime@plane.so", username="datetime@plane.so")
    workspace = WorkspaceFactory(
        slug=f"datetime-{timezone.lower().replace('/', '-')}",
        owner=user,
        timezone=timezone,
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(
        workspace=workspace,
        project_lead=user,
        name=f"Date-time {timezone}",
        identifier="TIME",
        timezone=timezone,
    )
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        group="unstarted",
        color="#60646C",
    )
    return workspace, project, state


@pytest.mark.unit
@pytest.mark.django_db
@pytest.mark.parametrize("serializer_class", [PublicIssueSerializer, IssueCreateSerializer])
def test_issue_serializers_interpret_naive_datetimes_in_project_timezone(serializer_class):
    workspace, project, state = _setup_project()
    serializer = serializer_class(
        data={
            "name": "Moscow wall-clock time",
            "state" if serializer_class is PublicIssueSerializer else "state_id": str(state.id),
            "start_date": "2026-08-20T09:30:00",
            "target_date": "2026-08-20T23:59:00",
        },
        context={"workspace_id": workspace.id, "project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["start_date"] == datetime(
        2026, 8, 20, 6, 30, tzinfo=pytz.UTC
    )
    assert serializer.validated_data["target_date"] == datetime(
        2026, 8, 20, 20, 59, tzinfo=pytz.UTC
    )


@pytest.mark.unit
@pytest.mark.django_db
@pytest.mark.parametrize("serializer_class", [PublicIssueSerializer, IssueCreateSerializer])
def test_issue_serializers_interpret_date_only_as_project_midnight(serializer_class):
    workspace, project, state = _setup_project()
    serializer = serializer_class(
        data={
            "name": "Moscow midnight",
            "state" if serializer_class is PublicIssueSerializer else "state_id": str(state.id),
            "start_date": "2026-08-20",
        },
        context={"workspace_id": workspace.id, "project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["start_date"] == datetime(
        2026, 8, 19, 21, 0, tzinfo=pytz.UTC
    )


@pytest.mark.unit
@pytest.mark.django_db
@pytest.mark.parametrize("serializer_class", [PublicIssueSerializer, IssueCreateSerializer])
def test_issue_serializers_preserve_explicit_timezone(serializer_class):
    workspace, project, state = _setup_project()
    serializer = serializer_class(
        data={
            "name": "Explicit UTC instant",
            "state" if serializer_class is PublicIssueSerializer else "state_id": str(state.id),
            "start_date": "2026-08-20T06:30:00Z",
        },
        context={"workspace_id": workspace.id, "project_id": project.id},
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["start_date"].astimezone(pytz.UTC) == datetime(
        2026, 8, 20, 6, 30, tzinfo=pytz.UTC
    )


@pytest.mark.unit
@pytest.mark.django_db
def test_issue_update_uses_instance_project_timezone_without_context_project_id():
    workspace, project, state = _setup_project()
    issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=state,
        name="Existing issue",
    )
    serializer = PublicIssueSerializer(
        issue,
        data={"start_date": "2026-08-20T09:30:00"},
        partial=True,
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["start_date"] == datetime(
        2026, 8, 20, 6, 30, tzinfo=pytz.UTC
    )
