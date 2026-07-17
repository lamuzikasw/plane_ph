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
  section?: string | null;
  section_path?: string[];
};

export type TIgorSpecSourceRef = {
  id: string;
  text: string;
  section: string | null;
  section_path: string[];
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
  goal: string;
  description: string;
  acceptance_criteria: string[];
  open_questions: string[];
  confidence: "high" | "medium" | "low";
  section: string | null;
  source_ids: string[];
  project_id: string | null;
  project_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_hint: string | null;
  target_date: string | null;
  priority: "none" | "urgent" | "high" | "medium" | "low";
  missing_fields: ("project" | "assignee" | "target_date" | "priority" | "goal" | "acceptance_criteria")[];
  duplicate_issue: {
    id: string;
    name: string;
    identifier: string;
  } | null;
  kind?: "implementation" | "integration" | "content" | "testing" | "migration" | "observability" | "research";
  fact_ids?: string[];
  dependency_task_ids?: string[];
  source_refs?: TIgorSpecSourceRef[];
};

export type TIgorSpecConstraint = {
  id: string;
  kind: "in_scope" | "out_of_scope" | "invariant" | "prohibition";
  text: string;
  source_ids: string[];
};

export type TIgorSpecQuestion = {
  id: string;
  question: string;
  reason: string;
  blocking: boolean;
  source_ids: string[];
  related_task_ids: string[];
};

export type TIgorSpecContradiction = {
  id: string;
  description: string;
  source_ids: string[];
  related_task_ids: string[];
};

export type TIgorClarificationQuestion = {
  id: string;
  kind: "project" | "assignee" | "result" | "deadline" | "ambiguity";
  question: string;
  reason: string;
  blocking: boolean;
  source_ids: string[];
  related_task_ids: string[];
  answer_hint: string;
};

export type TIgorCaptureWidget = {
  type: "capture_review";
  title: string;
  token: string | null;
  source_count: number;
  covered_count: number;
  action_count: number;
  task_covered_count: number;
  batch_count: number;
  categories: TIgorCaptureCategory[];
  tasks: TIgorCaptureTask[];
  projects: {
    id: string;
    name: string;
    identifier: string;
  }[];
  members: {
    id: string;
    name: string;
    project_ids: string[];
  }[];
  source_note: string;
  clarification_round?: number;
  original_source_count?: number;
  clarification_count?: number;
  clarification_required?: boolean;
  clarification_questions?: TIgorClarificationQuestion[];
  schema_version?: "igor.spec_decomposition.v2";
  document?: {
    type: "technical_spec" | "meeting_notes" | "project_brief" | "incident_report" | "mixed" | "unknown";
    title: string;
    goal: string;
    summary: string;
    source_ids: string[];
  };
  work_package?: {
    title: string;
    goal: string;
    description: string;
    source_ids: string[];
  };
  parent_task?: {
    title: string;
    goal: string;
    description: string;
    source_ids: string[];
    source_refs: TIgorSpecSourceRef[];
  };
  spec_constraints?: TIgorSpecConstraint[];
  spec_open_questions?: TIgorSpecQuestion[];
  spec_contradictions?: TIgorSpecContradiction[];
  analysis?: {
    trace_id: string;
    mode: "llm";
    schema_version: "igor.spec_decomposition.v2";
    prompt_version: string;
    source_count: number;
    linked_source_count: number;
    unresolved_source_ids: string[];
    task_count: number;
    validation_warnings: string[];
    quality_status?: "passed" | "review";
    quality_warnings?: {
      code: string;
      message: string;
      source_ids: string[];
      task_ids: string[];
    }[];
    requires_human_review: boolean;
  };
};

export type TIgorCaptureProcessingWidget = {
  type: "capture_processing";
  title: string;
  job_id: string;
  status: "queued" | "processing" | "retrying" | "failed";
  source_count: number;
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  progress: number;
  can_retry: boolean;
  failure_code?: string | null;
  failure_stage?: string | null;
  failure_message?: string | null;
  validation_errors?: string[];
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
  search_query?: string | null;
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
  capture_job_id?: string | null;
  widgets: (TIgorWorkItemsWidget | TIgorWeeklySummaryWidget | TIgorCaptureWidget | TIgorCaptureProcessingWidget)[];
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
  assignee_assignments: Record<string, string>;
  create_parent: boolean;
  parent_project_id: string;
  parent_override: {
    title: string;
    goal: string;
    description: string;
  };
  task_overrides: Record<
    string,
    {
      title: string;
      goal: string;
      description: string;
      acceptance_criteria: string[];
      open_questions: string[];
      target_date: string | null;
      priority: TIgorCaptureTask["priority"];
    }
  >;
};

export type TIgorCaptureJobPayload = {
  action: "get_capture_job" | "retry_capture_job";
  job_id?: string;
};

export type TIgorCaptureRefinePayload = {
  action: "refine_capture_review";
  capture_token: string;
  answers: Record<string, string>;
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

  async refineIgorCaptureReview(workspaceSlug: string, data: TIgorCaptureRefinePayload): Promise<TIgorChatResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/igor-chat/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getIgorCaptureJob(workspaceSlug: string, jobId?: string): Promise<TIgorChatResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/igor-chat/`, {
      action: "get_capture_job",
      ...(jobId ? { job_id: jobId } : {}),
    } satisfies TIgorCaptureJobPayload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async retryIgorCaptureJob(workspaceSlug: string, jobId: string): Promise<TIgorChatResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/igor-chat/`, {
      action: "retry_capture_job",
      job_id: jobId,
    } satisfies TIgorCaptureJobPayload)
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
