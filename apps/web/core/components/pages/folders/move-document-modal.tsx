/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { ModalCore, getPageFolderOptions, Input } from "@plane/ui";
import { Button } from "@plane/propel/button";
import { EPageStoreType, usePageStore } from "@/hooks/store";
import { folderError } from "./folder-dialog";

export const MoveDocumentModal = observer(function MoveDocumentModal(props: { pageId: string; onClose: () => void }) {
  const { pageId, onClose } = props;
  const { workspaceSlug, projectId } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const project = projectId?.toString() ?? "";
  const { t } = useTranslation();
  const { folders } = usePageStore(EPageStoreType.PROJECT);
  const [target, setTarget] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { isLoading, error: loadError, mutate } = useSWR(`PAGE_FOLDERS_${project}`, () => folders.fetch(slug, project));
  const move = async () => {
    setBusy(true);
    setError("");
    try {
      await folders.movePage(slug, project, pageId, target);
      onClose();
    } catch (err) {
      setError(folderError(err, t("page_folders.error")));
    } finally {
      setBusy(false);
    }
  };
  const options = getPageFolderOptions(folders.getFolders(project)).filter(
    (option) => option.value === target || option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
  return (
    <ModalCore
      isOpen
      handleClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-5 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void move();
        }}
      >
        <h2 className="text-18 font-semibold">{t("page_folders.move_document")}</h2>
        <Input
          aria-label={t("page_folders.search")}
          placeholder={t("page_folders.search")}
          className="w-full"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="block space-y-2 text-13">
          <span>{t("page_folders.destination")}</span>
          <select
            value={target ?? ""}
            onChange={(event) => setTarget(event.target.value || null)}
            className="w-full rounded border border-subtle bg-surface-1 px-3 py-2"
            disabled={busy || isLoading || !!loadError}
          >
            <option value="">{t("page_folders.root")}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {(error || loadError) && (
          <p role="alert" className="text-13 text-danger-primary">
            {error || t("page_folders.error")}
          </p>
        )}
        {loadError && (
          <Button variant="secondary" onClick={() => void mutate()}>
            {t("page_folders.retry")}
          </Button>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("page_folders.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || isLoading || !!loadError} loading={busy}>
            {t("page_folders.move")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
