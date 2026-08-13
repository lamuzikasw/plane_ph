export const parseBoundedIntegerInput = (value: string, min: number, max: number): number | null => {
  if (value.trim() === "") return null;

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < min || parsedValue > max) return null;

  return parsedValue;
};

export const normalizeBoundedIntegerInput = (value: string, fallback: number, min: number, max: number): string =>
  String(parseBoundedIntegerInput(value, min, max) ?? fallback);
