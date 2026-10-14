import { runInAction } from "mobx";
import { describe, expect, it, vi } from "vitest";
import { EInboxIssueStatus, type TInboxIssue } from "@plane/types";
import type { CoreRootStore } from "../root.store";
import { ProjectInboxStore } from "./project-inbox.store";

vi.mock("@/services/inbox", () => ({ InboxIssueService: vi.fn() }));
vi.mock("@/services/issue", () => ({ IssueService: vi.fn() }));
function inbox(id: string, name = id): TInboxIssue {
  return { id: `inbox-${id}`, issue: { id, name }, status: EInboxIssueStatus.PENDING } as TInboxIssue;
}
function setup(count = 1) {
  const store = new ProjectInboxStore({} as CoreRootStore);
  runInAction(() => {
    store.currentInboxProjectId = "project";
    store.loader = undefined;
    store.inboxIssueIds = Array.from({ length: count }, (_, i) => `old-${i}`);
    store.filtersMap.project = { status: [EInboxIssueStatus.PENDING] };
  });
  const list = vi.fn().mockResolvedValue({ results: [inbox("new")], total_results: 1, next_page_results: false });
  const retrieve = vi.fn().mockResolvedValue(inbox("new", "Updated description"));
  store.inboxIssueService = { list, retrieve } as unknown as typeof store.inboxIssueService;
  return { store, list, retrieve };
}
describe("live Intake refresh", () => {
  it("replaces stale results, includes new requests and updates counts without a loader", async () => {
    const { store, list } = setup();
    const request = store.refreshInboxIssues("workspace", "project", () => true);
    expect(store.loader).toBeUndefined();
    await request;
    expect(list).toHaveBeenCalledOnce();
    expect(store.inboxIssueIds).toEqual(["new"]);
    expect(store.inboxIssuePaginationInfo?.total_results).toBe(1);
    expect(store.inboxIssues.new.issue.name).toBe("new");
  });
  it("replays loaded pages and retains the next cursor", async () => {
    const { store, list } = setup(20);
    list.mockResolvedValueOnce({
      results: Array.from({ length: 10 }, (_, i) => inbox(`first-${i}`)),
      total_results: 30,
      next_page_results: true,
      next_cursor: "10:1:0",
    });
    list.mockResolvedValueOnce({
      results: Array.from({ length: 10 }, (_, i) => inbox(`second-${i}`)),
      total_results: 30,
      next_page_results: true,
      next_cursor: "10:2:0",
    });
    await store.refreshInboxIssues("workspace", "project", () => true);
    expect(list.mock.calls[1][2].cursor).toBe("10:1:0");
    expect(store.inboxIssueIds).toHaveLength(20);
    expect(store.inboxIssuePaginationInfo?.next_cursor).toBe("10:2:0");
    expect(store.getIsIssueAvailable("selected-at-page-boundary")).toBe(true);
  });
  it("ignores responses after filters change or the view becomes inactive", async () => {
    const { store } = setup();
    const request = store.refreshInboxIssues("workspace", "project", () => true);
    runInAction(() => {
      store.filtersMap.project = { priority: ["high"] };
    });
    await request;
    expect(store.inboxIssueIds).toEqual(["old-0"]);
    await store.refreshInboxIssue("workspace", "project", "new", () => false);
    expect(store.inboxIssues.new).toBeUndefined();
  });
  it("retains existing results on a failed request and retries successfully", async () => {
    const { store, list } = setup();
    list.mockRejectedValueOnce(new Error("network"));
    await expect(store.refreshInboxIssues("workspace", "project", () => true)).rejects.toThrow("network");
    expect(store.inboxIssueIds).toEqual(["old-0"]);
    expect(store.error).toBeUndefined();
    await store.refreshInboxIssues("workspace", "project", () => true);
    expect(store.inboxIssueIds).toEqual(["new"]);
  });
});
