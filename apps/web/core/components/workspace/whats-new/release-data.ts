/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TReleaseFeatureIcon = "analytics" | "planning" | "tasks" | "today";

export type TReleaseFeature = {
  id: string;
  label: string;
  title: string;
  description: string;
  highlights: string[];
  icon: TReleaseFeatureIcon;
  href: string;
  actionLabel: string;
};

export type TProductRelease = {
  version: string;
  status: string;
  title: string;
  summary: string;
  features: TReleaseFeature[];
};

/**
 * Release content lives separately from the view so the next patch can be
 * added without rebuilding the page structure.
 */
export const PATCH_1_0 = {
  version: "Патч 1.0",
  status: "Доступен",
  title: "Plane стал инструментом для управления командой",
  summary:
    "Планируйте сроки, замечайте риски и держите личный фокус — теперь ключевая картина работы собрана прямо в Plane.",
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
      href: "/workspace-views/all-issues/?layout=gantt_chart",
      actionLabel: "Открыть Timeline",
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
      href: "/projects/",
      actionLabel: "Перейти к проектам",
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
      href: "/analytics/overview/",
      actionLabel: "Открыть аналитику",
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
      href: "/today/",
      actionLabel: "Открыть Сегодня",
    },
  ],
} satisfies TProductRelease;
