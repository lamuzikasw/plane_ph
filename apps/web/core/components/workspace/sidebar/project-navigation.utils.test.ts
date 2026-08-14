/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { EIssueLayoutTypes } from "@plane/types";
import { parseRememberedProjectLayout, resolveProjectNavigationLayoutTransition } from "./project-navigation.utils";

describe("project navigation layout transitions", () => {
  it("remembers the current work-items layout before opening Timeline", () => {
    expect(resolveProjectNavigationLayoutTransition("timeline", EIssueLayoutTypes.LIST, undefined)).toEqual({
      layoutToApply: EIssueLayoutTypes.GANTT,
      layoutToRemember: EIssueLayoutTypes.LIST,
    });
  });

  it("restores the remembered layout when returning to work items", () => {
    expect(
      resolveProjectNavigationLayoutTransition("work_items", EIssueLayoutTypes.GANTT, EIssueLayoutTypes.SPREADSHEET)
    ).toEqual({ layoutToApply: EIssueLayoutTypes.SPREADSHEET });
  });

  it("falls back to Kanban when an earlier Timeline visit did not remember a layout", () => {
    expect(resolveProjectNavigationLayoutTransition("work_items", EIssueLayoutTypes.GANTT, undefined)).toEqual({
      layoutToApply: EIssueLayoutTypes.KANBAN,
    });
  });

  it("does not change the layout for unrelated project tabs", () => {
    expect(
      resolveProjectNavigationLayoutTransition("pages", EIssueLayoutTypes.GANTT, EIssueLayoutTypes.KANBAN)
    ).toEqual({});
  });

  it("accepts only valid non-Gantt remembered layouts", () => {
    expect(parseRememberedProjectLayout(EIssueLayoutTypes.KANBAN)).toBe(EIssueLayoutTypes.KANBAN);
    expect(parseRememberedProjectLayout(EIssueLayoutTypes.GANTT)).toBeUndefined();
    expect(parseRememberedProjectLayout("broken-layout")).toBeUndefined();
  });
});
