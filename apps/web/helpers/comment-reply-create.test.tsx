// @vitest-environment jsdom
import React, { act, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TIssueComment, TCommentsOperations } from "@plane/types";

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  focus: vi.fn(),
  create: vi.fn(),
  posted: vi.fn(),
  upload: vi.fn(),
  attach: vi.fn(),
}));
vi.mock("@/hooks/store/use-workspace", () => ({ useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "w" }) }) }));
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({ t: (key: string, args?: { name: string }) => (args ? `Ответ: ${args.name}` : key) }),
}));
vi.mock("@/hooks/store/use-member", () => ({ useMember: () => ({ getUserDetails: () => undefined }) }));
vi.mock("@/services/file.service", () => ({
  FileService: class {
    updateBulkProjectAssetsUploadStatus = mocks.attach;
  },
}));
vi.mock("@/components/editor/lite-text", () => ({
  LiteTextEditor: forwardRef(function Editor(
    props: {
      id: string;
      onChange: (json: object, html: string) => void;
      onEnterKeyPress: (e: React.MouseEvent<HTMLButtonElement>) => void;
      uploadFile: (blockId: string, file: File) => Promise<string>;
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({ clearEditor: mocks.clear, focus: mocks.focus }));
    return (
      <div data-editor={props.id}>
        <button onClick={() => props.onChange({}, "<p>My reply</p>")}>Type</button>
        <button onClick={props.onEnterKeyPress}>Send</button>
        <button
          onClick={() =>
            props.uploadFile("image-block", new File(["image"], "image.png", { type: "image/png" })).catch(() => {})
          }
        >
          Paste image
        </button>
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
it.each([
  [new Error("Network error"), "issue.comments.upload.error"],
  [
    new Error("Upload failed", { cause: new DOMException("Clipboard file is inaccessible", "NotReadableError") }),
    "issue.comments.upload.unreadable_file",
  ],
])("reports %s without clearing the draft and attaches a retry to the new reply", async (error, message) => {
  mocks.upload.mockRejectedValueOnce(error).mockResolvedValueOnce({ asset_id: "image" });
  mocks.create.mockResolvedValue({ id: "new-reply" });
  await act(async () =>
    root.render(
      <CommentCreate
        workspaceSlug="w"
        entityId="issue"
        projectId="project"
        parentComment={{ id: "parent", access: "INTERNAL" } as TIssueComment}
        activityOperations={
          { createComment: mocks.create, uploadCommentAsset: mocks.upload } as unknown as TCommentsOperations
        }
      />
    )
  );
  await click("Type");
  await click("Paste image");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(mocks.clear).not.toHaveBeenCalled();
  await click("Paste image");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await click("Send");
  expect(mocks.attach).toHaveBeenCalledWith("w", "project", "new-reply", { asset_ids: ["image"] });
});
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

it("sends the selected reply as the recipient while keeping the root thread", async () => {
  mocks.create.mockResolvedValue({ id: "new-reply" });
  await act(() =>
    root.render(
      <CommentCreate
        workspaceSlug="w"
        entityId="issue"
        projectId="project"
        activityOperations={{ createComment: mocks.create } as unknown as TCommentsOperations}
        parentComment={{ id: "root", access: "INTERNAL" } as TIssueComment}
        replyToComment={{ id: "selected-reply", parent: "root", access: "INTERNAL" } as TIssueComment}
      />
    )
  );
  await click("Type");
  await click("Send");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ parent: "root", reply_to: "selected-reply" }));
});
