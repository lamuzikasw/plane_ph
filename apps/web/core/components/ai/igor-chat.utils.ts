import type { TIgorChatContext } from "@/services/ai.service";

export const IGOR_COMPOSER_MIN_HEIGHT = 72;
export const IGOR_COMPOSER_DEFAULT_HEIGHT = 112;
export const IGOR_COMPOSER_MAX_HEIGHT = 360;

export const clampIgorComposerHeight = (height: number, panelHeight: number): number => {
  const availableMaximum = Math.max(IGOR_COMPOSER_MIN_HEIGHT, Math.min(IGOR_COMPOSER_MAX_HEIGHT, panelHeight - 260));
  return Math.min(Math.max(height, IGOR_COMPOSER_MIN_HEIGHT), availableMaximum);
};

export const resolveIgorSuggestions = (
  responseSuggestions: string[] | undefined,
  initialSuggestions: string[]
): string[] => responseSuggestions ?? initialSuggestions;

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
