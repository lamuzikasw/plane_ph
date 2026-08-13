/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { Repeat2 } from "lucide-react";
import useSWR from "swr";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { recurringWorkItemService } from "@/services/recurring-work-item.service";
import { RecurringWorkItemScheduleModal } from "../recurring-work-items/schedule-modal";

export type TWorkItemAdditionalSidebarProperties = {
  workItemId: string;
  workItemTypeId: string | null;
  projectId: string;
  workspaceSlug: string;
  isEditable: boolean;
  isPeekView?: boolean;
};

export function WorkItemAdditionalSidebarProperties(props: TWorkItemAdditionalSidebarProperties) {
  const { workItemId, projectId, workspaceSlug, isEditable } = props;
  const [isOpen, setIsOpen] = useState(false);
  const { data, mutate } = useSWR(
    workspaceSlug && projectId && workItemId ? `RECURRING_WORK_ITEM_${projectId}_${workItemId}` : null,
    () => recurringWorkItemService.list(workspaceSlug, projectId, workItemId)
  );
  const schedule = data?.[0];
  const label = schedule
    ? `${schedule.frequency === "daily" ? "Каждый день" : "По дням"} · ${schedule.run_time.slice(0, 5)}`
    : "Не настроено";

  return (
    <>
      <SidebarPropertyListItem icon={Repeat2} label="Повторение">
        <button
          type="button"
          disabled={!isEditable}
          onClick={() => setIsOpen(true)}
          className={`group flex h-7.5 w-full grow items-center rounded-sm px-2 text-left text-body-xs-regular transition-colors hover:bg-surface-2 ${schedule ? "text-primary" : "text-placeholder"} disabled:cursor-not-allowed`}
        >
          <span className="grow truncate">{label}</span>
        </button>
      </SidebarPropertyListItem>
      <RecurringWorkItemScheduleModal
        isOpen={isOpen}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        sourceIssueId={workItemId}
        schedule={schedule}
        onClose={() => setIsOpen(false)}
        onSaved={() => void mutate()}
      />
    </>
  );
}
