/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TGroupedIssues, TSubGroupedIssues } from "@plane/types";

/** Grouping settings can change before the previous request's data is replaced. */
export function getKanbanGroupIssueIds(
  groups: TGroupedIssues | TSubGroupedIssues | undefined,
  groupId: string,
  subGroupId?: string
): string[] {
  const group = groups?.[groupId];
  if (subGroupId && subGroupId !== "null") {
    if (!group || Array.isArray(group)) return [];
    const issueIds = group[subGroupId];
    return Array.isArray(issueIds) ? issueIds : [];
  }
  return Array.isArray(group) ? group : [];
}
