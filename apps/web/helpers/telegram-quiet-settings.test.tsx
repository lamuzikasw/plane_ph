// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TelegramQuietSettings } from "@/services/telegram.service";

const mocks = vi.hoisted(() => ({
  data: undefined as TelegramQuietSettings | undefined,
  start: vi.fn(),
  stop: vi.fn(),
  mutate: vi.fn(),
  error: undefined as Error | undefined,
}));
vi.mock("swr", () => ({ default: () => ({ data: mocks.data, error: mocks.error, mutate: mocks.mutate }) }));
vi.mock("@plane/propel/button", () => ({
  Button: ({ variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props} />
  ),
}));
vi.mock("@/services/telegram.service", () => ({
  TelegramService: class {
    quietSettings = vi.fn();
    startQuietPeriod = mocks.start;
    stopQuietPeriod = mocks.stop;
  },
}));
import { TelegramQuietSettings as QuietSettings } from "@/components/workspace/settings/telegram-quiet-settings";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.data = { members: [{ id: "nikita", name: "Никита" }], periods: [] };
  mocks.error = undefined;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(() => root.unmount());
});

async function chooseRecipient() {
  await act(() => {
    const select = document.querySelector("select")!;
    select.value = "nikita";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("requires a recipient and confirms activation only from the server", async () => {
  await act(() => root.render(<QuietSettings workspaceSlug="payholder" />));
  const start = [...document.querySelectorAll("button")].find((b) => b.textContent === "Отключить на час")!;
  expect(start.disabled).toBe(true);
  expect(mocks.start).not.toHaveBeenCalled();
  await chooseRecipient();
  mocks.start.mockRejectedValueOnce(new Error("offline"));
  await act(() => start.click());
  expect(mocks.start).toHaveBeenCalledWith("payholder", "nikita");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Не удалось подтвердить");
  expect(document.querySelectorAll("li")).toHaveLength(0);
});

it("ends only the selected period and reloads its confirmed state", async () => {
  mocks.data!.periods = [
    {
      id: "p1",
      recipient: "nikita",
      started_at: "2026-10-14T10:00:00Z",
      expires_at: "2026-10-14T11:00:00Z",
      stopped_at: null,
    },
  ];
  await act(() => root.render(<QuietSettings workspaceSlug="payholder" />));
  expect(document.body.textContent).toContain("Никита — без Telegram до");
  await chooseRecipient();
  expect([...document.querySelectorAll("button")].find((b) => b.textContent === "Отключить на час")!.disabled).toBe(
    true
  );
  await act(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Завершить")!.click());
  expect(mocks.stop).toHaveBeenCalledWith("payholder", "p1");
  expect(mocks.mutate).toHaveBeenCalledOnce();
});

it("does not expose a usable start control while settings cannot be loaded", async () => {
  mocks.data = undefined;
  mocks.error = new Error("forbidden");
  await act(() => root.render(<QuietSettings workspaceSlug="payholder" />));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Не удалось загрузить");
  expect(document.querySelector("select")).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});
