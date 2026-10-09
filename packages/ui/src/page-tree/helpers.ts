/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { TPageFolder } from "@plane/types";

export function getPageFolderPath(folders: TPageFolder[], id: string | null): TPageFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: TPageFolder[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    if (!folder) break;
    path.unshift(folder);
    id = folder.parent;
  }
  return path;
}

export function getPageFolderOptions(folders: TPageFolder[], excludeId?: string) {
  return folders
    .filter((folder) => !getPageFolderPath(folders, folder.id).some((ancestor) => ancestor.id === excludeId))
    .map((folder) => ({
      value: folder.id,
      label: getPageFolderPath(folders, folder.id)
        .map((f) => f.name)
        .join(" / "),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}
