import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const result = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as unknown, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: () => result }));
vi.mock("mobx-react", () => ({ observer: (component: unknown) => component }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({ useIssueDetail: () => ({ toggleIssueProjectsModal: vi.fn() }) }));
vi.mock("@headlessui/react", () => ({
  Dialog: { Title: ({ children }: React.PropsWithChildren) => <h3>{children}</h3> },
}));
vi.mock("@/hooks/store/use-issues", () => ({ useIssues: () => ({ issues: {} }) }));
vi.mock("@/services/issue/issue-placement.service", () => ({ IssuePlacementService: class {} }));
vi.mock("@plane/propel/button", () => ({
  Button: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: {}, setToast: vi.fn() }));
vi.mock("@plane/ui", () => ({
  EModalPosition: {},
  EModalWidth: {},
  ModalCore: ({ children }: React.PropsWithChildren) => <section role="dialog">{children}</section>,
}));
vi.mock("@/components/common/layout/sidebar/property-list-item", () => ({
  SidebarPropertyListItem: ({ label, children }: React.PropsWithChildren<{ label: string }>) => (
    <div>
      {label}
      {children}
    </div>
  ),
}));

import { IssueProjectsProperty } from "@/components/issues/issue-detail/projects-property";

const render = () =>
  renderToStaticMarkup(
    <IssueProjectsProperty workspaceSlug="payholder" projectId="timeqa" issueId="original" disabled={false} />
  );

describe("Projects property visibility", () => {
  beforeEach(() => {
    result.data = undefined;
    result.error = undefined;
  });
  it("hides only when the server explicitly disables the feature", () => {
    result.data = { enabled: false };
    expect(render()).toBe("");
  });
  it("displays both project identifiers and the add action", () => {
    result.data = {
      enabled: true,
      can_manage: true,
      available_projects: [],
      placements: [
        {
          id: "original",
          project_id: "timeqa",
          project_name: "Test",
          identifier: "TIMEQA",
          sequence_id: 13,
          is_original: true,
        },
        {
          id: "placement",
          project_id: "mptst",
          project_name: "Companion",
          identifier: "MPTST",
          sequence_id: 1,
          is_original: false,
        },
      ],
    };
    const html = render();
    expect(html).toContain("/payholder/browse/TIMEQA-13/");
    expect(html).toContain("/payholder/browse/MPTST-1/");
    expect(html).toContain("issue_projects.add");
    // Portals live outside the peek DOM. Its outside-click detector must ignore the entire dialog.
    expect(html).toMatch(/<section role="dialog"><div[^>]*data-prevent-outside-click="true"/);
  });
});
