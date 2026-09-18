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

/** Compare local calendar days, not UTC dates or elapsed 24-hour periods. */
export function foodLogDateIndicator(value: string | undefined, now = new Date(), locale?: string) {
  const parsed = value ? new Date(value) : now;
  const date = Number.isFinite(parsed.getTime()) ? parsed : now;
  const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const difference = dayKey(date) - dayKey(now);
  const state = difference === 0 ? "today" : difference < 0 ? "past" : "future";
  return {
    state,
    icon: state === "today" ? "sun" : state === "past" ? "moon" : "calendar",
    label: state === "today" ? "Logging today" : state === "past" ? "Logging a past day" : "Logging a future day",
    dateLabel: date.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
  };
}
