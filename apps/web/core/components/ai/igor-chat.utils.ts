import type {
  TIgorCaptureProcessingWidget,
  TIgorChatContext,
  TIgorChatHistoryItem,
  TIgorChatResponse,
} from "@/services/ai.service";

export type TIgorMessage = {
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

export const IGOR_COMPOSER_MIN_HEIGHT = 72;
export const IGOR_COMPOSER_DEFAULT_HEIGHT = 112;
export const IGOR_COMPOSER_MAX_HEIGHT = 360;
export const IGOR_REGULAR_MESSAGE_LENGTH = 5000;
export const IGOR_CAPTURE_MESSAGE_LENGTH = 80000;

export const getIgorLauncherPositionClassName = (isPeekOpen: boolean): string =>
  isPeekOpen ? "hidden md:right-[calc(50%+1.25rem)] md:flex" : "right-5 flex";

export const clampIgorComposerHeight = (height: number, panelHeight: number): number => {
  const availableMaximum = Math.max(IGOR_COMPOSER_MIN_HEIGHT, Math.min(IGOR_COMPOSER_MAX_HEIGHT, panelHeight - 260));
  return Math.min(Math.max(height, IGOR_COMPOSER_MIN_HEIGHT), availableMaximum);
};

export const resolveIgorSuggestions = (
  responseSuggestions: string[] | undefined,
  initialSuggestions: string[]
): string[] => responseSuggestions ?? initialSuggestions;

export const getIgorMessageLimit = (message: string): number => {
  const isCaptureRequest =
    /разбер|обработ|структур|разлож|декомпоз|преврат|вытащ|выдел|предлож|поручен|договорен|задач.*из|\bтз\b|техническ.*задан|meeting notes|action items|turn this into tasks|categorize these notes|break down this (?:spec|prd)/i.test(
      message
    ) ||
    (message.length > IGOR_REGULAR_MESSAGE_LENGTH && message.split("\n").filter((line) => line.trim()).length >= 8);
  return isCaptureRequest ? IGOR_CAPTURE_MESSAGE_LENGTH : IGOR_REGULAR_MESSAGE_LENGTH;
};

export const getIgorCaptureJobStorageKey = (workspaceSlug: string): string => `plane:igor:capture-job:${workspaceSlug}`;

export const getIgorCaptureProcessingWidget = (response: TIgorChatResponse): TIgorCaptureProcessingWidget | undefined =>
  response.widgets.find((widget): widget is TIgorCaptureProcessingWidget => widget.type === "capture_processing");

export const isIgorCaptureJobComplete = (response: TIgorChatResponse): boolean =>
  response.intent === "capture_review" && response.widgets.some((widget) => widget.type === "capture_review");

export const getIgorCapturePollDelay = (status?: TIgorCaptureProcessingWidget["status"], failed = false): number => {
  if (failed) return 5000;
  return status === "failed" ? 10000 : 2500;
};

export const getIgorRequestErrorMessage = (error: unknown): string => {
  const errorDetails = error as
    | {
        code?: unknown;
        data?: { answer?: unknown };
        response?: { data?: { answer?: unknown }; status?: unknown };
        status?: unknown;
      }
    | undefined;
  const response = errorDetails?.response ?? errorDetails;
  const serverAnswer = response?.data?.answer;
  if (typeof serverAnswer === "string" && serverAnswer.trim()) return serverAnswer;

  const status = typeof response?.status === "number" ? response.status : undefined;
  if (status === 401) return "Сессия Plane истекла. Обнови страницу и повтори запрос.";
  if (status === 403) return "У тебя нет доступа к этому действию Игоря.";
  if (status === 429) return "Игорь получил слишком много запросов. Повтори через минуту.";
  if (status && [502, 503, 504].includes(status))
    return `Сервис Игоря временно недоступен (${status}). Исходный текст не потерян; повтори запрос через минуту.`;
  if (errorDetails?.code === "ERR_NETWORK")
    return "Браузер не смог связаться с API Plane. Проверь соединение и повтори запрос.";

  return "Игорь не получил корректный ответ от API Plane. Исходный текст не потерян; повтори запрос.";
};

export const upsertIgorCaptureJobMessage = (
  messages: TIgorMessage[],
  jobId: string,
  response: TIgorChatResponse
): TIgorMessage[] => {
  let messageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].response?.capture_job_id === jobId) {
      messageIndex = index;
      break;
    }
  }
  const currentMessage = messageIndex >= 0 ? messages[messageIndex] : undefined;
  const updatedMessage: TIgorMessage = {
    ...currentMessage,
    id: currentMessage?.id ?? `assistant-job-${jobId}`,
    role: "assistant",
    text: response.answer,
    response,
  };
  if (messageIndex < 0) return [...messages, updatedMessage];
  return messages.flatMap((message, index) => {
    if (message.response?.capture_job_id !== jobId) return [message];
    return index === messageIndex ? [updatedMessage] : [];
  });
};

export const getIgorContextSegments = (context: TIgorChatContext): string[] => {
  const scopeLabel =
    context.scope === "personal"
      ? "Мои задачи"
      : context.scope === "member"
        ? context.member_name || "Задачи сотрудника"
        : context.scope === "all_projects"
          ? "Все проекты"
          : context.project_names.length > 0
            ? context.project_names.join(", ")
            : context.project_name || "Выбранные проекты";

  return [scopeLabel, context.period_label, context.summary_audience === "manager" ? "Для руководителя" : null].filter(
    (segment): segment is string => Boolean(segment)
  );
};
