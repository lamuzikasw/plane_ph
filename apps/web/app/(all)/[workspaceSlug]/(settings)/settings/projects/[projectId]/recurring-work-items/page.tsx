import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { RecurringWorkItemsSettingsRoot } from "@/components/recurring-work-items/settings-root";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";
import { RecurringWorkItemsProjectSettingsHeader } from "./header";

function RecurringWorkItemsSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const canManage = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  if (workspaceUserInfo && !canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  return (
    <SettingsContentWrapper header={<RecurringWorkItemsProjectSettingsHeader />}>
      <PageHead title={`${currentProjectDetails?.name ?? "Проект"} — Повторяющиеся задачи`} />
      <SettingsHeading
        title="Повторяющиеся задачи"
        description="Автоматически создавайте новые задачи по точному расписанию и контролируйте ближайшие запуски."
      />
      <RecurringWorkItemsSettingsRoot workspaceSlug={workspaceSlug} projectId={projectId} />
    </SettingsContentWrapper>
  );
}

export default observer(RecurringWorkItemsSettingsPage);
