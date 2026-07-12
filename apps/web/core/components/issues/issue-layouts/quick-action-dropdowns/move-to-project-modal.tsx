/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// components
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";

type Props = {
  issue: TIssue;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { project_id: string; state_id?: string }) => Promise<TIssue>;
  workspaceSlug: string;
};

export const MoveIssueToProjectModal = observer(function MoveIssueToProjectModal(props: Props) {
  const { issue, isOpen, onClose, onSubmit, workspaceSlug } = props;
  // states
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [targetStateId, setTargetStateId] = useState<string | undefined>(undefined);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);
  const [isLoadingStates, setIsLoadingStates] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  // hooks
  const { t } = useTranslation();
  const { getProjectById, joinedProjectIds } = useProject();
  const { fetchProjectStates, getProjectStateIds, getStateById } = useProjectState();
  // derived values
  const currentProject = getProjectById(issue.project_id);
  const targetProject = getProjectById(targetProjectId);
  const targetState = getStateById(targetStateId);
  const targetProjectIds = useMemo(
    () => joinedProjectIds.filter((projectId) => projectId !== issue.project_id),
    [issue.project_id, joinedProjectIds]
  );
  const stateIds = targetProjectId ? (getProjectStateIds(targetProjectId) ?? []) : [];
  const issueKey = currentProject?.identifier ? `${currentProject.identifier}-${issue.sequence_id}` : issue.name;

  useEffect(() => {
    if (!isOpen) return;

    setTargetProjectId(null);
    setTargetStateId(undefined);
    setIsProjectDropdownOpen(false);
    setIsStateDropdownOpen(false);
    setIsLoadingStates(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !targetProjectId) return;

    let isCurrentRequest = true;
    setIsLoadingStates(true);
    fetchProjectStates(workspaceSlug, targetProjectId)
      .then((states) => {
        if (!isCurrentRequest) return;
        setTargetStateId(states.find((state) => state.default)?.id ?? states[0]?.id);
      })
      .finally(() => {
        if (isCurrentRequest) setIsLoadingStates(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [fetchProjectStates, isOpen, targetProjectId, workspaceSlug]);

  const handleClose = () => {
    if (isMoving) return;
    onClose();
  };

  const handleMove = async () => {
    if (!targetProjectId) return;

    setIsMoving(true);
    await onSubmit({ project_id: targetProjectId, state_id: targetStateId })
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("success"),
          message: `${issue.name} moved to ${targetProject?.name ?? "project"}.`,
        });
        onClose();
      })
      .catch((error) => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("error"),
          message: error?.error ?? error?.detail ?? t("failed_to_move_issue_to_project"),
        });
      })
      .finally(() => setIsMoving(false));
  };

  const handleProjectSelect = (projectId: string) => {
    setTargetProjectId(projectId);
    setTargetStateId(undefined);
    setIsProjectDropdownOpen(false);
    setIsStateDropdownOpen(false);
  };

  const handleStateSelect = (stateId: string) => {
    setTargetStateId(stateId);
    setIsStateDropdownOpen(false);
  };

  if (!isOpen || !issue.project_id) return null;

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div
        className="space-y-5 px-5 py-4"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div>
          <h3 className="text-18 font-medium 2xl:text-20">{t("move_to_project")}</h3>
          <p className="mt-2 text-13 text-secondary">
            Move {issueKey} to another project and choose its new board column.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-12 font-medium text-secondary">Project</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsProjectDropdownOpen((isOpen) => !isOpen);
                  setIsStateDropdownOpen(false);
                }}
                disabled={isMoving || targetProjectIds.length === 0}
                className="flex h-9 w-full items-center justify-between gap-2 rounded border border-subtle bg-surface-1 px-3 text-left text-13 text-primary outline-none hover:bg-surface-2 focus:border-custom-primary-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="truncate">{targetProject?.name ?? "Select project"}</span>
                <span className="shrink-0 text-12 text-secondary">v</span>
              </button>

              {isProjectDropdownOpen && (
                <div className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded border border-subtle bg-surface-1 p-1 shadow-raised-200">
                  {targetProjectIds.length === 0 && (
                    <div className="px-2 py-2 text-13 text-secondary">No other projects available.</div>
                  )}
                  {targetProjectIds.map((projectId) => {
                    const project = getProjectById(projectId);
                    if (!project) return null;

                    return (
                      <button
                        key={projectId}
                        type="button"
                        onClick={() => handleProjectSelect(projectId)}
                        disabled={isMoving}
                        className={`flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-13 outline-none hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                          targetProjectId === projectId
                            ? "bg-custom-primary-100/10 text-custom-primary-100"
                            : "text-primary"
                        }`}
                      >
                        <span className="truncate">{project.name}</span>
                        {targetProjectId === projectId && <span className="shrink-0 text-12">Selected</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-12 font-medium text-secondary">State</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsStateDropdownOpen((isOpen) => !isOpen);
                  setIsProjectDropdownOpen(false);
                }}
                disabled={!targetProjectId || isLoadingStates || isMoving || stateIds.length === 0}
                className="flex h-9 w-full items-center justify-between gap-2 rounded border border-subtle bg-surface-1 px-3 text-left text-13 text-primary outline-none hover:bg-surface-2 focus:border-custom-primary-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="truncate">
                  {!targetProjectId ? "Select a project first" : isLoadingStates ? "Loading states..." : targetState?.name ?? "Default state"}
                </span>
                <span className="shrink-0 text-12 text-secondary">v</span>
              </button>

              {isStateDropdownOpen && (
                <div className="absolute left-0 right-0 z-40 mt-1 max-h-44 overflow-y-auto rounded border border-subtle bg-surface-1 p-1 shadow-raised-200">
                  {stateIds.map((stateId) => {
                    const state = getStateById(stateId);
                    if (!state) return null;

                    return (
                      <button
                        key={stateId}
                        type="button"
                        onClick={() => handleStateSelect(stateId)}
                        disabled={isMoving}
                        className={`flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-13 outline-none hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                          targetStateId === stateId ? "bg-custom-primary-100/10 text-custom-primary-100" : "text-primary"
                        }`}
                      >
                        <span className="truncate">{state.name}</span>
                        {targetStateId === stateId && <span className="shrink-0 text-12">Selected</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={handleClose} disabled={isMoving}>
            {t("cancel")}
          </Button>
          <Button variant="primary" size="lg" onClick={handleMove} disabled={!targetProjectId} loading={isMoving}>
            {isMoving ? t("loading") : t("move_to_project")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
