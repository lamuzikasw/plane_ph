/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { getKanbanGroupIssueIds } from "./group-issue-ids";

describe("kanban grouping transitions", () => {
  it("waits for flat data when sub-grouping is disabled", () => {
    const previousData = { high: { started: ["issue-1"] } };
    expect(getKanbanGroupIssueIds(previousData, "high")).toEqual([]);
    expect(getKanbanGroupIssueIds(previousData, "high", "null")).toEqual([]);
    expect(getKanbanGroupIssueIds({ high: ["issue-1"] }, "high")).toEqual(["issue-1"]);
  });

  it("waits for nested data when sub-grouping is enabled", () => {
    expect(getKanbanGroupIssueIds({ high: ["issue-1"] }, "high", "started")).toEqual([]);
    expect(getKanbanGroupIssueIds({ high: { started: ["issue-1"] } }, "high", "started")).toEqual(["issue-1"]);
  });

  it("handles unloaded or missing groups", () => {
    expect(getKanbanGroupIssueIds(undefined, "high")).toEqual([]);
    expect(getKanbanGroupIssueIds({}, "high", "started")).toEqual([]);
    expect(getKanbanGroupIssueIds({ high: {} }, "high", "started")).toEqual([]);
  });
});
