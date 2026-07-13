/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { resolveWorkspaceIssueLayout, shouldGanttFetchIssues } from "./layout-loading";

describe("workspace Timeline loading", () => {
  it("opens the Timeline immediately when the route requests it", () => {
    expect(resolveWorkspaceIssueLayout(EIssueLayoutTypes.SPREADSHEET, EIssueLayoutTypes.GANTT)).toBe(
      EIssueLayoutTypes.GANTT
    );
    expect(resolveWorkspaceIssueLayout(undefined, EIssueLayoutTypes.GANTT)).toBe(EIssueLayoutTypes.GANTT);
  });

  it("uses the saved layout when the route does not request the Timeline", () => {
    expect(resolveWorkspaceIssueLayout(EIssueLayoutTypes.KANBAN, null)).toBe(EIssueLayoutTypes.KANBAN);
  });

  it("does not request global issues a second time from the Gantt component", () => {
    expect(shouldGanttFetchIssues(EIssuesStoreType.GLOBAL)).toBe(false);
    expect(shouldGanttFetchIssues(EIssuesStoreType.PROJECT)).toBe(true);
  });
});
