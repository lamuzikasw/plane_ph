/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// helpers
import { API_BASE_URL } from "@plane/constants";
import type { AI_EDITOR_TASKS } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";
// types
// FIXME:
// import { IGptResponse } from "@plane/types";
// helpers

export type TTaskPayload = {
  casual_score?: number;
  formal_score?: number;
  task: AI_EDITOR_TASKS;
  text_input: string;
};

export type TIgorChatWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_name: string;
  project_identifier: string;
  state_name: string | null;
  state_group: string | null;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  url?: string;
  note?: string;
  assignees: {
    id: string;
    name: string;
  }[];
};

export type TIgorWeeklySummaryMetric = {
  key: "completed" | "progressed" | "deadline_changes" | "blocked" | "overdue" | "next_week";
  label: string;
  value: number;
};

export type TIgorWeeklySummarySection = {
  key: TIgorWeeklySummaryMetric["key"];
  title: string;
  description: string;
  empty_text: string;
  total: number;
  items: TIgorChatWorkItem[];
};

export type TIgorWorkItemsWidget = {
  type: "work_items";
  title: string;
  items: TIgorChatWorkItem[];
  total?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
};

export type TIgorWeeklySummaryWidget = {
  type: "weekly_summary";
  title: string;
  scope: string;
  period_label: string;
  period_range: string;
  summary_format: "compact" | "standard" | "detailed";
  summary_audience: "self" | "manager";
  overview: string;
  attention: string[];
  metrics: TIgorWeeklySummaryMetric[];
  sections: TIgorWeeklySummarySection[];
  copy_text: string;
  source_note: string;
};

export type TIgorCaptureCategoryItem = {
  source_id: string;
  summary: string;
  source_text: string;
};

export type TIgorCaptureCategory = {
  key: "action" | "decision" | "risk" | "question" | "context" | "unclassified";
  title: string;
  count: number;
  items: TIgorCaptureCategoryItem[];
};

export type TIgorCaptureTask = {
  id: string;
  title: string;
  description: string;
  source_ids: string[];
  project_id: string | null;
  project_name: string | null;
  assignee_id: string;
  assignee_name: string;
  target_date: string | null;
  priority: "none" | "urgent" | "high" | "medium" | "low";
  missing_fields: ("project" | "target_date" | "priority")[];
  duplicate_issue: {
    id: string;
    name: string;
    identifier: string;
  } | null;
};

export type TIgorCaptureWidget = {
  type: "capture_review";
  title: string;
  token: string | null;
  source_count: number;
  covered_count: number;
  categories: TIgorCaptureCategory[];
  tasks: TIgorCaptureTask[];
  projects: {
    id: string;
    name: string;
    identifier: string;
  }[];
  source_note: string;
};

export type TIgorChatContext = {
  intent: string;
  project_id: string | null;
  project_name: string | null;
  project_ids: string[];
  project_names: string[];
  member_id: string | null;
  member_name: string | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  scope: "personal" | "member" | "projects" | "all_projects";
  summary_format: "compact" | "standard" | "detailed";
  summary_audience: "self" | "manager";
};

export type TIgorChatHistoryItem = {
  role: "user" | "assistant";
  text: string;
  context?: Partial<TIgorChatContext> | null;
};

export type TIgorChatResponse = {
  assistant: string;
  intent: string;
  answer: string;
  period: {
    label: string;
    start: string | null;
    end: string | null;
  };
  context: TIgorChatContext;
  widgets: (TIgorWorkItemsWidget | TIgorWeeklySummaryWidget | TIgorCaptureWidget)[];
  suggestions: string[];
};

export type TIgorChatPayload = {
  message: string;
  history?: TIgorChatHistoryItem[];
  context?: Partial<TIgorChatContext> | null;
  limit?: number;
  offset?: number;
};

export type TIgorCaptureCreatePayload = {
  action: "create_capture_tasks";
  capture_token: string;
  task_ids: string[];
  project_assignments: Record<string, string>;
  task_overrides: Record<
    string,
    {
      title: string;
      target_date: string | null;
      priority: TIgorCaptureTask["priority"];
    }
  >;
};

export class AIService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async createGptTask(workspaceSlug: string, data: { prompt: string; task: string }): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/ai-assistant/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async askIgor(workspaceSlug: string, data: TIgorChatPayload): Promise<TIgorChatResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/igor-chat/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async createIgorCaptureTasks(workspaceSlug: string, data: TIgorCaptureCreatePayload): Promise<TIgorChatResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/igor-chat/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async performEditorTask(
    workspaceSlug: string,
    data: TTaskPayload
  ): Promise<{
    response: string;
  }> {
    return this.post(`/api/workspaces/${workspaceSlug}/rephrase-grammar/`, data)
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
