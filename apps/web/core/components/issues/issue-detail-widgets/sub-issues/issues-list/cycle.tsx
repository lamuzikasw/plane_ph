/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { getBadgeStyling } from "@plane/propel/badge";
import { CycleIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
import { useCycle } from "@/hooks/store/use-cycle";

type Props = {
  workspaceSlug: string;
  projectId: string | null;
  cycleId: string;
};

export const SubIssueCycle = observer(function SubIssueCycle({ workspaceSlug, projectId, cycleId }: Props) {
  const { t } = useTranslation();
  const { getCycleById, fetchCycleDetails } = useCycle();
  const cycle = getCycleById(cycleId);

  useSWR(
    projectId && !cycle ? `SUB_ISSUE_CYCLE_${workspaceSlug}_${projectId}_${cycleId}` : null,
    () => fetchCycleDetails(workspaceSlug, projectId!, cycleId),
    { revalidateOnFocus: false, revalidateIfStale: false }
  );

  const name = cycle?.name ?? t("common.cycle");
  const label = cycle?.name ? `${t("common.cycle")}: ${name}` : name;

  return (
    <span
      className={cn(
        getBadgeStyling("neutral", "base"),
        "max-w-full shrink-0 self-start @min-[20rem]/sub-issue:max-w-40 @min-[20rem]/sub-issue:self-auto"
      )}
      title={label}
      aria-label={label}
    >
      <CycleIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
});
