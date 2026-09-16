# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import Issue, Project, ProjectIdentifier, ProjectMember, State, User
from plane.utils.issue_placements import attach_issue, require_project_access


class Command(BaseCommand):
    help = "Enable shared work items on a specified test project and create an isolated companion board and demo issue."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--project-id", required=True)
        parser.add_argument("--actor-id", required=True)
        parser.add_argument("--apply", action="store_true", help="Apply the demo; otherwise print the planned scope.")

    @transaction.atomic
    def handle(self, *args, **options):
        source = Project.objects.filter(pk=options["project_id"], workspace__slug=options["workspace"]).first()
        actor = User.objects.filter(pk=options["actor_id"]).first()
        if not source or not actor:
            raise CommandError("Project or actor not found.")
        require_project_access(actor, source, write=True)
        marker = f"issue-placement-demo:{source.id}"
        identifier = "MPTST"
        target = Project.objects.filter(workspace=source.workspace, identifier=identifier).first()
        if target and target.description != marker:
            raise CommandError("MPTST already belongs to another project; nothing was changed.")
        if not options["apply"]:
            self.stdout.write(
                json.dumps(
                    {
                        "source_project": source.name,
                        "source_id": str(source.id),
                        "companion_identifier": identifier,
                        "apply": False,
                    }
                )
            )
            return

        source.issue_placements_enabled = True
        source.save(update_fields=["issue_placements_enabled", "updated_at"])
        if not target:
            target = Project.objects.create(
                workspace=source.workspace,
                name="[Test] Shared work items",
                identifier=identifier,
                description=marker,
                project_lead=actor,
                network=0,
                issue_placements_enabled=True,
            )
            ProjectIdentifier.objects.create(project=target, workspace=source.workspace, name=identifier)
            for member in ProjectMember.objects.filter(project=source, is_active=True):
                ProjectMember.objects.create(project=target, member=member.member, role=member.role)
            for state in State.objects.filter(project=source, is_triage=False):
                State.objects.create(
                    project=target,
                    name=state.name,
                    group=state.group,
                    color=state.color,
                    sequence=state.sequence,
                    default=state.default,
                )
        issue = Issue.objects.filter(project=source, external_source="issue-placement-demo", external_id=marker).first()
        if not issue:
            issue = Issue(
                project=source,
                name="[Test] One work item in two projects",
                description_html="<p>This is one shared work item. Edit its title or description from either project. Each project has its own identifier.</p>",
                external_source="issue-placement-demo",
                external_id=marker,
            )
            issue.save(created_by_id=actor.id)
        entry = attach_issue(issue=issue, project=target, actor=actor)
        self.stdout.write(
            json.dumps(
                {
                    "source_project_id": str(source.id),
                    "companion_project_id": str(target.id),
                    "canonical_issue_id": str(issue.id),
                    "placement_id": str(entry.id),
                    "identifiers": [
                        f"{source.identifier}-{issue.sequence_id}",
                        f"{target.identifier}-{entry.sequence_id}",
                    ],
                }
            )
        )
