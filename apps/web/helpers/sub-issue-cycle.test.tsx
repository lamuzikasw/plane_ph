// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig, type Cache } from "swr";
import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IIssueDisplayProperties, TIssue, TSubIssueOperations } from "@plane/types";
import { SUB_ISSUES_DISPLAY_PROPERTIES_KEYS } from "@plane/constants";

const mocks = vi.hoisted(() => ({
  issue: {
    id: "child",
    name: "Доставка карт",
    project_id: "other-project",
    cycle_id: "cycle",
    sub_issues_count: 0,
  } as TIssue,
  cycles: {} as Record<string, { id: string; name: string }>,
  displayProperties: {} as IIssueDisplayProperties,
  fetchCycleDetails: vi.fn(),
  peek: vi.fn(),
}));
vi.mock("@/lib/store-context", () => ({ store: {} }));
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "common.cycle" ? "Цикл" : key) }),
}));
vi.mock("@/hooks/store/use-cycle", () => ({
  useCycle: () => ({
    getCycleById: (id: string) => mocks.cycles[id],
    fetchCycleDetails: mocks.fetchCycleDetails,
  }),
}));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    issue: { getIssueById: () => mocks.issue },
    subIssues: {
      filters: { getSubIssueFilters: () => ({ displayProperties: mocks.displayProperties }) },
      subIssueHelpersByIssueId: () => ({ preview_loader: [], issue_visibility: [] }),
      setSubIssueHelpers: vi.fn(),
    },
  }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    getProjectById: (id: string) => ({ id, identifier: "SPRINT" }),
  }),
}));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/hooks/use-issue-peek-overview-redirection", () => ({ default: () => ({ handleRedirection: mocks.peek }) }));
vi.mock("@/components/issues/issue-detail-widgets/sub-issues/helper", () => ({ useSubIssueOperations: () => ({}) }));
vi.mock("@/plane-web/components/issues/issue-details/issue-identifier", () => ({
  IssueIdentifier: () => <span>SPRINT-368</span>,
}));
vi.mock("@/components/issues/issue-detail-widgets/sub-issues/issues-list/properties", () => ({
  SubIssuesListItemProperties: () => null,
}));
vi.mock("@/components/issues/issue-detail-widgets/sub-issues/issues-list/root", () => ({
  SubIssuesListRoot: () => null,
}));
vi.mock("@plane/propel/tooltip", () => ({ Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</> }));
vi.mock("@plane/ui", () => ({
  ControlLink: ({ children, onClick, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
  CustomMenu: Object.assign(() => null, { MenuItem: () => null }),
}));
import { SubIssuesListItem } from "@/components/issues/issue-detail-widgets/sub-issues/issues-list/list-item";
import { DEFAULT_DISPLAY_PROPERTIES } from "@/store/issue/issue-details/sub_issues_filter.store";

let root: ReturnType<typeof createRoot>;
let cache: Cache;
async function render(count = 1) {
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => cache }}>
        {Array.from({ length: count }, (_, i) => (
          <SubIssuesListItem
            key={i}
            workspaceSlug="payholder"
            projectId="parent-project"
            parentIssueId="parent"
            rootIssueId="parent"
            issueId="child"
            spacingLeft={0}
            canEdit={false}
            handleIssueCrudState={() => {}}
            subIssueOperations={{} as TSubIssueOperations}
          />
        ))}
      </SWRConfig>
    )
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.cycles = observable({});
  mocks.displayProperties = {};
  mocks.issue.cycle_id = "cycle";
  mocks.peek.mockClear();
  mocks.fetchCycleDetails.mockReset().mockImplementation(async (_workspace: string, _project: string, id: string) => {
    const cycle = { id, name: "Спринт — доставка карт" };
    runInAction(() => {
      mocks.cycles[id] = cycle;
    });
    return cycle;
  });
  cache = new Map();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("shows the cycle name by default even in a read-only row with older display settings", async () => {
  mocks.cycles.cycle = { id: "cycle", name: "Спринт — доставка карт" };
  await render();
  const badge = document.querySelector('[aria-label="Цикл: Спринт — доставка карт"]');
  expect(badge?.textContent).toContain("Спринт — доставка карт");
  expect(badge?.getAttribute("title")).toBe("Цикл: Спринт — доставка карт");
  expect(mocks.fetchCycleDetails).not.toHaveBeenCalled();
  expect(DEFAULT_DISPLAY_PROPERTIES.cycle).toBe(true);
  expect(SUB_ISSUES_DISPLAY_PROPERTIES_KEYS).toContain("cycle");
});
it("loads a missing cycle from the child's project once for multiple rows", async () => {
  await render(2);
  expect(mocks.fetchCycleDetails).toHaveBeenCalledExactlyOnceWith("payholder", "other-project", "cycle");
  expect(document.querySelectorAll('[aria-label="Цикл: Спринт — доставка карт"]')).toHaveLength(2);
});
it("does not show a cycle or fetch details for an unassigned subtask", async () => {
  mocks.issue.cycle_id = null;
  await render();
  expect(document.querySelector("[aria-label^='Цикл']")).toBeNull();
  expect(mocks.fetchCycleDetails).not.toHaveBeenCalled();
});
it("respects an explicitly hidden cycle property", async () => {
  mocks.displayProperties.cycle = false;
  await render();
  expect(document.querySelector("[aria-label^='Цикл']")).toBeNull();
  expect(mocks.fetchCycleDetails).not.toHaveBeenCalled();
});
it("keeps long cycle names accessible and preserves opening the subtask", async () => {
  const name = "Спринт с очень длинным названием для карточного продукта и доставки карт";
  mocks.cycles.cycle = { id: "cycle", name };
  await render();
  const badge = document.querySelector(`[aria-label="Цикл: ${name}"]`);
  expect(badge?.className).toContain("max-w-40");
  expect(badge?.querySelector("span")?.className).toContain("truncate");
  await act(async () => badge?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  expect(mocks.peek).toHaveBeenCalledWith("payholder", mocks.issue, false);
});
