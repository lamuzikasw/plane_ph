"""Canonical API snapshots and durable, idempotent issue associations."""

import hashlib
import re
from datetime import timedelta
from urllib.parse import quote

import requests
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from plane.db.models import (
    GitLabDiagnostic,
    GitLabIntegration,
    GitLabIssueLink,
    GitLabObject,
    GitLabObjectRelation,
    GitLabRepository,
    Issue,
)
from plane.license.utils.encryption import decrypt_data
from .client import GitLabClient, GitLabError

MARKER = re.compile(r"(?<![\w:])plane:([A-Za-z0-9][A-Za-z0-9_]{0,11})-([1-9]\d*)(?![\w-])")
BRANCH_KEY = re.compile(r"(?<![\w:])([A-Za-z0-9][A-Za-z0-9_]{0,11})-([1-9]\d*)(?!\w|-\d)")


def markers(text: str) -> set[tuple[str, int]]:
    return {(project.upper(), int(number)) for project, number in MARKER.findall(text or "")}


def branch_keys(name: str) -> set[tuple[str, int]]:
    text = name or ""
    keys = set()
    for match in BRANCH_KEY.finditer(text):
        project, number = match.groups()
        # After rejecting DEV-123-4 or DEV-01-2, do not restart inside the
        # malformed key and reinterpret its numbers as another project key.
        # Numeric project identifiers still work at a slash/start boundary.
        if project[0].isdigit() and match.start() and text[match.start() - 1] == "-":
            continue
        keys.add((project.upper(), int(number)))
    return keys


def branch_id(name: str) -> str:
    return hashlib.sha256(name.encode("utf-8")).hexdigest()


def associate(issue, obj, origin: str, *, restore: bool = False, pinned: bool = False):
    with transaction.atomic():
        link, _ = GitLabIssueLink.objects.get_or_create(issue=issue, object=obj)
        link = GitLabIssueLink.objects.select_for_update().get(pk=link.pk)
        link.origins = sorted(set(link.origins) | {origin})
        if restore:
            link.suppressed = False
        if pinned:
            link.pinned = True
        link.save()
        return link


def key_links(repository, obj, keys: set[tuple[str, int]], origin: str):
    for project, number in keys:
        issue = Issue.objects.filter(
            workspace_id=repository.integration.workspace_id,
            project__identifier=project,
            project__deleted_at__isnull=True,
            sequence_id=number,
        ).first()
        if issue:
            associate(issue, obj, origin)
        else:
            GitLabDiagnostic.objects.get_or_create(
                repository=repository,
                marker=f"{project}-{number}",
                external_id=obj.external_id,
                kind=obj.kind,
            )


def marker_links(repository, obj, text: str):
    key_links(repository, obj, markers(text), "marker")


def branch_links(repository, obj, name: str):
    key_links(repository, obj, branch_keys(name), "branch")


def snapshot(kind: str, raw: dict) -> dict:
    """Do not cache CI variables, runner credentials, logs or artifact contents."""
    fields = {
        "mr": ["iid", "title", "state", "source_branch", "target_branch", "web_url", "created_at", "updated_at"],
        "commit": ["id", "short_id", "message", "author_name", "committed_date", "web_url"],
        "branch": ["name", "state", "web_url", "protected", "default"],
        "pipeline": [
            "id",
            "iid",
            "status",
            "source",
            "ref",
            "tag",
            "sha",
            "created_at",
            "started_at",
            "updated_at",
            "web_url",
        ],
        "job": [
            "id",
            "name",
            "stage",
            "status",
            "duration",
            "created_at",
            "started_at",
            "finished_at",
            "web_url",
            "allow_failure",
            "retried",
        ],
    }[kind]
    data = {key: raw.get(key) for key in fields}
    if kind == "branch":
        commit = raw.get("commit") or {}
        data.update(
            state=raw.get("state", "active"),
            sha=commit.get("id"),
            author_name=commit.get("author_name"),
            committed_date=commit.get("committed_date"),
        )
    if kind == "job":
        data["pipeline_id"] = raw.get("pipeline", {}).get("id")
        data["sha"] = raw.get("commit", {}).get("id")
        data["artifacts"] = [
            {key: artifact.get(key) for key in ("filename", "file_type", "size")}
            for artifact in raw.get("artifacts", [])
            if artifact.get("file_type") != "trace"
        ]
    return data


class RepositorySync:
    """Call inside a repository row lock: delayed events always refetch current API data."""

    def __init__(self, repository):
        self.repository = repository
        self.client = GitLabClient(
            repository.integration.base_url, decrypt_data(repository.integration.token_encrypted)
        )
        self.prefix = f"projects/{repository.gitlab_id}"
        self.seen_pipelines = {}
        self.seen_commits = {}
        self.seen_sha_pipeline_lists = {}
        self.session = None

    def __enter__(self):
        # Reuse HTTPS connections only within one serialized repository sync.
        # Personal permission probes keep their independent stateless transport.
        self.session = requests.Session()
        self.client.session = self.session
        return self

    def close(self):
        if self.session is not None:
            self.session.close()
            self.session = None
            self.client.session = None

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def pipelines_for_sha(self, sha):
        if sha not in self.seen_sha_pipeline_lists:
            # GitLab excludes child pipelines from the default project pipeline list.
            runs = self.client.all(f"{self.prefix}/pipelines", {"sha": sha})
            runs += self.client.all(f"{self.prefix}/pipelines", {"sha": sha, "source": "parent_pipeline"})
            self.seen_sha_pipeline_lists[sha] = list({run["id"]: run for run in runs}.values())
        return self.seen_sha_pipeline_lists[sha]

    def save(self, kind: str, raw: dict):
        key = branch_id(raw["name"]) if kind == "branch" else str(raw["iid"] if kind == "mr" else raw["id"])
        data = snapshot(kind, raw)
        source_timestamp = raw.get("updated_at")
        if kind == "job":
            source_timestamp = (
                source_timestamp or raw.get("finished_at") or raw.get("started_at") or raw.get("created_at")
            )
        source_time = parse_datetime(source_timestamp or "")
        obj, created = GitLabObject.objects.get_or_create(
            repository=self.repository,
            kind=kind,
            external_id=key,
            defaults={"data": data, "source_updated_at": source_time},
        )
        if not created:
            if source_time and obj.source_updated_at and source_time < obj.source_updated_at:
                return obj
            obj.data = data
            obj.source_updated_at = source_time
            obj.save()
        return obj

    def edge(self, parent, child):
        if parent and child:
            GitLabObjectRelation.objects.get_or_create(parent=parent, child=child)

    def save_branch(self, raw: dict):
        name = raw.get("name")
        commit = raw.get("commit") or {}
        if (
            not isinstance(name, str)
            or not name
            or not isinstance(commit, dict)
            or not isinstance(commit.get("id"), str)
            or not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", commit["id"])
        ):
            raise GitLabError("invalid_response")
        raw = {
            **raw,
            "state": "active",
            "protected": bool(raw.get("protected", False)),
            "default": bool(raw.get("default", False)),
            "web_url": raw.get("web_url") or f"{self.repository.web_url}/-/tree/{quote(name, safe='')}",
        }
        obj = self.save("branch", raw)
        branch_links(self.repository, obj, name)
        return obj

    def branch(self, name: str):
        raw = self.client.one(f"{self.prefix}/repository/branches/{quote(name, safe='')}")
        if raw.get("name") != name:
            raise GitLabError("invalid_response")
        return self.save_branch(raw)

    def sync_branches(self, branches: list[dict]):
        current = {branch_id(raw["name"]): raw for raw in branches}
        known = {obj.external_id: obj for obj in GitLabObject.objects.filter(repository=self.repository, kind="branch")}
        for key, raw in current.items():
            if key in known or branch_keys(raw["name"]):
                self.save_branch(raw)
        # Only a complete, validated list may establish that a branch is gone.
        # Snapshots, links and tombstones remain available as historical data.
        for key, obj in known.items():
            if key not in current and obj.data.get("state") != "deleted":
                obj.data = {**obj.data, "state": "deleted"}
                obj.save()

    def commit(self, sha: str, *, pipelines: bool = True):
        obj = self.seen_commits.get(sha)
        if obj is None:
            raw = self.client.one(f"{self.prefix}/repository/commits/{sha}")
            obj = self.save("commit", raw)
            self.seen_commits[sha] = obj
            marker_links(self.repository, obj, raw.get("message", ""))
        if pipelines:
            for pipeline in self.pipelines_for_sha(obj.external_id):
                self.pipeline(pipeline["id"], commit=obj)
        return obj

    def pipeline(self, key, *, commit=None):
        if str(key) in self.seen_pipelines:
            obj = self.seen_pipelines[str(key)]
            self.edge(commit, obj)
            return obj
        raw = self.client.one(f"{self.prefix}/pipelines/{key}")
        obj = self.save("pipeline", raw)
        self.seen_pipelines[str(key)] = obj
        if commit is None and raw.get("sha"):
            try:
                commit = self.commit(raw["sha"], pipelines=False)
            except GitLabError as error:
                # Temporary merged-result SHAs may not be readable as repository commits.
                if error.code != "not_found":
                    raise
        self.edge(commit, obj)
        current = self.client.all(f"{self.prefix}/pipelines/{key}/jobs")
        current_ids = {job["id"] for job in current}
        for job in self.client.all(f"{self.prefix}/pipelines/{key}/jobs", {"include_retried": "true"}):
            job["retried"] = job["id"] not in current_ids
            self.edge(obj, self.save("job", job))
        return obj

    def job(self, key):
        raw = self.client.one(f"{self.prefix}/jobs/{key}")
        pipeline = self.pipeline(raw["pipeline"]["id"])
        obj = GitLabObject.objects.get(repository=self.repository, kind="job", external_id=str(key))
        self.edge(pipeline, obj)
        return obj

    def mr(self, iid, *, force: bool = False):
        raw = self.client.one(f"{self.prefix}/merge_requests/{iid}")
        text = f"{raw.get('title', '')}\n{raw.get('description', '')}"
        source_branch = raw.get("source_branch", "")
        local_source = raw.get("source_project_id") == self.repository.gitlab_id
        known = GitLabObject.objects.filter(repository=self.repository, kind="mr", external_id=str(iid)).exists()
        if not force and not known and not markers(text) and not (local_source and branch_keys(source_branch)):
            return None
        obj = self.save("mr", raw)
        # Read the description only for markers, not for UI metadata.
        marker_links(self.repository, obj, text)
        if local_source:
            branch_links(self.repository, obj, source_branch)
        for raw_commit in self.client.all(f"{self.prefix}/merge_requests/{iid}/commits"):
            commit = self.commit(raw_commit["id"])
            self.edge(obj, commit)
        for pipeline in self.client.all(f"{self.prefix}/merge_requests/{iid}/pipelines"):
            # Fork MRs can list runs owned by the source project. A pipeline ID
            # must be fetched from its own project, never the target prefix.
            # Cross-project inheritance needs separate synchronization and ACLs;
            # leave those runs to explicitly configured source repositories.
            if pipeline.get("project_id", self.repository.gitlab_id) != self.repository.gitlab_id:
                continue
            self.edge(obj, self.pipeline(pipeline["id"]))
        return obj

    def object(self, kind: str, key: str):
        if kind == "mr":
            return self.mr(key, force=True)
        if kind == "branch":
            return self.branch(key)
        return getattr(self, kind)(key)

    def pushed_commits(self, event: dict):
        after = event.get("after")
        if not after or not after.strip("0"):
            # An all-zero after revision is a deleted ref, not a commit ID.
            return
        before = event.get("before")
        baseline = before if before and before.strip("0") else None
        revision = f"{baseline}..{after}" if baseline else after
        try:
            commits = self.client.all(f"{self.prefix}/repository/commits", {"ref_name": revision, "order": "topo"})
        except GitLabError as error:
            if error.code != "not_found" or not baseline:
                raise
            commits = self.client.all(f"{self.prefix}/repository/commits", {"ref_name": after, "order": "topo"})
        for raw in commits:
            if markers(raw.get("message", "")):
                self.commit(raw["id"])

    def discover_commits(self):
        # A commit's date is chosen by its author; it is not its push time. A date
        # cursor alone misses newly pushed commits whose dates precede the cursor.
        # Persist complete branch/tag frontiers and request Git revision ranges:
        # OLD..NEW includes every newly reachable merge parent, without a date
        # filter or an unsafe early stop at the first previously visited commit.
        heads = dict(self.repository.discovery_heads)
        current = {}
        branches = []
        for category in ("branches", "tags"):
            for ref in self.client.all(f"{self.prefix}/repository/{category}"):
                if not isinstance(ref, dict):
                    raise GitLabError("invalid_response")
                name = ref.get("name")
                commit = ref.get("commit") or {}
                if not isinstance(commit, dict):
                    raise GitLabError("invalid_response")
                tip = commit.get("id")
                if (
                    not isinstance(name, str)
                    or not isinstance(tip, str)
                    or not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", tip)
                ):
                    raise GitLabError("invalid_response")
                current[f"{category}:{name}"] = tip
                if category == "branches":
                    branches.append(ref)
        for ref, tip in current.items():
            if tip in heads.values():
                heads[ref] = tip
                continue
            baseline = heads.get(ref) or next(iter(heads.values()), None)
            revision = f"{baseline}..{tip}" if baseline else tip
            try:
                commits = self.client.all(f"{self.prefix}/repository/commits", {"ref_name": revision, "order": "topo"})
            except GitLabError as error:
                if error.code != "not_found" or not baseline:
                    raise
                # GitLab may have garbage-collected the previous tip after a
                # force push. Only this changed ref needs a full history walk.
                commits = self.client.all(f"{self.prefix}/repository/commits", {"ref_name": tip, "order": "topo"})
            for raw in commits:
                if markers(raw.get("message", "")):
                    self.commit(raw["id"])
            # No checkpoint advances on pagination limits or partial failures:
            # sync_repository commits this map only with the complete snapshot.
            heads[ref] = tip
        self.sync_branches(branches)
        self.repository.discovery_heads = heads

    def reconcile(self):
        start = self.repository.last_reconciled_at
        since = (start - timedelta(minutes=5)).isoformat() if start else None
        self.discover_commits()
        known_mrs = set(
            GitLabObject.objects.filter(repository=self.repository, kind="mr").values_list("external_id", flat=True)
        )
        for raw in self.client.all(
            f"{self.prefix}/merge_requests", {"state": "all", **({"updated_after": since} if since else {})}
        ):
            known_mrs.add(str(raw["iid"]))
        # Source-branch keys may now match newly created issues, or this feature
        # may have been enabled after an otherwise unchanged MR was created.
        for branch in GitLabObject.objects.filter(repository=self.repository, kind="branch"):
            name = branch.data.get("name", "")
            if branch.data.get("state") != "active" or not branch_keys(name):
                continue
            for raw in self.client.all(f"{self.prefix}/merge_requests", {"state": "all", "source_branch": name}):
                known_mrs.add(str(raw["iid"]))
        for iid in sorted(known_mrs):
            try:
                self.mr(iid)
            except GitLabError as error:
                if error.code != "not_found":
                    raise
        # A new run can target an old directly-linked SHA, without a new push/MR event.
        for commit in GitLabObject.objects.filter(repository=self.repository, kind="commit"):
            # A previously unknown issue may now exist even though its commit
            # and branch tip have not changed. Re-evaluate cached markers too.
            marker_links(self.repository, commit, commit.data.get("message", ""))
            for pipeline in self.pipelines_for_sha(commit.external_id):
                self.pipeline(pipeline["id"])
        for key in list(
            GitLabObject.objects.filter(repository=self.repository, kind="pipeline").values_list(
                "external_id", flat=True
            )
        ):
            try:
                self.pipeline(key)
            except GitLabError as error:
                if error.code != "not_found":
                    raise


def record_error(integration_id, error):
    GitLabIntegration.objects.filter(pk=integration_id).update(status="error", error_code=error.code)


def sync_repository(repository_id, *, event: dict | None = None, event_type: str = ""):
    repository = GitLabRepository.objects.select_related("integration").get(pk=repository_id)
    if not repository.enabled or not repository.integration.enabled:
        return
    try:
        with transaction.atomic():
            repository = (
                GitLabRepository.objects.select_for_update().select_related("integration").get(pk=repository_id)
            )
            # Configuration may have been paused while this worker waited for
            # the row lock. The pre-lock snapshot is no longer authoritative.
            if not repository.enabled or not repository.integration.enabled:
                return
            started_at = timezone.now()
            sync = RepositorySync(repository)
            with sync:
                if event is None:
                    sync.reconcile()
                elif event_type == "Merge Request Hook":
                    sync.mr(event["object_attributes"]["iid"])
                elif event_type == "Pipeline Hook":
                    sync.pipeline(event["object_attributes"]["id"])
                    mr = event.get("merge_request") or {}
                    if mr.get("iid"):
                        sync.mr(mr["iid"])
                elif event_type == "Job Hook":
                    sync.job(event["build_id"])
                else:
                    if event_type in ("Push Hook", "Tag Push Hook"):
                        sync.pushed_commits(event)
                    # Reconciliation recovers pushes with >20 commits and events missed entirely.
                    sync.reconcile()
            repository.last_synced_at = timezone.now()
            repository.error_code = ""
            if event is None or event_type in ("Push Hook", "Tag Push Hook"):
                repository.last_reconciled_at = started_at
            repository.save(
                update_fields=["last_synced_at", "last_reconciled_at", "discovery_heads", "error_code", "updated_at"]
            )
            error_code = (
                GitLabRepository.objects.filter(integration_id=repository.integration_id, enabled=True)
                .exclude(error_code="")
                .values_list("error_code", flat=True)
                .first()
            )
            GitLabIntegration.objects.filter(pk=repository.integration_id).update(
                status="error" if error_code else "connected",
                error_code=error_code or "",
                last_synced_at=timezone.now(),
            )
    except GitLabError as error:
        GitLabRepository.objects.filter(pk=repository.id).update(error_code=error.code)
        record_error(repository.integration_id, error)
        raise
