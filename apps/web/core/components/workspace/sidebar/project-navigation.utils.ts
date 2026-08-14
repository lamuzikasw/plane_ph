/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EIssueLayoutTypes } from "@plane/types";

type TProjectNavigationLayoutTransition = {
  layoutToApply?: EIssueLayoutTypes;
  layoutToRemember?: EIssueLayoutTypes;
};

export function resolveProjectNavigationLayoutTransition(
  itemKey: string,
  currentLayout: EIssueLayoutTypes | undefined,
  rememberedLayout: EIssueLayoutTypes | undefined
): TProjectNavigationLayoutTransition {
  if (itemKey === "timeline") {
    return {
      layoutToApply: EIssueLayoutTypes.GANTT,
      layoutToRemember: currentLayout !== EIssueLayoutTypes.GANTT ? currentLayout : undefined,
    };
  }

  if (itemKey === "work_items" && currentLayout === EIssueLayoutTypes.GANTT) {
    return {
      layoutToApply:
        rememberedLayout && rememberedLayout !== EIssueLayoutTypes.GANTT ? rememberedLayout : EIssueLayoutTypes.KANBAN,
    };
  }

  return {};
}

export function parseRememberedProjectLayout(value: string | null): EIssueLayoutTypes | undefined {
  if (!value || value === EIssueLayoutTypes.GANTT) return undefined;

  return Object.values(EIssueLayoutTypes).includes(value as EIssueLayoutTypes)
    ? (value as EIssueLayoutTypes)
    : undefined;
}
