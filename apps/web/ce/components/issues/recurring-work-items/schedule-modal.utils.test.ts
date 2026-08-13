import { describe, expect, it } from "vitest";

import { normalizeBoundedIntegerInput, parseBoundedIntegerInput } from "./schedule-modal.utils";

describe("recurring schedule number inputs", () => {
  it("keeps an empty value empty while the user is editing", () => {
    expect(parseBoundedIntegerInput("", 1, 365)).toBeNull();
  });

  it("accepts a replacement value after the default has been erased", () => {
    expect(parseBoundedIntegerInput("12", 1, 365)).toBe(12);
  });

  it("restores the fallback only when editing is finished", () => {
    expect(normalizeBoundedIntegerInput("", 1, 1, 365)).toBe("1");
    expect(normalizeBoundedIntegerInput("", 0, 0, 365)).toBe("0");
  });

  it("rejects fractions and values outside the supported range", () => {
    expect(parseBoundedIntegerInput("1.5", 1, 365)).toBeNull();
    expect(parseBoundedIntegerInput("0", 1, 365)).toBeNull();
    expect(parseBoundedIntegerInput("366", 1, 365)).toBeNull();
  });
});
