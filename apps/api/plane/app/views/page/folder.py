# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import math

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, SAFE_METHODS
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Page, PageFolder, Project, ProjectMember, ProjectPage


class PageFolderPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        membership = ProjectMember.objects.filter(
            project_id=view.kwargs["project_id"],
            workspace__slug=view.kwargs["slug"],
            project__archived_at__isnull=True,
            project__page_view=True,
            member=request.user,
            is_active=True,
        ).first()
        if not membership:
            return False
        view.project_role = membership.role
        return request.method in SAFE_METHODS or membership.role in (15, 20)


class FolderSerializer(serializers.ModelSerializer):
    parent = serializers.UUIDField(allow_null=True, required=False)

    class Meta:
        model = PageFolder
        fields = ("id", "project", "name", "parent", "sort_order")
        read_only_fields = ("id", "project")

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("A folder name is required.")
        return value

    def validate_sort_order(self, value):
        if not math.isfinite(value):
            raise serializers.ValidationError("Order must be finite.")
        return value


class MoveSerializer(serializers.Serializer):
    folder_id = serializers.UUIDField(allow_null=True)


def get_folder(project, folder_id):
    if folder_id is None:
        return None
    return get_object_or_404(PageFolder, id=folder_id, project=project, workspace_id=project.workspace_id)


def validate_parent(folder, parent):
    seen = set()
    while parent:
        if parent.id == folder.id or parent.id in seen:
            raise ValidationError({"parent": "A folder cannot be moved into itself or its descendants."})
        seen.add(parent.id)
        parent = parent.parent


class PageFolderEndpoint(BaseAPIView):
    permission_classes = [PageFolderPermission]

    def get(self, request, slug, project_id):
        project = get_object_or_404(Project, id=project_id, workspace__slug=slug)
        locations = ProjectPage.objects.filter(project=project, page__deleted_at__isnull=True).filter(
            Q(page__access=Page.PUBLIC_ACCESS) | Q(page__owned_by=request.user)
        )
        if self.project_role == 5 and not project.guest_view_all_features:
            locations = locations.filter(page__owned_by=request.user)
        return Response(
            {
                "folders": FolderSerializer(PageFolder.objects.filter(project=project), many=True).data,
                "locations": {
                    str(row.page_id): {
                        "folder_id": str(row.folder_id) if row.folder_id else None,
                        "sort_order": row.sort_order,
                    }
                    for row in locations
                },
            }
        )

    @transaction.atomic
    def post(self, request, slug, project_id):
        project = get_object_or_404(Project.objects.select_for_update(), id=project_id, workspace__slug=slug)
        serializer = FolderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        parent = get_folder(project, data.pop("parent", None))
        folder = PageFolder.objects.create(project=project, workspace_id=project.workspace_id, parent=parent, **data)
        return Response(FolderSerializer(folder).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def patch(self, request, slug, project_id, folder_id):
        project = get_object_or_404(Project.objects.select_for_update(), id=project_id, workspace__slug=slug)
        folder = get_folder(project, folder_id)
        serializer = FolderSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        if "parent" in data:
            parent = get_folder(project, data.pop("parent"))
            validate_parent(folder, parent)
            folder.parent = parent
        for key, value in data.items():
            setattr(folder, key, value)
        folder.save()
        return Response(FolderSerializer(folder).data)

    @transaction.atomic
    def delete(self, request, slug, project_id, folder_id):
        project = get_object_or_404(Project.objects.select_for_update(), id=project_id, workspace__slug=slug)
        folder = get_folder(project, folder_id)
        # Detach every relation before soft deletion, including archived/soft-deleted entries.
        PageFolder.all_objects.filter(project=project, parent=folder).update(parent=folder.parent)
        ProjectPage.all_objects.filter(project=project, folder=folder).update(folder=folder.parent)
        PageFolder.objects.filter(id=folder.id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PageFolderMoveEndpoint(BaseAPIView):
    permission_classes = [PageFolderPermission]

    @transaction.atomic
    def post(self, request, slug, project_id, page_id):
        project = get_object_or_404(Project.objects.select_for_update(), id=project_id, workspace__slug=slug)
        location = get_object_or_404(
            ProjectPage.objects.select_related("page"),
            page_id=page_id,
            project=project,
            page__deleted_at__isnull=True,
            page__workspace_id=project.workspace_id,
        )
        page = location.page
        if page.access == Page.PRIVATE_ACCESS and page.owned_by_id != request.user.id:
            raise PermissionDenied("This page is private.")
        if page.is_locked:
            raise ValidationError("This page is locked.")
        serializer = MoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        folder = get_folder(project, serializer.validated_data["folder_id"])
        location.folder = folder
        location.save(update_fields=["folder", "updated_at", "updated_by"])
        return Response({"folder_id": str(folder.id) if folder else None, "sort_order": location.sort_order})
