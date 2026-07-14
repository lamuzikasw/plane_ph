# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from plane.app.views.external.base import IgorChatEndpoint
from plane.db.models import Issue, IssueAssignee, Project, State, WorkspaceMember
from plane.tests.factories import UserFactory, WorkspaceFactory


@pytest.mark.unit
@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("В каком проекте находится задача crm_url?", "crm_url"),
        ("Игорь, где задача «crm_url»?", "crm_url"),
        ("Найди мне задачу Автоответы: crm_url", "Автоответы: crm_url"),
        ("Поищи таск custom payment, пожалуйста", "custom payment"),
        ("К какому проекту относится задача crm_url?", "crm_url"),
        ("Where is the task crm_url?", "crm_url"),
    ],
)
def test_task_search_query_is_extracted_from_natural_language(message, expected):
    assert IgorChatEndpoint()._extract_task_search_query(message) == expected


@pytest.mark.unit
@pytest.mark.parametrize("message", ["Покажи мои задачи", "Где задачи?", "В каком проекте задача?"])
def test_generic_task_questions_are_not_mistaken_for_title_search(message):
    assert IgorChatEndpoint()._extract_task_search_query(message) is None


@pytest.mark.unit
@pytest.mark.django_db
def test_task_search_finds_partial_title_and_stays_personal_even_for_manager(monkeypatch):
    manager = UserFactory(email="propandamen@gmail.com", username="propandamen@gmail.com")
    teammate = UserFactory(email="task-search-teammate@plane.so", username="task-search-teammate@plane.so")
    workspace = WorkspaceFactory(slug="igor-task-search", owner=manager)
    WorkspaceMember.objects.create(workspace=workspace, member=manager, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=teammate, role=15)

    own_project = Project.objects.create(
        workspace=workspace,
        name="Личный кабинет PH",
        identifier="PHLK",
        project_lead=manager,
    )
    other_project = Project.objects.create(
        workspace=workspace,
        name="Скрытый проект коллеги",
        identifier="OTHER",
        project_lead=manager,
    )
    own_state = State.objects.create(
        workspace=workspace,
        project=own_project,
        name="Done",
        color="#46A758",
        group="completed",
    )
    other_state = State.objects.create(
        workspace=workspace,
        project=other_project,
        name="In Progress",
        color="#F59E0B",
        group="started",
    )
    own_issue = Issue.objects.create(
        workspace=workspace,
        project=own_project,
        state=own_state,
        name="Автоответы: crm_url при создании custom payment",
        sequence_id=31,
    )
    teammate_issue = Issue.objects.create(
        workspace=workspace,
        project=other_project,
        state=other_state,
        name="Внутренний аудит crm_url",
        sequence_id=7,
    )
    IssueAssignee.objects.create(
        workspace=workspace,
        project=own_project,
        issue=own_issue,
        assignee=manager,
    )
    IssueAssignee.objects.create(
        workspace=workspace,
        project=other_project,
        issue=teammate_issue,
        assignee=teammate,
    )

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("Deterministic task search must not call an external LLM")

    monkeypatch.setattr(IgorChatEndpoint, "_get_llm_work_plan", fail_if_called)
    request = APIRequestFactory().post(
        f"/api/workspaces/{workspace.slug}/igor-chat/",
        {"message": "В каком проекте находится задача crm_url?"},
        format="json",
    )
    force_authenticate(request, user=manager)

    response = IgorChatEndpoint.as_view()(request, slug=workspace.slug)

    assert response.status_code == 200
    assert response.data["intent"] == "task_search"
    assert response.data["context"]["scope"] == "personal"
    assert response.data["context"]["member_id"] == str(manager.id)
    assert response.data["context"]["project_ids"] == []
    assert response.data["context"]["search_query"] == "crm_url"
    assert response.data["widgets"][0]["total"] == 1
    assert [item["id"] for item in response.data["widgets"][0]["items"]] == [str(own_issue.id)]
    assert "Личный кабинет PH" in response.data["answer"]
    assert "Автоответы: crm_url при создании custom payment" in response.data["answer"]
    assert "Скрытый проект коллеги" not in response.data["answer"]


@pytest.mark.unit
@pytest.mark.django_db
def test_task_search_matches_space_and_underscore_variants():
    user = UserFactory(email="task-search-user@plane.so", username="task-search-user@plane.so")
    workspace = WorkspaceFactory(slug="igor-task-search-variants", owner=user)
    project = Project.objects.create(
        workspace=workspace,
        name="Payments",
        identifier="PAY",
        project_lead=user,
    )
    state = State.objects.create(
        workspace=workspace,
        project=project,
        name="Todo",
        color="#60646C",
        group="unstarted",
    )
    issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=state,
        name="Проверить обработку crm_url",
    )
    IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=user)
    queryset = Issue.issue_objects.filter(workspace=workspace, assignees=user)

    result = IgorChatEndpoint()._issues_for_intent(
        "task_search",
        queryset,
        workspace,
        None,
        None,
        "crm url",
    )

    assert list(result.values_list("id", flat=True)) == [issue.id]
