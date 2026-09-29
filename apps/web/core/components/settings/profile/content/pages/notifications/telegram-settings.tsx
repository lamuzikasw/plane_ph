import { useState } from "react";
import useSWR from "swr";
import { Send, Clock3, BellOff, Check } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { ToggleSwitch } from "@plane/ui";
import { SettingsControlItem } from "@/components/settings/control-item";
import { TelegramService } from "@/services/telegram.service";
import type { TelegramPreferences } from "@/services/telegram.service";

const service = new TelegramService();
const eventKeys = ["assignments", "mentions", "replies", "comments", "watching"] as const;

export function TelegramNotificationSettings() {
  const { t } = useTranslation();
  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const { data, error, mutate } = useSWR("CURRENT_USER_TELEGRAM_SETTINGS", () => service.settings(), {
    refreshInterval: link ? 3000 : 30000,
  });
  const [schedule, setSchedule] = useState<Pick<TelegramPreferences, "timezone" | "start_hour" | "end_hour">>();
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure(false);
    try {
      await action();
      await mutate();
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
    }
  }
  const paused = !!data?.paused_until && new Date(data.paused_until).getTime() > Date.now();
  const inputClass =
    "rounded border border-subtle bg-surface-1 px-3 py-2 text-body-sm-regular text-primary focus:outline-2 focus:outline-accent-strong disabled:opacity-50";
  const toggle = (key: "enabled" | "scheduled" | "weekdays_only" | (typeof eventKeys)[number], label: string) => (
    <ToggleSwitch
      label={label}
      value={data?.[key] ?? false}
      disabled={busy}
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
      onChange={(value) => void run(() => service.update({ [key]: value }))}
    />
  );
  return (
    <section aria-label="Telegram" className="mb-8 overflow-hidden rounded-lg border border-subtle">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-layer-1 px-5 py-4">
        <div className="flex items-center gap-3">
          <Send className="size-5 text-accent-primary" aria-hidden />
          <div>
            <h3 className="text-body-lg-medium text-primary">Telegram</h3>
            <p className="mt-1 text-caption-md-regular text-secondary">{t("telegram.subtitle")}</p>
          </div>
        </div>
        {data?.connected && (
          <span className="flex items-center gap-1 text-body-sm-medium text-secondary">
            {paused || !data.enabled || data.blocked ? <BellOff className="size-4" /> : <Check className="size-4" />}
            {data.telegram_name}
          </span>
        )}
      </div>
      <div className="space-y-4 p-5">
        {(failure || error) && (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("telegram.error")}
          </p>
        )}
        {!data && !error && <p role="status">{t("telegram.loading")}</p>}
        {data && !data.available && <p className="text-body-sm-regular text-secondary">{t("telegram.unavailable")}</p>}
        {data?.available && (
          <>
            {!data.connected && (
              <div className="space-y-3">
                <p className="text-body-sm-regular text-secondary">{t("telegram.connect_description")}</p>
                <Button disabled={busy} onClick={() => void run(async () => setLink((await service.link()).url))}>
                  {t(link ? "telegram.new_link" : "telegram.connect")}
                </Button>
              </div>
            )}
            {link && !data.pending_name && (
              <div className="space-y-2 rounded border border-accent-subtle bg-accent-subtle p-3">
                <a
                  className="text-body-sm-medium text-accent-primary underline"
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("telegram.open_bot")}
                </a>
                <p className="text-caption-md-regular text-secondary">{t("telegram.start_hint")}</p>
              </div>
            )}
            {data.pending_name && (
              <div className="space-y-3 rounded border border-accent-subtle bg-accent-subtle p-3">
                <p className="text-body-sm-medium text-primary">
                  {t("telegram.confirm_description")} <strong>{data.pending_name}</strong>
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await service.action("confirm", { pending_id: data.pending_id! });
                      setLink(undefined);
                    })
                  }
                >
                  {t("telegram.confirm")}
                </Button>
              </div>
            )}
            {data.connected && (
              <>
                {data.blocked && (
                  <p role="alert" className="text-body-sm-regular text-danger-primary">
                    {t("telegram.blocked")}
                  </p>
                )}
                <SettingsControlItem
                  title={t("telegram.enabled")}
                  description={t("telegram.enabled_description")}
                  control={toggle("enabled", t("telegram.enabled"))}
                />
                <div className="flex flex-wrap items-center gap-2 border-b border-subtle pb-4">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void run(() => service.action(paused ? "resume" : "pause"))}
                  >
                    {t(paused ? "telegram.resume" : "telegram.pause")}
                  </Button>
                  {!paused && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          service.action("pause", { duration: "tomorrow", until: data.next_day_pause_until })
                        )
                      }
                    >
                      {t("telegram.pause_until", {
                        date: new Date(data.next_day_pause_until).toLocaleString(undefined, {
                          timeZone: data.timezone,
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await service.disconnect();
                        setLink(undefined);
                      })
                    }
                  >
                    {t("telegram.disconnect")}
                  </Button>
                  {data.blocked && (
                    <Button disabled={busy} onClick={() => void run(async () => setLink((await service.link()).url))}>
                      {t("telegram.connect")}
                    </Button>
                  )}
                  {paused && (
                    <p className="w-full text-caption-md-regular text-secondary">
                      {t("telegram.paused_until")}{" "}
                      {new Date(data.paused_until!).toLocaleString(undefined, { timeZone: data.timezone })}
                    </p>
                  )}
                </div>
                <div>
                  {eventKeys.map((key) => (
                    <SettingsControlItem
                      key={key}
                      title={t(`telegram.${key}`)}
                      description={t(`telegram.${key}_description`)}
                      control={toggle(key, t(`telegram.${key}`))}
                    />
                  ))}
                </div>
                <div className="border-t border-subtle pt-3">
                  <SettingsControlItem
                    title={
                      <span className="flex items-center gap-2">
                        <Clock3 className="size-4" />
                        {t("telegram.scheduled")}
                      </span>
                    }
                    description={t("telegram.scheduled_description")}
                    control={toggle("scheduled", t("telegram.scheduled"))}
                  />
                  {data.scheduled && (
                    <>
                      <SettingsControlItem
                        title={t("telegram.weekdays_only")}
                        description={t("telegram.weekdays_description")}
                        control={toggle("weekdays_only", t("telegram.weekdays_only"))}
                      />
                      <form
                        className="flex flex-wrap items-end gap-3 py-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (schedule)
                            void run(async () => {
                              await service.update(schedule);
                              setSchedule(undefined);
                            });
                        }}
                      >
                        <label className="flex flex-col gap-1 text-caption-md-regular text-secondary">
                          {t("telegram.timezone")}
                          <input
                            required
                            className={inputClass}
                            value={schedule?.timezone ?? data.timezone}
                            onChange={(e) => setSchedule({ ...(schedule ?? data), timezone: e.target.value })}
                          />
                        </label>
                        {(["start_hour", "end_hour"] as const).map((key) => (
                          <label key={key} className="flex flex-col gap-1 text-caption-md-regular text-secondary">
                            {t(`telegram.${key}`)}
                            <select
                              className={inputClass}
                              value={schedule?.[key] ?? data[key]}
                              onChange={(e) => setSchedule({ ...(schedule ?? data), [key]: Number(e.target.value) })}
                            >
                              {Array.from({ length: 24 }, (_, hour) => (
                                <option key={hour} value={hour}>
                                  {String(hour).padStart(2, "0")}:00
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                        <Button type="submit" disabled={busy || !schedule}>
                          {t("telegram.save")}
                        </Button>
                      </form>
                    </>
                  )}
                </div>
                <div className="rounded bg-layer-1 p-3 text-caption-md-regular text-secondary">
                  {t("telegram.limit_hint")}
                </div>
                {data.mutes.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-body-sm-medium text-primary">{t("telegram.muted")}</h4>
                    {data.mutes.map((mute) => (
                      <div key={mute.issue_id} className="flex items-center justify-between gap-3 text-body-sm-regular">
                        <span className="min-w-0 truncate">{mute.name}</span>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void run(() => service.action("unmute", { issue_id: mute.issue_id }))}
                        >
                          {t("telegram.unmute")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <details className="text-caption-md-regular text-secondary">
                  <summary className="cursor-pointer">
                    {t("telegram.delivery_status")} · {data.queued_count} {t("telegram.queued")}
                  </summary>
                  <p className="py-2">{t("telegram.delivery_hint")}</p>
                  {data.deliveries.map((delivery) => (
                    <p key={delivery.id} className="py-1">
                      {new Date(delivery.created_at).toLocaleString()} ·{" "}
                      {t(
                        delivery.status === "sent"
                          ? "telegram.sent"
                          : delivery.status === "sending"
                            ? "telegram.sending"
                            : delivery.status === "unknown"
                              ? "telegram.unknown"
                              : "telegram.failed"
                      )}
                    </p>
                  ))}
                </details>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
