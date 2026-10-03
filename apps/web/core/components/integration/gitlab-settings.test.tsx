// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TGitLabIntegration } from "@plane/types";
import { GitLabSettings } from "./gitlab-settings";

type Configuration = { integrations: TGitLabIntegration[]; can_configure: boolean };
const mocks = vi.hoisted(() => ({
  responses: {} as Record<string, Configuration | undefined>,
  configure: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("swr", () => ({
  default: (key: [string, string]) => ({ data: mocks.responses[key[0]], mutate: mocks.mutate }),
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/ui", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props} /> }));
vi.mock("@/services/integrations/gitlab.service", () => ({
  GitLabIntegrationService: class {
    configure = mocks.configure;
    configurations = vi.fn();
  },
}));

const integration: TGitLabIntegration = {
  id: "integration-a",
  name: "Existing connection",
  base_url: "https://gitlab.example.com",
  enabled: true,
  status: "connected",
  error_code: "",
  last_synced_at: null,
  user_connected: false,
  username: null,
  oauth_configured: true,
  repository_ids: [83],
  client_id: "oauth-application-id",
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("GitLab integration settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.configure.mockReset();
    mocks.mutate.mockReset().mockResolvedValue(undefined);
    mocks.responses = {
      first: { integrations: [integration], can_configure: true },
      second: { integrations: [], can_configure: true },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async (workspace = "first") => {
    await act(async () => root.render(<GitLabSettings workspaceSlug={workspace} />));
  };
  const configureButtons = () =>
    [...container.querySelectorAll("button")].filter((button) => button.textContent === "gitlab_development.configure");
  const open = async (existing = false) => {
    await act(async () => configureButtons()[existing ? 1 : 0].click());
  };
  const fill = (name: string, value: string) => {
    container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
  };
  const submit = async () => {
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };

  it.each([undefined, false])(
    "withholds configuration controls until admin access is confirmed (%s)",
    async (permission) => {
      mocks.responses.first =
        permission === undefined ? undefined : { integrations: [integration], can_configure: permission };
      await render();
      expect(configureButtons()).toHaveLength(0);
      expect(container.querySelector("form")).toBeNull();
      expect(mocks.configure).not.toHaveBeenCalled();
    }
  );

  it("keeps connection metadata readable without offering administrative actions", async () => {
    mocks.responses.first = { integrations: [integration], can_configure: false };
    await render();
    expect(container.textContent).toContain("Existing connection");
    expect(container.textContent).toContain("https://gitlab.example.com");
    expect(configureButtons()).toHaveLength(0);
  });

  it("locks every configure action and accepts only one submission while saving", async () => {
    const response = deferred<TGitLabIntegration & { webhook_secret: string }>();
    mocks.configure.mockReturnValue(response.promise);
    await render();
    await open(true);
    fill("token", "technical-token");
    await submit();
    expect(configureButtons().every((button) => button.disabled)).toBe(true);
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    await submit();
    expect(mocks.configure).toHaveBeenCalledTimes(1);
    expect(mocks.configure).toHaveBeenCalledWith("first", {
      id: "integration-a",
      base_url: "https://gitlab.example.com",
      name: "Existing connection",
      repository_ids: [83],
      token: "technical-token",
      client_id: "oauth-application-id",
      enabled: true,
    });
    await act(async () => response.resolve({ ...integration, webhook_secret: "new-webhook-secret" }));
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector<HTMLInputElement>("#gitlab-hook-secret")!.value).toBe("new-webhook-secret");
    expect(configureButtons().every((button) => !button.disabled)).toBe(true);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("drops entered credentials and the active form when switching workspaces", async () => {
    await render();
    await open(true);
    fill("token", "private-technical-token");
    fill("client_secret", "private-oauth-secret");
    await render("second");
    expect(container.querySelector("form")).toBeNull();
    await open();
    expect(container.querySelector<HTMLInputElement>('input[name="token"]')!.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('input[name="client_secret"]')!.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('input[name="base_url"]')!.value).toBe("");
  });

  it("does not carry a generated webhook secret into another workspace", async () => {
    mocks.configure.mockResolvedValue({ ...integration, webhook_secret: "first-workspace-secret" });
    await render();
    await open(true);
    await submit();
    expect(container.querySelector<HTMLInputElement>("#gitlab-hook-secret")!.value).toBe("first-workspace-secret");
    await render("second");
    expect(container.querySelector("#gitlab-hook-secret")).toBeNull();
  });

  it("ignores a late save result after switching workspace, preserving the new form", async () => {
    const response = deferred<TGitLabIntegration & { webhook_secret: string }>();
    mocks.configure.mockReturnValue(response.promise);
    await render();
    await open(true);
    await submit();
    await render("second");
    await open();
    fill("name", "Second workspace connection");
    await act(async () => response.resolve({ ...integration, webhook_secret: "first-workspace-secret" }));
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("Second workspace connection");
    expect(container.querySelector("#gitlab-hook-secret")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(container.querySelector("fieldset")!.disabled).toBe(false);
  });

  it("does not show a late save error in another workspace", async () => {
    const response = deferred<TGitLabIntegration & { webhook_secret: string }>();
    mocks.configure.mockReturnValue(response.promise);
    await render();
    await open(true);
    await submit();
    await render("second");
    await act(async () => response.reject(new Error("permission denied")));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(configureButtons()[0].disabled).toBe(false);
  });

  it("revokes an open form and suppresses its pending result when admin permission is lost", async () => {
    const response = deferred<TGitLabIntegration & { webhook_secret: string }>();
    mocks.configure.mockReturnValue(response.promise);
    await render();
    await open(true);
    await submit();
    mocks.responses.first = { integrations: [integration], can_configure: false };
    await render();
    expect(container.querySelector("form")).toBeNull();
    await act(async () => response.resolve({ ...integration, webhook_secret: "hidden-secret" }));
    expect(container.querySelector("#gitlab-hook-secret")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    mocks.responses.first = { integrations: [integration], can_configure: true };
    await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("#gitlab-hook-secret")).toBeNull();
    expect(configureButtons()[0].disabled).toBe(false);
  });

  it("does not restore a revoked save result if admin permission returns before it completes", async () => {
    const response = deferred<TGitLabIntegration & { webhook_secret: string }>();
    mocks.configure.mockReturnValue(response.promise);
    await render();
    await open(true);
    await submit();
    mocks.responses.first = { integrations: [integration], can_configure: false };
    await render();
    mocks.responses.first = { integrations: [integration], can_configure: true };
    await render();
    await act(async () => response.resolve({ ...integration, webhook_secret: "revoked-save-secret" }));
    expect(container.querySelector("#gitlab-hook-secret")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(configureButtons()[0].disabled).toBe(false);
  });
});
