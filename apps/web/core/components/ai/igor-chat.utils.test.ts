import { describe, expect, it } from "vitest";

import type { TIgorChatContext } from "@/services/ai.service";

import { getIgorContextSegments } from "./igor-chat.utils";

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
