/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";

export function resolveWorkspaceIssueLayout(
  savedLayout: EIssueLayoutTypes | undefined,
  requestedLayout: string | null
): EIssueLayoutTypes | undefined {
  if (requestedLayout === EIssueLayoutTypes.GANTT) return EIssueLayoutTypes.GANTT;

  return savedLayout;
}

export function shouldGanttFetchIssues(storeType: EIssuesStoreType): boolean {
  // The workspace layout root owns the global issues request. Fetching here too
  // makes the Timeline load the same first page twice.
  return storeType !== EIssuesStoreType.GLOBAL;
}
