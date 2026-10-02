import hashlib
import json

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import BoardLink, Cycle, Project, ProjectMember, WorkspaceMember


class BoardLinkInput(serializers.Serializer):
    cycle_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    filters = serializers.JSONField()
    display = serializers.JSONField()

    def validate(self, data):
        for field, limit in (("filters", 32768), ("display", 8192)):
            value = data[field]
            try:
                encoded = json.dumps(value, allow_nan=False)
            except (ValueError, TypeError, RecursionError):
                raise serializers.ValidationError({field: "Invalid JSON object."})
            if not isinstance(value, dict) or len(encoded) > limit:
                raise serializers.ValidationError({field: "Expected a bounded JSON object."})
        if set(data["display"]) != {"displayFilters", "displayProperties"} or not all(
            isinstance(value, dict) for value in data["display"].values()
        ):
            raise serializers.ValidationError({"display": "Expected displayFilters and displayProperties objects."})
        return data


def accessible_project(user, **lookup):
    # Check active membership on every resolution; knowing a token is not authorization.
    project = get_object_or_404(Project, **lookup)
    if not WorkspaceMember.objects.filter(workspace_id=project.workspace_id, member=user, is_active=True).exists():
        return None
    if not ProjectMember.objects.filter(project=project, member=user, is_active=True).exists():
        return None
    return project


def link_data(link):
    path = f"/{link.project.workspace.slug}/projects/{link.project_id}/"
    path += f"cycles/{link.cycle_id}/" if link.cycle_id else "issues/"
    return {"token": link.token, "path": path, "filters": link.filters, "display": link.display}


class BoardLinkCreateEndpoint(BaseAPIView):
    def post(self, request, slug, project_id):
        project = accessible_project(request.user, pk=project_id, workspace__slug=slug)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = BoardLinkInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["cycle_id"]:
            get_object_or_404(Cycle, id=data["cycle_id"], project=project)
        canonical = json.dumps(
            {
                "project": str(project.id),
                "cycle": str(data["cycle_id"]),
                "filters": data["filters"],
                "display": data["display"],
            },
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        link, created = BoardLink.objects.get_or_create(
            fingerprint=fingerprint,
            defaults={
                "project": project,
                "cycle_id": data["cycle_id"],
                "filters": data["filters"],
                "display": data["display"],
                "created_by": request.user,
            },
        )
        return Response(link_data(link), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class BoardLinkDetailEndpoint(BaseAPIView):
    def get(self, request, token):
        link = get_object_or_404(BoardLink.objects.select_related("project__workspace"), token=token)
        project = accessible_project(request.user, pk=link.project_id)
        if project is None or (link.cycle_id and not Cycle.objects.filter(id=link.cycle_id, project=project).exists()):
            return Response(status=status.HTTP_404_NOT_FOUND)
        response = Response(link_data(link))
        response["Cache-Control"] = "private, no-store"
        return response
