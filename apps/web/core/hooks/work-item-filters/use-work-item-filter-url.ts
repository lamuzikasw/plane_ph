import { useCallback, useEffect, useRef, useState } from "react";
import { isEqual } from "lodash-es";
import { useLocation, useNavigate } from "react-router";
import type { IWorkItemFilterInstance } from "@plane/shared-state";
import type { TWorkItemFilterExpression } from "@plane/types";
import {
  parseWorkItemFilters,
  withWorkItemFilters,
  WORK_ITEM_FILTERS_QUERY_PARAM,
} from "@/helpers/work-item-filter-url";

type TProps = {
  ready: boolean;
  savedFilters: TWorkItemFilterExpression | undefined;
  activeFilters: TWorkItemFilterExpression | undefined;
  filter: IWorkItemFilterInstance | undefined;
  onChange: (expression: TWorkItemFilterExpression) => Promise<void>;
  onRouteChange: (expression: TWorkItemFilterExpression | undefined, refetch?: boolean) => void;
};

/** Synchronize board filters with shareable URLs after saved preferences have loaded. */
export function useWorkItemFilterUrl({ ready, savedFilters, activeFilters, filter, onChange, onRouteChange }: TProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const rawFilters = new URLSearchParams(location.search).get(WORK_ITEM_FILTERS_QUERY_PARAM);
  const routeKey = JSON.stringify([location.pathname, rawFilters]);
  const lastHandledRoute = useRef<string>();
  const pendingRoute = useRef<{ from: string; to: string }>();
  const applyingRoute = useRef(false);
  const [initializedPath, setInitializedPath] = useState<string>();

  const writeUrl = useCallback(
    (expression: TWorkItemFilterExpression) => {
      const search = withWorkItemFilters(location.search, expression);
      if (search !== location.search) {
        // Router navigation may be deferred while MobX/state updates render immediately.
        // Do not interpret that intermediate render's old URL as a new filter selection.
        pendingRoute.current = {
          from: routeKey,
          to: JSON.stringify([location.pathname, JSON.stringify(expression)]),
        };
        void navigate(
          { pathname: location.pathname, search, hash: location.hash },
          {
            replace: true,
            preventScrollReset: true,
            state: location.state,
          }
        );
      }
    },
    [location, navigate, routeKey]
  );

  const updateFilters = useCallback(
    (expression: TWorkItemFilterExpression) => {
      // resetExpression also notifies its callback; route restoration must never save preferences.
      if (applyingRoute.current) return Promise.resolve();
      writeUrl(expression);
      return onChange(expression);
    },
    [onChange, writeUrl]
  );

  useEffect(
    () => () => {
      onRouteChange(undefined, false);
      lastHandledRoute.current = undefined;
      pendingRoute.current = undefined;
    },
    [onRouteChange]
  );

  useEffect(() => {
    if (pendingRoute.current) {
      if (routeKey === pendingRoute.current.from && routeKey !== pendingRoute.current.to) return;
      if (routeKey === pendingRoute.current.to) lastHandledRoute.current = routeKey;
      pendingRoute.current = undefined;
    }
    if (!ready || lastHandledRoute.current === routeKey) return;
    const hadRouteForThisBoard = initializedPath === location.pathname;
    lastHandledRoute.current = routeKey;
    const routeFilters = parseWorkItemFilters(rawFilters);
    const expression = routeFilters ?? savedFilters ?? {};

    onRouteChange(routeFilters);
    // The issue store keeps saved and temporary expressions separate. Reset only the
    // existing chips here, suppressing their usual persistence/URL-change callback.
    if (filter && hadRouteForThisBoard && !isEqual(expression, activeFilters ?? {})) {
      applyingRoute.current = true;
      try {
        filter.resetExpression(expression, false);
      } finally {
        applyingRoute.current = false;
      }
    }
    writeUrl(expression);
    setInitializedPath(location.pathname);
  }, [
    ready,
    routeKey,
    rawFilters,
    savedFilters,
    activeFilters,
    filter,
    onRouteChange,
    writeUrl,
    initializedPath,
    location.pathname,
  ]);

  return { updateFilters, isReady: ready && initializedPath === location.pathname };
}
