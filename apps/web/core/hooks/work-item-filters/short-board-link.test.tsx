// @vitest-environment jsdom
import React, { act, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { SWRConfig } from "swr";
import { observer } from "mobx-react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EIssueFilterType } from "@plane/constants";
import type { TWorkItemFilterExpression } from "@plane/types";
import { copyUrlToClipboard } from "@plane/utils";
import { CopyBoardLink } from "@/components/work-item-filters/copy-board-link";
import { getWorkItemDisplaySettings, type TWorkItemDisplaySettings } from "@/helpers/work-item-display-settings";
import { boardLinkService, type TBoardLink } from "@/services/board-link.service";
import { ProjectIssuesFilter } from "@/store/issue/project/filter.store";
import type { IIssueRootStore } from "@/store/issue/root.store";
import { useSharedBoardLink } from "./use-shared-board-link";
import { useWorkItemFilterUrl } from "./use-work-item-filter-url";

vi.mock("@plane/propel/toast", () => ({ setToast: vi.fn(), TOAST_TYPE: { SUCCESS: "success", ERROR: "error" } }));
vi.mock("@plane/utils", async (original) => ({
  ...(await original<typeof import("@plane/utils")>()),
  copyUrlToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const project = "985cdf12-cc26-42c6-b3e6-f9bea56b91ca";
const path = `/workspace/projects/${project}/issues/`;
const token = "abcDEF123_-0";
const personal = getWorkItemDisplaySettings();
const link: TBoardLink = {
  token,
  path,
  filters: { priority__in: "high,urgent" },
  display: getWorkItemDisplaySettings({
    displayFilters: { layout: "kanban", group_by: "assignees", sub_group_by: "state" },
    displayProperties: { key: false },
  }),
};
let store: ProjectIssuesFilter;
let root: ReturnType<typeof createRoot>;
let navigate: ReturnType<typeof useNavigate>;
let update: (expression: TWorkItemFilterExpression) => Promise<void>;
const persist = vi.fn().mockResolvedValue({});
const Board = observer(function Board() {
  const location = useLocation();
  navigate = useNavigate();
  const shared = useSharedBoardLink();
  const active = store.getIssueFilters(project)!;
  const onChange = useCallback(
    (expression: TWorkItemFilterExpression) => store.updateFilterExpression("workspace", project, expression),
    []
  );
  const onRouteChange = useCallback(
    (expression: TWorkItemFilterExpression | undefined, refetch = true) =>
      store.setTemporaryFilterExpression("workspace", project, expression, refetch),
    []
  );
  const onRouteDisplayChange = useCallback(
    (settings: TWorkItemDisplaySettings | undefined, refetch = true) =>
      store.setTemporaryDisplaySettings("workspace", project, settings, refetch),
    []
  );
  const { updateFilters, isReady } = useWorkItemFilterUrl({
    ready: shared.ready,
    sharedLink: shared.link,
    savedFilters: store.filters[project].richFilters,
    activeFilters: active.richFilters,
    savedDisplaySettings: personal,
    activeDisplaySettings: getWorkItemDisplaySettings(active),
    filter: undefined,
    onChange,
    onRouteChange,
    onRouteDisplayChange,
  });
  update = updateFilters;
  return (
    <>
      <output>
        {location.pathname}
        {location.search}
      </output>
      {shared.error ? (
        <p role="alert">unavailable</p>
      ) : (
        isReady && (
          <>
            <p data-testid="board">{JSON.stringify(active)}</p>
            <CopyBoardLink filters={active} />
          </>
        )
      )}
    </>
  );
});
async function render(initial = path) {
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/:workspaceSlug/projects/:projectId/issues/" element={<Board />} />
          </Routes>
        </MemoryRouter>
      </SWRConfig>
    )
  );
}
function currentUrl() {
  return new URL(document.querySelector("output")!.textContent!, "https://plane.test");
}
async function copy() {
  await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store = new ProjectIssuesFilter({
    projectIssues: { fetchIssuesWithExistingPagination: vi.fn(), clear: vi.fn() },
  } as unknown as IIssueRootStore);
  store.projectService.updateProjectUserProperties = persist;
  runInAction(() => {
    store.filters[project] = { ...personal, richFilters: {}, kanbanFilters: undefined };
  });
  vi.spyOn(boardLinkService, "retrieve").mockResolvedValue(structuredClone(link));
  vi.spyOn(boardLinkService, "create").mockImplementation(async (_workspace, _project, payload) => ({
    ...structuredClone(link),
    ...payload,
  }));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("short board links", () => {
  it("restores the server snapshot without expanding the URL or changing preferences", async () => {
    await render(`${path}?share=${token}`);
    expect(store.getIssueFilters(project)?.richFilters).toEqual(link.filters);
    expect(store.getIssueFilters(project)?.displayFilters).toEqual(link.display.displayFilters);
    expect(currentUrl().search).toBe(`?share=${token}`);
    expect(store.filters[project].displayFilters).toEqual(personal.displayFilters);
    expect(persist).not.toHaveBeenCalled();
  });
  it("copies /s/token and changes the address to the same saved snapshot", async () => {
    await render();
    await copy();
    expect(boardLinkService.create).toHaveBeenCalledExactlyOnceWith("workspace", project, {
      filters: {},
      display: personal,
    });
    expect(copyUrlToClipboard).toHaveBeenCalledExactlyOnceWith(`s/${token}`);
    expect(currentUrl().search).toBe(`?share=${token}`);
    expect(persist).not.toHaveBeenCalled();
  });
  it("leaves the original short link immutable when the recipient changes filters or display", async () => {
    await render(`${path}?share=${token}`);
    await act(async () => {
      await store.updateFilters("workspace", project, EIssueFilterType.DISPLAY_FILTERS, { group_by: "priority" });
      await update({});
    });
    expect(currentUrl().searchParams.has("share")).toBe(false);
    expect(JSON.parse(currentUrl().searchParams.get("filters")!)).toEqual({});
    await act(async () => navigate(`${path}?share=${token}`));
    expect(store.getIssueFilters(project)?.richFilters).toEqual(link.filters);
    expect(store.getIssueFilters(project)?.displayFilters).toEqual(link.display.displayFilters);
    expect(currentUrl().search).toBe(`?share=${token}`);
    expect(persist).not.toHaveBeenCalled();
  });
  it("does not replace newer edits when a copy request completes late", async () => {
    let resolve!: (data: TBoardLink) => void;
    vi.mocked(boardLinkService.create).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await render();
    await copy();
    await act(async () => update(link.filters));
    await act(async () => resolve({ ...link, filters: {}, display: personal }));
    expect(currentUrl().searchParams.has("share")).toBe(false);
    expect(store.getIssueFilters(project)?.richFilters).toEqual(link.filters);
  });
  it.each(["missing", "wrong-board"])("does not display a misleading board for a %s link", async (failure) => {
    if (failure === "missing") vi.mocked(boardLinkService.retrieve).mockRejectedValueOnce(new Error("404"));
    else vi.mocked(boardLinkService.retrieve).mockResolvedValueOnce({ ...link, path: "/other/issues/" });
    await render(`${path}?share=${token}`);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="board"]')).toBeNull();
    expect(currentUrl().search).toBe(`?share=${token}`);
    expect(persist).not.toHaveBeenCalled();
  });
});
