/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ru } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
// hooks
import { useTranslation } from "@plane/i18n";
import { renderFormattedDate } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
// helpers

type TIssueTargetDateActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueTargetDateActivity = observer(function IssueTargetDateActivity(props: TIssueTargetDateActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);
  const { currentLocale } = useTranslation();

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<CalendarDays size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.new_value ? `set the due date to ` : `removed the due date `}
        {activity.new_value && (
          <>
            <span className="font-medium text-primary">
              {renderFormattedDate(
                activity.new_value,
                currentLocale === "ru" ? "dd MMM yyyy" : "MMM dd, yyyy",
                currentLocale === "ru" ? ru : undefined
              )}
            </span>
          </>
        )}
        {showIssue && (activity.new_value ? ` for ` : ` from `)}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
