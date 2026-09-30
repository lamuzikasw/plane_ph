import { describe, expect, it } from "vitest";
import { parseWorkItemFilters, withWorkItemFilters } from "./work-item-filter-url";

describe("work item filter URLs", () => {
  it("round-trips multiple conditions and values, preserving other query parameters", () => {
    const expression = { and: [{ label_id__in: "label-a,label-b" }, { priority__in: "high,urgent" }] };
    const params = new URLSearchParams(withWorkItemFilters("?layout=kanban&peek=issue&search=A%26B", expression));
    expect(parseWorkItemFilters(params.get("filters"))).toEqual(expression);
    expect(params.get("layout")).toBe("kanban");
    expect(params.get("peek")).toBe("issue");
    expect(params.get("search")).toBe("A&B");
  });

  it("replaces previous filters and explicitly represents an unfiltered board", () => {
    const params = new URLSearchParams(withWorkItemFilters("?filters=old&filters=duplicate", {}));
    expect(params.getAll("filters")).toEqual(["{}"]);
    expect(parseWorkItemFilters(params.get("filters"))).toEqual({});
  });

  it("retains date ranges and escaped characters", () => {
    const expression = { target_date__range: "2026-09-01;after,2026-09-30;before" };
    expect(parseWorkItemFilters(new URLSearchParams(withWorkItemFilters("", expression)).get("filters"))).toEqual(
      expression
    );
  });

  it.each([
    null,
    "",
    "{broken",
    "null",
    "[]",
    "42",
    '{"and":[]}',
    '{"and":[{}]}',
    '{"label_id__unknown":"a"}',
    '{"unknown__in":"a"}',
    '{"label_id__in":["a"]}',
    '{"label_id__in":null}',
    '{"label_id__in":{}}',
    '{"label_id__in":"a","priority__in":"high"}',
    '{"__proto__":{"polluted":true}}',
    " ".repeat(32_769),
    '{"and":'.repeat(12) + "{}" + "}".repeat(12),
  ])("ignores malformed or unsupported input %#", (raw) => {
    expect(parseWorkItemFilters(raw)).toBeUndefined();
  });
});
