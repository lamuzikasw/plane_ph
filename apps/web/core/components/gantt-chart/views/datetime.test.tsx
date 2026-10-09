/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ChartDataType, IGanttBlock } from "@plane/types";
import { getLocalCalendarDate } from "@plane/utils";
import { getDateFromPositionOnGantt, getItemPositionWidth, getPositionFromDate } from "./helpers";
import { IssueStartDateActivity } from "@/components/issues/issue-detail/issue-activity/activity/actions/start_date";
import { IssueTargetDateActivity } from "@/components/issues/issue-detail/issue-activity/activity/actions/target_date";

vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    activity: {
      getActivityById: (id: string) => ({
        new_value: id === "legacy" ? "2026-10-12" : new Date(2026, 9, 12, 0, 0).toISOString(),
      }),
    },
  }),
}));
vi.mock("@/components/issues/issue-detail/issue-activity/activity/actions", () => ({
  IssueActivityBlockComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  IssueLink: () => null,
}));

const chart = (startDate = new Date(2026, 9, 11, 12)): ChartDataType => ({
  key: "week",
  i18n_title: "week",
  data: {
    startDate,
    currentDate: new Date(startDate),
    endDate: new Date(2026, 10, 30),
    approxFilterRange: 7,
    dayWidth: 40,
  },
});
const block = (start: Date | string, target: Date | string): IGanttBlock => ({
  id: "issue",
  name: "Work item",
  data: {},
  sort_order: 1,
  start_date: typeof start === "string" ? start : start.toISOString(),
  target_date: typeof target === "string" ? target : target.toISOString(),
});

describe("timeline calendar days", () => {
  it("places Monday midnight on Monday and retains the inclusive end day", () => {
    const data = chart();
    const item = block(new Date(2026, 9, 12, 0, 0), new Date(2026, 9, 13, 23, 59));
    expect(getItemPositionWidth(data, item)).toEqual({ marginLeft: 40, width: 80 });
    expect(getPositionFromDate(data, item.start_date!, 0)).toBe(40);
    expect(getDateFromPositionOnGantt(40, data)).toEqual(new Date(2026, 9, 12, 12));
    expect(data.data.startDate).toEqual(new Date(2026, 9, 11, 12));
  });

  it("keeps old date-only values on the same calendar days", () => {
    expect(getItemPositionWidth(chart(), block("2026-10-12", "2026-10-13"))).toEqual({ marginLeft: 40, width: 80 });
  });

  it("counts columns by calendar days across daylight saving transitions", () => {
    expect(
      getItemPositionWidth(chart(new Date(2026, 9, 30)), block(new Date(2026, 9, 31), new Date(2026, 10, 2)))
    ).toEqual({ marginLeft: 40, width: 120 });
    expect(
      getItemPositionWidth(chart(new Date(2026, 2, 7)), block(new Date(2026, 2, 8), new Date(2026, 2, 9)))
    ).toEqual({ marginLeft: 40, width: 80 });
  });

  it("normalizes a local day without mutating a Date supplied by the caller", () => {
    const value = new Date(2026, 9, 12, 18, 30);
    expect(getLocalCalendarDate(value)).toEqual(new Date(2026, 9, 12));
    expect(value).toEqual(new Date(2026, 9, 12, 18, 30));
    expect(getLocalCalendarDate("2026-10-12")).toEqual(new Date(2026, 9, 12));
    expect(getLocalCalendarDate(null)).toBeUndefined();
    expect(getLocalCalendarDate("not-a-date")).toBeUndefined();
  });
});

describe("work item date activity", () => {
  it.each(["timestamp", "legacy"])(
    "shows the selected day for start and due date activity (%s)",
    async (activityId) => {
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      const element = document.createElement("div");
      const root = createRoot(element);
      try {
        await act(async () =>
          root.render(
            <>
              <IssueStartDateActivity activityId={activityId} showIssue={false} ends={undefined} />
              <IssueTargetDateActivity activityId={activityId} showIssue={false} ends={undefined} />
            </>
          )
        );
        expect(element.textContent).toBe("set the start date to Oct 12, 2026.set the due date to Oct 12, 2026.");
      } finally {
        await act(async () => root.unmount());
      }
    }
  );
});
