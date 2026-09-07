/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { buildIssueBoardPath, openIssueAfterClosingDrawer } from "./drawer-navigation";

describe("openIssueAfterClosingDrawer", () => {
  it("closes the source drawer before opening the selected issue", () => {
    const issue = { id: "issue-1" };
    const calls: string[] = [];
    const closeDrawer = vi.fn(() => calls.push("close-drawer"));
    const openIssue = vi.fn(() => calls.push("open-issue"));

    openIssueAfterClosingDrawer(issue, closeDrawer, openIssue);

    expect(calls).toEqual(["close-drawer", "open-issue"]);
    expect(closeDrawer).toHaveBeenCalledOnce();
    expect(openIssue).toHaveBeenCalledOnce();
    expect(openIssue).toHaveBeenCalledWith(issue);
  });
});

describe("buildIssueBoardPath", () => {
  it("opens the project Kanban and carries the work item to focus", () => {
    expect(buildIssueBoardPath("payholder", "project-1", "issue-42")).toBe(
      "/payholder/projects/project-1/issues?layout=kanban&focusIssue=issue-42"
    );
  });

  it("encodes route segments and query values", () => {
    expect(buildIssueBoardPath("team space", "project/1", "issue&42")).toBe(
      "/team%20space/projects/project%2F1/issues?layout=kanban&focusIssue=issue%2642"
    );
  });
});
