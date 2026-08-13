/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderFormattedTime } from "@plane/utils";

export type TDefaultTime = "start-of-day" | "end-of-day";

export const getTimeInputValue = (date?: Date): string => (date ? renderFormattedTime(date) : "");

export const getSynchronizedTimeInputValue = (
  currentInputValue: string,
  externalValue: string,
  isFocused: boolean
): string => (isFocused ? currentInputValue : externalValue);

export const isValidTimeInput = (time: string): boolean => {
  const [hours, minutes] = time.split(":").map(Number);

  return (
    /^\d{2}:\d{2}$/.test(time) &&
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  );
};

export const applyTimeInputToDate = (date: Date, time: string): Date | undefined => {
  if (!isValidTimeInput(time)) return undefined;

  const [hours, minutes] = time.split(":").map(Number);
  const updatedDate = new Date(date);
  updatedDate.setHours(hours, minutes, 0, 0);
  return updatedDate;
};

export const mergeDateAndTime = (date: Date, timeSource?: Date, defaultTime: TDefaultTime = "start-of-day"): Date => {
  const updatedDate = new Date(date);
  const defaultHours = defaultTime === "end-of-day" ? 23 : 0;
  const defaultMinutes = defaultTime === "end-of-day" ? 59 : 0;
  updatedDate.setHours(timeSource?.getHours() ?? defaultHours, timeSource?.getMinutes() ?? defaultMinutes, 0, 0);
  return updatedDate;
};

export const isDateTimeRangeChronological = (start?: Date, end?: Date): boolean =>
  !start || !end || end.getTime() >= start.getTime();
