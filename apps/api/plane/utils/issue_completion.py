# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from plane.db.models.state import StateGroup
from plane.utils.permissions.super_admin import SUPER_ADMIN_ROLE


COMPLETION_REQUIREMENTS_ERROR_CODE = "completion_requirements_missing"
OG_OPTIONAL_COMPLETION_FIELDS = frozenset({"target_date", "priority"})


class IssueCompletionRequirementsError(Exception):
    """Raised when a work item is moved to completed without required data."""

    def __init__(self, missing_fields):
        self.missing_fields = list(missing_fields)
        super().__init__("Complete the required fields before finishing this work item")

    @property
    def response_data(self):
        return {
            "code": COMPLETION_REQUIREMENTS_ERROR_CODE,
            "detail": "Нельзя завершить задачу: заполните обязательные поля.",
            "missing_fields": self.missing_fields,
        }


def completion_requirement_missing_fields(
    *,
    current_state_group,
    target_state_group,
    has_assignee,
    target_date,
    priority,
    optional_fields=(),
):
    """Return missing fields only for a new transition into a completed state."""
    if target_state_group != StateGroup.COMPLETED.value:
        return []
    if current_state_group == StateGroup.COMPLETED.value:
        return []

    optional_fields = set(optional_fields)
    missing_fields = []
    if not has_assignee:
        missing_fields.append("assignee")
    if target_date is None and "target_date" not in optional_fields:
        missing_fields.append("target_date")
    if (not priority or priority == "none") and "priority" not in optional_fields:
        missing_fields.append("priority")
    return missing_fields


def completion_optional_fields_for_actor(*, actor, workspace_id):
    """Allow an active workspace OG to complete work without planning metadata."""
    actor_id = getattr(actor, "id", None)
    if not actor_id or not workspace_id:
        return frozenset()

    from plane.db.models import WorkspaceMember

    if WorkspaceMember.objects.filter(
        workspace_id=workspace_id,
        member_id=actor_id,
        role=SUPER_ADMIN_ROLE,
        is_active=True,
    ).exists():
        return OG_OPTIONAL_COMPLETION_FIELDS
    return frozenset()


def ensure_completion_requirements(**kwargs):
    missing_fields = completion_requirement_missing_fields(**kwargs)
    if missing_fields:
        raise IssueCompletionRequirementsError(missing_fields)
