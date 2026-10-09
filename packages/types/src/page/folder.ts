/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
export type TPageFolder = {
  id: string;
  project: string;
  parent: string | null;
  name: string;
  sort_order: number;
};
export type TPageLocation = { folder_id: string | null; sort_order: number };
export type TPageFolderStructure = {
  folders: TPageFolder[];
  locations: Record<string, TPageLocation>;
};
