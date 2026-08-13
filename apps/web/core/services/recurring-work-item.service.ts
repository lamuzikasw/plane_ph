import { API_BASE_URL } from "@plane/constants";
import type { TRecurringWorkItem, TRecurringWorkItemPayload } from "@plane/types";
import { APIService } from "@/services/api.service";

export class RecurringWorkItemService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private basePath(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/recurring-work-items/`;
  }

  async list(workspaceSlug: string, projectId: string, sourceIssueId?: string): Promise<TRecurringWorkItem[]> {
    return this.get(this.basePath(workspaceSlug, projectId), {
      params: sourceIssueId ? { source_issue_id: sourceIssueId } : {},
    })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(
    workspaceSlug: string,
    projectId: string,
    payload: TRecurringWorkItemPayload
  ): Promise<TRecurringWorkItem> {
    return this.post(this.basePath(workspaceSlug, projectId), payload)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    scheduleId: string,
    payload: Partial<TRecurringWorkItemPayload>
  ): Promise<TRecurringWorkItem> {
    return this.patch(`${this.basePath(workspaceSlug, projectId)}${scheduleId}/`, payload)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, projectId: string, scheduleId: string): Promise<void> {
    return this.delete(`${this.basePath(workspaceSlug, projectId)}${scheduleId}/`).then(() => undefined);
  }
}

export const recurringWorkItemService = new RecurringWorkItemService();
