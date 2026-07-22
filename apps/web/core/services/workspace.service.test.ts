/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./workspace.service";

describe("WorkspaceService.getViewIssues", () => {
  it("uses the workspace issues endpoint when Gantt requests relations", async () => {
    const service = new WorkspaceService();
    const params = { expand: "issue_relation,issue_related", layout: "gantt_chart" };
    const response = { grouped_by: null, sub_grouped_by: null, total_count: 0, results: [] };
    const get = vi.spyOn(service, "get").mockResolvedValue({ data: response } as never);

    await expect(service.getViewIssues("payholder", params)).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith("/api/workspaces/payholder/issues/", { params }, {});
  });
});
