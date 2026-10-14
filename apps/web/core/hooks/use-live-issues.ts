import { useParams } from "next/navigation";
import { EIssuesStoreType } from "@plane/types";
import { IssueArchiveService } from "@/services/issue";
import { UserService } from "@/services/user.service";
import { WorkspaceService } from "@/services/workspace.service";
import type { IProfileIssues } from "@/store/issue/profile";
import { useIssues } from "./store/use-issues";
import { useLiveRefresh } from "./use-live-refresh";

type SupportedStore =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC
  | EIssuesStoreType.GLOBAL
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.ARCHIVED;

export function useLiveIssues(storeType: EIssuesStoreType, enabled = true) {
  const { workspaceSlug, projectId, cycleId, moduleId, viewId, globalViewId, userId } = useParams();
  const { issues, issuesFilter } = useIssues(storeType as SupportedStore);
  const supported = [
    EIssuesStoreType.PROJECT,
    EIssuesStoreType.CYCLE,
    EIssuesStoreType.MODULE,
    EIssuesStoreType.PROJECT_VIEW,
    EIssuesStoreType.EPIC,
    EIssuesStoreType.GLOBAL,
    EIssuesStoreType.PROFILE,
    EIssuesStoreType.ARCHIVED,
  ].includes(storeType);
  const filterId =
    storeType === EIssuesStoreType.CYCLE
      ? cycleId
      : storeType === EIssuesStoreType.MODULE
        ? moduleId
        : storeType === EIssuesStoreType.PROJECT_VIEW
          ? viewId
          : storeType === EIssuesStoreType.GLOBAL
            ? globalViewId
            : storeType === EIssuesStoreType.PROFILE
              ? userId
              : projectId;
  useLiveRefresh(
    enabled && supported && workspaceSlug && filterId
      ? `issues:${workspaceSlug}:${projectId}:${storeType}:${filterId}`
      : undefined,
    (canApply) => {
      const profileView = storeType === EIssuesStoreType.PROFILE ? (issues as IProfileIssues).currentView : undefined;
      return issues.refreshIssues(
        workspaceSlug!.toString(),
        projectId?.toString() ?? "",
        (options, cursor) => {
          const params = issuesFilter.getFilterParams(options, filterId!.toString(), cursor, undefined, undefined);
          if (storeType === EIssuesStoreType.PROFILE) {
            return {
              ...params,
              assignees: profileView === "assigned" ? userId!.toString() : undefined,
              created_by: profileView === "created" ? userId!.toString() : undefined,
              subscriber: profileView === "subscribed" ? userId!.toString() : undefined,
            };
          }
          return params;
        },
        () =>
          canApply() &&
          (storeType !== EIssuesStoreType.PROFILE || (issues as IProfileIssues).currentView === profileView),
        storeType === EIssuesStoreType.GLOBAL
          ? (params, signal) => new WorkspaceService().getViewIssues(workspaceSlug!.toString(), params, { signal })
          : storeType === EIssuesStoreType.PROFILE
            ? (params, signal) =>
                new UserService().getUserProfileIssues(workspaceSlug!.toString(), userId!.toString(), params, {
                  signal,
                })
            : storeType === EIssuesStoreType.ARCHIVED
              ? (params, signal) =>
                  new IssueArchiveService().getArchivedIssues(
                    workspaceSlug!.toString(),
                    projectId!.toString(),
                    params,
                    { signal }
                  )
              : undefined
      );
    }
  );
}
