/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TReleaseFeatureIcon =
  | "ai"
  | "analytics"
  | "performance"
  | "planning"
  | "relations"
  | "tasks"
  | "today"
  | "updates";
export type TReleasePreview = "gantt" | "igor";
export type TReleaseActionEvent = "open-igor";

export type TReleaseAction = {
  label: string;
  href?: string;
  event?: TReleaseActionEvent;
};

export type TReleaseFeature = {
  id: string;
  label: string;
  title: string;
  description: string;
  highlights: string[];
  icon: TReleaseFeatureIcon;
  action: TReleaseAction;
};

export type TProductRelease = {
  slug: string;
  version: string;
  status: string;
  releasedAt: string;
  title: string;
  summary: string;
  preview: TReleasePreview;
  actions: TReleaseAction[];
  featureTitle: string;
  featureSummary: string;
  features: TReleaseFeature[];
  footer: {
    title: string;
    description: string;
    action: TReleaseAction;
  };
};

export const PATCH_1_1 = {
  slug: "1-1",
  version: "Патч 1.1",
  status: "Новый",
  releasedAt: "14 июля 2026",
  title: "Игорь, связи между проектами и быстрый Plane",
  summary:
    "Спрашивайте о задачах обычными словами, связывайте работу разных команд и открывайте Plane заметно быстрее.",
  preview: "igor",
  actions: [
    { label: "Попробовать Игоря", event: "open-igor" },
    { label: "Перейти к проектам", href: "/projects/" },
  ],
  featureTitle: "Четыре изменения для более связной работы",
  featureSummary: "Игорь помогает найти главное, а Plane быстрее приводит к нужной задаче.",
  features: [
    {
      id: "igor",
      label: "ИИ-ассистент",
      title: "Спросите Игоря — он найдёт нужные задачи",
      description:
        "Игорь отвечает на вопросы о работе команды и собирает результат из актуальных данных рабочего пространства.",
      highlights: [
        "Находит просроченные, заблокированные и активные задачи",
        "Понимает сотрудников, проекты, даты и уточняющие вопросы",
        "Показывает карточки задач со сроком, статусом и исполнителем",
      ],
      icon: "ai",
      action: { label: "Открыть Игоря", event: "open-igor" },
    },
    {
      id: "relations",
      label: "Связи задач",
      title: "Зависимости больше не ограничены одним проектом",
      description: "Связывайте задачи разных команд и находите нужную работу по всему рабочему пространству.",
      highlights: [
        "Поиск связанных задач работает сразу по всем проектам",
        "Результаты можно отфильтровать по конкретному проекту",
        "В каждой связи видно, к какому проекту относится задача",
      ],
      icon: "relations",
      action: { label: "Перейти к проектам", href: "/projects/" },
    },
    {
      id: "performance",
      label: "Скорость",
      title: "Plane загружается легче и быстрее",
      description:
        "Стартовые файлы сжимаются, повторные открытия используют кеш, а тяжёлые данные загружаются отдельно.",
      highlights: [
        "Объём стартовой передачи уменьшен примерно на 79%",
        "Статические файлы не скачиваются повторно без изменений",
        "Экран загрузки появляется сразу, пока готовятся данные",
      ],
      icon: "performance",
      action: { label: "Открыть Сегодня", href: "/today/" },
    },
    {
      id: "updates",
      label: "Надёжность",
      title: "Обновления видны, а доска остаётся актуальной",
      description:
        "В боковом меню появился архив патчей, а перенос задачи между проектами сразу отражается на Kanban-доске.",
      highlights: [
        "Новый синий индикатор сообщает о свежем патче",
        "Историю обновлений можно открыть в любой момент",
        "После переноса задачи старая доска обновляется автоматически",
      ],
      icon: "updates",
      action: { label: "Посмотреть Патч 1.0", href: "/whats-new/1-0/" },
    },
  ],
  footer: {
    title: "Патч 1.1 уже доступен в вашей рабочей области",
    description: "Начните с вопроса Игорю — например, попросите показать просроченные задачи или работу на сегодня.",
    action: { label: "Попробовать Игоря", event: "open-igor" },
  },
} satisfies TProductRelease;

export const PATCH_1_0 = {
  slug: "1-0",
  version: "Патч 1.0",
  status: "Доступен",
  releasedAt: "13 июля 2026",
  title: "Plane стал инструментом для управления командой",
  summary:
    "Планируйте сроки, замечайте риски и держите личный фокус — теперь ключевая картина работы собрана прямо в Plane.",
  preview: "gantt",
  actions: [
    { label: "Посмотреть план", href: "/workspace-views/all-issues/?layout=gantt_chart" },
    { label: "Открыть аналитику", href: "/analytics/overview/" },
  ],
  featureTitle: "Четыре изменения, которые экономят время каждый день",
  featureSummary: "Коротко о том, что появилось и как это помогает в работе.",
  features: [
    {
      id: "planning",
      label: "Планирование",
      title: "Сроки и зависимости — на одной шкале",
      description:
        "Timeline стал полноценной диаграммой Ганта. На ней видно, когда идет работа, какие задачи пересекаются и что блокирует следующий шаг.",
      highlights: [
        "Связи создаются прямо на диаграмме и отображаются стрелками",
        "Ошибочную зависимость можно удалить без перехода в карточку",
        "Масштаб помогает уместить названия и увидеть весь план",
      ],
      icon: "planning",
      action: { label: "Открыть Timeline", href: "/workspace-views/all-issues/?layout=gantt_chart" },
    },
    {
      id: "tasks",
      label: "Работа с задачами",
      title: "Меньше ручных действий на доске",
      description:
        "Задачу стало проще передать другой команде, а завершенную работу — убрать с доски, не теряя историю.",
      highlights: [
        "Переносите задачу в другой проект прямо из ее карточки",
        "Сразу выбирайте новое состояние — пересоздавать задачу не нужно",
        "Архивируйте весь столбец Done одной кнопкой",
      ],
      icon: "tasks",
      action: { label: "Перейти к проектам", href: "/projects/" },
    },
    {
      id: "analytics",
      label: "Аналитика",
      title: "Картина команды без ручных отчетов",
      description:
        "Новый управленческий обзор показывает загрузку, сроки, риски и качество данных по всей рабочей области.",
      highlights: [
        "Ключевые показатели собраны по сотрудникам и проектам",
        "Клик по метрике открывает конкретные задачи и ответственных",
        "Видимость метрик настраивается, а подсказки объясняют расчет",
      ],
      icon: "analytics",
      action: { label: "Открыть аналитику", href: "/analytics/overview/" },
    },
    {
      id: "today",
      label: "Личный фокус",
      title: "«Сегодня» собирает главное на день",
      description:
        "Личная страница помогает начать день с приоритетов: срочные задачи, блокеры и ближайшие дедлайны всегда перед глазами.",
      highlights: [
        "«Сделать сегодня» показывает задачи с дедлайном на текущий день",
        "«Ближайшее» не дает пропустить следующие сроки",
        "Daily digest пересобирается из актуальных задач и блокеров",
      ],
      icon: "today",
      action: { label: "Открыть Сегодня", href: "/today/" },
    },
  ],
  footer: {
    title: "Патч 1.0 доступен в вашей рабочей области",
    description: "Откройте Timeline, аналитику или личную страницу «Сегодня» — все данные уже связаны с задачами.",
    action: { label: "Начать с Сегодня", href: "/today/" },
  },
} satisfies TProductRelease;

export const PRODUCT_RELEASES = [PATCH_1_1, PATCH_1_0] satisfies TProductRelease[];
export const LATEST_RELEASE = PRODUCT_RELEASES[0];

export const getReleaseBySlug = (releaseSlug?: string) =>
  PRODUCT_RELEASES.find((release) => release.slug === releaseSlug) ?? LATEST_RELEASE;

export const hasUnseenRelease = (lastSeenRelease?: string | null) => lastSeenRelease !== LATEST_RELEASE.slug;

export const WHATS_NEW_LAST_SEEN_STORAGE_KEY = "whats-new:last-seen-release";
