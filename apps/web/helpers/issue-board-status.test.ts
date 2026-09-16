import { describe, expect, it, vi } from "vitest";
import type { TIssue } from "@plane/types";
import { ALL_ISSUES } from "@plane/constants";
import type { IIssueRootStore } from "@/store/issue/root.store";
import type { IBaseIssueFilterStore } from "@/store/issue/helpers/issue-filter-helper.store";
vi.mock("@/lib/store-context", () => ({ rootStore: {} }));
vi.mock("@/services/cycle.service", () => ({ CycleService: class {} }));
vi.mock("@/services/module.service", () => ({ ModuleService: class {} }));
vi.mock("@/services/issue", () => ({ IssueService: class {}, IssueArchiveService: class {} }));
import { BaseIssuesStore } from "@/store/issue/helpers/base-issues.store";
class BoardStore extends BaseIssuesStore {
  fetchParentStats = vi.fn();
  updateParentStats = vi.fn();
}
function setup(id = "native", canonicalId = id) {
  const issue = {
    id,
    canonical_issue_id: canonicalId,
    project_id: "sprint",
    state_id: "todo",
    sort_order: 1,
  } as TIssue;
  const rows: Record<string, TIssue> = { [id]: issue };
  const issues = {
    issuesMap: rows,
    getIssueById: (key: string) => rows[key],
    getIssuesByIds: (ids: string[]) => ids.map((key) => rows[key]),
    updateIssue: (key: string, data: Partial<TIssue>) => Object.assign(rows[key], data),
    addIssue: (items: TIssue[]) => items.forEach((item) => Object.assign(rows[item.id], item)),
  };
  const root = { issues } as unknown as IIssueRootStore;
  const filter = {
    issueFilters: { displayFilters: { layout: "kanban", group_by: "state", order_by: "sort_order" } },
  } as unknown as IBaseIssueFilterStore;
  const store = new BoardStore(root, filter);
  store.groupedIssueIds = { todo: [id], backlog: [], started: [] };
  store.groupedIssueCount = { [ALL_ISSUES]: 1, todo: 1, backlog: 0, started: 0 };
  const patchIssue = vi.fn().mockResolvedValue(undefined);
  const retrieve = vi.fn();
  Object.assign(store.issueService, { patchIssue, retrieve });
  const move = (state_id: string) => store.issueUpdate("payholder", "sprint", id, { state_id });
  const check = (state: string) => {
    expect(rows[id].state_id).toBe(state);
    expect(store.groupedIssueIds).toEqual({
      todo: state === "todo" ? [id] : [],
      backlog: state === "backlog" ? [id] : [],
      started: state === "started" ? [id] : [],
    });
    expect(store.groupedIssueCount).toEqual({
      [ALL_ISSUES]: 1,
      todo: state === "todo" ? 1 : 0,
      backlog: state === "backlog" ? 1 : 0,
      started: state === "started" ? 1 : 0,
    });
  };
  return { rows, retrieve, patchIssue, move, check };
}
describe("board status transitions", () => {
  it.each([
    ["native", "native"],
    ["placement", "original"],
  ])("keeps %s in one column across consecutive moves", async (id, canonicalId) => {
    const { move, check, retrieve, rows } = setup(id, canonicalId);
    let finishRead!: (value: TIssue) => void;
    const delayedRead = new Promise<TIssue>((resolve) => {
      finishRead = resolve;
    });
    retrieve.mockReturnValue(delayedRead);
    const first = move("started");
    await Promise.resolve();
    const stale = { ...rows[id] };
    const second = move("backlog");
    await Promise.resolve();
    finishRead(stale);
    await Promise.all([first, second]);
    check("backlog");
    await move("todo");
    check("todo");
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("restores one card and correct counts when a transition fails", async () => {
    const { move, check, patchIssue } = setup();
    patchIssue.mockRejectedValue(new Error("status rejected"));
    await expect(move("backlog")).rejects.toThrow("status rejected");
    check("todo");
  });
});
