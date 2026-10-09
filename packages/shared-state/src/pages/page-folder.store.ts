/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { makeAutoObservable, runInAction } from "mobx";
import type { TPageFolder, TPageFolderStructure, TPageLocation } from "@plane/types";

type FolderService = {
  fetch(slug: string, projectId: string): Promise<TPageFolderStructure>;
  create(slug: string, projectId: string, data: { name: string; parent: string | null }): Promise<TPageFolder>;
  update(
    slug: string,
    projectId: string,
    id: string,
    data: Partial<Pick<TPageFolder, "name" | "parent" | "sort_order">>
  ): Promise<TPageFolder>;
  remove(slug: string, projectId: string, id: string): Promise<void>;
  movePage(slug: string, projectId: string, pageId: string, folderId: string | null): Promise<TPageLocation>;
};

/** Structure is keyed by project: a shared page can have a different location in each project. */
export class PageFolderStore {
  structures: Record<string, TPageFolderStructure> = {};
  private requests: Record<string, number> = {};
  constructor(private service: FolderService) {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  getFolders(projectId: string): TPageFolder[] {
    return this.structures[projectId]?.folders ?? [];
  }
  getLocation(projectId: string, pageId: string): TPageLocation | undefined {
    return this.structures[projectId]?.locations[pageId];
  }
  async fetch(slug: string, projectId: string) {
    const request = (this.requests[projectId] ?? 0) + 1;
    this.requests[projectId] = request;
    const structure = await this.service.fetch(slug, projectId);
    runInAction(() => {
      if (this.requests[projectId] === request) this.structures[projectId] = structure;
    });
    return structure;
  }
  async create(slug: string, projectId: string, name: string, parent: string | null) {
    const folder = await this.service.create(slug, projectId, { name, parent });
    await this.fetch(slug, projectId);
    return folder;
  }
  async update(slug: string, projectId: string, id: string, data: Partial<Pick<TPageFolder, "name" | "parent">>) {
    await this.service.update(slug, projectId, id, data);
    await this.fetch(slug, projectId);
  }
  async remove(slug: string, projectId: string, id: string) {
    await this.service.remove(slug, projectId, id);
    await this.fetch(slug, projectId);
  }
  async movePage(slug: string, projectId: string, pageId: string, folderId: string | null) {
    const location = await this.service.movePage(slug, projectId, pageId, folderId);
    this.recordLocation(projectId, pageId, location);
  }
  recordLocation(projectId: string, pageId: string, location: TPageLocation) {
    const structure = this.structures[projectId];
    if (structure) {
      this.requests[projectId] = (this.requests[projectId] ?? 0) + 1;
      structure.locations[pageId] = location;
    }
  }
}
