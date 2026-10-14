import { useEffect, useRef } from "react";

export const LIVE_REFRESH_INTERVAL = 5_000;

type Refresh = (canApply: () => boolean) => Promise<unknown>;

/** Refresh mounted views quietly, without overlapping requests or replacing an active edit. */
export function useLiveRefresh(
  key: string | undefined,
  refresh: Refresh,
  enabled = true,
  options: { protectEdits?: boolean } = {}
) {
  const refreshRef = useRef(refresh);
  const enabledRef = useRef(enabled);
  const protectEditsRef = useRef(options.protectEdits !== false);
  refreshRef.current = refresh;
  enabledRef.current = enabled;
  protectEditsRef.current = options.protectEdits !== false;

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let pending = false;
    let dragging = false;
    let revision = 0;
    let lastInteraction = -Infinity;
    let timer: ReturnType<typeof setTimeout>;

    const canRefresh = () => {
      // Focus alone does not mean an edit is pending. Editors explicitly mark
      // unsaved work; discussions can refresh independently of those drafts.
      const editing = protectEditsRef.current && document.querySelector("[data-live-refresh-paused='true']");
      return (
        !disposed &&
        enabledRef.current &&
        document.visibilityState === "visible" &&
        navigator.onLine &&
        !dragging &&
        !editing &&
        (!protectEditsRef.current || Date.now() - lastInteraction >= 2_000)
      );
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed) timer = setTimeout(() => void run(), LIVE_REFRESH_INTERVAL);
    };
    const run = async () => {
      if (pending) return;
      if (!canRefresh()) {
        schedule();
        return;
      }
      pending = true;
      const startedRevision = revision;
      try {
        await refreshRef.current(() => canRefresh() && (!protectEditsRef.current || revision === startedRevision));
      } catch (error) {
        // Keep the current data on a temporary failure; the next tick retries.
        console.error("Unable to refresh live data", error);
      } finally {
        pending = false;
        schedule();
      }
    };
    const interact = () => {
      revision++;
      lastInteraction = Date.now();
    };
    const startDrag = () => {
      dragging = true;
      interact();
    };
    const endDrag = () => {
      dragging = false;
      interact();
    };
    const resume = () => {
      if (canRefresh()) void run();
    };

    document.addEventListener("input", interact, true);
    document.addEventListener("pointerdown", interact, true);
    document.addEventListener("dragstart", startDrag, true);
    document.addEventListener("dragend", endDrag, true);
    document.addEventListener("drop", endDrag, true);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("input", interact, true);
      document.removeEventListener("pointerdown", interact, true);
      document.removeEventListener("dragstart", startDrag, true);
      document.removeEventListener("dragend", endDrag, true);
      document.removeEventListener("drop", endDrag, true);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [key]);
}
