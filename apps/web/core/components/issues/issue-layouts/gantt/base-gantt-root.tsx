/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IBlockUpdateData, TIssue } from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
import { useBulkOperationStatus } from "@/hooks/use-bulk-operation-status";
// local imports
import { IssueLayoutHOC } from "../issue-layout-HOC";
import { GanttQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import { IssueGanttBlock } from "./blocks";

interface IBaseGanttRoot {
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}

export type GanttStoreType =
  | EIssuesStoreType.GLOBAL
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC;

export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter } = useIssues(storeType);
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const appliedDisplayFilters = issuesFilter.issueFilters?.displayFilters;
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();
  // derived values
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  useEffect(() => {
    initGantt();
  }, [initGantt]);

  const issuesIds = (issues.groupedIssueIds?.[ALL_ISSUES] as string[]) ?? [];
  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  const { enableIssueCreation } = issues?.viewFlags || {};
  const isWorkspaceLevel = storeType === EIssuesStoreType.GLOBAL;

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

  const updateIssueBlockStructure = async (issue: TIssue, data: IBlockUpdateData) => {
    if (!workspaceSlug) return;

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    if (updateIssue) await updateIssue(issue.project_id, issue.id, payload);
  };

  const canEditProject = useCallback(
    (targetProjectId: string | undefined | null) => {
      if (!targetProjectId) return false;

      return allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.PROJECT,
        workspaceSlug?.toString(),
        targetProjectId
      );
    },
    [allowPermissions, workspaceSlug]
  );

  const isAllowed = projectId ? canEditProject(projectId.toString()) : false;
  const canEditBlock = useCallback(
    (blockId: string) => {
      const issue = getIssueById(blockId);
      return canEditProject(issue?.project_id);
    },
    [canEditProject, getIssueById]
  );
  const updateBlockDates = useCallback(
    async (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) => {
      if (!workspaceSlug) return;

      const updatesByProjectId = updates.reduce<Record<string, typeof updates>>((acc, update) => {
        const updateProjectId = projectId?.toString() ?? getIssueById(update.id)?.project_id;
        if (!updateProjectId) return acc;

        acc[updateProjectId] = [...(acc[updateProjectId] ?? []), update];
        return acc;
      }, {});

      await Promise.all(
        Object.entries(updatesByProjectId).map(([updateProjectId, projectUpdates]) =>
          issues.updateIssueDates(workspaceSlug.toString(), projectUpdates, updateProjectId)
        )
      ).catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: "Error while updating work item dates, Please try again Later",
        });
      });
    },
    [getIssueById, issues, projectId, t, workspaceSlug]
  );

  const quickAdd =
    enableIssueCreation && isAllowed && !isCompletedCycle && !isWorkspaceLevel ? (
      <QuickAddIssueRoot
        layout={EIssueLayoutTypes.GANTT}
        QuickAddButton={GanttQuickAddIssueButton}
        containerClassName="sticky bottom-0 z-[1]"
        prePopulatedData={{
          start_date: renderFormattedPayloadDate(new Date()),
          target_date: renderFormattedPayloadDate(targetDate),
        }}
        quickAddCallback={quickAddIssue}
        isEpic={isEpic}
      />
    ) : undefined;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
        <div className="h-full w-full">
          <GanttChartRoot
            border={false}
            title={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
            loaderTitle={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
            blockIds={issuesIds}
            blockUpdateHandler={updateIssueBlockStructure}
            blockToRender={(data: TIssue) => <IssueGanttBlock issueId={data.id} isEpic={isEpic} />}
            sidebarToRender={(sidebarProps) => <IssueGanttSidebar {...sidebarProps} showAllBlocks isEpic={isEpic} />}
            enableBlockLeftResize={isWorkspaceLevel ? canEditBlock : isAllowed}
            enableBlockRightResize={isWorkspaceLevel ? canEditBlock : isAllowed}
            enableBlockMove={isWorkspaceLevel ? canEditBlock : isAllowed}
            enableReorder={!isWorkspaceLevel && appliedDisplayFilters?.order_by === "sort_order" && isAllowed}
            enableAddBlock={!isWorkspaceLevel && isAllowed}
            enableSelection={!isWorkspaceLevel && isBulkOperationsEnabled && isAllowed}
            quickAdd={quickAdd}
            loadMoreBlocks={loadMoreIssues}
            canLoadMoreBlocks={nextPageResults}
            updateBlockDates={updateBlockDates}
            showAllBlocks
            enableDependency
            isEpic={isEpic}
          />
        </div>
      </TimeLineTypeContext.Provider>
    </IssueLayoutHOC>
  );
});
