/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { ru } from "date-fns/locale";
import { Network } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { renderFormattedTime, renderFormattedDate, calculateTimeAgo } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { IssueCreatorDisplay } from "@/plane-web/components/issues/issue-details/issue-creator";
// local imports
import { IssueUser } from "../";
import { localizeActivityNode } from "./localize-activity-node";

type TIssueActivityBlockComponent = {
  icon?: ReactNode;
  activityId: string;
  ends: "top" | "bottom" | undefined;
  children: ReactNode;
  customUserName?: string;
};

export function IssueActivityBlockComponent(props: TIssueActivityBlockComponent) {
  const { icon, activityId, ends, children, customUserName } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);
  const { isMobile } = usePlatformOS();
  const { currentLocale, t } = useTranslation();
  if (!activity) return <></>;
  const dateLocale = currentLocale === "ru" ? ru : undefined;
  const localizedChildren = localizeActivityNode(children, currentLocale, t);
  return (
    <div
      className={`relative flex items-center gap-3 text-caption-sm-regular ${
        ends === "top" ? `pb-2` : ends === "bottom" ? `pt-2` : `py-2`
      }`}
    >
      <div className="absolute top-0 bottom-0 left-[13px] w-px bg-layer-3" aria-hidden />
      <div className="z-[4] flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-layer-2 text-secondary shadow-raised-100">
        {icon ? icon : <Network className="h-3.5 w-3.5" />}
      </div>
      <div className="w-full truncate text-secondary">
        {!activity?.field && activity?.verb === "created" ? (
          <IssueCreatorDisplay activityId={activityId} customUserName={customUserName} />
        ) : (
          <IssueUser activityId={activityId} customUserName={customUserName} />
        )}
        <span> {localizedChildren} </span>
        <span>
          <Tooltip
            isMobile={isMobile}
            tooltipContent={`${renderFormattedDate(
              activity.created_at,
              currentLocale === "ru" ? "dd MMM yyyy" : "MMM dd, yyyy",
              dateLocale
            )}, ${renderFormattedTime(activity.created_at)}`}
          >
            <span className="whitespace-nowrap text-tertiary">
              {" "}
              {calculateTimeAgo(activity.created_at, dateLocale)}
            </span>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
