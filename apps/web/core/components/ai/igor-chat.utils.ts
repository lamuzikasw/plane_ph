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

export const getIgorCapturePollDelay = (status?: TIgorCaptureProcessingWidget["status"], failed = false): number => {
  if (failed) return 5000;
  return status === "failed" ? 10000 : 2500;
};

export const upsertIgorCaptureJobMessage = (
  messages: TIgorMessage[],
  jobId: string,
  response: TIgorChatResponse
): TIgorMessage[] => {
  const messageIndex = messages.findIndex((message) => message.response?.capture_job_id === jobId);
  const currentMessage = messageIndex >= 0 ? messages[messageIndex] : undefined;
  const updatedMessage: TIgorMessage = {
    ...currentMessage,
    id: currentMessage?.id ?? `assistant-job-${jobId}`,
    role: "assistant",
    text: response.answer,
    response,
  };
  if (messageIndex < 0) return [...messages, updatedMessage];
  const nextMessages = [...messages];
  nextMessages[messageIndex] = updatedMessage;
  return nextMessages;
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
