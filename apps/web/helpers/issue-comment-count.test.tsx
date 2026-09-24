import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TIssue, TIssueComment } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import type { IIssueDetail } from "@/store/issue/issue-details/root.store";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: () => "Комментарии" }) }));
vi.mock("@plane/propel/tooltip", () => ({ Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</> }));
vi.mock("@/services/issue", () => ({ IssueCommentService: vi.fn() }));
import { IssueCommentCount } from "@/components/issues/issue-layouts/properties/comment-count";
import { IssueCommentStore } from "@/store/issue/issue-details/comment.store";

describe("card comment indicator", () => {
  it.each([undefined, 0, -1])("hides empty or unavailable counts (%s)", (count) => {
    expect(renderToStaticMarkup(<IssueCommentCount count={count} onClick={() => {}} />)).toBe("");
  });
  it("shows the exact count with an accessible label", () => {
    const html = renderToStaticMarkup(<IssueCommentCount count={123} onClick={() => {}} />);
    expect(html).toContain('aria-label="Комментарии: 123"');
    expect(html).toContain(">123</span>");
    expect(html).toContain('type="button"');
  });
});

function setup() {
  const issue = { id: "task", comment_count: 4, updated_at: "2026-09-16T08:00:00Z" } as TIssue;
  const store = new IssueCommentStore(
    {
      rootIssueStore: {
        issues: {
          getIssueById: () => issue,
          updateIssue: (_id: string, data: Partial<TIssue>) => Object.assign(issue, data),
        },
      },
      commentReaction: { applyCommentReactions: vi.fn() },
    } as unknown as IIssueDetail,
    EIssueServiceType.ISSUES
  );
  const service = {
    createIssueComment: vi.fn().mockResolvedValue({ id: "new" }),
    deleteIssueComment: vi.fn().mockResolvedValue(undefined),
    getIssueComments: vi.fn().mockResolvedValue([{ id: "one" }, { id: "two" }]),
    markCommentsRead: vi.fn().mockResolvedValue({ comment_ids: ["one"] }),
  };
  Object.assign(store.issueCommentService, service);
  return { issue, store, service };
}

describe("live card counts", () => {
  it("clears unread state only for server-confirmed receipts and keeps it on failure", async () => {
    const { store, service } = setup();
    store.commentMap.one = { id: "one", is_unread: true } as TIssueComment;
    store.commentMap.two = { id: "two", is_unread: true } as TIssueComment;
    service.markCommentsRead.mockRejectedValueOnce(new Error("offline"));
    await expect(store.markCommentsRead("workspace", "project", "task", ["one"])).rejects.toThrow("offline");
    expect(store.commentMap.one.is_unread).toBe(true);
    await store.markCommentsRead("workspace", "project", "task", ["one"]);
    expect(store.commentMap.one.is_unread).toBe(false);
    expect(store.commentMap.two.is_unread).toBe(true);
  });
  it("increments and decrements after successful mutations without changing task freshness", async () => {
    const { issue, store } = setup();
    await store.createComment("workspace", "project", "task", { comment_html: "<p>Test</p>" });
    expect(issue.comment_count).toBe(5);
    await store.removeComment("workspace", "project", "task", "new");
    expect(issue.comment_count).toBe(4);
    expect(issue.updated_at).toBe("2026-09-16T08:00:00Z");
  });
  it("does not change the count on failed create or delete", async () => {
    const { issue, store, service } = setup();
    service.createIssueComment.mockRejectedValue(new Error("failed"));
    service.deleteIssueComment.mockRejectedValue(new Error("failed"));
    await expect(store.createComment("w", "p", "task", {})).rejects.toThrow("failed");
    await expect(store.removeComment("w", "p", "task", "existing")).rejects.toThrow("failed");
    expect(issue.comment_count).toBe(4);
  });
  it("reconciles the count after loading the full discussion", async () => {
    const { issue, store } = setup();
    await store.fetchComments("w", "p", "task");
    expect(issue.comment_count).toBe(2);
  });
  it("removes stale cached comments when reopening a discussion after a deletion elsewhere", async () => {
    const { issue, store, service } = setup();
    store.comments.task = ["deleted"];
    store.commentMap.deleted = { id: "deleted", created_at: "2026-09-16T08:00:00Z" } as TIssueComment;
    service.getIssueComments.mockResolvedValue([]);
    await store.fetchComments("w", "p", "task");
    expect(issue.comment_count).toBe(0);
    expect(store.getCommentsByIssueId("task")).toEqual([]);
    expect(service.getIssueComments).toHaveBeenCalledWith("w", "p", "task");
  });
});

it("counts replies but excludes deleted thread roots when reconciling the discussion", async () => {
  const { issue, store, service } = setup();
  service.getIssueComments.mockResolvedValue([
    { id: "parent", deleted_at: "2026-09-24T10:00:00Z" },
    { id: "reply", parent: "parent" },
  ]);
  await store.fetchComments("w", "p", "task");
  expect(issue.comment_count).toBe(1);
  expect(store.getCommentsByIssueId("task")).toEqual(["parent", "reply"]);
});

it("reloads a thread after deleting its root so live replies keep their tombstone", async () => {
  const { issue, store, service } = setup();
  store.comments.task = ["parent", "reply"];
  store.commentMap.parent = { id: "parent" } as TIssueComment;
  store.commentMap.reply = { id: "reply", parent: "parent" } as TIssueComment;
  service.getIssueComments.mockResolvedValue([
    { id: "parent", deleted_at: "2026-09-24T10:00:00Z" },
    { id: "reply", parent: "parent" },
  ]);
  await store.removeComment("w", "p", "task", "parent");
  expect(store.getCommentById("parent")?.deleted_at).toBeTruthy();
  expect(store.getCommentsByIssueId("task")).toEqual(["parent", "reply"]);
  expect(issue.comment_count).toBe(1);
});
