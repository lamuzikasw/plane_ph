/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// helpers
import { formatDateRange, formatDateTimeRange, getDate, getDateTime } from "@plane/utils";

type Props = {
  startDate: Date | string | null | undefined;
  endDate: Date | string | null | undefined;
  className?: string;
  includeTime?: boolean;
};

/**
 * Formats merged date range display with smart formatting
 * - Single date: "Jan 24, 2025"
 * - Same year, same month: "Jan 24 - 28, 2025"
 * - Same year, different month: "Jan 24 - Feb 6, 2025"
 * - Different year: "Dec 28, 2024 - Jan 4, 2025"
 */
export const MergedDateDisplay = observer(function MergedDateDisplay(props: Props) {
  const { startDate, endDate, className = "", includeTime = false } = props;

  // Parse dates
  const parsedStartDate = includeTime ? getDateTime(startDate) : getDate(startDate);
  const parsedEndDate = includeTime ? getDateTime(endDate) : getDate(endDate);

  const displayText = includeTime
    ? formatDateTimeRange(parsedStartDate, parsedEndDate)
    : formatDateRange(parsedStartDate, parsedEndDate);

  if (!displayText) {
    return null;
  }

  return <span className={className}>{displayText}</span>;
});
