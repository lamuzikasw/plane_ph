import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Clock3, MoreHorizontal, Repeat2 } from "lucide-react";
import useSWR from "swr";
import type { TRecurringWorkItem } from "@plane/types";
import { Button, CustomMenu, Loader, ToggleSwitch } from "@plane/ui";
import { RecurringWorkItemScheduleModal } from "@/plane-web/components/issues/recurring-work-items/schedule-modal";
import { recurringWorkItemService } from "@/services/recurring-work-item.service";

type Props = { workspaceSlug: string; projectId: string };

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const scheduleLabel = (schedule: TRecurringWorkItem) => {
  if (schedule.frequency === "daily")
    return schedule.interval === 1 ? "Каждый день" : `Каждые ${schedule.interval} дн.`;
  const days = schedule.weekdays.map((day) => WEEKDAYS[day]).join(", ");
  return schedule.interval === 1 ? `Еженедельно: ${days}` : `Каждые ${schedule.interval} нед.: ${days}`;
};

const formatNextRun = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "Больше запусков нет";

export function RecurringWorkItemsSettingsRoot({ workspaceSlug, projectId }: Props) {
  const { data, isLoading, mutate } = useSWR(`RECURRING_WORK_ITEMS_${projectId}`, () =>
    recurringWorkItemService.list(workspaceSlug, projectId)
  );
  const [editing, setEditing] = useState<TRecurringWorkItem | null>(null);

  const handleToggle = async (schedule: TRecurringWorkItem) => {
    await recurringWorkItemService.update(workspaceSlug, projectId, schedule.id, { is_active: !schedule.is_active });
    await mutate();
  };

  const handleDelete = async (schedule: TRecurringWorkItem) => {
    await recurringWorkItemService.remove(workspaceSlug, projectId, schedule.id);
    await mutate();
  };

  if (isLoading)
    return (
      <Loader className="mt-8 space-y-3">
        <Loader.Item height="84px" />
        <Loader.Item height="84px" />
      </Loader>
    );

  if (!data?.length)
    return (
      <div className="mt-8 flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-subtle bg-surface-2 px-6 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-accent-primary/10 text-accent-primary">
          <Repeat2 className="size-5" />
        </div>
        <h3 className="mt-4 text-h5-medium text-primary">Пока нет повторяющихся задач</h3>
        <p className="mt-2 max-w-md text-body-xs-regular text-tertiary">
          Откройте любую задачу и выберите свойство «Повторять». Здесь появятся все расписания проекта.
        </p>
        <Button className="mt-4" variant="neutral-primary" size="md" onClick={() => window.history.back()}>
          Вернуться к проекту
        </Button>
      </div>
    );

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-lg border border-subtle bg-surface-1">
        <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)_180px_80px] gap-4 border-b border-subtle bg-surface-2 px-4 py-2.5 text-caption-md-medium text-tertiary md:grid">
          <span>Задача-шаблон</span>
          <span>Расписание</span>
          <span>Следующий запуск</span>
          <span className="text-right">Статус</span>
        </div>
        {data.map((schedule) => (
          <div
            key={schedule.id}
            className="grid gap-3 border-b border-subtle px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)_180px_80px] md:items-center md:gap-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-sm bg-layer-2 text-secondary">
                <Repeat2 className="size-4" />
              </div>
              <div className="min-w-0">
                <Link
                  href={`/${workspaceSlug}/projects/${projectId}/issues/${schedule.source_issue_id}`}
                  className="block truncate text-body-sm-medium text-primary hover:text-accent-primary"
                >
                  {schedule.source_issue_name}
                </Link>
                <p className="mt-0.5 text-caption-md-regular text-tertiary">
                  {schedule.project_identifier}-{schedule.source_issue_sequence_id} · создано{" "}
                  {schedule.occurrence_count}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-body-xs-regular text-secondary">
              <CalendarClock className="size-4 shrink-0 text-tertiary" />
              <span>
                {scheduleLabel(schedule)} в {schedule.run_time.slice(0, 5)}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 text-body-xs-medium text-primary">
                <Clock3 className="size-4 text-tertiary" />
                {formatNextRun(schedule.next_run_at)}
              </div>
              {schedule.last_error && (
                <div className="mt-1 flex items-center gap-1 text-caption-md-regular text-danger-primary">
                  <AlertTriangle className="size-3" />
                  Требует внимания
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <ToggleSwitch value={schedule.is_active} onChange={() => void handleToggle(schedule)} size="sm" />
              <CustomMenu
                ellipsis
                placement="bottom-end"
                customButton={
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-sm text-tertiary hover:bg-surface-2"
                    aria-label="Действия"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                }
              >
                <CustomMenu.MenuItem onClick={() => setEditing(schedule)}>Изменить</CustomMenu.MenuItem>
                <CustomMenu.MenuItem onClick={() => void handleDelete(schedule)}>Удалить</CustomMenu.MenuItem>
              </CustomMenu>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <RecurringWorkItemScheduleModal
          isOpen
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          sourceIssueId={editing.source_issue_id}
          sourceIssueName={editing.source_issue_name}
          schedule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void mutate()}
        />
      )}
    </>
  );
}
