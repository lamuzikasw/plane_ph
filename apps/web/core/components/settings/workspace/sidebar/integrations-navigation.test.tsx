// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GROUPED_WORKSPACE_SETTINGS,
  WORKSPACE_SETTINGS,
  WORKSPACE_SETTINGS_ACCESS,
  WORKSPACE_SETTINGS_CATEGORY,
} from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
import russianSettings from "../../../../../../../packages/i18n/src/locales/ru/workspace-settings.json";
import { getWorkspaceActivePath, pathnameToAccessKey } from "@/components/settings/helper";
import { WorkspaceSettingsSidebarItemCategories } from "./item-categories";

const mocks = vi.hoisted(() => ({ role: 20, allowPermissions: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/payholder/settings/integrations/" }));
vi.mock("react-router", () => ({ useParams: () => ({ workspaceSlug: "payholder" }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "workspace_settings.settings.integrations.title"
        ? russianSettings.workspace_settings.settings.integrations.title
        : key,
  }),
}));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({ allowPermissions: mocks.allowPermissions }),
}));

describe("workspace integrations navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.role = EUserWorkspaceRoles.ADMIN;
    mocks.allowPermissions.mockReset().mockImplementation((roles: number[]) => roles.includes(mocks.role));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders a localized administrative link in the Developer category", async () => {
    await act(async () => root.render(<WorkspaceSettingsSidebarItemCategories />));
    const link = container.querySelector<HTMLAnchorElement>('a[href="/payholder/settings/integrations"]');
    expect(link?.textContent).toBe("Интеграции");
    expect(link?.querySelector("svg")).not.toBeNull();
    expect(link?.classList.contains("bg-layer-transparent-selected")).toBe(true);
    expect(GROUPED_WORKSPACE_SETTINGS[WORKSPACE_SETTINGS_CATEGORY.DEVELOPER]).toContain(
      WORKSPACE_SETTINGS.integrations
    );
    expect(
      Object.values(GROUPED_WORKSPACE_SETTINGS)
        .flat()
        .filter((item) => item.key === "integrations")
    ).toHaveLength(1);
    expect(link?.textContent).not.toMatch(/upgrade|pro|business/i);
  });

  it.each([EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST])(
    "withholds integration administration from workspace role %s",
    async (role) => {
      mocks.role = role;
      await act(async () => root.render(<WorkspaceSettingsSidebarItemCategories />));
      expect(container.querySelector('a[href="/payholder/settings/integrations"]')).toBeNull();
      expect(WORKSPACE_SETTINGS_ACCESS["/settings/integrations"]).not.toContain(role);
    }
  );

  it("authorizes the existing direct route for administrators and supplies its mobile title", () => {
    const pathname = "/payholder/settings/integrations/";
    const { accessKey } = pathnameToAccessKey(pathname);
    expect(WORKSPACE_SETTINGS_ACCESS[accessKey]).toEqual([EUserWorkspaceRoles.ADMIN]);
    expect(getWorkspaceActivePath(pathname)).toBe("workspace_settings.settings.integrations.title");
    expect(WORKSPACE_SETTINGS.integrations.highlight(pathname, "/payholder")).toBe(true);
    expect(WORKSPACE_SETTINGS.integrations.highlight("/other/settings/integrations/", "/payholder")).toBe(false);
  });
});
