/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  getCurrentUserUrl,
  getLoginRedirectUrl,
  isCurrentUserRequest,
  isSessionConfirmedExpired,
  shouldPreserveAuthenticatedUser,
  shouldShowMaintenance,
} from "./session-reliability";

describe("session reliability", () => {
  it("confirms logout only when the current-user endpoint returns 401", async () => {
    const unauthorized = vi.fn(async () => ({ status: 401 }));
    const unavailable = vi.fn(async () => ({ status: 503 }));
    const networkFailure = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    await expect(isSessionConfirmedExpired(unauthorized, "/api/users/me/")).resolves.toBe(true);
    await expect(isSessionConfirmedExpired(unavailable, "/api/users/me/")).resolves.toBe(false);
    await expect(isSessionConfirmedExpired(networkFailure, "/api/users/me/")).resolves.toBe(false);
  });

  it("recognizes the auth probe and builds safe URLs", () => {
    expect(isCurrentUserRequest("/api/users/me/?t=1")).toBe(true);
    expect(isCurrentUserRequest("/api/workspaces/acme/")).toBe(false);
    expect(getCurrentUserUrl("")).toBe("/api/users/me/");
    expect(getCurrentUserUrl("https://plane.example/")).toBe("https://plane.example/api/users/me/");
    expect(getLoginRedirectUrl("/payholder/projects", "?view=board")).toBe(
      "/?next_path=%2Fpayholder%2Fprojects%3Fview%3Dboard"
    );
  });

  it("shows maintenance only after recovery retries fail and no cached instance exists", () => {
    expect(shouldShowMaintenance(true, false, false)).toBe(false);
    expect(shouldShowMaintenance(true, false, true)).toBe(true);
    expect(shouldShowMaintenance(true, true, true)).toBe(false);
    expect(shouldShowMaintenance(false, false, true)).toBe(false);
  });

  it("keeps a previously authenticated user during a transient fetch failure", () => {
    expect(shouldPreserveAuthenticatedUser(true, true)).toBe(true);
    expect(shouldPreserveAuthenticatedUser(false, true)).toBe(false);
    expect(shouldPreserveAuthenticatedUser(true, false)).toBe(false);
  });
});
