/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { observer } from "mobx-react";
import { CornerDownRight, ExternalLink, Search, X } from "lucide-react";
import { Combobox } from "@headlessui/react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse, TProjectIssuesSearchParams } from "@plane/types";
import { Loader, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { generateWorkItemLink, getTabIndex } from "@plane/utils";
import useDebounce from "@/hooks/use-debounce";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useMember } from "@/hooks/store/use-member";
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import { ProjectService } from "@/services/project";
import { emptyPickerFilters, hasPickerFilters, IssuePickerFilterBar, pickerFilterParams } from "./issue-picker-filters";
import { useIssuePickerSearch } from "./use-issue-picker-search";

type Props = {
  workspaceSlug: string | undefined;
  projectId?: string;
  isOpen: boolean;
  handleClose: () => void;
  searchParams: Partial<TProjectIssuesSearchParams>;
  handleOnSubmit: (data: ISearchIssueResponse[]) => Promise<void>;
  workspaceLevelToggle?: boolean;
  defaultWorkspaceLevel?: boolean;
  searchInputPlaceholder?: string;
  workspaceLevelLabel?: string;
  workspaceLevelTooltip?: string;
  shouldHideIssue?: (issue: ISearchIssueResponse) => boolean;
  selectedWorkItemIds?: string[];
  workItemSearchServiceCallback?: (params: TProjectIssuesSearchParams) => Promise<ISearchIssueResponse[]>;
};

const projectService = new ProjectService();

export const ExistingIssuesListModal = observer(function ExistingIssuesListModal(props: Props) {
  const { t } = useTranslation();
  const {
    workspaceSlug,
    projectId,
    isOpen,
    handleClose: onClose,
    searchParams,
    handleOnSubmit,
    workspaceLevelToggle = false,
    defaultWorkspaceLevel = false,
    searchInputPlaceholder,
    shouldHideIssue,
    selectedWorkItemIds,
    workItemSearchServiceCallback,
  } = props;
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState(emptyPickerFilters);
  const [selectedIssues, setSelectedIssues] = useState<ISearchIssueResponse[]>([]);
  const [showSelected, setShowSelected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { getUserDetails } = useMember();
  const { isMobile } = usePlatformOS();
  const debouncedSearchTerm: string = useDebounce(searchTerm, 300);
  const { baseTabIndex } = getTabIndex(undefined, isMobile);
  const hasInitializedSelection = useRef(false);
  const focusSearch = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const canSelectIssue = useCallback(
    (issue: ISearchIssueResponse) => !searchParams.sub_issue || issue.can_select !== false,
    [searchParams.sub_issue]
  );
  const search = useCallback(
    (params: TProjectIssuesSearchParams) => {
      if (workItemSearchServiceCallback) return workItemSearchServiceCallback(params);
      if (!workspaceSlug || !projectId) return Promise.resolve([]);
      return projectService.projectIssuesSearch(workspaceSlug, projectId, params);
    },
    [workspaceSlug, projectId, workItemSearchServiceCallback]
  );
  const { issues, loading, loadingMore, hasMore, error, loadMore, retry } = useIssuePickerSearch(
    isOpen,
    {
      ...searchParams,
      ...pickerFilterParams(filters),
      search: debouncedSearchTerm,
      include_parented: searchParams.sub_issue === true,
      workspace_search: workspaceLevelToggle || defaultWorkspaceLevel,
    },
    search
  );
  const waitingForSearch = searchTerm !== debouncedSearchTerm;
  const filteredIssues = issues.filter((issue) => !shouldHideIssue?.(issue));
  const visibleIssues = showSelected ? selectedIssues : filteredIssues;
  const selectableIssues = visibleIssues.filter(canSelectIssue);
  const allSelected =
    selectableIssues.length > 0 &&
    selectableIssues.every((issue) => selectedIssues.some((selected) => selected.id === issue.id));
  const hasFilters = hasPickerFilters(filters);

  useEffect(() => {
    if (isOpen && !hasInitializedSelection.current && selectedWorkItemIds && issues.length > 0) {
      setSelectedIssues(issues.filter((issue) => selectedWorkItemIds.includes(issue.id) && canSelectIssue(issue)));
      hasInitializedSelection.current = true;
    }
    const unavailableIds = new Set(issues.filter((issue) => !canSelectIssue(issue)).map((issue) => issue.id));
    if (unavailableIds.size) {
      setSelectedIssues((current) =>
        current.some((issue) => unavailableIds.has(issue.id))
          ? current.filter((issue) => !unavailableIds.has(issue.id))
          : current
      );
    }
  }, [isOpen, issues, selectedWorkItemIds, canSelectIssue]);

  // Also reset when a parent closes the dialog without invoking its close button.
  useEffect(() => {
    if (isOpen) return;
    setSearchTerm("");
    setFilters(emptyPickerFilters());
    setSelectedIssues([]);
    setShowSelected(false);
    hasInitializedSelection.current = false;
  }, [isOpen]);

  const selectVisible = () => {
    const visibleIds = new Set(selectableIssues.map((issue) => issue.id));
    setSelectedIssues((current) =>
      allSelected
        ? current.filter((issue) => !visibleIds.has(issue.id))
        : [...current, ...selectableIssues.filter((issue) => !current.some((selected) => selected.id === issue.id))]
    );
  };
  const onSubmit = async () => {
    if (!selectedIssues.length || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await handleOnSubmit(selectedIssues);
      onClose();
    } catch (cause: unknown) {
      console.error("Failed to add selected work items", cause);
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: t("issue.select.filters.submit_error") });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={() => {
        if (!isSubmitting) onClose();
      }}
      position={EModalPosition.CENTER}
      width={EModalWidth.XXL}
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-16 font-semibold text-primary">
            {t(
              searchParams.sub_issue
                ? "issue.select.filters.sub_items_title"
                : searchParams.issue_relation
                  ? "issue.select.filters.relations_title"
                  : "issue.select.filters.title"
            )}
          </h2>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-sm p-1 text-secondary hover:bg-layer-1 focus-visible:outline-2"
          >
            <X className="size-4" />
          </button>
        </div>
        <Combobox
          as="div"
          className="flex min-h-0 flex-1 flex-col"
          multiple
          by="id"
          value={selectedIssues}
          onChange={(value: ISearchIssueResponse[]) => setSelectedIssues(value.filter(canSelectIssue))}
        >
          <div className="relative mx-4 mb-3">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-placeholder" aria-hidden="true" />
            <Combobox.Input
              ref={focusSearch}
              className="h-10 w-full rounded-md border border-subtle bg-transparent pr-9 pl-9 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
              placeholder={searchInputPlaceholder ?? t("issue.select.filters.search_placeholder")}
              aria-label={t("issue.select.filters.search_placeholder")}
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setShowSelected(false);
              }}
              tabIndex={baseTabIndex}
            />
            {searchTerm && (
              <button
                type="button"
                className="absolute top-2.5 right-2.5 text-secondary"
                aria-label={t("issue.select.filters.clear_search")}
                onClick={() => setSearchTerm("")}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {isOpen && workspaceSlug && (
            <IssuePickerFilterBar
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              allowProjects={workspaceLevelToggle}
              value={filters}
              onChange={(value) => {
                setFilters(value);
                setShowSelected(false);
              }}
            />
          )}
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-11 text-tertiary">
            <span aria-live="polite">
              {showSelected
                ? t("issue.select.filters.selected_list")
                : loading || waitingForSearch
                  ? t("issue.select.filters.searching")
                  : `${t("issue.select.filters.shown")}: ${filteredIssues.length}${hasMore ? "+" : ""}`}
            </span>
            <button
              type="button"
              aria-pressed={showSelected}
              className={`rounded-sm px-1 py-0.5 ${showSelected || selectedIssues.length ? "text-accent-primary" : "text-secondary"}`}
              onClick={() => setShowSelected(!showSelected)}
            >
              {showSelected
                ? t("issue.select.filters.back_to_results")
                : `${t("issue.select.filters.selected")}: ${selectedIssues.length}`}
            </button>
          </div>
          <Combobox.Options
            static
            className="vertical-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2 sm:max-h-80 sm:min-h-48"
          >
            {!showSelected && (loading || waitingForSearch) ? (
              <Loader className="space-y-3 p-3">
                <Loader.Item height="44px" />
                <Loader.Item height="44px" />
                <Loader.Item height="44px" />
              </Loader>
            ) : (
              <>
                {!showSelected && error && (
                  <div role="alert" className="px-3 py-4 text-center text-13 text-secondary">
                    <p>{t("issue.select.filters.search_error")}</p>
                    <button
                      type="button"
                      className="mt-2 text-accent-primary"
                      onClick={issues.length ? loadMore : retry}
                    >
                      {t("issue.select.filters.retry")}
                    </button>
                  </div>
                )}
                {visibleIssues.length === 0 && (showSelected || !error) && (
                  <div className="px-4 py-10 text-center">
                    <p className="text-13 text-secondary">
                      {t(showSelected ? "issue.select.empty" : "issue.select.filters.no_results")}
                    </p>
                    {!showSelected && (
                      <p className="mt-1 text-12 text-tertiary">{t("issue.select.filters.no_results_hint")}</p>
                    )}
                    {hasFilters && !showSelected && (
                      <button
                        type="button"
                        className="mt-3 text-12 text-accent-primary"
                        onClick={() => setFilters(emptyPickerFilters())}
                      >
                        {t("issue.select.filters.reset")}
                      </button>
                    )}
                  </div>
                )}
                {visibleIssues.map((issue) => {
                  const selected = selectedIssues.some((item) => item.id === issue.id);
                  const unavailable = !canSelectIssue(issue);
                  const assignees = (issue.assignee_ids ?? [])
                    .map((id) => getUserDetails(id)?.display_name)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Combobox.Option
                      key={issue.id}
                      value={issue}
                      disabled={unavailable}
                      className={({ active }) =>
                        `group my-0.5 flex items-center gap-3 rounded-md px-2 py-2.5 text-13 ${unavailable ? "cursor-default" : "cursor-pointer"} ${active ? "bg-layer-1" : selected ? "bg-layer-1/50" : ""}`
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={unavailable}
                        readOnly
                        tabIndex={-1}
                        aria-label={issue.name}
                        className="pointer-events-none size-3.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 text-12 text-secondary">
                            <IssueIdentifier
                              projectId={issue.project_id}
                              issueTypeId={issue.type_id}
                              projectIdentifier={issue.project__identifier}
                              issueSequenceId={issue.sequence_id}
                              size="xs"
                              variant="secondary"
                            />
                          </span>
                          <span className="truncate text-primary" title={issue.name}>
                            {issue.name}
                          </span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-11 text-tertiary">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: issue.state__color }}
                          />
                          <span className="truncate">{issue.state__name}</span>
                          <span>·</span>
                          <span className="truncate">{assignees || t("unassigned")}</span>
                          {workspaceLevelToggle && issue.project__name && (
                            <>
                              <span>·</span>
                              <span className="truncate">{issue.project__name}</span>
                            </>
                          )}
                        </div>
                        {unavailable && (
                          <div className="mt-1.5 flex items-center gap-1 text-11 text-secondary">
                            <CornerDownRight className="size-3 shrink-0" aria-hidden="true" />
                            {issue.parent ? (
                              <>
                                <span>{t("issue.select.filters.already_inside")}</span>
                                <a
                                  href={generateWorkItemLink({
                                    workspaceSlug,
                                    projectId: issue.parent.project_id,
                                    issueId: issue.parent.id,
                                    projectIdentifier: issue.parent.project__identifier,
                                    sequenceId: issue.parent.sequence_id,
                                  })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={issue.parent.name}
                                  className="rounded-sm text-accent-primary underline underline-offset-2 focus-visible:outline-2"
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  {issue.parent.project__identifier}-{issue.parent.sequence_id}
                                </a>
                              </>
                            ) : (
                              <span>{t("issue.select.filters.has_parent")}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <a
                        href={generateWorkItemLink({
                          workspaceSlug,
                          projectId: issue.project_id,
                          issueId: issue.id,
                          projectIdentifier: issue.project__identifier,
                          sequenceId: issue.sequence_id,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t("issue.open_in_full_screen")}: ${issue.name}`}
                        className="shrink-0 rounded-sm p-1 text-secondary opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Combobox.Option>
                  );
                })}
                {!showSelected && hasMore && !error && (
                  <div className="p-2 text-center">
                    <Button variant="secondary" onClick={loadMore} disabled={loadingMore} loading={loadingMore}>
                      {t("issue.select.filters.load_more")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Combobox.Options>
        </Combobox>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-subtle p-3">
          <button
            type="button"
            onClick={selectVisible}
            disabled={!selectableIssues.length || (!showSelected && (loading || waitingForSearch))}
            className="text-12 text-accent-primary disabled:opacity-40"
          >
            {t(allSelected ? "issue.select.deselect_all" : "issue.select.filters.select_shown")}
          </button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="lg" onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={onSubmit}
              loading={isSubmitting}
              disabled={isSubmitting || !selectedIssues.length}
            >
              {isSubmitting ? t("common.adding") : `${t("issue.select.filters.add")} (${selectedIssues.length})`}
            </Button>
          </div>
        </div>
      </div>
    </ModalCore>
  );
});
