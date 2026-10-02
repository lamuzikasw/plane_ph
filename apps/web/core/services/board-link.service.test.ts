import { describe, expect, it } from "vitest";
import { validateBoardLink } from "./board-link.service";
const link = {
  token: "abcDEF123_-0",
  path: "/workspace/projects/985cdf12-cc26-42c6-b3e6-f9bea56b91ca/issues/",
  filters: {},
  display: { displayFilters: { layout: "kanban" }, displayProperties: { key: false } },
};
describe("board link responses", () => {
  it("validates and normalizes shared settings", () => {
    expect(validateBoardLink(link).display.displayFilters.group_by).toBe("state");
    expect(validateBoardLink(link).display.displayProperties.key).toBe(false);
  });
  it.each(["https://evil.test", "//evil.test", "/settings/", "/workspace/projects/../issues/"])(
    "rejects a non-board destination %s",
    (path) => {
      expect(() => validateBoardLink({ ...link, path })).toThrow();
    }
  );
  it("rejects invalid settings or tokens", () => {
    expect(() => validateBoardLink({ ...link, token: "../escape" })).toThrow();
    expect(() =>
      validateBoardLink({ ...link, display: { displayFilters: { layout: "unknown" }, displayProperties: {} } })
    ).toThrow();
  });
});
