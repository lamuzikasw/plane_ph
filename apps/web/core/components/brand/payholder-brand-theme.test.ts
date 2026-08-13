import { describe, expect, it } from "vitest";
import { PAYHOLDER_BRAND_PREVIEW_PROJECT_ID, isPayholderBrandPreviewProject } from "./payholder-brand-theme";

describe("PayHolder brand preview scope", () => {
  it("enables the brand for the dedicated time testing project", () => {
    expect(isPayholderBrandPreviewProject(PAYHOLDER_BRAND_PREVIEW_PROJECT_ID)).toBe(true);
  });

  it("keeps every other project on the standard Plane theme", () => {
    expect(isPayholderBrandPreviewProject("2ff203d9-0e69-4cf7-8e15-077b99846127")).toBe(false);
    expect(isPayholderBrandPreviewProject(undefined)).toBe(false);
  });
});
