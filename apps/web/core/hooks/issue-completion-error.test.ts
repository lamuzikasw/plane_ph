/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { getIssueUpdateError } from "./issue-completion-error";

describe("getIssueUpdateError", () => {
  it("lists every field required to complete a work item", () => {
    expect(
      getIssueUpdateError({
        code: ["completion_requirements_missing"],
        missing_fields: ["assignee", "target_date", "priority"],
      })
    ).toEqual({
      title: "Задача не завершена",
      message: "Заполните обязательные поля: исполнитель, дедлайн, приоритет.",
    });
  });

  it("keeps a useful fallback for unrelated API errors", () => {
    expect(getIssueUpdateError({ detail: "Недостаточно прав" })).toEqual({
      title: "Не удалось обновить задачу",
      message: "Недостаточно прав",
    });
  });
});
