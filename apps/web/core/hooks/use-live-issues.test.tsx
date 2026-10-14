import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { EIssuesStoreType, type TProfileViews } from "@plane/types";
import { useLiveIssues } from "./use-live-issues";

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  refresh: vi.fn(),
  refreshIssues: vi.fn(),
  getParams: vi.fn(() => ({ assignees: "previous", created_by: "previous", subscriber: "previous" })),
  workspace: vi.fn().mockResolvedValue({}),
  profile: vi.fn().mockResolvedValue({}),
  issues: { currentView: "assigned" as TProfileViews },
}));
vi.mock("next/navigation", () => ({ useParams: () => mocks.params }));
vi.mock("./store/use-issues", () => ({
  useIssues: () => ({
    issues: { ...mocks.issues, refreshIssues: mocks.refreshIssues },
    issuesFilter: { getFilterParams: mocks.getParams },
  }),
}));
vi.mock("./use-live-refresh", () => ({ useLiveRefresh: (...args: unknown[]) => mocks.refresh(...args) }));
vi.mock("@/services/issue", () => ({ IssueArchiveService: vi.fn() }));
vi.mock("@/services/workspace.service", () => ({
  WorkspaceService: class {
    getViewIssues = mocks.workspace;
  },
}));
vi.mock("@/services/user.service", () => ({
  UserService: class {
    getUserProfileIssues = mocks.profile;
  },
}));
function View({ type }: { type: EIssuesStoreType }) {
  useLiveIssues(type);
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = { workspaceSlug: "workspace" };
  mocks.refreshIssues.mockImplementation(async (_workspace, _project, getParams, canApply, fetchPage) => {
    if (canApply()) return fetchPage?.(getParams({ perPageCount: 10 }, "10:0:0"), new AbortController().signal);
  });
});
it("refreshes workspace views through their workspace endpoint without a project route", async () => {
  mocks.params.globalViewId = "all-issues";
  renderToStaticMarkup(<View type={EIssuesStoreType.GLOBAL} />);
  expect(mocks.refresh.mock.calls[0][0]).toContain("all-issues");
  await mocks.refresh.mock.calls[0][1](() => true);
  expect(mocks.workspace).toHaveBeenCalledWith(
    "workspace",
    expect.any(Object),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(mocks.profile).not.toHaveBeenCalled();
});
it.each(["assigned", "created", "subscribed"] as const)(
  "preserves the %s profile restriction when refreshing",
  async (view) => {
    mocks.params.userId = "user";
    mocks.issues.currentView = view;
    renderToStaticMarkup(<View type={EIssuesStoreType.PROFILE} />);
    await mocks.refresh.mock.calls[0][1](() => true);
    expect(mocks.profile.mock.calls[0][2]).toEqual({
      assignees: view === "assigned" ? "user" : undefined,
      created_by: view === "created" ? "user" : undefined,
      subscriber: view === "subscribed" ? "user" : undefined,
    });
  }
);
