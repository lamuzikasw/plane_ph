/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AnalyticsTab } from "@plane/types";
import { ManagementAnalyticsSection, ManagementAnalyticsSettings } from "@/components/analytics/management";
import { WorkItems } from "@/components/analytics/work-items";

export const getAnalyticsTabs = (t: (key: string, params?: Record<string, any>) => string): AnalyticsTab[] => [
  {
    key: "overview",
    label: t("management_analytics.tabs.overview"),
    content: () => <ManagementAnalyticsSection section="overview" />,
    isDisabled: false,
  },
  {
    key: "team",
    label: t("management_analytics.tabs.team"),
    content: () => <ManagementAnalyticsSection section="team" />,
    isDisabled: false,
  },
  {
    key: "projects",
    label: t("management_analytics.tabs.projects"),
    content: () => <ManagementAnalyticsSection section="projects" />,
    isDisabled: false,
  },
  {
    key: "workload",
    label: t("management_analytics.tabs.workload"),
    content: () => <ManagementAnalyticsSection section="workload" />,
    isDisabled: false,
  },
  {
    key: "delivery",
    label: t("management_analytics.tabs.delivery"),
    content: () => <ManagementAnalyticsSection section="delivery" />,
    isDisabled: false,
  },
  {
    key: "risks",
    label: t("management_analytics.tabs.risks"),
    content: () => <ManagementAnalyticsSection section="risks" />,
    isDisabled: false,
  },
  {
    key: "data-quality",
    label: t("management_analytics.tabs.data_quality"),
    content: () => <ManagementAnalyticsSection section="data-quality" />,
    isDisabled: false,
  },
  {
    key: "settings",
    label: t("management_analytics.tabs.settings"),
    content: ManagementAnalyticsSettings,
    isDisabled: false,
  },
  { key: "work-items", label: t("management_analytics.tabs.work_items"), content: WorkItems, isDisabled: false },
];
