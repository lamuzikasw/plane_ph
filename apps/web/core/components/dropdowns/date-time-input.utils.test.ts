/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";

import { applyTimeInputToDate, isValidTimeInput, mergeDateAndTime } from "./date-time-input.utils";

describe("date time input helpers", () => {
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
});
