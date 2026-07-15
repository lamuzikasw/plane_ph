const COMPLETION_REQUIREMENTS_ERROR_CODE = "completion_requirements_missing";

const COMPLETION_FIELD_LABELS: Record<string, string> = {
  assignee: "исполнитель",
  target_date: "дедлайн",
  priority: "приоритет",
};

type TApiError = {
  code?: string | string[];
  detail?: string | string[];
  missing_fields?: string[];
};

const firstString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
};

export const getIssueUpdateError = (error: unknown): { title: string; message: string } => {
  const apiError = (error ?? {}) as TApiError;
  if (firstString(apiError.code) === COMPLETION_REQUIREMENTS_ERROR_CODE) {
    const labels = (apiError.missing_fields ?? [])
      .map((field) => COMPLETION_FIELD_LABELS[field])
      .filter((label): label is string => Boolean(label));

    return {
      title: "Задача не завершена",
      message:
        labels.length > 0
          ? `Заполните обязательные поля: ${labels.join(", ")}.`
          : "Заполните исполнителя, дедлайн и приоритет.",
    };
  }

  return {
    title: "Не удалось обновить задачу",
    message: firstString(apiError.detail) ?? "Повторите попытку или обновите страницу.",
  };
};
