/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { renderFormattedPayloadDateTime } from "@plane/utils";

import {
  applyTimeInputToDate,
  getSynchronizedTimeInputValue,
  isDateTimeRangeChronological,
  isValidTimeInput,
  mergeDateAndTime,
} from "./date-time-input.utils";

describe("date time input helpers", () => {
  it("serializes local date-time values as timezone-aware UTC instants", () => {
    expect(renderFormattedPayloadDateTime("2026-08-20T09:30:00+03:00")).toBe("2026-08-20T06:30:00.000Z");
    expect(renderFormattedPayloadDateTime("2026-08-20T00:00:00+03:00")).toBe("2026-08-19T21:00:00.000Z");
    expect(renderFormattedPayloadDateTime("2026-08-20T23:59:00+03:00")).toBe("2026-08-20T20:59:00.000Z");
  });

  it("preserves the wall-clock value after a Moscow timezone round trip", () => {
    const payload = renderFormattedPayloadDateTime("2026-08-20T09:30:00+03:00");
    const displayedValue = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(payload!));

    expect(displayedValue).toBe("2026-08-20, 09:30");
  });

  it("applies a manually entered 24-hour time without changing the date", () => {
    const original = new Date(2026, 6, 15, 0, 0, 45, 250);

    const result = applyTimeInputToDate(original, "18:30");

    expect(result).toEqual(new Date(2026, 6, 15, 18, 30, 0, 0));
    expect(original).toEqual(new Date(2026, 6, 15, 0, 0, 45, 250));
  });

  it("does not apply an incomplete or invalid time", () => {
    const date = new Date(2026, 6, 15);

    expect(applyTimeInputToDate(date, "18")).toBeUndefined();
    expect(applyTimeInputToDate(date, "24:00")).toBeUndefined();
    expect(isValidTimeInput("18:00")).toBe(true);
  });

  it("preserves the existing time when a calendar date changes", () => {
    const result = mergeDateAndTime(new Date(2026, 6, 20), new Date(2026, 6, 15, 18, 45));

    expect(result).toEqual(new Date(2026, 6, 20, 18, 45, 0, 0));
  });

  it("defaults a newly selected start date to the start of the day", () => {
    expect(mergeDateAndTime(new Date(2026, 7, 13))).toEqual(new Date(2026, 7, 13, 0, 0, 0, 0));
  });

  it("defaults a newly selected due date to the end of the day", () => {
    expect(mergeDateAndTime(new Date(2026, 7, 13), undefined, "end-of-day")).toEqual(
      new Date(2026, 7, 13, 23, 59, 0, 0)
    );
  });

  it("keeps an existing due time when its calendar date changes", () => {
    expect(mergeDateAndTime(new Date(2026, 7, 14), new Date(2026, 7, 13, 17, 20), "end-of-day")).toEqual(
      new Date(2026, 7, 14, 17, 20, 0, 0)
    );
  });

  it("does not create a backwards same-day range when start time is 10:00", () => {
    const start = mergeDateAndTime(new Date(2026, 7, 13), new Date(2026, 7, 13, 10, 0));
    const due = mergeDateAndTime(new Date(2026, 7, 13), undefined, "end-of-day");

    expect(start).toEqual(new Date(2026, 7, 13, 10, 0, 0, 0));
    expect(due).toEqual(new Date(2026, 7, 13, 23, 59, 0, 0));
    expect(due.getTime()).toBeGreaterThanOrEqual(start.getTime());
  });

  it("rejects a due time earlier than the start time on the same day", () => {
    expect(isDateTimeRangeChronological(new Date(2026, 7, 13, 10, 0), new Date(2026, 7, 13, 9, 59))).toBe(false);
    expect(isDateTimeRangeChronological(new Date(2026, 7, 13, 10, 0), new Date(2026, 7, 13, 10, 0))).toBe(true);
  });

  it("accepts any due time on a later calendar day", () => {
    expect(isDateTimeRangeChronological(new Date(2026, 7, 13, 23, 59), new Date(2026, 7, 14, 0, 0))).toBe(true);
  });

  it("does not overwrite a focused native time input during segmented typing", () => {
    expect(getSynchronizedTimeInputValue("18:00", "08:00", true)).toBe("18:00");
    expect(getSynchronizedTimeInputValue("18:00", "08:00", false)).toBe("08:00");
  });
});
