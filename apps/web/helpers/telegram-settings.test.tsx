// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { TelegramSettings } from "@/services/telegram.service";

const mocks = vi.hoisted(() => ({
  data: {} as TelegramSettings,
  update: vi.fn(),
  action: vi.fn(),
  link: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("swr", () => ({ default: () => ({ data: mocks.data, mutate: mocks.mutate }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/button", () => ({
  Button: ({ variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props} />
  ),
}));
vi.mock("@/services/telegram.service", () => ({
  TelegramService: class {
    settings = vi.fn();
    update = mocks.update;
    action = mocks.action;
    link = mocks.link;
  },
}));
import { TelegramNotificationSettings } from "@/components/settings/profile/content/pages/notifications/telegram-settings";
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.data = {
    available: true,
    connected: true,
    enabled: true,
    scheduled: false,
    assignments: true,
    mentions: true,
    replies: true,
    comments: true,
    watching: false,
    deliveries: [],
    mutes: [],
    queued_count: 0,
    telegram_name: "@demo",
  } as unknown as TelegramSettings;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(() => root.unmount());
});

it("waits for explicit confirmation of the displayed Telegram identity", async () => {
  mocks.data.connected = false;
  mocks.data.pending_id = "123";
  mocks.data.pending_name = "@myaccount";
  await act(() => root.render(<TelegramNotificationSettings />));
  expect(document.body.textContent).toContain("@myaccount");
  expect(mocks.action).not.toHaveBeenCalled();
  await act(async () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === "telegram.confirm")!.click()
  );
  expect(mocks.action).toHaveBeenCalledWith("confirm", { pending_id: "123" });
});

it("keeps the saved preference and shows an error when updating fails", async () => {
  mocks.update.mockRejectedValueOnce(new Error("offline"));
  await act(() => root.render(<TelegramNotificationSettings />));
  const toggle = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
    (el) => el.textContent === "telegram.mentions"
  )!;
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle.click());
  expect(mocks.update).toHaveBeenCalledWith({ mentions: false });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("telegram.error");
});
