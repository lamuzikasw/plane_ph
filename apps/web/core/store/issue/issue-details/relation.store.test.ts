/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { runInAction } from "mobx";
import { describe, expect, it, vi } from "vitest";
import {
  EIssueLayoutTypes,
  EIssueServiceType,
  type TIssue,
  type TIssueRelation,
  type TIssuesResponse,
} from "@plane/types";
import type { IIssueRootStore } from "../root.store";
import type { IModuleIssuesFilter } from "../module/filter.store";
import { ModuleIssues } from "../module/issue.store";
import { IssueDetail, type IIssueDetail } from "./root.store";
import type { IssueStore } from "./issue.store";
import { IssueRelationStore } from "./relation.store";

vi.mock("@/lib/store-context", () => ({ store: {} }));

const issue = (id: string, data: Partial<TIssue> = {}) => ({ id, project_id: "project", ...data }) as TIssue;
const response = (related: TIssue[] = []): TIssueRelation => ({
  blocking: [],
  blocked_by: [],
  duplicate: [],
  relates_to: related,
});
function setup() {
  const items: Record<string, TIssue> = { merchant: issue("merchant"), task: issue("task") };
  const issues = {
    getIssueById: (id: string) => items[id],
    getIssuesByIds: (ids: string[]) => ids.map((id) => items[id]).filter(Boolean),
    addIssue: (data: TIssue[]) =>
      data.forEach((item) => {
        items[item.id] = { ...items[item.id], ...item };
      }),
    updateIssue: (id: string, data: Partial<TIssue>) => {
      items[id] = { ...items[id], ...data };
    },
  };
  const store = new IssueRelationStore({
    rootIssueStore: { issues },
    activity: { fetchActivities: vi.fn() },
  } as unknown as IIssueDetail);
  const list = vi.spyOn(store.issueRelationService, "listIssueRelations").mockResolvedValue(response([items.task]));
  vi.spyOn(store.issueRelationService, "createIssueRelations").mockResolvedValue([items.task]);
  vi.spyOn(store.issueRelationService, "deleteIssueRelation").mockResolvedValue(undefined);
  return { store, list, items, issues };
}

it("keeps a newly created cross-project relation through repeated background board refreshes", async () => {
  const { store, items, issues } = setup();
  items.task.project_id = "other-project";
  const board = new ModuleIssues(
    {
      moduleId: "module",
      issues,
      issueDetail: { relation: store },
    } as unknown as IIssueRootStore,
    {
      issueFilters: { displayFilters: { layout: EIssueLayoutTypes.KANBAN } },
    } as unknown as IModuleIssuesFilter
  );
  runInAction(() => {
    board.paginationOptions = { perPageCount: 100, canGroup: false };
  });
  vi.spyOn(board.issueService, "getIssues").mockResolvedValue({
    results: [issue("merchant")],
    total_count: 1,
    total_results: 1,
    next_page_results: false,
  } as TIssuesResponse);
  await store.createRelation("workspace", "project", "merchant", "relates_to", ["task"]);
  for (let i = 0; i < 3; i++)
    // Polls run serially; concurrent refreshes may be discarded as stale.
    // eslint-disable-next-line no-await-in-loop
    await board.refreshIssues(
      "workspace",
      "project",
      () => ({}),
      () => true
    );
  expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual(["task"]);
  expect(store.getRelationByIssueIdRelationType("task", "relates_to")).toEqual(["merchant"]);
});

describe("expanded relation snapshots", () => {
  it.each([{}, { issue_relation: [] }, { issue_related: [] }])(
    "preserves known relations for an incomplete expansion: %j",
    async (partial) => {
      const { store } = setup();
      await store.fetchRelations("workspace", "project", "merchant");
      store.extractRelationsFromIssues([issue("merchant", partial)]);
      expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual(["task"]);
    }
  );
  it("accepts complete empty arrays as a real deletion", async () => {
    const { store } = setup();
    await store.fetchRelations("workspace", "project", "merchant");
    store.extractRelationsFromIssues([issue("merchant", { issue_relation: [], issue_related: [] })]);
    expect(store.getRelationsByIssueId("merchant")).toEqual({});
  });
  it("replaces stale edges and retains both incoming and outgoing relations", async () => {
    const { store } = setup();
    await store.fetchRelations("workspace", "project", "merchant");
    store.extractRelationsFromIssues([
      issue("merchant", {
        issue_relation: [{ ...issue("outgoing"), project_id: "project", relation_type: "blocked_by" }],
        issue_related: [{ ...issue("incoming"), project_id: "project", relation_type: "blocked_by" }],
      }),
    ]);
    expect(store.getRelationsByIssueId("merchant")).toEqual({ blocked_by: ["outgoing"], blocking: ["incoming"] });
  });
});

it("refreshes added and deleted remote relations without a page reload", async () => {
  const { store, list } = setup();
  await store.refreshRelations("workspace", "project", "merchant", () => true);
  expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual(["task"]);
  list.mockResolvedValue(response());
  await store.refreshRelations("workspace", "project", "merchant", () => true);
  expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual([]);
});
it("refreshes relations through the same detail refresh used by open cards", async () => {
  const { items, issues } = setup();
  class Detail extends IssueDetail {}
  const detail = new Detail(
    { issues, rootStore: {}, currentUserId: "user" } as unknown as IIssueRootStore,
    EIssueServiceType.ISSUES
  );
  const list = vi.spyOn((detail.relation as IssueRelationStore).issueRelationService, "listIssueRelations");
  vi.spyOn((detail.issue as IssueStore).issueService, "retrieve").mockResolvedValue(items.merchant);
  list.mockResolvedValue(response([items.task]));
  await detail.refreshIssue("workspace", "project", "merchant", () => true);
  expect(detail.relation.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual(["task"]);
  list.mockResolvedValue(response());
  await detail.refreshIssue("workspace", "project", "merchant", () => true);
  expect(detail.relation.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual([]);
});
it.each(["create", "remove"])("discards an old background response after a local %s", async (operation) => {
  const { store, list } = setup();
  if (operation === "remove") await store.fetchRelations("workspace", "project", "merchant");
  let resolve!: (value: TIssueRelation) => void;
  list.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const pending = store.refreshRelations("workspace", "project", "merchant", () => true);
  if (operation === "create") await store.createRelation("workspace", "project", "merchant", "relates_to", ["task"]);
  else await store.removeRelation("workspace", "project", "merchant", "relates_to", "task");
  resolve(response(operation === "remove" ? [issue("task")] : []));
  await pending;
  expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual(
    operation === "create" ? ["task"] : []
  );
});
it("ignores a background response after leaving the view", async () => {
  const { store } = setup();
  await store.refreshRelations("workspace", "project", "merchant", () => false);
  expect(store.getRelationsByIssueId("merchant")).toBeUndefined();
});
it("keeps current relations on a failed refresh and can retry", async () => {
  const { store, list } = setup();
  await store.fetchRelations("workspace", "project", "merchant");
  list.mockRejectedValueOnce(new Error("offline"));
  await expect(store.refreshRelations("workspace", "project", "merchant", () => true)).rejects.toThrow("offline");
  expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual(["task"]);
  list.mockResolvedValue(response());
  await store.refreshRelations("workspace", "project", "merchant", () => true);
  expect(store.getRelationByIssueIdRelationType("merchant", "relates_to")).toEqual([]);
});
