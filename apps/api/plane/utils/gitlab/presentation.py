from plane.db.models import GitLabIntegration, GitLabIssueLink, GitLabObject, GitLabObjectRelation
from .access import capabilities
from .client import GitLabError


def integration_info(integration, user) -> dict:
    connection = integration.user_connections.filter(user=user).first()
    return {
        "id": str(integration.id),
        "name": integration.name,
        "base_url": integration.base_url,
        "enabled": integration.enabled,
        "status": integration.status,
        "error_code": integration.error_code,
        "last_synced_at": integration.last_synced_at,
        "user_connected": bool(connection),
        "username": connection.username if connection else None,
        "oauth_configured": bool(integration.client_id and integration.client_secret_encrypted),
    }


def development_data(issue, user) -> dict:
    integrations = list(GitLabIntegration.objects.filter(workspace=issue.workspace))
    allowed = {}
    access_errors = set()
    for integration in integrations:
        for repository in integration.repositories.filter(enabled=True):
            try:
                allowed[repository.id] = capabilities(repository, user)
            except GitLabError as error:
                access_errors.add(error.code)
    links = list(
        GitLabIssueLink.objects.filter(issue=issue, object__repository_id__in=allowed).select_related("object")
    )
    blocked = {link.object_id for link in links if link.suppressed}
    roots = {link.object_id for link in links if not link.suppressed and link.origins}
    objects = {
        obj.id: obj
        for obj in GitLabObject.objects.filter(repository_id__in=allowed).select_related("repository")
        if obj.kind in allowed[obj.repository_id] and obj.id not in blocked
    }
    edges = [edge for edge in GitLabObjectRelation.objects.filter(parent_id__in=objects, child_id__in=objects)]
    # MR pipelines with a real MR commit belong under that commit. Only synthetic
    # merge-result SHAs (or runs without a readable MR commit) sit directly under MR.
    mr_commits = {
        (edge.parent_id, edge.child_id)
        for edge in edges
        if objects[edge.parent_id].kind == "mr" and objects[edge.child_id].kind == "commit"
    }
    commit_pipelines = {
        (edge.parent_id, edge.child_id)
        for edge in edges
        if objects[edge.parent_id].kind == "commit" and objects[edge.child_id].kind == "pipeline"
    }
    edges = [
        edge
        for edge in edges
        if not (
            objects[edge.parent_id].kind == "mr"
            and objects[edge.child_id].kind == "pipeline"
            and any(
                (edge.parent_id, commit) in mr_commits and (commit, edge.child_id) in commit_pipelines
                for commit in objects
            )
        )
    ]
    selected = roots & objects.keys()
    # A pinned job and a direct pipeline retain their upstream context, even without an MR.
    context = set(selected)
    for _ in range(3):
        context |= {
            edge.parent_id
            for edge in edges
            if edge.child_id in context and objects[edge.parent_id].kind not in ("mr", "branch")
        }
    selected |= context
    for _ in range(4):
        selected |= {edge.child_id for edge in edges if edge.parent_id in selected}
    return {
        "integrations": [integration_info(integration, user) for integration in integrations],
        "access_errors": sorted(access_errors),
        "objects": [
            {
                "id": str(obj.id),
                "kind": obj.kind,
                "external_id": obj.external_id,
                "repository_id": str(obj.repository_id),
                "repository": obj.repository.path,
                "data": obj.data,
                "synced_at": obj.synced_at,
            }
            for obj in sorted((objects[key] for key in selected), key=lambda item: item.created_at, reverse=True)
        ],
        "relations": [
            {"parent": str(edge.parent_id), "child": str(edge.child_id), "created_at": edge.created_at}
            for edge in edges
            if edge.parent_id in selected and edge.child_id in selected
        ],
        "links": [
            {
                "id": str(link.id),
                "object_id": str(link.object_id),
                "origins": link.origins,
                "pinned": link.pinned,
                "created_at": link.created_at,
            }
            for link in links
            if not link.suppressed and link.object_id in selected and link.origins
        ],
    }
