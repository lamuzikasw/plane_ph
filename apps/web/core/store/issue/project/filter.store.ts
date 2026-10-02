/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty, isEqual, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// base class
import { computedFn } from "mobx-utils";
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import { EIssueFilterType } from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  TIssueKanbanFilters,
  IIssueFilters,
  TIssueParams,
  IssuePaginationOptions,
  TWorkItemFilterExpression,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
import { getWorkItemDisplaySettings, type TWorkItemDisplaySettings } from "@/helpers/work-item-display-settings";
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// helpers
// types
import type { IIssueRootStore } from "../root.store";
import { ProjectService } from "@/services/project";
// constants
// services

export interface IProjectIssuesFilter extends IBaseIssueFilterStore {
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    projectId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  getIssueFilters(projectId: string): IIssueFilters | undefined;
  setTemporaryFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    expression: TWorkItemFilterExpression | undefined,
    refetch?: boolean
  ) => void;
  setTemporaryDisplaySettings: (
    workspaceSlug: string,
    projectId: string,
    settings: TWorkItemDisplaySettings | undefined,
    refetch?: boolean
  ) => void;
  // action
  fetchFilters: (workspaceSlug: string, projectId: string) => Promise<void>;
  updateFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    filters: TWorkItemFilterExpression
  ) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate
  ) => Promise<void>;
}

export class ProjectIssuesFilter extends IssueFilterHelperStore implements IProjectIssuesFilter {
  // observables
  filters: { [projectId: string]: IIssueFilters } = {};
  // Shared links override the active board without changing personal preferences.
  temporaryFilters = new Map<string, TWorkItemFilterExpression>();
  temporaryDisplaySettings = new Map<string, TWorkItemDisplaySettings>();
  // root store
  rootIssueStore: IIssueRootStore;
  // services
  projectService;

  constructor(_rootStore: IIssueRootStore) {
    super();
    makeObservable(this, {
      // observables
      filters: observable,
      temporaryFilters: observable,
      temporaryDisplaySettings: observable,
      // computed
      issueFilters: computed,
      appliedFilters: computed,
      // actions
      fetchFilters: action,
      updateFilterExpression: action,
      updateFilters: action,
      setTemporaryFilterExpression: action,
      setTemporaryDisplaySettings: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.projectService = new ProjectService();
  }

  get issueFilters() {
    const projectId = this.rootIssueStore.projectId;
    if (!projectId) return undefined;

    return this.getIssueFilters(projectId);
  }

  get appliedFilters() {
    const projectId = this.rootIssueStore.projectId;
    if (!projectId) return undefined;

    return this.getAppliedFilters(projectId);
  }

  getIssueFilters(projectId: string) {
    const displayFilters = this.filters[projectId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    return this.computedIssueFilters({
      ...displayFilters,
      ...this.temporaryDisplaySettings.get(projectId),
      richFilters: this.temporaryFilters.get(projectId) ?? displayFilters.richFilters,
    });
  }

  setTemporaryFilterExpression: IProjectIssuesFilter["setTemporaryFilterExpression"] = (
    workspaceSlug,
    projectId,
    expression,
    refetch = true
  ) => {
    const previousExpression = this.getIssueFilters(projectId)?.richFilters;
    if (expression === undefined) this.temporaryFilters.delete(projectId);
    else this.temporaryFilters.set(projectId, expression);

    if (refetch && !isEqual(previousExpression, this.getIssueFilters(projectId)?.richFilters)) {
      this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
    }
  };

  setTemporaryDisplaySettings: IProjectIssuesFilter["setTemporaryDisplaySettings"] = (
    workspaceSlug,
    projectId,
    settings,
    refetch = true
  ) => {
    const previous = this.getIssueFilters(projectId)?.displayFilters;
    if (settings === undefined) this.temporaryDisplaySettings.delete(projectId);
    else this.temporaryDisplaySettings.set(projectId, getWorkItemDisplaySettings(settings));
    const next = this.getIssueFilters(projectId)?.displayFilters;
    if (!refetch || isEqual(previous, next)) return;
    if (previous?.layout !== next?.layout) this.rootIssueStore.projectIssues.clear(true);
    this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
  };

  getAppliedFilters(projectId: string) {
    const userFilters = this.getIssueFilters(projectId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "issues");
    if (!filteredParams) return undefined;

    const filteredRouteParams: Partial<Record<TIssueParams, string | boolean>> = this.computedFilteredParams(
      userFilters?.richFilters,
      userFilters?.displayFilters,
      filteredParams
    );

    return filteredRouteParams;
  }

  getFilterParams = computedFn(
    (
      options: IssuePaginationOptions,
      projectId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = this.getAppliedFilters(projectId);
      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string, projectId: string) => {
    const _filters = await this.projectService.getProjectUserProperties(workspaceSlug, projectId);

    const richFilters = _filters?.rich_filters;
    const displayFilters = this.computedDisplayFilters(_filters?.display_filters);
    const displayProperties = this.computedDisplayProperties(_filters?.display_properties);

    // fetching the kanban toggle helpers in the local storage
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    const currentUserId = this.rootIssueStore.currentUserId;
    if (currentUserId) {
      const _kanbanFilters = this.handleIssuesLocalFilters.get(
        EIssuesStoreType.PROJECT,
        workspaceSlug,
        projectId,
        currentUserId
      );
      kanbanFilters.group_by = _kanbanFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = _kanbanFilters?.kanban_filters?.sub_group_by || [];
    }

    runInAction(() => {
      set(this.filters, [projectId, "richFilters"], richFilters);
      set(this.filters, [projectId, "displayFilters"], displayFilters);
      set(this.filters, [projectId, "displayProperties"], displayProperties);
      set(this.filters, [projectId, "kanbanFilters"], kanbanFilters);
    });
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IProjectIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    filters
  ) => {
    // Edits made while following a shared link belong to that temporary board too.
    if (this.temporaryFilters.has(projectId)) {
      this.setTemporaryFilterExpression(workspaceSlug, projectId, filters);
      return;
    }
    try {
      runInAction(() => {
        set(this.filters, [projectId, "richFilters"], filters);
      });

      this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
      await this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
        rich_filters: filters,
      });
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IProjectIssuesFilter["updateFilters"] = async (workspaceSlug, projectId, type, filters) => {
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[projectId])) return;

      const displayTarget = this.temporaryDisplaySettings.get(projectId) ?? this.filters[projectId];
      const _filters = {
        richFilters: this.filters[projectId].richFilters,
        displayFilters: displayTarget.displayFilters as IIssueDisplayFilterOptions,
        displayProperties: displayTarget.displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[projectId].kanbanFilters as TIssueKanbanFilters,
      };

      switch (type) {
        case EIssueFilterType.DISPLAY_FILTERS: {
          const updatedDisplayFilters = filters as IIssueDisplayFilterOptions;
          _filters.displayFilters = { ..._filters.displayFilters, ...updatedDisplayFilters };

          // set sub_group_by to null if group_by is set to null
          if (_filters.displayFilters.group_by === null) {
            _filters.displayFilters.sub_group_by = null;
            updatedDisplayFilters.sub_group_by = null;
          }
          // set sub_group_by to null if layout is switched to kanban group_by and sub_group_by are same
          if (
            _filters.displayFilters.layout === "kanban" &&
            _filters.displayFilters.group_by === _filters.displayFilters.sub_group_by
          ) {
            _filters.displayFilters.sub_group_by = null;
            updatedDisplayFilters.sub_group_by = null;
          }
          // set group_by to state if layout is switched to kanban and group_by is null
          if (_filters.displayFilters.layout === "kanban" && _filters.displayFilters.group_by === null) {
            _filters.displayFilters.group_by = "state";
            updatedDisplayFilters.group_by = "state";
          }

          runInAction(() => {
            Object.keys(updatedDisplayFilters).forEach((_key) => {
              set(
                displayTarget,
                ["displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          if (this.getShouldClearIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.clear(true); // clear issues for local store when some filters like layout changes
          }

          if (this.getShouldReFetchIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
          }

          if (!this.temporaryDisplaySettings.has(projectId))
            await this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
              display_filters: _filters.displayFilters,
            });

          break;
        }
        case EIssueFilterType.DISPLAY_PROPERTIES: {
          const updatedDisplayProperties = filters as IIssueDisplayProperties;
          _filters.displayProperties = { ..._filters.displayProperties, ...updatedDisplayProperties };

          runInAction(() => {
            Object.keys(updatedDisplayProperties).forEach((_key) => {
              set(
                displayTarget,
                ["displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          if (!this.temporaryDisplaySettings.has(projectId))
            await this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
              display_properties: _filters.displayProperties,
            });
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.PROJECT, type, workspaceSlug, projectId, currentUserId, {
              kanban_filters: _filters.kanbanFilters,
            });

          runInAction(() => {
            Object.keys(updatedKanbanFilters).forEach((_key) => {
              set(
                this.filters,
                [projectId, "kanbanFilters", _key],
                updatedKanbanFilters[_key as keyof TIssueKanbanFilters]
              );
            });
          });

          break;
        }
        default:
          break;
      }
    } catch (error) {
      this.fetchFilters(workspaceSlug, projectId);
      throw error;
    }
  };
}
