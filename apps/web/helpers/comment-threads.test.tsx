// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { getCommentReplyQuote, getThreadReplyTime, groupCommentThreads } from "./comment-threads";

vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    currentLocale: "en",
    t: (key: string, args?: { count: number }) =>
      args ? `${args.count} ${key.endsWith("new_count") ? "new" : "replies"}` : key,
  }),
}));
vi.mock("@/hooks/store/use-member", () => ({ useMember: () => ({ getUserDetails: () => undefined }) }));
vi.mock("@plane/ui", () => ({
  AvatarGroup: ({ children }: { children: React.ReactNode }) => <span data-avatars>{children}</span>,
  Avatar: ({ name }: { name: string }) => <span data-avatar={name} />,
}));
vi.mock("@/components/comments/card/root", () => ({
  CommentCard: ({ comment, onReply, isReply }: { comment: TIssueComment; onReply?: () => void; isReply?: boolean }) => (
    <div data-comment={comment.id} data-reply={isReply}>
      {comment.deleted_at ? "deleted" : comment.comment_html}
      {onReply && <button onClick={onReply}>Reply to {comment.id}</button>}
    </div>
  ),
}));
vi.mock("@/components/comments/comment-create", () => ({
  CommentCreate: ({
    parentComment,
    replyToComment,
    onCancel,
    onSubmitCallback,
  }: {
    parentComment: TIssueComment;
    replyToComment: TIssueComment;
    onCancel: () => void;
    onSubmitCallback: (id: string) => void;
  }) => (
    <div data-composer={parentComment.id} data-reply-to={replyToComment.id}>
      <button onClick={onCancel}>Cancel</button>
      <button onClick={() => onSubmitCallback("new")}>Submit</button>
    </div>
  ),
}));
import { CommentThread } from "@/components/comments/comment-thread";

const comment = (id: string, parent?: string, created_at = "2026-09-24T10:00:00Z") =>
  ({
    id,
    actor: id,
    actor_detail: { display_name: id },
    parent,
    created_at,
    comment_html: id,
    workspace: "workspace",
  }) as TIssueComment;
const parent = comment("root");
const replies = [comment("first", "root"), comment("second", "root", "2026-09-24T11:00:00Z")];

it("groups replies without duplication and preserves root order and orphan comments", () => {
  const orphan = comment("orphan", "missing");
  const { roots, replies: grouped } = groupCommentThreads([replies[1], parent, orphan, replies[0], comment("other")]);
  expect(roots.map(({ id }) => id)).toEqual(["root", "orphan", "other"]);
  expect(grouped.get("root")?.map(({ id }) => id)).toEqual(["first", "second"]);
});

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function ChangeHash() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("#comment-second")}>Notification</button>;
}
async function render({
  hash = "",
  disabled = false,
  deleted = false,
  threadReplies = replies,
  markRead = undefined as TCommentsOperations["markCommentsRead"],
} = {}) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[`/task${hash}`]}>
        <ChangeHash />
        <CommentThread
          workspaceSlug="w"
          entityId="task"
          projectId="p"
          comment={{ ...parent, deleted_at: deleted ? "today" : null }}
          replies={threadReplies}
          activityOperations={{ markCommentsRead: markRead } as TCommentsOperations}
          ends="top"
          showAccessSpecifier={false}
          showCopyLinkOption
          enableReplies
          disabled={disabled}
        />
      </MemoryRouter>
    )
  );
}

describe("comment thread", () => {
  it("marks only visible foreground replies read and keeps the divider until collapse", async () => {
    vi.useFakeTimers();
    let visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
    let intersect: (entries: { target: Element; isIntersecting: boolean }[]) => void = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersect) {
          intersect = callback;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const markRead = vi.fn().mockResolvedValue(undefined);
    const threadReplies = replies.map((reply) => ({ ...reply, is_unread: true }));
    await render({ threadReplies, markRead });
    expect(document.body.textContent).toContain("2 new");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(markRead).not.toHaveBeenCalled();
    await click("2 replies · 2 new");
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
    const seen = document.querySelector('[data-unread-reply="second"]')!;
    visibility = "hidden";
    await act(async () => {
      intersect([{ target: seen, isIntersecting: true }]);
      vi.advanceTimersByTime(1000);
    });
    expect(markRead).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(700);
    });
    expect(markRead).toHaveBeenCalledExactlyOnceWith(["second"]);
    await render({ threadReplies: replies.map((reply) => ({ ...reply, is_unread: false })), markRead });
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("2 new");
    await click("2 replies");
    await click("2 replies");
    expect(document.querySelector('[role="separator"]')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it("does not mark a reply read if it leaves the viewport before the dwell time", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let intersect: (entries: { target: Element; isIntersecting: boolean }[]) => void = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersect) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const markRead = vi.fn();
    await render({ threadReplies: replies.map((reply) => ({ ...reply, is_unread: true })), markRead });
    await click("2 replies · 2 new");
    const target = document.querySelector('[data-unread-reply="first"]')!;
    await act(async () => {
      intersect([{ target, isIntersecting: true }]);
      vi.advanceTimersByTime(300);
      intersect([{ target, isIntersecting: false }]);
      vi.advanceTimersByTime(1000);
    });
    expect(markRead).not.toHaveBeenCalled();
  });
  it("shows unique participants and the latest reply time, refreshes it and handles incoming replies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T11:05:00Z"));
    const repeated = {
      ...comment("third", "root", "2026-09-24T10:30:00Z"),
      actor: "first",
      actor_detail: replies[0].actor_detail,
      edited_at: "2026-09-24T11:04:00Z",
    };
    await render({ threadReplies: [replies[1], repeated, replies[0]] });
    expect(document.querySelectorAll("[data-avatar]")).toHaveLength(2);
    expect(document.querySelector("time")?.textContent).toBe("5 min. ago");
    expect(document.querySelector("time")?.dateTime).toBe(replies[1].created_at);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(document.querySelector("time")?.textContent).toBe("6 min. ago");
    await render({ threadReplies: [...replies, comment("new", "root", "2026-09-24T11:06:00Z")] });
    expect(document.querySelectorAll("[data-avatar]")).toHaveLength(3);
    expect(document.querySelector("time")?.textContent).toBe("now");
  });
  it("collapses replies initially, expands them and replies within the original thread", async () => {
    await render();
    expect(document.querySelector('[data-comment="first"]')).toBeNull();
    await click("2 replies");
    expect(document.querySelector('[data-comment="first"]')).not.toBeNull();
    await click("Reply to second");
    expect(document.querySelector('[data-composer="root"]')).not.toBeNull();
    expect(document.querySelector('[data-reply-to="second"]')).not.toBeNull();
    await click("Reply to first");
    expect(document.querySelector('[data-reply-to="first"]')).not.toBeNull();
    await click("Cancel");
    expect(document.querySelector("[data-composer]")).toBeNull();
  });
  it("opens the composer from the root and keeps the thread open after posting", async () => {
    await render();
    await click("Reply to root");
    expect(document.querySelector('[data-composer="root"]')).not.toBeNull();
    expect(document.querySelector('[data-reply-to="root"]')).not.toBeNull();
    await click("Submit");
    expect(document.querySelector("[data-composer]")).toBeNull();
    expect(document.querySelector('[data-comment="second"]')).not.toBeNull();
  });
  it.each(["#comment-second", ""])("reveals replies on direct links and same-page notifications (%s)", async (hash) => {
    await render({ hash });
    if (!hash) await click("Notification");
    expect(document.querySelector('[data-comment="second"]')).not.toBeNull();
  });
  it.each([{ disabled: true }, { deleted: true }])(
    "prevents replies when the conversation is read-only (%o)",
    async (options) => {
      await render(options);
      await click("2 replies");
      expect([...document.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Reply to"))).toBe(false);
    }
  );
});

it("formats reply age in the user's language, including just-now and old threads", () => {
  const now = Date.parse("2026-09-24T11:05:00Z");
  expect(getThreadReplyTime(now - 300_000, now, "ru")).toBe("5 мин. назад");
  expect(getThreadReplyTime(now + 1000, now, "en")).toBe("now");
  expect(getThreadReplyTime(now - 7200_000, now, "en")).toBe("2 hr. ago");
  expect(getThreadReplyTime(now - 86400_000 * 400, now, "en")).toBe("last yr.");
});

describe("reply quote", () => {
  it("extracts plain text, decodes entities and keeps paragraph boundaries", () => {
    expect(
      getCommentReplyQuote({
        comment_html:
          "<p>Каталог <strong>A &amp; B</strong></p><p>Вторая строка<br>Третья</p><script>alert(1)</script>",
        comment_stripped: "",
      })
    ).toBe("Каталог A & B Вторая строка Третья");
  });
  it("shortens long quotes without splitting an emoji and handles attachment-only messages", () => {
    const quote = getCommentReplyQuote({ comment_html: `<p>${"🙂".repeat(200)}</p>`, comment_stripped: "" });
    expect(quote).toBe(`${"🙂".repeat(180)}…`);
    expect(getCommentReplyQuote({ comment_html: '<p><img src="/image.png"></p>', comment_stripped: "" })).toBe("");
  });
});
