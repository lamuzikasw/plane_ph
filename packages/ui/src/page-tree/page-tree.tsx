/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Layers } from "lucide-react";
import type { TPageFolder } from "@plane/types";
import { cn } from "../utils";
import { getPageFolderPath } from "./helpers";

export type TPageTreeDocument = { id: string; name: string; folderId: string | null };
type Props = {
  folders: TPageFolder[];
  documents: TPageTreeDocument[];
  selectedFolder?: string | null;
  selectedPage?: string;
  labels: { navigation: string; all: string; root: string; expand: string; collapse: string };
  onSelectFolder: (id: string | null | undefined) => void;
  onSelectPage: (id: string) => void;
  renderFolderActions?: (folder: TPageFolder) => React.ReactNode;
};
const rowClass =
  "flex min-h-8 w-full items-center gap-2 rounded px-2 py-1 text-left text-13 hover:bg-layer-transparent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

export function PageTree(props: Props) {
  const {
    folders,
    documents,
    selectedFolder,
    selectedPage,
    labels,
    onSelectFolder,
    onSelectPage,
    renderFolderActions,
  } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const activeFolder = selectedPage ? documents.find((doc) => doc.id === selectedPage)?.folderId : selectedFolder;
  const ancestorIds = getPageFolderPath(folders, activeFolder ?? null)
    .map((folder) => folder.id)
    .join(",");
  useEffect(() => {
    if (ancestorIds) setExpanded((prev) => new Set([...prev, ...ancestorIds.split(",")]));
  }, [ancestorIds]);

  const renderChildren = (parent: string | null, seen: Set<string>): React.ReactNode => (
    <ul className={parent ? "ml-3 border-l border-subtle pl-1" : "space-y-0.5"}>
      {folders
        .filter((f) => f.parent === parent && !seen.has(f.id))
        .map((folder) => {
          const isOpen = expanded.has(folder.id);
          return (
            <li key={folder.id}>
              <div
                className={cn(
                  "group flex items-center rounded",
                  selectedFolder === folder.id && !selectedPage && "bg-layer-transparent-selected"
                )}
              >
                <button
                  type="button"
                  aria-label={`${isOpen ? labels.collapse : labels.expand}: ${folder.name}`}
                  aria-expanded={isOpen}
                  className="shrink-0 rounded p-1 text-tertiary focus-visible:ring-2 focus-visible:ring-accent-strong"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (isOpen) next.delete(folder.id);
                      else next.add(folder.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight className={cn("size-3.5", isOpen && "rotate-90")} />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectFolder(folder.id)}
                  className={cn(rowClass, "min-w-0 flex-1 px-1")}
                  aria-current={selectedFolder === folder.id && !selectedPage ? "location" : undefined}
                  title={folder.name}
                >
                  {isOpen ? (
                    <FolderOpen className="size-4 shrink-0 text-tertiary" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-tertiary" />
                  )}
                  <span className="truncate">{folder.name}</span>
                </button>
                {renderFolderActions?.(folder)}
              </div>
              {isOpen && renderChildren(folder.id, new Set([...seen, folder.id]))}
            </li>
          );
        })}
      {documents
        .filter((doc) => doc.folderId === parent)
        .map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() => onSelectPage(doc.id)}
              title={doc.name}
              aria-current={selectedPage === doc.id ? "page" : undefined}
              className={cn(rowClass, "pl-6", selectedPage === doc.id && "bg-layer-transparent-selected text-primary")}
            >
              <FileText className="size-3.5 shrink-0 text-tertiary" />
              <span className="truncate">{doc.name}</span>
            </button>
          </li>
        ))}
    </ul>
  );
  return (
    <nav aria-label={labels.navigation} className="space-y-2">
      <button
        type="button"
        onClick={() => onSelectFolder(undefined)}
        className={cn(rowClass, selectedFolder === undefined && !selectedPage && "bg-layer-transparent-selected")}
        aria-current={selectedFolder === undefined && !selectedPage ? "location" : undefined}
      >
        <Layers className="size-4 text-tertiary" />
        {labels.all}
      </button>
      <button
        type="button"
        onClick={() => onSelectFolder(null)}
        className={cn(rowClass, selectedFolder === null && !selectedPage && "bg-layer-transparent-selected")}
        aria-current={selectedFolder === null && !selectedPage ? "location" : undefined}
      >
        <FileText className="size-4 text-tertiary" />
        {labels.root}
      </button>
      <div className="border-t border-subtle pt-2">{renderChildren(null, new Set())}</div>
    </nav>
  );
}
