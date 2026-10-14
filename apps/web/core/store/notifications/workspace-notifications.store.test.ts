import { runInAction } from "mobx";
import { expect, it, vi } from "vitest";
import type { TNotification } from "@plane/types";
import type { CoreRootStore } from "../root.store";
import { WorkspaceNotificationStore } from "./workspace-notifications.store";

const mocks = vi.hoisted(() => ({ fetchNotifications: vi.fn() }));
vi.mock("@/services/workspace-notification.service", () => ({ default: mocks }));
function notification(id: string): TNotification {
  return { id, workspace: "workspace-id", created_at: "2026-10-12T10:00:00Z" } as TNotification;
}
function setup() {
  const store = new WorkspaceNotificationStore({} as CoreRootStore);
  store.mutateNotifications([notification("old")]);
  mocks.fetchNotifications.mockReset().mockResolvedValue({ results: [notification("new")], next_page_results: false });
  return store;
}
it("adds new notifications and removes deleted ones without resetting the loader", async () => {
  const store = setup();
  const request = store.refreshNotifications("workspace", "workspace-id", () => true);
  expect(store.loader).toBeUndefined();
  await request;
  expect(Object.keys(store.notifications)).toEqual(["new"]);
});
it("ignores results from a previous filter or inactive view", async () => {
  const store = setup();
  const request = store.refreshNotifications("workspace", "workspace-id", () => true);
  runInAction(() => {
    store.filters.archived = true;
  });
  await request;
  expect(Object.keys(store.notifications)).toEqual(["old"]);
  await store.refreshNotifications("workspace", "workspace-id", () => false);
  expect(Object.keys(store.notifications)).toEqual(["old"]);
});
