/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TPageFolder } from "@plane/types";
import { ModalCore, Input, getPageFolderOptions } from "@plane/ui";
import { Button } from "@plane/propel/button";
import { EPageStoreType, usePageStore } from "@/hooks/store";

export function folderError(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const data = (error as { response?: { data?: Record<string, unknown> } }).response?.data;
    if (data) {
      const value = Object.values(data)[0];
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}

export const FolderDialog = observer(function FolderDialog(props: {
  workspaceSlug: string;
  projectId: string;
  folder?: TPageFolder;
  parent: string | null;
  onClose: () => void;
}) {
  const { workspaceSlug, projectId, folder, onClose } = props;
  const { t } = useTranslation();
  const { folders } = usePageStore(EPageStoreType.PROJECT);
  const [name, setName] = useState(folder?.name ?? "");
  const [parent, setParent] = useState(folder?.parent ?? props.parent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (deleting && folder) await folders.remove(workspaceSlug, projectId, folder.id);
      else if (folder) await folders.update(workspaceSlug, projectId, folder.id, { name: name.trim(), parent });
      else await folders.create(workspaceSlug, projectId, name.trim(), parent);
      onClose();
    } catch (err) {
      setError(folderError(err, t("page_folders.error")));
    } finally {
      setBusy(false);
    }
  };
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
          void save();
        }}
      >
        <h2 className="text-18 font-semibold">
          {t(deleting ? "page_folders.delete" : folder ? "page_folders.edit" : "page_folders.create")}
        </h2>
        {deleting ? (
          <p className="text-13 text-secondary">{t("page_folders.delete_description")}</p>
        ) : (
          <>
            <label className="block space-y-2 text-13">
              <span>{t("page_folders.name")}</span>
              <Input
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full"
                disabled={busy}
              />
            </label>
            <label className="block space-y-2 text-13">
              <span>{t("page_folders.parent")}</span>
              <select
                value={parent ?? ""}
                onChange={(event) => setParent(event.target.value || null)}
                disabled={busy}
                className="w-full rounded border border-subtle bg-surface-1 px-3 py-2 focus-visible:ring-2 focus-visible:ring-accent-strong"
              >
                <option value="">{t("page_folders.root")}</option>
                {getPageFolderOptions(folders.getFolders(projectId), folder?.id).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-13 text-danger-primary">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {folder && !deleting && (
            <Button variant="tertiary" className="mr-auto" disabled={busy} onClick={() => setDeleting(true)}>
              {t("page_folders.delete")}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("page_folders.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || (!deleting && !name.trim())} loading={busy}>
            {t(deleting ? "page_folders.delete" : "page_folders.save")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
