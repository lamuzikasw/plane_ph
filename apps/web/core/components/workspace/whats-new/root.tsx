/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  CalendarCheck,
  CalendarRange,
  Check,
  type LucideIcon,
} from "lucide-react";
import { joinUrlPath } from "@plane/utils";
import { PATCH_1_0, type TReleaseFeature, type TReleaseFeatureIcon } from "./release-data";

const FEATURE_ICONS: Record<TReleaseFeatureIcon, LucideIcon> = {
  analytics: BarChart3,
  planning: CalendarRange,
  tasks: ArrowRightLeft,
  today: CalendarCheck,
};

const GANTT_COLUMNS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

export function WorkspaceWhatsNewRoot() {
  const { workspaceSlug } = useParams();
  const workspaceSlugString = workspaceSlug?.toString() ?? "";
  const release = PATCH_1_0;

  return (
    <div className="min-h-full bg-surface-1">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
        <section className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
          <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <div className="flex flex-col justify-center px-6 py-8 sm:px-9 sm:py-10">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-accent-primary px-2 py-1 text-11 font-semibold tracking-wide text-on-color uppercase">
                  {release.version}
                </span>
                <span className="inline-flex items-center gap-1.5 text-11 font-medium text-secondary">
                  <span className="size-1.5 rounded-full bg-accent-primary" aria-hidden="true" />
                  {release.status}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl max-w-2xl leading-tight font-semibold text-primary">
                {release.title}
              </h1>
              <p className="mt-3 max-w-2xl text-14 leading-6 text-secondary">{release.summary}</p>

              <div className="mt-6 flex flex-wrap gap-3">
                <ReleaseLink
                  href={joinUrlPath(workspaceSlugString, release.features[0].href)}
                  label="Посмотреть план"
                  variant="primary"
                />
                <ReleaseLink
                  href={joinUrlPath(workspaceSlugString, release.features[2].href)}
                  label="Открыть аналитику"
                  variant="secondary"
                />
              </div>
            </div>

            <div className="border-t border-subtle bg-layer-1/50 p-5 sm:p-7 lg:border-t-0 lg:border-l">
              <GanttPreview />
            </div>
          </div>
        </section>

        <section aria-labelledby="release-features-heading">
          <div className="mb-4 max-w-2xl">
            <p className="text-11 font-semibold tracking-wide text-accent-primary uppercase">Главное в обновлении</p>
            <h2 id="release-features-heading" className="text-xl mt-1.5 font-semibold text-primary">
              Четыре изменения, которые экономят время каждый день
            </h2>
            <p className="mt-1.5 text-13 leading-5 text-secondary">
              Коротко о том, что появилось и как это помогает в работе.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {release.features.map((feature) => (
              <ReleaseFeatureCard key={feature.id} feature={feature} workspaceSlug={workspaceSlugString} />
            ))}
          </div>
        </section>

        <aside className="flex flex-col justify-between gap-4 rounded-lg border border-subtle bg-layer-transparent px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-13 font-semibold text-primary">Патч 1.0 уже доступен в вашей рабочей области</p>
            <p className="mt-0.5 text-12 leading-5 text-secondary">
              Начните с Timeline, аналитики или личной страницы «Сегодня» — все данные уже связаны с вашими задачами.
            </p>
          </div>
          <ReleaseLink
            href={joinUrlPath(workspaceSlugString, "/today/")}
            label="Начать с Сегодня"
            variant="secondary"
          />
        </aside>
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

      <h3 className="text-lg mt-5 leading-6 font-semibold text-primary">{feature.title}</h3>
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
        <Link
          href={joinUrlPath(workspaceSlug, feature.href)}
          className="inline-flex items-center gap-1.5 rounded-sm text-12 font-semibold text-accent-primary outline-none hover:text-accent-secondary focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
        >
          {feature.actionLabel}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function ReleaseLink({ href, label, variant }: { href: string; label: string; variant: "primary" | "secondary" }) {
  return (
    <Link
      href={href}
      className={
        variant === "primary"
          ? "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-accent-primary px-3.5 text-12 font-semibold text-on-color outline-none hover:bg-accent-primary/90 focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
          : "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-strong bg-surface-1 px-3.5 text-12 font-semibold whitespace-nowrap text-primary outline-none hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
      }
    >
      {label}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
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
