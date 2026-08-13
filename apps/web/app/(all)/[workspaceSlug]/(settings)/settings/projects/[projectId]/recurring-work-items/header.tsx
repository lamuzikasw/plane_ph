import { observer } from "mobx-react";
import { Breadcrumbs } from "@plane/ui";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { PROJECT_SETTINGS_ICONS } from "@/components/settings/project/sidebar/item-icon";

export const RecurringWorkItemsProjectSettingsHeader = observer(function RecurringWorkItemsProjectSettingsHeader() {
  const Icon = PROJECT_SETTINGS_ICONS.recurring_work_items;
  return (
    <SettingsPageHeader
      leftItem={
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={<BreadcrumbLink label="Повторяющиеся задачи" icon={<Icon className="size-4 text-tertiary" />} />}
          />
        </Breadcrumbs>
      }
    />
  );
});
