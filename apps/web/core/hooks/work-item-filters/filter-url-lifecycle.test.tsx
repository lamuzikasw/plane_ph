// @vitest-environment jsdom
import React, { act, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { observer } from "mobx-react";
import { runInAction } from "mobx";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { WorkItemFilterStore } from "@plane/shared-state";
import { EIssuesStoreType, LOGICAL_OPERATOR, type TWorkItemFilterExpression } from "@plane/types";
import { CycleIssuesFilter } from "@/store/issue/cycle/filter.store";
import type { IIssueRootStore } from "@/store/issue/root.store";
import { useWorkItemFilterUrl } from "./use-work-item-filter-url";

let instances: WorkItemFilterStore;
let preferences: CycleIssuesFilter;
let root: ReturnType<typeof createRoot>;
const save = vi.fn().mockResolvedValue({});
vi.mock("@/hooks/store/work-item-filters/use-work-item-filters", () => ({
  useWorkItemFilters: () => instances,
}));
vi.mock("@/hooks/work-item-filters/use-work-item-filters-config", () => ({
  useWorkItemFiltersConfig: () => ({ areAllConfigsInitialized: true, configs: [] }),
}));
import { WorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/base";

const Board = observer(function Board() {
  const location = useLocation();
  const filters = preferences.getIssueFilters("cycle")!;
  const onChange = useCallback(
    (expression: TWorkItemFilterExpression) =>
      preferences.updateFilterExpression("workspace", "project", "cycle", expression),
    []
  );
  const onRouteChange = useCallback(
    (expression: TWorkItemFilterExpression | undefined, refetch = true) =>
      preferences.setTemporaryFilterExpression("workspace", "project", "cycle", expression, refetch),
    []
  );
  const { updateFilters, isReady } = useWorkItemFilterUrl({
    ready: true,
    savedFilters: preferences.filters.cycle.richFilters,
    activeFilters: filters.richFilters,
    filter: instances.getFilter(EIssuesStoreType.CYCLE, "cycle"),
    onChange,
    onRouteChange,
  });
  return (
    <>
      <output>{location.search}</output>
      {isReady && (
        <WorkItemFiltersHOC
          entityType={EIssuesStoreType.CYCLE}
          entityId="cycle"
          workspaceSlug="workspace"
          filtersToShowByLayout={[]}
          initialWorkItemFilters={filters}
          updateFilters={updateFilters}
          saveViewOptions={{ onViewSave: () => undefined }}
        >
          {({ filter }) => (
            <>
              <button
                onClick={() => {
                  filter!.addCondition(
                    LOGICAL_OPERATOR.AND,
                    { property: "label_id", operator: "in", value: [] },
                    false
                  );
                  filter!.toggleVisibility(true);
                }}
              >
                add
              </button>
              <button onClick={() => filter!.updateConditionValue(filter!.allConditions[0].id, ["label-a"])}>
                select
              </button>
              <button onClick={() => void filter!.clearFilters()}>clear</button>
            </>
          )}
        </WorkItemFiltersHOC>
      )}
    </>
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  instances = new WorkItemFilterStore();
  preferences = new CycleIssuesFilter({
    cycleIssues: { fetchIssuesWithExistingPagination: vi.fn().mockResolvedValue(undefined) },
  } as unknown as IIssueRootStore);
  preferences.issueFilterService.patchCycleIssueFilters = save;
  runInAction(() => {
    preferences.filters.cycle = {
      richFilters: {},
      displayFilters: undefined,
      displayProperties: undefined,
      kanbanFilters: undefined,
    };
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

it("adds, selects and clears a condition through the mounted cycle filter HOC", async () => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/workspace/projects/project/cycles/cycle/?filters=%7B%7D"]}>
        <Board />
      </MemoryRouter>
    )
  );
  await act(async () => document.querySelectorAll("button")[0].click());
  await act(async () => document.querySelectorAll("button")[1].click());
  expect(preferences.getIssueFilters("cycle")?.richFilters).toEqual({ label_id__in: "label-a" });
  expect(new URLSearchParams(document.querySelector("output")!.textContent!).get("filters")).toBe(
    JSON.stringify({ label_id__in: "label-a" })
  );
  await act(async () => document.querySelectorAll("button")[2].click());
  expect(preferences.getIssueFilters("cycle")?.richFilters).toEqual({});
  expect(save).not.toHaveBeenCalled();
});
