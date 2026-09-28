// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISearchIssueResponse, TProjectIssuesSearchParams } from "@plane/types";

const mocks = vi.hoisted(() => ({ search: vi.fn(), submit: vi.fn(), close: vi.fn(), toast: vi.fn() }));
vi.mock("mobx-react", () => ({ observer: (component: unknown) => component }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/hooks/use-debounce", () => ({ default: (value: string) => value }));
vi.mock("@/hooks/store/use-member", () => ({
  useMember: () => ({ getUserDetails: () => ({ display_name: "Alex" }) }),
}));
vi.mock("@/hooks/store/use-project", () => ({ useProject: () => ({ joinedProjectIds: [], getProjectById: vi.fn() }) }));
vi.mock("@/hooks/store/use-label", () => ({ useLabel: () => ({}) }));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({}) }));
vi.mock("@/services/project", () => ({
  ProjectService: class {
    projectIssuesSearch = mocks.search;
  },
}));
vi.mock("@/plane-web/components/issues/issue-details/issue-identifier", () => ({
  IssueIdentifier: ({ issueSequenceId }: { issueSequenceId: number }) => <span>TEST-{issueSequenceId}</span>,
}));
vi.mock("@plane/utils", () => ({ getTabIndex: () => ({ baseTabIndex: 0 }), generateWorkItemLink: () => "#" }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: mocks.toast }));
vi.mock("@plane/propel/button", () => ({
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@plane/ui", () => {
  const Loader = Object.assign(({ children }: React.PropsWithChildren) => <div>{children}</div>, {
    Item: () => <span>Loading</span>,
  });
  return {
    EModalPosition: {},
    EModalWidth: {},
    Loader,
    ModalCore: ({ isOpen, children }: React.PropsWithChildren<{ isOpen: boolean }>) =>
      isOpen ? <div role="dialog">{children}</div> : null,
  };
});
vi.mock("./issue-picker-filters", async (original) => ({
  ...(await original<typeof import("./issue-picker-filters")>()),
  IssuePickerFilterBar: ({
    value,
    onChange,
  }: {
    value: import("./issue-picker-filters").IssuePickerFilters;
    onChange: (value: import("./issue-picker-filters").IssuePickerFilters) => void;
  }) => <button onClick={() => onChange({ ...value, state_groups: ["started"] })}>Filter started</button>,
}));

import { ExistingIssuesListModal } from "./existing-issues-list-modal";
import { emptyPickerFilters, pickerFilterParams } from "./issue-picker-filters";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const row = (id: string): ISearchIssueResponse => ({
  id,
  name: `Work ${id}`,
  project_id: "project",
  project__identifier: "TEST",
  project__name: "Project",
  sequence_id: Number(id) || 1,
  start_date: null,
  state__color: "#000",
  state__group: "started",
  state__name: "In progress",
  workspace__slug: "workspace",
  type_id: "type",
  assignee_ids: ["alex"],
});
const button = (text: string) => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;
async function click(node: Element) {
  await act(async () => {
    (node as HTMLElement).click();
  });
}
function Harness({ relation = false }: { relation?: boolean }) {
  const [isOpen, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <ExistingIssuesListModal
        workspaceSlug="workspace"
        projectId="project"
        isOpen={isOpen}
        handleClose={() => {
          setOpen(false);
          mocks.close();
        }}
        searchParams={relation ? { issue_relation: true } : { sub_issue: true }}
        handleOnSubmit={mocks.submit}
      />
    </>
  );
}
async function render(relation = false) {
  await act(async () => {
    root.render(<Harness relation={relation} />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.submit.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("existing work item picker", () => {
  it("retains selection across server filters and only selects shown results", async () => {
    mocks.search.mockImplementation((_workspace: string, _project: string, params: TProjectIssuesSearchParams) =>
      Promise.resolve(params.state_groups ? [row("2")] : [row("1")])
    );
    await render();
    await click(host.querySelector('[role="option"]')!);
    await click(button("Filter started"));
    expect(mocks.search.mock.lastCall?.[2]).toMatchObject({
      state_groups: "started",
      sub_issue: true,
      workspace_search: false,
      offset: 0,
    });
    expect(button("issue.select.filters.selected").textContent).toContain("1");
    await click(button("issue.select.filters.select_shown"));
    await click(button("issue.select.filters.add"));
    expect(mocks.submit).toHaveBeenCalledWith([row("1"), row("2")]);
  });
  it("ignores a stale response after the filter changes", async () => {
    let resolveOld!: (rows: ISearchIssueResponse[]) => void;
    mocks.search
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValue([row("2")]);
    await render();
    await click(button("Filter started"));
    await act(async () => resolveOld([row("1")]));
    expect(host.textContent).toContain("Work 2");
    expect(host.textContent).not.toContain("Work 1");
  });
  it("loads another page with the same filters and resets its offset for a new query", async () => {
    mocks.search
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => row(String(index + 1))))
      .mockResolvedValueOnce([row("101")])
      .mockResolvedValue([]);
    await render();
    await click(button("issue.select.filters.load_more"));
    expect(mocks.search.mock.lastCall?.[2].offset).toBe(100);
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(101);
    await click(button("Filter started"));
    expect(mocks.search.mock.lastCall?.[2]).toMatchObject({ offset: 0, state_groups: "started" });
  });
  it("keeps selection on submission failure, and resets when closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.search.mockResolvedValue([row("1")]);
    mocks.submit.mockRejectedValueOnce(new Error("offline"));
    await render();
    await click(host.querySelector('[role="option"]')!);
    await click(button("issue.select.filters.add"));
    expect(mocks.toast).toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(button("issue.select.filters.add").textContent).toContain("(1)");
    await click(button("common.cancel"));
    await click(button("Reopen"));
    expect(button("issue.select.filters.add").textContent).toContain("(0)");
    vi.restoreAllMocks();
  });
  it("shows parent context, blocks selection, and skips parented tasks in select shown", async () => {
    const parented = {
      ...row("2"),
      can_select: false,
      parent: {
        id: "parent",
        name: "Supplier integration",
        project_id: "project",
        project__identifier: "SPRINT",
        sequence_id: 159,
      },
    };
    mocks.search.mockResolvedValue([row("1"), parented]);
    await render();
    expect(mocks.search.mock.lastCall?.[2].include_parented).toBe(true);
    const disabled = host.querySelector('[role="option"][aria-disabled="true"]')!;
    expect(disabled.textContent).toContain("issue.select.filters.already_inside");
    const parentLink = [...disabled.querySelectorAll("a")].find((link) => link.textContent === "SPRINT-159")!;
    expect(parentLink.title).toBe("Supplier integration");
    expect(parentLink.target).toBe("_blank");
    expect(disabled.querySelector("input")?.disabled).toBe(true);
    await click(disabled);
    const parentClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      parentLink.dispatchEvent(parentClick);
    });
    expect(parentClick.defaultPrevented).toBe(false);
    expect(button("issue.select.filters.add").textContent).toContain("(0)");
    await click(button("issue.select.filters.select_shown"));
    expect(button("issue.select.deselect_all")).toBeDefined();
    await click(button("issue.select.filters.add"));
    expect(mocks.submit).toHaveBeenCalledWith([row("1")]);
  });
  it("keeps only-parented search results visible with no available selection", async () => {
    mocks.search.mockResolvedValue([{ ...row("2"), can_select: false, parent: null }]);
    await render();
    expect(host.textContent).toContain("Work 2");
    expect(host.textContent).toContain("issue.select.filters.has_parent");
    expect(button("issue.select.filters.select_shown").disabled).toBe(true);
    expect(button("issue.select.filters.add").disabled).toBe(true);
  });
  it("does not block adding relations to parented work items", async () => {
    mocks.search.mockResolvedValue([{ ...row("2"), can_select: false }]);
    await render(true);
    expect(mocks.search.mock.lastCall?.[2].include_parented).toBe(false);
    await click(host.querySelector('[role="option"]')!);
    expect(button("issue.select.filters.add").textContent).toContain("(1)");
  });
  it("drops a previous selection if a refreshed result acquired a parent", async () => {
    mocks.search
      .mockResolvedValueOnce([row("1")])
      .mockResolvedValueOnce([{ ...row("1"), can_select: false, parent: null }]);
    await render();
    await click(host.querySelector('[role="option"]')!);
    await click(button("Filter started"));
    expect(button("issue.select.filters.add").disabled).toBe(true);
  });
  it("serializes an assignee OR unassigned without sending the sentinel as a UUID", () => {
    expect(
      pickerFilterParams({
        ...emptyPickerFilters(),
        assignees: ["user-id", "unassigned"],
        priorities: ["urgent", "high"],
      })
    ).toMatchObject({ assignee_ids: "user-id", unassigned: true, priorities: "urgent,high" });
  });
});
