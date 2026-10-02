// @vitest-environment jsdom
import React, { act, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { observer } from "mobx-react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EIssueFilterType, type TSupportedFilterTypeForUpdate } from "@plane/constants";
import type { TSupportedFilterForUpdate, TWorkItemFilterExpression } from "@plane/types";
import {
  getWorkItemDisplaySettings,
  withWorkItemDisplaySettings,
  type TWorkItemDisplaySettings,
} from "@/helpers/work-item-display-settings";
import { withWorkItemFilters } from "@/helpers/work-item-filter-url";
import { ProjectIssuesFilter } from "@/store/issue/project/filter.store";
import { CycleIssuesFilter } from "@/store/issue/cycle/filter.store";
import type { IIssueRootStore } from "@/store/issue/root.store";
import { useWorkItemFilterUrl } from "./use-work-item-filter-url";

const personal = getWorkItemDisplaySettings({
  displayFilters: { layout: "list", group_by: "priority" },
  displayProperties: { assignee: false },
});
const shared = getWorkItemDisplaySettings({
  displayFilters: {
    layout: "kanban",
    group_by: "assignees",
    sub_group_by: "state",
    order_by: "-created_at",
    show_empty_groups: true,
  },
  displayProperties: { key: false, priority: false },
});
const richFilters = { priority__in: "high,urgent" };
let root: ReturnType<typeof createRoot>;
let navigate: ReturnType<typeof useNavigate>;
let store: ProjectIssuesFilter | CycleIssuesFilter;
let changeDisplay: (type: TSupportedFilterTypeForUpdate, settings: TSupportedFilterForUpdate) => Promise<void>;
let changeFilters: (expression: TWorkItemFilterExpression) => Promise<void>;
const persist = vi.fn().mockResolvedValue({});
const fetchIssues = vi.fn().mockResolvedValue(undefined);
const clearIssues = vi.fn();

const Board = observer(function Board({ loaded }: { loaded: boolean }) {
  const location = useLocation();
  navigate = useNavigate();
  const entity = location.pathname.split("/")[1];
  const active = store.getIssueFilters(entity);
  const onChange = useCallback(
    (expression: TWorkItemFilterExpression) =>
      store instanceof CycleIssuesFilter
        ? store.updateFilterExpression("workspace", "project", entity, expression)
        : store.updateFilterExpression("workspace", entity, expression),
    [entity]
  );
  const onRouteChange = useCallback(
    (expression: TWorkItemFilterExpression | undefined, refetch = true) =>
      store instanceof CycleIssuesFilter
        ? store.setTemporaryFilterExpression("workspace", "project", entity, expression, refetch)
        : store.setTemporaryFilterExpression("workspace", entity, expression, refetch),
    [entity]
  );
  const onRouteDisplayChange = useCallback(
    (settings: TWorkItemDisplaySettings | undefined, refetch = true) =>
      store instanceof CycleIssuesFilter
        ? store.setTemporaryDisplaySettings("workspace", "project", entity, settings, refetch)
        : store.setTemporaryDisplaySettings("workspace", entity, settings, refetch),
    [entity]
  );
  const { updateFilters, isReady } = useWorkItemFilterUrl({
    ready: loaded,
    savedFilters: store.filters[entity]?.richFilters,
    activeFilters: active?.richFilters,
    savedDisplaySettings: getWorkItemDisplaySettings(store.filters[entity]),
    activeDisplaySettings: getWorkItemDisplaySettings(active),
    onRouteDisplayChange,
    onChange,
    onRouteChange,
    filter: undefined,
  });
  changeFilters = updateFilters;
  // The real header writes straight to the issue store, outside the filter HOC.
  changeDisplay = (type, settings) =>
    store instanceof CycleIssuesFilter
      ? store.updateFilters("workspace", "project", type, settings, entity)
      : store.updateFilters("workspace", entity, type, settings);
  return (
    <>
      <output data-testid="url">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      {isReady && <output data-testid="display">{JSON.stringify(getWorkItemDisplaySettings(active))}</output>}
    </>
  );
});

async function render(initialUrl: string, loaded = true) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initialUrl]}>
        <Board loaded={loaded} />
      </MemoryRouter>
    )
  );
}
function url() {
  return new URL(document.querySelector('[data-testid="url"]')!.textContent!, "https://plane.test");
}
function display() {
  return JSON.parse(document.querySelector('[data-testid="display"]')!.textContent!);
}
function sharedUrl(settings = shared, path = "/board/issues/") {
  return path + withWorkItemDisplaySettings(withWorkItemFilters("?peek=issue", richFilters), settings) + "#anchor";
}

describe.each(["project", "cycle"])("%s display URL lifecycle", (kind) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const rootStore = {
      projectIssues: { fetchIssuesWithExistingPagination: fetchIssues, clear: clearIssues },
      cycleIssues: { fetchIssuesWithExistingPagination: fetchIssues, clear: clearIssues },
    } as unknown as IIssueRootStore;
    store = kind === "cycle" ? new CycleIssuesFilter(rootStore) : new ProjectIssuesFilter(rootStore);
    if (store instanceof CycleIssuesFilter) store.issueFilterService.patchCycleIssueFilters = persist;
    else store.projectService.updateProjectUserProperties = persist;
    runInAction(() => {
      store.filters.board = { ...personal, richFilters: {}, kanbanFilters: undefined };
      store.filters.other = { ...getWorkItemDisplaySettings(), richFilters: {}, kanbanFilters: undefined };
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("waits for saved preferences then restores the full shared view and request parameters without persisting it", async () => {
    await render(sharedUrl(), false);
    expect(document.querySelector('[data-testid="display"]')).toBeNull();
    await render(sharedUrl());
    expect(display()).toEqual(shared);
    expect(store.getAppliedFilters("board")).toMatchObject({
      group_by: "assignees__id",
      sub_group_by: "state_id",
      order_by: "-created_at",
      filters: JSON.stringify(richFilters),
    });
    expect(store.filters.board.displayFilters).toEqual(personal.displayFilters);
    expect(persist).not.toHaveBeenCalled();
  });

  it("shares saved settings and keeps simultaneous header and rich-filter edits in the URL", async () => {
    await render("/board/issues/?peek=issue#anchor");
    expect(JSON.parse(url().searchParams.get("display")!)).toEqual(personal);
    expect(persist).not.toHaveBeenCalled();
    await act(async () => {
      await changeDisplay(EIssueFilterType.DISPLAY_FILTERS, shared.displayFilters);
      await changeDisplay(EIssueFilterType.DISPLAY_PROPERTIES, shared.displayProperties);
      await changeFilters(richFilters);
    });
    expect(JSON.parse(url().searchParams.get("display")!)).toEqual(shared);
    expect(JSON.parse(url().searchParams.get("filters")!)).toEqual(richFilters);
    expect(url().searchParams.get("peek")).toBe("issue");
    expect(url().hash).toBe("#anchor");
    expect(persist).toHaveBeenCalledTimes(3);
  });

  it("reopens the generated link with a different recipient's preferences", async () => {
    await render("/board/issues/");
    await act(async () => {
      await changeDisplay(EIssueFilterType.DISPLAY_FILTERS, shared.displayFilters);
      await changeDisplay(EIssueFilterType.DISPLAY_PROPERTIES, shared.displayProperties);
    });
    const link = url().pathname + url().search;
    await act(async () => root.render(null));
    await act(async () =>
      runInAction(() => {
        store.filters.board = { ...personal, richFilters: { priority__in: "low" }, kanbanFilters: undefined };
      })
    );
    persist.mockClear();
    await render(link);
    expect(display()).toEqual(shared);
    expect(store.getIssueFilters("board")?.richFilters).toEqual({});
    expect(store.filters.board.displayFilters).toEqual(personal.displayFilters);
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps edits to a shared view temporary and restores personal settings on the ordinary URL", async () => {
    await render(sharedUrl());
    await act(async () => {
      await changeDisplay(EIssueFilterType.DISPLAY_FILTERS, { layout: "list", group_by: null, order_by: "priority" });
      await changeDisplay(EIssueFilterType.DISPLAY_PROPERTIES, { assignee: false, key: true });
      await changeFilters({});
    });
    expect(display().displayFilters).toMatchObject({
      layout: "list",
      group_by: null,
      sub_group_by: null,
      order_by: "priority",
    });
    expect(JSON.parse(url().searchParams.get("display")!)).toEqual(display());
    expect(store.filters.board.displayFilters).toEqual(personal.displayFilters);
    expect(store.filters.board.displayProperties).toEqual(personal.displayProperties);
    await act(async () => navigate("/board/issues/"));
    expect(display()).toEqual(personal);
    expect(store.temporaryDisplaySettings.has("board")).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("restores view-only navigation, browser back, another board and cleanup", async () => {
    await render(sharedUrl());
    const changed = getWorkItemDisplaySettings({
      displayFilters: { layout: "calendar" },
      displayProperties: { labels: false },
    });
    await act(async () => navigate(sharedUrl(changed)));
    expect(display()).toEqual(changed);
    await act(async () => navigate(-1));
    expect(display()).toEqual(shared);
    await act(async () => navigate("/other/issues/"));
    expect(display()).toEqual(getWorkItemDisplaySettings());
    expect(store.temporaryDisplaySettings.has("board")).toBe(false);
    await act(async () => navigate(-1));
    expect(display()).toEqual(shared);
    await act(async () => root.render(null));
    expect(store.temporaryDisplaySettings.size).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps shared display settings during preference revalidation", async () => {
    await render(sharedUrl());
    await act(async () =>
      runInAction(() => {
        store.filters.board.displayFilters = { layout: "spreadsheet", order_by: "target_date" };
      })
    );
    expect(display()).toEqual(shared);
    await act(async () => navigate("/board/issues/"));
    expect(display().displayFilters).toMatchObject({ layout: "spreadsheet", order_by: "target_date" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("retains legacy layout links and lets the user subsequently change layout", async () => {
    await render("/board/issues/?layout=gantt_chart");
    expect(display().displayFilters.layout).toBe("gantt_chart");
    await act(async () => changeDisplay(EIssueFilterType.DISPLAY_FILTERS, { layout: "kanban" }));
    expect(url().searchParams.get("layout")).toBe("kanban");
    expect(JSON.parse(url().searchParams.get("display")!).displayFilters.layout).toBe("kanban");
    expect(persist).not.toHaveBeenCalled();
  });

  it("ignores malformed display parameters while still applying valid rich filters", async () => {
    await render("/board/issues/" + withWorkItemFilters("?display=broken", richFilters));
    expect(display()).toEqual(personal);
    expect(store.getIssueFilters("board")?.richFilters).toEqual(richFilters);
    expect(persist).not.toHaveBeenCalled();
  });
});
