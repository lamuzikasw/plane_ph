// @vitest-environment jsdom
import React, { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { observer } from "mobx-react";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IWorkItemFilterInstance } from "@plane/shared-state";
import type { TWorkItemFilterExpression } from "@plane/types";
import { withWorkItemFilters } from "@/helpers/work-item-filter-url";
import { ProjectIssuesFilter } from "@/store/issue/project/filter.store";
import { CycleIssuesFilter } from "@/store/issue/cycle/filter.store";
import type { IIssueRootStore } from "@/store/issue/root.store";
import { useWorkItemFilterUrl } from "./use-work-item-filter-url";

const saved = { priority__in: "low" };
const shared = { and: [{ label_id__in: "label-a,label-b" }, { assignee_id__in: "user-a" }] };
const changed = { state_id__in: "state-a,state-b" };
const persist = vi.fn().mockResolvedValue({});
const fetchIssues = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn();
let issueFilters: ProjectIssuesFilter;
let cycleFilters: CycleIssuesFilter;
let root: ReturnType<typeof createRoot>;
let navigate: ReturnType<typeof useNavigate>;

const Board = observer(function Board({ loaded }: { loaded: boolean }) {
  const location = useLocation();
  navigate = useNavigate();
  const cycleId = location.pathname.match(/\/cycles\/([^/]+)/)?.[1];
  const projectId = location.pathname.split("/")[cycleId ? 3 : 1];
  const activeStore = cycleId ? cycleFilters : issueFilters;
  const entityId = cycleId ?? projectId;
  const filters = activeStore.getIssueFilters(entityId)?.richFilters;
  const [instance, setInstance] = useState<IWorkItemFilterInstance>();
  const onChange = useCallback(
    (expression: TWorkItemFilterExpression) =>
      cycleId
        ? cycleFilters.updateFilterExpression("workspace", projectId, cycleId, expression)
        : issueFilters.updateFilterExpression("workspace", projectId, expression),
    [projectId, cycleId]
  );
  const onRouteChange = useCallback(
    (expression: TWorkItemFilterExpression | undefined, refetch = true) =>
      cycleId
        ? cycleFilters.setTemporaryFilterExpression("workspace", projectId, cycleId, expression, refetch)
        : issueFilters.setTemporaryFilterExpression("workspace", projectId, expression, refetch),
    [projectId, cycleId]
  );
  const { updateFilters, isReady } = useWorkItemFilterUrl({
    ready: loaded,
    savedFilters: activeStore.filters[entityId]?.richFilters,
    activeFilters: filters,
    filter: instance,
    onChange,
    onRouteChange,
  });
  // Simulate the HOC creating the instance after the initial URL was applied.
  // Later route changes must update that instance as well as the issue store.
  React.useEffect(() => {
    if (isReady)
      setInstance({
        resetExpression: (expression: TWorkItemFilterExpression) => {
          reset(expression);
          void updateFilters(expression);
        },
      } as IWorkItemFilterInstance);
  }, [isReady, updateFilters]);

  return (
    <>
      <output data-testid="url">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      {isReady && <output data-testid="filters">{JSON.stringify(filters)}</output>}
      <button onClick={() => void updateFilters(changed)}>change</button>
      <button onClick={() => void updateFilters({})}>clear</button>
    </>
  );
});

async function render(url: string, loaded = true) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Board loaded={loaded} />
      </MemoryRouter>
    )
  );
}
function currentFilters() {
  return JSON.parse(document.querySelector('[data-testid="filters"]')!.textContent!);
}
function currentUrl() {
  return new URL(document.querySelector('[data-testid="url"]')!.textContent!, "https://plane.test");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  issueFilters = new ProjectIssuesFilter({
    projectIssues: { fetchIssuesWithExistingPagination: fetchIssues },
  } as unknown as IIssueRootStore);
  issueFilters.projectService.updateProjectUserProperties = persist;
  cycleFilters = new CycleIssuesFilter({
    cycleIssues: { fetchIssuesWithExistingPagination: fetchIssues },
  } as unknown as IIssueRootStore);
  cycleFilters.issueFilterService.patchCycleIssueFilters = persist;
  runInAction(() => {
    const defaults = { displayFilters: undefined, displayProperties: undefined, kanbanFilters: undefined };
    issueFilters.filters.project = { ...defaults, richFilters: saved };
    issueFilters.filters["other-project"] = { ...defaults, richFilters: { priority__in: "urgent" } };
    cycleFilters.filters["cycle-a"] = { ...defaults, richFilters: saved };
    cycleFilters.filters["cycle-b"] = { ...defaults, richFilters: { priority__in: "urgent" } };
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

describe("cycle filter URL synchronization", () => {
  const cycleUrl = "/workspace/projects/project/cycles/cycle-a/";

  it("shares normal cycle selections while preserving the cycle route", async () => {
    await render(cycleUrl);
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(currentUrl().pathname).toBe(cycleUrl);
    expect(JSON.parse(currentUrl().searchParams.get("filters")!)).toEqual(changed);
    expect(persist).toHaveBeenCalledExactlyOnceWith("workspace", "project", "cycle-a", { rich_filters: changed });
  });

  it("keeps shared cycle edits temporary and restores personal filters on the ordinary URL", async () => {
    await render(`${cycleUrl}${withWorkItemFilters("", shared)}`);
    expect(currentFilters()).toEqual(shared);
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(currentFilters()).toEqual(changed);
    await act(async () => document.querySelectorAll("button")[1].click());
    expect(currentFilters()).toEqual({});
    expect(currentUrl().searchParams.get("filters")).toBe("{}");
    await act(async () => navigate(cycleUrl));
    expect(currentFilters()).toEqual(saved);
    expect(reset).toHaveBeenLastCalledWith(saved);
    expect(cycleFilters.filters["cycle-a"].richFilters).toEqual(saved);
    expect(issueFilters.filters.project.richFilters).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });

  it("isolates cycle links and restores them on browser back", async () => {
    await render(`${cycleUrl}${withWorkItemFilters("", shared)}`);
    await act(async () => navigate("/workspace/projects/project/cycles/cycle-b/"));
    expect(currentFilters()).toEqual({ priority__in: "urgent" });
    expect(cycleFilters.getIssueFilters("cycle-a")?.richFilters).toEqual(saved);
    await act(async () => navigate(-1));
    expect(currentFilters()).toEqual(shared);
    await act(async () => root.render(null));
    expect(cycleFilters.getIssueFilters("cycle-a")?.richFilters).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("project filter URL synchronization", () => {
  it("waits for preferences then overrides them with shared filters before displaying the board", async () => {
    const url = `/project/issues/${withWorkItemFilters("?layout=kanban", shared)}#anchor`;
    await render(url, false);
    expect(document.querySelector('[data-testid="filters"]')).toBeNull();
    expect(persist).not.toHaveBeenCalled();
    await render(url);
    expect(currentFilters()).toEqual(shared);
    expect(persist).not.toHaveBeenCalled();
    expect(issueFilters.filters.project.richFilters).toEqual(saved);
    expect(currentUrl().searchParams.get("layout")).toBe("kanban");
    expect(currentUrl().hash).toBe("#anchor");
  });

  it("makes existing saved filters shareable without saving them again", async () => {
    await render("/project/issues/?layout=kanban");
    expect(currentFilters()).toEqual(saved);
    expect(JSON.parse(currentUrl().searchParams.get("filters")!)).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });

  it("updates and clears the URL without duplicating persistence or losing unrelated parameters", async () => {
    await render("/project/issues/?layout=kanban&peek=issue#anchor");
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(currentFilters()).toEqual(changed);
    expect(JSON.parse(currentUrl().searchParams.get("filters")!)).toEqual(changed);
    expect(persist).toHaveBeenCalledTimes(1);
    await act(async () => document.querySelectorAll("button")[1].click());
    expect(currentFilters()).toEqual({});
    expect(currentUrl().searchParams.get("filters")).toBe("{}");
    expect(currentUrl().searchParams.get("peek")).toBe("issue");
    expect(currentUrl().hash).toBe("#anchor");
    expect(persist).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
  });

  it("opens an explicitly empty shared board despite the recipient's saved filters", async () => {
    await render(`/project/issues/${withWorkItemFilters("", {})}`);
    expect(currentFilters()).toEqual({});
    expect(persist).not.toHaveBeenCalled();
    expect(issueFilters.filters.project.richFilters).toEqual(saved);
  });

  it("keeps the final selection when filters change before URL navigation finishes", async () => {
    await render("/project/issues/");
    await act(async () => {
      document.querySelectorAll("button")[0].click();
      document.querySelectorAll("button")[1].click();
    });
    expect(currentFilters()).toEqual({});
    expect(currentUrl().searchParams.get("filters")).toBe("{}");
    expect(persist).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
  });

  it("applies a shared link when navigating to a different project", async () => {
    await render(`/project/issues/${withWorkItemFilters("", shared)}`);
    await act(async () => navigate(`/other-project/issues/${withWorkItemFilters("", changed)}`));
    expect(currentUrl().pathname).toBe("/other-project/issues/");
    expect(currentFilters()).toEqual(changed);
    expect(persist).not.toHaveBeenCalled();
    expect(issueFilters.getIssueFilters("project")?.richFilters).toEqual(saved);
    expect(issueFilters.filters["other-project"].richFilters).toEqual({ priority__in: "urgent" });
  });

  it("restores filters and chips on same-page navigation and browser back/forward", async () => {
    await render(`/project/issues/${withWorkItemFilters("", shared)}`);
    await act(async () => navigate(`/project/issues/${withWorkItemFilters("", changed)}`));
    expect(currentFilters()).toEqual(changed);
    expect(reset).toHaveBeenLastCalledWith(changed);
    await act(async () => navigate(-1));
    expect(currentFilters()).toEqual(shared);
    expect(reset).toHaveBeenLastCalledWith(shared);
    await act(async () => navigate(1));
    expect(currentFilters()).toEqual(changed);
    expect(reset).toHaveBeenLastCalledWith(changed);
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not reapply filters when unrelated URL parameters change", async () => {
    await render(`/project/issues/${withWorkItemFilters("", shared)}`);
    await act(async () => navigate(`/project/issues/${withWorkItemFilters("?peek=issue", shared)}`));
    expect(persist).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("ignores invalid URL filters without clearing saved preferences", async () => {
    await render("/project/issues/?filters=broken");
    expect(currentFilters()).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });

  it("restores personal filters when opening the ordinary board URL", async () => {
    await render(`/project/issues/${withWorkItemFilters("", shared)}`);
    await act(async () => navigate("/project/issues/"));
    expect(currentFilters()).toEqual(saved);
    expect(reset).toHaveBeenLastCalledWith(saved);
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps editing and clearing a shared board temporary, then restores personal filters", async () => {
    await render(`/project/issues/${withWorkItemFilters("", shared)}`);
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(currentFilters()).toEqual(changed);
    expect(JSON.parse(currentUrl().searchParams.get("filters")!)).toEqual(changed);
    await act(async () => document.querySelectorAll("button")[1].click());
    expect(currentFilters()).toEqual({});
    expect(currentUrl().searchParams.get("filters")).toBe("{}");
    expect(issueFilters.filters.project.richFilters).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
    await act(async () => navigate("/project/issues/"));
    expect(currentFilters()).toEqual(saved);
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(persist).toHaveBeenCalledExactlyOnceWith("workspace", "project", { rich_filters: changed });
  });

  it("removes temporary overrides on unmount and reopens the normal board from cached preferences", async () => {
    await render(`/project/issues/${withWorkItemFilters("", shared)}`);
    fetchIssues.mockClear();
    await act(async () => root.render(null));
    expect(issueFilters.getIssueFilters("project")?.richFilters).toEqual(saved);
    expect(fetchIssues).not.toHaveBeenCalled();
    await render("/project/issues/");
    expect(currentFilters()).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps an override temporary even when it initially equals the saved preferences", async () => {
    await render(`/project/issues/${withWorkItemFilters("", saved)}`);
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(currentFilters()).toEqual(changed);
    expect(issueFilters.filters.project.richFilters).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves temporary filters when React replays mount effects", async () => {
    await act(async () =>
      root.render(
        <React.StrictMode>
          <MemoryRouter initialEntries={[`/project/issues/${withWorkItemFilters("", shared)}`]}>
            <Board loaded />
          </MemoryRouter>
        </React.StrictMode>
      )
    );
    expect(currentFilters()).toEqual(shared);
    await act(async () => document.querySelectorAll("button")[0].click());
    expect(currentFilters()).toEqual(changed);
    expect(issueFilters.filters.project.richFilters).toEqual(saved);
    expect(persist).not.toHaveBeenCalled();
  });
});
