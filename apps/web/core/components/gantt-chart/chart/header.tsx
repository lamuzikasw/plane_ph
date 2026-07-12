/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { Expand, Minus, Plus, Shrink } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// plane
import type { TGanttViews } from "@plane/types";
import { Row } from "@plane/ui";
// components
import { cn } from "@plane/utils";
import { MAX_TIMELINE_SCALE, MIN_TIMELINE_SCALE, TIMELINE_SCALE_STEP, VIEWS_LIST } from "@/components/gantt-chart/data";
// helpers
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
//
import { GANTT_BREADCRUMBS_HEIGHT } from "../constants";

type Props = {
  actions?: ReactNode;
  blockIds: string[];
  fullScreenMode: boolean;
  handleChartView: (view: TGanttViews) => void;
  handleTimelineScaleChange: (scale: number) => void;
  handleToday: () => void;
  loaderTitle: string;
  toggleFullScreenMode: () => void;
  showToday: boolean;
};

export const GanttChartHeader = observer(function GanttChartHeader(props: Props) {
  const { t } = useTranslation();
  const {
    actions,
    blockIds,
    fullScreenMode,
    handleChartView,
    handleTimelineScaleChange,
    handleToday,
    loaderTitle,
    toggleFullScreenMode,
    showToday,
  } = props;
  // chart hook
  const { currentView, timelineScale } = useTimeLineChartStore();
  const timelineScalePercent = Math.round(timelineScale * 100);
  const minTimelineScalePercent = Math.round(MIN_TIMELINE_SCALE * 100);
  const maxTimelineScalePercent = Math.round(MAX_TIMELINE_SCALE * 100);
  const timelineScaleStepPercent = Math.round(TIMELINE_SCALE_STEP * 100);

  return (
    <Row
      className="relative flex w-full flex-shrink-0 flex-wrap items-center gap-2 bg-surface-1 py-2 whitespace-nowrap"
      style={{ height: `${GANTT_BREADCRUMBS_HEIGHT}px` }}
    >
      <div className="ml-auto">
        <div className="ml-auto text-11 font-medium text-tertiary">
          {blockIds ? `${blockIds.length} ${loaderTitle}` : t("common.loading")}
        </div>
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS_LIST.map((chartView: any) => (
          <button
            key={chartView?.key}
            type="button"
            className={cn(
              "cursor-pointer rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover",
              {
                "bg-layer-transparent-selected": currentView === chartView?.key,
              }
            )}
            onClick={() => handleChartView(chartView?.key)}
          >
            {t(chartView?.i18n_title)}
          </button>
        ))}
      </div>

      {showToday && (
        <button
          type="button"
          className="rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover"
          onClick={handleToday}
        >
          {t("common.today")}
        </button>
      )}

      <div className="flex items-center gap-1 rounded-md border border-subtle bg-layer-transparent px-1 py-0.5 text-11 text-secondary">
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded hover:bg-layer-transparent-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={timelineScale <= MIN_TIMELINE_SCALE}
          aria-label="Сузить даты"
          onClick={() => handleTimelineScaleChange(timelineScale - TIMELINE_SCALE_STEP)}
        >
          <Minus className="size-3" />
        </button>
        <input
          aria-label="Ширина дат"
          className="h-1 w-24 cursor-ew-resize accent-[rgb(var(--color-accent-primary))]"
          max={maxTimelineScalePercent}
          min={minTimelineScalePercent}
          step={timelineScaleStepPercent}
          type="range"
          value={timelineScalePercent}
          onChange={(event) => handleTimelineScaleChange(Number(event.target.value) / 100)}
        />
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded hover:bg-layer-transparent-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={timelineScale >= MAX_TIMELINE_SCALE}
          aria-label="Расширить даты"
          onClick={() => handleTimelineScaleChange(timelineScale + TIMELINE_SCALE_STEP)}
        >
          <Plus className="size-3" />
        </button>
        <span className="min-w-9 text-right text-11 font-medium text-tertiary">{timelineScalePercent}%</span>
      </div>

      <button
        type="button"
        className="flex items-center justify-center rounded-md border border-subtle bg-layer-transparent p-1 transition-all hover:bg-layer-transparent-hover"
        onClick={toggleFullScreenMode}
      >
        {fullScreenMode ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
      </button>
    </Row>
  );
});
