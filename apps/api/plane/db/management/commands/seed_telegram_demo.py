"""Create local-only demo tasks; optional event emission uses the real queue policy."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueComment,
    Project,
    ProjectMember,
    State,
    TelegramConnection,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.utils.telegram import enqueue_activities


class Command(BaseCommand):
    help = "Seed Telegram demo tasks in a local instance; --emit queues demo notifications for one connected user."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--user-id", required=True)
        parser.add_argument("--emit", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo data is available only in a local DEBUG instance.")
        user = User.objects.get(pk=options["user_id"])
        workspace = Workspace.objects.get(slug=options["workspace"])
        if not WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True).exists():
            raise CommandError("User must belong to the demo workspace.")
        actor, _ = User.objects.get_or_create(
            email="telegram-demo-actor@plane.invalid",
            defaults={
                "username": "telegram-demo-actor",
                "first_name": "Демо",
                "last_name": "Коллега",
                "is_bot": True,
            },
        )
        project, _ = Project.objects.get_or_create(
            workspace=workspace, identifier="TGDEMO", defaults={"name": "Telegram — проверка уведомлений"}
        )
        for member in (user, actor):
            WorkspaceMember.objects.get_or_create(workspace=workspace, member=member, defaults={"role": 15})
            ProjectMember.objects.get_or_create(project=project, member=member, defaults={"role": 20})
        state, _ = State.objects.get_or_create(
            project=project, name="Проверить", defaults={"group": "unstarted", "color": "#3b82f6", "default": True}
        )
        issues = []
        for index, name in enumerate(
            ("Назначение и упоминание", "Ответ внутри ветки", "Несколько комментариев — одна сводка"), 1
        ):
            issue, _ = Issue.objects.get_or_create(
                project=project,
                external_source="telegram_demo",
                external_id=str(index),
                defaults={"name": name, "state": state, "created_by": actor},
            )
            IssueAssignee.objects.get_or_create(project=project, issue=issue, assignee=user)
            issues.append(issue)
        root, _ = IssueComment.objects.get_or_create(
            project=project,
            issue=issues[1],
            external_source="telegram_demo",
            external_id="root",
            defaults={"actor": actor, "comment_html": "<p>Демонстрационная ветка для проверки адресата ответа.</p>"},
        )
        target, _ = IssueComment.objects.get_or_create(
            project=project,
            issue=issues[1],
            external_source="telegram_demo",
            external_id="target",
            defaults={"actor": user, "parent": root, "comment_html": "<p>Мой вопрос: какой вариант выбираем?</p>"},
        )
        if options["emit"]:
            if not TelegramConnection.objects.filter(user=user, confirmed_at__isnull=False).exists():
                raise CommandError("Connect Telegram in Plane first.")
            if str(user.id) not in settings.TELEGRAM_DELIVERY_USER_IDS:
                raise CommandError("Enable delivery for this pilot user first.")
            stamp = int(timezone.now().timestamp())
            activities = [
                IssueActivity.objects.create(
                    project=project,
                    issue=issues[0],
                    actor=actor,
                    field="assignees",
                    verb="updated",
                    new_identifier=user.id,
                    epoch=stamp,
                )
            ]
            content = (
                '<p>Это тестовое упоминание. <mention-component entity_name="user_mention" '
                f'entity_identifier="{user.id}">@Участник</mention-component>, '
                "ссылка откроет этот комментарий.</p>"
            )
            examples = [
                (issues[0], content, None, None),
                (issues[1], "<p>Отвечаю на ваш вопрос внутри ветки. Уведомление предназначено вам.</p>", root, target),
            ]
            examples += [
                (
                    issues[2],
                    f"<p>Тестовый комментарий {i}: эти три сообщения должны прийти одной сводкой.</p>",
                    None,
                    None,
                )
                for i in range(1, 4)
            ]
            for issue, content, parent, reply_to in examples:
                comment = IssueComment.objects.create(
                    project=project, issue=issue, actor=actor, comment_html=content, parent=parent, reply_to=reply_to
                )
                activities.append(
                    IssueActivity.objects.create(
                        project=project,
                        issue=issue,
                        actor=actor,
                        issue_comment=comment,
                        field="comment",
                        verb="created",
                        new_value=content,
                        new_identifier=comment.id,
                        epoch=stamp,
                    )
                )
            enqueue_activities(activities)
        for issue in issues:
            self.stdout.write(f"{settings.WEB_URL}/{workspace.slug}/browse/TGDEMO-{issue.sequence_id}/")
