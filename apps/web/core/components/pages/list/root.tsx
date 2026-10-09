/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
// types
import type { TPageNavigationTabs } from "@plane/types";
// components
import { ListLayout } from "@/components/core/list";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
// local imports
import { PageListBlock } from "./block";

type TPagesListRoot = {
  pageType: TPageNavigationTabs;
  storeType: EPageStoreType;
};

export const PagesListRoot = observer(function PagesListRoot(props: TPagesListRoot) {
  const { pageType, storeType } = props;
  // store hooks
  const { getCurrentProjectFilteredPageIdsByTab, folders, filters } = usePageStore(storeType);
  const { projectId } = useParams();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const folderId = searchParams.get("folder");
  // derived values
  const project = projectId?.toString() ?? "";
  const filteredPageIds = getCurrentProjectFilteredPageIdsByTab(pageType)?.filter((id) => {
    const location = folders.getLocation(project, id);
    if (folders.structures[project] && !location) return false;
    return (
      filters.searchQuery || !folderId || (location?.folder_id ?? null) === (folderId === "root" ? null : folderId)
    );
  });

  if (!filteredPageIds) return <></>;
  if (filteredPageIds.length === 0) return <p className="p-6 text-13 text-tertiary">{t("page_folders.empty")}</p>;
  return (
    <ListLayout>
      {filteredPageIds.map((pageId) => (
        <PageListBlock key={pageId} pageId={pageId} storeType={storeType} />
      ))}
    </ListLayout>
  );
});
