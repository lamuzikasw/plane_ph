import type { TIgorChatContext } from "@/services/ai.service";

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
