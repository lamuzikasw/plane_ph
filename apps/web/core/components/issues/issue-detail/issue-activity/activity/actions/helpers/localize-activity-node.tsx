/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import type { TLanguage } from "@plane/i18n";

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

const ACTIVITY_TEXT_KEYS: Record<string, string> = {
  "created the work item via": "created_work_item_via",
  "created the work item.": "created_work_item",
  "deleted a work item.": "deleted_work_item",
  "set the start date to": "set_start_date",
  "removed the start date": "removed_start_date",
  "set the due date to": "set_due_date",
  "removed the due date": "removed_due_date",
  "set the name to": "set_name",
  "set the state to": "set_state",
  "set the priority to": "set_priority",
  "updated the description": "updated_description",
  "added a new assignee": "added_assignee",
  "removed the assignee": "removed_assignee",
  "uploaded a new attachment": "uploaded_attachment",
  "removed an attachment": "removed_attachment",
  "added this work item to the cycle": "added_to_cycle",
  "set the cycle to": "set_cycle",
  "removed the work item from the cycle": "removed_from_cycle",
  "set the estimate point to": "set_estimate",
  "removed the estimate point": "removed_estimate",
  "added this work item to the module": "added_to_module",
  "set the module to": "set_module",
  "removed the work item from the module": "removed_from_module",
  "set the parent to": "set_parent",
  "removed the parent": "removed_parent",
  "added a new label": "added_label",
  "removed the label": "removed_label",
  added: "added_link",
  "updated the": "updated_link",
  "removed this": "removed_link",
  link: "link",
  "restored the work item": "restored_work_item",
  "archived the work item": "archived_work_item",
  "declined this work item from intake.": "declined_from_intake",
  "snoozed this work item.": "snoozed_work_item",
  "accepted this work item from intake.": "accepted_from_intake",
  "declined this work item from intake by marking a duplicate work item.": "declined_duplicate",
  "updated intake work item status.": "updated_intake_status",
  "marked this work item is blocking work item": "marked_blocking",
  "removed the blocking work item": "removed_blocking",
  "marked this work item is being blocked by": "marked_blocked_by",
  "removed this work item being blocked by work item": "removed_blocked_by",
  "marked this work item as duplicate of": "marked_duplicate",
  "removed this work item as a duplicate of": "removed_duplicate",
  "marked that this work item relates to": "marked_related",
  "removed the relation from": "removed_relation",
  for: "for",
  from: "from",
  to: "to",
  of: "of",
};

export function localizeActivityText(text: string, currentLocale: TLanguage, t: TTranslate): string {
  if (currentLocale !== "ru") return text;

  const match = text.match(/^(\s*)(.*?)(\s*)$/s);
  if (!match) return text;

  const [, leadingWhitespace, content, trailingWhitespace] = match;
  const key = ACTIVITY_TEXT_KEYS[content];
  if (!key) return text;

  return `${leadingWhitespace}${t(`activity_actions.${key}`)}${trailingWhitespace}`;
}

export function localizeActivityNode(node: ReactNode, currentLocale: TLanguage, t: TTranslate): ReactNode {
  if (currentLocale !== "ru") return node;
  if (typeof node === "string") return localizeActivityText(node, currentLocale, t);
  if (!isValidElement<{ children?: ReactNode }>(node) || node.props.children === undefined) return node;

  const element = node as ReactElement<{ children?: ReactNode }>;
  const children = Children.map(element.props.children, (child) => localizeActivityNode(child, currentLocale, t));
  return cloneElement(element, undefined, children);
}
