import { useEffect, useRef, useState } from "react";
import { EActivityFilterType } from "@plane/constants";
import type { TActivityFilters } from "@plane/constants";

/** Open the discussion without overwriting the user's saved activity filters. */
export function useCommentNavigation({
  requestKey,
  issueId,
  ready,
  savedFilters,
  saveFilters,
  scrollToDiscussion = true,
}: {
  requestKey: string | number | undefined;
  issueId: string;
  ready: boolean;
  savedFilters: TActivityFilters[];
  saveFilters: (filters: TActivityFilters[]) => void;
  scrollToDiscussion?: boolean;
}) {
  const activityRef = useRef<HTMLDivElement>(null);
  const handledRequest = useRef<string>();
  const request = requestKey === undefined ? undefined : `${issueId}:${requestKey}`;
  const [override, setOverride] = useState<{ request: string; filters: TActivityFilters[] }>();
  const filters = request
    ? override?.request === request
      ? override.filters
      : [EActivityFilterType.COMMENT]
    : savedFilters;

  useEffect(() => {
    if (!scrollToDiscussion || !request || !ready || handledRequest.current === request || !activityRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = activityRef.current;
      if (!element) return;
      element.scrollIntoView({ block: "start", behavior: "instant" });
      element.focus({ preventScroll: true });
      handledRequest.current = request;
    });
    return () => cancelAnimationFrame(frame);
  }, [request, ready, scrollToDiscussion]);

  return {
    activityRef,
    filters,
    setFilters: (next: TActivityFilters[]) => {
      if (request) setOverride({ request, filters: next });
      else saveFilters(next);
    },
  };
}
