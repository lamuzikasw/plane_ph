/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IBlockUpdateData, TIssue, TIssueRelationTypes } from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType, GANTT_TIMELINE_TYPE } from "@plane/types";
import { getDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
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

type TGanttQuickFilter = "all" | "unscheduled" | "overdue" | "dependencies";

const visibleRelationTypes = new Set<TIssueRelationTypes>(["blocking", "blocked_by"]);

const isIssueUnscheduled = (issue: TIssue | undefined) => !!issue && !issue.start_date && !issue.target_date;

const isIssueOverdue = (issue: TIssue | undefined) => {
  const targetDate = getDate(issue?.target_date);
  if (!issue || !targetDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  return targetDate.getTime() < today.getTime();
};

const getIssueDependencyCount = (issue: TIssue | undefined) => {
  const relationCount = Array.isArray(issue?.issue_relation)
    ? issue.issue_relation.filter((relation) => visibleRelationTypes.has(relation.relation_type)).length
    : 0;
  const relatedCount = Array.isArray(issue?.issue_related)
    ? issue.issue_related.filter((relation) => visibleRelationTypes.has(relation.relation_type)).length
    : 0;

  return relationCount + relatedCount;
};

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
  const { getPartialProjectById } = useProject();
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  const [quickFilter, setQuickFilter] = useState<TGanttQuickFilter>("all");
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

  const allIssueIds = useMemo(() => (issues.groupedIssueIds?.[ALL_ISSUES] as string[]) ?? [], [issues.groupedIssueIds]);
  const issuesIds = useMemo(() => {
    const issueIds = [...allIssueIds];

    if (storeType === EIssuesStoreType.GLOBAL) {
      issueIds.sort((firstIssueId, secondIssueId) => {
        const firstIssue = getIssueById(firstIssueId);
        const secondIssue = getIssueById(secondIssueId);
        const firstProject = getPartialProjectById(firstIssue?.project_id);
        const secondProject = getPartialProjectById(secondIssue?.project_id);
        const projectCompare = (firstProject?.name ?? "").localeCompare(secondProject?.name ?? "");

        if (projectCompare !== 0) return projectCompare;
        return (firstIssue?.sequence_id ?? 0) - (secondIssue?.sequence_id ?? 0);
      });
    }

    return issueIds.filter((issueId) => {
      const issue = getIssueById(issueId);

      if (quickFilter === "unscheduled") return isIssueUnscheduled(issue);
      if (quickFilter === "overdue") return isIssueOverdue(issue);
      if (quickFilter === "dependencies") return getIssueDependencyCount(issue) > 0;
      return true;
    });
  }, [allIssueIds, getIssueById, getPartialProjectById, quickFilter, storeType]);
  const ganttStats = useMemo(() => {
    const stats = {
      all: allIssueIds.length,
      unscheduled: 0,
      overdue: 0,
      dependencies: 0,
    };

    allIssueIds.forEach((issueId) => {
      const issue = getIssueById(issueId);
      if (isIssueUnscheduled(issue)) stats.unscheduled += 1;
      if (isIssueOverdue(issue)) stats.overdue += 1;
      if (getIssueDependencyCount(issue) > 0) stats.dependencies += 1;
    });

    return stats;
  }, [allIssueIds, getIssueById]);
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

  const exportGanttPng = useCallback(() => {
    const issueRows = issuesIds
      .map((issueId) => getIssueById(issueId))
      .filter((issue): issue is TIssue => !!issue && (!!issue.start_date || !!issue.target_date));

    if (issueRows.length === 0) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: "There are no scheduled work items to export.",
      });
      return;
    }

    const dates = issueRows.flatMap((issue) => [getDate(issue.start_date), getDate(issue.target_date)]).filter(Boolean);
    const minDate = new Date(Math.min(...dates.map((date) => date!.getTime())));
    const maxDate = new Date(Math.max(...dates.map((date) => date!.getTime())));
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(0, 0, 0, 0);

    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / dayMs) + 1);
    const rowHeight = 34;
    const sidebarWidth = 320;
    const dayWidth = 26;
    const headerHeight = 52;
    const width = Math.min(6000, sidebarWidth + days * dayWidth + 40);
    const height = headerHeight + issueRows.length * rowHeight + 32;
    const canvas = document.createElement("canvas");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#111827";
    ctx.font = "600 18px Inter, sans-serif";
    ctx.fillText("Plane Gantt export", 20, 30);
    ctx.font = "12px Inter, sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`${issueRows.length} work items`, 20, 48);

    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const x = sidebarWidth + dayIndex * dayWidth;
      ctx.strokeStyle = dayIndex % 7 === 0 ? "#d1d5db" : "#eef0f3";
      ctx.beginPath();
      ctx.moveTo(x, headerHeight);
      ctx.lineTo(x, height - 16);
      ctx.stroke();
    }

    issueRows.forEach((issue, index) => {
      const y = headerHeight + index * rowHeight;
      const startDate = getDate(issue.start_date) ?? getDate(issue.target_date);
      const rowTargetDate = getDate(issue.target_date) ?? getDate(issue.start_date);
      if (!startDate || !rowTargetDate) return;

      const startOffset = Math.max(0, Math.round((startDate.getTime() - minDate.getTime()) / dayMs));
      const duration = Math.max(1, Math.round((rowTargetDate.getTime() - startDate.getTime()) / dayMs) + 1);
      const x = sidebarWidth + startOffset * dayWidth;
      const barWidth = Math.max(18, duration * dayWidth - 4);

      ctx.fillStyle = index % 2 === 0 ? "#f9fafb" : "#ffffff";
      ctx.fillRect(0, y, width, rowHeight);
      ctx.fillStyle = "#111827";
      ctx.font = "13px Inter, sans-serif";
      ctx.fillText(issue.name ?? "", 20, y + 22, sidebarWidth - 36);
      ctx.fillStyle = isIssueOverdue(issue) ? "#ef4444" : "#93c5fd";
      ctx.fillRect(x, y + 8, barWidth, 18);
      ctx.fillStyle = "#111827";
      ctx.fillText(issue.name ?? "", x + 8, y + 22, Math.max(80, barWidth - 12));
    });

    const link = document.createElement("a");
    link.download = "plane-gantt.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [getIssueById, issuesIds, t]);

  const printGanttPdf = useCallback(() => {
    window.print();
  }, []);

  const headerActions = (
    <>
      {(["all", "unscheduled", "overdue", "dependencies"] as TGanttQuickFilter[]).map((filter) => {
        const label =
          filter === "all"
            ? `All ${ganttStats.all}`
            : filter === "unscheduled"
              ? `No dates ${ganttStats.unscheduled}`
              : filter === "overdue"
                ? `Overdue ${ganttStats.overdue}`
                : `Dependencies ${ganttStats.dependencies}`;

        return (
          <button
            key={filter}
            type="button"
            className={`rounded-md px-2 py-1 text-11 font-medium ${
              quickFilter === filter
                ? "bg-accent-primary text-white"
                : "bg-layer-transparent text-secondary hover:bg-layer-transparent-hover"
            }`}
            onClick={() => setQuickFilter(filter)}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        className="rounded-md bg-layer-transparent px-2 py-1 text-11 font-medium text-secondary hover:bg-layer-transparent-hover"
        onClick={exportGanttPng}
      >
        PNG
      </button>
      <button
        type="button"
        className="rounded-md bg-layer-transparent px-2 py-1 text-11 font-medium text-secondary hover:bg-layer-transparent-hover"
        onClick={printGanttPdf}
      >
        PDF
      </button>
    </>
  );

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
        <div className="h-full w-full">
          <GanttChartRoot
            border={false}
            headerActions={headerActions}
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
