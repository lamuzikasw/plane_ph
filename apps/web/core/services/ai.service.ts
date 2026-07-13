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
  assignees: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
  }[];
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
  widgets: {
    type: "work_items";
    title: string;
    items: TIgorChatWorkItem[];
  }[];
  suggestions: string[];
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

  async askIgor(workspaceSlug: string, data: { message: string }): Promise<TIgorChatResponse> {
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
