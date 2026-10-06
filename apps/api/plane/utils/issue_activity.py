# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from collections.abc import Mapping
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder

from plane.db.models import Issue, IssueAssignee


def serialize_issue_creation_activity(issue: Issue, request_data: Mapping[str, Any]) -> str:
    """Capture initial assignments before the asynchronous activity task runs."""
    requested_data = dict(request_data.items())
    requested_data["assignee_ids"] = [
        str(assignee_id)
        for assignee_id in IssueAssignee.objects.filter(issue_id=issue.pk).values_list("assignee_id", flat=True)
    ]
    return json.dumps(requested_data, cls=DjangoJSONEncoder)
