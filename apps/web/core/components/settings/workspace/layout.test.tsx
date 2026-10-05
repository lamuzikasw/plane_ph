// @vitest-environment jsdom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EUserPermissionsLevel } from "@plane/constants";
import type { IWorkspaceMemberMe } from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";
import WorkspaceSettingLayout from "@/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/layout";
import { BaseUserPermissionStore } from "@/store/user/base-permissions.store";
import type { RootStore } from "@/plane-web/store/root.store";

vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => permissionStore }));
vi.mock("@/components/auth-screens/not-authorized-view", () => ({
  NotAuthorizedView: () => <div data-testid="not-authorized">Not authorized</div>,
}));
vi.mock("@/components/settings/mobile/nav", () => ({ SettingsMobileNav: () => <nav /> }));
vi.mock("@/components/settings/workspace/sidebar", () => ({
  WorkspaceSettingsSidebarRoot: () => <aside data-testid="settings-sidebar">Workspace settings</aside>,
}));

// Keep the actual permission policy: the layout must agree with the store's
// SUPER_ADMIN handling instead of duplicating its role comparison.
class TestUserPermissionStore extends BaseUserPermissionStore {
  getProjectRoleByWorkspaceSlugAndProjectId = () => undefined;
  fetchWorkspaceLevelProjectEntities = () => {};

  constructor(role: EUserWorkspaceRoles) {
    // Use a different current workspace to verify direct navigation checks the
    // workspace from the URL, rather than falling back to router state.
    super({ router: { workspaceSlug: "other-workspace" } } as RootStore);
    this.workspaceUserInfo = { payholder: { role } as IWorkspaceMemberMe };
  }
}

let permissionStore: TestUserPermissionStore;

function LayoutRoute() {
  const params = useParams();
  return <WorkspaceSettingLayout {...({ params } as ComponentProps<typeof WorkspaceSettingLayout>)} />;
}

describe("workspace settings layout authorization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    permissionStore = new TestUserPermissionStore(EUserWorkspaceRoles.SUPER_ADMIN);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderPath(pathname: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[pathname]}>
          <Routes>
            <Route element={<LayoutRoute />}>
              <Route
                path=":workspaceSlug/settings/:setting"
                element={<article data-testid="settings-outlet">Integrations page</article>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      );
    });
  }

  it.each([
    [EUserWorkspaceRoles.SUPER_ADMIN, "/payholder/settings/integrations"],
    [EUserWorkspaceRoles.SUPER_ADMIN, "/payholder/settings/integrations/"],
    [EUserWorkspaceRoles.ADMIN, "/payholder/settings/integrations"],
    [EUserWorkspaceRoles.ADMIN, "/payholder/settings/integrations/"],
  ] as const)("shows the sidebar and page on direct entry for role %s at %s", async (role, pathname) => {
    permissionStore = new TestUserPermissionStore(role);
    const checkAccess = vi.spyOn(permissionStore, "allowPermissions");

    await renderPath(pathname);

    expect(container.querySelector('[data-testid="settings-sidebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-outlet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="not-authorized"]')).toBeNull();
    expect(checkAccess).toHaveBeenCalledWith([EUserWorkspaceRoles.ADMIN], EUserPermissionsLevel.WORKSPACE, "payholder");
  });

  it.each([EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST])(
    "withholds integration administration from workspace role %s",
    async (role) => {
      permissionStore = new TestUserPermissionStore(role);

      await renderPath("/payholder/settings/integrations/");

      expect(container.querySelector('[data-testid="not-authorized"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="settings-sidebar"]')).toBeNull();
      expect(container.querySelector('[data-testid="settings-outlet"]')).toBeNull();
    }
  );

  it("preserves member access to the existing members page", async () => {
    permissionStore = new TestUserPermissionStore(EUserWorkspaceRoles.MEMBER);

    await renderPath("/payholder/settings/members/");

    expect(container.querySelector('[data-testid="settings-sidebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-outlet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="not-authorized"]')).toBeNull();
  });

  it("denies an unknown settings access key even for SUPER_ADMIN", async () => {
    const checkAccess = vi.spyOn(permissionStore, "allowPermissions");

    await renderPath("/payholder/settings/unsupported/");

    expect(container.querySelector('[data-testid="not-authorized"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-outlet"]')).toBeNull();
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it.each([false, true])("denies missing membership when another workspace is cached: %s", async (otherCached) => {
    permissionStore.workspaceUserInfo = otherCached
      ? { "other-workspace": { role: EUserWorkspaceRoles.SUPER_ADMIN } as IWorkspaceMemberMe }
      : {};

    await renderPath("/payholder/settings/integrations/");

    expect(container.querySelector('[data-testid="not-authorized"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-outlet"]')).toBeNull();
  });
});
