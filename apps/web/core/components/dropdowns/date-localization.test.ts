import { ru } from "date-fns/locale";
import { describe, expect, it } from "vitest";
import { formatDateRange, formatDateTimeRange, renderFormattedDate } from "@plane/utils";

describe("Russian date localization", () => {
  const start = new Date(2026, 7, 20, 9, 30);
  const end = new Date(2026, 7, 20, 18, 45);

  it("formats a date with a Russian month and natural field order", () => {
    expect(renderFormattedDate(start, "dd MMM yyyy HH:mm", ru)).toBe("20 авг. 2026 09:30");
  });

  it("formats a same-day date-time range in Russian", () => {
    expect(formatDateTimeRange(start, end, ru)).toBe("20 авг. 2026 09:30 – 18:45");
  });

  it("formats a multi-day range in Russian", () => {
    expect(formatDateRange(start, new Date(2026, 7, 22), ru)).toBe("20–22 авг. 2026");
  });

  it("preserves the existing English format without a locale", () => {
    expect(formatDateTimeRange(start, end)).toBe("Aug 20, 2026 09:30 - 18:45");
  });
});
