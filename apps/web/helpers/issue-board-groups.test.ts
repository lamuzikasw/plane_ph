import { observable } from "mobx";
import { describe, expect, it, vi } from "vitest";
import { ALL_ISSUES } from "@plane/constants";
import { EIssueServiceType } from "@plane/types";
import type { TIssue, TIssuesResponse } from "@plane/types";
import type { IIssueRootStore } from "@/store/issue/root.store";
import type { IBaseIssueFilterStore } from "@/store/issue/helpers/issue-filter-helper.store";
import type { IIssueDetail } from "@/store/issue/issue-details/root.store";

vi.mock("@/lib/store-context", () => ({ rootStore: {} }));
vi.mock("@/services/cycle.service", () => ({ CycleService: vi.fn() }));
vi.mock("@/services/module.service", () => ({ ModuleService: vi.fn() }));
vi.mock("@/services/issue", () => ({
  IssueService: vi.fn(),
  IssueArchiveService: vi.fn(),
  WorkspaceDraftService: vi.fn(),
}));
import { BaseIssuesStore } from "@/store/issue/helpers/base-issues.store";
import { IssueStore as IssueDetailStore } from "@/store/issue/issue-details/issue.store";

class BoardStore extends BaseIssuesStore {
  fetchParentStats = vi.fn();
  updateParentStats = vi.fn();
}

function setup(subGroupBy?: "assignees") {
  const rows = observable<Record<string, TIssue>>({
    task: { id: "task", project_id: "sprint", state_id: "todo", sort_order: 1 } as TIssue,
  });
  const issues = {
    getIssueById: (id: string) => rows[id],
    getIssuesByIds: (ids: string[]) => ids.map((id) => rows[id]),
    updateIssue: (id: string, data: Partial<TIssue>) => Object.assign(rows[id], data),
    addIssue: (items: TIssue[]) => items.forEach((item) => (rows[item.id] = { ...rows[item.id], ...item })),
  };
  const root = {
    issues,
    issueDetail: { relation: { extractRelationsFromIssues: vi.fn() } },
  } as unknown as IIssueRootStore;
  const filter = {
    issueFilters: {
      displayFilters: { layout: "kanban", group_by: "state", sub_group_by: subGroupBy, order_by: "sort_order" },
    },
  } as unknown as IBaseIssueFilterStore;
  const store = new BoardStore(root, filter);
  store.groupedIssueIds = { todo: ["task"], done: [], started: [] };
  store.groupedIssueCount = { [ALL_ISSUES]: 1, todo: 1, done: 0, started: 0 };
  Object.assign(store.issueService, { patchIssue: vi.fn().mockResolvedValue(undefined) });
  root.projectIssues = store as unknown as IIssueRootStore["projectIssues"];
  const detail = new IssueDetailStore({ rootIssueStore: root } as IIssueDetail, EIssueServiceType.ISSUES);
  return { store, rows, detail };
}

function expectDone(store: BoardStore) {
  expect(store.groupedIssueIds).toEqual({ todo: [], done: ["task"], started: [] });
  expect(store.groupedIssueCount).toEqual({ [ALL_ISSUES]: 1, todo: 0, done: 1, started: 0 });
}

describe("board group consistency", () => {
  it.each([undefined, "original"])(
    "moves a card and its count when opening details returns a newer status (canonical: %s)",
    (canonicalId) => {
      const { store, rows, detail } = setup();
      rows.task.canonical_issue_id = canonicalId;
      detail.addIssueToStore({ ...rows.task, state_id: "done" });
      expect(rows.task.state_id).toBe("done");
      expectDone(store);
      detail.addIssueToStore({ ...rows.task });
      expectDone(store);
    }
  );

  it("does not add a task outside the loaded board when opening its details", () => {
    const { store, rows, detail } = setup();
    detail.addIssueToStore({ ...rows.task, id: "other", state_id: "done" });
    expect(store.groupedIssueIds).toEqual({ todo: ["task"], done: [], started: [] });
    expect(store.groupedIssueCount).toEqual({ [ALL_ISSUES]: 1, todo: 1, done: 0, started: 0 });
  });

  it("moves an observable task from Todo to Done", async () => {
    const { store } = setup();
    await store.issueUpdate("payholder", "sprint", "task", { state_id: "done" });
    expectDone(store);
  });

  it("removes the card from its displayed column even when a detail refresh changed its status", async () => {
    const { store, rows } = setup();
    rows.task.state_id = "started";
    await store.issueUpdate("payholder", "sprint", "task", { state_id: "done" });
    expectDone(store);
  });

  it("does not keep an old column entry when pagination fetches the moved task", () => {
    const { store, rows } = setup();
    store.onfetchNexIssues(
      {
        results: [{ ...rows.task, state_id: "done" }],
        total_count: 1,
        next_page_results: false,
      } as TIssuesResponse,
      "done"
    );
    expectDone(store);
  });

  it("removes an existing duplicate without changing the total or double-counting Done", async () => {
    const { store, rows } = setup();
    rows.task.state_id = "done";
    store.groupedIssueIds = { todo: ["task"], done: ["task"], started: [] };
    store.groupedIssueCount.done = 1;
    await store.issueUpdate("payholder", "sprint", "task", { state_id: "done" });
    expectDone(store);
    await store.issueUpdate("payholder", "sprint", "task", { state_id: "done" });
    expectDone(store);
  });

  it("does not reintroduce Todo from a page older than the local move", async () => {
    const { store, rows } = setup();
    const old = { ...rows.task, updated_at: "2026-09-15T11:00:00Z" };
    await store.issueUpdate("payholder", "sprint", "task", { state_id: "done", updated_at: "2026-09-15T12:00:00Z" });
    store.onfetchNexIssues({ results: [old], total_count: 1, next_page_results: false } as TIssuesResponse, "todo");
    expect(rows.task.state_id).toBe("done");
    expectDone(store);
  });

  it("keeps unloaded tasks in the source column count", async () => {
    const { store, rows } = setup();
    store.groupedIssueCount.todo = 30;
    store.groupedIssueCount[ALL_ISSUES] = 30;
    rows.task.state_id = "started";
    await store.issueUpdate("payholder", "sprint", "task", { state_id: "done" });
    expect(store.groupedIssueCount).toEqual({ [ALL_ISSUES]: 30, todo: 29, done: 1, started: 0 });
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ])("moves every assignee swimlane (both loaded: %s, detail read: %s)", async (bothLoaded, detailRead) => {
    const { store, rows, detail } = setup("assignees");
    rows.task.assignee_ids = ["alice", "bob"];
    store.groupedIssueIds = {
      todo: { alice: ["task"], bob: bothLoaded ? ["task"] : [] },
      done: { alice: [], bob: [] },
    };
    store.groupedIssueCount = {
      [ALL_ISSUES]: 1,
      todo: 1,
      done: 0,
      todo_alice: 1,
      todo_bob: 1,
      done_alice: 0,
      done_bob: 0,
    };
    if (detailRead) detail.addIssueToStore({ ...rows.task, state_id: "done" });
    else await store.issueUpdate("payholder", "sprint", "task", { state_id: "done" });
    expect(store.groupedIssueIds).toEqual({ todo: { alice: [], bob: [] }, done: { alice: ["task"], bob: ["task"] } });
    expect(store.groupedIssueCount).toEqual({
      [ALL_ISSUES]: 1,
      todo: 0,
      done: 1,
      todo_alice: 0,
      todo_bob: 0,
      done_alice: 1,
      done_bob: 1,
    });
  });
});
