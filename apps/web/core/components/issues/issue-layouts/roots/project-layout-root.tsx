/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useCallback } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane constants
import { ISSUE_DISPLAY_FILTERS_BY_PAGE, PROJECT_VIEW_TRACKER_ELEMENTS } from "@plane/constants";
import { EIssueLayoutTypes, EIssuesStoreType, type TWorkItemFilterExpression } from "@plane/types";
import { Spinner } from "@plane/ui";
// components
import { ProjectLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/project-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useWorkItemFilters } from "@/hooks/store/work-item-filters/use-work-item-filters";
import { useWorkItemFilterUrl } from "@/hooks/work-item-filters/use-work-item-filter-url";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
import { getWorkItemDisplaySettings, type TWorkItemDisplaySettings } from "@/helpers/work-item-display-settings";
import { useSharedBoardLink } from "@/hooks/work-item-filters/use-shared-board-link";
// local imports
import { IssuePeekOverview } from "../../peek-overview";
import { CalendarLayout } from "../calendar/roots/project-root";
import { BaseGanttRoot } from "../gantt";
import { KanBanLayout } from "../kanban/roots/project-root";
import { ListLayout } from "../list/roots/project-root";
import { ProjectSpreadsheetLayout } from "../spreadsheet/roots/project-root";
import { AddExistingIssue } from "../add-existing-issue";

function ProjectIssueLayout(props: { activeLayout: EIssueLayoutTypes | undefined }) {
  switch (props.activeLayout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayout />;
    case EIssueLayoutTypes.KANBAN:
      return <KanBanLayout />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayout />;
    case EIssueLayoutTypes.GANTT:
      return <BaseGanttRoot />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <ProjectSpreadsheetLayout />;
    default:
      return null;
  }
}

export const ProjectLayoutRoot = observer(function ProjectLayoutRoot() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // hooks
  const { issues, issuesFilter } = useIssues(EIssuesStoreType.PROJECT);
  const { getFilter } = useWorkItemFilters();
  // derived values
  const workItemFilters = projectId ? issuesFilter?.getIssueFilters(projectId) : undefined;
  const activeLayout = workItemFilters?.displayFilters?.layout;
  const { isLoading } = useSWR(
    workspaceSlug && projectId ? `PROJECT_ISSUES_${workspaceSlug}_${projectId}` : null,
    async () => {
      if (workspaceSlug && projectId) {
        await issuesFilter?.fetchFilters(workspaceSlug, projectId);
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const onFiltersChange = useCallback(
    async (expression: TWorkItemFilterExpression) => {
      if (workspaceSlug && projectId) {
        await issuesFilter?.updateFilterExpression(workspaceSlug, projectId, expression);
      }
    },
    [issuesFilter, workspaceSlug, projectId]
  );
  const onRouteFiltersChange = useCallback(
    (expression: TWorkItemFilterExpression | undefined, refetch = true) => {
      if (workspaceSlug && projectId) {
        issuesFilter.setTemporaryFilterExpression(workspaceSlug, projectId, expression, refetch);
      }
    },
    [issuesFilter, workspaceSlug, projectId]
  );
  const onRouteDisplayChange = useCallback(
    (settings: TWorkItemDisplaySettings | undefined, refetch = true) => {
      if (workspaceSlug && projectId) {
        issuesFilter.setTemporaryDisplaySettings(workspaceSlug, projectId, settings, refetch);
      }
    },
    [issuesFilter, workspaceSlug, projectId]
  );
  const sharedBoard = useSharedBoardLink();
  const { updateFilters, isReady } = useWorkItemFilterUrl({
    sharedLink: sharedBoard.link,
    ready: !isLoading && !!workItemFilters && sharedBoard.ready,
    savedFilters: projectId ? issuesFilter.filters[projectId]?.richFilters : undefined,
    activeFilters: workItemFilters?.richFilters,
    savedDisplaySettings: getWorkItemDisplaySettings(projectId ? issuesFilter.filters[projectId] : undefined),
    activeDisplaySettings: getWorkItemDisplaySettings(workItemFilters),
    onRouteDisplayChange,
    filter: projectId ? getFilter(EIssuesStoreType.PROJECT, projectId) : undefined,
    onChange: onFiltersChange,
    onRouteChange: onRouteFiltersChange,
  });

  if (sharedBoard.error)
    return (
      <p role="alert" className="p-6">
        Ссылка недоступна. Проверьте доступ к проекту или обновите страницу.
      </p>
    );
  if (!workspaceSlug || !projectId || !workItemFilters || !isReady) return <></>;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.PROJECT}>
      <ProjectLevelWorkItemFiltersHOC
        enableSaveView
        entityType={EIssuesStoreType.PROJECT}
        entityId={projectId}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters}
        initialWorkItemFilters={workItemFilters}
        updateFilters={updateFilters}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: projectWorkItemsFilter }) => (
          <div className="relative flex h-full w-full flex-col overflow-hidden">
            <AddExistingIssue
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              onAdded={() => issues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation")}
            />
            {projectWorkItemsFilter && (
              <WorkItemFiltersRow
                filter={projectWorkItemsFilter}
                trackerElements={{
                  saveView: PROJECT_VIEW_TRACKER_ELEMENTS.PROJECT_HEADER_SAVE_AS_VIEW_BUTTON,
                }}
              />
            )}
            <div className="relative h-full w-full overflow-auto bg-surface-1">
              {/* mutation loader */}
              {issues?.getIssueLoader() === "mutation" && (
                <div className="shadow-sm fixed top-[70px] right-[20px] z-50 flex h-[40px] w-[40px] items-center justify-center rounded-sm bg-layer-1">
                  <Spinner className="h-4 w-4" />
                </div>
              )}
              <ProjectIssueLayout activeLayout={activeLayout} />
            </div>
            {/* peek overview */}
            <IssuePeekOverview />
          </div>
        )}
      </ProjectLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
