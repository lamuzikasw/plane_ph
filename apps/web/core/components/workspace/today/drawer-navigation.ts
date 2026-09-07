/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export function openIssueAfterClosingDrawer<T>(issue: T, closeDrawer: () => void, openIssue: (issue: T) => void) {
  closeDrawer();
  openIssue(issue);
}

export function buildIssueBoardPath(workspaceSlug: string, projectId: string, issueId: string) {
  const searchParams = new URLSearchParams({
    layout: "kanban",
    focusIssue: issueId,
  });

  return `/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/issues?${searchParams.toString()}`;
}
