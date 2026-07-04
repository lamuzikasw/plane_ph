/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { Button, Loader } from "@plane/ui";
import type { TManagementAnalyticsKPI, TManagementAnalyticsSection } from "@plane/types";
import { cn } from "@plane/utils";
import AnalyticsWrapper from "@/components/analytics/analytics-wrapper";
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

type Props = {
  section: TManagementAnalyticsSection;
};

export function ManagementAnalyticsSection({ section }: Props) {
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
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
          {section === "overview" && <OverviewPanel data={data} />}
          {section === "team" && <TeamPanel data={data} />}
          {section === "projects" && <ProjectsPanel data={data} />}
          {section === "workload" && <WorkloadPanel data={data} />}
          {section === "delivery" && <DeliveryPanel data={data} />}
          {section === "risks" && <RisksPanel data={data} />}
          {section === "data-quality" && <DataQualityPanel data={data} />}
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

function OverviewPanel({ data }: { data: any }) {
  return (
    <>
      <KpiGrid kpis={data.kpis ?? []} />
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

function TeamPanel({ data }: { data: any }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WorkloadBars rows={data.results ?? []} />
        <TeamActivityChart rows={data.results ?? []} />
      </div>
      <TeamTable rows={data.results ?? []} />
    </>
  );
}

function ProjectsPanel({ data }: { data: any }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ProjectProgressChart rows={data.results ?? []} />
        <RiskScoreChart rows={data.results ?? []} />
      </div>
      <ProjectTable rows={data.results ?? []} />
    </>
  );
}

function WorkloadPanel({ data }: { data: any }) {
  return (
    <>
      <SummaryStrip summary={data.summary} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WorkloadBars rows={data.results ?? []} />
        <WorkloadDistributionChart rows={data.results ?? []} />
      </div>
      <TeamTable rows={data.results ?? []} workloadOnly />
    </>
  );
}

function DeliveryPanel({ data }: { data: any }) {
  return (
    <>
      <SummaryStrip summary={data.metrics} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DeliveryMetricChart metrics={data.metrics ?? {}} />
        <ThroughputChart rows={data.grouped_throughput ?? []} />
      </div>
      <SimpleTable
        columns={["management_analytics.tables.project", "management_analytics.tables.completed"]}
        rows={(data.grouped_throughput ?? []).map((row: any) => [row.project__name, row.count])}
      />
    </>
  );
}

function RisksPanel({ data }: { data: any }) {
  return (
    <>
      <SummaryStrip summary={data.summary} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <RiskDistributionChart rows={data.results ?? []} />
        <RiskScoreChart rows={data.results ?? []} />
      </div>
      <ProjectTable rows={data.results ?? []} riskOnly />
    </>
  );
}

function DataQualityPanel({ data }: { data: any }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <QualityScoreChart score={data.score} />
        <DataQualityBars rows={data.checks ?? []} />
      </div>
      <SimpleTable
        columns={["management_analytics.tables.check", "management_analytics.tables.violations"]}
        rows={(data.checks ?? []).map((row: any) => [t(`management_analytics.quality.${row.key}`), row.count])}
      />
    </>
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

function DataQualityBars({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  const data = sortedCopy(rows, (a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 8)
    .map((row) => ({ id: row.key, label: t(`management_analytics.quality.${row.key}`), value: row.count ?? 0 }));
  return (
    <ChartCard title={t("management_analytics.charts.data_quality_violations")}>
      <HorizontalValueBars rows={data} />
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

function HorizontalValueBars({ rows }: { rows: { id: string; label: string; value: number }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[minmax(140px,1fr)_3fr_40px] items-center gap-2 text-12">
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
        </div>
      ))}
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

function KpiGrid({ kpis }: { kpis: TManagementAnalyticsKPI[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <div key={kpi.key} className="rounded border border-subtle bg-surface-1 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-12 font-medium text-secondary">{t(`management_analytics.kpis.${kpi.key}`)}</div>
            <div
              className={cn(
                "text-11",
                kpi.delta_percent && kpi.delta_percent > 0 ? "text-green-600" : "text-secondary"
              )}
            >
              {kpi.delta_percent === null ? "—" : `${kpi.delta_percent > 0 ? "+" : ""}${kpi.delta_percent}%`}
            </div>
          </div>
          <div className="mt-2 text-24 font-semibold text-primary">{formatValue(kpi.value, kpi.value_type)}</div>
          <div className="mt-2 line-clamp-2 text-11 text-tertiary">{t(kpi.formula)}</div>
        </div>
      ))}
    </div>
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

function SummaryStrip({ summary }: { summary?: Record<string, any> }) {
  const { t } = useTranslation();
  if (!summary) return null;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {Object.entries(summary).map(([key, value]) => (
        <div key={key} className="rounded border border-subtle bg-surface-1 p-3">
          <div className="text-11 text-tertiary">{t(`management_analytics.summary.${key}`)}</div>
          <div className="mt-1 text-20 font-semibold text-primary">{value ?? "—"}</div>
        </div>
      ))}
    </div>
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
