// @vitest-environment jsdom
import React, { act, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TIssueComment, TCommentsOperations } from "@plane/types";

const mocks = vi.hoisted(() => ({ clear: vi.fn(), focus: vi.fn(), create: vi.fn(), posted: vi.fn() }));
vi.mock("@/hooks/store/use-workspace", () => ({ useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "w" }) }) }));
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({ t: (key: string, args?: { name: string }) => (args ? `Ответ: ${args.name}` : key) }),
}));
vi.mock("@/hooks/store/use-member", () => ({ useMember: () => ({ getUserDetails: () => undefined }) }));
vi.mock("@/services/file.service", () => ({ FileService: vi.fn() }));
vi.mock("@/components/editor/lite-text", () => ({
  LiteTextEditor: forwardRef(function Editor(
    props: {
      id: string;
      onChange: (json: object, html: string) => void;
      onEnterKeyPress: (e: React.MouseEvent<HTMLButtonElement>) => void;
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({ clearEditor: mocks.clear, focus: mocks.focus }));
    return (
      <div data-editor={props.id}>
        <button onClick={() => props.onChange({}, "<p>My reply</p>")}>Type</button>
        <button onClick={props.onEnterKeyPress}>Send</button>
      </div>
    );
  }),
}));
import { CommentCreate } from "@/components/comments/comment-create";
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout engine.
  // eslint-disable-next-line no-extend-native
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
}
it("preserves a failed draft, retries with parent identity/visibility, and clears only after success", async () => {
  mocks.create.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "reply" });
  await act(async () =>
    root.render(
      <CommentCreate
        workspaceSlug="w"
        entityId="issue"
        projectId="project"
        activityOperations={{ createComment: mocks.create } as unknown as TCommentsOperations}
        parentComment={{ id: "parent", access: "EXTERNAL" } as TIssueComment}
        onSubmitCallback={mocks.posted}
      />
    )
  );
  expect(document.querySelector('[data-editor="add_comment_parent"]')).not.toBeNull();
  await click("Type");
  await click("Send");
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.posted).not.toHaveBeenCalled();
  await click("Send");
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create).toHaveBeenLastCalledWith(
    expect.objectContaining({ comment_html: "<p>My reply</p>", parent: "parent", access: "EXTERNAL" })
  );
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(mocks.posted).toHaveBeenCalledWith("reply");
});

it("shows the selected reply's author and quote, preserves the draft when switching targets, and posts to the root", async () => {
  mocks.create.mockResolvedValue({ id: "new-reply" });
  const parent = {
    id: "parent",
    access: "INTERNAL",
    actor: "parent-author",
    actor_detail: { display_name: "Автор ветки" },
    comment_html: "<p>Исходный вопрос</p>",
  } as TIssueComment;
  const selected = {
    id: "child",
    parent: "parent",
    actor: "child-author",
    actor_detail: { display_name: "Иван" },
    comment_html: "<p>Что делаем с <strong>категориями</strong>?</p>",
  } as TIssueComment;
  const renderComposer = (target: TIssueComment) =>
    root.render(
      <CommentCreate
        workspaceSlug="w"
        entityId="issue"
        projectId="project"
        activityOperations={{ createComment: mocks.create } as unknown as TCommentsOperations}
        parentComment={parent}
        replyToComment={target}
      />
    );
  await act(async () => renderComposer(selected));
  expect(document.body.textContent).toContain("Ответ: Иван");
  expect(document.querySelector("blockquote")?.textContent).toBe("Что делаем с категориями?");
  expect(document.querySelector("blockquote strong")).toBeNull();
  await click("Type");
  await act(async () => renderComposer(parent));
  expect(document.body.textContent).toContain("Ответ: Автор ветки");
  expect(document.querySelector("blockquote")?.textContent).toBe("Исходный вопрос");
  expect(mocks.clear).not.toHaveBeenCalled();
  await click("Send");
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ parent: "parent", comment_html: "<p>My reply</p>" })
  );
});
