import { runInAction } from "mobx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EIssueFilterType } from "@plane/constants";
import { EIssueLayoutTypes } from "@plane/types";
import type { IIssueRootStore } from "../root.store";
import { ProjectIssuesFilter } from "./filter.store";

const personal = { priority__in: "low" };
const shared = { label_id__in: "label-a,label-b" };
let store: ProjectIssuesFilter;
const fetchIssues = vi.fn().mockResolvedValue(undefined);
const savePreferences = vi.fn().mockResolvedValue({});

beforeEach(() => {
  vi.clearAllMocks();
  store = new ProjectIssuesFilter({
    projectIssues: { fetchIssuesWithExistingPagination: fetchIssues },
  } as unknown as IIssueRootStore);
  store.projectService.updateProjectUserProperties = savePreferences;
  runInAction(() => {
    const defaults = { displayFilters: undefined, displayProperties: undefined, kanbanFilters: undefined };
    store.filters.project = {
      ...defaults,
      richFilters: personal,
      displayFilters: { layout: EIssueLayoutTypes.KANBAN },
    };
    store.filters.other = { ...defaults, richFilters: { priority__in: "urgent" } };
  });
});

describe("temporary project filters", () => {
  it("uses shared filters in issue requests without changing saved preferences or another project", () => {
    store.setTemporaryFilterExpression("workspace", "project", shared);
    expect(JSON.parse(store.getAppliedFilters("project")!.filters as string)).toEqual(shared);
    expect(store.filters.project.richFilters).toEqual(personal);
    expect(store.getIssueFilters("other")?.richFilters).toEqual({ priority__in: "urgent" });
    expect(fetchIssues).toHaveBeenCalledExactlyOnceWith("workspace", "project", "mutation");
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("keeps edits and clear-all temporary, and restores personal request filters", async () => {
    store.setTemporaryFilterExpression("workspace", "project", shared);
    await store.updateFilterExpression("workspace", "project", {});
    expect(JSON.parse(store.getAppliedFilters("project")!.filters as string)).toEqual({});
    expect(store.filters.project.richFilters).toEqual(personal);
    store.setTemporaryFilterExpression("workspace", "project", undefined);
    expect(JSON.parse(store.getAppliedFilters("project")!.filters as string)).toEqual(personal);
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("preserves the override during preference revalidation and restores the latest personal filters", async () => {
    store.setTemporaryFilterExpression("workspace", "project", shared);
    const updatedPersonal = { priority__in: "high" };
    vi.spyOn(store.projectService, "getProjectUserProperties").mockResolvedValue({
      rich_filters: updatedPersonal,
      display_filters: {},
      display_properties: {},
    } as never);
    await store.fetchFilters("workspace", "project");
    expect(store.getIssueFilters("project")?.richFilters).toEqual(shared);
    store.setTemporaryFilterExpression("workspace", "project", undefined);
    expect(store.getIssueFilters("project")?.richFilters).toEqual(updatedPersonal);
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("does not include temporary filters when saving display preferences", async () => {
    store.setTemporaryFilterExpression("workspace", "project", shared);
    await store.updateFilters("workspace", "project", EIssueFilterType.DISPLAY_PROPERTIES, { priority: true });
    expect(savePreferences).toHaveBeenCalledExactlyOnceWith("workspace", "project", {
      display_properties: { priority: true },
    });
    expect(store.filters.project.richFilters).toEqual(personal);
  });

  it("continues to persist normal filter edits after the override is removed", async () => {
    store.setTemporaryFilterExpression("workspace", "project", shared);
    store.setTemporaryFilterExpression("workspace", "project", undefined, false);
    await store.updateFilterExpression("workspace", "project", {});
    expect(store.filters.project.richFilters).toEqual({});
    expect(savePreferences).toHaveBeenCalledExactlyOnceWith("workspace", "project", { rich_filters: {} });
  });
});
