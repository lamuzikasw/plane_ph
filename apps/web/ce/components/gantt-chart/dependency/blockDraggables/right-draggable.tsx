/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { IGanttBlock } from "@plane/types";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { usePlatformOS } from "@/hooks/use-platform-os";

type RightDependencyDraggableProps = {
  block: IGanttBlock;
  ganttContainerRef: RefObject<HTMLDivElement>;
  side?: "left" | "right";
};

const getChartPoint = (event: MouseEvent | ReactMouseEvent) => {
  const chartContent = document.querySelector("[data-gantt-chart-content]");
  const rect = chartContent?.getBoundingClientRect();

  if (!rect) return { x: 0, y: 0 };

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const getDropTargetBlockId = (event: MouseEvent) => {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const target = element?.closest("[data-gantt-dependency-target]") as HTMLElement | null;

  return target?.dataset.ganttBlockId;
};

export function RightDependencyDraggable(props: RightDependencyDraggableProps) {
  const { block, side = "right" } = props;
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { dependencyDrag, endDependencyDrag, startDependencyDrag, updateActiveBlockId, updateDependencyDrag } =
    useTimeLineChartStore();
  const {
    relation: { createCurrentRelation, getRelationByIssueIdRelationType },
  } = useIssueDetail();
  const isDraggingRef = useRef(false);

  const createDependency = useCallback(
    async (targetBlockId: string | undefined) => {
      if (!targetBlockId || targetBlockId === block.id) return;

      const existingBlockingRelations = getRelationByIssueIdRelationType(block.id, "blocking") ?? [];
      if (existingBlockingRelations.includes(targetBlockId)) return;

      try {
        await createCurrentRelation(block.id, "blocking", targetBlockId);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("toast.success"),
          message: "Dependency created",
        });
      } catch {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: "Failed to create dependency",
        });
      }
    },
    [block.id, createCurrentRelation, getRelationByIssueIdRelationType, t]
  );

  useEffect(() => {
    if (!isDraggingRef.current) return;

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const point = getChartPoint(event);
      updateDependencyDrag(point.x, point.y);
    };

    const handleMouseUp = async (event: MouseEvent) => {
      event.preventDefault();
      isDraggingRef.current = false;
      const targetBlockId = getDropTargetBlockId(event);

      endDependencyDrag();
      updateActiveBlockId(null);
      await createDependency(targetBlockId);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [createDependency, endDependencyDrag, updateActiveBlockId, updateDependencyDrag, dependencyDrag]);

  const handleMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const point = getChartPoint(event);
    isDraggingRef.current = true;
    updateActiveBlockId(block.id);
    startDependencyDrag(block.id, point.x, point.y);
  };

  const isCurrentDragSource = dependencyDrag?.sourceBlockId === block.id;

  return (
    <Tooltip tooltipContent="Drag to another task to create a dependency" isMobile={isMobile}>
      <button
        type="button"
        aria-label="Create dependency"
        className={cn(
          "border-accent-primary/40 bg-surface-0 shadow-sm absolute top-1/2 z-[30] flex size-4 -translate-y-1/2 items-center justify-center rounded-full border transition",
          "hover:border-accent-primary hover:shadow-md opacity-0 group-hover:opacity-100 hover:scale-110 hover:bg-accent-primary",
          {
            "-left-2": side === "left",
            "-right-2": side === "right",
            "border-accent-primary scale-110 bg-accent-primary opacity-100": isCurrentDragSource,
          }
        )}
        onMouseDown={handleMouseDown}
      >
        <span className="size-1.5 rounded-full bg-accent-primary group-hover:bg-white" />
      </button>
    </Tooltip>
  );
}
