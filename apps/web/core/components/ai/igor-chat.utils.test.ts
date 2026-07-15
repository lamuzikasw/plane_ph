import { describe, expect, it } from "vitest";

import type { TIgorChatContext, TIgorChatResponse } from "@/services/ai.service";

import {
  clampIgorComposerHeight,
  getIgorCaptureJobStorageKey,
  getIgorCapturePollDelay,
  getIgorCaptureProcessingWidget,
  getIgorContextSegments,
  getIgorMessageLimit,
  IGOR_CAPTURE_MESSAGE_LENGTH,
  IGOR_COMPOSER_MAX_HEIGHT,
  IGOR_COMPOSER_MIN_HEIGHT,
  IGOR_REGULAR_MESSAGE_LENGTH,
  resolveIgorSuggestions,
  type TIgorMessage,
  upsertIgorCaptureJobMessage,
} from "./igor-chat.utils";

const createContext = (overrides: Partial<TIgorChatContext> = {}): TIgorChatContext => ({
  intent: "weekly_summary",
  project_id: null,
  project_name: null,
  project_ids: [],
  project_names: [],
  member_id: null,
  member_name: null,
  period_label: "Прошлая неделя",
  period_start: "2026-07-06",
  period_end: "2026-07-12",
  scope: "personal",
  summary_format: "standard",
  summary_audience: "self",
  ...overrides,
});

const createResponse = (overrides: Partial<TIgorChatResponse> = {}): TIgorChatResponse => ({
  assistant: "Игорь",
  intent: "capture_processing",
  answer: "Разбираю ТЗ",
  capture_job_id: "job_12345678901234567890",
  period: { label: "", start: null, end: null },
  context: createContext({ intent: "capture_processing", period_label: null }),
  widgets: [],
  suggestions: [],
  ...overrides,
});

describe("getIgorContextSegments", () => {
  it("describes a personal report without exposing unrelated projects", () => {
    expect(getIgorContextSegments(createContext())).toEqual(["Мои задачи", "Прошлая неделя"]);
  });

  it("shows the selected employee and manager audience", () => {
    expect(
      getIgorContextSegments(
        createContext({ scope: "member", member_name: "Анна Петрова", summary_audience: "manager" })
      )
    ).toEqual(["Анна Петрова", "Прошлая неделя", "Для руководителя"]);
  });

  it("lists explicitly selected projects", () => {
    expect(
      getIgorContextSegments(createContext({ scope: "projects", project_names: ["DevOPS", "PayHolder HUB"] }))
    ).toEqual(["DevOPS, PayHolder HUB", "Прошлая неделя"]);
  });

  it("labels access across all projects clearly", () => {
    expect(getIgorContextSegments(createContext({ scope: "all_projects", period_label: null }))).toEqual([
      "Все проекты",
    ]);
  });
});

describe("clampIgorComposerHeight", () => {
  it("does not shrink the editor below its usable minimum", () => {
    expect(clampIgorComposerHeight(20, 720)).toBe(IGOR_COMPOSER_MIN_HEIGHT);
  });

  it("limits the editor so the conversation remains visible", () => {
    expect(clampIgorComposerHeight(500, 480)).toBe(220);
  });

  it("uses the full editor maximum in a tall panel", () => {
    expect(clampIgorComposerHeight(500, 900)).toBe(IGOR_COMPOSER_MAX_HEIGHT);
  });
});

describe("resolveIgorSuggestions", () => {
  it("preserves an explicitly empty response to hide duplicate action chips", () => {
    expect(resolveIgorSuggestions([], ["Собери мой summary"])).toEqual([]);
  });

  it("uses initial suggestions only when the API did not provide them", () => {
    expect(resolveIgorSuggestions(undefined, ["Собери мой summary"])).toEqual(["Собери мой summary"]);
  });
});

describe("getIgorMessageLimit", () => {
  it("keeps ordinary questions within the regular chat limit", () => {
    expect(getIgorMessageLimit("Покажи мои задачи")).toBe(IGOR_REGULAR_MESSAGE_LENGTH);
  });

  it("accepts an explicitly requested large specification", () => {
    expect(getIgorMessageLimit("Разбери ТЗ и предложи задачи:\n" + "Требование\n".repeat(800))).toBe(
      IGOR_CAPTURE_MESSAGE_LENGTH
    );
  });

  it("recognizes a pasted multi-line specification without a command", () => {
    const specification = Array.from({ length: 10 }, (_, index) => `${index + 1}. ${"Требование ".repeat(60)}`).join(
      "\n"
    );
    expect(specification.length).toBeGreaterThan(IGOR_REGULAR_MESSAGE_LENGTH);
    expect(getIgorMessageLimit(specification)).toBe(IGOR_CAPTURE_MESSAGE_LENGTH);
  });
});

describe("capture job recovery", () => {
  it("isolates persisted jobs by workspace", () => {
    expect(getIgorCaptureJobStorageKey("payholder")).toBe("plane:igor:capture-job:payholder");
    expect(getIgorCaptureJobStorageKey("devops")).not.toBe(getIgorCaptureJobStorageKey("payholder"));
  });

  it("restores a missing progress message after reload", () => {
    const response = createResponse();
    const messages = upsertIgorCaptureJobMessage([], response.capture_job_id as string, response);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: `assistant-job-${response.capture_job_id}`,
      role: "assistant",
      text: "Разбираю ТЗ",
      response,
    });
  });

  it("updates the same job without duplicating the message or losing request context", () => {
    const jobId = "job_12345678901234567890";
    const initialResponse = createResponse({ answer: "Принял ТЗ", capture_job_id: jobId });
    const initialMessage: TIgorMessage = {
      id: "assistant-original",
      role: "assistant",
      text: initialResponse.answer,
      response: initialResponse,
      request: { message: "Разбери ТЗ", history: [] },
    };
    const completedResponse = createResponse({
      answer: "ТЗ разобрано",
      capture_job_id: jobId,
      intent: "capture_review",
    });

    const messages = upsertIgorCaptureJobMessage([initialMessage], jobId, completedResponse);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-original",
      text: "ТЗ разобрано",
      request: initialMessage.request,
      response: completedResponse,
    });
  });

  it("uses slower polling for a failed job and backs off after network errors", () => {
    expect(getIgorCapturePollDelay("processing")).toBe(2500);
    expect(getIgorCapturePollDelay("failed")).toBe(10000);
    expect(getIgorCapturePollDelay(undefined, true)).toBe(5000);
  });

  it("finds a processing widget and treats a review response as terminal", () => {
    const processingResponse = createResponse({
      widgets: [
        {
          type: "capture_processing",
          title: "Разбор большого ТЗ",
          job_id: "job_12345678901234567890",
          status: "processing",
          source_count: 150,
          total_batches: 6,
          completed_batches: 2,
          failed_batches: 0,
          progress: 33,
          can_retry: false,
        },
      ],
    });

    expect(getIgorCaptureProcessingWidget(processingResponse)?.progress).toBe(33);
    expect(getIgorCaptureProcessingWidget(createResponse({ intent: "capture_review", widgets: [] }))).toBeUndefined();
  });
});
