/** Copyright (c) 2023-present Plane Software, Inc. and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Folder, FolderPlus, PanelLeft, Plus } from "lucide-react";
import useSWR from "swr";
import { EPageAccess } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TPageFolder, TPageNavigationTabs } from "@plane/types";
import { CustomMenu, PageTree, getPageFolderPath } from "@plane/ui";
import { Button } from "@plane/propel/button";
import { getPageName } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { EPageStoreType, usePageStore } from "@/hooks/store";
import { FolderDialog, folderError } from "./folder-dialog";

export const FolderBrowser = observer(function FolderBrowser(props: {
  children: React.ReactNode;
  workspaceSlug: string;
  projectId: string;
  pageType: TPageNavigationTabs;
  pageId?: string;
}) {
  const { children, workspaceSlug, projectId, pageType, pageId } = props;
  const { t } = useTranslation();
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { folders, getCurrentProjectPageIdsByTab, getPageById, canCurrentUserCreatePage, createPage, filters } =
    usePageStore(EPageStoreType.PROJECT);
  const [dialog, setDialog] = useState<{ folder?: TPageFolder; parent: string | null } | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const { error, isLoading, mutate } = useSWR(`PAGE_FOLDERS_${projectId}`, () =>
    folders.fetch(workspaceSlug, projectId)
  );
  const allFolders = folders.getFolders(projectId);
  const queryFolder = searchParams.get("folder");
  const selected = queryFolder === "root" ? null : (queryFolder ?? undefined);
  const currentFolder = pageId ? folders.getLocation(projectId, pageId)?.folder_id : selected;
  const path = getPageFolderPath(allFolders, currentFolder ?? null);
  const basePath = `/${workspaceSlug}/projects/${projectId}/pages`;
  const navigateFolder = (id: string | null | undefined) => {
    const params = new URLSearchParams();
    if (pageType !== "public") params.set("type", pageType);
    if (id !== undefined) params.set("folder", id ?? "root");
    router.push(`${basePath}${params.size ? `?${params}` : ""}`);
    setShowSidebar(false);
  };
  const documents = (getCurrentProjectPageIdsByTab(pageType) ?? []).flatMap((id) => {
    const page = getPageById(id);
    const location = folders.getLocation(projectId, id);
    return page && location ? [{ id, name: getPageName(page.name), folderId: location.folder_id }] : [];
  });
  const createDocument = async () => {
    setBusy(true);
    setActionError("");
    try {
      const page = await createPage({
        access: pageType === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC,
        folder_id: currentFolder ?? null,
      });
      if (page?.id) router.push(`${basePath}/${page.id}`);
    } catch (err) {
      setActionError(folderError(err, t("page_folders.error")));
    } finally {
      setBusy(false);
    }
  };
  const missingFolder = selected !== undefined && selected !== null && !allFolders.some((f) => f.id === selected);
  const showSubfolders = !pageId && selected !== undefined && !filters.searchQuery;
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden md:flex-row">
      <button
        type="button"
        className="flex items-center gap-2 border-b border-subtle px-4 py-2 text-13 md:hidden"
        onClick={() => setShowSidebar((prev) => !prev)}
        aria-expanded={showSidebar}
      >
        <PanelLeft className="size-4" />
        {t("page_folders.navigation")}
      </button>
      <aside
        className={`${showSidebar ? "block" : "hidden"} max-h-[40vh] shrink-0 overflow-y-auto border-b border-subtle p-3 md:block md:max-h-none md:w-60 md:border-r md:border-b-0`}
      >
        <div className="mb-3 flex items-center justify-between px-2">
          <span className="text-11 font-medium tracking-wide text-tertiary">{t("page_folders.navigation")}</span>
          {canCurrentUserCreatePage && (
            <button
              type="button"
              title={t("page_folders.create")}
              aria-label={t("page_folders.create")}
              disabled={isLoading || !!error}
              className="rounded p-1 hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong"
              onClick={() => setDialog({ parent: null })}
            >
              <FolderPlus className="size-4" />
            </button>
          )}
        </div>
        {error ? (
          <div className="space-y-2 p-2 text-13">
            <p role="alert">{t("page_folders.error")}</p>
            <Button variant="secondary" onClick={() => void mutate()}>
              {t("page_folders.retry")}
            </Button>
          </div>
        ) : isLoading ? (
          <p className="p-2 text-13 text-tertiary">{t("page_folders.loading")}</p>
        ) : (
          <PageTree
            folders={allFolders}
            documents={documents}
            selectedFolder={selected}
            selectedPage={pageId}
            labels={{
              navigation: t("page_folders.navigation"),
              all: t("page_folders.all"),
              root: t("page_folders.root"),
              expand: t("page_folders.expand"),
              collapse: t("page_folders.collapse"),
            }}
            onSelectFolder={navigateFolder}
            onSelectPage={(id) => {
              router.push(`${basePath}/${id}`);
              setShowSidebar(false);
            }}
            renderFolderActions={
              canCurrentUserCreatePage
                ? (folder) => (
                    <CustomMenu placement="bottom-end" ellipsis closeOnSelect>
                      <CustomMenu.MenuItem onClick={() => setDialog({ parent: folder.id })}>
                        {t("page_folders.create_subfolder")}
                      </CustomMenu.MenuItem>
                      <CustomMenu.MenuItem onClick={() => setDialog({ folder, parent: folder.parent })}>
                        {t("page_folders.edit")}
                      </CustomMenu.MenuItem>
                    </CustomMenu>
                  )
                : undefined
            }
          />
        )}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-2">
          <nav
            aria-label={t("page_folders.path")}
            className="flex min-w-0 flex-wrap items-center gap-1 text-13 text-secondary"
          >
            <button
              type="button"
              className="rounded hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
              onClick={() => navigateFolder(undefined)}
            >
              {t("page_folders.all")}
            </button>
            {path.map((folder) => (
              <span key={folder.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3 shrink-0" />
                <button
                  type="button"
                  className="max-w-40 truncate rounded hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
                  title={folder.name}
                  onClick={() => navigateFolder(folder.id)}
                >
                  {folder.name}
                </button>
              </span>
            ))}
            {currentFolder === null && (
              <>
                <ChevronRight className="size-3" />
                <span>{t("page_folders.root")}</span>
              </>
            )}
          </nav>
          {canCurrentUserCreatePage && !isLoading && !error && !missingFolder && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDialog({ parent: currentFolder ?? null })}>
                <FolderPlus className="size-3.5" />
                {t("page_folders.create")}
              </Button>
              {pageType !== "archived" && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void createDocument()}
                  disabled={busy}
                  loading={busy}
                >
                  <Plus className="size-3.5" />
                  {t("page_folders.create_document")}
                </Button>
              )}
            </div>
          )}
        </div>
        {actionError && (
          <p role="alert" className="px-4 py-2 text-13 text-danger-primary">
            {actionError}
          </p>
        )}
        {missingFolder && !isLoading && !error ? (
          <div className="p-6 text-13">
            <p>{t("page_folders.not_found")}</p>
            <Button variant="secondary" className="mt-3" onClick={() => navigateFolder(undefined)}>
              {t("page_folders.all")}
            </Button>
          </div>
        ) : (
          <>
            {showSubfolders && (
              <div className="flex shrink-0 flex-wrap gap-2 px-4 pt-3">
                {allFolders
                  .filter((folder) => folder.parent === selected)
                  .map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => navigateFolder(folder.id)}
                      className="flex max-w-64 items-center gap-2 rounded border border-subtle px-3 py-2 text-13 hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong"
                    >
                      <Folder className="size-4 shrink-0 text-tertiary" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </>
        )}
      </div>
      {dialog && (
        <FolderDialog
          key={dialog.folder?.id ?? `new-${dialog.parent}`}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          {...dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
});
