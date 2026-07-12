/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { REVERSE_RELATIONS } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IGanttBlock, TIssueRelationTypes } from "@plane/types";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

type Props = {
  isEpic?: boolean;
};

type TRelation = {
  id: string;
  relation_type: TIssueRelationTypes;
};

type TDependencyPath = {
  id: string;
  source: IGanttBlock;
  sourceIndex: number;
  target: IGanttBlock;
  targetIndex: number;
};

type TDependencyPathGeometry = {
  d: string;
  menuX: number;
  menuY: number;
};

const DELETE_ACTION_WIDTH = 112;
const DELETE_ACTION_HEIGHT = 28;

const getIssueRelations = (
  block: IGanttBlock,
  getRelationsByIssueId: (issueId: string) => { [key in TIssueRelationTypes]?: string[] } | undefined
): TRelation[] => {
  const relationsMap = getRelationsByIssueId(block.id);
  const normalizedRelations = relationsMap
    ? (Object.keys(relationsMap) as TIssueRelationTypes[]).flatMap((relationType) =>
        (relationsMap[relationType] ?? []).map((issueId) => ({
          id: issueId,
          relation_type: relationType,
        }))
      )
    : [];

  const directRelations = Array.isArray(block.data?.issue_relation) ? block.data.issue_relation : [];
  const relatedRelations = Array.isArray(block.data?.issue_related)
    ? block.data.issue_related.map((relation: TRelation) => ({
        ...relation,
        relation_type: REVERSE_RELATIONS[relation.relation_type] ?? relation.relation_type,
      }))
    : [];

  const relationIds = new Set<string>();

  return [...normalizedRelations, ...directRelations, ...relatedRelations].filter((item): item is TRelation => {
    if (!item?.id || !item?.relation_type) return false;

    const relationId = `${item.relation_type}:${item.id}`;
    if (relationIds.has(relationId)) return false;

    relationIds.add(relationId);
    return true;
  });
};

const getDependencyPaths = (
  blockIds: string[] | undefined,
  blocksMap: Record<string, IGanttBlock>,
  getRelationsByIssueId: (issueId: string) => { [key in TIssueRelationTypes]?: string[] } | undefined
): TDependencyPath[] => {
  if (!blockIds?.length) return [];

  const visibleBlockIds = new Set(blockIds);
  const renderedPathIds = new Set<string>();
  const paths: TDependencyPath[] = [];

  blockIds.forEach((blockId, blockIndex) => {
    const block = blocksMap[blockId];
    if (!block?.position) return;

    getIssueRelations(block, getRelationsByIssueId).forEach((relation) => {
      const sourceId = relation.relation_type === "blocked_by" ? relation.id : block.id;
      const targetId = relation.relation_type === "blocked_by" ? block.id : relation.id;

      if (sourceId === targetId || !visibleBlockIds.has(sourceId) || !visibleBlockIds.has(targetId)) return;

      const source = blocksMap[sourceId];
      const target = blocksMap[targetId];
      if (!source?.position || !target?.position) return;

      const pathId = `${sourceId}->${targetId}`;
      if (renderedPathIds.has(pathId)) return;

      renderedPathIds.add(pathId);
      paths.push({
        id: pathId,
        source,
        sourceIndex: blockIds.indexOf(sourceId) >= 0 ? blockIds.indexOf(sourceId) : blockIndex,
        target,
        targetIndex: blockIds.indexOf(targetId),
      });
    });
  });

  return paths;
};

const getPathGeometry = (path: TDependencyPath): TDependencyPathGeometry => {
  const sourceCenterX = path.source.position!.marginLeft + path.source.position!.width / 2;
  const targetCenterX = path.target.position!.marginLeft + path.target.position!.width / 2;
  const isForward = sourceCenterX <= targetCenterX;
  const sourceX = isForward
    ? path.source.position!.marginLeft + path.source.position!.width + 3
    : path.source.position!.marginLeft - 3;
  const targetX = isForward
    ? path.target.position!.marginLeft - 3
    : path.target.position!.marginLeft + path.target.position!.width + 3;
  const sourceY = path.sourceIndex * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
  const targetY = path.targetIndex * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
  const direction = isForward ? 1 : -1;
  const curve = Math.max(28, Math.min(96, Math.abs(targetX - sourceX) / 2));

  return {
    d: `M ${sourceX} ${sourceY} C ${sourceX + direction * curve} ${sourceY}, ${targetX - direction * curve} ${targetY}, ${targetX} ${targetY}`,
    menuX: (sourceX + targetX) / 2 - DELETE_ACTION_WIDTH / 2,
    menuY: (sourceY + targetY) / 2 - DELETE_ACTION_HEIGHT / 2,
  };
};

export const TimelineDependencyPaths = observer(function TimelineDependencyPaths(_props: Props) {
  const { workspaceSlug, projectId } = useParams();
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const { blockIds, blocksMap } = useTimeLineChartStore();
  const {
    relation: { getRelationsByIssueId, removeRelation },
  } = useIssueDetail();
  const dependencyPaths = getDependencyPaths(blockIds, blocksMap, getRelationsByIssueId);

  if (!dependencyPaths.length || !blockIds?.length) return null;

  const handleRemoveRelation = async (path: TDependencyPath) => {
    const sourceProjectId = path.source.data?.project_id ?? projectId?.toString();
    const workspace = workspaceSlug?.toString();

    if (!workspace || !sourceProjectId) return;

    try {
      await removeRelation(workspace, sourceProjectId, path.source.id, "blocking", path.target.id);
      setSelectedPathId(null);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Связь удалена",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось удалить связь",
      });
    }
  };

  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 z-[4] overflow-visible"
      height={blockIds.length * BLOCK_HEIGHT}
      width="100%"
    >
      <defs>
        <marker
          id="gantt-dependency-arrow"
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M 1 1 L 7 4 L 1 7 z" className="fill-accent-primary/55" />
        </marker>
        <marker
          id="gantt-dependency-arrow-selected"
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M 1 1 L 7 4 L 1 7 z" className="fill-accent-primary/80" />
        </marker>
      </defs>
      {dependencyPaths.map((path) => {
        const geometry = getPathGeometry(path);
        const isSelected = selectedPathId === path.id;

        return (
          <g key={path.id}>
            <path
              d={geometry.d}
              className={isSelected ? "stroke-accent-primary/80" : "stroke-accent-primary/50"}
              fill="none"
              markerEnd={isSelected ? "url(#gantt-dependency-arrow-selected)" : "url(#gantt-dependency-arrow)"}
              strokeLinecap="round"
              strokeWidth={isSelected ? "1.75" : "1.25"}
            />
            <path
              d={geometry.d}
              className="pointer-events-auto cursor-pointer stroke-transparent"
              fill="none"
              strokeLinecap="round"
              strokeWidth="14"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedPathId(isSelected ? null : path.id);
              }}
            />
            {isSelected && (
              <foreignObject
                className="pointer-events-auto overflow-visible"
                height={DELETE_ACTION_HEIGHT + 4}
                width={DELETE_ACTION_WIDTH + 4}
                x={geometry.menuX}
                y={geometry.menuY}
              >
                <button
                  type="button"
                  className="shadow-sm flex h-7 items-center justify-center rounded border border-strong bg-surface-1 px-2 text-11 font-medium whitespace-nowrap text-secondary transition-colors outline-none hover:bg-surface-2 hover:text-danger-primary focus:bg-surface-2 focus:text-danger-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemoveRelation(path);
                  }}
                >
                  Удалить связь
                </button>
              </foreignObject>
            )}
          </g>
        );
      })}
    </svg>
  );
});
