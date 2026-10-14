// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EUserPermissions } from "@plane/constants";
import type { IWorkspace } from "@plane/types";
import SidebarDropdownItem from "./dropdown-item";

vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "payholder" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) =>
    href === "/payholder" ? (
      <div>{children}</div>
    ) : (
      <a href={href} {...props}>
        {children}
      </a>
    ),
}));
vi.mock("@headlessui/react", () => ({
  Menu: { Item: ({ children }: React.PropsWithChildren) => <div>{children}</div> },
}));
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "role_details.super_admin.title": "OG",
        "role_details.admin.title": "Администратор",
        "role_details.member.title": "Участник",
        "role_details.guest.title": "Гость",
      };
      return labels[key] ?? key;
    },
  }),
}));
vi.mock("@/plane-web/components/common/subscription/subscription-pill", () => ({ SubscriptionPill: () => null }));

describe("workspace switcher administration", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(role: EUserPermissions, active = true) {
    const workspace = { id: "workspace", slug: "payholder", name: "PayHolder", role, total_members: 23 } as IWorkspace;
    await act(async () =>
      root.render(
        <SidebarDropdownItem
          workspace={workspace}
          activeWorkspace={active ? workspace : null}
          handleItemClick={() => {}}
          handleWorkspaceNavigation={() => {}}
          handleClose={() => {}}
        />
      )
    );
  }
  it.each([
    [EUserPermissions.SUPER_ADMIN, "OG", true, true],
    [EUserPermissions.ADMIN, "Администратор", true, true],
    [EUserPermissions.MEMBER, "Участник", true, false],
    [EUserPermissions.GUEST, "Гость", false, false],
  ] as const)("shows the correct role and management links for role %s", async (role, label, settings, invites) => {
    await render(role);
    expect(container.textContent).toContain(label);
    expect(!!container.querySelector('a[href="/payholder/settings"]')).toBe(settings);
    expect(!!container.querySelector('a[href="/payholder/settings/members"]')).toBe(invites);
  });
  it("keeps management links scoped to the selected workspace", async () => {
    await render(EUserPermissions.SUPER_ADMIN, false);
    expect(container.querySelector('a[href="/payholder/settings"]')).toBeNull();
    expect(container.querySelector('a[href="/payholder/settings/members"]')).toBeNull();
  });
});
