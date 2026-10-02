import { describe, expect, it } from "vitest";
import {
  getWorkItemDisplaySettings,
  parseWorkItemDisplaySettings,
  withWorkItemDisplaySettings,
} from "./work-item-display-settings";

describe("shared board display settings", () => {
  it("round-trips the screenshot's grouping, sorting and visible properties with other URL parameters", () => {
    const settings = getWorkItemDisplaySettings({
      displayFilters: {
        layout: "kanban",
        group_by: "assignees",
        sub_group_by: "state",
        order_by: "-created_at",
        sub_issue: false,
        show_empty_groups: true,
        calendar: { layout: "week", show_weekends: true },
      },
      displayProperties: { key: false, assignee: true, sub_issue_count: false, priority: true },
    });
    const params = new URLSearchParams(withWorkItemDisplaySettings("?filters=%7B%7D&peek=issue&layout=list", settings));
    expect(parseWorkItemDisplaySettings(params.get("display"))).toEqual(settings);
    expect(params.get("filters")).toBe("{}");
    expect(params.get("peek")).toBe("issue");
    expect(params.get("layout")).toBe("kanban");
  });

  it("uses deterministic defaults and normalizes unsupported kanban grouping combinations", () => {
    expect(parseWorkItemDisplaySettings('{"displayFilters":{},"displayProperties":{}}')).toEqual(
      getWorkItemDisplaySettings()
    );
    const settings = getWorkItemDisplaySettings({
      displayFilters: { layout: "kanban", group_by: "state", sub_group_by: "state" },
      displayProperties: {},
    });
    expect(settings.displayFilters.sub_group_by).toBeNull();
    expect(
      getWorkItemDisplaySettings({ displayFilters: { layout: "kanban", group_by: null }, displayProperties: {} })
        .displayFilters.group_by
    ).toBe("state");
  });

  it.each([
    null,
    "",
    "null",
    "[]",
    "{broken",
    "{}",
    " ".repeat(8193),
    '{"displayFilters":{"layout":"unknown"},"displayProperties":{}}',
    '{"displayFilters":{"group_by":"unknown"},"displayProperties":{}}',
    '{"displayFilters":{"order_by":"password"},"displayProperties":{}}',
    '{"displayFilters":{"sub_issue":"true"},"displayProperties":{}}',
    '{"displayFilters":{"calendar":{"layout":"year"}},"displayProperties":{}}',
    '{"displayFilters":{"calendar":null},"displayProperties":{}}',
    '{"displayFilters":{"__proto__":{}},"displayProperties":{}}',
    '{"displayFilters":{},"displayProperties":{"state":1}}',
    '{"displayFilters":{},"displayProperties":{"unknown":true}}',
    '{"displayFilters":{},"displayProperties":{},"__proto__":{}}',
  ])("ignores malformed or unsupported settings %#", (raw) => {
    expect(parseWorkItemDisplaySettings(raw)).toBeUndefined();
  });
});
