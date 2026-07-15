/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { Popover } from "@headlessui/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  Bot,
  CalendarCheck,
  CalendarRange,
  Check,
  Code2,
  FileText,
  Gauge,
  Link2,
  ListChecks,
  Megaphone,
  PanelRightOpen,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn, joinUrlPath } from "@plane/utils";
import useLocalStorage from "@/hooks/use-local-storage";
import {
  getReleaseBySlug,
  LATEST_RELEASE,
  PRODUCT_RELEASES,
  shouldResetReleaseScroll,
  type TReleaseAction,
  type TReleaseFeature,
  type TReleaseFeatureIcon,
  WHATS_NEW_LAST_SEEN_STORAGE_KEY,
} from "./release-data";

const FEATURE_ICONS: Record<TReleaseFeatureIcon, LucideIcon> = {
  ai: Bot,
  analytics: BarChart3,
  interface: PanelRightOpen,
  performance: Gauge,
  planning: CalendarRange,
  quality: ListChecks,
  relations: Link2,
  reliability: ServerCog,
  reports: FileText,
  search: Search,
  security: ShieldCheck,
  tasks: ArrowRightLeft,
  today: CalendarCheck,
  updates: Megaphone,
};

const GANTT_COLUMNS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

export function WorkspaceWhatsNewRoot() {
  const { releaseVersion, workspaceSlug } = useParams();
  const router = useRouter();
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const previousReleaseSlugRef = useRef<string | null>(null);
  const workspaceSlugString = workspaceSlug?.toString() ?? "";
  const release = getReleaseBySlug(releaseVersion?.toString());
  const releaseIndex = PRODUCT_RELEASES.findIndex((item) => item.slug === release.slug);
  const olderRelease = PRODUCT_RELEASES[releaseIndex + 1];
  const newerRelease = PRODUCT_RELEASES[releaseIndex - 1];
  const { setValue: markReleaseAsSeen, storedValue: lastSeenRelease } = useLocalStorage<string | null>(
    WHATS_NEW_LAST_SEEN_STORAGE_KEY,
    null
  );

  useEffect(() => {
    if (release.slug === LATEST_RELEASE.slug && lastSeenRelease !== LATEST_RELEASE.slug) {
      markReleaseAsSeen(LATEST_RELEASE.slug);
    }
  }, [lastSeenRelease, markReleaseAsSeen, release.slug]);

  useEffect(() => {
    if (shouldResetReleaseScroll(previousReleaseSlugRef.current, release.slug)) {
      pageRootRef.current?.scrollIntoView({ block: "start" });
    }
    previousReleaseSlugRef.current = release.slug;
  }, [release.slug]);

  const getReleaseHref = (releaseSlug: string) => joinUrlPath(workspaceSlugString, `/whats-new/${releaseSlug}/`);

  return (
    <div ref={pageRootRef} className="min-h-full bg-surface-1">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-5 pt-6 pb-40 sm:px-8 sm:pt-8 sm:pb-40">
        <section
          className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
          aria-label="История обновлений"
        >
          <div>
            <p className="text-11 font-semibold tracking-wide text-accent-primary uppercase">История обновлений</p>
            <p className="mt-1 text-13 text-secondary">
              Выберите патч, чтобы посмотреть изменения и новые возможности.
            </p>
          </div>

          <div className="sm:hidden">
            <label htmlFor="release-version" className="sr-only">
              Выберите патч
            </label>
            <select
              id="release-version"
              value={release.slug}
              onChange={(event) => router.push(getReleaseHref(event.target.value))}
              className="h-9 w-full rounded-sm border border-strong bg-surface-1 px-3 text-12 font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            >
              {PRODUCT_RELEASES.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.version} · {item.releasedAt}
                </option>
              ))}
            </select>
          </div>

          <nav
            className="hidden items-center gap-1 rounded-md border border-subtle bg-layer-1 p-1 sm:flex"
            aria-label="Патчи"
          >
            {PRODUCT_RELEASES.map((item) => {
              const isActive = item.slug === release.slug;
              return (
                <Link
                  key={item.slug}
                  href={getReleaseHref(item.slug)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-sm px-3 text-12 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
                    isActive
                      ? "shadow-sm bg-surface-1 text-primary"
                      : "text-secondary hover:bg-layer-transparent-hover hover:text-primary"
                  )}
                >
                  {item.version}
                  {item.slug === LATEST_RELEASE.slug && (
                    <span className="rounded-sm bg-accent-primary/10 px-1.5 py-0.5 text-9 font-semibold text-accent-primary uppercase">
                      Новый
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </section>

        <section className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
          <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <div className="flex flex-col justify-center px-6 py-8 sm:px-9 sm:py-10">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-accent-primary px-2 py-1 text-11 font-semibold tracking-wide text-on-color uppercase">
                  {release.version}
                </span>
                <span className="inline-flex items-center gap-1.5 text-11 font-medium text-secondary">
                  <span className="size-1.5 rounded-full bg-accent-primary" aria-hidden="true" />
                  {release.status} · {release.releasedAt}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl max-w-2xl leading-tight font-semibold text-primary">
                {release.title}
              </h1>
              <p className="mt-3 max-w-2xl text-14 leading-6 text-secondary">{release.summary}</p>

              <div className="mt-6 flex flex-wrap gap-3">
                {release.actions.map((action, index) => (
                  <ReleaseAction
                    key={action.label}
                    action={action}
                    workspaceSlug={workspaceSlugString}
                    variant={index === 0 ? "primary" : "secondary"}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-subtle bg-layer-1/50 p-5 sm:p-7 lg:border-t-0 lg:border-l">
              {release.preview === "igor" ? (
                <IgorPreview />
              ) : release.preview === "igor-specification" ? (
                <IgorSpecificationPreview />
              ) : (
                <GanttPreview />
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="release-features-heading">
          <div className="mb-4 max-w-2xl">
            <p className="text-11 font-semibold tracking-wide text-accent-primary uppercase">Главное в обновлении</p>
            <h2 id="release-features-heading" className="text-xl mt-1.5 font-semibold text-primary">
              {release.featureTitle}
            </h2>
            <p className="mt-1.5 text-13 leading-5 text-secondary">{release.featureSummary}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {release.features.map((feature) => (
              <ReleaseFeatureCard key={feature.id} feature={feature} workspaceSlug={workspaceSlugString} />
            ))}
          </div>
        </section>

        <aside className="flex flex-col justify-between gap-4 rounded-lg border border-subtle bg-layer-transparent px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-13 font-semibold text-primary">{release.footer.title}</p>
            <p className="mt-0.5 text-12 leading-5 text-secondary">{release.footer.description}</p>
          </div>
          <ReleaseAction action={release.footer.action} workspaceSlug={workspaceSlugString} variant="secondary" />
        </aside>

        {(olderRelease || newerRelease) && (
          <nav className="flex items-center justify-between border-t border-subtle pt-5" aria-label="Соседние патчи">
            <div>
              {olderRelease && (
                <Link
                  href={getReleaseHref(olderRelease.slug)}
                  className="group inline-flex items-center gap-2 text-12 font-medium text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
                >
                  <ArrowLeft
                    className="size-3.5 transition-transform group-hover:-translate-x-0.5"
                    aria-hidden="true"
                  />
                  Предыдущий: {olderRelease.version}
                </Link>
              )}
            </div>
            <div>
              {newerRelease && (
                <Link
                  href={getReleaseHref(newerRelease.slug)}
                  className="group inline-flex items-center gap-2 text-12 font-medium text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
                >
                  Следующий: {newerRelease.version}
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              )}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

function ReleaseFeatureCard({ feature, workspaceSlug }: { feature: TReleaseFeature; workspaceSlug: string }) {
  const Icon = FEATURE_ICONS[feature.icon];

  return (
    <article className="group flex min-h-[330px] flex-col rounded-lg border border-subtle bg-surface-1 p-5 transition-colors hover:border-strong sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-10 place-items-center rounded-md bg-accent-primary/10 text-accent-primary">
          <Icon className="size-5 stroke-[1.7]" aria-hidden="true" />
        </div>
        <span className="rounded-sm bg-layer-1 px-2 py-1 text-10 font-semibold tracking-wide text-tertiary uppercase">
          {feature.label}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="text-lg leading-6 font-semibold text-primary">{feature.title}</h3>
        {feature.technicalDetails && <ReleaseTechnicalDetails details={feature.technicalDetails} />}
      </div>
      <p className="mt-2 text-13 leading-5 text-secondary">{feature.description}</p>

      <ul className="mt-4 flex flex-col gap-2.5">
        {feature.highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2 text-12 leading-5 text-secondary">
            <span className="mt-0.5 grid size-4 flex-none place-items-center rounded-full bg-accent-primary/10 text-accent-primary">
              <Check className="size-2.5 stroke-[2.5]" aria-hidden="true" />
            </span>
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-5">
        <ReleaseAction action={feature.action} workspaceSlug={workspaceSlug} variant="text" />
      </div>
    </article>
  );
}

function ReleaseTechnicalDetails({ details }: { details: NonNullable<TReleaseFeature["technicalDetails"]> }) {
  return (
    <Popover className="relative inline-flex">
      <Popover.Button className="group/technical border-accent-primary/20 hover:border-accent-primary/40 inline-flex h-6 items-center gap-1 rounded-sm border bg-accent-primary/5 px-2 text-10 font-semibold whitespace-nowrap text-accent-primary transition-colors outline-none hover:bg-accent-primary/10 focus-visible:ring-2 focus-visible:ring-accent-strong">
        <Code2 className="size-3 stroke-[1.8]" aria-hidden="true" />
        Под капотом
      </Popover.Button>

      <Popover.Panel className="shadow-lg absolute top-full left-0 z-30 mt-2 w-72 max-w-[calc(100vw-4rem)] rounded-md border border-strong bg-surface-1 p-4 sm:right-0 sm:left-auto sm:w-80">
        <div className="flex items-start gap-2.5">
          <span className="grid size-7 flex-none place-items-center rounded-sm bg-accent-primary/10 text-accent-primary">
            <Code2 className="size-4 stroke-[1.8]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-12 font-semibold text-primary">{details.title}</p>
            <p className="mt-1.5 text-11 leading-5 text-secondary">{details.description}</p>
          </div>
        </div>

        <div className="mt-3 border-t border-subtle pt-3">
          <p className="text-9 font-semibold tracking-wide text-tertiary uppercase">Инструменты</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {details.tools.map((tool) => (
              <span
                key={tool}
                className="font-mono rounded-sm border border-subtle bg-layer-1 px-1.5 py-1 text-9 text-secondary"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      </Popover.Panel>
    </Popover>
  );
}

function ReleaseAction({
  action,
  workspaceSlug,
  variant,
}: {
  action: TReleaseAction;
  workspaceSlug: string;
  variant: "primary" | "secondary" | "text";
}) {
  const className = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-sm text-12 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2",
    variant === "primary" && "h-9 bg-accent-primary px-3.5 text-on-color hover:bg-accent-primary/90",
    variant === "secondary" &&
      "h-9 border border-strong bg-surface-1 px-3.5 whitespace-nowrap text-primary hover:bg-layer-transparent-hover",
    variant === "text" && "text-accent-primary hover:text-accent-secondary"
  );
  const content = (
    <>
      {action.label}
      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </>
  );

  if (action.event === "open-igor") {
    return (
      <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("plane:open-igor"))}>
        {content}
      </button>
    );
  }

  if (!action.href) return null;

  return (
    <Link href={joinUrlPath(workspaceSlug, action.href)} className={className}>
      {content}
    </Link>
  );
}

function IgorPreview() {
  return (
    <div className="flex h-full flex-col justify-center" role="img" aria-label="Пример диалога с Игорем о задачах">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="border-accent-primary/20 grid size-8 place-items-center rounded-full border bg-accent-primary/10 text-accent-primary">
            <Sparkles className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-12 font-semibold text-primary">Игорь</p>
            <p className="mt-0.5 text-10 text-tertiary">Ассистент по задачам и срокам</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-10 font-medium text-secondary">
          <span className="size-1.5 rounded-full bg-success-primary" aria-hidden="true" />
          Готов помочь
        </span>
      </div>

      <div className="shadow-sm overflow-hidden rounded-md border border-subtle bg-surface-1 p-3.5">
        <div className="border-accent-primary/20 ml-auto max-w-[82%] rounded-md border bg-accent-primary/10 px-3 py-2 text-11 leading-4 text-primary">
          Что сейчас заблокировано?
        </div>
        <div className="mt-3 max-w-[92%] rounded-md bg-layer-1 px-3 py-2 text-11 leading-4 text-secondary">
          Нашёл две заблокированные задачи. Сначала стоит проверить задачу с ближайшим сроком.
        </div>

        <div className="mt-3 overflow-hidden rounded-md border border-subtle">
          <div className="flex items-center justify-between border-b border-subtle bg-layer-1/60 px-3 py-2">
            <span className="text-10 font-semibold text-secondary">Заблокированные задачи</span>
            <span className="text-9 text-tertiary">2 задачи</span>
          </div>
          <PreviewWorkItem code="DEV-128" title="Подготовить данные для отчёта" meta="До 15 июля · В работе" />
          <PreviewWorkItem code="OPS-42" title="Проверить доступ к окружению" meta="Без срока · Блокер" />
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-md border border-subtle bg-layer-1/50 px-3 py-2 text-10 text-tertiary">
          Спросите про задачи, сроки или сотрудника
          <Send className="ml-auto size-3.5 text-accent-primary" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-10 text-tertiary">
        <Activity className="size-3" aria-hidden="true" />
        Ответ собран из актуальных данных рабочего пространства
      </div>
    </div>
  );
}

function IgorSpecificationPreview() {
  const proposedTasks = [
    { code: "01", title: "Подготовить B2B-страницу", meta: "Цель и 4 критерия готовности" },
    { code: "02", title: "Настроить почтовые уведомления", meta: "Логика, события и открытые вопросы" },
    { code: "03", title: "Выбрать хранение документов", meta: "3 варианта для сравнения" },
  ];

  return (
    <div
      className="flex h-full flex-col justify-center"
      role="img"
      aria-label="Пример разбора технического задания Игорем"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="border-accent-primary/20 grid size-8 place-items-center rounded-md border bg-accent-primary/10 text-accent-primary">
            <Bot className="size-4 stroke-[1.8]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-12 font-semibold text-primary">Разбор технического задания</p>
            <p className="mt-0.5 text-10 text-tertiary">Игорь сохраняет связь с исходными пунктами</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-10 font-medium text-success-primary">
          <Check className="size-3.5" aria-hidden="true" />
          Готово
        </span>
      </div>

      <div className="shadow-sm overflow-hidden rounded-md border border-subtle bg-surface-1">
        <div className="border-b border-subtle bg-layer-1/50 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-11 font-semibold text-primary">Саммари встречи по запуску B2B</p>
              <p className="mt-0.5 text-9 text-secondary">34 исходных пункта · ничего не потеряно</p>
            </div>
            <span className="rounded-sm bg-success-subtle px-2 py-1 text-9 font-semibold text-success-primary">
              34 / 34
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-layer-1">
            <span className="block h-full w-full rounded-full bg-accent-primary" />
          </div>
        </div>

        <div className="p-3.5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-10 font-semibold text-secondary">Предложенные задачи</p>
            <span className="text-9 text-tertiary">проверка перед созданием</span>
          </div>
          <div className="flex flex-col gap-2">
            {proposedTasks.map((task) => (
              <div key={task.code} className="flex items-start gap-2.5 rounded-sm border border-subtle px-3 py-2">
                <span className="font-mono grid size-5 flex-none place-items-center rounded-sm bg-accent-primary/10 text-9 font-semibold text-accent-primary">
                  {task.code}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-10 font-semibold text-primary">{task.title}</p>
                  <p className="mt-0.5 truncate text-9 text-secondary">{task.meta}</p>
                </div>
                <Check className="ml-auto size-3.5 flex-none text-success-primary" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-subtle bg-layer-1/40 px-3.5 py-2.5 text-9 text-tertiary">
          <Code2 className="size-3.5 text-accent-primary" aria-hidden="true" />
          Цель · работы · критерии · вопросы
        </div>
      </div>
    </div>
  );
}

function PreviewWorkItem({ code, title, meta }: { code: string; title: string; meta: string }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-subtle px-3 py-2 last:border-b-0">
      <span className="mt-1 size-2 flex-none rounded-full bg-accent-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-9 font-medium text-tertiary">{code}</p>
        <p className="mt-0.5 truncate text-11 font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-9 text-secondary">{meta}</p>
      </div>
    </div>
  );
}

function GanttPreview() {
  const rows = [
    { label: "Исследование", left: "5%", width: "38%" },
    { label: "Дизайн", left: "27%", width: "34%" },
    { label: "Разработка", left: "48%", width: "43%" },
    { label: "Запуск", left: "82%", width: "14%" },
  ];

  return (
    <div className="flex h-full flex-col justify-center" role="img" aria-label="Пример плана задач на диаграмме Ганта">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-12 font-semibold text-primary">План релиза</p>
          <p className="mt-0.5 text-10 text-tertiary">Сроки и зависимости видны сразу</p>
        </div>
        <span className="rounded-sm border border-subtle bg-surface-1 px-2 py-1 text-10 font-medium text-secondary">
          Timeline
        </span>
      </div>

      <div className="shadow-sm overflow-hidden rounded-md border border-subtle bg-surface-1 p-3">
        <div className="mb-2 ml-[88px] grid grid-cols-5 text-center text-9 font-medium text-tertiary">
          <span>Пн</span>
          <span>Вт</span>
          <span>Ср</span>
          <span>Чт</span>
          <span>Пт</span>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-[88px] z-10">
            <span className="absolute top-0 bottom-0 left-[54%] w-px bg-accent-primary/60">
              <span className="border-surface-1 absolute -top-1 -left-1 size-2 rounded-full border-2 bg-accent-primary" />
            </span>
          </div>
          {rows.map((row, index) => (
            <div key={row.label} className="flex h-9 items-center border-t border-subtle first:border-t-0">
              <span className="w-[88px] flex-none truncate pr-3 text-9 font-medium text-secondary">{row.label}</span>
              <div className="relative h-full flex-1">
                <div className="absolute inset-0 grid grid-cols-5">
                  {GANTT_COLUMNS.map((column) => (
                    <span key={column} className="border-l border-subtle first:border-l-0" />
                  ))}
                </div>
                <span
                  className={
                    index === rows.length - 1
                      ? "absolute top-3 h-3 rounded-sm bg-accent-primary"
                      : "absolute top-2.5 h-4 rounded-sm bg-accent-primary/70"
                  }
                  style={{ left: row.left, width: row.width }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-10 text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent-primary/70" /> Задачи
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-px bg-accent-primary" /> Сегодня
        </span>
      </div>
    </div>
  );
}
