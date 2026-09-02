import type { TPSHealthSettings, WorkoutIntervalMode } from "./types";

const DEFAULT_START_KEY = "scheduled";
const DEFAULT_INTERVAL_KEY = "timeEstimate";

const WORKOUT_RESERVED_PROPERTY_KEYS = new Set([
  "allday",
  "archived",
  "caloriesburned",
  "cooldowndays",
  "cssclasses",
  "date",
  "kind",
  "modifieddate",
  "nexteligibledate",
  "session",
  "setcount",
  "status",
  "tags",
  "targetgapdays",
  "title",
  "tpsid",
  "tpsschemaversion",
  "workout",
  "workoutdate",
  "workoutid",
  "workoutplan",
  "workoutplanpath",
]);

export const WORKOUT_TEMPORAL_COMPATIBILITY_KEYS = [
  "scheduled",
  "startedAt",
  "end",
  "endedAt",
  "completedDate",
  "timeEstimate",
  "durationMinutes",
  "durationSeconds",
] as const;

export function workoutStartPropertyKey(settings: Partial<TPSHealthSettings>): string {
  return validWorkoutPropertyKey(settings.workoutStartPropertyKey, DEFAULT_START_KEY);
}

export function workoutIntervalMode(settings: Partial<TPSHealthSettings>): WorkoutIntervalMode {
  return settings.workoutIntervalMode === "end" ? "end" : "duration";
}

export function workoutIntervalPropertyKey(settings: Partial<TPSHealthSettings>): string {
  const startKey = workoutStartPropertyKey(settings);
  const key = validWorkoutPropertyKey(settings.workoutIntervalPropertyKey, DEFAULT_INTERVAL_KEY);
  if (key.toLocaleLowerCase() !== startKey.toLocaleLowerCase()) return key;
  return startKey.toLocaleLowerCase() === DEFAULT_INTERVAL_KEY.toLocaleLowerCase()
    ? "workoutDuration"
    : DEFAULT_INTERVAL_KEY;
}

export function isValidWorkoutPropertyKey(value: unknown): boolean {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
    && !WORKOUT_RESERVED_PROPERTY_KEYS.has(key.toLocaleLowerCase());
}

export function workoutStartedAt(frontmatter: Record<string, unknown>, settings: Partial<TPSHealthSettings>): string {
  return firstString(frontmatter, [workoutStartPropertyKey(settings), "scheduled", "startedAt"]);
}

export function workoutDurationMinutes(frontmatter: Record<string, unknown>, settings: Partial<TPSHealthSettings>): number {
  const configured = workoutIntervalMode(settings) === "duration"
    ? positiveNumber(frontmatter[workoutIntervalPropertyKey(settings)])
    : 0;
  const stored = configured
    || positiveNumber(frontmatter.durationMinutes)
    || positiveNumber(frontmatter.timeEstimate)
    || positiveNumber(frontmatter.durationSeconds) / 60;
  if (stored > 0) return stored;
  const started = Date.parse(workoutStartedAt(frontmatter, settings));
  const ended = Date.parse(workoutEndedAt(frontmatter, settings, false));
  return Number.isFinite(started) && Number.isFinite(ended) && ended >= started
    ? (ended - started) / 60_000
    : 0;
}

export function workoutEndedAt(
  frontmatter: Record<string, unknown>,
  settings: Partial<TPSHealthSettings>,
  deriveFromDuration = true,
): string {
  const configured = workoutIntervalMode(settings) === "end"
    ? firstString(frontmatter, [workoutIntervalPropertyKey(settings)])
    : "";
  const explicit = configured || firstString(frontmatter, ["end", "endedAt", "completedDate"]);
  if (explicit || !deriveFromDuration) return explicit;
  const started = Date.parse(workoutStartedAt(frontmatter, settings));
  const duration = workoutDurationMinutes(frontmatter, settings);
  return Number.isFinite(started) && duration > 0
    ? new Date(started + duration * 60_000).toISOString()
    : "";
}

export function workoutTemporalPropertyUpdates(
  settings: Partial<TPSHealthSettings>,
  current: Record<string, unknown>,
  values: { startedAt?: unknown; endedAt?: unknown; durationMinutes?: unknown; terminal?: boolean } = {},
): Record<string, unknown> {
  const startKey = workoutStartPropertyKey(settings);
  const intervalKey = workoutIntervalPropertyKey(settings);
  const mode = workoutIntervalMode(settings);
  const startedAt = String(values.startedAt || workoutStartedAt(current, settings)).trim();
  let endedAt = String(values.endedAt || workoutEndedAt(current, settings)).trim();
  let durationMinutes = positiveNumber(values.durationMinutes) || workoutDurationMinutes(current, settings);
  if (!endedAt && startedAt && durationMinutes > 0) {
    const started = Date.parse(startedAt);
    if (Number.isFinite(started)) endedAt = new Date(started + durationMinutes * 60_000).toISOString();
  }
  if (!(durationMinutes > 0) && startedAt && endedAt) {
    const elapsed = Date.parse(endedAt) - Date.parse(startedAt);
    if (Number.isFinite(elapsed) && elapsed >= 0) durationMinutes = elapsed / 60_000;
  }
  const updates: Record<string, unknown> = Object.fromEntries(
    WORKOUT_TEMPORAL_COMPATIBILITY_KEYS.map((key) => [key, null]),
  );
  if (startedAt) updates[startKey] = startedAt;
  if (values.terminal) {
    if (mode === "end" && endedAt) updates[intervalKey] = endedAt;
    if (mode === "duration" && durationMinutes > 0) updates[intervalKey] = stableNumber(durationMinutes);
  }
  return updates;
}

function validWorkoutPropertyKey(value: unknown, fallback: string): string {
  const key = typeof value === "string" ? value.trim() : "";
  return isValidWorkoutPropertyKey(key) ? key : fallback;
}

function firstString(frontmatter: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = String(frontmatter[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stableNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
