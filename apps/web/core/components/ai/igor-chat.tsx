/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { Link } from "react-router";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { cn, generateWorkItemLink } from "@plane/utils";
// services
import {
  AIService,
  type TIgorChatContext,
  type TIgorChatHistoryItem,
  type TIgorChatResponse,
  type TIgorChatWorkItem,
  type TIgorWeeklySummaryWidget as TIgorWeeklySummaryWidgetData,
} from "@/services/ai.service";

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
const MAX_MESSAGE_LENGTH = 1200;
const WELCOME_MESSAGE =
  "Привет, я Игорь. Соберу готовые итоги недели по фактам из Plane: результат, работу в процессе, переносы, риски и следующий план. Личный отчёт включает только назначенные тебе задачи.";

const INITIAL_SUGGESTIONS = [
  "Собери мой summary за прошлую неделю",
  "Подготовь короткий отчёт руководителю за прошлую неделю",
  "Собери подробные итоги за текущую неделю",
  "Покажи мои просроченные задачи",
];

const initialMessages = (): TIgorMessage[] => [
  {
    id: "welcome",
    role: "assistant",
    text: WELCOME_MESSAGE,
  },
];

const stateLabels: Record<string, string> = {
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  cancelled: "Cancelled",
};

const buildHistoryPayload = (messages: TIgorMessage[]): TIgorChatHistoryItem[] =>
  messages
    .filter((message) => message.id !== "welcome")
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: message.text,
      context: message.response?.context ?? null,
    }));

export function IgorChat({ workspaceSlug }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<TIgorMessage[]>(initialMessages);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeWorkspaceRef = useRef(workspaceSlug);

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

  useEffect(() => {
    if (!isOpen) return;
    scrollRef.current?.scrollIntoView({ block: "end" });
    inputRef.current?.focus();
  }, [isOpen, messages.length, isSubmitting]);

  const askIgor = async (messageText: string) => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || isSubmitting) return;
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Вопрос слишком длинный",
        message: `Сократи вопрос до ${MAX_MESSAGE_LENGTH} символов.`,
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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    askIgor(input);
  };

  return (
    <>
      {!isOpen && (
        <Tooltip tooltipContent="Открыть Игоря" position="left">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="text-sm shadow-sm hover:border-custom-primary-100/40 focus:ring-custom-primary-100/30 fixed right-5 bottom-5 z-40 flex h-11 items-center gap-2 rounded-full border border-subtle bg-surface-1 px-4 font-medium text-primary transition hover:bg-surface-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            <Sparkles className="text-custom-primary-100 h-4 w-4" />
            Игорь
          </button>
        </Tooltip>
      )}

      {isOpen && (
        <section className="shadow-lg fixed right-5 bottom-5 z-40 flex h-[min(720px,calc(100vh-40px))] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1">
          <header className="flex items-center justify-between border-b border-subtle px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="border-custom-primary-100/20 bg-custom-primary-100/10 text-custom-primary-100 flex h-8 w-8 items-center justify-center rounded-full border">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-primary">Игорь</h2>
                <p className="text-xs text-secondary">Ассистент по задачам и срокам</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="focus:ring-custom-primary-100 grid h-7 w-7 place-items-center rounded hover:bg-surface-2 focus:ring-2 focus:outline-none"
              aria-label="Закрыть Игоря"
            >
              <X className="h-4 w-4 text-secondary" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              {messages.map((message) => (
                <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "text-sm max-w-[92%] rounded-lg border px-3 py-2 leading-5",
                      message.role === "user"
                        ? "border-custom-primary-100/20 bg-custom-primary-100/10 text-primary"
                        : "border-subtle bg-surface-2 text-primary"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.text}</p>
                    {message.response?.widgets?.map((widget) =>
                      widget.type === "weekly_summary" ? (
                        <IgorWeeklySummaryWidget
                          key={`${message.id}-${widget.type}-${widget.title}`}
                          widget={widget}
                          workspaceSlug={workspaceSlug}
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
                <div className="flex justify-start">
                  <div className="text-sm flex items-center gap-2 rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Игорь собирает факты из задач...
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </div>

          <div className="border-t border-subtle bg-surface-1 px-4 py-3">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => askIgor(suggestion)}
                  disabled={isSubmitting}
                  className="text-xs hover:border-custom-primary-200 shrink-0 rounded-full border border-subtle px-3 py-1 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-lg border border-subtle bg-surface-2 p-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Например: собери мой summary за прошлую неделю"
                maxLength={MAX_MESSAGE_LENGTH}
                rows={2}
                className="text-sm max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-primary outline-none placeholder:text-tertiary"
              />
              <button
                type="button"
                onClick={() => askIgor(input)}
                disabled={isSubmitting || !input.trim()}
                className="bg-custom-primary-100 hover:bg-custom-primary-200 grid h-9 w-9 place-items-center rounded text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Отправить сообщение Игорю"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
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
    <div className="mt-3 overflow-hidden rounded-md border border-subtle bg-surface-1">
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
            <summary className="cursor-pointer list-none px-3 py-2.5 hover:bg-surface-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">{section.title}</span>
                <span className="text-xs rounded-full bg-surface-2 px-2 py-0.5 text-secondary">{section.total}</span>
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
    <div className="mt-3 overflow-hidden rounded-md border border-subtle bg-surface-1">
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
