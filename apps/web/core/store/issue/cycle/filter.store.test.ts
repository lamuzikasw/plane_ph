import { runInAction } from "mobx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EIssueFilterType } from "@plane/constants";
import { EIssueLayoutTypes } from "@plane/types";
import type { IIssueRootStore } from "../root.store";
import { CycleIssuesFilter } from "./filter.store";

const personal = { priority__in: "low" };
const shared = { label_id__in: "label-a,label-b" };
let store: CycleIssuesFilter;
const fetchIssues = vi.fn().mockResolvedValue(undefined);
const savePreferences = vi.fn().mockResolvedValue({});

beforeEach(() => {
  vi.clearAllMocks();
  store = new CycleIssuesFilter({
    cycleIssues: { fetchIssuesWithExistingPagination: fetchIssues },
  } as unknown as IIssueRootStore);
  store.issueFilterService.patchCycleIssueFilters = savePreferences;
  runInAction(() => {
    const defaults = { displayFilters: undefined, displayProperties: undefined, kanbanFilters: undefined };
    store.filters.cycle = {
      ...defaults,
      richFilters: personal,
      displayFilters: { layout: EIssueLayoutTypes.KANBAN },
    };
    store.filters.other = { ...defaults, richFilters: { priority__in: "urgent" } };
  });
});

describe("temporary cycle filters", () => {
  it("uses shared filters in issue requests without changing saved preferences or another cycle", () => {
    store.setTemporaryFilterExpression("workspace", "project", "cycle", shared);
    expect(JSON.parse(store.getAppliedFilters("cycle")!.filters as string)).toEqual(shared);
    expect(store.filters.cycle.richFilters).toEqual(personal);
    expect(store.getIssueFilters("other")?.richFilters).toEqual({ priority__in: "urgent" });
    expect(fetchIssues).toHaveBeenCalledExactlyOnceWith("workspace", "project", "mutation", "cycle");
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("keeps edits and clear-all temporary, and restores personal request filters", async () => {
    store.setTemporaryFilterExpression("workspace", "project", "cycle", shared);
    await store.updateFilterExpression("workspace", "project", "cycle", {});
    expect(JSON.parse(store.getAppliedFilters("cycle")!.filters as string)).toEqual({});
    expect(store.filters.cycle.richFilters).toEqual(personal);
    store.setTemporaryFilterExpression("workspace", "project", "cycle", undefined);
    expect(JSON.parse(store.getAppliedFilters("cycle")!.filters as string)).toEqual(personal);
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("preserves the override during preference revalidation and restores the latest personal filters", async () => {
    store.setTemporaryFilterExpression("workspace", "project", "cycle", shared);
    const updatedPersonal = { priority__in: "high" };
    vi.spyOn(store.issueFilterService, "fetchCycleIssueFilters").mockResolvedValue({
      rich_filters: updatedPersonal,
      display_filters: {},
      display_properties: {},
    } as never);
    await store.fetchFilters("workspace", "project", "cycle");
    expect(store.getIssueFilters("cycle")?.richFilters).toEqual(shared);
    store.setTemporaryFilterExpression("workspace", "project", "cycle", undefined);
    expect(store.getIssueFilters("cycle")?.richFilters).toEqual(updatedPersonal);
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("does not include temporary filters when saving display preferences", async () => {
    store.setTemporaryFilterExpression("workspace", "project", "cycle", shared);
    await store.updateFilters("workspace", "project", EIssueFilterType.DISPLAY_PROPERTIES, { priority: true }, "cycle");
    expect(savePreferences).toHaveBeenCalledExactlyOnceWith("workspace", "project", "cycle", {
      display_properties: { priority: true },
    });
    expect(store.filters.cycle.richFilters).toEqual(personal);
  });

  it("continues to persist normal filter edits after the override is removed", async () => {
    store.setTemporaryFilterExpression("workspace", "project", "cycle", shared);
    store.setTemporaryFilterExpression("workspace", "project", "cycle", undefined, false);
    await store.updateFilterExpression("workspace", "project", "cycle", {});
    expect(store.filters.cycle.richFilters).toEqual({});
    expect(savePreferences).toHaveBeenCalledExactlyOnceWith("workspace", "project", "cycle", { rich_filters: {} });
  });
});
