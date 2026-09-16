import { describe, expect, it } from "vitest";
import { canonicalIssueId, sharedIssuePatch } from "./issue-placement.helper";

describe("shared work item updates", () => {
  it("shares content while preserving each project's identity and workflow IDs", () => {
    expect(
      sharedIssuePatch({
        id: "crm-placement",
        project_id: "crm",
        sequence_id: 118,
        state_id: "crm-started",
        sort_order: 12,
        name: "Updated integration",
        priority: "high",
        target_date: null,
      })
    ).toEqual({ name: "Updated integration", priority: "high", target_date: null });
  });

  it("resolves native and additional placements to one content identity", () => {
    expect(canonicalIssueId({ id: "original" })).toBe("original");
    expect(canonicalIssueId({ id: "crm-placement", canonical_issue_id: "original" })).toBe("original");
  });
});

it("shares discussion counts without changing project status", () => {
  expect(sharedIssuePatch({ comment_count: 5, state_id: "todo" })).toEqual({ comment_count: 5 });
});
