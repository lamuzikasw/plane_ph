/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useState } from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane constants
import { ISSUE_DISPLAY_FILTERS_BY_PAGE, PROJECT_VIEW_TRACKER_ELEMENTS } from "@plane/constants";
import { EIssuesStoreType, EIssueLayoutTypes, type TWorkItemFilterExpression } from "@plane/types";
// components
import { TransferIssues } from "@/components/cycles/transfer-issues";
import { TransferIssuesModal } from "@/components/cycles/transfer-issues-modal";
// hooks
import { ProjectLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/project-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssues } from "@/hooks/store/use-issues";
import { useWorkItemFilters } from "@/hooks/store/work-item-filters/use-work-item-filters";
import { useWorkItemFilterUrl } from "@/hooks/work-item-filters/use-work-item-filter-url";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
import { getWorkItemDisplaySettings, type TWorkItemDisplaySettings } from "@/helpers/work-item-display-settings";
import { useSharedBoardLink } from "@/hooks/work-item-filters/use-shared-board-link";
// local imports
import { IssuePeekOverview } from "../../peek-overview";
import { CycleCalendarLayout } from "../calendar/roots/cycle-root";
import { BaseGanttRoot } from "../gantt";
import { CycleKanBanLayout } from "../kanban/roots/cycle-root";
import { CycleListLayout } from "../list/roots/cycle-root";
import { CycleSpreadsheetLayout } from "../spreadsheet/roots/cycle-root";

function CycleIssueLayout(props: {
  activeLayout: EIssueLayoutTypes | undefined;
  cycleId: string;
  isCompletedCycle: boolean;
}) {
  switch (props.activeLayout) {
    case EIssueLayoutTypes.LIST:
      return <CycleListLayout />;
    case EIssueLayoutTypes.KANBAN:
      return <CycleKanBanLayout />;
    case EIssueLayoutTypes.CALENDAR:
      return <CycleCalendarLayout />;
    case EIssueLayoutTypes.GANTT:
      return <BaseGanttRoot viewId={props.cycleId} isCompletedCycle={props.isCompletedCycle} />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <CycleSpreadsheetLayout />;
    default:
      return null;
  }
}

export const CycleLayoutRoot = observer(function CycleLayoutRoot() {
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId, cycleId: routerCycleId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  const cycleId = routerCycleId ? routerCycleId.toString() : undefined;
  // store hooks
  const { issuesFilter } = useIssues(EIssuesStoreType.CYCLE);
  const { getFilter } = useWorkItemFilters();
  const { getCycleById } = useCycle();
  // state
  const [transferIssuesModal, setTransferIssuesModal] = useState(false);
  // derived values
  const workItemFilters = cycleId ? issuesFilter?.getIssueFilters(cycleId) : undefined;
  const activeLayout = workItemFilters?.displayFilters?.layout;

  const { isLoading } = useSWR(
    workspaceSlug && projectId && cycleId ? `CYCLE_ISSUES_${workspaceSlug}_${projectId}_${cycleId}` : null,
    async () => {
      if (workspaceSlug && projectId && cycleId) {
        await issuesFilter?.fetchFilters(workspaceSlug, projectId, cycleId);
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const onFiltersChange = useCallback(
    async (expression: TWorkItemFilterExpression) => {
      if (workspaceSlug && projectId && cycleId) {
        await issuesFilter.updateFilterExpression(workspaceSlug, projectId, cycleId, expression);
      }
    },
    [issuesFilter, workspaceSlug, projectId, cycleId]
  );
  const onRouteFiltersChange = useCallback(
    (expression: TWorkItemFilterExpression | undefined, refetch = true) => {
      if (workspaceSlug && projectId && cycleId) {
        issuesFilter.setTemporaryFilterExpression(workspaceSlug, projectId, cycleId, expression, refetch);
      }
    },
    [issuesFilter, workspaceSlug, projectId, cycleId]
  );
  const onRouteDisplayChange = useCallback(
    (settings: TWorkItemDisplaySettings | undefined, refetch = true) => {
      if (workspaceSlug && projectId && cycleId) {
        issuesFilter.setTemporaryDisplaySettings(workspaceSlug, projectId, cycleId, settings, refetch);
      }
    },
    [issuesFilter, workspaceSlug, projectId, cycleId]
  );
  const sharedBoard = useSharedBoardLink();
  const { updateFilters, isReady } = useWorkItemFilterUrl({
    sharedLink: sharedBoard.link,
    ready: !isLoading && !!workItemFilters && sharedBoard.ready,
    savedFilters: cycleId ? issuesFilter.filters[cycleId]?.richFilters : undefined,
    activeFilters: workItemFilters?.richFilters,
    savedDisplaySettings: getWorkItemDisplaySettings(cycleId ? issuesFilter.filters[cycleId] : undefined),
    activeDisplaySettings: getWorkItemDisplaySettings(workItemFilters),
    onRouteDisplayChange,
    filter: cycleId ? getFilter(EIssuesStoreType.CYCLE, cycleId) : undefined,
    onChange: onFiltersChange,
    onRouteChange: onRouteFiltersChange,
  });

  const cycleDetails = cycleId ? getCycleById(cycleId) : undefined;
  const cycleStatus = cycleDetails?.status?.toLocaleLowerCase() ?? "draft";
  const isCompletedCycle = cycleStatus === "completed";
  const isProgressSnapshotEmpty = isEmpty(cycleDetails?.progress_snapshot);
  const transferableIssuesCount = cycleDetails
    ? cycleDetails.backlog_issues + cycleDetails.unstarted_issues + cycleDetails.started_issues
    : 0;
  const canTransferIssues = isProgressSnapshotEmpty && transferableIssuesCount > 0;

  if (sharedBoard.error)
    return (
      <p role="alert" className="p-6">
        Ссылка недоступна. Проверьте доступ к проекту или обновите страницу.
      </p>
    );
  if (!workspaceSlug || !projectId || !cycleId || !workItemFilters || !isReady) return <></>;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.CYCLE}>
      <ProjectLevelWorkItemFiltersHOC
        enableSaveView
        entityType={EIssuesStoreType.CYCLE}
        entityId={cycleId}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters}
        initialWorkItemFilters={workItemFilters}
        updateFilters={updateFilters}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: cycleWorkItemsFilter }) => (
          <>
            <TransferIssuesModal
              handleClose={() => setTransferIssuesModal(false)}
              cycleId={cycleId}
              isOpen={transferIssuesModal}
            />
            <div className="relative flex h-full w-full flex-col overflow-hidden">
              {cycleStatus === "completed" && (
                <TransferIssues
                  handleClick={() => setTransferIssuesModal(true)}
                  canTransferIssues={canTransferIssues}
                  disabled={!isEmpty(cycleDetails?.progress_snapshot)}
                />
              )}
              {cycleWorkItemsFilter && (
                <WorkItemFiltersRow
                  filter={cycleWorkItemsFilter}
                  trackerElements={{
                    saveView: PROJECT_VIEW_TRACKER_ELEMENTS.CYCLE_HEADER_SAVE_AS_VIEW_BUTTON,
                  }}
                />
              )}
              <div className="h-full w-full overflow-auto">
                <CycleIssueLayout activeLayout={activeLayout} cycleId={cycleId} isCompletedCycle={isCompletedCycle} />
              </div>
              {/* peek overview */}
              <IssuePeekOverview />
            </div>
          </>
        )}
      </ProjectLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
