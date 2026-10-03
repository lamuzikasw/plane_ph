// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, forwardRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TIssue } from "@plane/types";
import { IssueProperties } from "../properties/all-properties";
import { KanbanIssueBlock } from "./block";
import type { IKanBan } from "./default";
import { CycleKanBanLayout } from "./roots/cycle-root";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  role: 15,
  inlineEditing: true,
  completed: true,
  archivedIssue: false,
  archivedProject: false,
  swimlanes: false,
  allowPermissions: vi.fn(),
  addCycleToIssue: vi.fn(),
  removeCycleFromIssue: vi.fn(),
  updateIssue: vi.fn(),
  toast: vi.fn(),
  draggable: vi.fn(),
}));

const issue = {
  id: "issue-1",
  project_id: "project-1",
  cycle_id: "completed-cycle",
  state_id: "state-1",
  name: "Move only this work item",
  priority: "high",
  sequence_id: 1,
  assignee_ids: [],
  label_ids: [],
  module_ids: [],
} as unknown as TIssue;
const visibleProperties = { cycle: true, state: true, priority: true };
const renderCards = (props: IKanBan) => (
  <KanbanIssueBlock
    issueId={issue.id}
    groupId="state-1"
    subGroupId="null"
    issuesMap={{ [issue.id]: { ...issue, archived_at: mocks.archivedIssue ? "2026-10-03T10:00:00Z" : null } }}
    displayProperties={visibleProperties}
    draggableId={issue.id}
    canDropOverIssue
    canDragIssuesInCurrentGrouping
    updateIssue={props.updateIssue}
    quickActions={props.quickActions}
    canEditProperties={props.canEditProperties}
    canChangeCycle={props.canChangeCycle}
  />
);

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceSlug: "demo", projectId: "project-1", cycleId: "completed-cycle" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/hooks", () => ({ useOutsideClickDetector: () => {} }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error", WARNING: "warning" }, setToast: mocks.toast }));
vi.mock("@plane/propel/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@plane/ui", () => ({
  ControlLink: forwardRef<HTMLDivElement, { children: ReactNode }>(function MockLink({ children }, ref) {
    return <div ref={ref}>{children}</div>;
  }),
  DropIndicator: () => null,
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({ combine: () => () => {} }));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: mocks.draggable,
  dropTargetForElements: () => () => {},
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-auto-scroll/element", () => ({ autoScrollForElements: () => () => {} }));
vi.mock("@/hooks/store/use-cycle", () => ({
  useCycle: () => ({ currentProjectCompletedCycleIds: mocks.completed ? ["completed-cycle"] : [] }),
}));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ allowPermissions: mocks.allowPermissions }) }));
vi.mock("@/hooks/store/use-issues", () => ({
  useIssues: () => ({
    issueMap: {},
    issues: {
      viewFlags: { enableInlineEditing: mocks.inlineEditing, enableQuickAdd: true, enableIssueCreation: true },
      groupedIssueIds: {},
      getGroupIssueCount: () => 1,
      getIssueLoader: () => undefined,
      addCycleToIssue: mocks.addCycleToIssue,
      removeCycleFromIssue: mocks.removeCycleFromIssue,
      changeModulesInIssue: vi.fn(),
    },
    issuesFilter: {
      issueFilters: {
        displayFilters: { group_by: "state", sub_group_by: mocks.swimlanes ? "priority" : null },
        displayProperties: visibleProperties,
      },
    },
  }),
}));
vi.mock("@/hooks/use-issue-layout-store", () => ({ useIssueStoreType: () => "CYCLE" }));
vi.mock("@/hooks/use-issues-actions", () => ({
  useIssuesActions: () => ({
    fetchIssues: vi.fn(),
    fetchNextIssues: vi.fn(),
    quickAddIssue: vi.fn(),
    updateIssue: mocks.updateIssue,
    removeIssue: vi.fn(),
    removeIssueFromView: vi.fn(),
    archiveIssue: vi.fn(),
    restoreIssue: vi.fn(),
    updateFilters: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-group-dragndrop", () => ({ useGroupIssuesDragNDrop: () => vi.fn() }));
vi.mock("@/hooks/store/use-kanban-view", () => ({
  useKanbanView: () => ({ isDragging: false, setIsDragging: vi.fn() }),
}));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({ issue: { getIssueById: () => issue }, getIsIssuePeeked: () => false }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    getProjectIdentifierById: () => "DEV",
    getProjectById: () => ({
      identifier: "DEV",
      cycle_view: true,
      module_view: false,
      archived_at: mocks.archivedProject ? "2026-10-03T10:00:00Z" : null,
    }),
  }),
}));
vi.mock("@/hooks/store/use-project-state", () => ({
  useProjectState: () => ({ getStateById: () => ({ group: "started" }) }),
}));
vi.mock("@/hooks/store/use-label", () => ({ useLabel: () => ({ labelMap: {} }) }));
vi.mock("@/hooks/store/estimates", () => ({
  useProjectEstimates: () => ({ areEstimateEnabledByProjectId: () => false }),
}));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/hooks/use-issue-peek-overview-redirection", () => ({ default: () => ({ handleRedirection: vi.fn() }) }));
vi.mock("@/services/issue", () => ({
  IssueService: class {
    bulkArchiveIssues = vi.fn();
  },
}));
vi.mock("@/components/core/render-if-visible-HOC", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/brand/payholder-brand-theme", () => ({ isPayholderBrandPreviewProject: () => false }));
vi.mock("@/plane-web/components/issues/issue-details/issue-identifier", () => ({ IssueIdentifier: () => null }));
vi.mock("@/plane-web/components/issues/issue-layouts/issue-stats", () => ({ IssueStats: () => null }));
vi.mock("@/plane-web/components/issues/issue-layouts/additional-properties", () => ({
  WorkItemLayoutAdditionalProperties: () => null,
}));
vi.mock("../../delete-issue-modal", () => ({ DeleteIssueModal: () => null }));
vi.mock("../issue-layout-HOC", () => ({ IssueLayoutHOC: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../quick-action-dropdowns", () => ({
  CycleIssueQuickActions: ({ readOnly }: { readOnly: boolean }) => (
    <button data-testid="quick-actions" disabled={readOnly}>
      Actions
    </button>
  ),
}));
vi.mock("../utils", () => ({
  getSourceFromDropPayload: () => null,
  HIGHLIGHT_CLASS: "highlight",
  getIssueBlockId: () => "card",
}));
vi.mock("./default", () => ({ KanBan: (props: IKanBan) => renderCards(props) }));
vi.mock("./swimlanes", () => ({ KanBanSwimLanes: (props: IKanBan) => renderCards(props) }));
vi.mock("../properties/comment-count", () => ({ IssueCommentCount: () => null }));
vi.mock("../properties/labels", () => ({ IssuePropertyLabels: () => null }));
vi.mock("@/components/dropdowns/cycle", () => ({
  CycleDropdown: ({ disabled, onChange }: { disabled: boolean; onChange: (value: string | null) => void }) => (
    <>
      <button data-testid="cycle" disabled={disabled} onClick={() => onChange("upcoming-cycle")}>
        Cycle
      </button>
      <button data-testid="remove-cycle" disabled={disabled} onClick={() => onChange(null)}>
        No cycle
      </button>
    </>
  ),
}));
vi.mock("@/components/dropdowns/state/dropdown", () => ({
  StateDropdown: ({ disabled }: { disabled: boolean }) => (
    <button data-testid="state" disabled={disabled}>
      State
    </button>
  ),
}));
vi.mock("@/components/dropdowns/priority", () => ({
  PriorityDropdown: ({ disabled }: { disabled: boolean }) => (
    <button data-testid="priority" disabled={disabled}>
      Priority
    </button>
  ),
}));
vi.mock("@/components/dropdowns/date", () => ({ DateDropdown: () => null }));
vi.mock("@/components/dropdowns/date-range", () => ({ DateRangeDropdown: () => null }));
vi.mock("@/components/dropdowns/estimate", () => ({ EstimateDropdown: () => null }));
vi.mock("@/components/dropdowns/member/dropdown", () => ({ MemberDropdown: () => null }));
vi.mock("@/components/dropdowns/module/dropdown", () => ({ ModuleDropdown: () => null }));

describe("moving a Kanban card out of a completed cycle", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks, {
      role: 15,
      inlineEditing: true,
      completed: true,
      archivedIssue: false,
      archivedProject: false,
      swimlanes: false,
    });
    mocks.allowPermissions.mockImplementation((roles: number[]) => roles.includes(mocks.role));
    mocks.addCycleToIssue.mockResolvedValue(undefined);
    mocks.removeCycleFromIssue.mockResolvedValue(undefined);
    mocks.draggable.mockReturnValue(() => {});
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it.each([
    { role: 15, swimlanes: false },
    { role: 15, swimlanes: true },
    { role: 20, swimlanes: false },
    { role: 20, swimlanes: true },
  ])(
    "moves only the selected work item while other properties and dragging remain locked (role=$role, swimlanes=$swimlanes)",
    async ({ role, swimlanes }) => {
      mocks.role = role;
      mocks.swimlanes = swimlanes;
      await act(async () => root.render(<CycleKanBanLayout />));
      expect(button("cycle").disabled).toBe(false);
      expect(button("state").disabled).toBe(true);
      expect(button("priority").disabled).toBe(true);
      expect(button("quick-actions").disabled).toBe(true);
      expect(mocks.draggable.mock.calls.at(-1)?.[0].canDrag()).toBe(false);
      await act(async () => button("cycle").click());
      expect(mocks.addCycleToIssue).toHaveBeenCalledExactlyOnceWith("demo", "project-1", "upcoming-cycle", "issue-1");
      expect(mocks.updateIssue).not.toHaveBeenCalled();
      expect(mocks.removeCycleFromIssue).not.toHaveBeenCalled();
      expect(mocks.allowPermissions).toHaveBeenCalledWith([20, 15], "PROJECT", "demo", "project-1");
    }
  );

  it.each(["guest", "inline editing disabled", "archived issue", "archived project"])(
    "does not enable moving when %s",
    async (reason) => {
      if (reason === "guest") mocks.role = 5;
      if (reason === "inline editing disabled") mocks.inlineEditing = false;
      if (reason === "archived issue") mocks.archivedIssue = true;
      if (reason === "archived project") mocks.archivedProject = true;
      await act(async () => root.render(<CycleKanBanLayout />));
      expect(button("cycle").disabled).toBe(true);
      await act(async () => button("cycle").click());
      expect(mocks.addCycleToIssue).not.toHaveBeenCalled();
    }
  );

  it("waits for the single transfer, prevents repeated clicks and shows API failures", async () => {
    let reject!: (reason: Error) => void;
    mocks.addCycleToIssue.mockReturnValue(
      new Promise<void>((_, no) => {
        reject = no;
      })
    );
    await act(async () => root.render(<CycleKanBanLayout />));
    await act(async () => {
      button("cycle").click();
      button("cycle").click();
    });
    expect(button("cycle").disabled).toBe(true);
    expect(mocks.addCycleToIssue).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Server rejected transfer")));
    expect(button("cycle").disabled).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "common.error.label",
      message: "issue.add.cycle.failed",
    });
  });

  it("removes only this work item from its cycle through the existing operation", async () => {
    await act(async () => root.render(<CycleKanBanLayout />));
    await act(async () => button("remove-cycle").click());
    expect(mocks.removeCycleFromIssue).toHaveBeenCalledExactlyOnceWith("demo", "project-1", "issue-1");
    expect(mocks.addCycleToIssue).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves the read-only default when no cycle exception is provided (readonly=%s)",
    async (readOnly) => {
      await act(async () =>
        root.render(
          <IssueProperties
            issue={issue}
            updateIssue={mocks.updateIssue}
            displayProperties={visibleProperties}
            isReadOnly={readOnly}
            className=""
            activeLayout="Kanban"
          />
        )
      );
      expect(button("cycle").disabled).toBe(readOnly);
      expect(button("state").disabled).toBe(readOnly);
    }
  );

  it("keeps the usual editing capabilities for an active cycle", async () => {
    mocks.completed = false;
    await act(async () => root.render(<CycleKanBanLayout />));
    expect(button("cycle").disabled).toBe(false);
    expect(button("state").disabled).toBe(false);
    expect(button("priority").disabled).toBe(false);
    expect(button("quick-actions").disabled).toBe(false);
    expect(mocks.draggable.mock.calls.at(-1)?.[0].canDrag()).toBe(true);
  });
});
