# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from plane.db.models.state import StateGroup


COMPLETION_REQUIREMENTS_ERROR_CODE = "completion_requirements_missing"


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
):
    """Return missing fields only for a new transition into a completed state."""
    if target_state_group != StateGroup.COMPLETED.value:
        return []
    if current_state_group == StateGroup.COMPLETED.value:
        return []

    missing_fields = []
    if not has_assignee:
        missing_fields.append("assignee")
    if target_date is None:
        missing_fields.append("target_date")
    if not priority or priority == "none":
        missing_fields.append("priority")
    return missing_fields


def ensure_completion_requirements(**kwargs):
    missing_fields = completion_requirement_missing_fields(**kwargs)
    if missing_fields:
        raise IssueCompletionRequirementsError(missing_fields)
