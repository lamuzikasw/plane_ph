// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TPageFolder } from "@plane/types";
import { PageFolderStore } from "@plane/shared-state";
import { PageTree, getPageFolderPath, getPageFolderOptions } from "@plane/ui";

const folders: TPageFolder[] = [
  { id: "root", project: "p", parent: null, name: "Engineering", sort_order: 1 },
  { id: "child", project: "p", parent: "root", name: "Architecture", sort_order: 2 },
  { id: "other", project: "p", parent: null, name: "Team", sort_order: 3 },
];

describe("folder navigation", () => {
  it("builds breadcrumb paths and excludes a moved folder and all its descendants", () => {
    expect(getPageFolderPath(folders, "child").map((f) => f.name)).toEqual(["Engineering", "Architecture"]);
    expect(getPageFolderOptions(folders, "root")).toEqual([{ value: "other", label: "Team" }]);
    expect(getPageFolderPath(folders, "deleted")).toEqual([]);
    const cyclic = [{ ...folders[0], parent: "child" }, folders[1]];
    expect(getPageFolderPath(cyclic, "child")).toHaveLength(2);
  });

  it("opens the active document's ancestors, supports collapse, and selects folders and pages", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    const onSelectPage = vi.fn();
    const onSelectFolder = vi.fn();
    try {
      await act(async () =>
        root.render(
          <PageTree
            folders={folders}
            documents={[
              { id: "doc", name: "Authorization", folderId: "child" },
              { id: "loose", name: "Notes", folderId: null },
            ]}
            selectedPage="doc"
            labels={{
              navigation: "Documents",
              all: "All documents",
              root: "Without a folder",
              expand: "Expand",
              collapse: "Collapse",
            }}
            onSelectPage={onSelectPage}
            onSelectFolder={onSelectFolder}
          />
        )
      );
      expect(element.querySelector('[aria-current="page"]')?.textContent).toBe("Authorization");
      const select = (text: string) =>
        [...element.querySelectorAll("button")].find((button) => button.textContent === text)!;
      await act(async () => select("Authorization").click());
      expect(onSelectPage).toHaveBeenCalledWith("doc");
      await act(async () => select("Architecture").click());
      expect(onSelectFolder).toHaveBeenCalledWith("child");
      await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Collapse: Engineering"]')!.click());
      expect(element.textContent).not.toContain("Authorization");
      expect(element.textContent).toContain("Notes");
      await act(async () => select("Without a folder").click());
      expect(onSelectFolder).toHaveBeenCalledWith(null);
      await act(async () => select("All documents").click());
      expect(onSelectFolder).toHaveBeenCalledWith(undefined);
    } finally {
      await act(async () => root.unmount());
      element.remove();
    }
  });
});

describe("project folder state", () => {
  const makeService = () => ({
    fetch: vi.fn(async (_slug: string, projectId: string) => ({
      folders: folders.map((f) => ({ ...f, project: projectId })),
      locations: { doc: { folder_id: null as string | null, sort_order: 1 } },
    })),
    create: vi.fn(async () => folders[0]),
    update: vi.fn(async () => folders[0]),
    remove: vi.fn(async () => {}),
    movePage: vi.fn(async (_slug: string, _project: string, _page: string, folderId: string | null) => ({
      folder_id: folderId,
      sort_order: 1,
    })),
  });
  it("keeps a shared document's locations independent across projects", async () => {
    const store = new PageFolderStore(makeService());
    await store.fetch("workspace", "one");
    await store.fetch("workspace", "two");
    await store.movePage("workspace", "one", "doc", "child");
    expect(store.getLocation("one", "doc")?.folder_id).toBe("child");
    expect(store.getLocation("two", "doc")?.folder_id).toBeNull();
  });
  it("preserves the current location when the server rejects a move", async () => {
    const service = makeService();
    const store = new PageFolderStore(service);
    await store.fetch("workspace", "one");
    service.movePage.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(store.movePage("workspace", "one", "doc", "child")).rejects.toThrow("Forbidden");
    expect(store.getLocation("one", "doc")?.folder_id).toBeNull();
  });
  it("does not let a stale background request undo a completed move", async () => {
    const service = makeService();
    const store = new PageFolderStore(service);
    await store.fetch("workspace", "one");
    let resolve!: (value: Awaited<ReturnType<typeof service.fetch>>) => void;
    service.fetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const pending = store.fetch("workspace", "one");
    await store.movePage("workspace", "one", "doc", "child");
    resolve({ folders, locations: { doc: { folder_id: null, sort_order: 1 } } });
    await pending;
    expect(store.getLocation("one", "doc")?.folder_id).toBe("child");
  });
  it("refreshes server structure after deleting a folder", async () => {
    const service = makeService();
    const store = new PageFolderStore(service);
    await store.fetch("workspace", "one");
    service.fetch.mockResolvedValueOnce({
      folders: [folders[2]],
      locations: { doc: { folder_id: null, sort_order: 1 } },
    });
    await store.remove("workspace", "one", "root");
    expect(store.getFolders("one").map((f) => f.id)).toEqual(["other"]);
    expect(service.remove).toHaveBeenCalledWith("workspace", "one", "root");
  });
});
