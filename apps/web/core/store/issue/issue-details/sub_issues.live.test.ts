import { runInAction } from "mobx";
import { expect, it, vi } from "vitest";
import { EIssueServiceType, type TIssue } from "@plane/types";
import type { IIssueDetail } from "./root.store";
import { IssueSubIssuesStore } from "./sub_issues.store";

vi.mock("@/lib/store-context", () => ({ store: {} }));
vi.mock("@/services/issue", () => ({ IssueService: vi.fn() }));

function setup() {
  const loadProperties = vi.fn().mockResolvedValue(undefined);
  const issues: Record<string, TIssue> = {
    parent: { id: "parent", updated_at: "2026-10-14T10:00:00Z" } as TIssue,
    child: { id: "child", project_id: "project", cycle_id: "old-cycle", state_id: "todo" } as TIssue,
  };
  const store = new IssueSubIssuesStore(
    {
      rootIssueStore: {
        rootStore: {
          state: { fetchProjectStates: loadProperties },
          memberRoot: { project: { fetchProjectMembers: loadProperties } },
          label: { fetchProjectLabels: loadProperties },
          cycle: { fetchAllCycles: loadProperties },
          module: { fetchModules: loadProperties },
          projectEstimate: { getProjectEstimates: loadProperties },
        },
        issues: {
          getIssueById: (id: string) => issues[id],
          getIssuesByIds: (ids: string[]) => ids.map((id) => issues[id]).filter(Boolean),
          addIssue: (data: TIssue[]) =>
            data.forEach((issue) => {
              issues[issue.id] = { ...issues[issue.id], ...issue };
            }),
          updateIssue: (id: string, data: Partial<TIssue>) => {
            issues[id] = { ...issues[id], ...data };
          },
        },
      },
    } as unknown as IIssueDetail,
    EIssueServiceType.ISSUES
  );
  runInAction(() => {
    store.subIssues.parent = ["child"];
  });
  const fetch = vi.fn().mockResolvedValue({
    sub_issues: [
      { id: "child", project_id: "project", cycle_id: "new-cycle", state_id: "done" },
      { id: "new-child", project_id: "other-project" },
    ],
    state_distribution: {},
  });
  store.issueService = { subIssues: fetch } as unknown as typeof store.issueService;
  return { store, fetch, issues, loadProperties };
}

it("refreshes child properties, membership and counts without displaying a loader", async () => {
  const { store, issues, loadProperties } = setup();
  const request = store.refreshSubIssues("workspace", "project", "parent", () => true);
  expect(store.loader).toBeUndefined();
  await request;
  expect(store.subIssues.parent).toEqual(["child", "new-child"]);
  expect(issues.child.cycle_id).toBe("new-cycle");
  expect(issues.child.state_id).toBe("done");
  expect(issues.parent.sub_issues_count).toBe(2);
  expect(loadProperties).toHaveBeenCalledTimes(6);
  expect(loadProperties).toHaveBeenCalledWith("workspace", "other-project");
  expect(issues.parent.updated_at).toBe("2026-10-14T10:00:00Z");
});
it("removes deleted or detached subtasks from the displayed list", async () => {
  const { store, fetch, issues } = setup();
  fetch.mockResolvedValue({ sub_issues: [], state_distribution: {} });
  await store.refreshSubIssues("workspace", "project", "parent", () => true);
  expect(store.subIssues.parent).toEqual([]);
  expect(issues.parent.sub_issues_count).toBe(0);
});
it("ignores a response after the list changes locally or the view is left", async () => {
  const { store } = setup();
  const request = store.refreshSubIssues("workspace", "project", "parent", () => true);
  runInAction(() => {
    store.subIssues.parent = ["local-child"];
  });
  await request;
  expect(store.subIssues.parent).toEqual(["local-child"]);
  await store.refreshSubIssues("workspace", "project", "parent", () => false);
  expect(store.subIssues.parent).toEqual(["local-child"]);
});
it("preserves the current children on failure and can retry", async () => {
  const { store, fetch } = setup();
  fetch.mockRejectedValueOnce(new Error("network"));
  await expect(store.refreshSubIssues("workspace", "project", "parent", () => true)).rejects.toThrow("network");
  expect(store.subIssues.parent).toEqual(["child"]);
  expect(store.loader).toBeUndefined();
  await store.refreshSubIssues("workspace", "project", "parent", () => true);
  expect(store.subIssues.parent).toEqual(["child", "new-child"]);
});
