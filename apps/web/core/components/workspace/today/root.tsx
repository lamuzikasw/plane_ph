/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState, type ReactNode } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CalendarCheck, Clock3, Copy, Search, Sparkles, UserRound, X } from "lucide-react";
import useSWR from "swr";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Button, Loader } from "@plane/ui";
import type { TIssue } from "@plane/types";
import { cn } from "@plane/utils";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { useUser } from "@/hooks/store/user";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { AnalyticsService } from "@/services/analytics.service";

const analyticsService = new AnalyticsService();

type TIssueRow = {
  id: string;
  name: string;
  sequence_id?: number;
  project_id?: string;
  project_name?: string;
  project_identifier?: string;
  state_group?: string;
  state_name?: string;
  priority?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  updated_at?: string | null;
  days_overdue?: number | null;
  assignees?: Array<{ id: string; display_name?: string; email?: string; avatar_url?: string | null }>;
};

type TMemberRow = {
  id: string;
  display_name: string;
  email?: string;
  avatar_url?: string | null;
  main_work_item?: TIssueRow | null;
  active_projects: number;
  active_work_items: number;
  blocked_work_items: number;
  overdue_work_items: number;
  completed_work_items?: number;
  last_updated_at?: string | null;
  workload?: {
    percent?: number | null;
    label?: string;
    capacity?: number | null;
    planned?: number | null;
  };
};

const OPEN_GROUPS = new Set(["backlog", "unstarted", "started"]);

export const WorkspaceTodayRoot = observer(function WorkspaceTodayRoot() {
  const { workspaceSlug } = useParams();
  const workspaceSlugString = workspaceSlug?.toString() ?? "";
  const { data: currentUser } = useUser();
  const { isMobile } = usePlatformOS();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const [selectedMember, setSelectedMember] = useState<TMemberRow | undefined>();
  const [searchQuery, setSearchQuery] = useState("");

  const currentUserId = currentUser?.id;
  const currentPeriod = "current_week";

  const { data: activeData, isLoading: activeLoading } = useSWR(
    workspaceSlugString && currentUserId ? ["today-active", workspaceSlugString, currentUserId] : null,
    () =>
      analyticsService.getManagementAnalyticsDrilldown(workspaceSlugString, {
        metric: "active_work_items",
        period: currentPeriod,
        member_ids: currentUserId,
      })
  );

  const { data: blockedData, isLoading: blockedLoading } = useSWR(
    workspaceSlugString && currentUserId ? ["today-blocked", workspaceSlugString, currentUserId] : null,
    () =>
      analyticsService.getManagementAnalyticsDrilldown(workspaceSlugString, {
        metric: "blocked_work_items",
        period: currentPeriod,
        member_ids: currentUserId,
      })
  );

  const { data: unassignedData, isLoading: unassignedLoading } = useSWR(
    workspaceSlugString ? ["today-unassigned", workspaceSlugString] : null,
    () =>
      analyticsService.getManagementAnalyticsDrilldown(workspaceSlugString, {
        metric: "missing_assignee",
        period: currentPeriod,
      })
  );

  const { data: teamData, isLoading: teamLoading } = useSWR(
    workspaceSlugString ? ["today-team", workspaceSlugString] : null,
    () => analyticsService.getManagementAnalytics(workspaceSlugString, "team", { period: currentPeriod })
  );

  const activeRows = useMemo(() => (activeData?.rows ?? []) as TIssueRow[], [activeData?.rows]);
  const blockedRows = useMemo(() => (blockedData?.rows ?? []) as TIssueRow[], [blockedData?.rows]);
  const unassignedRows = useMemo(() => (unassignedData?.rows ?? []) as TIssueRow[], [unassignedData?.rows]);
  const teamRows = useMemo(() => (teamData?.results ?? []) as TMemberRow[], [teamData?.results]);

  const todayBucketRows = useMemo(() => mergeIssueRows(activeRows, unassignedRows), [activeRows, unassignedRows]);
  const todayBuckets = useMemo(() => buildTodayBuckets(todayBucketRows, blockedRows), [todayBucketRows, blockedRows]);
  const currentMember = useMemo(
    () => teamRows.find((member) => member.id === currentUserId),
    [currentUserId, teamRows]
  );
  const teamSearchRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const sorted = sortCopy(teamRows, (a, b) => b.active_work_items - a.active_work_items);
    if (!query) return sorted;
    return sorted.filter((member) =>
      `${member.display_name} ${member.email ?? ""} ${member.main_work_item?.name ?? ""}`.toLowerCase().includes(query)
    );
  }, [searchQuery, teamRows]);

  const digestText = buildDigestText(currentUser?.display_name ?? currentUser?.email ?? "Коллега", todayBuckets);

  const openIssue = (issue: TIssueRow | undefined | null) => {
    if (!issue) return;
    handleRedirection(workspaceSlugString, issue as TIssue, isMobile);
  };

  const copyDigest = async () => {
    try {
      await navigator.clipboard.writeText(digestText);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Digest скопирован", message: "Можно отправить команде." });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось скопировать", message: "Скопируй текст вручную." });
    }
  };

  const isLoading = activeLoading || blockedLoading || unassignedLoading || teamLoading;

  return (
    <>
      <div className="h-full overflow-hidden bg-surface-1">
        <div className="vertical-scrollbar scrollbar-md h-full overflow-auto">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-6 py-5">
            <section className="flex flex-col gap-4 rounded border border-subtle bg-surface-1 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-11 font-medium tracking-wide text-tertiary uppercase">
                    <CalendarCheck className="h-3.5 w-3.5" />
                    Сегодня
                  </div>
                  <h1 className="text-2xl mt-2 font-semibold text-primary">
                    Фокус на день, {currentUser?.display_name || currentUser?.email || "коллега"}
                  </h1>
                  <p className="mt-1 max-w-2xl text-13 text-secondary">
                    Короткая рабочая витрина: что горит, что нужно сделать сегодня, кто чем занят и где нужна помощь.
                  </p>
                </div>
                <Button variant="neutral-primary" size="sm" onClick={copyDigest}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Скопировать digest
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <TodayStatCard title="На сегодня" value={todayBuckets.dueToday.length} tone="blue" />
                <TodayStatCard title="Просрочено" value={todayBuckets.overdue.length} tone="red" />
                <TodayStatCard title="Блокеры" value={todayBuckets.blocked.length} tone="amber" />
                <TodayStatCard title="Активно" value={activeRows.length} tone="neutral" />
              </div>
            </section>

            {isLoading ? (
              <TodayLoader />
            ) : (
              <>
                <section className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <IssuePanel
                      title="Сделать сегодня"
                      description="Задачи с дедлайном на сегодня."
                      emptyText="На сегодня дедлайнов нет."
                      rows={todayBuckets.dueToday}
                      icon={<CalendarCheck className="h-4 w-4" />}
                      onOpenIssue={openIssue}
                    />
                    <IssuePanel
                      title="Риски и блокеры"
                      description="Просроченные и заблокированные задачи."
                      emptyText="Критичных задач сейчас нет."
                      rows={[...todayBuckets.overdue, ...todayBuckets.blocked].slice(0, 8)}
                      icon={<AlertTriangle className="h-4 w-4" />}
                      onOpenIssue={openIssue}
                    />
                    <IssuePanel
                      title="Ближайшее"
                      description="Назначенные и незакрепленные задачи после сегодняшнего дня."
                      emptyText="Ближайших задач со сроком нет."
                      rows={todayBuckets.upcoming.slice(0, 6)}
                      icon={<Clock3 className="h-4 w-4" />}
                      onOpenIssue={openIssue}
                    />
                    <EmployeeCard member={currentMember} activeRows={activeRows} blockedRows={blockedRows} />
                  </div>

                  <DigestCard digestText={digestText} onCopy={copyDigest} />
                </section>

                <section className="rounded border border-subtle bg-surface-1">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
                    <div>
                      <h2 className="text-15 font-semibold text-primary">Профили сотрудников</h2>
                      <p className="mt-0.5 text-12 text-secondary">
                        Быстрый ответ на вопрос: кто чем занимается и где есть риск.
                      </p>
                    </div>
                    <label className="flex h-8 min-w-[280px] items-center gap-2 rounded border border-subtle bg-surface-2 px-2.5 text-12">
                      <Search className="h-3.5 w-3.5 text-tertiary" />
                      <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Найти сотрудника или задачу"
                        className="h-full w-full bg-transparent text-primary outline-none placeholder:text-tertiary"
                      />
                    </label>
                  </div>
                  <div className="divide-y divide-subtle">
                    {teamSearchRows.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        className="grid w-full grid-cols-[minmax(180px,0.9fr)_minmax(220px,1.4fr)_repeat(4,minmax(80px,0.45fr))] items-center gap-3 px-4 py-3 text-left text-13 transition-colors hover:bg-surface-2"
                        onClick={() => setSelectedMember(member)}
                      >
                        <MemberCell member={member} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-primary">
                            {getMainIssueLabel(member.main_work_item)}
                          </div>
                          <div className="mt-0.5 text-11 text-tertiary">Основная задача</div>
                        </div>
                        <MetricPill label="Активно" value={member.active_work_items} />
                        <MetricPill
                          label="Блокеры"
                          value={member.blocked_work_items}
                          danger={member.blocked_work_items > 0}
                        />
                        <MetricPill
                          label="Просрочка"
                          value={member.overdue_work_items}
                          danger={member.overdue_work_items > 0}
                        />
                        <MetricPill label="Загрузка" value={`${member.workload?.percent ?? 0}%`} />
                      </button>
                    ))}
                    {teamSearchRows.length === 0 && (
                      <div className="px-4 py-8 text-center text-13 text-tertiary">Ничего не найдено.</div>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
      <EmployeeDrawer
        workspaceSlug={workspaceSlugString}
        member={selectedMember}
        onClose={() => setSelectedMember(undefined)}
        onOpenIssue={openIssue}
      />
      <IssuePeekOverview />
    </>
  );
});

function TodayStatCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: "blue" | "red" | "amber" | "neutral";
}) {
  const toneClassName = {
    blue: "bg-custom-primary-100/10 text-custom-primary-100",
    red: "bg-red-500/10 text-red-600",
    amber: "bg-amber-500/10 text-amber-700",
    neutral: "bg-surface-2 text-primary",
  }[tone];

  return (
    <div className="rounded border border-subtle p-3">
      <div className="text-12 font-medium text-secondary">{title}</div>
      <div className={cn("text-2xl mt-2 inline-flex rounded px-2 py-1 font-semibold", toneClassName)}>{value}</div>
    </div>
  );
}

function IssuePanel({
  title,
  description,
  emptyText,
  rows,
  icon,
  onOpenIssue,
}: {
  title: string;
  description: string;
  emptyText: string;
  rows: TIssueRow[];
  icon: ReactNode;
  onOpenIssue: (issue: TIssueRow) => void;
}) {
  return (
    <div className="rounded border border-subtle bg-surface-1">
      <div className="flex items-start gap-2 border-b border-subtle px-4 py-3">
        <div className="mt-0.5 text-secondary">{icon}</div>
        <div>
          <h2 className="text-14 font-semibold text-primary">{title}</h2>
          <p className="mt-0.5 text-12 text-secondary">{description}</p>
        </div>
      </div>
      <div className="divide-y divide-subtle">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-13 text-tertiary">{emptyText}</div>
        ) : (
          rows.map((issue) => <IssueListItem key={issue.id} issue={issue} onOpenIssue={onOpenIssue} />)
        )}
      </div>
    </div>
  );
}

function IssueListItem({ issue, onOpenIssue }: { issue: TIssueRow; onOpenIssue: (issue: TIssueRow) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
      onClick={() => onOpenIssue(issue)}
    >
      <div className="min-w-0">
        <div className="text-11 font-medium text-tertiary">
          {issue.project_identifier}-{issue.sequence_id}
        </div>
        <div className="truncate text-13 font-medium text-primary">{issue.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-11 text-tertiary">
          <span>{issue.project_name}</span>
          <span>·</span>
          <span>{issue.state_name ?? "Без статуса"}</span>
          {issue.target_date && (
            <>
              <span>·</span>
              <span>{formatDate(issue.target_date)}</span>
            </>
          )}
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-tertiary" />
    </button>
  );
}

function DigestCard({ digestText, onCopy }: { digestText: string; onCopy: () => void }) {
  return (
    <div className="rounded border border-subtle bg-surface-1">
      <div className="flex items-center justify-between gap-3 border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="text-custom-primary-100 h-4 w-4" />
          <div>
            <h2 className="text-14 font-semibold text-primary">Daily digest</h2>
            <p className="text-12 text-secondary">
              Короткая сводка по текущим задачам, срокам и блокерам. Обновляется вместе с задачами.
            </p>
          </div>
        </div>
        <Button variant="neutral-primary" size="sm" onClick={onCopy}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Копировать
        </Button>
      </div>
      <div className="p-4">
        <div className="rounded border border-subtle bg-surface-2 p-3 text-13 leading-6 whitespace-pre-wrap text-primary">
          {digestText}
        </div>
      </div>
    </div>
  );
}

function EmployeeCard({
  member,
  activeRows,
  blockedRows,
}: {
  member?: TMemberRow;
  activeRows: TIssueRow[];
  blockedRows: TIssueRow[];
}) {
  return (
    <div className="rounded border border-subtle bg-surface-1">
      <div className="flex items-start gap-2 border-b border-subtle px-4 py-3">
        <UserRound className="mt-0.5 h-4 w-4 text-secondary" />
        <div>
          <h2 className="text-14 font-semibold text-primary">Мой профиль</h2>
          <p className="mt-0.5 text-12 text-secondary">Личный срез по активной работе.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        <MetricBox label="Активно" value={activeRows.length} />
        <MetricBox label="Блокеры" value={blockedRows.length} danger={blockedRows.length > 0} />
        <MetricBox label="Проекты" value={member?.active_projects ?? 0} />
        <MetricBox label="Загрузка" value={`${member?.workload?.percent ?? 0}%`} />
      </div>
    </div>
  );
}

function EmployeeDrawer({
  workspaceSlug,
  member,
  onClose,
  onOpenIssue,
}: {
  workspaceSlug: string;
  member?: TMemberRow;
  onClose: () => void;
  onOpenIssue: (issue: TIssueRow) => void;
}) {
  const [query, setQuery] = useState("");
  const isOpen = !!member;
  const { data: activeData, isLoading } = useSWR(
    isOpen && workspaceSlug && member?.id ? ["today-member-active", workspaceSlug, member.id] : null,
    () =>
      analyticsService.getManagementAnalyticsDrilldown(workspaceSlug, {
        metric: "active_work_items",
        period: "current_week",
        member_ids: member?.id,
      })
  );
  const rows = useMemo(() => {
    const source = sortCopy((activeData?.rows ?? []) as TIssueRow[], compareIssuesForFocus);
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return source;
    return source.filter((issue) =>
      `${issue.project_identifier}-${issue.sequence_id} ${issue.name} ${issue.project_name ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [activeData?.rows, query]);

  if (!isOpen || !member) return null;

  const focusIssue = rows[0] ?? member.main_work_item;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <button type="button" className="h-full flex-1 cursor-default" aria-label="Закрыть профиль" onClick={onClose} />
      <aside className="flex h-full w-full max-w-4xl flex-col border-l border-subtle bg-surface-1 shadow-raised-200">
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-4">
          <div>
            <div className="text-11 font-medium tracking-wide text-tertiary uppercase">Профиль сотрудника</div>
            <div className="mt-1 text-20 font-semibold text-primary">{member.display_name}</div>
            <div className="mt-1 text-12 text-secondary">{member.email}</div>
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
        <div className="grid gap-3 border-b border-subtle p-5 md:grid-cols-4">
          <MetricBox label="Активно" value={member.active_work_items} />
          <MetricBox label="Блокеры" value={member.blocked_work_items} danger={member.blocked_work_items > 0} />
          <MetricBox label="Просрочка" value={member.overdue_work_items} danger={member.overdue_work_items > 0} />
          <MetricBox label="Загрузка" value={`${member.workload?.percent ?? 0}%`} />
        </div>
        <div className="border-b border-subtle p-5">
          <div className="text-12 font-medium text-secondary">Основной фокус</div>
          {focusIssue ? (
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-between gap-3 rounded border border-subtle p-3 text-left transition-colors hover:bg-surface-2"
              onClick={() => onOpenIssue(focusIssue)}
            >
              <div className="min-w-0">
                <div className="text-11 font-medium text-tertiary">
                  {focusIssue.project_identifier}-{focusIssue.sequence_id}
                </div>
                <div className="truncate text-14 font-medium text-primary">{focusIssue.name}</div>
                <div className="mt-1 text-12 text-secondary">{focusIssue.project_name ?? "Проект не указан"}</div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-tertiary" />
            </button>
          ) : (
            <div className="mt-2 rounded border border-subtle bg-surface-2 p-3 text-13 text-tertiary">
              Активных задач нет.
            </div>
          )}
        </div>
        <div className="border-b border-subtle px-5 py-3">
          <label className="flex h-9 items-center gap-2 rounded border border-subtle bg-surface-2 px-3 text-13">
            <Search className="h-4 w-4 text-tertiary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по задачам сотрудника"
              className="h-full w-full bg-transparent text-primary outline-none placeholder:text-tertiary"
            />
          </label>
        </div>
        <div className="vertical-scrollbar scrollbar-md flex-1 overflow-auto">
          {isLoading ? (
            <TodayLoader compact />
          ) : rows.length === 0 ? (
            <div className="m-5 rounded border border-subtle bg-surface-2 px-3 py-8 text-center text-13 text-tertiary">
              Задач по фильтру нет.
            </div>
          ) : (
            <div className="divide-y divide-subtle">
              {rows.map((issue) => (
                <IssueListItem key={issue.id} issue={issue} onOpenIssue={onOpenIssue} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function MemberCell({ member }: { member: TMemberRow }) {
  const initials = getInitials(member.display_name || member.email || "?");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="bg-custom-primary-100/10 text-custom-primary-100 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-12 font-semibold">
        {member.avatar_url ? (
          <img src={member.avatar_url} alt={member.display_name} className="h-full w-full rounded-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium text-primary">{member.display_name}</div>
        <div className="truncate text-11 text-tertiary">{member.email}</div>
      </div>
    </div>
  );
}

function MetricPill({ label, value, danger = false }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn("text-13 font-medium", danger ? "text-red-600" : "text-primary")}>{value}</div>
      <div className="truncate text-11 text-tertiary">{label}</div>
    </div>
  );
}

function MetricBox({ label, value, danger = false }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="rounded border border-subtle bg-surface-2 p-3">
      <div className="text-11 font-medium text-tertiary">{label}</div>
      <div className={cn("mt-1 text-20 font-semibold", danger ? "text-red-600" : "text-primary")}>{value}</div>
    </div>
  );
}

function TodayLoader({ compact = false }: { compact?: boolean }) {
  return (
    <Loader className={cn("space-y-3", compact ? "p-5" : "")}>
      <Loader.Item height="92px" width="100%" />
      <Loader.Item height="180px" width="100%" />
      <Loader.Item height="180px" width="100%" />
    </Loader>
  );
}

function buildTodayBuckets(activeRows: TIssueRow[], blockedRows: TIssueRow[]) {
  const now = new Date();
  const active = activeRows.filter((issue) => !issue.state_group || OPEN_GROUPS.has(issue.state_group));
  const blockedIds = new Set(blockedRows.map((issue) => issue.id));
  const dueToday: TIssueRow[] = [];
  const overdue: TIssueRow[] = [];
  const upcoming: TIssueRow[] = [];

  active.forEach((issue) => {
    if (!issue.target_date) return;
    const target = new Date(issue.target_date);
    if (isSameDay(target, now)) dueToday.push(issue);
    else if (target < startOfDay(now)) overdue.push(issue);
    else if (target > now) upcoming.push(issue);
  });

  return {
    dueToday: sortCopy(dueToday, compareIssuesForFocus),
    overdue: sortCopy(overdue, compareIssuesForFocus),
    upcoming: sortCopy(upcoming, compareIssuesForFocus),
    blocked: sortCopy(
      active.filter((issue) => blockedIds.has(issue.id)),
      compareIssuesForFocus
    ),
  };
}

function mergeIssueRows(...groups: TIssueRow[][]) {
  const issueMap = new Map<string, TIssueRow>();
  groups.flat().forEach((issue) => {
    issueMap.set(issue.id, issue);
  });
  return [...issueMap.values()];
}

function sortCopy<T>(rows: T[], compare: (a: T, b: T) => number) {
  const next = [...rows];
  // eslint-disable-next-line unicorn/no-array-sort
  return next.sort(compare);
}

function compareIssuesForFocus(a: TIssueRow, b: TIssueRow) {
  const aRisk = issueRiskScore(a);
  const bRisk = issueRiskScore(b);
  if (aRisk !== bRisk) return bRisk - aRisk;
  const aDate = a.target_date ? new Date(a.target_date).getTime() : Number.MAX_SAFE_INTEGER;
  const bDate = b.target_date ? new Date(b.target_date).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
}

function issueRiskScore(issue: TIssueRow) {
  let score = 0;
  if ((issue.days_overdue ?? 0) > 0) score += 30;
  if (issue.priority === "urgent") score += 20;
  if (issue.priority === "high") score += 10;
  return score;
}

function buildDigestText(userName: string, buckets: ReturnType<typeof buildTodayBuckets>) {
  const focus = buckets.dueToday[0] ?? buckets.overdue[0] ?? buckets.blocked[0] ?? buckets.upcoming[0];
  const focusLine = focus ? `${focus.project_identifier}-${focus.sequence_id}: ${focus.name}` : "критичного фокуса нет";
  return [
    `Daily digest для ${userName}`,
    `Фокус: ${focusLine}.`,
    `Сегодня: ${buckets.dueToday.length} задач, просрочено: ${buckets.overdue.length}, блокеров: ${buckets.blocked.length}.`,
    buckets.blocked.length > 0
      ? "Нужна помощь по блокерам: лучше разобрать их первыми."
      : "Блокеров нет, можно спокойно двигать план.",
  ].join("\n");
}

function getMainIssueLabel(issue?: TIssueRow | null) {
  if (!issue) return "Активной задачи нет";
  return `${issue.project_identifier}-${issue.sequence_id} ${issue.name}`;
}

function getInitials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}
