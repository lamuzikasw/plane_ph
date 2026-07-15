/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TReleaseFeatureIcon =
  | "ai"
  | "analytics"
  | "interface"
  | "performance"
  | "planning"
  | "quality"
  | "relations"
  | "reliability"
  | "reports"
  | "search"
  | "security"
  | "tasks"
  | "today"
  | "updates";
export type TReleasePreview = "gantt" | "igor" | "igor-specification";
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
  technicalDetails?: {
    title: string;
    description: string;
    tools: string[];
  };
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

export const PATCH_1_2 = {
  slug: "1-2",
  version: "Патч 1.2",
  status: "Новый",
  releasedAt: "15 июля 2026",
  title: "Игорь стал рабочим помощником",
  summary:
    "Разбирайте большие ТЗ, собирайте итоги недели и находите задачи обычными словами — с проверяемым результатом и безопасным доступом к данным.",
  preview: "igor-specification",
  actions: [
    { label: "Разобрать ТЗ с Игорем", event: "open-igor" },
    { label: "Открыть Сегодня", href: "/today/" },
  ],
  featureTitle: "От большого ТЗ до понятного отчёта",
  featureSummary:
    "Основные сценарии Игоря стали рабочими процессами: с проверкой, сохранением прогресса и контролем доступа.",
  features: [
    {
      id: "specifications",
      label: "Большие ТЗ",
      title: "ТЗ превращается в проверяемый план задач",
      description:
        "Вставьте документ целиком: Игорь сохранит каждый смысловой пункт и подготовит задачи, которые можно проверить до создания.",
      highlights: [
        "Принимает до 80 000 символов и 1 200 смысловых пунктов",
        "Пишет цель, план работ, критерии готовности и вопросы",
        "Показывает, какой пункт ТЗ покрывает каждая задача",
        "Не придумывает срок, приоритет или детали, которых нет в исходнике",
      ],
      icon: "ai",
      action: { label: "Разобрать ТЗ", event: "open-igor" },
      technicalDetails: {
        title: "Фоновый конвейер без потери прогресса",
        description:
          "Django принимает документ, Celery разбирает перекрывающиеся пакеты через LLM, а Redis хранит прогресс. Идемпотентность и распределённые блокировки защищают от повторной обработки.",
        tools: ["Django", "LLM", "Celery", "Redis", "distributed locks"],
      },
    },
    {
      id: "weekly-reports",
      label: "Итоги недели",
      title: "Отчёт для руководителя собирается за один запрос",
      description:
        "Игорь собирает завершённое, текущую работу, изменения сроков, просрочки и следующий план в короткое человеческое summary.",
      highlights: [
        "Понимает более 100 разговорных формулировок",
        "Личный отчёт включает только задачи пользователя",
        "OG может запросить команду, сотрудника или выбранные проекты",
        "Причины и результаты не додумываются без данных в Plane",
      ],
      icon: "reports",
      action: { label: "Собрать итоги", event: "open-igor" },
      technicalDetails: {
        title: "Факты считаются отдельно от формулировки",
        description:
          "Метрики и выборка строятся детерминированно по данным Plane. LLM отвечает только за компактный живой текст, а безопасный локальный шаблон остаётся запасным вариантом.",
        tools: ["Django ORM", "RBAC", "LLM", "safe fallback"],
      },
    },
    {
      id: "task-search",
      label: "Поиск задач",
      title: "Нужная задача находится по фрагменту или обычному запросу",
      description:
        "Спросите, где находится задача с crm_url, назовите её код или часть заголовка — Игорь покажет проект и рабочий контекст.",
      highlights: [
        "Ищет по коду, названию и техническим терминам",
        "Показывает проект, статус, исполнителя и прямую ссылку",
        "Обычный сотрудник видит только доступные ему задачи",
        "OG может искать работу всех сотрудников в рабочей области",
      ],
      icon: "search",
      action: { label: "Найти задачу", event: "open-igor" },
      technicalDetails: {
        title: "Поиск остаётся внутри прав пользователя",
        description:
          "Запрос нормализуется на сервере и сопоставляется с кодом и текстом задачи. Перед выдачей результата область поиска ограничивается доступными проектами и ролью пользователя.",
        tools: ["server search", "query normalization", "RBAC", "Django ORM"],
      },
    },
    {
      id: "igor-interface",
      label: "Новый Игорь",
      title: "Помощник получил собственное рабочее пространство",
      description:
        "Новый интерфейс вмещает длинные документы и сложные ответы, но остаётся компактным для короткого вопроса.",
      highlights: [
        "Новое лого и единая визуальная идентичность",
        "Окно и поле ввода можно растягивать под задачу",
        "Фоновый разбор восстанавливается после обновления страницы",
        "Быстрые действия не дублируют основные кнопки",
      ],
      icon: "interface",
      action: { label: "Открыть Игоря", event: "open-igor" },
      technicalDetails: {
        title: "Интерфейс знает состояние фоновой работы",
        description:
          "React-клиент сохраняет идентификатор задания, опрашивает API о прогрессе и восстанавливает результат после повторного открытия без повторной отправки ТЗ.",
        tools: ["React", "TypeScript", "job polling", "local state"],
      },
    },
    {
      id: "completion-quality",
      label: "Качество задач",
      title: "В Done попадают только заполненные задачи",
      description:
        "Перед завершением Plane проверяет исполнителя, дедлайн и приоритет, чтобы отчёты и аналитика опирались на полные данные.",
      highlights: [
        "Уведомление сразу перечисляет незаполненные поля",
        "Проверка работает на доске, в карточке и через API",
        "Ручное время дедлайна больше не превращается в 00:00",
        "Время сохраняется при создании и быстром редактировании",
      ],
      icon: "quality",
      action: { label: "Перейти к проектам", href: "/projects/" },
      technicalDetails: {
        title: "Двойная проверка на клиенте и сервере",
        description:
          "UI объясняет ошибку до отправки, а API повторяет обязательную валидацию и не позволяет обойти правило прямым запросом. Даты нормализуются без потери времени.",
        tools: ["React hooks", "Django validation", "API guard", "datetime normalization"],
      },
    },
    {
      id: "og-management",
      label: "Роль OG",
      title: "Руководитель видит команду, сотрудник — свою работу",
      description:
        "Роль OG открывает управленческий обзор, не смешивая его с личным дайджестом и доступом обычных сотрудников.",
      highlights: [
        "Аналитика и профили команды доступны только OG",
        "Личный раздел «Сегодня» всегда показывает собственные задачи",
        "OG получает доступ к существующим и новым проектам",
        "Командные отчёты Игоря учитывают только активных сотрудников",
      ],
      icon: "analytics",
      action: { label: "Открыть Сегодня", href: "/today/" },
      technicalDetails: {
        title: "Одна модель прав во всех слоях",
        description:
          "Код роли OG проверяется в API, permission-классах и интерфейсе. Сервер остаётся источником истины, поэтому скрытый экран нельзя открыть прямым запросом.",
        tools: ["RBAC", "Django permissions", "API scopes", "UI guards"],
      },
    },
    {
      id: "security",
      label: "Безопасность",
      title: "Игорь и API не раскрывают чувствительные данные",
      description:
        "Секреты, токены и закрытые данные отсекаются до ответа, а межпроектные операции проверяют доступ к каждой задаче.",
      highlights: [
        "Токены и содержимое запросов убраны из API-логов",
        "Production требует безопасный SECRET_KEY и HTTPS cookies",
        "Связи между проектами проверяют права с обеих сторон",
        "Экспорт аналитики защищён от формул в CSV",
      ],
      icon: "security",
      action: { label: "Открыть рабочую область", href: "/projects/" },
      technicalDetails: {
        title: "Защита применяется до формирования ответа",
        description:
          "Серверная фильтрация и middleware редактируют чувствительные значения, строгий allowlist ограничивает источники, а permission-слой проверяет область каждого запроса.",
        tools: ["Django middleware", "RBAC", "CORS allowlist", "Secure cookies"],
      },
    },
    {
      id: "reliability",
      label: "Надёжность",
      title: "Обновления больше не должны мешать рабочему дню",
      description:
        "Сессии сохраняются между сборками, а деплой обновляет только нужные сервисы и проверяет их до завершения операции.",
      highlights: [
        "Пользовательская сессия не зависит от новой frontend-сборки",
        "API, worker и web можно обновлять независимо",
        "PostgreSQL, Redis и очередь не перезапускаются без необходимости",
        "Health-checks и отдельные image-теги упрощают безопасный откат",
      ],
      icon: "reliability",
      action: { label: "Продолжить работу", href: "/projects/" },
      technicalDetails: {
        title: "Изолированные сервисы и воспроизводимые образы",
        description:
          "Docker Compose переключает только изменённые контейнеры. Версионированные образы, health-checks и сохранённый override дают проверяемый путь вперёд и быстрый откат.",
        tools: ["Docker Compose", "immutable images", "health checks", "safe rollback"],
      },
    },
  ],
  footer: {
    title: "Патч 1.2 уже работает в вашей рабочей области",
    description: "Откройте Игоря, вставьте ТЗ целиком или попросите собрать итоги прошедшей недели.",
    action: { label: "Попробовать нового Игоря", event: "open-igor" },
  },
} satisfies TProductRelease;

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
  featureTitle: "Главное для более связной работы",
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
        "Укажите, что задача одного проекта блокирует задачу в другом",
        "При выборе связи Plane покажет задачи из всех доступных проектов",
        "Название проекта рядом с задачей помогает не перепутать работу команд",
        "Если задач много, оставьте в списке только нужный проект",
      ],
      icon: "relations",
      action: { label: "Перейти к проектам", href: "/projects/" },
    },
    {
      id: "performance",
      label: "Производительность",
      title: "Стартовая загрузка стала примерно на 79% легче",
      description:
        "Объём данных при первом открытии сократился с 2,41 МБ до 498 КБ — за счёт сжатия, кеширования и разделения тяжёлого кода.",
      highlights: [
        "gzip сжимает JavaScript и CSS перед передачей браузеру",
        "Версионированные файлы кешируются и не скачиваются заново без изменений",
        "Тяжёлый store-context загружается отдельно, только когда становится нужен",
        "HTML перепроверяется при каждом открытии и сразу указывает на свежую сборку",
      ],
      icon: "performance",
      action: { label: "Открыть Сегодня", href: "/today/" },
    },
    {
      id: "updates",
      label: "Что нового?",
      title: "Все обновления Plane — в одном месте",
      description: "Новый раздел помогает не пропустить свежий патч и в любой момент вернуться к прошлым версиям.",
      highlights: [
        "О выходе нового патча сообщает синий индикатор рядом с разделом",
        "После просмотра свежего патча индикатор исчезает",
        "Между версиями можно переключаться в архиве обновлений",
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
  featureTitle: "Что изменилось в ежедневной работе",
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

export const PRODUCT_RELEASES = [PATCH_1_2, PATCH_1_1, PATCH_1_0] satisfies TProductRelease[];
export const LATEST_RELEASE = PRODUCT_RELEASES[0];

export const getReleaseBySlug = (releaseSlug?: string) =>
  PRODUCT_RELEASES.find((release) => release.slug === releaseSlug) ?? LATEST_RELEASE;

export const hasUnseenRelease = (lastSeenRelease?: string | null) => lastSeenRelease !== LATEST_RELEASE.slug;

export const shouldResetReleaseScroll = (previousReleaseSlug: string | null, releaseSlug: string) =>
  previousReleaseSlug !== null && previousReleaseSlug !== releaseSlug;

export const WHATS_NEW_LAST_SEEN_STORAGE_KEY = "whats-new:last-seen-release";
