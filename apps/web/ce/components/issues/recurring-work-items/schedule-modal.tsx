import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Clock3, Repeat2, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TRecurringFrequency, TRecurringWorkItem, TRecurringWorkItemPayload } from "@plane/types";
import { Button, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { recurringWorkItemService } from "@/services/recurring-work-item.service";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const localDateValue = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const inputClassName =
  "h-9 w-full rounded-sm border border-subtle bg-surface-1 px-3 text-body-sm-regular text-primary outline-none transition-colors focus:border-accent-strong";

const getPreviewDates = (payload: TRecurringWorkItemPayload) => {
  const results: Date[] = [];
  const start = new Date(`${payload.start_date}T${payload.run_time || "09:00"}:00`);
  const cursor = new Date(Math.max(start.getTime(), Date.now()));
  cursor.setSeconds(0, 0);
  const startDay = new Date(`${payload.start_date}T00:00:00`);
  const startWeek = new Date(startDay);
  startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));

  for (let count = 0; count < 370 && results.length < 3; count++) {
    const candidate = new Date(cursor);
    candidate.setDate(candidate.getDate() + count);
    const [hours, minutes] = payload.run_time.split(":").map(Number);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= Date.now() || candidate < start) continue;
    if (payload.end_date && localDateValue(candidate) > payload.end_date) break;
    const daysSinceStart = Math.floor((candidate.getTime() - startDay.getTime()) / 86_400_000);
    const mondayIndex = (candidate.getDay() + 6) % 7;
    const weeksSinceStart = Math.floor((candidate.getTime() - startWeek.getTime()) / (7 * 86_400_000));
    const matches =
      payload.frequency === "daily"
        ? daysSinceStart >= 0 && daysSinceStart % payload.interval === 0
        : weeksSinceStart >= 0 && weeksSinceStart % payload.interval === 0 && payload.weekdays.includes(mondayIndex);
    if (matches) results.push(candidate);
  }
  return results;
};

type Props = {
  isOpen: boolean;
  workspaceSlug: string;
  projectId: string;
  sourceIssueId: string;
  sourceIssueName?: string;
  schedule?: TRecurringWorkItem;
  onClose: () => void;
  onSaved: (schedule: TRecurringWorkItem | null) => void;
};

export function RecurringWorkItemScheduleModal(props: Props) {
  const { isOpen, workspaceSlug, projectId, sourceIssueId, sourceIssueName, schedule, onClose, onSaved } = props;
  const [isSaving, setIsSaving] = useState(false);
  const [frequency, setFrequency] = useState<TRecurringFrequency>("daily");
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [startDate, setStartDate] = useState(localDateValue(new Date()));
  const [endDate, setEndDate] = useState("");
  const [runTime, setRunTime] = useState("09:00");
  const [dueOffsetDays, setDueOffsetDays] = useState(0);
  const [dueTime, setDueTime] = useState("18:00");

  useEffect(() => {
    if (!isOpen) return;
    setFrequency(schedule?.frequency ?? "daily");
    setInterval(schedule?.interval ?? 1);
    setWeekdays(schedule?.weekdays?.length ? schedule.weekdays : [0, 1, 2, 3, 4]);
    setStartDate(schedule?.start_date ?? localDateValue(new Date()));
    setEndDate(schedule?.end_date ?? "");
    setRunTime(schedule?.run_time?.slice(0, 5) ?? "09:00");
    setDueOffsetDays(schedule?.due_offset_days ?? 0);
    setDueTime(schedule?.due_time?.slice(0, 5) ?? "18:00");
  }, [isOpen, schedule]);

  const payload = useMemo<TRecurringWorkItemPayload>(
    () => ({
      source_issue_id: sourceIssueId,
      frequency,
      interval,
      weekdays: frequency === "weekly" ? weekdays : [],
      start_date: startDate,
      end_date: endDate || null,
      run_time: runTime,
      due_offset_days: dueOffsetDays,
      due_time: dueTime,
      is_active: true,
    }),
    [dueOffsetDays, dueTime, endDate, frequency, interval, runTime, sourceIssueId, startDate, weekdays]
  );
  const previewDates = useMemo(() => getPreviewDates(payload), [payload]);
  const hasValidDueTime = dueOffsetDays > 0 || dueTime >= runTime;
  const isValid = Boolean(
    startDate && runTime && dueTime && interval > 0 && hasValidDueTime && (frequency === "daily" || weekdays.length)
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = schedule
        ? await recurringWorkItemService.update(workspaceSlug, projectId, schedule.id, payload)
        : await recurringWorkItemService.create(workspaceSlug, projectId, payload);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Повторение сохранено",
        message: "Следующая задача появится точно по расписанию.",
      });
      onSaved(result);
      onClose();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось сохранить расписание",
        message: "Проверьте даты и попробуйте ещё раз.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!schedule) return;
    setIsSaving(true);
    try {
      await recurringWorkItemService.remove(workspaceSlug, projectId, schedule.id);
      onSaved(null);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div
        role="presentation"
        data-prevent-outside-click
        className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg bg-surface-1"
        // The modal can be mounted from inside an issue peek. Keep its pointer events
        // from reaching the peek's outside-click handler and closing both surfaces.
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-subtle px-6 py-5">
          <div className="flex min-w-0 gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-primary/10 text-accent-primary">
              <Repeat2 className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-h4-medium text-primary">{schedule ? "Настроить повторение" : "Повторять задачу"}</h2>
              <p className="mt-1 truncate text-body-xs-regular text-tertiary">
                {sourceIssueName || "Новая копия будет создаваться автоматически"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-sm text-tertiary hover:bg-surface-2 hover:text-primary"
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <section>
            <div className="mb-3 flex items-center gap-2 text-body-sm-medium text-primary">
              <CalendarClock className="size-4 text-tertiary" />
              Расписание
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-md bg-surface-2 p-1">
              {(
                [
                  ["daily", "Каждый день"],
                  ["weekly", "По дням недели"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setFrequency(value);
                  }}
                  className={`h-9 rounded-sm text-body-xs-medium transition-colors ${frequency === value ? "shadow-sm bg-surface-1 text-primary" : "text-secondary hover:text-primary"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {frequency === "weekly" && (
              <div className="mt-4 flex flex-wrap gap-2">
                {WEEKDAYS.map((day, index) => {
                  const selected = weekdays.includes(index);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setWeekdays(selected ? weekdays.filter((value) => value !== index) : [...weekdays, index]);
                      }}
                      className={`grid size-9 place-items-center rounded-full border text-body-xs-medium transition-colors ${selected ? "border-accent-strong bg-accent-primary text-on-color" : "border-subtle text-secondary hover:border-strong hover:text-primary"}`}
                      aria-pressed={selected}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-body-xs-medium text-secondary">
                Каждые
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClassName} !w-20`}
                    type="number"
                    min={1}
                    max={365}
                    value={interval}
                    onChange={(event) => setInterval(Math.max(1, Number(event.target.value)))}
                  />
                  <span className="text-body-xs-regular text-tertiary">{frequency === "daily" ? "дн." : "нед."}</span>
                </div>
              </label>
              <label className="flex flex-col gap-1.5 text-body-xs-medium text-secondary">
                Начать
                <input
                  className={inputClassName}
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-body-xs-medium text-secondary">
                Создавать в
                <input
                  className={inputClassName}
                  type="time"
                  value={runTime}
                  onChange={(event) => setRunTime(event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="mt-6 border-t border-subtle pt-5">
            <div className="mb-3 flex items-center gap-2 text-body-sm-medium text-primary">
              <Clock3 className="size-4 text-tertiary" />
              Срок новой задачи
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-body-xs-medium text-secondary">
                Через дней
                <input
                  className={inputClassName}
                  type="number"
                  min={0}
                  max={365}
                  value={dueOffsetDays}
                  onChange={(event) => setDueOffsetDays(Math.max(0, Number(event.target.value)))}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-body-xs-medium text-secondary">
                Дедлайн в
                <input
                  className={inputClassName}
                  type="time"
                  value={dueTime}
                  onChange={(event) => setDueTime(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-body-xs-medium text-secondary">
                Завершить повторы
                <input
                  className={inputClassName}
                  type="date"
                  min={startDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
            <p className="mt-2 text-caption-md-regular text-tertiary">
              0 дней — дедлайн в тот же день. Пустая дата завершения — повторять без ограничения.
            </p>
            {!hasValidDueTime && (
              <p className="mt-2 text-caption-md-medium text-danger-primary">
                В тот же день дедлайн должен быть позже времени создания.
              </p>
            )}
          </section>

          <section className="mt-6 rounded-md border border-subtle bg-surface-2 p-4">
            <div className="flex items-center gap-2 text-body-xs-medium text-primary">
              <Check className="size-4 text-success-primary" />
              Ближайшие запуски
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {previewDates.length ? (
                previewDates.map((date) => (
                  <div key={date.toISOString()} className="rounded-sm border border-subtle bg-surface-1 px-3 py-2">
                    <div className="text-body-xs-medium text-primary">
                      {date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                    </div>
                    <div className="mt-0.5 text-caption-md-regular text-tertiary">
                      в {runTime} · срок {dueOffsetDays === 0 ? "сегодня" : `+${dueOffsetDays} дн.`} в {dueTime}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-body-xs-regular text-danger-primary">По этим условиям будущих запусков нет.</p>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-subtle px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:w-auto">
            {schedule && (
              <Button variant="link-danger" size="md" onClick={() => void handleRemove()} disabled={isSaving}>
                Убрать повторение
              </Button>
            )}
          </div>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button className="w-full sm:w-auto" variant="neutral-primary" size="md" onClick={onClose}>
              Отмена
            </Button>
            <Button
              className="w-full sm:w-auto"
              variant="primary"
              size="md"
              onClick={() => void handleSave()}
              loading={isSaving}
              disabled={!isValid || previewDates.length === 0}
            >
              Сохранить расписание
            </Button>
          </div>
        </div>
      </div>
    </ModalCore>
  );
}
