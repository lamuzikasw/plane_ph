/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { IKanBan } from "./default";
import { KanBan } from "./default";

vi.mock("@plane/ui", () => ({ ContentWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/store/use-kanban-view", () => ({ useKanbanView: () => undefined }));
vi.mock("@/hooks/use-issue-layout-store", () => ({ useIssueStoreType: () => "CYCLE" }));
vi.mock("@/plane-web/components/workflow", () => ({
  useWorkFlowFDragNDrop: () => ({ getIsWorkflowWorkItemCreationDisabled: () => false }),
}));
vi.mock("../utils", () => ({
  getGroupByColumns: () => [{ id: "high", name: "High", payload: {} }],
  isWorkspaceLevel: () => false,
  getApproximateCardHeight: () => 100,
}));
vi.mock("@/components/core/render-if-visible-HOC", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/loader/layouts/kanban-layout-loader", () => ({ KanbanColumnLoader: () => null }));
vi.mock("./headers/group-by-card", () => ({ HeaderGroupByCard: () => <header>High</header> }));
vi.mock("./kanban-group", () => ({ KanbanGroup: () => <div>Cards</div> }));

const props: IKanBan = {
  issuesMap: {},
  groupedIssueIds: { high: { started: ["issue-1"] } },
  getGroupIssueCount: () => 1,
  displayProperties: undefined,
  sub_group_by: null,
  group_by: "priority",
  orderBy: "-created_at",
  updateIssue: undefined,
  quickActions: () => <></>,
  collapsedGroups: { group_by: [], sub_group_by: [] },
  handleCollapsedGroups: () => undefined,
  loadMoreIssues: () => undefined,
  canEditProperties: () => true,
  handleOnDrop: async () => undefined,
};

describe("KanBan", () => {
  it("renders while old sub-group data is being replaced after disabling sub-grouping", () => {
    expect(renderToStaticMarkup(<KanBan {...props} />)).toContain("High");
  });
  it("does not crash when a focused card is present during the grouping transition", () => {
    expect(renderToStaticMarkup(<KanBan {...props} focusIssueId="issue-1" />)).toContain("High");
  });
});
