/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { TPageFolder, TPageFolderStructure, TPageLocation } from "@plane/types";
import { APIService } from "../api.service";

export class PageFolderService extends APIService {
  private path(slug: string, projectId: string) {
    return `/api/workspaces/${slug}/projects/${projectId}`;
  }
  async fetch(slug: string, projectId: string): Promise<TPageFolderStructure> {
    return (await this.get(`${this.path(slug, projectId)}/page-folders/`)).data;
  }
  async create(slug: string, projectId: string, data: { name: string; parent: string | null }): Promise<TPageFolder> {
    return (await this.post(`${this.path(slug, projectId)}/page-folders/`, data)).data;
  }
  async update(
    slug: string,
    projectId: string,
    id: string,
    data: Partial<Pick<TPageFolder, "name" | "parent" | "sort_order">>
  ): Promise<TPageFolder> {
    return (await this.patch(`${this.path(slug, projectId)}/page-folders/${id}/`, data)).data;
  }
  async remove(slug: string, projectId: string, id: string): Promise<void> {
    await this.delete(`${this.path(slug, projectId)}/page-folders/${id}/`);
  }
  async movePage(slug: string, projectId: string, pageId: string, folderId: string | null): Promise<TPageLocation> {
    return (await this.post(`${this.path(slug, projectId)}/pages/${pageId}/folder/`, { folder_id: folderId })).data;
  }
}
