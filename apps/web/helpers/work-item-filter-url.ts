import {
  CORE_OPERATORS,
  EXTENDED_OPERATORS,
  WORK_ITEM_FILTER_PROPERTY_KEYS,
  type TWorkItemFilterExpression,
} from "@plane/types";

export const WORK_ITEM_FILTERS_QUERY_PARAM = "filters";

const properties = new Set<string>(WORK_ITEM_FILTER_PROPERTY_KEYS);
const operators = new Set<string>(Object.values({ ...CORE_OPERATORS, ...EXTENDED_OPERATORS }));

function isFilterExpression(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 10) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return depth === 0;
  if (entries.length !== 1) return false;

  const [key, filterValue] = entries[0];
  if (key === "and") {
    return (
      Array.isArray(filterValue) &&
      filterValue.length > 0 &&
      filterValue.every((condition) => isFilterExpression(condition, depth + 1))
    );
  }

  const separator = key.lastIndexOf("__");
  const property = key.slice(0, separator);
  const operator = key.slice(separator + 2);
  return (
    properties.has(property) &&
    operators.has(operator) &&
    (typeof filterValue === "string" ||
      typeof filterValue === "boolean" ||
      (typeof filterValue === "number" && Number.isFinite(filterValue)))
  );
}

/** Invalid or absent URL filters must not replace the user's saved filters. */
export function parseWorkItemFilters(raw: string | null): TWorkItemFilterExpression | undefined {
  if (raw === null || raw.length > 32_768) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return isFilterExpression(value) ? (value as TWorkItemFilterExpression) : undefined;
  } catch {
    return undefined;
  }
}

export function withWorkItemFilters(search: string, expression: TWorkItemFilterExpression): string {
  const params = new URLSearchParams(search);
  // Keep an explicit empty expression: the recipient may have saved filters of their own.
  params.set(WORK_ITEM_FILTERS_QUERY_PARAM, JSON.stringify(expression));
  return `?${params.toString()}`;
}
