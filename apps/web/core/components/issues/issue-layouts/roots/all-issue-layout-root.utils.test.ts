/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { runWorkspaceViewLoad } from "./all-issue-layout-root.utils";

describe("runWorkspaceViewLoad", () => {
  it("clears the loading state after a successful request", async () => {
    const toggleLoading = vi.fn();

    await expect(runWorkspaceViewLoad(toggleLoading, async () => "loaded")).resolves.toBe("loaded");
    expect(toggleLoading.mock.calls).toEqual([[true], [false]]);
  });

  it("clears the loading state when the request fails", async () => {
    const toggleLoading = vi.fn();

    await expect(
      runWorkspaceViewLoad(toggleLoading, async () => {
        throw new Error("request failed");
      })
    ).rejects.toThrow("request failed");
    expect(toggleLoading.mock.calls).toEqual([[true], [false]]);
  });
});
