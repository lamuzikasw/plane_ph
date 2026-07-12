/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

const getPathD = (startX: number, startY: number, pointerX: number, pointerY: number) => {
  const isForward = startX <= pointerX;
  const direction = isForward ? 1 : -1;
  const curve = Math.max(32, Math.min(120, Math.abs(pointerX - startX) / 2));

  return `M ${startX} ${startY} C ${startX + direction * curve} ${startY}, ${pointerX - direction * curve} ${pointerY}, ${pointerX} ${pointerY}`;
};

export const TimelineDraggablePath = observer(function TimelineDraggablePath() {
  const { dependencyDrag } = useTimeLineChartStore();

  if (!dependencyDrag) return null;

  return (
    <svg className="pointer-events-none absolute top-0 left-0 z-[30] overflow-visible" width="100%" height="100%">
      <defs>
        <marker
          id="gantt-drag-dependency-arrow"
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
      <path
        d={getPathD(dependencyDrag.startX, dependencyDrag.startY, dependencyDrag.pointerX, dependencyDrag.pointerY)}
        className="stroke-accent-primary"
        fill="none"
        markerEnd="url(#gantt-drag-dependency-arrow)"
        strokeDasharray="5 4"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
});
