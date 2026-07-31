import { describe, expect, it } from "vitest";

import type { TIgorClarificationQuestion, TIgorChatContext, TIgorChatResponse } from "@/services/ai.service";

import {
  clampIgorComposerHeight,
  getIgorCaptureJobStorageKey,
  getIgorCapturePollDelay,
  getIgorCaptureProcessingWidget,
  getIgorContextSegments,
  getIgorLauncherPositionClassName,
  getIgorMessageLimit,
  getIgorRequestErrorMessage,
  getUnresolvedBlockingIgorClarifications,
  IGOR_CAPTURE_MESSAGE_LENGTH,
  IGOR_COMPOSER_MAX_HEIGHT,
  IGOR_COMPOSER_MIN_HEIGHT,
  IGOR_REGULAR_MESSAGE_LENGTH,
  isIgorCaptureJobComplete,
  resolveIgorSuggestions,
  type TIgorMessage,
  upsertIgorCaptureJobMessage,
} from "./igor-chat.utils";

describe("getIgorLauncherPositionClassName", () => {
  it("keeps Igor in the viewport corner when no work item is open", () => {
    expect(getIgorLauncherPositionClassName(false)).toBe("right-5 flex");
  });

  it("moves Igor beside a desktop peek panel and hides it behind a full-width mobile panel", () => {
    const className = getIgorLauncherPositionClassName(true);

    expect(className).toContain("hidden");
    expect(className).toContain("md:flex");
    expect(className).toContain("md:right-[calc(50%+1.25rem)]");
  });
});

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

const createClarificationQuestion = (overrides: Partial<TIgorClarificationQuestion>): TIgorClarificationQuestion => ({
  id: "CQ1",
  kind: "project",
  question: "В какой проект создать задачи?",
  reason: "Проект не указан в ТЗ.",
  blocking: true,
  source_ids: [],
  related_task_ids: ["T1", "T2"],
  answer_hint: "Выберите проект",
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

describe("getIgorRequestErrorMessage", () => {
  it("shows the safe explanation returned by the API", () => {
    expect(
      getIgorRequestErrorMessage({
        status: 503,
        data: { answer: "Игорь не настроен. Администратору нужно добавить API-ключ." },
      })
    ).toBe("Игорь не настроен. Администратору нужно добавить API-ключ.");
  });

  it("distinguishes a gateway timeout from a task access problem", () => {
    expect(getIgorRequestErrorMessage({ status: 504, data: "<html>Gateway Timeout</html>" })).toContain(
      "временно недоступен (504)"
    );
  });

  it("reports a network failure without claiming that work items are unavailable", () => {
    const message = getIgorRequestErrorMessage({ code: "ERR_NETWORK" });

    expect(message).toContain("не смог связаться с API Plane");
    expect(message).not.toContain("задач");
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

  it("updates the latest duplicate job message and removes stale progress copies", () => {
    const jobId = "job_12345678901234567890";
    const firstResponse = createResponse({ answer: "Принял ТЗ", capture_job_id: jobId });
    const latestResponse = createResponse({ answer: "Разобрал 2 из 3 пакетов", capture_job_id: jobId });
    const completedResponse = createResponse({
      answer: "ТЗ разобрано",
      capture_job_id: jobId,
      intent: "capture_review",
    });
    const messages: TIgorMessage[] = [
      { id: "assistant-stale", role: "assistant", text: firstResponse.answer, response: firstResponse },
      { id: "user-repeat", role: "user", text: "Проверь прогресс" },
      { id: "assistant-latest", role: "assistant", text: latestResponse.answer, response: latestResponse },
    ];

    const updatedMessages = upsertIgorCaptureJobMessage(messages, jobId, completedResponse);

    expect(updatedMessages.map((message) => message.id)).toEqual(["user-repeat", "assistant-latest"]);
    expect(updatedMessages[1]).toMatchObject({ text: "ТЗ разобрано", response: completedResponse });
  });

  it("uses slower polling for a failed job and backs off after network errors", () => {
    expect(getIgorCapturePollDelay("processing")).toBe(2500);
    expect(getIgorCapturePollDelay("failed")).toBe(10000);
    expect(getIgorCapturePollDelay(undefined, true)).toBe(5000);
  });

  it("finds a processing widget and requires an explicit review widget for completion", () => {
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
    expect(isIgorCaptureJobComplete(processingResponse)).toBe(false);
    expect(isIgorCaptureJobComplete(createResponse({ intent: "capture_review", widgets: [] }))).toBe(false);
    expect(
      isIgorCaptureJobComplete(
        createResponse({
          intent: "capture_review",
          widgets: [{ type: "capture_review" } as TIgorChatResponse["widgets"][number]],
        })
      )
    ).toBe(true);
  });
});

describe("capture clarification readiness", () => {
  it("treats a blocking project question as resolved after projects are assigned", () => {
    const unresolved = getUnresolvedBlockingIgorClarifications(
      [createClarificationQuestion({})],
      ["T1", "T2"],
      { T1: "project-1", T2: "project-1" },
      {},
      {}
    );

    expect(unresolved).toEqual([]);
  });

  it("does not block creation on optional assignee or deadline questions", () => {
    const unresolved = getUnresolvedBlockingIgorClarifications(
      [
        createClarificationQuestion({ kind: "assignee", blocking: false }),
        createClarificationQuestion({ id: "CQ2", kind: "deadline", blocking: false }),
      ],
      ["T1"],
      { T1: "project-1" },
      {},
      {}
    );

    expect(unresolved).toEqual([]);
  });

  it("keeps an unresolved blocking ambiguity but ignores tasks that were not selected", () => {
    const ambiguity = createClarificationQuestion({ kind: "ambiguity", related_task_ids: ["T1"] });
    const unrelatedProject = createClarificationQuestion({ id: "CQ2", related_task_ids: ["T2"] });

    expect(
      getUnresolvedBlockingIgorClarifications([ambiguity, unrelatedProject], ["T1"], { T1: "project-1" }, {}, {})
    ).toEqual([ambiguity]);
  });
});
