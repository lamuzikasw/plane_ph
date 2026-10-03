import { useState } from "react";
import type { TGitLabAction, TGitLabDevelopment, TGitLabObject } from "@plane/types";
import { orderBy } from "lodash-es";

export type TGitLabTreeLabels = {
  pinned: string;
  pinOrigin: string;
  history: string;
  moreJobs: string;
  pin: string;
  unpin: string;
  unlink: string;
  manual: string;
  marker: string;
  inherited: string;
  linkedAt: string;
  retried: string;
  success: string;
  failed: string;
  running: string;
  waiting: string;
  allowedFailure: string;
  branches: string;
  branchName: string;
  branchActive: string;
  branchDeleted: string;
  branchProtected: string;
  branchDefault: string;
  author: string;
  committedAt: string;
  fullMessage: string;
  branch: string;
  tag: string;
  startedAt: string;
  stage: string;
  duration: string;
  seconds: string;
};
export const gitLabTreeLabels: TGitLabTreeLabels = {
  pinned: "Pinned jobs",
  pinOrigin: "Pinned",
  history: "History",
  moreJobs: "More jobs",
  pin: "Pin this job",
  unpin: "Unpin",
  unlink: "Unlink",
  manual: "Manual",
  marker: "Marker",
  inherited: "Inherited",
  linkedAt: "Linked",
  retried: "Retried",
  success: "Succeeded",
  failed: "Failed",
  running: "Running",
  waiting: "Waiting",
  allowedFailure: "Allowed to fail",
  branches: "Branches",
  branchName: "Branch name",
  branchActive: "Existing",
  branchDeleted: "Removed",
  branchProtected: "Protected",
  branchDefault: "Default",
  author: "Author",
  committedAt: "Committed",
  fullMessage: "Full commit message",
  branch: "Branch",
  tag: "Tag",
  startedAt: "Started",
  stage: "Stage",
  duration: "Duration",
  seconds: "s",
};

type Props = {
  data: TGitLabDevelopment;
  labels?: TGitLabTreeLabels;
  editable?: boolean;
  busy?: boolean;
  onAction?: (action: TGitLabAction, objectId: string) => void;
};

const sort = (items: TGitLabObject[]) =>
  orderBy(
    items,
    [
      (object) => ({ branch: 0, mr: 1, commit: 2, pipeline: 3, job: 4 })[object.kind],
      (object) => Date.parse(object.data.created_at || object.data.committed_date || object.synced_at) || 0,
      (object) => Number(object.external_id) || 0,
    ],
    ["asc", "desc", "desc"]
  );
const title = (object: TGitLabObject) => {
  if (object.kind === "branch") return object.data.name || "Branch";
  if (object.kind === "mr") return `!${object.external_id} ${object.data.title || "Merge request"}`;
  if (object.kind === "commit")
    return `${object.external_id.slice(0, 8)} ${object.data.message?.split("\n")[0] || "Commit"}`;
  if (object.kind === "pipeline") return `Pipeline #${object.external_id} · ${object.data.source || ""}`;
  return `${object.data.name || "Job"} #${object.external_id}`;
};
const status = (object: TGitLabObject) => object.data.status || object.data.state;
const statusClass = (value?: string | null) =>
  value === "success" || value === "merged"
    ? "text-green-600"
    : value === "failed"
      ? "text-red-600"
      : value === "running"
        ? "text-blue-600"
        : "text-tertiary";
const time = (value?: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return (
    <time dateTime={value} title={value}>
      {new Date(value).toLocaleString()}
    </time>
  );
};

export function GitLabDevelopmentTree({ data, labels = gitLabTreeLabels, editable, busy, onAction }: Props) {
  // A refresh replaces snapshots, but must preserve the user's disclosures.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const objects = new Map(data.objects.map((object) => [object.id, object]));
  const links = new Map(data.links.map((link) => [link.object_id, link]));
  const children = (id: string) =>
    data.relations
      .filter((edge) => edge.parent === id)
      .map((edge) => objects.get(edge.child))
      .filter((object): object is TGitLabObject => !!object);
  const parents = new Set(
    data.relations
      .filter(
        (edge) =>
          objects.has(edge.parent) &&
          objects.get(edge.parent)?.kind !== "branch" &&
          objects.get(edge.child)?.kind !== "branch"
      )
      .map((edge) => edge.child)
  );
  const branches = sort(data.objects.filter((object) => object.kind === "branch"));
  const roots = data.objects.filter((object) => object.kind !== "branch" && !parents.has(object.id));
  const pins = sort(data.objects.filter((object) => object.kind === "job" && links.get(object.id)?.pinned));
  const disclosure = (key: string, summary: React.ReactNode, contents: React.ReactNode, defaultOpen = false) => (
    <details
      open={expanded[key] ?? defaultOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded((previous) => (previous[key] === open ? previous : { ...previous, [key]: open }));
      }}
    >
      <summary className="focus-visible:outline-accent-primary cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        {summary}
      </summary>
      {contents}
    </details>
  );
  const trustedURL = (url?: string | null) =>
    data.integrations.some((integration) => {
      try {
        return !!url && new URL(url).origin === new URL(integration.base_url).origin;
      } catch {
        return false;
      }
    });
  const externalLink = (url: string | null | undefined, text: React.ReactNode) =>
    trustedURL(url) ? (
      <a
        className="focus-visible:outline-accent-primary min-w-0 rounded-sm [overflow-wrap:anywhere] break-words hover:underline focus-visible:outline focus-visible:outline-2"
        href={url!}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {text}
      </a>
    ) : (
      <span className="min-w-0 [overflow-wrap:anywhere] break-words">{text}</span>
    );
  const link = (object: TGitLabObject) => externalLink(object.data.web_url, title(object));
  const metadata = (object: TGitLabObject) => (
    <span className="text-xs flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-tertiary">
      {object.kind === "branch" && (
        <>
          {object.data.sha && (
            <span title={object.data.sha} aria-label={`SHA: ${object.data.sha}`}>
              SHA: {object.data.sha.slice(0, 8)}
            </span>
          )}
          {object.data.protected && <span>{labels.branchProtected}</span>}
          {object.data.default && <span>{labels.branchDefault}</span>}
        </>
      )}
      {object.kind === "mr" && (object.data.source_branch || object.data.target_branch) && (
        <span>
          {labels.branches}: {object.data.source_branch || "—"} → {object.data.target_branch || "—"}
        </span>
      )}
      {(object.kind === "commit" || object.kind === "branch") && (
        <>
          {object.data.author_name && (
            <span>
              {labels.author}: {object.data.author_name}
            </span>
          )}
          {object.data.committed_date && (
            <span>
              {labels.committedAt}: {time(object.data.committed_date)}
            </span>
          )}
        </>
      )}
      {object.kind === "pipeline" && (
        <>
          {object.data.ref && (
            <span>
              {object.data.tag ? labels.tag : labels.branch}: {object.data.ref}
            </span>
          )}
          {object.data.sha && <span className="break-all">SHA: {object.data.sha}</span>}
          {object.data.started_at && (
            <span>
              {labels.startedAt}: {time(object.data.started_at)}
            </span>
          )}
        </>
      )}
      {object.kind === "job" && (
        <>
          {object.data.stage && (
            <span>
              {labels.stage}: {object.data.stage}
            </span>
          )}
          {typeof object.data.duration === "number" && Number.isFinite(object.data.duration) && (
            <span>
              {labels.duration}:{" "}
              {Math.max(0, object.data.duration).toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
              {labels.seconds}
            </span>
          )}
        </>
      )}
    </span>
  );
  const provenance = (object: TGitLabObject, parent?: string) => {
    const direct = links.get(object.id);
    const origins =
      direct?.origins
        .map(
          (origin) =>
            ({ manual: labels.manual, marker: labels.marker, pin: labels.pinOrigin, branch: labels.branchName })[
              origin as "manual" | "marker" | "pin" | "branch"
            ]
        )
        .filter(Boolean) || [];
    const createdAt =
      direct?.created_at ||
      data.relations.find((edge) => edge.parent === parent && edge.child === object.id)?.created_at;
    return (
      <span className="text-xs flex flex-wrap gap-x-3 gap-y-1 text-tertiary">
        <span>{origins.length ? origins.join(" · ") : labels.inherited}</span>
        {createdAt && (
          <span>
            {labels.linkedAt}: {time(createdAt)}
          </span>
        )}
      </span>
    );
  };
  const actions = (object: TGitLabObject) =>
    editable &&
    onAction && (
      <div className="text-xs flex flex-wrap gap-3 text-secondary">
        {object.kind === "job" && (
          <button
            type="button"
            className="focus-visible:outline-accent-primary rounded-sm hover:text-primary focus-visible:outline focus-visible:outline-2"
            disabled={busy}
            aria-label={`${links.get(object.id)?.pinned ? labels.unpin : labels.pin}: ${title(object)}`}
            onClick={() => onAction(links.get(object.id)?.pinned ? "unpin" : "pin", object.id)}
          >
            {links.get(object.id)?.pinned ? labels.unpin : labels.pin}
          </button>
        )}
        <button
          type="button"
          className="focus-visible:outline-accent-primary rounded-sm hover:text-primary focus-visible:outline focus-visible:outline-2"
          disabled={busy}
          aria-label={`${labels.unlink}: ${title(object)}`}
          onClick={() => onAction("unlink", object.id)}
        >
          {labels.unlink}
        </button>
      </div>
    );
  const jobsSummary = (items: TGitLabObject[]) => {
    const jobs = items.filter((item) => item.kind === "job" && !item.data.retried);
    if (!jobs.length) return null;
    const count = (values: string[]) => jobs.filter((job) => values.includes(job.data.status || "")).length;
    return (
      <span className="text-xs flex flex-wrap gap-3 text-secondary">
        <span className="text-green-600">
          {labels.success}: {count(["success"])}
        </span>
        <span className="text-red-600">
          {labels.failed}: {count(["failed"])}
        </span>
        <span>
          {labels.running}: {count(["running"])}
        </span>
        <span>
          {labels.waiting}: {count(["created", "pending", "preparing", "waiting_for_resource", "manual", "scheduled"])}
        </span>
      </span>
    );
  };
  const render = (object: TGitLabObject, ancestors: string[] = [], root = false): React.ReactNode => {
    if (ancestors.includes(object.id) || ancestors.length > 4) return null;
    const nested = object.kind === "branch" ? [] : sort(children(object.id).filter((child) => child.kind !== "branch"));
    const key = [...ancestors, object.id].join("/");
    const row = (
      <span className="inline-flex max-w-full flex-col gap-1 align-top">
        <span className="text-sm flex min-w-0 flex-wrap items-center gap-2">
          {link(object)}
          <span className={`text-xs ${statusClass(status(object))}`}>
            {object.kind === "branch"
              ? object.data.state === "deleted"
                ? labels.branchDeleted
                : labels.branchActive
              : status(object)}
          </span>
          {object.data.retried && <span className="text-xs text-tertiary">{labels.retried}</span>}
          {object.data.allow_failure && <span className="text-xs text-tertiary">{labels.allowedFailure}</span>}
        </span>
        {metadata(object)}
        {provenance(object, ancestors.at(-1))}
      </span>
    );
    const fullMessage =
      object.kind === "commit" && object.data.message
        ? disclosure(
            `message:${key}`,
            <span className="text-xs text-secondary">{labels.fullMessage}</span>,
            <p className="text-xs mt-1 break-words whitespace-pre-wrap text-secondary">{object.data.message}</p>
          )
        : null;
    return (
      <div key={object.id} className={`min-w-0 py-2 ${root ? "border-b border-subtle last:border-0" : ""}`}>
        {root && <p className="text-xs mb-1 break-words text-tertiary">{object.repository}</p>}
        {nested.length ? (
          disclosure(
            `object:${key}`,
            <span className="inline-flex max-w-full flex-col gap-1 align-top">
              {row}
              {object.kind === "pipeline" && jobsSummary(nested)}
            </span>,
            <div className="mt-2 flex flex-col gap-1 pl-4">
              {fullMessage}
              {actions(object)}
              {renderList(nested, [...ancestors, object.id])}
            </div>,
            object.kind !== "pipeline"
          )
        ) : (
          <div className="flex flex-col gap-1">
            {row}
            {fullMessage}
            {actions(object)}
          </div>
        )}
      </div>
    );
  };
  const renderList = (items: TGitLabObject[], ancestors: string[], root = false): React.ReactNode => (
    <>
      {(["branch", "mr", "commit", "pipeline", "job"] as const).map((kind) => {
        const group = items.filter((object) => object.kind === kind);
        const current = group.filter(
          (object) => !object.data.retried && !(kind === "branch" && object.data.state === "deleted")
        );
        const visible = current.slice(0, kind === "job" ? 10 : 3);
        const overflow = current.slice(visible.length);
        const retried = group.filter((object) => object.data.retried);
        const history =
          kind === "job"
            ? retried
            : kind === "branch"
              ? [...overflow, ...group.filter((object) => object.data.state === "deleted")]
              : overflow;
        const key = `${ancestors.join("/") || "roots"}:${kind}`;
        return (
          <div key={kind}>
            {visible.map((object) => render(object, ancestors, root))}
            {kind === "job" &&
              !!overflow.length &&
              disclosure(
                `more:${key}`,
                <span className="text-xs inline-block py-2 text-secondary">
                  {labels.moreJobs} ({overflow.length})
                </span>,
                overflow.map((object) => render(object, ancestors, root))
              )}
            {!!history.length &&
              disclosure(
                `history:${key}`,
                <span className="text-xs inline-block py-2 text-secondary">
                  {labels.history} ({history.length})
                </span>,
                history.map((object) => render(object, ancestors, root))
              )}
          </div>
        );
      })}
    </>
  );
  const pinContext = (object: TGitLabObject) => {
    const pipeline = data.objects.find(
      (item) =>
        item.repository_id === object.repository_id &&
        item.kind === "pipeline" &&
        item.external_id === String(object.data.pipeline_id)
    );
    const commit = data.objects.find(
      (item) =>
        item.repository_id === object.repository_id && item.kind === "commit" && item.external_id === object.data.sha
    );
    const repositoryURL =
      pipeline?.data.web_url?.split("/-/pipelines/")[0] || object.data.web_url?.split("/-/jobs/")[0];
    return (
      <span className="text-xs flex flex-wrap gap-x-3 gap-y-1 text-tertiary">
        <span>{object.repository}</span>
        {object.data.sha &&
          externalLink(
            commit?.data.web_url || (repositoryURL ? `${repositoryURL}/-/commit/${object.data.sha}` : undefined),
            object.data.sha.slice(0, 8)
          )}
        {object.data.pipeline_id &&
          externalLink(
            pipeline?.data.web_url ||
              (repositoryURL ? `${repositoryURL}/-/pipelines/${object.data.pipeline_id}` : undefined),
            `Pipeline #${object.data.pipeline_id}`
          )}
      </span>
    );
  };
  return (
    <div className="min-w-0">
      {!!pins.length && (
        <div className="mb-3 rounded-md border border-subtle p-3">
          <p className="text-xs mb-2 font-medium text-secondary">{labels.pinned}</p>
          {pins.map((object) => (
            <div key={object.id} className="text-sm mb-2 flex flex-col gap-1">
              {link(object)}
              <span className={`text-xs ${statusClass(status(object))}`}>{status(object)}</span>
              {metadata(object)}
              {pinContext(object)}
              {provenance(object)}
              {actions(object)}
            </div>
          ))}
        </div>
      )}
      {!!branches.length && (
        <section className="mb-3 min-w-0 rounded-md border border-subtle p-3" aria-label={labels.branches}>
          <h4 className="text-xs mb-1 font-medium text-secondary">{labels.branches}</h4>
          {renderList(branches, [], true)}
        </section>
      )}
      {renderList(sort(roots), [], true)}
    </div>
  );
}
