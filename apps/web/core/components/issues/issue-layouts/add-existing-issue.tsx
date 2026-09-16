/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Dialog } from "@headlessui/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Link2 } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { IssuePlacementService } from "@/services/issue/issue-placement.service";

const service = new IssuePlacementService();

type Props = { workspaceSlug: string; projectId: string; onAdded: () => Promise<unknown> };

export function AddExistingIssue({ workspaceSlug, projectId, onAdded }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, isLoading, mutate } = useSWR(
    ["project-shared-issues", workspaceSlug, projectId, open ? query : ""],
    () => service.candidates(workspaceSlug, projectId, open ? query : ""),
    { keepPreviousData: true }
  );
  if (!data?.enabled) return null;
  const close = () => {
    if (pending) return;
    setOpen(false);
    setSelected(null);
    setSearch("");
    setError(false);
  };
  const save = async () => {
    if (!selected) return;
    setPending(true);
    setError(false);
    try {
      await service.addExisting(workspaceSlug, projectId, selected);
      await onAdded();
      await mutate();
      setOpen(false);
      setSelected(null);
    } catch (failure) {
      console.error("Failed to add existing work item", failure);
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className="flex shrink-0 justify-end border-b border-subtle px-4 py-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Link2 className="size-3.5" /> {t("issue_projects.add_existing")}
        </Button>
      </div>
      <ModalCore isOpen={open} handleClose={close} position={EModalPosition.CENTER} width={EModalWidth.LG}>
        <div className="flex max-h-[85vh] flex-col p-6">
          <Dialog.Title className="text-h5-medium">{t("issue_projects.add_existing")}</Dialog.Title>
          <p className="mt-2 text-body-sm-regular text-secondary">{t("issue_projects.share_hint")}</p>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected(null);
            }}
            aria-label={t("issue_projects.search_issue")}
            placeholder={t("issue_projects.search_issue")}
            className="mt-5 rounded-md border border-subtle bg-surface-1 px-3 py-2 text-body-sm-regular outline-none focus:border-accent-strong"
          />
          <div className="mt-3 min-h-20 overflow-y-auto" aria-busy={isLoading}>
            {data.results.map((issue) => (
              <label key={issue.id} className="flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-layer-1">
                <input
                  type="radio"
                  name="existing-work-item"
                  checked={selected === issue.id}
                  onChange={() => setSelected(issue.id)}
                  disabled={pending}
                />
                <span className="shrink-0 text-body-xs-medium text-tertiary">{issue.identifier}</span>
                <span className="min-w-0 truncate text-body-sm-regular">{issue.name}</span>
              </label>
            ))}
            {!isLoading && !data.results.length && (
              <p className="py-4 text-body-sm-regular text-tertiary">{t("issue_projects.no_issues")}</p>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-body-sm-regular text-danger-primary">
              {t("issue_projects.save_error")}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button variant="primary" onClick={save} disabled={!selected || pending} loading={pending}>
              {t("issue_projects.add")}
            </Button>
          </div>
        </div>
      </ModalCore>
    </>
  );
}
