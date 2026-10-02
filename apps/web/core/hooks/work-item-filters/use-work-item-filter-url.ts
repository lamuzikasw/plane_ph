import { useCallback, useEffect, useRef, useState } from "react";
import { isEqual } from "lodash-es";
import { useLocation, useNavigate } from "react-router";
import type { IWorkItemFilterInstance } from "@plane/shared-state";
import { EIssueLayoutTypes, type TWorkItemFilterExpression } from "@plane/types";
import {
  parseWorkItemFilters,
  withWorkItemFilters,
  WORK_ITEM_FILTERS_QUERY_PARAM,
} from "@/helpers/work-item-filter-url";

import {
  getWorkItemDisplaySettings,
  parseWorkItemDisplaySettings,
  withWorkItemDisplaySettings,
  WORK_ITEM_DISPLAY_QUERY_PARAM,
  type TWorkItemDisplaySettings,
} from "@/helpers/work-item-display-settings";

import type { TBoardLink } from "@/services/board-link.service";

type TProps = {
  sharedLink?: TBoardLink;
  ready: boolean;
  savedDisplaySettings?: TWorkItemDisplaySettings;
  activeDisplaySettings?: TWorkItemDisplaySettings;
  onRouteDisplayChange?: (settings: TWorkItemDisplaySettings | undefined, refetch?: boolean) => void;
  savedFilters: TWorkItemFilterExpression | undefined;
  activeFilters: TWorkItemFilterExpression | undefined;
  filter: IWorkItemFilterInstance | undefined;
  onChange: (expression: TWorkItemFilterExpression) => Promise<void>;
  onRouteChange: (expression: TWorkItemFilterExpression | undefined, refetch?: boolean) => void;
};

/** Synchronize board filters with shareable URLs after saved preferences have loaded. */
export function useWorkItemFilterUrl({
  ready,
  sharedLink,
  savedFilters,
  activeFilters,
  filter,
  onChange,
  onRouteChange,
  savedDisplaySettings,
  activeDisplaySettings,
  onRouteDisplayChange,
}: TProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const rawFilters = params.get(WORK_ITEM_FILTERS_QUERY_PARAM);
  const rawDisplay = params.get(WORK_ITEM_DISPLAY_QUERY_PARAM);
  const legacyLayout = params.get("layout");
  const shareToken = params.get("share");
  const routeKey = JSON.stringify([location.pathname, rawFilters, rawDisplay, legacyLayout, shareToken]);
  const lastSyncedDisplay = useRef<TWorkItemDisplaySettings>();
  const lastHandledRoute = useRef<string>();
  const pendingRoute = useRef<{ from: string; to: string }>();
  const applyingRoute = useRef(false);
  const [initializedPath, setInitializedPath] = useState<string>();

  const writeUrl = useCallback(
    (expression: TWorkItemFilterExpression, display = activeDisplaySettings) => {
      const sourceParams = new URLSearchParams(location.search);
      const keepShortLink =
        sharedLink && isEqual(expression, sharedLink.filters) && isEqual(display, sharedLink.display);
      if (!keepShortLink) sourceParams.delete("share");
      let search = keepShortLink ? location.search : withWorkItemFilters(sourceParams.toString(), expression);
      if (display) {
        if (!keepShortLink) search = withWorkItemDisplaySettings(search, display);
        lastSyncedDisplay.current = display;
      }
      const nextParams = new URLSearchParams(search);
      if (search !== location.search) {
        // Router navigation may be deferred while MobX/state updates render immediately.
        // Do not interpret that intermediate render's old URL as a new filter selection.
        pendingRoute.current = {
          from: routeKey,
          to: JSON.stringify([
            location.pathname,
            nextParams.get(WORK_ITEM_FILTERS_QUERY_PARAM),
            nextParams.get(WORK_ITEM_DISPLAY_QUERY_PARAM),
            nextParams.get("layout"),
            nextParams.get("share"),
          ]),
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
    [location, navigate, routeKey, activeDisplaySettings, sharedLink]
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
      onRouteDisplayChange?.(undefined, false);
      lastSyncedDisplay.current = undefined;
      lastHandledRoute.current = undefined;
      pendingRoute.current = undefined;
    },
    [onRouteChange, onRouteDisplayChange]
  );

  useEffect(() => {
    if (pendingRoute.current) {
      if (routeKey === pendingRoute.current.from && routeKey !== pendingRoute.current.to) return;
      if (routeKey === pendingRoute.current.to) lastHandledRoute.current = routeKey;
      pendingRoute.current = undefined;
    }
    if (!ready) return;
    if (lastHandledRoute.current === routeKey) {
      // Display controls update the observable issue store directly, including controls
      // outside this component (the header). Serialize those edits through the same
      // navigation as rich filters so neither update can erase the other's parameters.
      if (activeDisplaySettings && !isEqual(lastSyncedDisplay.current, activeDisplaySettings)) {
        writeUrl(activeFilters ?? {}, activeDisplaySettings);
      }
      return;
    }
    const hadRouteForThisBoard = initializedPath === location.pathname;
    lastHandledRoute.current = routeKey;
    const routeFilters = sharedLink?.filters ?? parseWorkItemFilters(rawFilters);
    const expression = routeFilters ?? savedFilters ?? {};

    let routeDisplay = sharedLink?.display ?? parseWorkItemDisplaySettings(rawDisplay);
    if (!routeDisplay && Object.values(EIssueLayoutTypes).some((layout) => layout === legacyLayout)) {
      routeDisplay = getWorkItemDisplaySettings({
        displayFilters: { ...savedDisplaySettings?.displayFilters, layout: legacyLayout },
        displayProperties: savedDisplaySettings?.displayProperties,
      });
    }
    const display = routeDisplay ?? savedDisplaySettings;
    onRouteDisplayChange?.(routeDisplay);
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
    writeUrl(expression, display);
    setInitializedPath(location.pathname);
  }, [
    ready,
    routeKey,
    rawFilters,
    rawDisplay,
    sharedLink,
    legacyLayout,
    activeDisplaySettings,
    savedDisplaySettings,
    onRouteDisplayChange,
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
