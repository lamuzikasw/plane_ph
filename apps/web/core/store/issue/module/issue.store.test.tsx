/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { runInAction } from "mobx";
import { describe, expect, it, vi } from "vitest";
import { ALL_ISSUES } from "@plane/constants";
import { EIssueLayoutTypes, EIssuesStoreType, type TIssue, type TIssuesResponse } from "@plane/types";
import { IssueLayoutHOC } from "@/components/issues/issue-layouts/issue-layout-HOC";
import type { IIssueRootStore } from "../root.store";
import type { IModuleIssuesFilter } from "./filter.store";
import { ModuleIssues } from "./issue.store";

const context = vi.hoisted(() => ({ issues: undefined as ModuleIssues | undefined }));
vi.mock("@/lib/store-context", () => ({ store: {} }));
vi.mock("@/hooks/store/use-issues", () => ({ useIssues: () => context }));
vi.mock("@/hooks/use-issue-layout-store", () => ({ useIssueStoreType: () => EIssuesStoreType.MODULE }));
vi.mock("@/components/issues/issue-layouts/empty-states", () => ({
  IssueLayoutEmptyState: () => <div>Empty module</div>,
}));
vi.mock("@/components/ui/loader/layouts/kanban-layout-loader", () => ({
  KanbanLayoutLoader: () => <div>Loading board</div>,
}));
vi.mock("@/components/ui/loader/layouts/list-layout-loader", () => ({ ListLayoutLoader: () => null }));
vi.mock("@/components/ui/loader/layouts/calendar-layout-loader", () => ({ CalendarLayoutLoader: () => null }));
vi.mock("@/components/ui/loader/layouts/gantt-layout-loader", () => ({ GanttLayoutLoader: () => null }));
vi.mock("@/components/ui/loader/layouts/spreadsheet-layout-loader", () => ({ SpreadsheetLayoutLoader: () => null }));

function setup(swimlanes = false) {
  const items: Record<string, TIssue> = Object.fromEntries(
    ["selected", "other"].map((id) => [
      id,
      { id, project_id: "project", state_id: "todo", assignee_ids: ["alice", "bob"] } as TIssue,
    ])
  );
  const store = new ModuleIssues(
    {
      moduleId: "module",
      issues: {
        getIssueById: (id: string) => items[id],
        getIssuesByIds: (ids: string[]) => ids.map((id) => items[id]),
        updateIssue: (id: string, data: Partial<TIssue>) => {
          items[id] = { ...items[id], ...data };
        },
        removeIssue: (id: string) => {
          delete items[id];
        },
        addIssue: (issues: TIssue[]) =>
          issues.forEach((issue) => {
            items[issue.id] = issue;
          }),
      },
      issueDetail: { relation: { extractRelationsFromIssues: vi.fn() } },
    } as unknown as IIssueRootStore,
    {
      issueFilters: {
        displayFilters: {
          layout: EIssueLayoutTypes.KANBAN,
          group_by: "state",
          sub_group_by: swimlanes ? "assignees" : undefined,
        },
      },
    } as unknown as IModuleIssuesFilter
  );
  store.updateParentStats = vi.fn();
  store.fetchParentStats = vi.fn();
  vi.spyOn(store.issueService, "patchIssue").mockResolvedValue(items.selected);
  vi.spyOn(store.issueService, "deleteIssue").mockResolvedValue(undefined);
  runInAction(() => {
    store.groupedIssueIds = swimlanes
      ? { todo: { alice: ["selected", "other"], bob: ["selected", "other"] }, done: { alice: [], bob: [] } }
      : { todo: ["selected", "other"], done: [] };
    // Reproduce a stale counter while the board still has loaded work items.
    store.groupedIssueCount = { [ALL_ISSUES]: 0, todo: 0, done: 0, done_alice: 0 };
  });
  context.issues = store;
  return store;
}

const renderBoard = () =>
  renderToStaticMarkup(
    <IssueLayoutHOC layout={EIssueLayoutTypes.KANBAN}>
      <div>Board cards</div>
    </IssueLayoutHOC>
  );

describe("module board visibility when counters lag behind cards", () => {
  it.each([false, true])("keeps the board after status changes and deletion (swimlanes: %s)", async (swimlanes) => {
    const store = setup(swimlanes);
    expect(renderBoard()).toContain("Board cards");
    for (const state_id of ["done", "todo", "done"]) {
      // eslint-disable-next-line no-await-in-loop -- Each transition must finish before the next one.
      await store.updateIssue("workspace", "project", "selected", { state_id });
      expect(store.getGroupIssueCount(undefined, undefined, false)).toBe(2);
      expect(renderBoard()).toContain("Board cards");
    }
    await store.removeIssue("workspace", "project", "selected");
    expect(store.getGroupIssueCount(undefined, undefined, false)).toBe(1);
    expect(store.getGroupIssueCount("todo", undefined, false)).toBe(1);
    expect(renderBoard()).toContain("Board cards");
    await store.removeIssue("workspace", "project", "other");
    expect(renderBoard()).toContain("Empty module");
  });

  it("deduplicates loaded cards in the total and respects swimlane boundaries", () => {
    const store = setup(true);
    expect(store.getGroupIssueCount(undefined, undefined, false)).toBe(2);
    expect(store.getGroupIssueCount("todo", "alice", false)).toBe(2);
    expect(store.getGroupIssueCount("done", "alice", false)).toBe(0);
    expect(store.getGroupIssueCount(undefined, "bob", true)).toBe(2);
    runInAction(() => {
      store.groupedIssueCount[ALL_ISSUES] = 33;
    });
    expect(store.getGroupIssueCount(undefined, undefined, false)).toBe(33);
  });

  it("preserves the board if a status update fails", async () => {
    const store = setup();
    vi.mocked(store.issueService.patchIssue).mockRejectedValue(new Error("update failed"));
    await expect(store.updateIssue("workspace", "project", "selected", { state_id: "done" })).rejects.toThrow(
      "update failed"
    );
    expect(store.groupedIssueIds?.todo).toEqual(expect.arrayContaining(["selected", "other"]));
    expect(store.getGroupIssueCount(undefined, undefined, false)).toBe(2);
    expect(store.getGroupIssueCount("todo", "null", false)).toBe(2);
    expect(renderBoard()).toContain("Board cards");
  });

  it("keeps existing cards visible when a subsequent page returns a stale zero count", () => {
    const store = setup();
    const response: TIssuesResponse = {
      results: [],
      total_count: 0,
      total_results: 0,
      count: 0,
      total_pages: 0,
      grouped_by: "",
      next_cursor: "30:1:0",
      prev_cursor: "30:0:0",
      next_page_results: false,
      prev_page_results: false,
      extra_stats: null,
    };
    store.onfetchNexIssues(response);
    expect(store.getGroupIssueCount(undefined, undefined, false)).toBe(2);
    expect(renderBoard()).toContain("Board cards");
  });

  it("shows the initial loader while the first request is still pending", () => {
    const store = setup();
    store.setLoader("init-loader");
    expect(renderBoard()).toContain("Loading board");
    store.clear();
    store.setLoader(undefined);
    expect(renderBoard()).toContain("Loading board");
  });
});
