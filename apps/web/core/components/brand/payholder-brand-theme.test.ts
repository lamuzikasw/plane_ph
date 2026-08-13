import { describe, expect, it } from "vitest";
import { PAYHOLDER_BRAND_WORKSPACE_SLUG, isPayholderBrandedWorkspace } from "./payholder-brand-theme";

describe("PayHolder brand workspace scope", () => {
  it("enables the brand for every page in the PayHolder workspace", () => {
    expect(isPayholderBrandedWorkspace(PAYHOLDER_BRAND_WORKSPACE_SLUG)).toBe(true);
    expect(isPayholderBrandedWorkspace("PayHolder")).toBe(true);
  });

  it("keeps other workspaces on their existing theme", () => {
    expect(isPayholderBrandedWorkspace("another-workspace")).toBe(false);
    expect(isPayholderBrandedWorkspace(undefined)).toBe(false);
  });
});
