/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { GitLabSettings } from "@/components/integration/gitlab-settings";
import { IntegrationAndImportExportBanner } from "@/components/ui/integration-and-import-export-banner";
import { useTranslation } from "@plane/i18n";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";

function WorkspaceIntegrationsPage() {
  // store hooks
  const { currentWorkspace } = useWorkspace();
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();

  // derived values
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const title = t("workspace_settings.settings.integrations.title");
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - ${title}` : undefined;

  if (!isAdmin) return <NotAuthorizedView section="settings" className="h-auto" />;

  return (
    <>
      <PageHead title={pageTitle} />
      <section className="w-full overflow-y-auto">
        <IntegrationAndImportExportBanner bannerName={title} />
        {currentWorkspace?.slug && <GitLabSettings workspaceSlug={currentWorkspace.slug} />}
      </section>
    </>
  );
}

export default observer(WorkspaceIntegrationsPage);
