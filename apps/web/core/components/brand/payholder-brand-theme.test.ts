import { describe, expect, it } from "vitest";
import { PAYHOLDER_BRAND_PREVIEW_PROJECT_ID, isPayholderBrandPreviewProject } from "./payholder-brand-theme";

describe("PayHolder brand preview scope", () => {
  it("enables the preview for the dedicated time testing project", () => {
    expect(isPayholderBrandPreviewProject(PAYHOLDER_BRAND_PREVIEW_PROJECT_ID)).toBe(true);
  });

  it("keeps every other project on the standard Plane theme", () => {
    expect(isPayholderBrandPreviewProject("f9e9fc63-5417-4fb4-af38-8572a139a914")).toBe(false);
    expect(isPayholderBrandPreviewProject(undefined)).toBe(false);
  });
});
