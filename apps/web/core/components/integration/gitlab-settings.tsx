import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import type { TGitLabIntegration } from "@plane/types";
import { Input } from "@plane/ui";
import { GitLabIntegrationService } from "@/services/integrations/gitlab.service";

const service = new GitLabIntegrationService();
export function GitLabSettings({ workspaceSlug }: { workspaceSlug: string }) {
  return <GitLabWorkspaceSettings key={workspaceSlug} workspaceSlug={workspaceSlug} />;
}

function GitLabWorkspaceSettings({ workspaceSlug }: { workspaceSlug: string }) {
  const { t } = useTranslation();
  const { data, error, mutate } = useSWR([workspaceSlug, "gitlab-configurations"], () =>
    service.configurations(workspaceSlug)
  );
  const [editing, setEditing] = useState<TGitLabIntegration | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const canConfigure = !error && data?.can_configure === true;
  const canConfigureRef = useRef(canConfigure);
  canConfigureRef.current = canConfigure;
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const requestRef = useRef(0);
  const permissionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!canConfigure) {
      permissionRef.current += 1;
      setEditing(undefined);
      setSecret(undefined);
      setMessage(undefined);
    }
  }, [canConfigure]);
  return (
    <section className="m-6 rounded-lg border border-subtle p-5" aria-label="GitLab">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">GitLab</h2>
          <p className="text-sm mt-1 text-secondary">{t("gitlab_development.settings_description")}</p>
        </div>
        {canConfigure && (
          <button
            className="text-sm rounded-md border border-subtle px-3 py-2"
            type="button"
            disabled={busy}
            onClick={() => {
              if (savingRef.current) return;
              setEditing(null);
              setSecret(undefined);
              setMessage(undefined);
            }}
          >
            {t("gitlab_development.configure")}
          </button>
        )}
      </div>
      {error && <p role="alert">{t("gitlab_development.load_error")}</p>}
      {data?.integrations.map((integration) => (
        <div key={integration.id} className="text-sm my-3 rounded-md bg-layer-1 p-3">
          <div className="flex flex-wrap justify-between gap-3">
            <span>
              {integration.name} · {integration.base_url}
            </span>
            {canConfigure && (
              <button
                className="text-accent-primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (savingRef.current) return;
                  setEditing(integration);
                  setSecret(undefined);
                  setMessage(undefined);
                }}
              >
                {t("gitlab_development.configure")}
              </button>
            )}
          </div>
          <p className="text-xs mt-1 text-secondary">
            {integration.status}
            {integration.error_code ? ` · ${integration.error_code}` : ""} · {integration.repository_ids?.join(", ")}
          </p>
          <p className="text-xs mt-2 break-all text-secondary">Webhook: {integration.webhook_url}</p>
          <p className="text-xs mt-1 break-all text-secondary">OAuth callback: {integration.callback_url}</p>
        </div>
      ))}
      {canConfigure && editing !== undefined && (
        <form
          key={editing?.id || "new"}
          className="mt-4 grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (savingRef.current || !canConfigureRef.current) return;
            const form = event.currentTarget;
            const fields = new FormData(form);
            const repository_ids = String(fields.get("repositories"))
              .split(",")
              .map((id) => Number(id.trim()));
            if (!repository_ids.length || repository_ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
              setMessage(t("gitlab_development.repository_ids_error"));
              return;
            }
            savingRef.current = true;
            const request = ++requestRef.current;
            const isCurrent = () => mountedRef.current && requestRef.current === request;
            const permission = permissionRef.current;
            const canApplyResult = () => isCurrent() && canConfigureRef.current && permissionRef.current === permission;
            setBusy(true);
            setMessage(undefined);
            setSecret(undefined);
            try {
              const result = await service.configure(workspaceSlug, {
                ...(editing ? { id: editing.id } : {}),
                base_url: String(fields.get("base_url")),
                name: String(fields.get("name")),
                repository_ids,
                ...(fields.get("token") ? { token: String(fields.get("token")) } : {}),
                client_id: String(fields.get("client_id")),
                ...(fields.get("client_secret") ? { client_secret: String(fields.get("client_secret")) } : {}),
                enabled: fields.get("enabled") === "on",
              });
              if (!canApplyResult()) return;
              setSecret(result.webhook_secret);
              form.reset();
              setEditing(undefined);
              await mutate();
            } catch {
              if (canApplyResult()) setMessage(t("gitlab_development.configuration_error"));
            } finally {
              if (isCurrent()) {
                savingRef.current = false;
                setBusy(false);
              }
            }
          }}
        >
          <fieldset disabled={busy} className="grid min-w-0 gap-3">
            <label className="text-sm">
              {t("gitlab_development.server_url")}
              <Input
                className="mt-1"
                name="base_url"
                type="url"
                defaultValue={editing?.base_url || ""}
                readOnly={!!editing}
                placeholder="https://gitlab.example.com"
                required
              />
            </label>
            <label className="text-sm">
              {t("gitlab_development.connection_name")}
              <Input className="mt-1" name="name" defaultValue={editing?.name || "GitLab"} required />
            </label>
            <label className="text-sm">
              {t("gitlab_development.repository_ids")}
              <Input
                className="mt-1"
                name="repositories"
                defaultValue={editing?.repository_ids?.join(", ") || ""}
                placeholder="83, 84"
                required
              />
            </label>
            <label className="text-sm">
              {t("gitlab_development.technical_token")}
              <Input className="mt-1" name="token" type="password" autoComplete="new-password" required={!editing} />
            </label>
            <p className="text-xs text-secondary">{t("gitlab_development.token_hint")}</p>
            <label className="text-sm" htmlFor="gitlab-client_id">
              OAuth Application ID
              <Input
                className="mt-1"
                id="gitlab-client_id"
                name="client_id"
                defaultValue={editing?.client_id || ""}
                required
              />
            </label>
            <label className="text-sm" htmlFor="gitlab-client_secret">
              OAuth Application Secret
              <Input
                className="mt-1"
                id="gitlab-client_secret"
                name="client_secret"
                type="password"
                autoComplete="new-password"
                required={!editing}
              />
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} />
              {t("gitlab_development.enabled")}
            </label>
            <div className="flex gap-3">
              <button type="submit" disabled={busy} className="text-sm rounded-md border border-subtle px-3 py-2">
                {t("gitlab_development.save")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(undefined)}
                className="text-sm text-secondary"
              >
                {t("gitlab_development.cancel")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {message && (
        <p role="alert" className="text-sm text-red-600 mt-3">
          {message}
        </p>
      )}
      {canConfigure && secret && (
        <div className="mt-4">
          <label className="text-sm" htmlFor="gitlab-hook-secret">
            Webhook Secret
            <Input id="gitlab-hook-secret" type="password" value={secret} readOnly />
          </label>
          <button
            type="button"
            className="text-sm mt-2 text-accent-primary"
            onClick={() => void navigator.clipboard.writeText(secret)}
          >
            {t("gitlab_development.copy_secret")}
          </button>
        </div>
      )}
    </section>
  );
}
