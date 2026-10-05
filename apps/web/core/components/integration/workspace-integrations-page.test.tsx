// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceIntegrationsPage from "../../../app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/integrations/page";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  swrKeys: [] as unknown[],
  configure: vi.fn(),
  legacyCatalog: vi.fn(),
}));

vi.mock("swr", () => ({
  default: (key: unknown) => {
    mocks.swrKeys.push(key);
    return {
      data:
        Array.isArray(key) && key[1] === "gitlab-configurations"
          ? { integrations: [], can_configure: true }
          : undefined,
      mutate: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ currentWorkspace: { name: "PayHolder", slug: "payholder" } }),
}));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({ allowPermissions: () => mocks.isAdmin }),
}));
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "workspace_settings.settings.integrations.title" ? "Интеграции" : key),
  }),
}));
vi.mock("@plane/ui", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props} /> }));
vi.mock("@/components/core/page-title", () => ({ PageHead: () => null }));
vi.mock("@/components/auth-screens/not-authorized-view", () => ({
  NotAuthorizedView: () => <p role="alert">Access denied</p>,
}));
vi.mock("@/services/integrations", () => ({
  IntegrationService: class {
    getAppIntegrationsList = mocks.legacyCatalog;
  },
}));
vi.mock("@/services/integrations/gitlab.service", () => ({
  GitLabIntegrationService: class {
    configurations = vi.fn();
    configure = mocks.configure;
  },
}));

describe("workspace integrations page", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.isAdmin = true;
    mocks.swrKeys = [];
    mocks.configure.mockClear();
    mocks.legacyCatalog.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the real GitLab configuration form using only the supported workspace API", async () => {
    await act(async () => root.render(<WorkspaceIntegrationsPage />));
    expect(container.textContent).toContain("Интеграции");
    const gitlab = container.querySelector('section[aria-label="GitLab"]')!;
    expect(gitlab).not.toBeNull();
    expect(mocks.swrKeys).toEqual([["payholder", "gitlab-configurations"]]);
    const configure = [...gitlab.querySelectorAll("button")].find(
      (button) => button.textContent === "gitlab_development.configure"
    )!;
    await act(async () => configure.click());
    expect(gitlab.querySelector('input[name="base_url"]')).not.toBeNull();
    expect(gitlab.querySelector('input[name="repositories"]')).not.toBeNull();
    expect(gitlab.querySelector('input[name="token"][type="password"]')).not.toBeNull();
    expect(gitlab.querySelector('input[name="client_id"]')).not.toBeNull();
    expect(gitlab.querySelector('input[name="client_secret"][type="password"]')).not.toBeNull();
    expect(mocks.legacyCatalog).not.toHaveBeenCalled();
    expect(mocks.configure).not.toHaveBeenCalled();
  });

  it("does not mount the GitLab configuration or request data for a non-admin", async () => {
    mocks.isAdmin = false;
    await act(async () => root.render(<WorkspaceIntegrationsPage />));
    expect(container.textContent).toContain("Access denied");
    expect(container.querySelector('section[aria-label="GitLab"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(mocks.swrKeys).toEqual([]);
    expect(mocks.legacyCatalog).not.toHaveBeenCalled();
  });
});
