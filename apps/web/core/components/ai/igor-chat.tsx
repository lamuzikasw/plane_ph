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
  type TIgorCaptureWidget as TIgorCaptureWidgetData,
  type TIgorChatContext,
  type TIgorChatHistoryItem,
  type TIgorChatResponse,
  type TIgorChatWorkItem,
  type TIgorWeeklySummaryWidget as TIgorWeeklySummaryWidgetData,
} from "@/services/ai.service";

import { getIgorContextSegments } from "./igor-chat.utils";

type TIgorMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: TIgorChatResponse;
  request?: {
    message: string;
    history: TIgorChatHistoryItem[];
    context?: Partial<TIgorChatContext> | null;
  };
};

type Props = {
  workspaceSlug: string;
};

const aiService = new AIService();
const REGULAR_MESSAGE_LENGTH = 5000;
const CAPTURE_MESSAGE_LENGTH = 8000;
const PANEL_STORAGE_KEY = "plane:igor:panel-size";
const DEFAULT_PANEL_SIZE = { width: 480, height: 720 };
const MIN_PANEL_SIZE = { width: 380, height: 480 };
const PANEL_VIEWPORT_GAP = 40;

const INITIAL_SUGGESTIONS = [
  "Собери мой summary за прошлую неделю",
  "Подготовь короткий отчёт руководителю за прошлую неделю",
  "Собери подробные итоги за текущую неделю",
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
    title: "Разобрать встречу",
    description: "Решения, риски и задачи",
    prompt: "Разбери заметки встречи и предложи задачи:\n\n",
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

const clampPanelSize = ({ width, height }: TIgorPanelSize): TIgorPanelSize => {
  if (typeof window === "undefined") return { width, height };
  const maxWidth = Math.max(280, window.innerWidth - PANEL_VIEWPORT_GAP);
  const maxHeight = Math.max(360, window.innerHeight - PANEL_VIEWPORT_GAP);
  return {
    width: Math.min(Math.max(width, MIN_PANEL_SIZE.width), maxWidth),
    height: Math.min(Math.max(height, MIN_PANEL_SIZE.height), maxHeight),
  };
};

const getMessageLimit = (message: string) =>
  /разбер|обработ|структур|разлож|преврат|вытащ|выдел|предлож|поручен|договорен|задач.*из|meeting notes|action items|turn this into tasks|categorize these notes/i.test(
    message
  )
    ? CAPTURE_MESSAGE_LENGTH
    : REGULAR_MESSAGE_LENGTH;

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
    text: message.text,
    context: message.response?.context ?? null,
  }));

export function IgorChat({ workspaceSlug }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<TIgorMessage[]>(initialMessages);
  const [panelSize, setPanelSize] = useState<TIgorPanelSize>(DEFAULT_PANEL_SIZE);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeSessionRef = useRef<TIgorResizeSession | null>(null);
  const panelSizeRef = useRef<TIgorPanelSize>(panelSize);
  const activeWorkspaceRef = useRef(workspaceSlug);
  const currentMessageLimit = getMessageLimit(input);

  panelSizeRef.current = panelSize;

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
    const handleViewportResize = () => setPanelSize((currentSize) => clampPanelSize(currentSize));
    handleViewportResize();
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

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
  }, [workspaceSlug]);

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

    return lastAssistantMessage?.response?.suggestions?.length
      ? lastAssistantMessage.response.suggestions
      : INITIAL_SUGGESTIONS;
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

  const askIgor = async (messageText: string) => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || isSubmitting) return;
    const messageLimit = getMessageLimit(trimmedMessage);
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
    taskOverrides: Record<
      string,
      {
        title: string;
        target_date: string | null;
        priority: TIgorCaptureWidgetData["tasks"][number]["priority"];
      }
    >
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
            className="text-sm shadow-md hover:border-custom-primary-100/40 focus:ring-custom-primary-100/30 fixed right-5 bottom-5 z-40 flex h-12 items-center gap-2.5 rounded-full border border-subtle bg-surface-1 py-1.5 pr-4 pl-1.5 font-semibold text-primary transition hover:-translate-y-0.5 hover:bg-surface-2 focus:ring-2 focus:ring-offset-2 focus:outline-none motion-reduce:transform-none"
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
              className="hover:text-custom-primary-100 focus:ring-custom-primary-100 absolute top-1 left-1 z-10 hidden h-7 w-7 cursor-nwse-resize touch-none place-items-center rounded text-tertiary hover:bg-surface-2 focus:ring-2 focus:outline-none sm:grid"
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
                className="focus:ring-custom-primary-100 grid h-8 w-8 place-items-center rounded-md text-secondary hover:bg-surface-2 hover:text-primary focus:ring-2 focus:outline-none"
                aria-label={isMaximized ? "Вернуть размер окна Игоря" : "Развернуть окно Игоря"}
                title={isMaximized ? "Вернуть размер" : "Развернуть"}
              >
                {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="focus:ring-custom-primary-100 grid h-8 w-8 place-items-center rounded-md text-secondary hover:bg-surface-2 hover:text-primary focus:ring-2 focus:outline-none"
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
                          ? "border-custom-primary-100/20 bg-custom-primary-100/10 max-w-[86%] rounded-2xl rounded-br-sm border px-3.5 py-2.5 text-primary"
                          : "w-full text-primary"
                      )}
                    >
                      {message.role === "assistant" && (
                        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-tertiary uppercase">
                          Игорь
                        </div>
                      )}
                      {message.response?.context && <IgorContextStrip context={message.response.context} />}
                      <p className="max-w-[68ch] whitespace-pre-wrap text-primary">{message.text}</p>
                      {message.response?.widgets?.map((widget) =>
                        widget.type === "weekly_summary" ? (
                          <IgorWeeklySummaryWidget
                            key={`${message.id}-${widget.type}-${widget.title}`}
                            widget={widget}
                            workspaceSlug={workspaceSlug}
                          />
                        ) : widget.type === "capture_review" ? (
                          <IgorCaptureWidget
                            key={`${message.id}-${widget.type}-${widget.title}`}
                            widget={widget}
                            isSubmitting={isSubmitting}
                            onCreate={createCaptureTasks}
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
                        <Loader2 className="text-custom-primary-100 h-4 w-4 animate-spin" />
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
            {messages.length > 0 && (
              <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => askIgor(suggestion)}
                    disabled={isSubmitting}
                    className="text-xs hover:border-custom-primary-200 shrink-0 rounded-full border border-subtle bg-surface-2 px-3 py-1.5 text-secondary transition hover:bg-surface-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {activeContext && <IgorContextStrip context={activeContext} compact className="mb-2.5" />}
            <div className="focus-within:border-custom-primary-100/60 focus-within:ring-custom-primary-100/10 shadow-sm overflow-hidden rounded-2xl border border-subtle bg-surface-1 transition focus-within:ring-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Спросите Игоря о задачах или вставьте заметки встречи…"
                maxLength={CAPTURE_MESSAGE_LENGTH}
                rows={2}
                aria-describedby="igor-input-hint"
                className="text-sm max-h-52 min-h-18 w-full resize-y bg-transparent px-3.5 py-3 leading-5 text-primary outline-none placeholder:text-tertiary"
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
                    className="bg-custom-primary-100 hover:bg-custom-primary-200 flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-white transition disabled:cursor-not-allowed disabled:opacity-50"
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
        "bg-custom-primary-100 shadow-sm relative grid shrink-0 place-items-center overflow-hidden text-white ring-1 ring-white/15 ring-inset",
        size === "xs" && "h-7 w-7 rounded-lg",
        size === "sm" && "h-9 w-9 rounded-xl",
        size === "md" && "h-10 w-10 rounded-xl",
        size === "lg" && "h-13 w-13 rounded-2xl",
        className
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-x-0 top-0 h-px bg-white/35" />
      <svg
        viewBox="0 0 32 32"
        fill="none"
        className={cn(size === "xs" ? "h-4.5 w-4.5" : size === "lg" ? "h-8 w-8" : "h-6 w-6")}
      >
        <path
          d="M8.5 8.5v15M23 8.5v15M8.5 23.5 23 8.5"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M25.5 3.75c0 1.52 1.23 2.75 2.75 2.75-1.52 0-2.75 1.23-2.75 2.75 0-1.52-1.23-2.75-2.75-2.75 1.52 0 2.75-1.23 2.75-2.75Z"
          fill="currentColor"
          opacity="0.8"
        />
      </svg>
    </span>
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
            Соберу факты из Plane, подготовлю отчёт или превращу заметки встречи в понятный план действий.
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
            className="group hover:border-custom-primary-100/35 focus:border-custom-primary-100 focus:ring-custom-primary-100/15 shadow-xs hover:shadow-sm flex min-h-20 items-start gap-3 rounded-xl border border-subtle bg-surface-1 p-3 text-left transition hover:-translate-y-0.5 focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transform-none"
          >
            <span className="bg-custom-primary-100/10 text-custom-primary-100 group-hover:bg-custom-primary-100 grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors group-hover:text-white">
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
        title: "Summary скопирован",
        message: "Отчёт можно отправить руководителю.",
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
            className="text-xs hover:border-custom-primary-100/40 hover:text-custom-primary-100 flex shrink-0 items-center gap-1.5 rounded border border-subtle px-2 py-1.5 font-medium text-secondary transition"
          >
            {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {isCopied ? "Готово" : "Копировать отчёт"}
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
            <summary className="focus-visible:ring-custom-primary-100/30 cursor-pointer list-none px-3 py-2.5 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset">
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
                        <div className="bg-custom-primary-100 mt-1.5 h-2 w-2 shrink-0 rounded-full" />
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
}: {
  widget: TIgorCaptureWidgetData;
  isSubmitting: boolean;
  onCreate: (
    widget: TIgorCaptureWidgetData,
    taskIds: string[],
    projectAssignments: Record<string, string>,
    taskOverrides: Record<
      string,
      {
        title: string;
        target_date: string | null;
        priority: TIgorCaptureWidgetData["tasks"][number]["priority"];
      }
    >
  ) => Promise<boolean>;
}) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(widget.tasks.filter((task) => !task.duplicate_issue).map((task) => task.id))
  );
  const [projectAssignments, setProjectAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      widget.tasks.filter((task) => task.project_id).map((task) => [task.id, task.project_id as string])
    )
  );
  const [taskOverrides, setTaskOverrides] = useState<
    Record<
      string,
      {
        title: string;
        target_date: string | null;
        priority: TIgorCaptureWidgetData["tasks"][number]["priority"];
      }
    >
  >(() =>
    Object.fromEntries(
      widget.tasks.map((task) => [
        task.id,
        { title: task.title, target_date: task.target_date, priority: task.priority },
      ])
    )
  );
  const [isCreated, setIsCreated] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(
    () => widget.tasks.find((task) => !task.duplicate_issue)?.id ?? null
  );

  useEffect(() => {
    setSelectedTaskIds(new Set(widget.tasks.filter((task) => !task.duplicate_issue).map((task) => task.id)));
    setProjectAssignments(
      Object.fromEntries(
        widget.tasks.filter((task) => task.project_id).map((task) => [task.id, task.project_id as string])
      )
    );
    setTaskOverrides(
      Object.fromEntries(
        widget.tasks.map((task) => [
          task.id,
          { title: task.title, target_date: task.target_date, priority: task.priority },
        ])
      )
    );
    setIsCreated(false);
    setExpandedTaskId(widget.tasks.find((task) => !task.duplicate_issue)?.id ?? null);
  }, [widget]);

  const selectedTasks = widget.tasks.filter((task) => selectedTaskIds.has(task.id));
  const tasksWithoutProject = selectedTasks.filter((task) => !projectAssignments[task.id]);
  const canCreate =
    Boolean(widget.token) &&
    !isCreated &&
    selectedTasks.length > 0 &&
    tasksWithoutProject.length === 0 &&
    selectedTasks.every((task) => taskOverrides[task.id]?.title.trim());

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAllTasks = () => {
    setSelectedTaskIds((current) =>
      current.size === widget.tasks.length ? new Set() : new Set(widget.tasks.map((task) => task.id))
    );
  };

  return (
    <div className="shadow-xs mt-3 overflow-hidden rounded-xl border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-primary">{widget.title}</div>
            <div className="text-xs mt-0.5 text-secondary">
              Разобрано {widget.covered_count} из {widget.source_count} исходных пунктов
            </div>
          </div>
          <div
            className={cn(
              "text-xs shrink-0 rounded-full px-2 py-1 font-medium",
              widget.covered_count === widget.source_count
                ? "bg-green-500/10 text-green-600"
                : "bg-amber-500/10 text-amber-600"
            )}
          >
            {widget.covered_count === widget.source_count ? "Ничего не потеряно" : "Нужна проверка"}
          </div>
        </div>
      </div>

      <div className="divide-y divide-subtle">
        {widget.categories.map((category) => (
          <details
            key={category.key}
            open={["action", "risk", "question", "unclassified"].includes(category.key)}
            className="group"
          >
            <summary className="focus-visible:ring-custom-primary-100/30 cursor-pointer list-none px-3 py-2.5 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">{category.title}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs rounded-full bg-surface-2 px-2 py-0.5 text-secondary">{category.count}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-tertiary transition-transform group-open:rotate-180" />
                </span>
              </div>
            </summary>
            <div className="space-y-2 border-t border-subtle bg-surface-2/40 px-3 py-2.5">
              {category.items.map((item) => (
                <div key={item.source_id} className="rounded border border-subtle bg-surface-1 px-2.5 py-2">
                  <div className="text-xs flex items-start gap-2">
                    <span className="text-custom-primary-100 shrink-0 font-medium">{item.source_id}</span>
                    <span className="font-medium text-primary">{item.summary}</span>
                  </div>
                  {item.summary.trim() !== item.source_text.trim() && (
                    <div className="text-xs mt-1 border-l border-subtle pl-2 leading-4 text-tertiary">
                      Исходник: {item.source_text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      <div className="border-t border-subtle px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs flex items-center gap-1.5 font-semibold text-primary">
              <ListChecks className="h-3.5 w-3.5" />
              Предложенные задачи
            </div>
            <div className="text-xs mt-0.5 text-tertiary">Проверь поля и выбери, что действительно создать.</div>
          </div>
          {widget.tasks.length > 0 && (
            <button
              type="button"
              onClick={toggleAllTasks}
              disabled={isSubmitting}
              className="text-xs shrink-0 text-secondary hover:text-primary disabled:opacity-50"
            >
              {selectedTaskIds.size === widget.tasks.length ? "Снять все" : "Выбрать все"}
            </button>
          )}
        </div>

        {widget.tasks.length === 0 ? (
          <div className="text-xs mt-3 rounded border border-subtle bg-surface-2 px-3 py-2.5 text-secondary">
            Явных поручений нет. Решения, вопросы и контекст сохранены выше, но превращать их в задачи без основания
            Игорь не стал.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {widget.tasks.map((task) => {
              const isSelected = selectedTaskIds.has(task.id);
              const missingDeadline = task.missing_fields.includes("target_date");
              const missingPriority = task.missing_fields.includes("priority");
              const override = taskOverrides[task.id] ?? {
                title: task.title,
                target_date: task.target_date,
                priority: task.priority,
              };
              return (
                <div
                  key={task.id}
                  className={cn(
                    "rounded border px-2.5 py-2.5 transition",
                    isSelected
                      ? "border-custom-primary-100/30 bg-custom-primary-100/5"
                      : "border-subtle bg-surface-2/50"
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTask(task.id)}
                      disabled={isSubmitting}
                      className="accent-custom-primary-100 mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-xs block font-medium text-primary">{override.title}</span>
                      {task.description && (
                        <span className="text-xs mt-1 line-clamp-3 block leading-4 text-secondary">
                          {task.description}
                        </span>
                      )}
                      <span className="text-xs mt-1 block text-tertiary">
                        Источник: {task.source_ids.join(", ")} · Исполнитель: {task.assignee_name}
                      </span>
                    </span>
                  </label>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
                    <span className="text-xs rounded bg-surface-2 px-1.5 py-0.5 text-tertiary">
                      {override.target_date ? `Срок: ${formatShortDate(override.target_date)}` : "Срок не найден"}
                    </span>
                    <span className="text-xs rounded bg-surface-2 px-1.5 py-0.5 text-tertiary">
                      {override.priority === "none"
                        ? "Приоритет не найден"
                        : `Приоритет: ${priorityLabel(override.priority)}`}
                    </span>
                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => setExpandedTaskId((current) => (current === task.id ? null : task.id))}
                        disabled={isSubmitting}
                        className="text-xs text-custom-primary-100 ml-auto hover:underline disabled:opacity-50"
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
                          className="focus:border-custom-primary-100 h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none"
                        />
                      </label>
                      <label className="text-xs grid gap-1 text-secondary">
                        Проект <span className="text-red-500">обязательно</span>
                        <select
                          value={projectAssignments[task.id] ?? ""}
                          onChange={(event) =>
                            setProjectAssignments((current) => ({ ...current, [task.id]: event.target.value }))
                          }
                          disabled={isSubmitting}
                          className="focus:border-custom-primary-100 h-8 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none"
                        >
                          <option value="">Выбрать проект</option>
                          {widget.projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.identifier} · {project.name}
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
                            className="focus:border-custom-primary-100 h-8 min-w-0 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none"
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
                            className="focus:border-custom-primary-100 h-8 min-w-0 rounded border border-subtle bg-surface-1 px-2 text-primary outline-none"
                          >
                            <option value="none">Не указан</option>
                            <option value="urgent">Срочный</option>
                            <option value="high">Высокий</option>
                            <option value="medium">Средний</option>
                            <option value="low">Низкий</option>
                          </select>
                        </label>
                      </div>
                      {(missingDeadline || missingPriority) && (
                        <div className="text-xs text-amber-600 flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {missingDeadline && missingPriority
                              ? "В исходнике нет срока и приоритета — Игорь не стал их придумывать."
                              : missingDeadline
                                ? "В исходнике нет срока — Игорь не стал его придумывать."
                                : "В исходнике нет приоритета — Игорь не стал его придумывать."}
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
          <div className="mt-3">
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
                  taskOverrides
                );
                if (created) setIsCreated(true);
              }}
              disabled={!canCreate || isSubmitting}
              className="bg-custom-primary-100 hover:bg-custom-primary-200 text-xs flex w-full items-center justify-center gap-2 rounded px-3 py-2 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isCreated ? "Задачи уже созданы" : `Создать выбранные задачи · ${selectedTasks.length}`}
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
                  <div className="bg-custom-primary-100 mt-1 h-2 w-2 shrink-0 rounded-full" />
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
              className="text-xs text-custom-primary-100 flex w-full items-center justify-center gap-2 border-t border-subtle px-3 py-2 font-medium transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
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
