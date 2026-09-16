/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import type { Control } from "react-hook-form";
import { Controller, useController, useWatch } from "react-hook-form";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { IssuePlacementService } from "@/services/issue/issue-placement.service";
// plane imports
import { ETabIndices } from "@plane/constants";
// types
import type { TIssue } from "@plane/types";
import { getTabIndex } from "@plane/utils";
// components
import { ProjectDropdown } from "@/components/dropdowns/project/dropdown";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueProjectSelectProps = {
  control: Control<TIssue>;
  disabled?: boolean;
  handleFormChange: () => void;
};

const placementService = new IssuePlacementService();

export const IssueProjectSelect = observer(function IssueProjectSelect(props: TIssueProjectSelectProps) {
  const { control, disabled = false, handleFormChange } = props;
  // store hooks
  const { isMobile } = usePlatformOS();
  // context hooks
  const { allowedProjectIds } = useIssueModal();
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const selectedProjectId = useWatch({ control, name: "project_id" });
  const additional = useController({ control, name: "additional_project_ids", defaultValue: [] });
  const { data: placementOptions } = useSWR(
    workspaceSlug && selectedProjectId && !disabled
      ? ["create-issue-projects", workspaceSlug, selectedProjectId]
      : null,
    () => placementService.candidates(workspaceSlug!.toString(), selectedProjectId!, "")
  );

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Controller
        control={control}
        name="project_id"
        rules={{
          required: true,
        }}
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <ProjectDropdown
              value={value}
              onChange={(projectId) => {
                onChange(projectId);
                additional.field.onChange([]);
                handleFormChange();
              }}
              multiple={false}
              buttonVariant="border-with-text"
              renderCondition={(projectId) => allowedProjectIds.includes(projectId)}
              tabIndex={getIndex("project_id")}
              disabled={disabled}
            />
          </div>
        )}
      />
      {placementOptions?.enabled && !disabled && (
        <div className="flex items-center gap-2" title={t("issue_projects.share_hint")}>
          <span className="text-body-xs-regular text-tertiary">{t("issue_projects.also_in")}</span>
          <ProjectDropdown
            multiple
            value={additional.field.value ?? []}
            onChange={(ids) => {
              additional.field.onChange(ids);
              handleFormChange();
            }}
            renderCondition={(id) => !!placementOptions.available_project_ids?.includes(id)}
            buttonVariant="border-with-text"
            placeholder={t("issue_projects.add")}
          />
        </div>
      )}
    </div>
  );
});
