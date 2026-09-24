import { useEffect, useRef } from "react";

/** Read only visible replies in the foreground; never advance past unseen messages. */
export function useCommentRead(expanded: boolean, unreadIds: string[], markRead?: (ids: string[]) => Promise<void>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadKey = unreadIds.join(",");

  useEffect(() => {
    if (!expanded || !markRead || !unreadKey || !containerRef.current || typeof IntersectionObserver === "undefined")
      return;
    const visible = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let pending = false;
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || pending || document.visibilityState !== "visible" || !visible.size) return;
      timer = setTimeout(async () => {
        if (stopped || document.visibilityState !== "visible") return;
        const ids = [...visible].slice(0, 100);
        pending = true;
        try {
          await markRead(ids);
          ids.forEach((id) => visible.delete(id));
          pending = false;
          schedule();
        } catch (error) {
          pending = false;
          // Preserve the unread badge on failure; retry on the next visibility change/open.
          console.error("Could not save comment read state", error);
        }
      }, 700);
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const id = (entry.target as HTMLElement).dataset.unreadReply;
        if (!id) return;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      });
      schedule();
    });
    containerRef.current
      .querySelectorAll<HTMLElement>("[data-unread-reply]")
      .forEach((element) => observer.observe(element));
    document.addEventListener("visibilitychange", schedule);
    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [expanded, unreadKey, markRead]);

  return containerRef;
}
