# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models

from .project import ProjectBaseModel


class IssuePlacement(ProjectBaseModel):
    """A project-local identity for shared work; the Issue owns all content.

    Detached placements are retained so reattaching restores the same number.
    The original placement remains represented by Issue.project/sequence_id.
    """

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="placements")
    sequence_id = models.PositiveBigIntegerField()
    state = models.ForeignKey("db.State", on_delete=models.PROTECT, related_name="issue_placements")
    sort_order = models.FloatField(default=65535)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "issue_placements"
        constraints = [
            models.UniqueConstraint(fields=["issue", "project"], name="issue_placement_unique_project"),
            models.UniqueConstraint(fields=["project", "sequence_id"], name="issue_placement_unique_number"),
        ]
