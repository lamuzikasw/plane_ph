import logging
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from plane.db.models import GitLabRepository, GitLabWebhookEvent
from plane.utils.gitlab.client import GitLabError
from plane.utils.gitlab.sync import sync_repository

logger = logging.getLogger(__name__)


def enqueue_event(event_id):
    try:
        process_gitlab_event.delay(event_id)
    except Exception:
        # Durable outbox remains pending and is recovered by beat; never log the payload.
        logger.warning("GitLab event persisted; broker unavailable")


@shared_task
def process_gitlab_event(event_id):
    with transaction.atomic():
        event = GitLabWebhookEvent.objects.select_for_update().get(pk=event_id)
        if event.status == "done" or (
            event.status == "processing" and event.updated_at > timezone.now() - timedelta(minutes=10)
        ):
            return
        event.status = "processing"
        event.attempts += 1
        event.save()
    try:
        sync_repository(event.repository_id, event=event.payload, event_type=event.event_type)
    except (GitLabError, KeyError, ValueError) as error:
        GitLabWebhookEvent.objects.filter(pk=event.id).update(
            status="failed", error_code=getattr(error, "code", "invalid_event"), updated_at=timezone.now()
        )
        return
    GitLabWebhookEvent.objects.filter(pk=event.id).update(status="done", error_code="", updated_at=timezone.now())


@shared_task
def reconcile_gitlab_integration(integration_id):
    for repository in GitLabRepository.objects.filter(integration_id=integration_id, enabled=True):
        try:
            sync_repository(repository.id)
        except GitLabError:
            # Other repositories/connections can still make progress.
            continue


@shared_task
def recover_gitlab_events():
    cutoff = timezone.now() - timedelta(minutes=10)
    events = GitLabWebhookEvent.objects.filter(
        Q(status="pending")
        | Q(status="failed", updated_at__lt=timezone.now() - timedelta(minutes=2))
        | Q(status="processing", updated_at__lt=cutoff),
        integration__enabled=True,
        repository__enabled=True,
    ).values_list("id", flat=True)[:100]
    for event_id in events:
        enqueue_event(str(event_id))


@shared_task
def reconcile_gitlab():
    for integration_id in (
        GitLabRepository.objects.filter(integration__enabled=True, enabled=True)
        .values_list("integration_id", flat=True)
        .distinct()
    ):
        reconcile_gitlab_integration.delay(str(integration_id))
