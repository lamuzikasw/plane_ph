import { useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { TelegramService } from "@/services/telegram.service";

const service = new TelegramService();

export function TelegramQuietSettings({ workspaceSlug }: { workspaceSlug: string }) {
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR(["telegram-quiet-periods", workspaceSlug], () => service.quietSettings(workspaceSlug), {
    refreshInterval: 30_000,
  });
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const change = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await mutate();
    } catch {
      setError("Не удалось подтвердить изменение. Обновите список перед редактированием задач.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-5 space-y-3 rounded-lg border border-subtle p-4" aria-label="Изменения без Telegram">
      <h3 className="text-body-md-medium">Изменения без Telegram</h3>
      <p className="text-body-sm-regular text-secondary">
        На час отключить сотруднику Telegram-уведомления от ваших изменений в этом рабочем пространстве. Эти уведомления
        не отправятся позже. История задач, уведомления в Plane и сообщения от коллег сохранятся.
      </p>
      {loadError || error ? (
        <div role="alert" className="text-body-sm-regular">
          {error || "Не удалось загрузить настройки."}
          <button type="button" className="ml-2 underline" onClick={() => void mutate()}>
            Обновить список
          </button>
        </div>
      ) : null}
      {!data && !loadError && <p role="status">Загружаем настройки…</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1 text-body-sm-regular">
              Сотрудник
              <select
                aria-label="Сотрудник"
                className="max-w-full rounded-md border border-subtle bg-surface-1 p-2 text-primary"
                value={recipient}
                disabled={busy}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">Выберите сотрудника</option>
                {data.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="primary"
              disabled={
                busy || !recipient || !!loadError || data.periods.some((period) => period.recipient === recipient)
              }
              onClick={() => void change(() => service.startQuietPeriod(workspaceSlug, recipient))}
            >
              Отключить на час
            </Button>
          </div>
          <ul className="space-y-2" aria-live="polite">
            {data.periods.map((period) => (
              <li key={period.id} className="flex flex-wrap items-center justify-between gap-2 text-body-sm-regular">
                <span>
                  {data.members.find((member) => member.id === period.recipient)?.name || "Сотрудник"}
                  {" — без Telegram до "}
                  {new Date(period.expires_at).toLocaleString("ru-RU")}
                </span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void change(() => service.stopQuietPeriod(workspaceSlug, period.id))}
                >
                  Завершить
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
