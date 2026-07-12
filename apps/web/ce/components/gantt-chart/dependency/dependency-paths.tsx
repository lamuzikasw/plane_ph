/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { IGanttBlock, TIssueRelationTypes } from "@plane/types";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
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

const getIssueRelations = (block: IGanttBlock): TRelation[] => {
  const relation = Array.isArray(block.data?.issue_relation) ? block.data.issue_relation : [];
  const related = Array.isArray(block.data?.issue_related) ? block.data.issue_related : [];

  return [...relation, ...related].filter((item): item is TRelation => !!item?.id && !!item?.relation_type);
};

const getDependencyPaths = (
  blockIds: string[] | undefined,
  blocksMap: Record<string, IGanttBlock>
): TDependencyPath[] => {
  if (!blockIds?.length) return [];

  const visibleBlockIds = new Set(blockIds);
  const renderedPathIds = new Set<string>();
  const paths: TDependencyPath[] = [];

  blockIds.forEach((blockId, blockIndex) => {
    const block = blocksMap[blockId];
    if (!block?.position) return;

    getIssueRelations(block).forEach((relation) => {
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

const getPathD = (path: TDependencyPath) => {
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

  return `M ${sourceX} ${sourceY} C ${sourceX + direction * curve} ${sourceY}, ${targetX - direction * curve} ${targetY}, ${targetX} ${targetY}`;
};

export const TimelineDependencyPaths = observer(function TimelineDependencyPaths(_props: Props) {
  const { blockIds, blocksMap } = useTimeLineChartStore();
  const dependencyPaths = getDependencyPaths(blockIds, blocksMap);

  if (!dependencyPaths.length || !blockIds?.length) return null;

  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 z-[4] overflow-visible"
      height={blockIds.length * BLOCK_HEIGHT}
      width="100%"
      aria-hidden="true"
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
          <path d="M 0 0 L 8 4 L 0 8 z" className="fill-accent-primary" />
        </marker>
      </defs>
      {dependencyPaths.map((path) => (
        <path
          key={path.id}
          d={getPathD(path)}
          className="stroke-accent-primary/65"
          fill="none"
          markerEnd="url(#gantt-dependency-arrow)"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
});
