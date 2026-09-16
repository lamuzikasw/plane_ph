/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Dialog } from "@headlessui/react";
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Folder, Plus, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { EIssuesStoreType } from "@plane/types";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { IssuePlacementService } from "@/services/issue/issue-placement.service";
import type { TIssuePlacement } from "@/services/issue/issue-placement.service";

const service = new IssuePlacementService();

type Props = { workspaceSlug: string; projectId: string; issueId: string; disabled: boolean };

export const IssueProjectsProperty = observer(function IssueProjectsProperty(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled } = props;
  const { t } = useTranslation();
  const { issues } = useIssues(EIssuesStoreType.PROJECT);
  const { toggleIssueProjectsModal } = useIssueDetail();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<TIssuePlacement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalOpen = isOpen || !!removing;
  useEffect(() => {
    if (!modalOpen) return;
    toggleIssueProjectsModal(true);
    return () => toggleIssueProjectsModal(false);
  }, [modalOpen, toggleIssueProjectsModal]);
  const { data, mutate } = useSWR(
    ["issue-placements", workspaceSlug, projectId, issueId],
    () => service.list(workspaceSlug, projectId, issueId),
    { revalidateOnFocus: true }
  );
  if (!data?.enabled) return null;

  const canManage = !disabled && data.can_manage;
  const available = data.available_projects.filter((project) =>
    `${project.name} ${project.identifier}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const refresh = async () => {
    await mutate();
    await issues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
  };
  const close = () => {
    if (pending) return;
    setIsOpen(false);
    setRemoving(null);
    setError(null);
    setSelected([]);
    setSearch("");
  };
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      // Each successful addition is removed from the pending selection. A retry
      // after a partial failure never produces duplicate placements.
      for (const targetId of selected) {
        // eslint-disable-next-line no-await-in-loop -- Keep retries ordered after partial success.
        await service.attach(workspaceSlug, projectId, issueId, targetId);
        setSelected((previous) => previous.filter((id) => id !== targetId));
      }
      await refresh();
      setIsOpen(false);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("issue_projects.added") });
    } catch (failure) {
      console.error("Failed to add work item to projects", failure);
      await mutate();
      setError(t("issue_projects.save_error"));
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setPending(true);
    setError(null);
    try {
      await service.detach(workspaceSlug, projectId, issueId, removing.id);
      if (removing.project_id === projectId) {
        window.location.assign(`/${workspaceSlug}/projects/${projectId}/issues/`);
        return;
      }
      await refresh();
      setRemoving(null);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("issue_projects.removed") });
    } catch (failure) {
      console.error("Failed to remove work item placement", failure);
      setError(t("issue_projects.remove_error"));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SidebarPropertyListItem icon={Folder} label={t("issue_projects.title")}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 py-1">
          {data.placements.map((placement) => (
            <span
              key={placement.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-body-xs-medium"
            >
              <a
                href={`/${workspaceSlug}/browse/${placement.identifier}-${placement.sequence_id}/`}
                title={placement.project_name}
                aria-current={placement.project_id === projectId ? "page" : undefined}
                className="focus-visible:outline-accent-primary truncate rounded-xs hover:text-accent-primary focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {placement.identifier}-{placement.sequence_id}
              </a>
              {!disabled && placement.can_remove && !placement.is_original && (
                <button
                  type="button"
                  className="focus-visible:outline-accent-primary rounded-xs p-0.5 text-tertiary hover:text-primary focus-visible:outline-2"
                  aria-label={t("issue_projects.remove_from", { project: placement.project_name })}
                  onClick={() => setRemoving(placement)}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {canManage && (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="focus-visible:outline-accent-primary inline-flex items-center gap-1 rounded-md px-2 py-1 text-body-xs-medium text-tertiary hover:bg-layer-1 hover:text-primary focus-visible:outline-2"
            >
              <Plus className="size-3.5" /> {t("issue_projects.add")}
            </button>
          )}
        </div>
      </SidebarPropertyListItem>

      <ModalCore isOpen={modalOpen} handleClose={close} position={EModalPosition.CENTER} width={EModalWidth.LG}>
        <div className="flex max-h-[85vh] flex-col p-6" data-prevent-outside-click>
          <Dialog.Title className="text-h5-medium">
            {t(removing ? "issue_projects.remove_title" : "issue_projects.add_title")}
          </Dialog.Title>
          <p className="mt-2 text-body-sm-regular text-secondary">
            {removing
              ? t("issue_projects.remove_hint", { project: removing.project_name })
              : t("issue_projects.share_hint")}
          </p>
          {!removing && (
            <>
              <input
                aria-label={t("issue_projects.search")}
                placeholder={t("issue_projects.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="mt-5 w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-body-sm-regular outline-none focus:border-accent-strong"
              />
              <div className="mt-3 min-h-20 overflow-y-auto">
                {available.map((project) => (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-layer-1"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(project.id)}
                      disabled={pending}
                      onChange={(event) =>
                        setSelected((ids) =>
                          event.target.checked ? [...ids, project.id] : ids.filter((id) => id !== project.id)
                        )
                      }
                      className="size-4 accent-[var(--color-accent-primary)]"
                    />
                    <span className="min-w-0 grow truncate text-body-sm-medium">{project.name}</span>
                    <span className="text-body-xs-regular text-tertiary">{project.identifier}</span>
                  </label>
                ))}
                {!available.length && (
                  <p className="py-4 text-body-sm-regular text-tertiary">{t("issue_projects.no_projects")}</p>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-body-sm-regular text-danger-primary">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={removing ? remove : save}
              disabled={pending || (!removing && !selected.length)}
              loading={pending}
            >
              {t(removing ? "issue_projects.remove" : "issue_projects.add_selected")}
            </Button>
          </div>
        </div>
      </ModalCore>
    </>
  );
});
