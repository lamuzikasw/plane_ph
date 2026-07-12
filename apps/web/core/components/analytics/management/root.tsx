/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Search, SlidersHorizontal, X } from "lucide-react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { Button, Loader } from "@plane/ui";
import type { TIssue, TManagementAnalyticsKPI, TManagementAnalyticsSection } from "@plane/types";
import { cn } from "@plane/utils";
import AnalyticsWrapper from "@/components/analytics/analytics-wrapper";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { AnalyticsService } from "@/services/analytics.service";

const analyticsService = new AnalyticsService();

const PERIOD_OPTIONS = [
  "current_week",
  "previous_week",
  "last_14_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "current_quarter",
];

const SECTION_TITLE_KEYS: Record<string, string> = {
  overview: "management_analytics.tabs.overview",
  team: "management_analytics.tabs.team",
  projects: "management_analytics.tabs.projects",
  workload: "management_analytics.tabs.workload",
  delivery: "management_analytics.tabs.delivery",
  risks: "management_analytics.tabs.risks",
  "data-quality": "management_analytics.tabs.data_quality",
};

const EMPTY_HIDDEN_ANALYTICS_BLOCKS: Record<string, string[]> = {};

const SUMMARY_DRILLDOWN_KEYS = new Set([
  "average_workload_percent",
  "overloaded_members",
  "members_with_capacity",
  "throughput",
  "on_time_delivery_percent",
  "cycle_time_hours",
  "lead_time_hours",
  "reopened_work_items",
  "high",
  "medium",
  "low",
]);

const QUALITY_DRILLDOWN_KEYS = new Set([
  "missing_assignee",
  "missing_module",
  "missing_type",
  "missing_estimate",
  "missing_start_date",
  "missing_target_date",
  "missing_priority",
  "started_without_assignee",
  "blocked_without_reason",
  "stale_work_items",
  "large_work_items",
  "invalid_dates",
]);

const KPI_TITLE_KEYS = new Set([
  "active_members",
  "active_projects",
  "work_items_in_progress",
  "work_items_in_review",
  "blocked_work_items",
  "overdue_work_items",
  "unassigned_work_items",
  "unestimated_work_items",
  "unscheduled_work_items",
  "completed_work_items",
  "average_cycle_time_hours",
  "on_time_delivery_percent",
  "average_team_workload_percent",
  "high_risk_projects",
]);

type AnalyticsBlockDefinition = {
  key: string;
  label: string;
  description?: string;
};

type Props = {
  section: TManagementAnalyticsSection;
};

export function ManagementAnalyticsSection({ section }: Props) {
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const [selectedMetric, setSelectedMetric] = useState<string | undefined>();
  const { data, error, isLoading } = useSWR(
    workspaceSlug ? ["management-analytics", workspaceSlug.toString(), section, query] : null,
    () => analyticsService.getManagementAnalytics(workspaceSlug.toString(), section, params)
  );

  return (
    <AnalyticsWrapper i18nTitle={SECTION_TITLE_KEYS[section]} className="max-w-[1600px]">
      <ManagementAnalyticsFilters />
      {isLoading && <AnalyticsPageLoader />}
      {error && <AnalyticsState tone="danger" i18nKey="management_analytics.states.error" />}
      {!isLoading && !error && data && (
        <div className="space-y-4">
          {data.history?.status === "partial" && (
            <AnalyticsState tone="warning" i18nKey="management_analytics.states.partial_history" />
          )}
          {section === "overview" && <OverviewPanel data={data} onOpenDrilldown={setSelectedMetric} />}
          {section === "team" && <TeamPanel data={data} />}
          {section === "projects" && <ProjectsPanel data={data} />}
          {section === "workload" && <WorkloadPanel data={data} onOpenDrilldown={setSelectedMetric} />}
          {section === "delivery" && <DeliveryPanel data={data} onOpenDrilldown={setSelectedMetric} />}
          {section === "risks" && <RisksPanel data={data} onOpenDrilldown={setSelectedMetric} />}
          {section === "data-quality" && <DataQualityPanel data={data} onOpenDrilldown={setSelectedMetric} />}
          <ManagementAnalyticsDrilldownDrawer
            metric={selectedMetric}
            params={params}
            isOpen={!!selectedMetric}
            onClose={() => setSelectedMetric(undefined)}
          />
          <IssuePeekOverview />
        </div>
      )}
    </AnalyticsWrapper>
  );
}

export function ManagementAnalyticsSettings() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const [draft, setDraft] = useState<Record<string, any> | undefined>();
  const { data, isLoading, mutate } = useSWR(
    workspaceSlug ? ["management-analytics-settings", workspaceSlug.toString()] : null,
    () => analyticsService.getManagementAnalyticsSettings(workspaceSlug.toString())
  );
  const settings = draft ?? data;

  const updateDraft = (key: string, value: string) =>
    setDraft({
      ...settings,
      [key]: value === "" ? "" : Number.isNaN(Number(value)) ? value : Number(value),
    });

  const save = async () => {
    if (!workspaceSlug || !settings) return;
    await analyticsService.updateManagementAnalyticsSettings(workspaceSlug.toString(), settings);
    setDraft(undefined);
    mutate();
  };

  return (
    <AnalyticsWrapper i18nTitle="management_analytics.tabs.settings" className="max-w-5xl">
      {isLoading && <AnalyticsPageLoader />}
      {settings && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SettingInput
              label={t("management_analytics.settings.default_capacity")}
              value={settings.default_weekly_capacity}
              onChange={(value) => updateDraft("default_weekly_capacity", value)}
            />
            <SettingInput
              label={t("management_analytics.settings.low_threshold")}
              value={settings.low_utilization_threshold}
              onChange={(value) => updateDraft("low_utilization_threshold", value)}
            />
            <SettingInput
              label={t("management_analytics.settings.high_threshold")}
              value={settings.high_utilization_threshold}
              onChange={(value) => updateDraft("high_utilization_threshold", value)}
            />
            <SettingInput
              label={t("management_analytics.settings.overload_threshold")}
              value={settings.overload_threshold}
              onChange={(value) => updateDraft("overload_threshold", value)}
            />
            <SettingInput
              label={t("management_analytics.settings.stale_days")}
              value={settings.stale_work_days}
              onChange={(value) => updateDraft("stale_work_days", value)}
            />
            <SettingInput
              label={t("management_analytics.settings.max_wip_age")}
              value={settings.max_wip_age_days}
              onChange={(value) => updateDraft("max_wip_age_days", value)}
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </AnalyticsWrapper>
  );
}

function ManagementAnalyticsFilters() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPeriod = searchParams.get("period") ?? "current_week";

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={currentPeriod}
          onChange={(event) => setParam("period", event.target.value)}
          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary outline-none"
        >
          {PERIOD_OPTIONS.map((period) => (
            <option key={period} value={period}>
              {t(`management_analytics.periods.${period}`)}
            </option>
          ))}
        </select>
        <input
          defaultValue={searchParams.get("project_ids") ?? ""}
          onBlur={(event) => setParam("project_ids", event.target.value.trim())}
          placeholder={t("management_analytics.filters.project_ids")}
          className="h-8 w-52 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary outline-none"
        />
        <input
          defaultValue={searchParams.get("member_ids") ?? ""}
          onBlur={(event) => setParam("member_ids", event.target.value.trim())}
          placeholder={t("management_analytics.filters.member_ids")}
          className="h-8 w-52 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary outline-none"
        />
      </div>
      <button className="text-custom-primary-100 text-12 font-medium" onClick={() => router.push(pathname)}>
        {t("management_analytics.filters.reset")}
      </button>
    </div>
  );
}

function OverviewPanel({ data, onOpenDrilldown }: { data: any; onOpenDrilldown: (metric: string) => void }) {
  const { workspaceSlug } = useParams();
  const [isMetricSettingsOpen, setIsMetricSettingsOpen] = useState(false);
  const workspaceSlugString = workspaceSlug?.toString();
  const { data: settings, mutate: mutateSettings } = useSWR(
    workspaceSlugString ? ["management-analytics-settings", workspaceSlugString] : null,
    () => analyticsService.getManagementAnalyticsSettings(workspaceSlugString ?? "")
  );
  const hiddenKpis = useMemo(
    () => (Array.isArray(settings?.overview_hidden_kpis) ? settings.overview_hidden_kpis : []),
    [settings?.overview_hidden_kpis]
  );
  const kpis = useMemo(() => data.kpis ?? [], [data.kpis]);
  const visibleKpis = useMemo(
    () => kpis.filter((kpi: TManagementAnalyticsKPI) => !hiddenKpis.includes(kpi.key)),
    [kpis, hiddenKpis]
  );

  const saveHiddenKpis = async (nextHiddenKpis: string[]) => {
    if (!workspaceSlugString) return;
    const nextSettings = { ...settings, overview_hidden_kpis: nextHiddenKpis };
    await mutateSettings(nextSettings, false);
    await analyticsService.updateManagementAnalyticsSettings(workspaceSlugString, {
      overview_hidden_kpis: nextHiddenKpis,
    });
    mutateSettings();
  };

  const toggleKpi = (key: string) => {
    const nextHiddenKpis = hiddenKpis.includes(key)
      ? hiddenKpis.filter((hiddenKey: string) => hiddenKey !== key)
      : [...hiddenKpis, key];
    saveHiddenKpis(nextHiddenKpis);
  };

  return (
    <>
      <OverviewMetricControls
        kpis={kpis}
        hiddenKpis={hiddenKpis}
        visibleCount={visibleKpis.length}
        isOpen={isMetricSettingsOpen}
        onToggleOpen={() => setIsMetricSettingsOpen((current) => !current)}
        onToggleKpi={toggleKpi}
        onShowAll={() => saveHiddenKpis([])}
      />
      <KpiGrid kpis={visibleKpis} onOpenDrilldown={onOpenDrilldown} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WorkloadDistributionChart rows={data.team_snapshot ?? []} />
        <RiskDistributionChart rows={data.project_health ?? []} />
        <ProjectProgressChart rows={data.project_health ?? []} />
        <IssuePressureChart kpis={data.kpis ?? []} />
      </div>
      <AttentionList items={data.attention ?? []} />
      <TeamTable rows={data.team_snapshot ?? []} compact />
      <ProjectTable rows={data.project_health ?? []} compact />
    </>
  );
}

function OverviewMetricControls({
  kpis,
  hiddenKpis,
  visibleCount,
  isOpen,
  onToggleOpen,
  onToggleKpi,
  onShowAll,
}: {
  kpis: TManagementAnalyticsKPI[];
  hiddenKpis: string[];
  visibleCount: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleKpi: (key: string) => void;
  onShowAll: () => void;
}) {
  const { t } = useTranslation();
  const hiddenCount = hiddenKpis.length;

  return (
    <div className="rounded border border-subtle bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <div>
          <div className="text-13 font-medium text-primary">Показатели обзора</div>
          <div className="text-11 text-tertiary">
            Видно {visibleCount} из {kpis.length}
            {hiddenCount > 0 ? ` · скрыто ${hiddenCount}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="text-custom-primary-100 hover:text-custom-primary-200 text-12 font-medium"
            >
              Показать все
            </button>
          )}
          <button
            type="button"
            onClick={onToggleOpen}
            className={cn(
              "flex h-8 items-center gap-2 rounded border border-subtle px-3 text-12 font-medium transition-colors",
              isOpen ? "bg-surface-2 text-primary" : "bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Показатели
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="border-t border-subtle px-3 py-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {kpis.map((kpi) => {
              const isVisible = !hiddenKpis.includes(kpi.key);
              const inputId = `management-analytics-kpi-${kpi.key}`;
              return (
                <div
                  key={kpi.key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded border border-subtle bg-surface-1 px-3 py-2 transition-colors hover:bg-surface-2"
                >
                  <label htmlFor={inputId} className="min-w-0 cursor-pointer">
                    <span className="block truncate text-13 font-medium text-primary">
                      {t(`management_analytics.kpis.${kpi.key}`)}
                    </span>
                    <span className="block truncate text-11 text-tertiary">
                      {formatValue(kpi.value, kpi.value_type)}
                    </span>
                  </label>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => onToggleKpi(kpi.key)}
                    className="text-custom-primary-100 h-4 w-4 rounded border-subtle"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamPanel({ data }: { data: any }) {
  const blocks = useMemo<AnalyticsBlockDefinition[]>(
    () => [
      { key: "workload_by_member", label: "Загрузка по сотрудникам", description: "График плановой загрузки" },
      { key: "team_activity", label: "Активность команды", description: "Активные, блокеры и просрочка" },
      { key: "team_table", label: "Таблица сотрудников", description: "Детальный список участников" },
    ],
    []
  );
  const visibility = useAnalyticsBlockVisibility("team");

  return (
    <>
      <AnalyticsBlockControls blocks={blocks} visibility={visibility} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibility.isVisible("workload_by_member") && <WorkloadBars rows={data.results ?? []} />}
        {visibility.isVisible("team_activity") && <TeamActivityChart rows={data.results ?? []} />}
      </div>
      {visibility.isVisible("team_table") && <TeamTable rows={data.results ?? []} />}
    </>
  );
}

function ProjectsPanel({ data }: { data: any }) {
  const blocks = useMemo<AnalyticsBlockDefinition[]>(
    () => [
      { key: "project_progress", label: "Прогресс проектов", description: "Проекты с самым низким прогрессом" },
      { key: "risk_score", label: "Оценка риска", description: "Риск по каждому проекту" },
      { key: "project_table", label: "Таблица проектов", description: "Детальная таблица проектов" },
    ],
    []
  );
  const visibility = useAnalyticsBlockVisibility("projects");

  return (
    <>
      <AnalyticsBlockControls blocks={blocks} visibility={visibility} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibility.isVisible("project_progress") && <ProjectProgressChart rows={data.results ?? []} />}
        {visibility.isVisible("risk_score") && <RiskScoreChart rows={data.results ?? []} />}
      </div>
      {visibility.isVisible("project_table") && <ProjectTable rows={data.results ?? []} />}
    </>
  );
}

function WorkloadPanel({ data, onOpenDrilldown }: { data: any; onOpenDrilldown: (metric: string) => void }) {
  const blocks = useMemo<AnalyticsBlockDefinition[]>(
    () => [
      { key: "summary", label: "Сводка", description: "Короткие числа по загрузке" },
      { key: "workload_by_member", label: "Загрузка по сотрудникам", description: "График плановой загрузки" },
      {
        key: "workload_distribution",
        label: "Распределение загрузки",
        description: "Кто свободен, занят или перегружен",
      },
      { key: "workload_table", label: "Таблица загрузки", description: "Список сотрудников по загрузке" },
    ],
    []
  );
  const visibility = useAnalyticsBlockVisibility("workload");

  return (
    <>
      <AnalyticsBlockControls blocks={blocks} visibility={visibility} />
      {visibility.isVisible("summary") && <SummaryStrip summary={data.summary} onOpenDrilldown={onOpenDrilldown} />}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibility.isVisible("workload_by_member") && <WorkloadBars rows={data.results ?? []} />}
        {visibility.isVisible("workload_distribution") && <WorkloadDistributionChart rows={data.results ?? []} />}
      </div>
      {visibility.isVisible("workload_table") && <TeamTable rows={data.results ?? []} workloadOnly />}
    </>
  );
}

function DeliveryPanel({ data, onOpenDrilldown }: { data: any; onOpenDrilldown: (metric: string) => void }) {
  const blocks = useMemo<AnalyticsBlockDefinition[]>(
    () => [
      { key: "summary", label: "Сводка", description: "Короткие числа по срокам" },
      { key: "delivery_metrics", label: "Метрики сроков", description: "Цикл, lead time и on-time" },
      { key: "throughput", label: "Пропускная способность", description: "Завершенные задачи по проектам" },
      { key: "throughput_table", label: "Таблица завершенных", description: "Проекты и количество задач" },
    ],
    []
  );
  const visibility = useAnalyticsBlockVisibility("delivery");

  return (
    <>
      <AnalyticsBlockControls blocks={blocks} visibility={visibility} />
      {visibility.isVisible("summary") && <SummaryStrip summary={data.metrics} onOpenDrilldown={onOpenDrilldown} />}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibility.isVisible("delivery_metrics") && <DeliveryMetricChart metrics={data.metrics ?? {}} />}
        {visibility.isVisible("throughput") && <ThroughputChart rows={data.grouped_throughput ?? []} />}
      </div>
      {visibility.isVisible("throughput_table") && (
        <SimpleTable
          columns={["management_analytics.tables.project", "management_analytics.tables.completed"]}
          rows={(data.grouped_throughput ?? []).map((row: any) => [row.project__name, row.count])}
        />
      )}
    </>
  );
}

function RisksPanel({ data, onOpenDrilldown }: { data: any; onOpenDrilldown: (metric: string) => void }) {
  const blocks = useMemo<AnalyticsBlockDefinition[]>(
    () => [
      { key: "summary", label: "Сводка", description: "Сколько проектов в каждом уровне риска" },
      { key: "risk_distribution", label: "Распределение рисков", description: "Low, medium и high" },
      { key: "risk_score", label: "Оценка риска", description: "Риск по каждому проекту" },
      { key: "risk_table", label: "Таблица рисков", description: "Проекты и причины риска" },
    ],
    []
  );
  const visibility = useAnalyticsBlockVisibility("risks");

  return (
    <>
      <AnalyticsBlockControls blocks={blocks} visibility={visibility} />
      {visibility.isVisible("summary") && <SummaryStrip summary={data.summary} onOpenDrilldown={onOpenDrilldown} />}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibility.isVisible("risk_distribution") && <RiskDistributionChart rows={data.results ?? []} />}
        {visibility.isVisible("risk_score") && <RiskScoreChart rows={data.results ?? []} />}
      </div>
      {visibility.isVisible("risk_table") && <ProjectTable rows={data.results ?? []} riskOnly />}
    </>
  );
}

function DataQualityPanel({ data, onOpenDrilldown }: { data: any; onOpenDrilldown: (metric: string) => void }) {
  const blocks = useMemo<AnalyticsBlockDefinition[]>(
    () => [
      { key: "quality_score", label: "Оценка качества", description: "Общий процент заполненности данных" },
      { key: "quality_violations", label: "Проблемы данных", description: "График нарушений по типам" },
      { key: "quality_table", label: "Таблица качества", description: "Все проверки и количества" },
    ],
    []
  );
  const visibility = useAnalyticsBlockVisibility("data-quality");

  return (
    <>
      <AnalyticsBlockControls blocks={blocks} visibility={visibility} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibility.isVisible("quality_score") && <QualityScoreChart score={data.score} />}
        {visibility.isVisible("quality_violations") && (
          <DataQualityBars rows={data.checks ?? []} onOpenDrilldown={onOpenDrilldown} />
        )}
      </div>
      {visibility.isVisible("quality_table") && (
        <DataQualityTable rows={data.checks ?? []} onOpenDrilldown={onOpenDrilldown} />
      )}
    </>
  );
}

function useAnalyticsBlockVisibility(section: TManagementAnalyticsSection) {
  const { workspaceSlug } = useParams();
  const workspaceSlugString = workspaceSlug?.toString();
  const { data: settings, mutate: mutateSettings } = useSWR(
    workspaceSlugString ? ["management-analytics-settings", workspaceSlugString] : null,
    () => analyticsService.getManagementAnalyticsSettings(workspaceSlugString ?? "")
  );
  const hiddenBlocksBySection = settings?.hidden_analytics_blocks ?? EMPTY_HIDDEN_ANALYTICS_BLOCKS;
  const hiddenBlocks = useMemo(
    () => (Array.isArray(hiddenBlocksBySection?.[section]) ? hiddenBlocksBySection[section] : []),
    [hiddenBlocksBySection, section]
  );

  const saveHiddenBlocks = async (nextHiddenBlocks: string[]) => {
    if (!workspaceSlugString) return;
    const nextHiddenBlocksBySection = {
      ...hiddenBlocksBySection,
      [section]: nextHiddenBlocks,
    };
    const nextSettings = { ...settings, hidden_analytics_blocks: nextHiddenBlocksBySection };
    await mutateSettings(nextSettings, false);
    await analyticsService.updateManagementAnalyticsSettings(workspaceSlugString, {
      hidden_analytics_blocks: nextHiddenBlocksBySection,
    });
    mutateSettings();
  };

  const toggleBlock = (key: string) => {
    const nextHiddenBlocks = hiddenBlocks.includes(key)
      ? hiddenBlocks.filter((hiddenKey: string) => hiddenKey !== key)
      : [...hiddenBlocks, key];
    saveHiddenBlocks(nextHiddenBlocks);
  };

  return {
    hiddenBlocks,
    isVisible: (key: string) => !hiddenBlocks.includes(key),
    toggleBlock,
    showAll: () => saveHiddenBlocks([]),
  };
}

function AnalyticsBlockControls({
  blocks,
  visibility,
}: {
  blocks: AnalyticsBlockDefinition[];
  visibility: ReturnType<typeof useAnalyticsBlockVisibility>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const visibleCount = blocks.filter((block) => visibility.isVisible(block.key)).length;
  const hiddenCount = blocks.length - visibleCount;

  return (
    <div className="rounded border border-subtle bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <div>
          <div className="text-13 font-medium text-primary">Показатели вкладки</div>
          <div className="text-11 text-tertiary">
            Видно {visibleCount} из {blocks.length}
            {hiddenCount > 0 ? ` · скрыто ${hiddenCount}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={visibility.showAll}
              className="text-custom-primary-100 hover:text-custom-primary-200 text-12 font-medium"
            >
              Показать все
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            className={cn(
              "flex h-8 items-center gap-2 rounded border border-subtle px-3 text-12 font-medium transition-colors",
              isOpen ? "bg-surface-2 text-primary" : "bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Показатели
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="border-t border-subtle px-3 py-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {blocks.map((block) => {
              const isVisible = visibility.isVisible(block.key);
              const inputId = `management-analytics-block-${block.key}`;
              return (
                <div
                  key={block.key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded border border-subtle bg-surface-1 px-3 py-2 transition-colors hover:bg-surface-2"
                >
                  <label htmlFor={inputId} className="min-w-0 cursor-pointer">
                    <span className="block truncate text-13 font-medium text-primary">{block.label}</span>
                    {block.description && (
                      <span className="block truncate text-11 text-tertiary">{block.description}</span>
                    )}
                  </label>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => visibility.toggleBlock(block.key)}
                    className="text-custom-primary-100 h-4 w-4 rounded border-subtle"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-subtle bg-surface-1 p-3">
      <div className="mb-3 text-13 font-semibold text-primary">{title}</div>
      {children}
    </section>
  );
}

function WorkloadBars({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const sortedRows = sortedCopy(rows, (a, b) => (b.workload?.percent ?? 0) - (a.workload?.percent ?? 0)).slice(0, 10);
  return (
    <ChartCard title={t("management_analytics.charts.workload_by_member")}>
      <div className="space-y-2">
        {sortedRows.map((row) => {
          const value = Math.min(row.workload?.percent ?? 0, 140);
          return (
            <div key={row.id} className="grid grid-cols-[minmax(120px,1fr)_3fr_56px] items-center gap-2 text-12">
              <div className="truncate text-secondary">{row.display_name}</div>
              <div className="h-2 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full rounded"
                  style={{ width: `${Math.max(value, 2)}%`, backgroundColor: chartColor(row.workload?.level) }}
                />
              </div>
              <div className="text-right text-tertiary">{row.workload?.percent ?? "—"}%</div>
            </div>
          );
        })}
        {sortedRows.length === 0 && <EmptyChartState />}
      </div>
    </ChartCard>
  );
}

function WorkloadDistributionChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const buckets = ["available", "healthy", "high", "overloaded"];
  const counts = buckets.map((bucket) => rows.filter((row) => row.workload?.level === bucket).length);
  return (
    <ChartCard title={t("management_analytics.charts.workload_distribution")}>
      <SegmentedBar
        labels={buckets.map((bucket) => t(`management_analytics.workload_levels.${bucket}`))}
        values={counts}
        tones={["available", "healthy", "high", "overloaded"]}
      />
    </ChartCard>
  );
}

function TeamActivityChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const data = rows.slice(0, 10).map((row) => ({
    id: row.id,
    label: row.display_name,
    active: row.active_work_items ?? 0,
    blocked: row.blocked_work_items ?? 0,
    overdue: row.overdue_work_items ?? 0,
  }));
  return (
    <ChartCard title={t("management_analytics.charts.team_activity")}>
      <StackedRows rows={data} keys={["active", "blocked", "overdue"]} tones={["healthy", "high", "overloaded"]} />
    </ChartCard>
  );
}

function ProjectProgressChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const sortedRows = sortedCopy(rows, (a, b) => (a.progress?.value ?? 0) - (b.progress?.value ?? 0)).slice(0, 10);
  return (
    <ChartCard title={t("management_analytics.charts.project_progress")}>
      <div className="space-y-2">
        {sortedRows.map((row) => {
          const value = row.progress?.value ?? 0;
          return (
            <div key={row.id} className="grid grid-cols-[minmax(140px,1fr)_3fr_48px] items-center gap-2 text-12">
              <div className="truncate text-secondary">{row.name}</div>
              <div className="h-2 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full rounded"
                  style={{ width: `${Math.max(Math.min(value, 100), 2)}%`, backgroundColor: chartColor("progress") }}
                />
              </div>
              <div className="text-right text-tertiary">{value}%</div>
            </div>
          );
        })}
        {sortedRows.length === 0 && <EmptyChartState />}
      </div>
    </ChartCard>
  );
}

function RiskDistributionChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const buckets = ["low", "medium", "high"];
  const counts = buckets.map((bucket) => rows.filter((row) => row.risk?.level === bucket).length);
  return (
    <ChartCard title={t("management_analytics.charts.risk_distribution")}>
      <SegmentedBar
        labels={buckets.map((bucket) => t(`management_analytics.risk.${bucket}`))}
        values={counts}
        tones={["healthy", "high", "overloaded"]}
      />
    </ChartCard>
  );
}

function RiskScoreChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const sortedRows = sortedCopy(rows, (a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0)).slice(0, 10);
  const maxScore = Math.max(...sortedRows.map((row) => row.risk?.score ?? 0), 1);
  return (
    <ChartCard title={t("management_analytics.charts.risk_score")}>
      <div className="space-y-2">
        {sortedRows.map((row) => (
          <div key={row.id} className="grid grid-cols-[minmax(140px,1fr)_3fr_40px] items-center gap-2 text-12">
            <div className="truncate text-secondary">{row.name}</div>
            <div className="h-2 overflow-hidden rounded bg-surface-2">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max(((row.risk?.score ?? 0) / maxScore) * 100, 2)}%`,
                  backgroundColor: chartColor(
                    row.risk?.level === "high" ? "overloaded" : row.risk?.level === "medium" ? "high" : "healthy"
                  ),
                }}
              />
            </div>
            <div className="text-right text-tertiary">{row.risk?.score ?? 0}</div>
          </div>
        ))}
        {sortedRows.length === 0 && <EmptyChartState />}
      </div>
    </ChartCard>
  );
}

function IssuePressureChart({ kpis }: { kpis: TManagementAnalyticsKPI[] }) {
  const { t } = useTranslation();
  const getKpi = (key: string) => kpis.find((kpi) => kpi.key === key)?.value ?? 0;
  const values = [
    getKpi("work_items_in_progress"),
    getKpi("blocked_work_items"),
    getKpi("overdue_work_items"),
    getKpi("unassigned_work_items"),
  ];
  return (
    <ChartCard title={t("management_analytics.charts.issue_pressure")}>
      <SegmentedBar
        labels={[
          t("management_analytics.kpis.work_items_in_progress"),
          t("management_analytics.kpis.blocked_work_items"),
          t("management_analytics.kpis.overdue_work_items"),
          t("management_analytics.kpis.unassigned_work_items"),
        ]}
        values={values}
        tones={["healthy", "high", "overloaded", "available"]}
      />
    </ChartCard>
  );
}

function DeliveryMetricChart({ metrics }: { metrics: Record<string, any> }) {
  const { t } = useTranslation();
  const values = [
    ["throughput", metrics.throughput],
    ["on_time_delivery_percent", metrics.on_time_delivery_percent],
    ["cycle_time_hours", metrics.cycle_time_hours],
    ["lead_time_hours", metrics.lead_time_hours],
  ];
  return (
    <ChartCard title={t("management_analytics.charts.delivery_metrics")}>
      <div className="grid grid-cols-2 gap-2">
        {values.map(([key, value]) => (
          <div key={key} className="rounded bg-surface-2 p-3">
            <div className="text-11 text-tertiary">{t(`management_analytics.summary.${key}`)}</div>
            <div className="mt-1 text-20 font-semibold text-primary">{value ?? "—"}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

function ThroughputChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const data = rows.map((row) => ({
    id: row.project_id ?? row.project__name,
    label: row.project__name,
    value: row.count ?? 0,
  }));
  return (
    <ChartCard title={t("management_analytics.charts.throughput")}>
      <HorizontalValueBars rows={data} />
    </ChartCard>
  );
}

function QualityScoreChart({ score }: { score?: number }) {
  const { t } = useTranslation();
  const normalized = Math.max(Math.min(score ?? 0, 100), 0);
  const circumference = 2 * Math.PI * 42;
  return (
    <ChartCard title={t("management_analytics.data_quality.score")}>
      <div className="flex items-center gap-4">
        <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100" role="img" aria-label={`${normalized}%`}>
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            className="text-surface-2"
            strokeWidth="10"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            className={cn(normalized > 85 ? "text-green-600" : normalized > 65 ? "text-yellow-600" : "text-red-600")}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (normalized / 100) * circumference}
            strokeLinecap="round"
          />
        </svg>
        <div>
          <div className="text-32 font-semibold text-primary">{normalized}%</div>
          <div className="text-12 text-tertiary">{t("management_analytics.charts.quality_caption")}</div>
        </div>
      </div>
    </ChartCard>
  );
}

function DataQualityBars({ rows, onOpenDrilldown }: { rows: any[]; onOpenDrilldown?: (metric: string) => void }) {
  const { t } = useTranslation();
  const data = sortedCopy(rows, (a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 8)
    .map((row) => ({ id: row.key, label: t(`management_analytics.quality.${row.key}`), value: row.count ?? 0 }));
  return (
    <ChartCard title={t("management_analytics.charts.data_quality_violations")}>
      <HorizontalValueBars
        rows={data}
        onOpenRow={(id) => {
          if (QUALITY_DRILLDOWN_KEYS.has(id)) onOpenDrilldown?.(id);
        }}
      />
    </ChartCard>
  );
}

function SegmentedBar({ labels, values, tones }: { labels: string[]; values: number[]; tones: string[] }) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const segments = labels.map((label, index) => ({ label, value: values[index] ?? 0, tone: tones[index] ?? "" }));
  return (
    <div className="space-y-3">
      <div className="flex h-4 overflow-hidden rounded bg-surface-2">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className="h-full"
            style={{
              width: `${total ? (segment.value / total) * 100 : 0}%`,
              backgroundColor: chartColor(segment.tone),
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 text-12 sm:grid-cols-2">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate text-secondary">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColor(segment.tone) }} />
              {segment.label}
            </span>
            <span className="text-tertiary">{segment.value}</span>
          </div>
        ))}
      </div>
      {total === 0 && <EmptyChartState />}
    </div>
  );
}

function StackedRows({ rows, keys, tones }: { rows: any[]; keys: string[]; tones: string[] }) {
  const max = Math.max(...rows.map((row) => keys.reduce((sum, key) => sum + (row[key] ?? 0), 0)), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(120px,1fr)_3fr] items-center gap-2 text-12">
          <div className="truncate text-secondary">{row.label}</div>
          <div className="flex h-2 overflow-hidden rounded bg-surface-2">
            {keys.map((key, index) => (
              <div
                key={`${row.id}-${key}`}
                className="h-full"
                style={{ width: `${((row[key] ?? 0) / max) * 100}%`, backgroundColor: chartColor(tones[index]) }}
              />
            ))}
          </div>
        </div>
      ))}
      {rows.length === 0 && <EmptyChartState />}
    </div>
  );
}

function HorizontalValueBars({
  rows,
  onOpenRow,
}: {
  rows: { id: string; label: string; value: number }[];
  onOpenRow?: (id: string) => void;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const isClickable = !!onOpenRow && row.value > 0;
        const content = (
          <>
            <div className="truncate text-secondary">{row.label}</div>
            <div className="h-2 overflow-hidden rounded bg-surface-2">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max((row.value / max) * 100, row.value ? 2 : 0)}%`,
                  backgroundColor: chartColor("progress"),
                }}
              />
            </div>
            <div className="text-right text-tertiary">{row.value}</div>
          </>
        );

        if (isClickable) {
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpenRow?.(row.id)}
              className="grid w-full grid-cols-[minmax(140px,1fr)_3fr_40px] items-center gap-2 rounded px-1 py-0.5 text-left text-12 transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
            >
              {content}
            </button>
          );
        }

        return (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(140px,1fr)_3fr_40px] items-center gap-2 px-1 py-0.5 text-12"
          >
            {content}
          </div>
        );
      })}
      {rows.length === 0 && <EmptyChartState />}
    </div>
  );
}

function EmptyChartState() {
  const { t } = useTranslation();
  return (
    <div className="rounded bg-surface-2 px-3 py-6 text-center text-12 text-tertiary">
      {t("management_analytics.charts.empty")}
    </div>
  );
}

function KpiGrid({
  kpis,
  onOpenDrilldown,
}: {
  kpis: TManagementAnalyticsKPI[];
  onOpenDrilldown: (metric: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <button
          key={kpi.key}
          type="button"
          onClick={() => onOpenDrilldown(kpi.key)}
          className="group hover:border-custom-primary-70/60 hover:bg-custom-primary-100/5 focus:ring-custom-primary-100/20 rounded border border-subtle bg-surface-1 p-3 text-left transition-colors focus:ring-2 focus:outline-none"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-12 font-medium text-secondary">{t(`management_analytics.kpis.${kpi.key}`)}</div>
            <div className="flex items-center gap-1">
              <div
                className={cn(
                  "text-11",
                  kpi.delta_percent && kpi.delta_percent > 0 ? "text-green-600" : "text-secondary"
                )}
              >
                {kpi.delta_percent === null ? "—" : `${kpi.delta_percent > 0 ? "+" : ""}${kpi.delta_percent}%`}
              </div>
              <ArrowUpRight className="h-3 w-3 text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </div>
          <div className="mt-2 text-24 font-semibold text-primary">{formatValue(kpi.value, kpi.value_type)}</div>
          <div className="mt-2 line-clamp-2 text-11 text-tertiary">{t(kpi.formula)}</div>
        </button>
      ))}
    </div>
  );
}

function ManagementAnalyticsDrilldownDrawer({
  metric,
  params,
  isOpen,
  onClose,
}: {
  metric?: string;
  params: Record<string, string | undefined>;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { workspaceSlug } = useParams();
  const { isMobile } = usePlatformOS();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const [searchQuery, setSearchQuery] = useState("");
  const workspaceSlugString = workspaceSlug?.toString();
  const drilldownParams = useMemo(() => ({ ...params, metric }), [params, metric]);
  const { data, error, isLoading } = useSWR(
    isOpen && workspaceSlugString && metric
      ? ["management-analytics-drilldown", workspaceSlugString, metric, JSON.stringify(params)]
      : null,
    () => analyticsService.getManagementAnalyticsDrilldown(workspaceSlugString ?? "", drilldownParams)
  );

  const rows = useMemo(() => {
    const sourceRows = data?.rows ?? [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sourceRows;
    return sourceRows.filter((row: any) => getSearchText(row).includes(query));
  }, [data?.rows, searchQuery]);

  if (!isOpen || !metric) return null;

  const entity = data?.entity ?? "unknown";
  const metricTitle = getMetricTitle(metric, t);
  const periodLabel = params.period
    ? t(`management_analytics.periods.${params.period}`)
    : t("management_analytics.periods.current_week");

  const openIssue = (row: any) => {
    onClose();
    handleRedirection(workspaceSlugString, row as TIssue, isMobile);
  };

  const openProject = (row: any) => {
    if (!workspaceSlugString || !row.id) return;
    onClose();
    router.push(`/${workspaceSlugString}/projects/${row.id}/issues`);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <button
        type="button"
        className="h-full flex-1 cursor-default"
        aria-label="Закрыть детализацию"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-5xl flex-col border-l border-subtle bg-surface-1 shadow-raised-200">
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-4">
          <div>
            <div className="text-11 font-medium tracking-wide text-tertiary uppercase">Детализация</div>
            <div className="mt-1 text-20 font-semibold text-primary">{metricTitle}</div>
            <div className="mt-1 text-12 text-secondary">
              {data?.count ?? 0} записей · {periodLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-secondary transition-colors hover:bg-surface-2 hover:text-primary"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-subtle px-5 py-3">
          <label className="flex h-9 items-center gap-2 rounded border border-subtle bg-surface-2 px-3 text-13">
            <Search className="h-4 w-4 text-tertiary" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по задачам, проектам или сотрудникам"
              className="h-full w-full bg-transparent text-primary outline-none placeholder:text-tertiary"
            />
          </label>
        </div>
        <div className="vertical-scrollbar scrollbar-md flex-1 overflow-auto">
          {isLoading && <DrilldownLoader />}
          {error && (
            <div className="border-red-500/30 bg-red-500/10 text-red-700 m-5 rounded border px-3 py-2 text-12">
              Не удалось загрузить детализацию.
            </div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="m-5 rounded border border-subtle bg-surface-2 px-3 py-8 text-center text-13 text-tertiary">
              По этой карточке пока нет строк.
            </div>
          )}
          {!isLoading && !error && rows.length > 0 && entity === "issue" && (
            <IssueDrilldownTable rows={rows} onOpenIssue={openIssue} />
          )}
          {!isLoading && !error && rows.length > 0 && entity === "member" && <MemberDrilldownTable rows={rows} />}
          {!isLoading && !error && rows.length > 0 && entity === "project" && (
            <ProjectDrilldownTable rows={rows} onOpenProject={openProject} />
          )}
        </div>
      </aside>
    </div>
  );
}

function DrilldownLoader() {
  return (
    <Loader className="space-y-2 p-5">
      <Loader.Item height="40px" width="100%" />
      <Loader.Item height="40px" width="100%" />
      <Loader.Item height="40px" width="100%" />
      <Loader.Item height="40px" width="100%" />
    </Loader>
  );
}

function getMetricTitle(metric: string, t: (key: string) => string) {
  if (KPI_TITLE_KEYS.has(metric)) return t(`management_analytics.kpis.${metric}`);
  if (QUALITY_DRILLDOWN_KEYS.has(metric)) return t(`management_analytics.quality.${metric}`);
  if (SUMMARY_DRILLDOWN_KEYS.has(metric)) return t(`management_analytics.summary.${metric}`);
  return metric;
}

function IssueDrilldownTable({ rows, onOpenIssue }: { rows: any[]; onOpenIssue: (row: any) => void }) {
  return (
    <table className="w-full min-w-[920px] text-left text-12">
      <thead className="sticky top-0 z-10 border-b border-subtle bg-surface-1 text-secondary">
        <tr>
          <th className="px-5 py-3 font-medium">Задача</th>
          <th className="px-3 py-3 font-medium">Проект</th>
          <th className="px-3 py-3 font-medium">Исполнитель</th>
          <th className="px-3 py-3 font-medium">Статус</th>
          <th className="px-3 py-3 font-medium">Дедлайн</th>
          <th className="px-3 py-3 font-medium">Просрочка</th>
          <th className="px-3 py-3 font-medium">Оценка</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-subtle">
        {rows.map((row) => (
          <tr
            key={row.id}
            className="cursor-pointer transition-colors hover:bg-surface-2"
            onClick={() => onOpenIssue(row)}
          >
            <td className="max-w-[320px] px-5 py-3">
              <div className="text-11 font-medium text-tertiary">
                {row.project_identifier}-{row.sequence_id}
              </div>
              <div className="truncate font-medium text-primary">{row.name}</div>
            </td>
            <td className="max-w-[180px] truncate px-3 py-3 text-secondary">{row.project_name}</td>
            <td className="max-w-[190px] truncate px-3 py-3 text-secondary">{formatAssignees(row.assignees)}</td>
            <td className="px-3 py-3 text-secondary">{row.state_name ?? "—"}</td>
            <td className="px-3 py-3 text-secondary">{formatDateTime(row.target_date)}</td>
            <td className="px-3 py-3">
              {row.days_overdue ? (
                <span className="bg-red-500/10 text-red-600 rounded px-2 py-0.5 text-11">{row.days_overdue} дн.</span>
              ) : (
                <span className="text-tertiary">—</span>
              )}
            </td>
            <td className="px-3 py-3 text-secondary">{row.estimate || row.estimate === 0 ? row.estimate : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MemberDrilldownTable({ rows }: { rows: any[] }) {
  return (
    <table className="w-full min-w-[900px] text-left text-12">
      <thead className="sticky top-0 z-10 border-b border-subtle bg-surface-1 text-secondary">
        <tr>
          <th className="px-5 py-3 font-medium">Сотрудник</th>
          <th className="px-3 py-3 font-medium">Основная задача</th>
          <th className="px-3 py-3 font-medium">Проекты</th>
          <th className="px-3 py-3 font-medium">Активные</th>
          <th className="px-3 py-3 font-medium">Блокеры</th>
          <th className="px-3 py-3 font-medium">Просрочка</th>
          <th className="px-3 py-3 font-medium">Загрузка</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-subtle">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-surface-2">
            <td className="px-5 py-3">
              <div className="font-medium text-primary">{row.display_name}</div>
              <div className="text-11 text-tertiary">{row.email}</div>
            </td>
            <td className="max-w-[260px] truncate px-3 py-3 text-secondary">{row.main_work_item?.name ?? "—"}</td>
            <td className="px-3 py-3 text-secondary">{row.active_projects}</td>
            <td className="px-3 py-3 text-secondary">{row.active_work_items}</td>
            <td className="px-3 py-3 text-secondary">{row.blocked_work_items}</td>
            <td className="px-3 py-3 text-secondary">{row.overdue_work_items}</td>
            <td className="px-3 py-3">
              <WorkloadBadge workload={row.workload} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProjectDrilldownTable({ rows, onOpenProject }: { rows: any[]; onOpenProject: (row: any) => void }) {
  const { t } = useTranslation();
  return (
    <table className="w-full min-w-[920px] text-left text-12">
      <thead className="sticky top-0 z-10 border-b border-subtle bg-surface-1 text-secondary">
        <tr>
          <th className="px-5 py-3 font-medium">Проект</th>
          <th className="px-3 py-3 font-medium">Владелец</th>
          <th className="px-3 py-3 font-medium">Прогресс</th>
          <th className="px-3 py-3 font-medium">Блокеры</th>
          <th className="px-3 py-3 font-medium">Просрочка</th>
          <th className="px-3 py-3 font-medium">Риск</th>
          <th className="px-3 py-3 font-medium">Причина</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-subtle">
        {rows.map((row) => (
          <tr key={row.id} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpenProject(row)}>
            <td className="px-5 py-3">
              <div className="text-11 font-medium text-tertiary">{row.identifier}</div>
              <div className="font-medium text-primary">{row.name}</div>
            </td>
            <td className="px-3 py-3 text-secondary">{row.owner?.display_name ?? "—"}</td>
            <td className="px-3 py-3 text-secondary">{row.progress?.value ?? 0}%</td>
            <td className="px-3 py-3 text-secondary">{row.blocked_work_items}</td>
            <td className="px-3 py-3 text-secondary">{row.overdue_work_items}</td>
            <td className="px-3 py-3">
              <RiskBadge risk={row.risk} />
            </td>
            <td className="max-w-[260px] truncate px-3 py-3 text-tertiary">
              {(row.risk?.reasons ?? [])
                .map((reason: string) => t(`management_analytics.risk_reasons.${reason}`))
                .join(", ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttentionList({ items }: { items: any[] }) {
  const { t } = useTranslation();
  if (!items.length) return <AnalyticsState tone="success" i18nKey="management_analytics.states.no_attention" />;
  return (
    <section className="rounded border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-3 py-2 text-13 font-semibold text-primary">
        {t("management_analytics.blocks.needs_attention")}
      </div>
      <div className="divide-y divide-subtle">
        {items.map((item) => (
          <div
            key={`${item.key}-${item.entity_id}-${item.label}`}
            className="flex items-center justify-between gap-3 px-3 py-2 text-13"
          >
            <span className="text-primary">
              {t(`management_analytics.attention.${item.key}`, { label: item.label })}
            </span>
            <span
              className={cn(
                "rounded px-2 py-0.5 text-11",
                item.severity === "high" ? "bg-red-500/10 text-red-600" : "bg-yellow-500/10 text-yellow-700"
              )}
            >
              {t(`management_analytics.severity.${item.severity}`)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamTable({
  rows,
  compact = false,
  workloadOnly = false,
}: {
  rows: any[];
  compact?: boolean;
  workloadOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-3 py-2 text-13 font-semibold text-primary">
        {t(workloadOnly ? "management_analytics.blocks.workload" : "management_analytics.blocks.who_is_doing_what")}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-12">
          <thead className="bg-surface-2 text-secondary">
            <tr>
              <th className="px-3 py-2">{t("management_analytics.tables.member")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.main_work")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.projects")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.active")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.blocked")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.overdue")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.workload")}</th>
              {!compact && <th className="px-3 py-2">{t("management_analytics.tables.updated")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-medium text-primary">{row.display_name}</td>
                <td className="max-w-[260px] truncate px-3 py-2 text-secondary">{row.main_work_item?.name ?? "—"}</td>
                <td className="px-3 py-2 text-secondary">{row.active_projects}</td>
                <td className="px-3 py-2 text-secondary">{row.active_work_items}</td>
                <td className="px-3 py-2 text-secondary">{row.blocked_work_items}</td>
                <td className="px-3 py-2 text-secondary">{row.overdue_work_items}</td>
                <td className="px-3 py-2">
                  <WorkloadBadge workload={row.workload} />
                </td>
                {!compact && <td className="px-3 py-2 text-tertiary">{formatDate(row.last_updated_at)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProjectTable({
  rows,
  compact = false,
  riskOnly = false,
}: {
  rows: any[];
  compact?: boolean;
  riskOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-3 py-2 text-13 font-semibold text-primary">
        {t(riskOnly ? "management_analytics.blocks.risks" : "management_analytics.blocks.project_health")}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-12">
          <thead className="bg-surface-2 text-secondary">
            <tr>
              <th className="px-3 py-2">{t("management_analytics.tables.project")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.owner")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.progress")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.blocked")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.overdue")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.risk")}</th>
              {!compact && <th className="px-3 py-2">{t("management_analytics.tables.reason")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-medium text-primary">{row.name}</td>
                <td className="px-3 py-2 text-secondary">{row.owner?.display_name ?? "—"}</td>
                <td className="px-3 py-2 text-secondary">
                  {row.progress?.value ?? 0}% ·{" "}
                  {t(`management_analytics.progress_methods.${row.progress?.method ?? "count"}`)}
                </td>
                <td className="px-3 py-2 text-secondary">{row.blocked_work_items}</td>
                <td className="px-3 py-2 text-secondary">{row.overdue_work_items}</td>
                <td className="px-3 py-2">
                  <RiskBadge risk={row.risk} />
                </td>
                {!compact && (
                  <td className="px-3 py-2 text-tertiary">
                    {(row.risk?.reasons ?? [])
                      .map((reason: string) => t(`management_analytics.risk_reasons.${reason}`))
                      .join(", ") || "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryStrip({
  summary,
  onOpenDrilldown,
}: {
  summary?: Record<string, any>;
  onOpenDrilldown?: (metric: string) => void;
}) {
  const { t } = useTranslation();
  if (!summary) return null;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {Object.entries(summary).map(([key, value]) => {
        const canDrilldown = SUMMARY_DRILLDOWN_KEYS.has(key) && value !== null && value !== undefined;
        const content = (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="text-11 text-tertiary">{t(`management_analytics.summary.${key}`)}</div>
              {canDrilldown && (
                <ArrowUpRight className="h-3 w-3 text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </div>
            <div className="mt-1 text-20 font-semibold text-primary">{value ?? "—"}</div>
          </>
        );

        if (canDrilldown) {
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenDrilldown?.(key)}
              className="group hover:border-custom-primary-70/60 hover:bg-custom-primary-100/5 focus:ring-custom-primary-100/20 rounded border border-subtle bg-surface-1 p-3 text-left transition-colors focus:ring-2 focus:outline-none"
            >
              {content}
            </button>
          );
        }

        return (
          <div key={key} className="rounded border border-subtle bg-surface-1 p-3">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function DataQualityTable({ rows, onOpenDrilldown }: { rows: any[]; onOpenDrilldown: (metric: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded border border-subtle bg-surface-1">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-12">
          <thead className="bg-surface-2 text-secondary">
            <tr>
              <th className="px-3 py-2">{t("management_analytics.tables.check")}</th>
              <th className="px-3 py-2">{t("management_analytics.tables.violations")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.map((row) => {
              const canDrilldown = QUALITY_DRILLDOWN_KEYS.has(row.key) && (row.count ?? 0) > 0;
              return (
                <tr
                  key={row.key}
                  className={cn(canDrilldown && "cursor-pointer transition-colors hover:bg-surface-2")}
                  onClick={() => canDrilldown && onOpenDrilldown(row.key)}
                >
                  <td className="px-3 py-2 font-medium text-primary">
                    <div className="flex items-center gap-1">
                      {t(`management_analytics.quality.${row.key}`)}
                      {canDrilldown && <ArrowUpRight className="h-3 w-3 text-tertiary" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-secondary">{row.count ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SimpleTable({ columns, rows }: { columns: string[]; rows: any[][] }) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded border border-subtle bg-surface-1">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-12">
          <thead className="bg-surface-2 text-secondary">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2">
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.map((row) => (
              <tr key={row.join("-")}>
                {row.map((cell) => (
                  <td key={`${row.join("-")}-${String(cell)}`} className="px-3 py-2 text-secondary">
                    {cell ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WorkloadBadge({ workload }: { workload?: any }) {
  const { t } = useTranslation();
  const level = workload?.level ?? "unknown";
  return (
    <span className={cn("rounded px-2 py-0.5 text-11", badgeClass(level))}>
      {workload?.percent ?? "—"}% · {t(`management_analytics.workload_levels.${level}`)}
    </span>
  );
}

function RiskBadge({ risk }: { risk?: any }) {
  const { t } = useTranslation();
  const level = risk?.level ?? "low";
  return (
    <span className={cn("rounded px-2 py-0.5 text-11", badgeClass(level))}>
      {t(`management_analytics.risk.${level}`)} · {risk?.score ?? 0}
    </span>
  );
}

function AnalyticsState({ tone, i18nKey }: { tone: "warning" | "danger" | "success"; i18nKey: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "rounded border px-3 py-2 text-12",
        tone === "danger"
          ? "border-red-500/30 bg-red-500/10 text-red-700"
          : tone === "warning"
            ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-700"
            : "border-green-500/30 bg-green-500/10 text-green-700"
      )}
    >
      {t(i18nKey)}
    </div>
  );
}

function AnalyticsPageLoader() {
  return (
    <Loader className="space-y-3">
      <Loader.Item height="72px" width="100%" />
      <Loader.Item height="220px" width="100%" />
      <Loader.Item height="220px" width="100%" />
    </Loader>
  );
}

function SettingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded border border-subtle bg-surface-1 p-3">
      <span className="text-12 font-medium text-secondary">{label}</span>
      <input
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-8 w-full rounded border border-subtle bg-surface-2 px-2 text-13 text-primary outline-none"
      />
    </label>
  );
}

function formatValue(value: number | null, type: string) {
  if (value === null || value === undefined) return "—";
  if (type === "percent") return `${value}%`;
  if (type === "duration") return `${value} ч`;
  return value.toString();
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU");
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAssignees(assignees?: any[]) {
  if (!assignees?.length) return "—";
  return assignees.map((assignee) => assignee.display_name || assignee.email).join(", ");
}

function getSearchText(row: any) {
  return [
    row.name,
    row.project_name,
    row.project_identifier,
    row.identifier,
    row.display_name,
    row.email,
    row.owner?.display_name,
    row.main_work_item?.name,
    formatAssignees(row.assignees),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function badgeClass(level: string) {
  if (["high", "overloaded"].includes(level)) return "bg-red-500/10 text-red-600";
  if (["medium", "high"].includes(level)) return "bg-yellow-500/10 text-yellow-700";
  if (["healthy", "low", "available"].includes(level)) return "bg-green-500/10 text-green-700";
  return "bg-surface-2 text-secondary";
}

function chartColor(level?: string) {
  const normalizedLevel = level ?? "";
  if (["overloaded"].includes(normalizedLevel)) return "#dc2626";
  if (["high", "medium"].includes(normalizedLevel)) return "#d97706";
  if (["healthy", "low"].includes(normalizedLevel)) return "#16a34a";
  if (["available", "progress"].includes(normalizedLevel)) return "#2563eb";
  return "#94a3b8";
}

function sortedCopy<T>(items: T[], compare: (a: T, b: T) => number) {
  const copy = [...items];
  // oxlint-disable-next-line unicorn/no-array-sort
  return copy.sort(compare);
}
