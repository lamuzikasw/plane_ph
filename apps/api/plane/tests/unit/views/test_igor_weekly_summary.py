# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.app.views.external.base import IgorChatEndpoint
from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueRelation,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory


@pytest.mark.parametrize(
    "message",
    [
        "Собери мой summary за прошлую неделю",
        "Что я делал на прошлой неделе?",
        "Подготовь отчёт начальству",
        "Собери итоги моей работы за неделю",
        "Нужна сводка по моим задачам за прошлую неделю",
        "Что успел сделать за последние 7 дней?",
        "Дай weekly update",
        "Подготовь пятничный отчет",
        "Сформируй резюме моей недели",
        "Отчитай, что было сделано за неделю",
        "Собери мой статус для руководителя",
        "Какие у меня результаты за прошлую неделю?",
        "Сделай апдейт по моим задачам за неделю",
        "Собери выполненное, переносы и блокеры за неделю",
        "Что можно отправить руководителю по моей работе?",
        "Напиши отчёт по задачам сотрудника за прошлую неделю",
        "Как прошла моя рабочая неделя?",
        "Дай дайджест моей работы",
        "Подведи итоги недели",
        "Собери недельный отчёт",
    ],
)
def test_weekly_summary_recognizes_varied_phrasing(message):
    assert IgorChatEndpoint()._detect_weekly_summary_intent(message)


@pytest.mark.parametrize(
    "message",
    [
        "Покажи просроченные задачи за прошлую неделю",
        "Что у меня сегодня?",
        "Открой активные задачи проекта",
        "Какие задачи сейчас заблокированы?",
    ],
)
def test_weekly_summary_does_not_capture_regular_filters(message):
    assert not IgorChatEndpoint()._detect_weekly_summary_intent(message)


@pytest.mark.unit
@pytest.mark.django_db
def test_weekly_summary_defaults_to_requesting_member_and_previous_week(monkeypatch):
    user = UserFactory(email="summary-owner@plane.so", username="summary-owner@plane.so")
    workspace = WorkspaceFactory(slug="igor-summary-context", owner=user, timezone="UTC")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    endpoint = IgorChatEndpoint()
    monkeypatch.setattr(
        endpoint,
        "_get_llm_work_plan",
        lambda *args, **kwargs: pytest.fail("Weekly summaries must not depend on an external LLM"),
    )

    context = endpoint._resolve_query_context("Собери недельный отчёт", workspace, user, [], {})

    assert context["intent"] == "weekly_summary"
    assert context["member"] == user
    assert context["period_label"] == "прошлая неделя"
    assert context["period_end"] < timezone.now()


@pytest.mark.unit
@pytest.mark.django_db
def test_weekly_summary_collects_facts_and_produces_copyable_report():
    user = UserFactory(email="summary-member@plane.so", username="summary-member@plane.so")
    workspace = WorkspaceFactory(slug="igor-summary", owner=user, timezone="UTC")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    project = Project.objects.create(
        workspace=workspace,
        name="Summary Project",
        identifier="SUM",
        network=2,
        project_lead=user,
    )
    backlog = State.objects.create(
        workspace=workspace,
        project=project,
        name="Backlog",
        color="#60646C",
        group="backlog",
        default=True,
    )
    started = State.objects.create(
        workspace=workspace,
        project=project,
        name="Started",
        color="#F59E0B",
        group="started",
    )
    completed = State.objects.create(
        workspace=workspace,
        project=project,
        name="Done",
        color="#46A758",
        group="completed",
    )
    project.default_state = backlog
    project.save(update_fields=["default_state", "updated_at"])

    now = timezone.now()
    period_start = now - timedelta(days=3)
    period_end = now + timedelta(days=3)

    completed_issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=completed,
        name="Release completed",
        sequence_id=1,
        completed_at=now,
    )
    active_issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=started,
        name="Integration in progress",
        sequence_id=2,
        target_date=now + timedelta(days=1),
    )
    blocked_issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=started,
        name="Blocked task",
        sequence_id=3,
    )
    blocker = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=started,
        name="External dependency",
        sequence_id=4,
    )
    next_week_issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        state=backlog,
        name="Next planned task",
        sequence_id=5,
        target_date=period_end + timedelta(days=2),
    )
    for issue in [completed_issue, active_issue, blocked_issue, next_week_issue]:
        IssueAssignee.objects.create(workspace=workspace, project=project, issue=issue, assignee=user)

    IssueActivity.objects.create(
        workspace=workspace,
        project=project,
        issue=active_issue,
        actor=user,
        verb="updated",
        field="description",
        comment="updated the description",
    )
    IssueActivity.objects.create(
        workspace=workspace,
        project=project,
        issue=active_issue,
        actor=user,
        verb="updated",
        field="target_date",
        old_value=(now - timedelta(days=1)).isoformat(),
        new_value=(now + timedelta(days=1)).isoformat(),
    )
    IssueRelation.objects.create(
        workspace=workspace,
        project=project,
        issue=blocked_issue,
        related_issue=blocker,
        relation_type="blocked_by",
    )

    result = IgorChatEndpoint()._build_weekly_summary(
        workspace,
        {
            "intent": "weekly_summary",
            "period_start": period_start,
            "period_end": period_end,
            "period_label": "тестовая неделя",
            "member": user,
            "project": project,
        },
        user,
    )

    metrics = {metric["key"]: metric["value"] for metric in result["widget"]["metrics"]}
    assert metrics == {
        "completed": 1,
        "progressed": 1,
        "deadline_changes": 1,
        "blocked": 1,
        "next_week": 1,
    }
    assert "SUM-1: Release completed" in result["widget"]["copy_text"]
    assert "Срок перенесён" in result["widget"]["copy_text"]
    assert "External dependency" not in result["widget"]["copy_text"]
    assert result["widget"]["source_note"]


@pytest.mark.unit
@pytest.mark.django_db
def test_weekly_summary_does_not_expose_projects_unavailable_to_member():
    owner = UserFactory(email="summary-admin@plane.so", username="summary-admin@plane.so")
    member = UserFactory(email="summary-regular@plane.so", username="summary-regular@plane.so")
    workspace = WorkspaceFactory(slug="igor-summary-access", owner=owner, timezone="UTC")
    WorkspaceMember.objects.create(workspace=workspace, member=owner, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)

    accessible_project = Project.objects.create(
        workspace=workspace,
        name="Accessible Summary Project",
        identifier="ACC",
        network=0,
        project_lead=owner,
    )
    private_project = Project.objects.create(
        workspace=workspace,
        name="Restricted Summary Project",
        identifier="SEC",
        network=0,
        project_lead=owner,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=accessible_project,
        member=member,
        role=15,
    )

    accessible_done = State.objects.create(
        workspace=workspace,
        project=accessible_project,
        name="Done",
        color="#46A758",
        group="completed",
    )
    private_done = State.objects.create(
        workspace=workspace,
        project=private_project,
        name="Done",
        color="#46A758",
        group="completed",
    )
    now = timezone.now()
    visible_issue = Issue.objects.create(
        workspace=workspace,
        project=accessible_project,
        state=accessible_done,
        name="Visible weekly result",
    )
    restricted_issue = Issue.objects.create(
        workspace=workspace,
        project=private_project,
        state=private_done,
        name="Restricted weekly result",
    )
    for issue in [visible_issue, restricted_issue]:
        IssueAssignee.objects.create(workspace=workspace, project=issue.project, issue=issue, assignee=member)

    result = IgorChatEndpoint()._build_weekly_summary(
        workspace,
        {
            "intent": "weekly_summary",
            "period_start": now - timedelta(days=1),
            "period_end": now + timedelta(days=1),
            "period_label": "тестовая неделя",
            "member": member,
            "project": None,
        },
        member,
    )

    metrics = {metric["key"]: metric["value"] for metric in result["widget"]["metrics"]}
    assert metrics["completed"] == 1
    assert "Visible weekly result" in result["widget"]["copy_text"]
    assert "Restricted weekly result" not in result["widget"]["copy_text"]
    assert list(IgorChatEndpoint()._accessible_projects(workspace, member)) == [accessible_project]
