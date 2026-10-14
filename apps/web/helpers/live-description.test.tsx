// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EFileAssetType } from "@plane/types";

type EditorProps = { value: string | null; initialValue: string; onChange: (json: object, html: string) => void };
let editorProps: EditorProps;
vi.mock("@/components/editor/rich-text", () => ({
  RichTextEditor: (props: EditorProps) => {
    editorProps = props;
    return <div data-editor />;
  },
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "workspace" }) }),
}));
vi.mock("@/hooks/store/use-editor-asset", () => ({ useEditorAsset: () => ({}) }));
vi.mock("@/services/workspace.service", () => ({ WorkspaceService: vi.fn() }));
import { DescriptionInput } from "@/components/editor/rich-text/description-input/root";

let root: ReturnType<typeof createRoot>;
const submit = vi.fn().mockResolvedValue(undefined);
async function render(value: string) {
  await act(async () =>
    root.render(
      <DescriptionInput
        entityId="issue"
        key="issue"
        workspaceSlug="workspace"
        fileAssetType={EFileAssetType.ISSUE_DESCRIPTION}
        initialValue={value}
        onSubmit={submit}
        setIsSubmitting={() => {}}
      />
    )
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  submit.mockClear();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("displays a remote description update in the existing editor without saving it back", async () => {
  await render("<p>Original</p>");
  await render("<p>Updated by colleague</p>");
  expect(editorProps.value).toBe("<p>Updated by colleague</p>");
  expect(submit).not.toHaveBeenCalled();
});
it("keeps an unsaved draft and submits it even if a remote update arrives", async () => {
  await render("<p>Original</p>");
  await act(async () => editorProps.onChange({}, "<p>My draft</p>"));
  await render("<p>Remote change</p>");
  expect(editorProps.value).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ description_html: "<p>My draft</p>" }), false);
});
