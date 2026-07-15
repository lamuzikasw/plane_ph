# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import secrets
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager

from celery import shared_task
from django.core.cache import cache

from plane.db.models import User, Workspace, WorkspaceMember


@contextmanager
def _capture_job_lock(cache_key, timeout):
    lock_key = f"{cache_key}:worker-lock"
    lock_token = secrets.token_urlsafe(24)
    acquired = cache.add(lock_key, lock_token, timeout=timeout)
    try:
        yield acquired
    finally:
        if acquired and cache.get(lock_key) == lock_token:
            cache.delete(lock_key)


@shared_task(bind=True, max_retries=100, acks_late=True, reject_on_worker_lost=True, ignore_result=True)
def process_igor_capture_job(self, workspace_id, user_id, job_id):
    # Imported inside the worker to avoid coupling API module initialization to Celery startup.
    from plane.app.views.external.base import IgorChatEndpoint

    endpoint = IgorChatEndpoint()
    cache_key = f"igor-capture-job:{workspace_id}:{user_id}:{job_id}"
    with _capture_job_lock(cache_key, endpoint.capture_job_lock_timeout) as acquired:
        if not acquired:
            return
        return _process_igor_capture_job(self, endpoint, workspace_id, user_id, job_id, cache_key)


def _process_igor_capture_job(task, endpoint, workspace_id, user_id, job_id, cache_key):
    job = cache.get(cache_key)
    if not isinstance(job, dict) or job.get("status") == "completed":
        return

    workspace = Workspace.objects.filter(id=workspace_id).first()
    user = User.objects.filter(id=user_id, is_active=True).first()
    has_workspace_access = bool(
        workspace
        and user
        and WorkspaceMember.objects.filter(
            workspace=workspace,
            member=user,
            is_active=True,
            role__gte=15,
        ).exists()
    )
    if not has_workspace_access:
        job["status"] = "failed"
        job["error"] = "access_unavailable"
        endpoint._cache_capture_job(cache_key, job)
        return

    units = job.get("units")
    if not isinstance(units, list) or not units:
        job["status"] = "failed"
        job["error"] = "source_unavailable"
        endpoint._cache_capture_job(cache_key, job)
        return

    projects = list(endpoint._capture_writable_projects(workspace, user))
    members = endpoint._capture_members(workspace, projects)
    batches = endpoint._capture_batches(units)
    document_type = job.get("document_type") or "meeting_notes"
    batch_results = dict(job.get("batch_results") or {})
    batch_attempts = dict(job.get("batch_attempts") or {})
    failed_batches = {str(batch_id) for batch_id in job.get("failed_batches") or []}

    job["status"] = "processing"
    endpoint._cache_capture_job(cache_key, job)

    pending_batches = [
        (str(index), batch)
        for index, batch in enumerate(batches)
        if str(index) not in batch_results and str(index) not in failed_batches
    ]
    retry_attempts = []
    with ThreadPoolExecutor(
        max_workers=endpoint.capture_job_parallelism, thread_name_prefix="igor-capture"
    ) as executor:
        futures = {}
        for batch_id, batch in pending_batches:
            if document_type == "technical_spec":
                future = executor.submit(
                    endpoint._get_llm_spec_map_strict,
                    batch,
                    projects,
                    user,
                    members,
                    int(batch_id),
                )
            else:
                future = executor.submit(endpoint._get_llm_capture_plan_strict, batch, projects, user, members)
            futures[future] = batch_id
        for future in as_completed(futures):
            batch_id = futures[future]
            try:
                plan = future.result()
                if not isinstance(plan, dict):
                    raise ValueError("Capture batch did not return an object")
            except Exception as exception:
                endpoint._log_safe_failure("capture-job-batch", exception)
                attempts = int(batch_attempts.get(batch_id) or 0) + 1
                batch_attempts[batch_id] = attempts
                if attempts < endpoint.capture_job_max_attempts:
                    retry_attempts.append(attempts)
                else:
                    failed_batches.add(batch_id)
            else:
                batch_results[batch_id] = plan
                failed_batches.discard(batch_id)

            job["batch_results"] = batch_results
            job["batch_attempts"] = batch_attempts
            job["failed_batches"] = sorted(failed_batches, key=int)
            job["status"] = "retrying" if retry_attempts else "processing"
            endpoint._cache_capture_job(cache_key, job)

    if retry_attempts:
        job["status"] = "retrying"
        endpoint._cache_capture_job(cache_key, job)
        raise task.retry(
            exc=RuntimeError("Igor capture batch failed"),
            countdown=min(2 ** min(retry_attempts), 30),
        )

    if failed_batches:
        job["status"] = "failed"
        job["error"] = "batch_processing_failed"
        endpoint._cache_capture_job(cache_key, job)
        return

    if document_type == "technical_spec":
        try:
            mapped = [batch_results.get(str(index)) or {} for index in range(len(batches))]
            semantic_map = endpoint._normalize_spec_maps(mapped, units)
            combined = endpoint._get_llm_spec_reduce_strict(units, semantic_map, projects, user, members)
        except Exception as exception:
            endpoint._log_safe_failure("capture-job-reduce", exception)
            reduction_attempts = int(job.get("reduction_attempts") or 0) + 1
            job["reduction_attempts"] = reduction_attempts
            if reduction_attempts < endpoint.capture_job_max_attempts:
                job["status"] = "retrying"
                endpoint._cache_capture_job(cache_key, job)
                raise task.retry(
                    exc=RuntimeError("Igor specification reduction failed"),
                    countdown=min(2**reduction_attempts, 30),
                )
            job["status"] = "failed"
            job["error"] = "reduction_failed"
            endpoint._cache_capture_job(cache_key, job)
            return
    else:
        combined = {"items": [], "tasks": []}
        for index in range(len(batches)):
            plan = batch_results.get(str(index)) or {}
            if isinstance(plan.get("items"), list):
                combined["items"].extend(plan["items"])
            if isinstance(plan.get("tasks"), list):
                combined["tasks"].extend(plan["tasks"])

    try:
        result = endpoint._assemble_capture_review(
            units,
            combined,
            workspace,
            user,
            len(batches),
            writable_projects=projects,
            members=members,
            document_type=document_type,
        )
    except Exception as exception:
        endpoint._log_safe_failure("capture-job-finalize", exception)
        finalize_attempts = int(job.get("finalize_attempts") or 0) + 1
        job["finalize_attempts"] = finalize_attempts
        if finalize_attempts < endpoint.capture_job_max_attempts:
            job["status"] = "retrying"
            endpoint._cache_capture_job(cache_key, job)
            raise task.retry(
                exc=RuntimeError("Igor capture finalization failed"), countdown=min(2**finalize_attempts, 30)
            )
        job["status"] = "failed"
        job["error"] = "finalization_failed"
        endpoint._cache_capture_job(cache_key, job)
        return

    job["status"] = "completed"
    job["result"] = result
    job.pop("error", None)
    endpoint._cache_capture_job(cache_key, job)
