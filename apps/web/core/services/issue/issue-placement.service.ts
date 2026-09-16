/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { APIService } from "@/services/api.service";
import { API_BASE_URL } from "@plane/constants";

export type TIssuePlacement = {
  id: string;
  project_id: string;
  project_name: string;
  identifier: string;
  sequence_id: number;
  is_original: boolean;
  can_remove: boolean;
};

export type TIssuePlacementsResponse = {
  enabled: boolean;
  can_manage: boolean;
  placements: TIssuePlacement[];
  available_projects: { id: string; name: string; identifier: string }[];
};

export class IssuePlacementService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private url(workspaceSlug: string, projectId: string, issueId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/placements/`;
  }

  async list(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssuePlacementsResponse> {
    return (await this.get(this.url(workspaceSlug, projectId, issueId))).data;
  }

  async attach(workspaceSlug: string, projectId: string, issueId: string, targetProjectId: string): Promise<void> {
    await this.post(this.url(workspaceSlug, projectId, issueId), { project_id: targetProjectId });
  }

  async detach(workspaceSlug: string, projectId: string, issueId: string, placementId: string): Promise<void> {
    await this.delete(`${this.url(workspaceSlug, projectId, issueId)}${placementId}/`);
  }

  async candidates(
    workspaceSlug: string,
    projectId: string,
    search: string
  ): Promise<{
    enabled: boolean;
    available_project_ids?: string[];
    results: { id: string; name: string; identifier: string }[];
  }> {
    return (
      await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/shared-issues/`, { params: { search } })
    ).data;
  }

  async addExisting(workspaceSlug: string, projectId: string, issueId: string): Promise<void> {
    await this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/shared-issues/`, { issue_id: issueId });
  }
}
