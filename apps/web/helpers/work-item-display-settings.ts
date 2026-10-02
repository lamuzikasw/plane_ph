import { ISSUE_DISPLAY_PROPERTIES_KEYS, ISSUE_GROUP_BY_OPTIONS } from "@plane/constants";
import {
  EIssueLayoutTypes,
  type IIssueDisplayFilterOptions,
  type IIssueDisplayProperties,
  type IIssueFilters,
} from "@plane/types";
import { getComputedDisplayFilters, getComputedDisplayProperties } from "@plane/utils";

export type TWorkItemDisplaySettings = {
  displayFilters: IIssueDisplayFilterOptions;
  displayProperties: IIssueDisplayProperties;
};

export const WORK_ITEM_DISPLAY_QUERY_PARAM = "display";

/** Use complete settings so the same link renders identically for different users. */
export function getWorkItemDisplaySettings(
  filters?: Pick<IIssueFilters, "displayFilters" | "displayProperties">
): TWorkItemDisplaySettings {
  const displayFilters = getComputedDisplayFilters(filters?.displayFilters);
  if (displayFilters.group_by === null) displayFilters.sub_group_by = null;
  if (displayFilters.layout === EIssueLayoutTypes.KANBAN) {
    if (displayFilters.group_by === displayFilters.sub_group_by) displayFilters.sub_group_by = null;
    if (displayFilters.group_by === null) displayFilters.group_by = "state";
  }
  return { displayFilters, displayProperties: getComputedDisplayProperties(filters?.displayProperties) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isBoolean = (value: unknown) => typeof value === "boolean";
const groupOptions = new Set<unknown>([...ISSUE_GROUP_BY_OPTIONS.map(({ key }) => key), "target_date"]);
const orderFields = new Set([
  "created_at",
  "updated_at",
  "priority",
  "state__name",
  "assignees__first_name",
  "labels__name",
  "issue_module__module__name",
  "issue_cycle__cycle__name",
  "target_date",
  "estimate_point__key",
  "start_date",
  "link_count",
  "attachment_count",
  "sub_issues_count",
]);
const propertyKeys = new Set<string>(ISSUE_DISPLAY_PROPERTIES_KEYS);
const validators: Record<keyof IIssueDisplayFilterOptions, (value: unknown) => boolean> = {
  layout: (value) => Object.values(EIssueLayoutTypes).some((layout) => layout === value),
  group_by: (value) => groupOptions.has(value),
  sub_group_by: (value) => groupOptions.has(value),
  order_by: (value) =>
    typeof value === "string" && (value === "sort_order" || orderFields.has(value.replace(/^-/, ""))),
  show_empty_groups: isBoolean,
  sub_issue: isBoolean,
  calendar: (value) =>
    isRecord(value) &&
    Object.entries(value).every(([key, entry]) =>
      key === "show_weekends" ? isBoolean(entry) : key === "layout" && (entry === "month" || entry === "week")
    ),
};

/** Treat invalid links as absent settings, never as preferences to persist. */
export function parseWorkItemDisplaySettings(raw: string | null): TWorkItemDisplaySettings | undefined {
  if (raw === null || raw.length > 8192) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "displayFilters" && key !== "displayProperties"))
      return undefined;
    if (!isRecord(value.displayFilters) || !isRecord(value.displayProperties)) return undefined;
    if (
      !Object.entries(value.displayFilters).every(
        ([key, entry]) => Object.hasOwn(validators, key) && validators[key as keyof IIssueDisplayFilterOptions](entry)
      )
    )
      return undefined;
    if (!Object.entries(value.displayProperties).every(([key, entry]) => propertyKeys.has(key) && isBoolean(entry)))
      return undefined;
    return getWorkItemDisplaySettings(value as TWorkItemDisplaySettings);
  } catch {
    return undefined;
  }
}

export function withWorkItemDisplaySettings(search: string, settings: TWorkItemDisplaySettings): string {
  const params = new URLSearchParams(search);
  params.set(WORK_ITEM_DISPLAY_QUERY_PARAM, JSON.stringify(getWorkItemDisplaySettings(settings)));
  // Older links use layout separately. Keep it consistent when switching layouts.
  if (params.has("layout")) params.set("layout", settings.displayFilters.layout);
  return `?${params.toString()}`;
}
