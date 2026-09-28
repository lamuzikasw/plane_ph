/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { ChevronDown, CircleDashed, Folder, SlidersHorizontal, Tag, SignalHigh, UserRound, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { CustomSearchSelect } from "@plane/ui";
import { useProject } from "@/hooks/store/use-project";
import { useMember } from "@/hooks/store/use-member";
import { useLabel } from "@/hooks/store/use-label";
import { useUser } from "@/hooks/store/user";

export type IssuePickerFilters = Record<
  "project_ids" | "state_groups" | "assignees" | "priorities" | "label_ids",
  string[]
>;
export const emptyPickerFilters = (): IssuePickerFilters => ({
  project_ids: [],
  state_groups: [],
  assignees: [],
  priorities: [],
  label_ids: [],
});
export const hasPickerFilters = (filters: IssuePickerFilters) =>
  Object.values(filters).some((values) => values.length > 0);
export function pickerFilterParams(filters: IssuePickerFilters) {
  return {
    project_ids: filters.project_ids.join(",") || undefined,
    state_groups: filters.state_groups.join(",") || undefined,
    assignee_ids: filters.assignees.filter((id) => id !== "unassigned").join(",") || undefined,
    unassigned: filters.assignees.includes("unassigned"),
    priorities: filters.priorities.join(",") || undefined,
    label_ids: filters.label_ids.join(",") || undefined,
  };
}

type Props = {
  workspaceSlug: string;
  projectId?: string;
  allowProjects: boolean;
  value: IssuePickerFilters;
  onChange: (value: IssuePickerFilters) => void;
};

export const IssuePickerFilterBar = observer(function IssuePickerFilterBar({
  workspaceSlug,
  projectId,
  allowProjects,
  value,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const { joinedProjectIds, getProjectById } = useProject();
  const {
    getUserDetails,
    workspace: { workspaceMemberIds, fetchWorkspaceMembers },
  } = useMember();
  const { workspaceLabels, fetchWorkspaceLabels } = useLabel();
  const { data: user } = useUser();
  const [expanded, setExpanded] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOptionsError(false);
    Promise.all([fetchWorkspaceMembers(workspaceSlug), fetchWorkspaceLabels(workspaceSlug)]).catch((error: unknown) => {
      console.error("Failed to load issue picker filter options", error);
      if (!cancelled) setOptionsError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, fetchWorkspaceMembers, fetchWorkspaceLabels, retry]);

  const projectIds = allowProjects ? value.project_ids : projectId ? [projectId] : [];
  const members =
    user && workspaceMemberIds?.includes(user.id)
      ? [user.id, ...workspaceMemberIds.filter((id) => id !== user.id)]
      : (workspaceMemberIds ?? []);
  const groups = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;
  const priorities = ["urgent", "high", "medium", "low", "none"] as const;
  const options = {
    project_ids: joinedProjectIds.map((id) => ({ id, name: getProjectById(id)?.name ?? id })),
    state_groups: groups.map((id) => ({ id, name: t(`issue.select.filters.states.${id}`) })),
    assignees: [
      ...members.map((id) => ({
        id,
        name: id === user?.id ? t("issue.select.filters.me") : (getUserDetails(id)?.display_name ?? id),
      })),
      { id: "unassigned", name: t("unassigned") },
    ],
    priorities: priorities.map((id) => ({ id, name: t(`issue.select.filters.priority_values.${id}`) })),
    label_ids: (workspaceLabels ?? [])
      .filter((label) => !label.project_id || projectIds.length === 0 || projectIds.includes(label.project_id))
      .map((label) => ({
        id: label.id,
        name:
          allowProjects && label.project_id
            ? `${label.name} · ${getProjectById(label.project_id)?.name ?? ""}`
            : label.name,
      })),
  };
  const definitions = [
    { key: "project_ids", icon: Folder, visible: allowProjects },
    { key: "state_groups", icon: CircleDashed, visible: true },
    { key: "assignees", icon: UserRound, visible: true },
    { key: "priorities", icon: SignalHigh, visible: expanded },
    { key: "label_ids", icon: Tag, visible: expanded },
  ] as const;
  const moreCount = value.priorities.length + value.label_ids.length;

  return (
    <div className="space-y-2 border-b border-subtle px-4 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        {definitions
          .filter((definition) => definition.visible)
          .map(({ key, icon: Icon }) => (
            <CustomSearchSelect
              key={key}
              multiple
              value={value[key]}
              onChange={(ids: string[]) => onChange({ ...value, [key]: ids })}
              options={options[key].map(({ id, name }) => ({ value: id, query: name, content: name }))}
              noResultsMessage={t("issue.select.filters.no_options")}
              customButtonClassName={`h-8 gap-1.5 rounded-md border px-2.5 text-12 ${value[key].length ? "border-accent-strong bg-layer-1 text-accent-primary" : "border-subtle text-secondary"}`}
              optionsClassName="z-[60] max-w-80"
              customButton={
                <>
                  <Icon className="size-3.5" />
                  <span>{t(`issue.select.filters.${key}`)}</span>
                  {value[key].length > 0 && <span>{value[key].length}</span>}
                  <ChevronDown className="size-3" />
                </>
              }
            />
          ))}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-12 text-secondary hover:bg-layer-1 focus-visible:outline-2"
        >
          <SlidersHorizontal className="size-3.5" />
          {t("issue.select.filters.more")}
          {moreCount > 0 && ` (${moreCount})`}
        </button>
      </div>
      {hasPickerFilters(value) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {definitions.flatMap(({ key }) =>
            value[key].map((id) => {
              const name =
                options[key].find((option) => option.id === id)?.name ??
                (key === "label_ids" ? workspaceLabels?.find((label) => label.id === id)?.name : undefined) ??
                id;
              return (
                <button
                  type="button"
                  key={`${key}-${id}`}
                  onClick={() => onChange({ ...value, [key]: value[key].filter((selected) => selected !== id) })}
                  className="flex max-w-full items-center gap-1 rounded-md bg-layer-1 px-2 py-1 text-11 text-secondary hover:bg-layer-2"
                  aria-label={`${t("issue.select.filters.remove")}: ${name}`}
                >
                  <span className="truncate">
                    {t(`issue.select.filters.${key}`)}: {name}
                  </span>
                  <X className="size-3 shrink-0" />
                </button>
              );
            })
          )}
          <button
            type="button"
            className="px-1 text-11 text-accent-primary"
            onClick={() => onChange(emptyPickerFilters())}
          >
            {t("issue.select.filters.reset")}
          </button>
        </div>
      )}
      {optionsError && (
        <button type="button" className="text-12 text-secondary" onClick={() => setRetry((count) => count + 1)}>
          {t("issue.select.filters.options_error")}
        </button>
      )}
    </div>
  );
});
