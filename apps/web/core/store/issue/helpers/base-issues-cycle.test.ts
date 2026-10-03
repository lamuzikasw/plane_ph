import { runInAction } from "mobx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_ISSUES } from "@plane/constants";
import { EIssueLayoutTypes, type TIssue } from "@plane/types";
import type { IIssueRootStore } from "../root.store";
import type { IBaseIssueFilterStore } from "./issue-filter-helper.store";
import { BaseIssuesStore } from "./base-issues.store";

vi.mock("@/lib/store-context", () => ({ store: {} }));

class TestIssuesStore extends BaseIssuesStore {
  fetchParentStats = vi.fn();
  updateParentStats = vi.fn();
}

describe("single work item cycle changes", () => {
  let store: TestIssuesStore;
  let items: Record<string, TIssue>;
  beforeEach(() => {
    items = Object.fromEntries(
      ["selected", "other"].map((id) => [
        id,
        { id, project_id: "project", cycle_id: "source", priority: "high", parent_id: null } as TIssue,
      ])
    );
    store = new TestIssuesStore(
      {
        cycleId: "source",
        issues: {
          getIssueById: (id: string) => items[id],
          getIssuesByIds: (ids: string[]) => ids.map((id) => items[id]),
          updateIssue: (id: string, data: Partial<TIssue>) => {
            items[id] = { ...items[id], ...data };
          },
        },
      } as unknown as IIssueRootStore,
      {
        issueFilters: { displayFilters: { layout: EIssueLayoutTypes.KANBAN, group_by: "priority" } },
      } as unknown as IBaseIssueFilterStore
    );
    runInAction(() => {
      store.groupedIssueIds = { high: ["selected", "other"] };
      store.groupedIssueCount = { high: 2, [ALL_ISSUES]: 2 };
    });
  });

  it("moves only the selected card and posts one work item to the target cycle", async () => {
    const add = vi.spyOn(store.issueService, "addIssueToCycle").mockResolvedValue([]);
    await store.addCycleToIssue("workspace", "project", "target", "selected");
    expect(add).toHaveBeenCalledExactlyOnceWith("workspace", "project", "target", { issues: ["selected"] });
    expect(items.selected.cycle_id).toBe("target");
    expect(items.other.cycle_id).toBe("source");
    expect(store.groupedIssueIds).toEqual({ high: ["other"] });
    expect(store.groupedIssueCount).toEqual({ high: 1, [ALL_ISSUES]: 1 });
  });

  it("restores the original card, its cycle and board counts if the transfer fails", async () => {
    vi.spyOn(store.issueService, "addIssueToCycle").mockRejectedValue(new Error("permission denied"));
    await expect(store.addCycleToIssue("workspace", "project", "target", "selected")).rejects.toThrow(
      "permission denied"
    );
    expect(items.selected.cycle_id).toBe("source");
    expect(items.other.cycle_id).toBe("source");
    expect(store.groupedIssueIds?.high).toEqual(expect.arrayContaining(["selected", "other"]));
    expect(store.groupedIssueIds?.high).toHaveLength(2);
    expect(store.groupedIssueCount).toEqual({ high: 2, [ALL_ISSUES]: 2 });
    expect(store.fetchParentStats).toHaveBeenCalledWith("workspace", "project", "source");
  });

  it("does not duplicate counts if the source board refreshes before a failed transfer returns", async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(store.issueService, "addIssueToCycle").mockReturnValue(
      new Promise((_resolve, no) => {
        reject = no;
      })
    );
    const transfer = store.addCycleToIssue("workspace", "project", "target", "selected");
    expect(store.groupedIssueIds).toEqual({ high: ["other"] });
    runInAction(() => {
      items.selected = { ...items.selected, cycle_id: "source" };
      store.groupedIssueIds = { high: ["selected", "other"] };
      store.groupedIssueCount = { high: 2, [ALL_ISSUES]: 2 };
    });
    reject(new Error("permission denied"));
    await expect(transfer).rejects.toThrow("permission denied");
    expect(store.groupedIssueIds?.high).toHaveLength(2);
    expect(store.groupedIssueCount).toEqual({ high: 2, [ALL_ISSUES]: 2 });
  });
});
