/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { Popover } from "@plane/propel/popover";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssueRelationTypes } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { ControlLink } from "@plane/ui";
import { cn, findTotalDaysInRange, generateWorkItemLink, getDate } from "@plane/utils";
// components
import { SIDEBAR_WIDTH } from "@/components/gantt-chart/constants";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
// local imports
import { WorkItemPreviewCard } from "../../preview-card";
import { getBlockViewDetails } from "../utils";
import type { GanttStoreType } from "./base-gantt-root";

type Props = {
  issueId: string;
  isEpic?: boolean;
};

const visibleRelationTypes = new Set<TIssueRelationTypes>(["blocking", "blocked_by"]);

const getDependencyCount = (
  issueDetails: any,
  getRelationsByIssueId: (issueId: string) => { [key in TIssueRelationTypes]?: string[] } | undefined
) => {
  const relationsMap = issueDetails?.id ? getRelationsByIssueId(issueDetails.id) : undefined;
  const relationIds = new Set<string>();

  visibleRelationTypes.forEach((relationType) => {
    (relationsMap?.[relationType] ?? []).forEach((issueId) => relationIds.add(`${relationType}:${issueId}`));
  });

  const relationCount = Array.isArray(issueDetails?.issue_relation)
    ? issueDetails.issue_relation.filter((relation: any) => {
        if (!visibleRelationTypes.has(relation.relation_type)) return false;
        relationIds.add(`${relation.relation_type}:${relation.id}`);
        return true;
      }).length
    : 0;
  const relatedCount = Array.isArray(issueDetails?.issue_related)
    ? issueDetails.issue_related.filter((relation: any) => {
        if (!visibleRelationTypes.has(relation.relation_type)) return false;
        relationIds.add(`${relation.relation_type}:${relation.id}`);
        return true;
      }).length
    : 0;

  return Math.max(relationIds.size, relationCount + relatedCount);
};

export const IssueGanttBlock = observer(function IssueGanttBlock(props: Props) {
  const { issueId, isEpic } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const { getProjectStates } = useProjectState();
  const {
    issue: { getIssueById },
    relation: { getRelationsByIssueId },
  } = useIssueDetail();
  // hooks
  const { isMobile } = usePlatformOS();
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const stateDetails =
    issueDetails && getProjectStates(issueDetails?.project_id)?.find((state) => state?.id == issueDetails?.state_id);

  const { blockStyle } = getBlockViewDetails(issueDetails, stateDetails?.color ?? "");

  const handleIssuePeekOverview = () => handleRedirection(workspaceSlug, issueDetails, isMobile);

  const duration = findTotalDaysInRange(issueDetails?.start_date, issueDetails?.target_date) || 0;
  const targetDate = getDate(issueDetails?.target_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate?.setHours(0, 0, 0, 0);
  const isOverdue = !!targetDate && targetDate.getTime() < today.getTime();
  const isMilestone = duration <= 1;
  const dependencyCount = getDependencyCount(issueDetails, getRelationsByIssueId);
  const dependencyLabel = dependencyCount
    ? `${dependencyCount} blocking relation${dependencyCount > 1 ? "s" : ""}`
    : undefined;

  return (
    <Popover delay={100} openOnHover>
      <Popover.Button
        className="w-full"
        render={
          <button
            id={`issue-${issueId}`}
            type="button"
            className={cn(
              "space-between group relative flex h-full w-full cursor-pointer items-center text-left transition-[filter,transform]",
              {
                "rounded-md shadow-[0_1px_2px_rgba(15,23,42,0.10)] hover:brightness-[0.98]": !isMilestone,
                "rounded-none": isMilestone,
                "drop-shadow-[0_0_0_2px_rgba(239,68,68,0.28)]": isOverdue,
              }
            )}
            style={isMilestone ? undefined : blockStyle}
            onClick={handleIssuePeekOverview}
          >
            {isMilestone ? (
              <div
                className={cn(
                  "absolute top-1/2 left-2.5 size-3 -translate-y-1/2 rotate-45 rounded-[2px] border border-white/70 shadow-[0_1px_2px_rgba(15,23,42,0.22)]",
                  {
                    "ring-red-500/30 ring-2": isOverdue,
                  }
                )}
                style={blockStyle}
              />
            ) : (
              <div className="pointer-events-none absolute inset-0 rounded-md bg-gradient-to-r from-white/20 via-white/8 to-transparent" />
            )}
            <div
              className={cn(
                "sticky min-w-0 flex-1 truncate overflow-hidden py-1 text-13 font-medium text-primary",
                isMilestone ? "pr-2 pl-7" : "px-2.5"
              )}
              style={{ left: `${SIDEBAR_WIDTH}px` }}
            >
              {issueDetails?.name}
            </div>
            {dependencyCount > 0 && (
              <Tooltip tooltipContent={dependencyLabel} isMobile={isMobile}>
                <span className="border-accent-primary/25 shadow-sm sticky right-1 mr-1 rounded border bg-surface-1/90 px-1.5 py-0.5 text-[10px] leading-3 font-semibold text-accent-primary">
                  Links {dependencyCount}
                </span>
              </Tooltip>
            )}
            {isEpic && (
              <IssueStats
                issueId={issueId}
                className="sticky mx-2 w-auto flex-shrink-0 justify-end truncate overflow-hidden font-medium text-primary"
                showProgressText={duration >= 2}
              />
            )}
          </button>
        }
      />
      <Popover.Panel side="bottom" align="start">
        <>
          {issueDetails && issueDetails?.project_id && (
            <WorkItemPreviewCard
              projectId={issueDetails.project_id}
              stateDetails={{
                id: issueDetails.state_id ?? undefined,
              }}
              workItem={issueDetails}
            />
          )}
        </>
      </Popover.Panel>
    </Popover>
  );
});

// rendering issues on gantt sidebar
export const IssueGanttSidebarBlock = observer(function IssueGanttSidebarBlock(props: Props) {
  const { issueId, isEpic = false } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const storeType = useIssueStoreType() as GanttStoreType;
  const { issuesFilter } = useIssues(storeType);
  const { getPartialProjectById, getProjectIdentifierById } = useProject();

  // handlers
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const projectIdentifier = getProjectIdentifierById(issueDetails?.project_id);
  const project = getPartialProjectById(issueDetails?.project_id);
  const showProjectName = storeType === EIssuesStoreType.GLOBAL && !!project?.name;

  const handleIssuePeekOverview = (e: any) => {
    e.stopPropagation(true);
    e.preventDefault();
    handleRedirection(workspaceSlug, issueDetails, isMobile);
  };

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issueDetails?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetails?.sequence_id,
    isEpic,
  });

  return (
    <ControlLink
      id={`issue-${issueId}`}
      href={workItemLink}
      onClick={handleIssuePeekOverview}
      className="line-clamp-1 w-full cursor-pointer text-13 text-primary"
      disabled={!!issueDetails?.tempId}
    >
      <div className="relative flex h-full w-full cursor-pointer items-center gap-2">
        {issueDetails?.project_id && (
          <IssueIdentifier
            issueId={issueDetails.id}
            projectId={issueDetails.project_id}
            size="xs"
            variant="tertiary"
            displayProperties={issuesFilter?.issueFilters?.displayProperties}
          />
        )}
        <div className="min-w-0 flex-grow">
          <Tooltip tooltipContent={issueDetails?.name} isMobile={isMobile}>
            <span className="block truncate text-13 font-medium">{issueDetails?.name}</span>
          </Tooltip>
          {showProjectName && <span className="block truncate text-11 text-tertiary">{project.name}</span>}
        </div>
      </div>
    </ControlLink>
  );
});
