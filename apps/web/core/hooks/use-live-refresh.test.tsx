// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LIVE_REFRESH_INTERVAL, useLiveRefresh } from "./use-live-refresh";

let root: ReturnType<typeof createRoot>;
const refresh = vi.fn<(canApply: () => boolean) => Promise<unknown>>();
function View({
  id = "project",
  enabled = true,
  protectEdits = true,
}: {
  id?: string;
  enabled?: boolean;
  protectEdits?: boolean;
}) {
  useLiveRefresh(id, refresh, enabled, { protectEdits });
  return null;
}
async function tick(ms = LIVE_REFRESH_INTERVAL) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  refresh.mockReset().mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("refreshes periodically and removes timers on unmount", async () => {
  await act(async () => root.render(<View />));
  expect(refresh).not.toHaveBeenCalled();
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("waits for slow requests instead of overlapping them", async () => {
  let resolve!: () => void;
  refresh.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  await act(async () => root.render(<View />));
  await tick();
  await tick(30_000);
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await tick();
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("pauses hidden or offline tabs and catches up immediately on return", async () => {
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => root.render(<View />));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  visible.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it.each(["input", "textarea", "select", "div"])("continues refreshing when an idle %s retains focus", async (tag) => {
  const input = document.createElement(tag);
  if (tag === "div") {
    input.setAttribute("contenteditable", "true");
    input.tabIndex = 0;
  }
  document.body.append(input);
  input.focus();
  await act(async () => root.render(<View />));
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(input);
  input.blur();
  await tick();
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("updates discussions while typing and saving without touching the local draft", async () => {
  const input = document.createElement("textarea");
  input.value = "My unsent comment";
  input.dataset.liveRefreshPaused = "true";
  document.body.append(input);
  input.focus();
  await act(async () => root.render(<View protectEdits={false} />));
  for (let i = 0; i < 5; i++) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(1_000);
  }
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh.mock.calls[0][0]()).toBe(true);
  expect(input.value).toBe("My unsent comment");
});
it("invalidates an in-flight response when editing or navigating begins", async () => {
  let canApply!: () => boolean;
  refresh.mockImplementation(async (guard) => {
    canApply = guard;
  });
  await act(async () => root.render(<View />));
  await tick();
  expect(canApply()).toBe(true);
  document.dispatchEvent(new Event("input", { bubbles: true }));
  expect(canApply()).toBe(false);
  await tick();
  expect(canApply()).toBe(true);
  await act(async () => root.render(<View id="other-project" />));
  expect(canApply()).toBe(false);
});
it("pauses during saves and dragging", async () => {
  await act(async () => root.render(<View enabled={false} />));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => root.render(<View />));
  document.dispatchEvent(new Event("dragstart"));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  document.dispatchEvent(new Event("dragend"));
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("keeps other views from overwriting a pending autosave after the editor loses focus", async () => {
  const editor = document.createElement("div");
  editor.dataset.liveRefreshPaused = "true";
  document.body.append(editor);
  await act(async () => root.render(<View />));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  editor.dataset.liveRefreshPaused = "false";
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("retries after a failure while retaining the view", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  refresh.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(<View />));
  await tick();
  expect(log).toHaveBeenCalled();
  await tick();
  expect(refresh).toHaveBeenCalledTimes(2);
});
