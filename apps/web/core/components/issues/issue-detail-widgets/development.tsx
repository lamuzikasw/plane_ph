import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { GitBranch, RefreshCw } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { GitLabDevelopmentStore } from "@plane/shared-state";
import { GitLabDevelopmentTree, Input } from "@plane/ui";
import { useUser } from "@/hooks/store/user";
import { GitLabIntegrationService } from "@/services/integrations/gitlab.service";

const service = new GitLabIntegrationService();
type Props = { workspaceSlug: string; projectId: string; issueId: string; disabled: boolean };

export const IssueDevelopmentSection = observer(function IssueDevelopmentSection(props: Props) {
  const { data: user } = useUser();
  return (
    <DevelopmentContent
      key={`${props.workspaceSlug}:${props.projectId}:${props.issueId}:${user?.id || "anonymous"}`}
      {...props}
      userId={user?.id}
    />
  );
});

const DevelopmentContent = observer(function DevelopmentContent({
  workspaceSlug,
  projectId,
  issueId,
  disabled,
  userId,
}: Props & { userId?: string }) {
  const { t } = useTranslation();
  const store = useMemo(
    () => new GitLabDevelopmentStore(service, workspaceSlug, projectId, issueId, userId),
    [workspaceSlug, projectId, issueId, userId]
  );
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const refresh = () => {
      if (document.visibilityState === "visible") void store.load();
    };
    void store.load();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      store.dispose();
    };
  }, [store]);
  const connect = async (id: string) => {
    setConnecting(true);
    try {
      const destination = await service.connect(workspaceSlug, id, window.location.pathname);
      if (active.current) window.location.assign(destination);
    } catch {
      if (!active.current) return;
      setConnecting(false);
      store.connectionFailed();
    }
  };
  const labels = {
    pinned: t("gitlab_development.pinned"),
    history: t("gitlab_development.history"),
    pin: t("gitlab_development.pin"),
    unpin: t("gitlab_development.unpin"),
    unlink: t("gitlab_development.unlink"),
    manual: t("gitlab_development.manual"),
    marker: t("gitlab_development.marker"),
    inherited: t("gitlab_development.inherited"),
    retried: t("gitlab_development.retried"),
    success: t("gitlab_development.success"),
    failed: t("gitlab_development.failed"),
    running: t("gitlab_development.running"),
    waiting: t("gitlab_development.waiting"),
    allowedFailure: t("gitlab_development.allowed_failure"),
    pinOrigin: t("gitlab_development.pin_origin"),
    moreJobs: t("gitlab_development.more_jobs"),
    linkedAt: t("gitlab_development.linked_at"),
    branches: t("gitlab_development.branches"),
    branchName: t("gitlab_development.branch_name"),
    branchActive: t("gitlab_development.branch_active"),
    branchDeleted: t("gitlab_development.branch_deleted"),
    branchProtected: t("gitlab_development.branch_protected"),
    branchDefault: t("gitlab_development.branch_default"),
    author: t("gitlab_development.author"),
    committedAt: t("gitlab_development.committed_at"),
    fullMessage: t("gitlab_development.full_message"),
    branch: t("gitlab_development.branch"),
    tag: t("gitlab_development.tag"),
    startedAt: t("gitlab_development.started_at"),
    stage: t("gitlab_development.stage"),
    duration: t("gitlab_development.duration"),
    seconds: t("gitlab_development.seconds"),
  };
  return (
    <section className="border-b border-subtle py-4" aria-label={t("gitlab_development.title")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base flex items-center gap-2 font-medium">
          <GitBranch size={16} />
          {t("gitlab_development.title")}
        </h3>
        <button
          type="button"
          className="text-secondary hover:text-primary"
          aria-label={t("gitlab_development.refresh")}
          disabled={store.loading || store.saving}
          onClick={() => void store.load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {store.error && (
        <p role="alert" className="text-sm text-red-600 mb-3">
          {t(store.error === "mutation" ? "gitlab_development.action_error" : "gitlab_development.load_error")}
        </p>
      )}
      {!store.data && store.loading && <p className="text-sm text-secondary">{t("gitlab_development.loading")}</p>}
      {store.data && (
        <>
          {!store.data.integrations.length && (
            <p className="text-sm text-secondary">{t("gitlab_development.no_integration")}</p>
          )}
          {store.data.integrations.map((integration) => (
            <div key={integration.id} className="text-xs mb-3 flex flex-col gap-1 text-secondary">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {integration.name}
                  {integration.username ? ` · @${integration.username}` : ""}
                </span>
                {integration.oauth_configured && (
                  <button
                    type="button"
                    className="text-accent-primary hover:underline"
                    disabled={connecting}
                    onClick={() => void connect(integration.id)}
                  >
                    {t(integration.user_connected ? "gitlab_development.reconnect" : "gitlab_development.connect")}
                  </button>
                )}
              </div>
              {integration.status === "error" && (
                <p role="status" className="text-amber-600">
                  {t("gitlab_development.sync_error")} ({integration.error_code})
                </p>
              )}
              {integration.last_synced_at && (
                <span>
                  {t("gitlab_development.updated")}: {new Date(integration.last_synced_at).toLocaleString()}
                </span>
              )}
            </div>
          ))}
          {!!store.data.access_errors.length && (
            <p className="text-sm mb-3 text-secondary">{t("gitlab_development.access_required")}</p>
          )}
          {!!store.data.integrations.length && !store.data.access_errors.length && !store.data.objects.length && (
            <p className="text-sm mb-3 text-secondary">{t("gitlab_development.empty")}</p>
          )}
          <GitLabDevelopmentTree
            data={store.data}
            labels={labels}
            editable={!disabled}
            busy={store.saving}
            onAction={(action, object_id) => void store.mutate({ action, object_id })}
          />
          {!disabled && !!store.data.integrations.length && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if ((await store.mutate({ action: "add", url })) && active.current) setUrl("");
              }}
            >
              <Input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("gitlab_development.url_placeholder")}
                aria-label={t("gitlab_development.url_placeholder")}
                className="min-w-0 flex-1"
                required
              />
              <button
                type="submit"
                className="text-sm rounded-md border border-subtle px-3 py-2 hover:bg-layer-1"
                disabled={store.saving || !url}
              >
                {t("gitlab_development.add")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
});
