/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TIssue } from "@plane/types";

const SHARED_FIELDS = [
  "name",
  "description_html",
  "priority",
  "start_date",
  "target_date",
  "completed_at",
  "assignee_ids",
  "comment_count",
  "updated_at",
] as const;

/** Local identity, status IDs and ordering must never overwrite another placement. */
export function sharedIssuePatch(change: Partial<TIssue>): Partial<TIssue> {
  return Object.fromEntries(SHARED_FIELDS.filter((field) => field in change).map((field) => [field, change[field]]));
}

export function canonicalIssueId(issue: Pick<TIssue, "id" | "canonical_issue_id">): string {
  return issue.canonical_issue_id ?? issue.id;
}
