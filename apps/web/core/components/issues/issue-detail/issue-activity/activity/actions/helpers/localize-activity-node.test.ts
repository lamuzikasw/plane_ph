/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { localizeActivityText } from "./localize-activity-node";

const translations: Record<string, string> = {
  "activity_actions.created_work_item": "создал задачу.",
  "activity_actions.set_due_date": "установил срок:",
};

const t = (key: string) => translations[key] ?? key;

describe("localizeActivityText", () => {
  it("translates known activity text and preserves whitespace", () => {
    expect(localizeActivityText(" set the due date to ", "ru", t)).toBe(" установил срок: ");
  });

  it("leaves activity text unchanged outside the scoped Russian locale", () => {
    expect(localizeActivityText(" created the work item.", "en", t)).toBe(" created the work item.");
  });

  it("leaves dynamic values and unknown text unchanged", () => {
    expect(localizeActivityText("Backlog", "ru", t)).toBe("Backlog");
  });
});
