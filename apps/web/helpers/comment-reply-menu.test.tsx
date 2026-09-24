// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { TCommentsOperations, TIssueComment } from "@plane/types";
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "me" } }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/icon-button", () => ({ IconButton: () => null }));
vi.mock("@plane/ui", () => ({
  CustomMenu: Object.assign(({ children }: React.PropsWithChildren) => <div>{children}</div>, {
    MenuItem: ({ children, onClick }: React.PropsWithChildren<{ onClick: () => void }>) => (
      <button onClick={onClick}>{children}</button>
    ),
  }),
}));
import { CommentQuickActions } from "@/components/comments/quick-actions";
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("offers Reply on another person's comment without edit/delete/visibility permissions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onReply = vi.fn();
  await act(async () =>
    root.render(
      <CommentQuickActions
        comment={{ id: "other", actor: "someone" } as TIssueComment}
        activityOperations={{} as TCommentsOperations}
        setEditMode={vi.fn()}
        showCopyLinkOption
        showAccessSpecifier
        onReply={onReply}
      />
    )
  );
  expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "common.actions.reply",
    "common.actions.copy_link",
  ]);
  await act(async () => document.querySelector("button")!.click());
  expect(onReply).toHaveBeenCalledOnce();
});
