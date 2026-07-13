/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
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

const INITIAL_SUGGESTIONS = [
  "Привет, как дела?",
  "Что сделал Danila Kuzovatov за прошлую неделю?",
  "Покажи просроченные задачи",
  "Какие задачи сейчас заблокированы?",
  "Что у меня на сегодня?",
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
  const [messages, setMessages] = useState<TIgorMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Привет, я Игорь. Могу быстро собрать задачи, дедлайны, блокеры и статус по сотрудникам.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Игорь не ответил",
        message: "Не получилось получить ответ. Проверь соединение и попробуй ещё раз.",
      });
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: "Я не смог достучаться до задач. Давай попробуем ещё раз через пару секунд.",
        },
      ]);
    } finally {
      setIsSubmitting(false);
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
                    {message.response?.widgets?.map((widget) => (
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
                    ))}
                  </div>
                </div>
              ))}
              {isSubmitting && (
                <div className="flex justify-start">
                  <div className="text-sm flex items-center gap-2 rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Игорь смотрит задачи...
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
                placeholder="Спроси Игоря про задачи, сроки или сотрудника"
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
