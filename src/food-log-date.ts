export function extractFoodLogIsoDate(value: unknown): string | null {
  const match = String(value || '').match(/(?:^|[^0-9])(\d{4})[-/](\d{2})[-/](\d{2})(?:[^0-9]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function resolveFoodLogDateKey(input: {
  dailyNotePath?: string;
  sourcePath?: string;
  completedDate?: string;
  createdDate?: string;
}): string | null {
  return extractFoodLogIsoDate(input.dailyNotePath)
    || extractFoodLogIsoDate(input.sourcePath)
    || extractFoodLogIsoDate(input.completedDate)
    || extractFoodLogIsoDate(input.createdDate);
}
