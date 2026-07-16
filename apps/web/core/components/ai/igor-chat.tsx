/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  ExternalLink,
  ListChecks,
  ListTodo,
  Loader2,
  Maximize2,
  Minimize2,
  MoveDiagonal2,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { Link } from "react-router";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { cn, generateWorkItemLink } from "@plane/utils";
// services
import {
  AIService,
  type TIgorCaptureProcessingWidget as TIgorCaptureProcessingWidgetData,
  type TIgorCaptureWidget as TIgorCaptureWidgetData,
  type TIgorChatContext,
  type TIgorChatHistoryItem,
  type TIgorChatWorkItem,
  type TIgorWeeklySummaryWidget as TIgorWeeklySummaryWidgetData,
} from "@/services/ai.service";

import {
  clampIgorComposerHeight,
  getIgorCaptureJobStorageKey,
  getIgorCapturePollDelay,
  getIgorCaptureProcessingWidget,
  getIgorContextSegments,
  getIgorMessageLimit,
  IGOR_CAPTURE_MESSAGE_LENGTH,
  IGOR_COMPOSER_DEFAULT_HEIGHT,
  IGOR_COMPOSER_MAX_HEIGHT,
  IGOR_COMPOSER_MIN_HEIGHT,
  resolveIgorSuggestions,
  type TIgorMessage,
  upsertIgorCaptureJobMessage,
} from "./igor-chat.utils";

type TIgorCaptureTaskOverride = {
  title: string;
  goal: string;
  description: string;
  acceptance_criteria: string[];
  open_questions: string[];
  target_date: string | null;
  priority: TIgorCaptureWidgetData["tasks"][number]["priority"];
};

type TIgorParentTaskOverride = {
  title: string;
  goal: string;
  description: string;
};

type Props = {
  workspaceSlug: string;
};

const aiService = new AIService();
const PANEL_STORAGE_KEY = "plane:igor:panel-size";
const COMPOSER_STORAGE_KEY = "plane:igor:composer-height";
const DEFAULT_PANEL_SIZE = { width: 480, height: 720 };
const MIN_PANEL_SIZE = { width: 380, height: 480 };
const PANEL_VIEWPORT_GAP = 40;

const INITIAL_SUGGESTIONS = [
  "Собери мой summary за прошлую неделю",
  "Подготовь короткий отчёт руководителю за прошлую неделю",
  "Собери подробные итоги за текущую неделю",
  "Разбери ТЗ и предложи задачи",
  "Разбери заметки встречи и предложи задачи",
  "Покажи мои просроченные задачи",
];

type TIgorQuickAction = {
  id: "weekly" | "meeting" | "risks" | "tasks";
  title: string;
  description: string;
  prompt: string;
  mode: "ask" | "draft";
};

const QUICK_ACTIONS: TIgorQuickAction[] = [
  {
    id: "weekly",
    title: "Итоги недели",
    description: "Собрать готовый summary",
    prompt: "Собери мой summary за прошлую неделю",
    mode: "ask",
  },
  {
    id: "meeting",
    title: "Разобрать ТЗ",
    description: "Требования или заметки встречи",
    prompt: "Разбери ТЗ и предложи задачи:\n\n",
    mode: "draft",
  },
  {
    id: "risks",
    title: "Найти риски",
    description: "Просрочки и блокеры",
    prompt: "Покажи мои просроченные и заблокированные задачи",
    mode: "ask",
  },
  {
    id: "tasks",
    title: "Мои задачи",
    description: "Что сейчас в работе",
    prompt: "Покажи мои активные задачи",
    mode: "ask",
  },
];

const initialMessages = (): TIgorMessage[] => [];

type TIgorPanelSize = typeof DEFAULT_PANEL_SIZE;

type TIgorResizeSession = {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

type TIgorComposerResizeSession = {
  pointerId: number;
  startY: number;
  startHeight: number;
};

const clampPanelSize = ({ width, height }: TIgorPanelSize): TIgorPanelSize => {
  if (typeof window === "undefined") return { width, height };
  const maxWidth = Math.max(280, window.innerWidth - PANEL_VIEWPORT_GAP);
  const maxHeight = Math.max(360, window.innerHeight - PANEL_VIEWPORT_GAP);
  return {
    width: Math.min(Math.max(width, MIN_PANEL_SIZE.width), maxWidth),
    height: Math.min(Math.max(height, MIN_PANEL_SIZE.height), maxHeight),
  };
};

const stateLabels: Record<string, string> = {
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  cancelled: "Cancelled",
};

const buildHistoryPayload = (messages: TIgorMessage[]): TIgorChatHistoryItem[] =>
  messages.slice(-8).map((message) => ({
    role: message.role,
    text: message.text.slice(0, 2000),
    context: message.response?.context ?? null,
  }));

export function IgorChat({ workspaceSlug }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<TIgorMessage[]>(initialMessages);
  const [panelSize, setPanelSize] = useState<TIgorPanelSize>(DEFAULT_PANEL_SIZE);
  const [composerHeight, setComposerHeight] = useState(IGOR_COMPOSER_DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isComposerResizing, setIsComposerResizing] = useState(false);
  const [activeCaptureJobId, setActiveCaptureJobId] = useState<string | null>(null);
  const [capturePollVersion, setCapturePollVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeSessionRef = useRef<TIgorResizeSession | null>(null);
  const composerResizeSessionRef = useRef<TIgorComposerResizeSession | null>(null);
  const panelSizeRef = useRef<TIgorPanelSize>(panelSize);
  const composerHeightRef = useRef(composerHeight);
  const activeWorkspaceRef = useRef(workspaceSlug);
  const currentMessageLimit = getIgorMessageLimit(input);

  panelSizeRef.current = panelSize;
  composerHeightRef.current = composerHeight;

  useEffect(() => {
    try {
      const savedSize = window.localStorage.getItem(PANEL_STORAGE_KEY);
      if (!savedSize) return;
      const parsedSize = JSON.parse(savedSize) as Partial<TIgorPanelSize>;
      if (typeof parsedSize.width !== "number" || typeof parsedSize.height !== "number") return;
      setPanelSize(clampPanelSize({ width: parsedSize.width, height: parsedSize.height }));
    } catch {
      // Ignore malformed or unavailable browser storage and use the default size.
    }
  }, []);

  useEffect(() => {
    try {
      const savedHeight = Number(window.localStorage.getItem(COMPOSER_STORAGE_KEY));
      if (!Number.isFinite(savedHeight) || savedHeight <= 0) return;
      setComposerHeight(clampIgorComposerHeight(savedHeight, panelSizeRef.current.height));
    } catch {
      // Keep the default editor height when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const handleViewportResize = () => setPanelSize((currentSize) => clampPanelSize(currentSize));
    handleViewportResize();
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

  useEffect(() => {
    const effectivePanelHeight = isMaximized
      ? Math.max(MIN_PANEL_SIZE.height, window.innerHeight - PANEL_VIEWPORT_GAP)
      : panelSize.height;
    setComposerHeight((currentHeight) => clampIgorComposerHeight(currentHeight, effectivePanelHeight));
  }, [isMaximized, panelSize.height]);

  useEffect(
    () => () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    []
  );

  useEffect(() => {
    activeWorkspaceRef.current = workspaceSlug;
    setMessages(initialMessages());
    setInput("");
    setIsSubmitting(false);
    setIsOpen(false);
    try {
      setActiveCaptureJobId(window.localStorage.getItem(getIgorCaptureJobStorageKey(workspaceSlug)));
    } catch {
      setActiveCaptureJobId(null);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    if (!activeCaptureJobId) return;
    let cancelled = false;
    let pollTimer: number | undefined;

    const clearActiveJob = () => {
      setActiveCaptureJobId(null);
      try {
        window.localStorage.removeItem(getIgorCaptureJobStorageKey(workspaceSlug));
      } catch {
        // Polling still stops when local storage is unavailable.
      }
    };

    const poll = async () => {
      try {
        const response = await aiService.getIgorCaptureJob(workspaceSlug, activeCaptureJobId);
        if (cancelled || activeWorkspaceRef.current !== workspaceSlug) return;
        setMessages((currentMessages) => upsertIgorCaptureJobMessage(currentMessages, activeCaptureJobId, response));

        const processingWidget = getIgorCaptureProcessingWidget(response);
        if (!processingWidget) {
          clearActiveJob();
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "ТЗ разобрано",
            message: "Игорь подготовил задачи — проверь их перед созданием.",
          });
          return;
        }
        pollTimer = window.setTimeout(poll, getIgorCapturePollDelay(processingWidget.status));
      } catch (error) {
        if (cancelled) return;
        const responseStatus = (error as { status?: number } | undefined)?.status;
        if (responseStatus === 404 || responseStatus === 410) {
          clearActiveJob();
          return;
        }
        pollTimer = window.setTimeout(poll, getIgorCapturePollDelay(undefined, true));
      }
    };

    pollTimer = window.setTimeout(poll, 600);
    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [activeCaptureJobId, capturePollVersion, workspaceSlug]);

  useEffect(() => {
    const handleOpenIgor = () => setIsOpen(true);
    window.addEventListener("plane:open-igor", handleOpenIgor);
    return () => window.removeEventListener("plane:open-igor", handleOpenIgor);
  }, []);

  const suggestions = useMemo(() => {
    let lastAssistantMessage: TIgorMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") {
        lastAssistantMessage = messages[index];
        break;
      }
    }

    return resolveIgorSuggestions(lastAssistantMessage?.response?.suggestions, INITIAL_SUGGESTIONS);
  }, [messages]);

  const activeContext = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const context = messages[index].response?.context;
      if (context) return context;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;
    const animationFrame = window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    inputRef.current?.focus();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isOpen, messages.length, isSubmitting]);

  const persistPanelSize = (size: TIgorPanelSize) => {
    try {
      window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(size));
    } catch {
      // A private browser session can deny storage; resizing should still work for the current session.
    }
  };

  const getEffectivePanelHeight = () =>
    isMaximized
      ? Math.max(MIN_PANEL_SIZE.height, window.innerHeight - PANEL_VIEWPORT_GAP)
      : panelSizeRef.current.height;

  const persistComposerHeight = (height: number) => {
    try {
      window.localStorage.setItem(COMPOSER_STORAGE_KEY, String(height));
    } catch {
      // Resizing still works for the current session when browser storage is unavailable.
    }
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isMaximized) return;
    event.preventDefault();
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    setIsResizing(true);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const nextSize = clampPanelSize({
      width: session.startWidth + session.startX - event.clientX,
      height: session.startHeight + session.startY - event.clientY,
    });
    panelSizeRef.current = nextSize;
    setPanelSize(nextSize);
  };

  const finishPanelResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    resizeSessionRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    setIsResizing(false);
    persistPanelSize(panelSizeRef.current);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (isMaximized || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 24;
    const nextSize = clampPanelSize({
      width: panelSize.width + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
      height: panelSize.height + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
    });
    panelSizeRef.current = nextSize;
    setPanelSize(nextSize);
    persistPanelSize(nextSize);
  };

  const handleComposerResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    composerResizeSessionRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: composerHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    setIsComposerResizing(true);
  };

  const handleComposerResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = composerResizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const nextHeight = clampIgorComposerHeight(
      session.startHeight + session.startY - event.clientY,
      getEffectivePanelHeight()
    );
    composerHeightRef.current = nextHeight;
    setComposerHeight(nextHeight);
  };

  const finishComposerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = composerResizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    composerResizeSessionRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    setIsComposerResizing(false);
    persistComposerHeight(composerHeightRef.current);
  };

  const handleComposerResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    const nextHeight = clampIgorComposerHeight(
      composerHeight + (event.key === "ArrowUp" ? step : -step),
      getEffectivePanelHeight()
    );
    composerHeightRef.current = nextHeight;
    setComposerHeight(nextHeight);
    persistComposerHeight(nextHeight);
  };

  const resetComposerHeight = () => {
    const nextHeight = clampIgorComposerHeight(IGOR_COMPOSER_DEFAULT_HEIGHT, getEffectivePanelHeight());
    composerHeightRef.current = nextHeight;
    setComposerHeight(nextHeight);
    persistComposerHeight(nextHeight);
  };

  const askIgor = async (messageText: string) => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || isSubmitting) return;
    const messageLimit = getIgorMessageLimit(trimmedMessage);
    if (trimmedMessage.length > messageLimit) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Вопрос слишком длинный",
        message: `Сократи вопрос до ${messageLimit} символов.`,
      });
      return;
    }

    const requestWorkspaceSlug = workspaceSlug;
    setInput("");
    setIsSubmitting(true);
    const historyPayload = buildHistoryPayload(messages);
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmedMessage,
      },
    ]);

    try {
      const response = await aiService.askIgor(workspaceSlug, { message: trimmedMessage, history: historyPayload });
      if (activeWorkspaceRef.current !== requestWorkspaceSlug) return;
      const processingWidget = getIgorCaptureProcessingWidget(response);
      if (processingWidget) {
        setActiveCaptureJobId(processingWidget.job_id);
        try {
          window.localStorage.setItem(getIgorCaptureJobStorageKey(workspaceSlug), processingWidget.job_id);
        } catch {
          // The current tab still keeps polling when local storage is unavailable.
        }
      }
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: response.answer,
          response,
          request: {
            message: trimmedMessage,
            history: historyPayload,
            context: response.context,
          },
        },
      ]);
    } catch (error) {
      if (activeWorkspaceRef.current !== requestWorkspaceSlug) return;
      const serverAnswer = (error as { data?: { answer?: unknown } } | undefined)?.data?.answer;
      const errorMessage =
        typeof serverAnswer === "string"
          ? serverAnswer
          : "Я не смог достучаться до задач. Давай попробуем ещё раз через пару секунд.";
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Игорь не ответил",
        message: errorMessage,
      });
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: errorMessage,
        },
      ]);
    } finally {
      if (activeWorkspaceRef.current === requestWorkspaceSlug) setIsSubmitting(false);
    }
  };

  const createCaptureTasks = async (
    widget: TIgorCaptureWidgetData,
    taskIds: string[],
    projectAssignments: Record<string, string>,
    assigneeAssignments: Record<string, string>,
    taskOverrides: Record<string, TIgorCaptureTaskOverride>,
    createParent: boolean,
    parentProjectId: string,
    parentOverride: TIgorParentTaskOverride
  ): Promise<boolean> => {
    if (!widget.token || isSubmitting) return false;
    const requestWorkspaceSlug = workspaceSlug;
    setIsSubmitting(true);
    try {
      const response = await aiService.createIgorCaptureTasks(workspaceSlug, {
        action: "create_capture_tasks",
        capture_token: widget.token,
        task_ids: taskIds,
        project_assignments: projectAssignments,
        assignee_assignments: assigneeAssignments,
        create_parent: createParent,
        parent_project_id: parentProjectId,
        parent_override: parentOverride,
        task_overrides: taskOverrides,
      });
      if (activeWorkspaceRef.current !== requestWorkspaceSlug) return false;
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-created-${Date.now()}`,
          role: "assistant",
          text: response.answer,
          response,
        },
      ]);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Задачи созданы",
        message: `Создано задач: ${taskIds.length}.`,
      });
      return true;
    } catch (error) {
      if (activeWorkspaceRef.current !== requestWorkspaceSlug) return false;
      const serverAnswer = (error as { data?: { answer?: unknown } } | undefined)?.data?.answer;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось создать задачи",
        message: typeof serverAnswer === "string" ? serverAnswer : "Проверь проекты и повтори попытку.",
      });
      return false;
    } finally {
      if (activeWorkspaceRef.current === requestWorkspaceSlug) setIsSubmitting(false);
    }
  };

  const refineCaptureReview = async (
    widget: TIgorCaptureWidgetData,
    answers: Record<string, string>
  ): Promise<boolean> => {
    if (!widget.token || isSubmitting) return false;
    const requestWorkspaceSlug = workspaceSlug;
    setIsSubmitting(true);
    try {
      const response = await aiService.refineIgorCaptureReview(workspaceSlug, {
        action: "refine_capture_review",
        capture_token: widget.token,
        answers,
      });
      if (activeWorkspaceRef.current !== requestWorkspaceSlug) return false;
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.response?.widgets?.some((item) => item.type === "capture_review" && item.token === widget.token)
            ? { ...message, text: response.answer, response }
            : message
        )
      );
      const processingWidget = getIgorCaptureProcessingWidget(response);
      if (processingWidget) {
        setActiveCaptureJobId(processingWidget.job_id);
        setCapturePollVersion((current) => current + 1);
        try {
          window.localStorage.setItem(getIgorCaptureJobStorageKey(workspaceSlug), processingWidget.job_id);
        } catch {
          // Polling remains active in the current tab.
        }
      }
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: processingWidget ? "Пересборка запущена" : "Уточнения учтены",
        message: processingWidget
          ? "Игорь заново разберёт ТЗ и повторит проверку качества."
          : "Задачи пересобраны с учётом твоих ответов.",
      });
      return true;
    } catch (error) {
      if (activeWorkspaceRef.current !== requestWorkspaceSlug) return false;
      const serverAnswer = (error as { data?: { answer?: unknown } } | undefined)?.data?.answer;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось применить уточнения",
        message: typeof serverAnswer === "string" ? serverAnswer : "Ответы остались в форме. Попробуй ещё раз.",
      });
      return false;
    } finally {
      if (activeWorkspaceRef.current === requestWorkspaceSlug) setIsSubmitting(false);
    }
  };

  const retryCaptureJob = async (jobId: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await aiService.retryIgorCaptureJob(workspaceSlug, jobId);
      if (activeWorkspaceRef.current !== workspaceSlug) return;
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.response?.capture_job_id === jobId ? { ...message, text: response.answer, response } : message
        )
      );
      setActiveCaptureJobId(jobId);
      setCapturePollVersion((current) => current + 1);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Повтор запущен",
        message: "Игорь повторит только пакеты, которые не обработались.",
      });
    } catch (error) {
      const serverAnswer = (error as { data?: { answer?: unknown } } | undefined)?.data?.answer;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось продолжить разбор",
        message: typeof serverAnswer === "string" ? serverAnswer : "Попробуй ещё раз через минуту.",
      });
    } finally {
      if (activeWorkspaceRef.current === workspaceSlug) setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    askIgor(input);
  };

  const handleQuickAction = (action: TIgorQuickAction) => {
    if (action.mode === "ask") {
      askIgor(action.prompt);
      return;
    }
    setInput(action.prompt);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(action.prompt.length, action.prompt.length);
    });
  };

  return (
    <>
      {!isOpen && (
        <Tooltip tooltipContent="Открыть Игоря" position="left">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="text-sm shadow-md fixed right-5 bottom-5 z-40 flex h-12 items-center gap-2.5 rounded-full border border-subtle bg-surface-1 py-1.5 pr-4 pl-1.5 font-semibold text-primary transition hover:-translate-y-0.5 hover:border-[#0b6ea8]/40 hover:bg-surface-2 focus:ring-2 focus:ring-[#0b6ea8]/30 focus:ring-offset-2 focus:outline-none motion-reduce:transform-none"
          >
            <IgorMark size="sm" />
            Игорь
          </button>
        </Tooltip>
      )}

      {isOpen && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="igor-title"
          style={{
            width: isMaximized ? "calc(100vw - 40px)" : panelSize.width,
            height: isMaximized ? "calc(100vh - 40px)" : panelSize.height,
          }}
          className={cn(
            "shadow-2xl @container fixed right-5 bottom-5 z-40 flex max-h-[calc(100vh-40px)] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-1 ring-1 ring-black/5",
            !isResizing && "transition-[width,height] duration-200"
          )}
        >
          {!isMaximized && (
            <button
              type="button"
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={finishPanelResize}
              onPointerCancel={finishPanelResize}
              onKeyDown={handleResizeKeyDown}
              className="absolute top-1 left-1 z-10 hidden h-7 w-7 cursor-nwse-resize touch-none place-items-center rounded text-tertiary hover:bg-surface-2 hover:text-[#0b6ea8] focus:ring-2 focus:ring-[#0b6ea8] focus:outline-none sm:grid"
              aria-label="Изменить размер окна Игоря"
              title="Потяните, чтобы изменить размер. Стрелки изменяют размер с клавиатуры."
            >
              <MoveDiagonal2 className="h-3.5 w-3.5" />
            </button>
          )}

          <header className="flex min-h-16 items-center justify-between border-b border-subtle bg-surface-1 py-2.5 pr-3 pl-10">
            <div className="flex items-center gap-3">
              <IgorMark size="md" />
              <div className="min-w-0">
                <h2 id="igor-title" className="truncate text-[15px] leading-5 font-semibold text-primary">
                  Игорь
                </h2>
                <p className="text-xs flex items-center gap-1.5 truncate text-secondary">
                  <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                    <span className="bg-green-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 motion-reduce:hidden" />
                    <span className="bg-green-500 relative inline-flex h-2 w-2 rounded-full" />
                  </span>
                  Помощник по работе
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsMaximized((current) => !current)}
                className="grid h-8 w-8 place-items-center rounded-md text-secondary hover:bg-surface-2 hover:text-primary focus:ring-2 focus:ring-[#0b6ea8] focus:outline-none"
                aria-label={isMaximized ? "Вернуть размер окна Игоря" : "Развернуть окно Игоря"}
                title={isMaximized ? "Вернуть размер" : "Развернуть"}
              >
                {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-secondary hover:bg-surface-2 hover:text-primary focus:ring-2 focus:ring-[#0b6ea8] focus:outline-none"
                aria-label="Закрыть Игоря"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-surface-2/30 px-4 py-5">
            {messages.length === 0 ? (
              <IgorWelcome isSubmitting={isSubmitting} onAction={handleQuickAction} />
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex animate-fade-in items-start gap-2.5",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && <IgorMark size="xs" className="mt-0.5" />}
                    <div
                      className={cn(
                        "text-sm min-w-0 leading-5",
                        message.role === "user"
                          ? "max-w-[86%] rounded-2xl rounded-br-sm border border-[#0b6ea8]/20 bg-[#0b6ea8]/10 px-3.5 py-2.5 text-primary"
                          : "w-full text-primary"
                      )}
                    >
                      {message.role === "assistant" && (
                        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-tertiary uppercase">
                          Игорь
                        </div>
                      )}
                      {message.response?.context && <IgorContextStrip context={message.response.context} />}
                      <IgorMessageText text={message.text} collapsible={message.role === "user"} />
                      {message.response?.widgets?.map((widget) =>
                        widget.type === "weekly_summary" ? (
                          <IgorWeeklySummaryWidget
                            key={`${message.id}-${widget.type}-${widget.title}`}
                            widget={widget}
                            workspaceSlug={workspaceSlug}
                          />
                        ) : widget.type === "capture_processing" ? (
                          <IgorCaptureProcessingWidget
                            key={`${message.id}-${widget.type}-${widget.job_id}`}
                            widget={widget}
                            isSubmitting={isSubmitting}
                            onRetry={retryCaptureJob}
                          />
                        ) : widget.type === "capture_review" ? (
                          <IgorCaptureWidget
                            key={`${message.id}-${widget.type}-${widget.title}`}
                            widget={widget}
                            isSubmitting={isSubmitting}
                            onCreate={createCaptureTasks}
                            onRefine={refineCaptureReview}
                          />
                        ) : (
                          <IgorWorkItemWidget
                            key={`${message.id}-${widget.type}-${widget.title}`}
                            title={widget.title}
                            items={widget.items}
                            total={widget.total}
                            limit={widget.limit}
                            hasMore={widget.has_more}
                            nextOffset={widget.next_offset}
                            workspaceSlug={workspaceSlug}
                            request={message.request}
                          />
                        )
                      )}
                    </div>
                  </div>
                ))}
                {isSubmitting && (
                  <div className="flex animate-fade-in items-start gap-2.5" aria-live="polite">
                    <IgorMark size="xs" className="mt-0.5" />
                    <div>
                      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-tertiary uppercase">
                        Игорь
                      </div>
                      <div className="text-sm flex items-center gap-2 text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-[#0b6ea8]" />
                        Изучаю задачи и собираю факты
                        <span className="flex gap-0.5" aria-hidden="true">
                          <span className="bg-tertiary h-1 w-1 animate-pulse rounded-full" />
                          <span className="bg-tertiary h-1 w-1 animate-pulse rounded-full [animation-delay:150ms]" />
                          <span className="bg-tertiary h-1 w-1 animate-pulse rounded-full [animation-delay:300ms]" />
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-subtle bg-surface-1 px-4 py-3.5">
            {messages.length > 0 && suggestions.length > 0 && (
              <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => askIgor(suggestion)}
                    disabled={isSubmitting}
                    className="text-xs shrink-0 rounded-full border border-subtle bg-surface-2 px-3 py-1.5 text-secondary transition hover:border-[#0b6ea8]/40 hover:bg-surface-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {activeContext && <IgorContextStrip context={activeContext} compact className="mb-2.5" />}
            <div className="shadow-sm overflow-hidden rounded-2xl border border-subtle bg-surface-1 transition focus-within:border-[#0b6ea8]/60 focus-within:ring-2 focus-within:ring-[#0b6ea8]/10">
              <button
                type="button"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Изменить высоту поля ввода"
                aria-valuemin={IGOR_COMPOSER_MIN_HEIGHT}
                aria-valuemax={IGOR_COMPOSER_MAX_HEIGHT}
                aria-valuenow={Math.round(composerHeight)}
                title="Потяните вверх или вниз. Двойной клик вернёт обычную высоту."
                onPointerDown={handleComposerResizePointerDown}
                onPointerMove={handleComposerResizePointerMove}
                onPointerUp={finishComposerResize}
                onPointerCancel={finishComposerResize}
                onKeyDown={handleComposerResizeKeyDown}
                onDoubleClick={resetComposerHeight}
                className="group grid h-4 w-full cursor-ns-resize touch-none place-items-center border-b border-subtle bg-surface-2/50 focus:ring-2 focus:ring-[#0b6ea8]/30 focus:outline-none focus:ring-inset"
              >
                <span
                  className={cn(
                    "bg-tertiary/45 h-1 w-10 rounded-full transition group-hover:bg-[#0b6ea8]",
                    isComposerResizing && "bg-[#0b6ea8]"
                  )}
                  aria-hidden="true"
                />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Спросите Игоря о задачах или вставьте ТЗ / заметки встречи…"
                maxLength={IGOR_CAPTURE_MESSAGE_LENGTH}
                rows={2}
                aria-describedby="igor-input-hint"
                style={{ height: composerHeight }}
                className="text-sm w-full resize-none bg-transparent px-3.5 py-3 leading-5 text-primary outline-none placeholder:text-tertiary"
              />
              <div className="flex items-center justify-between gap-2 border-t border-subtle px-2 py-1.5">
                <div id="igor-input-hint" className="min-w-0 truncate text-[11px] text-tertiary">
                  Shift + Enter — новая строка
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "text-[11px] text-tertiary tabular-nums",
                      input.length > currentMessageLimit && "text-red-500"
                    )}
                  >
                    {input.length.toLocaleString("ru-RU")} / {currentMessageLimit.toLocaleString("ru-RU")}
                  </span>
                  <button
                    type="button"
                    onClick={() => askIgor(input)}
                    disabled={isSubmitting || !input.trim() || input.trim().length > currentMessageLimit}
                    className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#0b6ea8] px-2.5 text-white transition hover:bg-[#095d91] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Отправить сообщение Игорю"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span className="text-xs hidden font-medium @min-[28rem]:inline">Отправить</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function IgorMark({ size = "md", className }: { size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "shadow-xs relative grid shrink-0 place-items-center overflow-hidden border border-[#0b6ea8]/20 bg-white ring-1 ring-black/5 ring-inset",
        size === "xs" && "h-7 w-7 rounded-lg",
        size === "sm" && "h-9 w-9 rounded-xl",
        size === "md" && "h-10 w-10 rounded-xl",
        size === "lg" && "h-13 w-13 rounded-2xl",
        className
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="-3 -3 70 70"
        fill="none"
        className={cn(size === "xs" ? "h-5 w-5" : size === "lg" ? "h-10 w-10" : "h-7 w-7")}
      >
        <path
          d="M27 14.5h16.5A12.5 12.5 0 0 1 56 27v16A12.5 12.5 0 0 1 43.5 55.5H37l-9 8v-8h-7.5A12.5 12.5 0 0 1 8 43V28"
          stroke="#20242c"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13.5 1.5c.75 6.5 4.5 10.25 11 11-6.5.75-10.25 4.5-11 11-.75-6.5-4.5-10.25-11-11 6.5-.75 10.25-4.5 11-11Z"
          fill="#0b6ea8"
        />
        <path d="M26 31v7M39 31v7" stroke="#0b6ea8" strokeWidth="5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function IgorMessageText({ text, collapsible }: { text: string; collapsible: boolean }) {
  if (!collapsible || text.length <= 3000)
    return <p className="max-w-[68ch] whitespace-pre-wrap text-primary">{text}</p>;

  return (
    <details className="group max-w-[68ch]">
      <summary className="text-xs cursor-pointer list-none font-medium text-[#0b6ea8] focus:outline-none focus-visible:underline">
        <span className="group-open:hidden">Большое ТЗ · показать полностью</span>
        <span className="hidden group-open:inline">Свернуть исходное ТЗ</span>
      </summary>
      <p className="mt-2 max-h-80 overflow-y-auto border-t border-[#0b6ea8]/15 pt-2 whitespace-pre-wrap text-primary">
        {text}
      </p>
    </details>
  );
}

function IgorCaptureProcessingWidget({
  widget,
  isSubmitting,
  onRetry,
}: {
  widget: TIgorCaptureProcessingWidgetData;
  isSubmitting: boolean;
  onRetry: (jobId: string) => void;
}) {
  const statusText = {
    queued: "В очереди",
    processing: "Разбираю требования",
    retrying: "Повторяю один пакет",
    failed: "Нужен повтор",
  }[widget.status];

  return (
    <div className="shadow-xs mt-3 rounded-xl border border-subtle bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-primary">{widget.title}</div>
          <div className="mt-0.5 text-[11px] text-secondary">
            {widget.source_count} смысловых пунктов · {widget.completed_batches}/{widget.total_batches} пакетов
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-1 text-[10px] font-medium",
            widget.status === "failed" ? "bg-amber-500/10 text-amber-700" : "bg-[#0b6ea8]/10 text-[#0b6ea8]"
          )}
        >
          {statusText}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-label={`Прогресс ${widget.progress}%`}>
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            widget.status === "failed" ? "bg-amber-500" : "bg-[#0b6ea8]"
          )}
          style={{ width: `${widget.progress}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-secondary">
        <span>{widget.progress}% · результат сохраняется после каждого пакета</span>
        {widget.can_retry && (
          <button
            type="button"
            onClick={() => onRetry(widget.job_id)}
            disabled={isSubmitting}
            className="border-amber-500/30 text-amber-700 hover:bg-amber-500/10 rounded-md border px-2.5 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Повторить {widget.failed_batches > 0 ? `${widget.failed_batches} пак.` : "финализацию"}
          </button>
        )}
      </div>
      {widget.failure_message && (
        <div className="bg-amber-500/10 text-amber-800 mt-2 rounded-md px-2.5 py-2 text-[11px] leading-4">
          {widget.failure_message}
          {widget.failure_stage && <span className="ml-1 opacity-70">Этап: {widget.failure_stage}.</span>}
        </div>
      )}
      <p className="mt-2 text-[10px] leading-4 text-tertiary">
        Окно можно закрыть. При временной ошибке Игорь повторяет только текущий пакет, а готовые результаты не теряет.
      </p>
    </div>
  );
}

function IgorWelcome({
  isSubmitting,
  onAction,
}: {
  isSubmitting: boolean;
  onAction: (action: TIgorQuickAction) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl animate-fade-in flex-col justify-center py-6">
      <div className="mb-6 flex items-start gap-3.5">
        <IgorMark size="lg" />
        <div className="min-w-0 pt-0.5">
          <h3 className="text-xl leading-7 font-semibold tracking-[-0.02em] text-primary">Чем помочь?</h3>
          <p className="text-sm mt-1 max-w-[46ch] leading-5 text-secondary">
            Соберу факты из Plane, подготовлю отчёт или превращу большое ТЗ и заметки встречи в проверяемый план задач.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 @min-[27rem]:grid-cols-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onAction(action)}
            disabled={isSubmitting}
            className="group shadow-xs hover:shadow-sm flex min-h-20 items-start gap-3 rounded-xl border border-subtle bg-surface-1 p-3 text-left transition hover:-translate-y-0.5 hover:border-[#0b6ea8]/35 focus:border-[#0b6ea8] focus:ring-2 focus:ring-[#0b6ea8]/15 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transform-none"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0b6ea8]/10 text-[#0b6ea8] transition-colors group-hover:bg-[#0b6ea8] group-hover:text-white">
              <IgorQuickActionIcon actionId={action.id} />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="text-sm block font-semibold text-primary">{action.title}</span>
              <span className="text-xs mt-0.5 block leading-4 text-secondary">{action.description}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="text-xs mt-4 text-center leading-4 text-tertiary">
        Игорь использует только доступные вам задачи и проекты.
      </p>
    </div>
  );
}

function IgorQuickActionIcon({ actionId }: { actionId: TIgorQuickAction["id"] }) {
  const className = "h-4.5 w-4.5";
  if (actionId === "weekly") return <CalendarRange className={className} />;
  if (actionId === "meeting") return <ClipboardList className={className} />;
  if (actionId === "risks") return <ShieldAlert className={className} />;
  return <ListTodo className={className} />;
}

function IgorContextStrip({
  context,
  compact = false,
  className,
}: {
  context: TIgorChatContext;
  compact?: boolean;
  className?: string;
}) {
  const segments = getIgorContextSegments(context);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-tertiary",
        compact ? "rounded-lg border border-subtle bg-surface-2 px-2.5 py-1.5" : "mb-2",
        className
      )}
      aria-label={`Контекст: ${segments.join(", ")}`}
    >
      <span className="font-medium text-secondary">Контекст</span>
      {segments.map((segment) => (
        <span key={segment} className="flex min-w-0 items-center gap-1.5">
          <span className="bg-tertiary h-0.5 w-0.5 shrink-0 rounded-full" aria-hidden="true" />
          <span className="max-w-56 truncate">{segment}</span>
        </span>
      ))}
    </div>
  );
}

function IgorWeeklySummaryWidget({
  widget,
  workspaceSlug,
}: {
  widget: TIgorWeeklySummaryWidgetData;
  workspaceSlug: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(widget.copy_text);
      setIsCopied(true);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Краткое summary скопировано",
        message: "Текст готов к отправке.",
      });
      window.setTimeout(() => setIsCopied(false), 1800);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось скопировать",
        message: "Выдели текст отчёта и скопируй его вручную.",
      });
    }
  };

  return (
    <div className="shadow-xs mt-3 overflow-hidden rounded-xl border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-primary">{widget.title}</div>
            <div className="text-xs mt-0.5 flex flex-wrap items-center gap-1.5 text-secondary">
              <span>{widget.period_range}</span>
              <span aria-hidden="true">·</span>
              <span>
                {widget.summary_format === "compact"
                  ? "Кратко"
                  : widget.summary_format === "detailed"
                    ? "Подробно"
                    : "Стандартно"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={copySummary}
            className="text-xs flex shrink-0 items-center gap-1.5 rounded border border-subtle px-2 py-1.5 font-medium text-secondary transition hover:border-[#0b6ea8]/40 hover:text-[#0b6ea8]"
          >
            {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {isCopied ? "Готово" : "Скопировать краткое summary"}
          </button>
        </div>

        <div className="mt-3 rounded border border-subtle bg-surface-2 px-2.5 py-2">
          <div className="text-xs font-semibold text-primary">Коротко</div>
          <p className="text-xs mt-1 leading-4 text-secondary">{widget.overview}</p>
        </div>

        {widget.attention.length > 0 && (
          <div className="border-amber-500/20 bg-amber-500/5 mt-2 rounded border px-2.5 py-2">
            <div className="text-xs font-semibold text-primary">Требует внимания</div>
            <ul className="text-xs mt-1.5 space-y-1 text-secondary">
              {widget.attention.map((item) => (
                <li key={item} className="flex gap-1.5">
                  <span className="text-amber-500" aria-hidden="true">
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {widget.metrics.map((metric, index) => (
            <div
              key={metric.key}
              className={cn(
                "rounded border border-subtle bg-surface-2 px-2.5 py-2",
                index === widget.metrics.length - 1 && widget.metrics.length % 2 === 1 && "col-span-2"
              )}
            >
              <div className="text-base font-semibold text-primary">{metric.value}</div>
              <div className="text-xs text-secondary">{metric.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="divide-y divide-subtle">
        {widget.sections.map((section) => (
          <details
            key={section.key}
            open={
              section.key === "completed" ||
              section.key === "blocked" ||
              section.key === "overdue" ||
              section.key === "next_week"
            }
            className="group"
          >
            <summary className="cursor-pointer list-none px-3 py-2.5 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30 focus-visible:ring-inset">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">{section.title}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs rounded-full bg-surface-2 px-2 py-0.5 text-secondary">{section.total}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-tertiary transition-transform group-open:rotate-180" />
                </span>
              </div>
              <p className="text-xs mt-1 text-tertiary">{section.description}</p>
            </summary>

            <div className="border-t border-subtle bg-surface-2/40">
              {section.items.length === 0 ? (
                <div className="text-xs px-3 py-3 text-tertiary">{section.empty_text}</div>
              ) : (
                <>
                  {section.items.map((item) => {
                    const workItemLink = generateWorkItemLink({
                      workspaceSlug,
                      projectId: item.project_id,
                      issueId: item.id,
                      projectIdentifier: item.project_identifier,
                      sequenceId: item.sequence_id,
                    });

                    return (
                      <Link
                        key={`${section.key}-${item.id}`}
                        to={workItemLink}
                        className="group/item flex gap-2.5 border-b border-subtle px-3 py-2.5 last:border-b-0 hover:bg-surface-2"
                      >
                        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0b6ea8]" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-tertiary">
                            {item.project_identifier}-{item.sequence_id} · {item.project_name}
                          </div>
                          <div className="text-xs mt-0.5 line-clamp-2 font-medium text-primary">{item.name}</div>
                          {item.note && <div className="text-xs mt-1 text-secondary">{item.note}</div>}
                        </div>
                        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-tertiary opacity-0 transition group-hover/item:opacity-100" />
                      </Link>
                    );
                  })}
                  {section.total > section.items.length && (
                    <div className="text-xs px-3 py-2 text-tertiary">
                      В отчёте показано {section.items.length} из {section.total} задач.
                    </div>
                  )}
                </>
              )}
            </div>
          </details>
        ))}
      </div>

      <div className="text-xs border-t border-subtle px-3 py-2.5 leading-4 text-tertiary">{widget.source_note}</div>
    </div>
  );
}

function IgorCaptureWidget({
  widget,
  isSubmitting,
  onCreate,
  onRefine,
}: {
  widget: TIgorCaptureWidgetData;
  isSubmitting: boolean;
  onCreate: (
    widget: TIgorCaptureWidgetData,
    taskIds: string[],
    projectAssignments: Record<string, string>,
    assigneeAssignments: Record<string, string>,
    taskOverrides: Record<string, TIgorCaptureTaskOverride>,
    createParent: boolean,
    parentProjectId: string,
    parentOverride: TIgorParentTaskOverride
  ) => Promise<boolean>;
  onRefine: (widget: TIgorCaptureWidgetData, answers: Record<string, string>) => Promise<boolean>;
}) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(widget.tasks.filter((task) => !task.duplicate_issue).map((task) => task.id))
  );
  const [projectAssignments, setProjectAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      widget.tasks.filter((task) => task.project_id).map((task) => [task.id, task.project_id as string])
    )
  );
  const [assigneeAssignments, setAssigneeAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      widget.tasks.filter((task) => task.assignee_id).map((task) => [task.id, task.assignee_id as string])
    )
  );
  const [taskOverrides, setTaskOverrides] = useState<Record<string, TIgorCaptureTaskOverride>>(() =>
    Object.fromEntries(
      widget.tasks.map((task) => [
        task.id,
        {
          title: task.title,
          goal: task.goal,
          description: task.description,
          acceptance_criteria: task.acceptance_criteria,
          open_questions: task.open_questions,
          target_date: task.target_date,
          priority: task.priority,
        },
      ])
    )
  );
  const [isCreated, setIsCreated] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [createParent, setCreateParent] = useState(Boolean(widget.parent_task));
  const [parentProjectId, setParentProjectId] = useState(
    () => widget.tasks.find((task) => task.project_id)?.project_id ?? widget.projects[0]?.id ?? ""
  );
  const [parentOverride, setParentOverride] = useState<TIgorParentTaskOverride>(() => ({
    title: widget.parent_task?.title ?? "",
    goal: widget.parent_task?.goal ?? "",
    description: widget.parent_task?.description ?? "",
  }));
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries((widget.clarification_questions ?? []).map((question) => [question.id, ""]))
  );

  useEffect(() => {
    setSelectedTaskIds(new Set(widget.tasks.filter((task) => !task.duplicate_issue).map((task) => task.id)));
    setProjectAssignments(
      Object.fromEntries(
        widget.tasks.filter((task) => task.project_id).map((task) => [task.id, task.project_id as string])
      )
    );
    setAssigneeAssignments(
      Object.fromEntries(
        widget.tasks.filter((task) => task.assignee_id).map((task) => [task.id, task.assignee_id as string])
      )
    );
    setTaskOverrides(
      Object.fromEntries(
        widget.tasks.map((task) => [
          task.id,
          {
            title: task.title,
            goal: task.goal,
            description: task.description,
            acceptance_criteria: task.acceptance_criteria,
            open_questions: task.open_questions,
            target_date: task.target_date,
            priority: task.priority,
          },
        ])
      )
    );
    setIsCreated(false);
    setExpandedTaskId(null);
    setCreateParent(Boolean(widget.parent_task));
    setParentProjectId(widget.tasks.find((task) => task.project_id)?.project_id ?? widget.projects[0]?.id ?? "");
    setParentOverride({
      title: widget.parent_task?.title ?? "",
      goal: widget.parent_task?.goal ?? "",
      description: widget.parent_task?.description ?? "",
    });
    setClarificationAnswers(
      Object.fromEntries((widget.clarification_questions ?? []).map((question) => [question.id, ""]))
    );
  }, [widget]);

  const clarificationQuestions = widget.clarification_questions ?? [];
  const clarificationsRequired = clarificationQuestions.length > 0;
  const canRefine =
    Boolean(widget.token) &&
    clarificationsRequired &&
    clarificationQuestions.every((question) => clarificationAnswers[question.id]?.trim());
  const selectedTasks = widget.tasks.filter((task) => selectedTaskIds.has(task.id));
  const tasksWithoutProject = selectedTasks.filter((task) => !projectAssignments[task.id]);
  const canCreate =
    Boolean(widget.token) &&
    !isCreated &&
    !clarificationsRequired &&
    selectedTasks.length > 0 &&
    tasksWithoutProject.length === 0 &&
    (!createParent || Boolean(parentProjectId && parentOverride.title.trim() && parentOverride.description.trim())) &&
    selectedTasks.every((task) => taskOverrides[task.id]?.title.trim() && taskOverrides[task.id]?.description.trim());

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAllTasks = () => {
    const selectableTaskIds = widget.tasks.filter((task) => !task.duplicate_issue).map((task) => task.id);
    setSelectedTaskIds((current) =>
      selectableTaskIds.every((taskId) => current.has(taskId)) ? new Set() : new Set(selectableTaskIds)
    );
  };

  const categoryCount = (key: TIgorCaptureWidgetData["categories"][number]["key"]) =>
    widget.categories.find((category) => category.key === key)?.count ?? 0;

  return (
    <div className="shadow-xs mt-3 overflow-hidden rounded-xl border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-primary">{widget.title}</div>
            <div className="mt-0.5 text-[11px] text-secondary">
              Разобрано {widget.covered_count} из {widget.source_count} исходных пунктов
            </div>
            {widget.batch_count > 1 && (
              <div className="mt-0.5 text-[11px] text-tertiary">
                Большое ТЗ обработано автоматически в {widget.batch_count} смысловых пакетах
              </div>
            )}
          </div>
          <div
            className={cn(
              "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
              widget.covered_count === widget.source_count
                ? "bg-green-500/10 text-green-600"
                : "bg-amber-500/10 text-amber-600"
            )}
          >
            {widget.covered_count === widget.source_count ? "Все пункты учтены" : "Нужна проверка"}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-[#0b6ea8]/10 px-2 py-1 font-medium text-[#0b6ea8]">
            {widget.tasks.length} задач
          </span>
          {widget.analysis?.quality_status && (
            <span
              className={cn(
                "rounded px-2 py-1 font-medium",
                widget.analysis.quality_status === "passed"
                  ? "bg-green-500/10 text-green-700"
                  : "bg-amber-500/10 text-amber-700"
              )}
            >
              {widget.analysis.quality_status === "passed" ? "Проверка качества пройдена" : "Нужна проверка качества"}
            </span>
          )}
          {widget.action_count > 0 && (
            <span
              className={cn(
                "rounded px-2 py-1",
                widget.task_covered_count === widget.action_count
                  ? "bg-green-500/10 text-green-700"
                  : "bg-amber-500/10 text-amber-700"
              )}
            >
              Поручения: {widget.task_covered_count}/{widget.action_count}
            </span>
          )}
          {categoryCount("question") > 0 && (
            <span className="bg-amber-500/10 text-amber-700 rounded px-2 py-1">
              {categoryCount("question")} вопросов
            </span>
          )}
          {categoryCount("risk") > 0 && (
            <span className="bg-red-500/10 text-red-600 rounded px-2 py-1">{categoryCount("risk")} рисков</span>
          )}
          {categoryCount("decision") > 0 && (
            <span className="rounded bg-surface-2 px-2 py-1 text-secondary">{categoryCount("decision")} решений</span>
          )}
          {(widget.spec_constraints?.filter((item) => item.kind === "out_of_scope").length ?? 0) > 0 && (
            <span className="rounded bg-surface-2 px-2 py-1 text-secondary">
              Не входит: {widget.spec_constraints?.filter((item) => item.kind === "out_of_scope").length}
            </span>
          )}
        </div>
      </div>

      {clarificationsRequired ? (
        <section className="border-b border-[#0b6ea8]/20 bg-[#0b6ea8]/[0.035] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-primary">Уточнить перед созданием задач</div>
              <div className="mt-0.5 text-[11px] leading-4 text-secondary">
                Ответы станут частью источника. Игорь заново соберёт декомпозицию и повторит проверку качества.
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[#0b6ea8]/10 px-2 py-1 text-[10px] font-medium text-[#0b6ea8]">
              {clarificationQuestions.length} вопросов
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {clarificationQuestions.map((question, index) => (
              <label key={question.id} className="block">
                <span className="flex items-start gap-2 text-[11px] leading-4 font-medium text-primary">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0b6ea8]/10 text-[10px] text-[#0b6ea8]">
                    {index + 1}
                  </span>
                  <span>
                    {question.question}
                    {question.blocking && (
                      <span className="text-amber-700 ml-1 text-[10px] font-medium">важно для постановки</span>
                    )}
                  </span>
                </span>
                <span className="mt-1 block pl-7 text-[10px] leading-4 text-tertiary">{question.reason}</span>
                <textarea
                  value={clarificationAnswers[question.id] ?? ""}
                  onChange={(event) =>
                    setClarificationAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                  maxLength={2000}
                  rows={2}
                  disabled={isSubmitting}
                  placeholder={question.answer_hint}
                  className="mt-1.5 min-h-16 w-full resize-y rounded-md border border-subtle bg-surface-1 px-2.5 py-2 text-[11px] leading-4 text-primary outline-none placeholder:text-tertiary focus:border-[#0b6ea8] focus:ring-2 focus:ring-[#0b6ea8]/10 disabled:opacity-60"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onRefine(widget, clarificationAnswers)}
            disabled={!canRefine || isSubmitting}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-[#0b6ea8] px-3 py-2 text-[11px] font-medium text-white transition hover:bg-[#095d91] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Учесть ответы и пересобрать задачи
          </button>
          <div className="mt-1.5 text-center text-[10px] text-tertiary">
            Если данных пока нет, напиши «не определено» — Игорь оставит поле пустым.
          </div>
        </section>
      ) : (
        (widget.clarification_round ?? 0) > 0 && (
          <div className="border-green-500/15 bg-green-500/[0.035] text-green-700 flex items-center gap-2 border-b px-3 py-2 text-[11px]">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Уточнения учтены, декомпозиция и проверка качества выполнены повторно.
          </div>
        )
      )}

      {widget.parent_task && (
        <details open className="group border-b border-subtle bg-[#0b6ea8]/[0.025]">
          <summary className="cursor-pointer list-none px-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30 focus-visible:ring-inset">
            <div className="flex items-start gap-2.5">
              <label className="mt-0.5 flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={createParent}
                  onChange={(event) => setCreateParent(event.target.checked)}
                  disabled={isSubmitting}
                  aria-label="Создать родительскую задачу"
                  className="h-4 w-4 accent-[#0b6ea8]"
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold tracking-wide text-[#0b6ea8] uppercase">
                    Родительская задача
                  </span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-tertiary">
                    {widget.tasks.length} дочерних
                  </span>
                </div>
                <div className="mt-1 text-[13px] font-semibold text-primary">{parentOverride.title}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-secondary">
                  {parentOverride.goal || parentOverride.description}
                </div>
              </div>
              <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-tertiary transition group-open:rotate-180" />
            </div>
          </summary>
          <div className="grid gap-2 border-t border-subtle px-3 py-3">
            <div className="text-[11px] leading-4 text-secondary">
              Родитель объединит выбранные результаты в один рабочий пакет. Его можно отключить — тогда создадутся
              только обычные задачи.
            </div>
            <label className="text-xs grid gap-1 text-secondary">
              Название
              <input
                type="text"
                value={parentOverride.title}
                maxLength={255}
                onChange={(event) => setParentOverride((current) => ({ ...current, title: event.target.value }))}
                disabled={isSubmitting || !createParent}
                className="h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8] disabled:opacity-60"
              />
            </label>
            <label className="text-xs grid gap-1 text-secondary">
              Зачем нужен рабочий пакет
              <textarea
                value={parentOverride.goal}
                rows={2}
                maxLength={1200}
                onChange={(event) => setParentOverride((current) => ({ ...current, goal: event.target.value }))}
                disabled={isSubmitting || !createParent}
                className="min-h-16 resize-y rounded border border-subtle bg-surface-1 px-2 py-1.5 text-primary outline-none focus:border-[#0b6ea8] disabled:opacity-60"
              />
            </label>
            <label className="text-xs grid gap-1 text-secondary">
              Описание результата
              <textarea
                value={parentOverride.description}
                rows={3}
                maxLength={3000}
                onChange={(event) => setParentOverride((current) => ({ ...current, description: event.target.value }))}
                disabled={isSubmitting || !createParent}
                className="min-h-20 resize-y rounded border border-subtle bg-surface-1 px-2 py-1.5 text-primary outline-none focus:border-[#0b6ea8] disabled:opacity-60"
              />
            </label>
            <label className="text-xs grid gap-1 text-secondary">
              Проект родительской задачи
              <select
                value={parentProjectId}
                onChange={(event) => setParentProjectId(event.target.value)}
                disabled={isSubmitting || !createParent}
                className="h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8] disabled:opacity-60"
              >
                <option value="">Выбрать проект</option>
                {widget.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.identifier} · {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      )}

      {((widget.spec_constraints?.length ?? 0) > 0 ||
        (widget.spec_open_questions?.length ?? 0) > 0 ||
        (widget.spec_contradictions?.length ?? 0) > 0) && (
        <details className="group border-b border-subtle">
          <summary className="cursor-pointer list-none px-3 py-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30 focus-visible:ring-inset">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-primary">Рамки и вопросы до начала работы</span>
              <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
                {(widget.spec_constraints?.length ?? 0) +
                  (widget.spec_open_questions?.length ?? 0) +
                  (widget.spec_contradictions?.length ?? 0)}
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </div>
          </summary>
          <div className="space-y-3 border-t border-subtle bg-surface-2/40 px-3 py-2.5">
            {(widget.spec_constraints?.length ?? 0) > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-primary">Ограничения и не входит</div>
                <ul className="mt-1 space-y-1 text-[11px] leading-4 text-secondary">
                  {widget.spec_constraints?.map((constraint) => (
                    <li key={constraint.id} className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#0b6ea8]" />
                      <span>
                        {constraint.kind === "out_of_scope" && (
                          <span className="font-medium text-primary">Не входит: </span>
                        )}
                        {constraint.kind === "prohibition" && (
                          <span className="font-medium text-primary">Нельзя: </span>
                        )}
                        {constraint.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(widget.spec_open_questions?.length ?? 0) > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-primary">Открытые вопросы</div>
                <ul className="mt-1 space-y-1.5 text-[11px] leading-4 text-secondary">
                  {widget.spec_open_questions?.map((question) => (
                    <li key={question.id}>
                      <span className={question.blocking ? "text-amber-700 font-medium" : "font-medium text-primary"}>
                        {question.blocking ? "Блокирует: " : "Уточнить: "}
                      </span>
                      {question.question}
                      {question.reason && <span className="text-tertiary"> — {question.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(widget.spec_contradictions?.length ?? 0) > 0 && (
              <div className="border-amber-500/20 bg-amber-500/5 rounded border px-2 py-2">
                <div className="text-amber-700 text-[11px] font-semibold">Противоречия в ТЗ</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-4 text-secondary">
                  {widget.spec_contradictions?.map((contradiction) => (
                    <li key={contradiction.id}>{contradiction.description}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      <details className="group border-b border-subtle">
        <summary className="cursor-pointer list-none px-3 py-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30 focus-visible:ring-inset">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-primary">Исходное ТЗ и контекст</span>
            <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
              {widget.source_count} пунктов
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </span>
          </div>
        </summary>
        <div className="divide-y divide-subtle border-t border-subtle">
          {widget.categories.map((category) => (
            <details key={category.key}>
              <summary className="cursor-pointer list-none px-3 py-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30 focus-visible:ring-inset">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-primary">{category.title}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-secondary">
                      {category.count}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
                  </span>
                </div>
              </summary>
              <div className="space-y-1 border-t border-subtle bg-surface-2/40 px-3 py-2">
                {category.items.map((item) => (
                  <div
                    key={item.source_id}
                    id={`igor-source-${item.source_id}`}
                    className="scroll-m-24 rounded border border-subtle bg-surface-1 px-2 py-1.5 transition target:border-[#0b6ea8]"
                  >
                    <div className="flex items-start gap-2 text-[11px] leading-4">
                      <span className="shrink-0 font-medium text-[#0b6ea8]">{item.source_id}</span>
                      <span className="min-w-0 font-medium text-primary">
                        {item.section_path && item.section_path.length > 0 && (
                          <span className="font-normal mb-0.5 block text-[10px] text-tertiary">
                            {item.section_path.join(" / ")}
                          </span>
                        )}
                        {item.summary}
                      </span>
                    </div>
                    {item.summary.trim() !== item.source_text.trim() && (
                      <div className="mt-1 border-l border-subtle pl-2 text-[11px] leading-4 text-tertiary">
                        Исходник: {item.source_text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </details>

      <div className="border-t border-subtle px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
              <ListChecks className="h-3.5 w-3.5" />
              Предложенные задачи
            </div>
            <div className="mt-0.5 text-[11px] text-tertiary">Раскрой только те задачи, которые нужно поправить.</div>
          </div>
          {widget.tasks.length > 0 && (
            <button
              type="button"
              onClick={toggleAllTasks}
              disabled={isSubmitting}
              className="shrink-0 text-[11px] text-secondary hover:text-primary disabled:opacity-50"
            >
              {widget.tasks.filter((task) => !task.duplicate_issue).every((task) => selectedTaskIds.has(task.id))
                ? "Снять все"
                : "Выбрать все"}
            </button>
          )}
        </div>

        {widget.tasks.length === 0 ? (
          <div className="text-xs mt-3 rounded border border-subtle bg-surface-2 px-3 py-2.5 text-secondary">
            Явных поручений нет. Решения, вопросы и контекст сохранены выше, но превращать их в задачи без основания
            Игорь не стал.
          </div>
        ) : (
          <div className="mt-2 space-y-1.5">
            {widget.tasks.map((task) => {
              const isSelected = selectedTaskIds.has(task.id);
              const missingDeadline = task.missing_fields.includes("target_date");
              const missingPriority = task.missing_fields.includes("priority");
              const missingAssignee = !assigneeAssignments[task.id];
              const missingGoal = !taskOverrides[task.id]?.goal.trim();
              const missingCriteria = !taskOverrides[task.id]?.acceptance_criteria.some((item) => item.trim());
              const selectedProjectId = projectAssignments[task.id];
              const selectedProject = widget.projects.find((project) => project.id === selectedProjectId);
              const selectedAssignee = widget.members.find((member) => member.id === assigneeAssignments[task.id]);
              const assignableMembers = widget.members.filter(
                (member) => !selectedProjectId || member.project_ids.includes(selectedProjectId)
              );
              const override = taskOverrides[task.id] ?? {
                title: task.title,
                goal: task.goal,
                description: task.description,
                acceptance_criteria: task.acceptance_criteria,
                open_questions: task.open_questions,
                target_date: task.target_date,
                priority: task.priority,
              };
              return (
                <div
                  key={task.id}
                  className={cn(
                    "rounded border px-2 py-2 transition",
                    isSelected ? "border-[#0b6ea8]/30 bg-[#0b6ea8]/5" : "border-subtle bg-surface-2/50"
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTask(task.id)}
                      disabled={isSubmitting}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#0b6ea8]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] leading-4 font-medium text-primary" title={override.title}>
                        {override.title}
                      </span>
                      {task.section && (
                        <span className="mt-1 inline-flex rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-tertiary">
                          {task.section}
                        </span>
                      )}
                      {override.goal ? (
                        <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-secondary">
                          <span className="font-medium text-primary">Зачем:</span> {override.goal}
                        </span>
                      ) : (
                        <span className="text-amber-600 mt-1 block text-[11px] leading-4">
                          Цель не указана в ТЗ — её нужно уточнить
                        </span>
                      )}
                      {override.description && (
                        <span className="mt-0.5 line-clamp-3 block text-[11px] leading-4 text-secondary">
                          <span className="font-medium text-primary">Что сделать:</span> {override.description}
                        </span>
                      )}
                      {(override.acceptance_criteria.some((item) => item.trim()) ||
                        override.open_questions.length > 0) && (
                        <span className="mt-1 block text-[10px] text-tertiary">
                          Критериев: {override.acceptance_criteria.filter((item) => item.trim()).length} · Вопросов:{" "}
                          {override.open_questions.filter((item) => item.trim()).length}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11px] leading-4 text-tertiary">
                        {selectedProject?.name ?? "Проект не выбран"} ·{" "}
                        {selectedAssignee?.name ?? task.assignee_hint ?? "Исполнитель не найден"}
                        {" · "}
                        {task.source_ids.join(", ")}
                      </span>
                    </span>
                  </label>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-6">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-tertiary">
                      {override.target_date ? `Срок: ${formatShortDate(override.target_date)}` : "Срок не найден"}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-tertiary">
                      {override.priority === "none"
                        ? "Приоритет не найден"
                        : `Приоритет: ${priorityLabel(override.priority)}`}
                    </span>
                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => setExpandedTaskId((current) => (current === task.id ? null : task.id))}
                        disabled={isSubmitting}
                        className="ml-auto text-[11px] text-[#0b6ea8] hover:underline disabled:opacity-50"
                      >
                        {expandedTaskId === task.id ? "Свернуть" : "Настроить"}
                      </button>
                    )}
                  </div>

                  {task.duplicate_issue && (
                    <div className="text-xs text-amber-600 mt-2 flex items-start gap-1.5 pl-6">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Уже есть похожая задача: {task.duplicate_issue.identifier}. Она снята с выбора по умолчанию.
                      </span>
                    </div>
                  )}

                  {isSelected && expandedTaskId === task.id && (
                    <div className="mt-2 grid gap-2 border-t border-subtle pt-2">
                      <label className="text-xs grid gap-1 text-secondary">
                        Название
                        <input
                          type="text"
                          value={override.title}
                          maxLength={255}
                          onChange={(event) =>
                            setTaskOverrides((current) => ({
                              ...current,
                              [task.id]: { ...override, title: event.target.value },
                            }))
                          }
                          disabled={isSubmitting}
                          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8]"
                        />
                      </label>
                      <label className="text-xs grid gap-1 text-secondary">
                        Зачем нужна задача
                        <textarea
                          value={override.goal}
                          maxLength={1200}
                          rows={2}
                          placeholder="Если цель не следует из ТЗ, оставь поле пустым и уточни её у автора."
                          onChange={(event) =>
                            setTaskOverrides((current) => ({
                              ...current,
                              [task.id]: { ...override, goal: event.target.value },
                            }))
                          }
                          disabled={isSubmitting}
                          className="min-h-16 resize-y rounded border border-subtle bg-surface-1 px-2 py-1.5 text-primary outline-none focus:border-[#0b6ea8]"
                        />
                      </label>
                      <label className="text-xs grid gap-1 text-secondary">
                        Что нужно сделать <span className="text-red-500">обязательно</span>
                        <textarea
                          value={override.description}
                          maxLength={3000}
                          rows={3}
                          onChange={(event) =>
                            setTaskOverrides((current) => ({
                              ...current,
                              [task.id]: { ...override, description: event.target.value },
                            }))
                          }
                          disabled={isSubmitting}
                          className="min-h-20 resize-y rounded border border-subtle bg-surface-1 px-2 py-1.5 text-primary outline-none focus:border-[#0b6ea8]"
                        />
                      </label>
                      <label className="text-xs grid gap-1 text-secondary">
                        Критерии готовности <span className="font-normal text-tertiary">по одному на строку</span>
                        <textarea
                          value={override.acceptance_criteria.join("\n")}
                          maxLength={5000}
                          rows={3}
                          placeholder="Не добавляй критерии, которых нет в ТЗ или которые нельзя проверить."
                          onChange={(event) =>
                            setTaskOverrides((current) => ({
                              ...current,
                              [task.id]: {
                                ...override,
                                acceptance_criteria: event.target.value.split("\n").slice(0, 10),
                              },
                            }))
                          }
                          disabled={isSubmitting}
                          className="min-h-20 resize-y rounded border border-subtle bg-surface-1 px-2 py-1.5 text-primary outline-none focus:border-[#0b6ea8]"
                        />
                      </label>
                      <label className="text-xs grid gap-1 text-secondary">
                        Вопросы перед работой <span className="font-normal text-tertiary">по одному на строку</span>
                        <textarea
                          value={override.open_questions.join("\n")}
                          maxLength={5000}
                          rows={Math.max(2, Math.min(4, override.open_questions.length + 1))}
                          placeholder="Если неоднозначностей нет, оставь поле пустым."
                          onChange={(event) =>
                            setTaskOverrides((current) => ({
                              ...current,
                              [task.id]: {
                                ...override,
                                open_questions: event.target.value.split("\n").slice(0, 20),
                              },
                            }))
                          }
                          disabled={isSubmitting}
                          className="min-h-16 resize-y rounded border border-subtle bg-surface-1 px-2 py-1.5 text-primary outline-none focus:border-[#0b6ea8]"
                        />
                      </label>
                      {(task.source_refs?.length ?? 0) > 0 && (
                        <details className="rounded border border-subtle bg-surface-2/50">
                          <summary className="cursor-pointer list-none px-2 py-2 text-[11px] font-medium text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30">
                            Источники из ТЗ · {task.source_refs?.length}
                          </summary>
                          <div className="space-y-1 border-t border-subtle px-2 py-2">
                            {task.source_refs?.map((source) => (
                              <button
                                key={source.id}
                                type="button"
                                onClick={() =>
                                  document.getElementById(`igor-source-${source.id}`)?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center",
                                  })
                                }
                                className="block w-full rounded border border-subtle bg-surface-1 px-2 py-1.5 text-left hover:border-[#0b6ea8]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6ea8]/30"
                              >
                                <span className="text-[10px] font-medium text-[#0b6ea8]">{source.id}</span>
                                {source.section_path.length > 0 && (
                                  <span className="ml-1.5 text-[10px] text-tertiary">
                                    {source.section_path.join(" / ")}
                                  </span>
                                )}
                                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-secondary">
                                  {source.text}
                                </span>
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                      <label className="text-xs grid gap-1 text-secondary">
                        Проект <span className="text-red-500">обязательно</span>
                        <select
                          value={projectAssignments[task.id] ?? ""}
                          onChange={(event) => {
                            const nextProjectId = event.target.value;
                            setProjectAssignments((current) => ({ ...current, [task.id]: nextProjectId }));
                            const currentAssigneeId = assigneeAssignments[task.id];
                            const remainsAssignable = widget.members.some(
                              (member) => member.id === currentAssigneeId && member.project_ids.includes(nextProjectId)
                            );
                            if (!remainsAssignable)
                              setAssigneeAssignments((current) => ({ ...current, [task.id]: "" }));
                          }}
                          disabled={isSubmitting}
                          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8]"
                        >
                          <option value="">Выбрать проект</option>
                          {widget.projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.identifier} · {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs grid gap-1 text-secondary">
                        Исполнитель
                        <select
                          value={assigneeAssignments[task.id] ?? ""}
                          onChange={(event) =>
                            setAssigneeAssignments((current) => ({ ...current, [task.id]: event.target.value }))
                          }
                          disabled={isSubmitting || !selectedProjectId}
                          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8]"
                        >
                          <option value="">Не назначен</option>
                          {assignableMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs grid gap-1 text-secondary">
                          Срок
                          <input
                            type="date"
                            value={override.target_date ?? ""}
                            onChange={(event) =>
                              setTaskOverrides((current) => ({
                                ...current,
                                [task.id]: { ...override, target_date: event.target.value || null },
                              }))
                            }
                            disabled={isSubmitting}
                            className="h-8 min-w-0 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8]"
                          />
                        </label>
                        <label className="text-xs grid gap-1 text-secondary">
                          Приоритет
                          <select
                            value={override.priority}
                            onChange={(event) =>
                              setTaskOverrides((current) => ({
                                ...current,
                                [task.id]: {
                                  ...override,
                                  priority: event.target.value as TIgorCaptureWidgetData["tasks"][number]["priority"],
                                },
                              }))
                            }
                            disabled={isSubmitting}
                            className="h-8 min-w-0 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none focus:border-[#0b6ea8]"
                          >
                            <option value="none">Не указан</option>
                            <option value="urgent">Срочный</option>
                            <option value="high">Высокий</option>
                            <option value="medium">Средний</option>
                            <option value="low">Низкий</option>
                          </select>
                        </label>
                      </div>
                      {(missingDeadline || missingPriority || missingAssignee || missingGoal || missingCriteria) && (
                        <div className="text-xs text-amber-600 flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            Не найдено:{" "}
                            {[
                              missingAssignee && "исполнитель",
                              missingDeadline && "срок",
                              missingPriority && "приоритет",
                              missingGoal && "цель",
                              missingCriteria && "критерии готовности",
                            ]
                              .filter(Boolean)
                              .join(", ")}
                            . Игорь не стал придумывать данные.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {widget.tasks.length > 0 && (
          <div className="sticky bottom-0 z-10 mt-3 border-t border-subtle bg-surface-1/95 pt-2 backdrop-blur-sm">
            {tasksWithoutProject.length > 0 && (
              <div className="text-xs text-amber-600 mb-2">
                Выбери проект ещё для {tasksWithoutProject.length} задач.
              </div>
            )}
            <button
              type="button"
              onClick={async () => {
                const created = await onCreate(
                  widget,
                  selectedTasks.map((task) => task.id),
                  projectAssignments,
                  assigneeAssignments,
                  taskOverrides,
                  createParent,
                  parentProjectId,
                  parentOverride
                );
                if (created) setIsCreated(true);
              }}
              disabled={!canCreate || isSubmitting}
              className="text-xs flex w-full items-center justify-center gap-2 rounded bg-[#0b6ea8] px-3 py-2 font-medium text-white transition hover:bg-[#095d91] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isCreated
                ? "Задачи уже созданы"
                : `Создать ${createParent ? "рабочий пакет и " : ""}${selectedTasks.length} задач`}
            </button>
          </div>
        )}
      </div>

      <div className="text-xs border-t border-subtle px-3 py-2.5 leading-4 text-tertiary">{widget.source_note}</div>
    </div>
  );
}

type TIgorWorkItemWidgetProps = {
  title: string;
  items: TIgorChatWorkItem[];
  total?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
  workspaceSlug: string;
  request?: {
    message: string;
    history: TIgorChatHistoryItem[];
    context?: Partial<TIgorChatContext> | null;
  };
};

function IgorWorkItemWidget({
  title,
  items,
  total,
  limit,
  hasMore,
  nextOffset,
  workspaceSlug,
  request,
}: TIgorWorkItemWidgetProps) {
  const [loadedItems, setLoadedItems] = useState(items);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreItems, setHasMoreItems] = useState(Boolean(hasMore));
  const [nextItemsOffset, setNextItemsOffset] = useState(nextOffset ?? null);

  useEffect(() => {
    setLoadedItems(items);
    setHasMoreItems(Boolean(hasMore));
    setNextItemsOffset(nextOffset ?? null);
  }, [hasMore, items, nextOffset]);

  const loadMore = async () => {
    if (!request || isLoadingMore || nextItemsOffset === null) return;

    setIsLoadingMore(true);
    try {
      const response = await aiService.askIgor(workspaceSlug, {
        message: request.message,
        history: request.history,
        context: request.context,
        limit: limit ?? 12,
        offset: nextItemsOffset,
      });
      const workItemsWidget = response.widgets.find((widget) => widget.type === "work_items");
      if (!workItemsWidget) return;

      setLoadedItems((currentItems) => [...currentItems, ...workItemsWidget.items]);
      setHasMoreItems(Boolean(workItemsWidget.has_more));
      setNextItemsOffset(workItemsWidget.next_offset ?? null);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не получилось загрузить ещё",
        message: "Игорь не смог продолжить список. Попробуй повторить чуть позже.",
      });
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="shadow-xs mt-3 overflow-hidden rounded-xl border border-subtle bg-surface-1">
      <div className="text-xs flex items-center justify-between gap-2 border-b border-subtle px-3 py-2 font-medium text-secondary">
        <span className="min-w-0 truncate">{title}</span>
        {typeof total === "number" && total > loadedItems.length && (
          <span className="shrink-0 text-tertiary">
            {loadedItems.length}/{total}
          </span>
        )}
      </div>
      {loadedItems.length === 0 ? (
        <div className="text-xs px-3 py-3 text-tertiary">Подходящих задач нет.</div>
      ) : (
        <>
          <div className="max-h-72 overflow-y-auto">
            {loadedItems.map((item) => {
              const workItemLink = generateWorkItemLink({
                workspaceSlug,
                projectId: item.project_id,
                issueId: item.id,
                projectIdentifier: item.project_identifier,
                sequenceId: item.sequence_id,
              });

              return (
                <Link
                  key={item.id}
                  to={workItemLink}
                  className="group flex gap-3 border-b border-subtle px-3 py-2 last:border-b-0 hover:bg-surface-2"
                >
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#0b6ea8]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs flex items-center gap-2 text-tertiary">
                      <span>
                        {item.project_identifier}-{item.sequence_id}
                      </span>
                      <span className="truncate">{item.project_name}</span>
                    </div>
                    <div className="text-sm mt-0.5 line-clamp-2 font-medium text-primary">{item.name}</div>
                    <div className="text-xs mt-1 flex flex-wrap gap-1.5 text-secondary">
                      {item.state_group && (
                        <span>{stateLabels[item.state_group] ?? item.state_name ?? item.state_group}</span>
                      )}
                      {item.target_date && <span>до {formatDate(item.target_date)}</span>}
                      {item.assignees.length > 0 && (
                        <span>{item.assignees.map((assignee) => assignee.name).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-tertiary opacity-0 transition group-hover:opacity-100" />
                </Link>
              );
            })}
          </div>
          {hasMoreItems && (
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className="text-xs flex w-full items-center justify-center gap-2 border-t border-subtle px-3 py-2 font-medium text-[#0b6ea8] transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Показать ещё
            </button>
          )}
        </>
      )}
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function priorityLabel(priority: "none" | "urgent" | "high" | "medium" | "low") {
  return {
    none: "Нет",
    urgent: "Срочный",
    high: "Высокий",
    medium: "Средний",
    low: "Низкий",
  }[priority];
}
