# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import OuterRef, Q, QuerySet
from django.contrib.postgres.expressions import ArraySubquery

# Third party imports
from rest_framework import serializers, status
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.db.models import Issue, IssueAssignee, IssueLabel, ProjectMember, IssueRelation
from plane.utils.issue_search import search_issues


class IssueSearchFiltersSerializer(serializers.Serializer):
    project_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    state_groups = serializers.ListField(
        child=serializers.ChoiceField(choices=["backlog", "unstarted", "started", "completed", "cancelled"]),
        required=False,
    )
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    unassigned = serializers.BooleanField(default=False)
    priorities = serializers.ListField(
        child=serializers.ChoiceField(choices=["urgent", "high", "medium", "low", "none"]), required=False
    )
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    offset = serializers.IntegerField(min_value=0, default=0)
    limit = serializers.IntegerField(min_value=1, max_value=100, default=100)


class IssueSearchEndpoint(BaseAPIView):
    def filter_issues_by_project(self, project_id: int, issues: QuerySet) -> QuerySet:
        """
        Filter issues by project
        """

        issues = issues.filter(project_id=project_id)

        return issues

    def search_issues_by_query(self, query: str, issues: QuerySet) -> QuerySet:
        """
        Search issues by query
        """

        issues = search_issues(query, issues)

        return issues

    def search_issues_and_excluding_parent(self, issues: QuerySet, issue_id: str) -> QuerySet:
        """
        Search issues and epics by query excluding the parent
        """

        issue = Issue.issue_objects.filter(pk=issue_id).first()
        if issue:
            issues = issues.filter(~Q(pk=issue_id), ~Q(pk=issue.parent_id), ~Q(parent_id=issue_id))
        return issues

    def filter_issues_excluding_related_issues(self, issue_id: str, issues: QuerySet) -> QuerySet:
        """
        Filter issues excluding related issues
        """

        issue = Issue.issue_objects.filter(pk=issue_id).first()
        related_issue_ids = (
            IssueRelation.objects.filter(Q(related_issue=issue) | Q(issue=issue))
            .values_list("issue_id", "related_issue_id")
            .distinct()
        )

        related_issue_ids = [item for sublist in related_issue_ids for item in sublist]
        related_issue_ids.append(issue_id)

        if issue:
            issues = issues.exclude(pk__in=related_issue_ids)

        return issues

    def filter_root_issues_only(self, issue_id: str, issues: QuerySet) -> QuerySet:
        """
        Filter root issues only
        """
        issue = Issue.issue_objects.filter(pk=issue_id).first()
        if issue:
            issues = issues.filter(~Q(pk=issue_id), parent__isnull=True)
        if issue.parent:
            issues = issues.filter(~Q(pk=issue.parent_id))
        return issues

    def exclude_issues_in_cycles(self, issues: QuerySet) -> QuerySet:
        """
        Exclude issues in cycles
        """
        issues = issues.exclude(Q(issue_cycle__isnull=False) & Q(issue_cycle__deleted_at__isnull=True))
        return issues

    def exclude_issues_in_module(self, issues: QuerySet, module: str) -> QuerySet:
        """
        Exclude issues in a module
        """
        issues = issues.exclude(Q(issue_module__module=module) & Q(issue_module__deleted_at__isnull=True))
        return issues

    def filter_issues_without_target_date(self, issues: QuerySet) -> QuerySet:
        """
        Filter issues without a target date
        """
        issues = issues.filter(target_date__isnull=True)
        return issues

    def get(self, request, slug, project_id):
        filter_data = request.query_params.dict()
        for key in ("project_ids", "state_groups", "assignee_ids", "priorities", "label_ids"):
            if key in filter_data:
                filter_data[key] = [value for value in filter_data[key].split(",") if value]
        serializer = IssueSearchFiltersSerializer(data=filter_data)
        serializer.is_valid(raise_exception=True)
        filters = serializer.validated_data
        query = request.query_params.get("search", False)
        workspace_search = request.query_params.get("workspace_search", "false")
        parent = request.query_params.get("parent", "false")
        issue_relation = request.query_params.get("issue_relation", "false")
        cycle = request.query_params.get("cycle", "false")
        module = request.query_params.get("module", False)
        sub_issue = request.query_params.get("sub_issue", "false")
        target_date = request.query_params.get("target_date", True)
        issue_id = request.query_params.get("issue_id", False)

        issues = Issue.issue_objects.filter(
            workspace__slug=slug,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
        )

        if workspace_search == "false":
            issues = self.filter_issues_by_project(project_id, issues)

        if query:
            issues = self.search_issues_by_query(query, issues)

        if parent == "true" and issue_id:
            issues = self.search_issues_and_excluding_parent(issues, issue_id)

        if issue_relation == "true" and issue_id:
            issues = self.filter_issues_excluding_related_issues(issue_id, issues)

        if sub_issue == "true" and issue_id:
            issues = self.filter_root_issues_only(issue_id, issues)

        if cycle == "true":
            issues = self.exclude_issues_in_cycles(issues)

        if module:
            issues = self.exclude_issues_in_module(issues, module)

        if target_date == "none":
            issues = self.filter_issues_without_target_date(issues)

        if ProjectMember.objects.filter(
            project_id=project_id, member=self.request.user, is_active=True, role=5
        ).exists():
            issues = issues.filter(created_by=self.request.user)

        # Filter before pagination; never derive filter choices from the first page.
        for param, field in (
            ("project_ids", "project_id"),
            ("state_groups", "state__group"),
            ("priorities", "priority"),
        ):
            if filters.get(param):
                issues = issues.filter(**{f"{field}__in": filters[param]})

        assignments = IssueAssignee.objects.filter(deleted_at__isnull=True)
        if filters.get("assignee_ids") or filters["unassigned"]:
            assignee_filter = Q(
                pk__in=assignments.filter(assignee_id__in=filters.get("assignee_ids", [])).values("issue_id")
            )
            if filters["unassigned"]:
                assignee_filter |= ~Q(pk__in=assignments.values("issue_id"))
            issues = issues.filter(assignee_filter)
        if filters.get("label_ids"):
            issues = issues.filter(
                pk__in=IssueLabel.objects.filter(label_id__in=filters["label_ids"], deleted_at__isnull=True).values(
                    "issue_id"
                )
            )

        issues = (
            issues.annotate(
                assignee_ids=ArraySubquery(assignments.filter(issue_id=OuterRef("pk")).values("assignee_id"))
            )
            .order_by("-created_at", "-id")
            .distinct()
        )
        offset = filters["offset"]

        return Response(
            issues.values(
                "name",
                "id",
                "start_date",
                "sequence_id",
                "project__name",
                "project__identifier",
                "project_id",
                "workspace__slug",
                "state__name",
                "state__group",
                "state__color",
                "priority",
                "type_id",
                "assignee_ids",
            )[offset : offset + filters["limit"]],
            status=status.HTTP_200_OK,
        )
