import { migrateWorkoutTiming } from './workout-timing-migration';
import { authoredMetricServing } from "./food-serving";
import type { ExtraNutrition } from "./nutrients";
import { EXTRA_NUTRIENT_KEYS, CORE_NUTRIENT_KEYS, extraNutrition, addExtraNutrition, isExtraNutrientKey } from "./nutrients";
import type { NutritionTotals } from "./types";
import { normalizeFoodLogTags } from "./food-log-tags";
import { getFrontMatterInfo, parseYaml, TFile } from 'obsidian';
import type TPSHealthPlugin from './main';
import { id, isoDateKey } from './format';
import * as logger from './logger';
import type { ActivityLogEntry, FoodLogEntry, Nutrition, TPSHealthSettings, WorkoutSet } from './types';
import {
  workoutDurationMinutes,
  workoutEndedAt,
  workoutStartedAt,
  workoutTemporalPropertyUpdates,
} from './workout-properties';
import {
  canonicalNativeKind,
  configuredNativeKind,
  decodeNativeRecordFrontmatter,
  encodeNativeRecordProperties,
  hasCustomNativeKindValues,
} from './native-record-schema';

export const TPS_HEALTH_NATIVE_RECORDS_VERSION = 4;
const WORKOUT_DATA_VERSION = 1;
const WORKOUT_DATA_BODY_PREFIX = '<!-- tps-health-workout-data:v1:';
const WORKOUT_DATA_BODY_SUFFIX = ' -->';

type NativeHealthKind = 'food-entry' | 'activity-entry' | 'workout-session' | 'workout-exercise';

export interface NativeRecordHandle {
  file: TFile;
  path: string;
  id: string;
  kind: NativeHealthKind;
  frontmatter: Record<string, unknown>;
}

interface RawNativeRecordHandle extends Omit<NativeRecordHandle, 'kind'> {
  kind: string;
}

interface NativeRecordsApi {
  version: number;
  capabilities?: { customKinds?: boolean; freshIdentityCreates?: boolean; updateFromSource?: boolean };
  isEnabled(): boolean;
  getStorageProfile?(kind?: string): unknown;
  getKindPropertyKeys?(): unknown;
  create(kind: string, properties: Record<string, unknown>, options?: Record<string, unknown>): Promise<RawNativeRecordHandle>;
  createFresh?(kind: string, properties: Record<string, unknown>, options?: Record<string, unknown>): Promise<RawNativeRecordHandle>;
  resolve(reference: string | TFile | { path?: string; id?: string; tpsId?: string }): Promise<RawNativeRecordHandle | null>;
  update(reference: string | TFile | { path?: string; id?: string; tpsId?: string }, updates: Record<string, unknown>, cause?: Record<string, unknown>): Promise<RawNativeRecordHandle | null>;
  updateFromSource?(reference: string | TFile | { path?: string; id?: string; tpsId?: string }, propertyKeys: readonly string[], compute: (frontmatter: Record<string, unknown>) => Record<string, unknown> | null, cause?: Record<string, unknown>): Promise<RawNativeRecordHandle | null>;
  rename?(reference: string | TFile | { path?: string; id?: string; tpsId?: string }, fileName: string, cause?: Record<string, unknown>): Promise<RawNativeRecordHandle | null>;
  inspect(frontmatter: unknown): {
    id: string;
    kind: string;
    schemaVersion: number;
    frontmatter: Record<string, unknown>;
  } | null;
}

class WorkoutSessionConflictError extends Error {
  constructor() {
    super('Workout session data changed while the mutation was being prepared.');
    this.name = 'WorkoutSessionConflictError';
  }
}

interface IndexedHealthRecord {
  file: TFile;
  frontmatter: Record<string, unknown>;
  id: string;
  kind: NativeHealthKind;
  dailyDates: string[];
}

export interface NativeWorkoutSetSnapshot {
  id: string;
  ordinal: number;
  reps: number;
  weight: number;
  weightUnit: string;
  perArm: boolean;
  rpe?: number;
  restSeconds?: number;
  setType: string;
  dropSetGroupId?: string;
  completedDate: string;
  restStartedAt: string;
  note: string;
}

export interface NativeWorkoutSetPatch {
  reps?: number;
  weight?: number;
  weightUnit?: string;
  perArm?: boolean;
  rpe?: number | null;
  restSeconds?: number | null;
  setType?: string;
  completed?: boolean;
}

export interface NativeWorkoutExerciseSnapshot {
  id: string;
  path: string;
  name: string;
  exercisePath: string;
  supersetGroupId?: string;
  totalReps: number;
  totalVolume: number;
  sets: NativeWorkoutSetSnapshot[];
}

export interface NativeWorkoutSnapshot {
  id: string;
  path: string;
  title: string;
  status: string;
  startedAt: string;
  endedAt: string;
  exerciseCount: number;
  setCount: number;
  exercises: NativeWorkoutExerciseSnapshot[];
}

interface StoredWorkoutExercise {
  id: string;
  name: string;
  exercisePath: string;
  supersetGroupId?: string;
  sets: Array<Record<string, unknown>>;
}

export interface NativeWorkoutStoragePlan {
  sessions: number;
  childNotes: number;
}

export interface NativeWorkoutStorageResult extends NativeWorkoutStoragePlan {
  consolidated: number;
  trashed: number;
  failed: number;
}

export type WorkoutExerciseDefinitionResolver = (name: string, existingPath: string) => Promise<string>;

export type NativeWorkoutSessionResolutionState = 'active' | 'terminal' | 'missing' | 'ambiguous';

export interface NativeWorkoutSessionResolution {
  state: NativeWorkoutSessionResolutionState;
  matches: number;
  id: string;
  path: string;
  title: string;
  status: string;
  startedAt: string;
  reason?: 'duplicate-id' | 'identity-conflict';
}

function emptyWorkoutSessionResolution(
  state: Extract<NativeWorkoutSessionResolutionState, 'missing' | 'ambiguous'>,
  matches: number,
  reason?: NativeWorkoutSessionResolution['reason'],
): NativeWorkoutSessionResolution {
  return {
    state,
    matches,
    id: '',
    path: '',
    title: '',
    status: '',
    startedAt: '',
    reason,
  };
}

export interface LegacyHealthImportPlan {
  candidates: number;
  existing: number;
  foodEntries: number;
  activityEntries: number;
  workoutSessions: number;
  workoutExercises: number;
  unresolvedLines: number;
  totals: NutritionTotals;
}

export interface LegacyHealthImportResult extends LegacyHealthImportPlan {
  created: number;
  skipped: number;
  failed: number;
}

export interface NativeIdentityNormalizationResult {
  inspected: number;
  updated: number;
  skipped: number;
}

export interface NativeFilenameNormalizationResult {
  inspected: number;
  renamed: number;
  unchanged: number;
  failed: number;
  renamedPaths: Record<string, string>;
}

export interface ActiveWorkoutFilenameState {
  id: string;
  path: string;
}

/**
 * Reconcile an active workout after an awaited rename batch without reviving a
 * session that was finished, discarded, or replaced while the batch ran.
 */
export function resolveActiveWorkoutAfterFilenameMigration(input: {
  captured: ActiveWorkoutFilenameState;
  current: ActiveWorkoutFilenameState;
  result: NativeFilenameNormalizationResult;
  indexedSession: Pick<NativeWorkoutSnapshot, 'id' | 'path'> | null;
}): ActiveWorkoutFilenameState | null {
  const capturedExplicitId = String(input.captured.id || '').trim();
  const capturedPath = String(input.captured.path || '').trim();
  const capturedId = capturedExplicitId
    || capturedPath.split('/').pop()?.replace(/\.md$/iu, '')
    || '';
  if (!capturedId) return null;

  const currentId = String(input.current.id || '').trim();
  const currentPath = String(input.current.path || '').trim();
  const stillSameSession = capturedExplicitId
    ? currentId === capturedExplicitId
    : !currentId && currentPath === capturedPath;
  if (!stillSameSession) return null;

  const indexedPath = input.indexedSession?.id === capturedId
    ? String(input.indexedSession.path || '').trim()
    : '';
  const path = String(input.result.renamedPaths[capturedId] || indexedPath).trim();
  return path ? { id: capturedId, path } : null;
}

export interface NativeHealthRecordChange {
  path: string;
  kinds: NativeHealthKind[];
  dates: string[];
}

export interface NativeDailyActivityTotals {
  dateIso: string;
  entryCount: number;
  durationMinutes: number;
  caloriesBurned: number;
  steps: number;
}

export interface NativeDailyFoodEntrySnapshot extends ExtraNutrition {
  id: string;
  path: string;
  title: string;
  completedDate: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sugarAlcoholG: number;
  alcoholG: number;
  sodiumMg: number;
  note: string;
  linkedFood: boolean;
}

export interface NativeFoodUsageEntry {
  name: string;
  brand?: string;
  barcode?: string;
  sourcePath?: string;
  completedDate: string;
}

export interface NativeDailyActivityEntrySnapshot {
  id: string;
  path: string;
  kind: 'activity-entry' | 'workout-session';
  title: string;
  activityType: string;
  startedAt: string;
  completedDate: string;
  durationMinutes: number;
  distance: number;
  distanceUnit: string;
  steps: number;
  caloriesBurned: number;
  note: string;
  status: string;
}

export type NativeDailyFoodEntryPatch = Omit<NativeDailyFoodEntrySnapshot, 'id' | 'path'>;
export type NativeDailyActivityEntryPatch = Omit<NativeDailyActivityEntrySnapshot, 'id' | 'path' | 'kind' | 'status'>;

interface LegacyHealthCandidate {
  id: string;
  kind: NativeHealthKind;
  properties: Record<string, unknown>;
  sourcePath: string;
  lineNumber: number;
  workoutReferenceId?: string;
}

const HEALTH_KINDS = new Set<NativeHealthKind>(['food-entry', 'activity-entry', 'workout-session', 'workout-exercise']);
const foodNutritionKeys = () => [
  ...CORE_NUTRIENT_KEYS, ...EXTRA_NUTRIENT_KEYS,
] as const;
const CORE_FOOD_NUTRITION_KEYS = new Set<string>(['calories', 'proteinG', 'carbsG', 'fatG']);
const REDUNDANT_FOOD_ENTRY_KEYS = [
  'status', 'date', 'foodName', 'brand', 'amount', 'amountUnit',
  'foodPath', 'foodId', 'servingQuantity', 'servingUnit',
] as const;
const REDUNDANT_WORKOUT_SESSION_KEYS = [
  'date', 'completedDate', 'scheduled', 'workoutDate', 'allDay', 'cooldownDays', 'targetGapDays',
  'nextEligibleDate', 'durationSeconds', 'timeEstimate', 'exerciseCount', 'setCount', 'totalReps',
  'totalVolume', 'lastSetEndedAt',
] as const;

function compactRecordProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => (
    value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
  )));
}

function foodNutritionStorageValues(
  nutrition: object,
  clearMissing = false,
): Record<string, unknown> {
  const values = nutrition as Record<string, unknown>;
  const additional = extraNutrition(values);
  return Object.fromEntries(foodNutritionKeys().map((key) => {
    if (isExtraNutrientKey(key)) {
      const value = additional[key];
      return [key, value ?? (clearMissing ? null : undefined)];
    }
    const value = stableNumber(numberValue(values[key]));
    return [key, CORE_FOOD_NUTRITION_KEYS.has(key) || value !== 0 ? value : clearMissing ? null : undefined];
  }).filter(([, value]) => value !== undefined));
}

function clearProperties(keys: readonly string[]): Record<string, null> {
  return Object.fromEntries(keys.map((key) => [key, null]));
}

const strictDateKey = (...values: unknown[]): string => {
  for (const value of values) {
    const resolved = dateKey(value);
    if (/^\d{4}-\d{2}-\d{2}$/u.test(resolved)) return resolved;
  }
  return '';
};

const readableTitle = (...values: unknown[]): string => {
  for (const value of values) {
    const resolved = String(value || '').replace(/\s+/gu, ' ').trim();
    if (resolved) return resolved;
  }
  return '';
};

const GENERATED_WORKOUT_TITLE_PATTERN = /^(.+\S)\s+\d{4}-\d{2}-\d{2}\s+((?:[01]\d|2[0-3])\.[0-5]\d)$/u;
const GENERATED_DEFAULT_WORKOUT_DATE_ONLY_PATTERN = /^Workout\s+\d{4}-\d{2}-\d{2}$/u;

const workoutTitleTimestamp = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!/[T\s]\d{2}:\d{2}/u.test(raw)) return '';
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return '';
  const time = `${String(parsed.getHours()).padStart(2, '0')}.${String(parsed.getMinutes()).padStart(2, '0')}`;
  return `${isoDateKey(raw)} ${time}`;
};

const workoutFileTitle = (title: string, startedAt: unknown): string => {
  if (!title) return title;
  const generated = title.match(GENERATED_WORKOUT_TITLE_PATTERN);
  if (generated && title.endsWith(` ${workoutTitleTimestamp(startedAt)}`)) return `${generated[1]} ${generated[2]}`;
  // The production generator always includes a time. Keep this date-only form
  // for compatibility with older/generated records and deterministic test
  // clocks, while leaving other authored date-bearing titles unchanged.
  if (GENERATED_DEFAULT_WORKOUT_DATE_ONLY_PATTERN.test(title)) return 'Workout';
  return title;
};

const GENERATED_TITLE_FIRST_WORKOUT_PATTERN = /^(.+\S)\s+(\d{4}-\d{2}-\d{2})\s+((?:[01]\d|2[0-3])\.[0-5]\d)$/u;

const hasExactGeneratedTitleFirstWorkoutBasename = (record: IndexedHealthRecord): boolean => {
  if (record.kind !== 'workout-session') return false;
  const title = String(record.frontmatter.title || '').trim();
  if (!title || record.file.basename !== title) return false;
  const match = title.match(GENERATED_TITLE_FIRST_WORKOUT_PATTERN);
  if (!match) return false;
  const startedAtRaw = String(record.frontmatter.scheduled || record.frontmatter.startedAt || '').trim();
  if (!/[T\s]\d{2}:\d{2}/u.test(startedAtRaw)) return false;
  const startedAt = new Date(startedAtRaw);
  if (!Number.isFinite(startedAt.getTime())) return false;
  const startedDate = isoDateKey(startedAtRaw);
  const startedTime = `${String(startedAt.getHours()).padStart(2, '0')}.${String(startedAt.getMinutes()).padStart(2, '0')}`;
  const recordDate = strictDateKey(
    record.frontmatter.date,
    record.frontmatter.workoutDate,
    startedAtRaw,
    record.frontmatter.createdDate,
  );
  return Boolean(recordDate && match[2] === recordDate && match[2] === startedDate && match[3] === startedTime);
};

/**
 * Stable TPS identity lives in frontmatter. Physical filenames are a readable
 * projection for people, links, and file-based consumers.
 */
export function buildNativeHealthRecordFileName(
  kind: NativeHealthKind,
  properties: Record<string, unknown>,
  workoutContext: { date?: unknown } = {},
): string {
  if (kind === 'food-entry') {
    const date = strictDateKey(properties.date, properties.completedDate, properties.createdDate);
    const title = readableTitle(properties.foodName, properties.title, 'Food');
    return [date, title].filter(Boolean).join(' - ');
  }
  if (kind === 'activity-entry') {
    const date = strictDateKey(properties.date, properties.completedDate, properties.startedAt, properties.createdDate);
    const title = readableTitle(properties.activity, properties.title, 'Activity');
    return [date, title].filter(Boolean).join(' - ');
  }
  if (kind === 'workout-session') {
    const startedAt = properties.scheduled || properties.startedAt;
    const date = strictDateKey(properties.date, properties.workoutDate, startedAt, properties.createdDate);
    const title = workoutFileTitle(readableTitle(properties.title, 'Workout'), startedAt);
    return [date, title].filter(Boolean).join(' - ');
  }
  if (kind === 'workout-exercise') {
    const date = strictDateKey(workoutContext.date, properties.date, properties.createdDate);
    const exercise = readableTitle(properties.exercise, properties.title, 'Exercise');
    return [date, exercise].filter(Boolean).join(' - ');
  }
  return '';
}

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nonNegativeNumber = (value: unknown): number => Math.max(0, numberValue(value));

const optionalNonNegativeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function nativeActivityDurationMinutes(frontmatter: Record<string, unknown>, settings?: Partial<TPSHealthSettings>): number {
  if (settings) return String(frontmatter.status || 'active').trim().toLowerCase() === 'active'
    ? 0 : workoutDurationMinutes(frontmatter, settings);
  return numberValue(frontmatter.durationMinutes)
    || numberValue(frontmatter.timeEstimate)
    || numberValue(frontmatter.durationSeconds) / 60
    || (() => {
      const startedAt = Date.parse(String(frontmatter.startedAt || ''));
      const endedAt = Date.parse(String(frontmatter.endedAt || frontmatter.completedDate || ''));
      return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
        ? (endedAt - startedAt) / 60_000
        : 0;
    })();
}

const storedWorkoutSets = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((set): set is Record<string, unknown> => !!set && typeof set === 'object' && !Array.isArray(set))
    .map((set) => ({
      id: String(set.id || '').trim(),
      ...(set.reps != null ? { reps: numberValue(set.reps) } : {}),
      ...(set.weight != null ? { weight: numberValue(set.weight) } : {}),
      weightUnit: String(set.unit || set.weightUnit || 'lb').trim() || 'lb',
      ...(set.perArm === true ? { perArm: true } : {}),
      ...(set.distance != null ? { distance: numberValue(set.distance) } : {}),
      ...(String(set.distanceUnit || '').trim() ? { distanceUnit: String(set.distanceUnit).trim() } : {}),
      ...(set.duration != null || set.durationSeconds != null
        ? { durationSeconds: numberValue(set.duration ?? set.durationSeconds) }
        : {}),
      ...(set.rpe != null ? { rpe: numberValue(set.rpe) } : {}),
      ...(set.rest != null || set.restSeconds != null
        ? { restSeconds: numberValue(set.rest ?? set.restSeconds) }
        : {}),
      setType: String(set.type || set.setType || 'normal').trim() || 'normal',
      ...(String(set.drop || set.dropSetGroupId || '').trim()
        ? { dropSetGroupId: String(set.drop || set.dropSetGroupId).trim() }
        : {}),
      ...(String(set.completed || set.completedDate || set.endedAt || '').trim()
        ? { completedDate: String(set.completed || set.completedDate || set.endedAt).trim() }
        : {}),
      ...(String(set.restStarted || set.restStartedAt || '').trim()
        ? { restStartedAt: String(set.restStarted || set.restStartedAt).trim() }
        : {}),
      ...(String(set.started || set.startedAt || '').trim()
        ? { startedAt: String(set.started || set.startedAt).trim() }
        : {}),
      ...(String(set.note || '').trim() ? { note: String(set.note).trim() } : {}),
    }))
  : [];

const storedWorkoutExercises = (value: unknown): StoredWorkoutExercise[] | null => {
  let decoded: unknown = value;
  if (typeof value === 'string' && value.trim()) {
    try { decoded = JSON.parse(value); } catch { return null; }
  }
  const raw = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
    ? (decoded as Record<string, unknown>).exercises
    : null;
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((entry, index): StoredWorkoutExercise[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const linkedExercise = wikilinkPath(record.exercise || record.exercisePath);
    const name = String(record.name || record.title || linkedExercise.split('/').pop() || '').trim();
    if (!name) return [];
    return [{
      id: String(record.id || `exercise-${index + 1}`).trim() || `exercise-${index + 1}`,
      name,
      exercisePath: linkedExercise,
      supersetGroupId: String(record.superset || record.supersetGroupId || '').trim() || undefined,
      sets: storedWorkoutSets(record.sets),
    }];
  });
};

/**
 * Public frontmatter uses short, human-facing nested keys while the service
 * normalizes them back to its existing internal model. This keeps one Base-
 * queryable top-level property without leaking implementation-shaped fields.
 */
export const workoutSessionPropertyValue = (exercises: StoredWorkoutExercise[]): Record<string, unknown> => ({
  version: WORKOUT_DATA_VERSION,
  exercises: exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    ...(exercise.exercisePath ? { exercise: `[[${exercise.exercisePath.replace(/\.md$/iu, '')}]]` } : {}),
    ...(exercise.supersetGroupId ? { superset: exercise.supersetGroupId } : {}),
    sets: exercise.sets.map((rawSet) => {
      const set = storedWorkoutSets([rawSet])[0] || {};
      return compactRecordProperties({
        id: set.id,
        reps: set.reps,
        weight: set.weight,
        unit: set.weightUnit,
        perArm: set.perArm === true ? true : undefined,
        distance: set.distance,
        distanceUnit: set.distanceUnit,
        duration: set.durationSeconds,
        rpe: set.rpe,
        rest: set.restSeconds,
        type: String(set.setType || 'normal') === 'normal' ? undefined : set.setType,
        drop: set.dropSetGroupId,
        completed: set.completedDate,
        restStarted: set.restStartedAt,
        started: set.startedAt,
        note: set.note,
      });
    }),
  })),
});

const workoutSessionState = (value: unknown): string | null => {
  const exercises = storedWorkoutExercises(value);
  return exercises ? JSON.stringify(workoutSessionPropertyValue(exercises)) : null;
};

function workoutDataBodyMatch(content: string): RegExpMatchArray | null {
  const escapedPrefix = WORKOUT_DATA_BODY_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedSuffix = WORKOUT_DATA_BODY_SUFFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return String(content || '').match(new RegExp(`${escapedPrefix}([^\\r\\n]*?)${escapedSuffix}`, 'u'));
}

function workoutDataMarkerState(content: string): string | null {
  return workoutDataBodyMatch(content)?.[0] || null;
}

function workoutFrontmatterFromContent(content: string): Record<string, unknown> {
  const info = getFrontMatterInfo(String(content || ''));
  if (!info.exists) return {};
  const parsed = parseYaml(info.frontmatter);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function workoutStorageStateFromContent(content: string, settings?: TPSHealthSettings): string | null {
  const rawFrontmatter = workoutFrontmatterFromContent(content);
  const frontmatter = settings ? decodeNativeRecordFrontmatter(settings, rawFrontmatter) : rawFrontmatter;
  return workoutStorageState(frontmatter, workoutDataMarkerState(content));
}

function workoutStorageState(
  frontmatter: Record<string, unknown>,
  legacyMarker: string | null = null,
): string | null {
  if (Object.prototype.hasOwnProperty.call(frontmatter, 'session')) {
    return `session:${workoutSessionState(frontmatter.session) || 'invalid'}`;
  }
  if (legacyMarker) return `body:${legacyMarker}`;
  if (Object.prototype.hasOwnProperty.call(frontmatter, 'workoutData')) {
    return `legacy-property:${workoutSessionState(frontmatter.workoutData) || 'invalid'}`;
  }
  return null;
}

function restoreWorkoutDataMarkerState(content: string, markerState: string | null): string {
  const source = String(content || '');
  const match = workoutDataBodyMatch(source);
  if (!match || match.index == null) return source;
  if (markerState != null) return `${source.slice(0, match.index)}${markerState}${source.slice(match.index + match[0].length)}`;
  const afterMarker = match.index + match[0].length;
  const newlineLength = source.slice(afterMarker).startsWith('\r\n')
    ? 2
    : source.slice(afterMarker).startsWith('\n') ? 1 : 0;
  return `${source.slice(0, match.index)}${source.slice(afterMarker + newlineLength)}`;
}

export function readWorkoutDataFromNoteContent(content: string): string | null {
  const match = workoutDataBodyMatch(content);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function writeWorkoutDataToNoteContent(content: string, workoutData: string): string {
  const source = String(content || '');
  const encoded = encodeURIComponent(String(workoutData || ''));
  const marker = `${WORKOUT_DATA_BODY_PREFIX}${encoded}${WORKOUT_DATA_BODY_SUFFIX}`;
  const escapedPrefix = WORKOUT_DATA_BODY_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedSuffix = WORKOUT_DATA_BODY_SUFFIX.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const markerPattern = new RegExp(`${escapedPrefix}[^\\r\\n]*?${escapedSuffix}`, 'u');
  if (markerPattern.test(source)) return source.replace(markerPattern, marker);
  const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u);
  const offset = frontmatter?.[0].length || 0;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const before = source.slice(0, offset);
  const after = source.slice(offset);
  return `${before}${marker}${newline}${after}`;
}

const foodReference = (frontmatter: Record<string, unknown>): unknown => (
  frontmatter.food ?? frontmatter.foodPath
);

const cloneStoredWorkoutExercises = (exercises: StoredWorkoutExercise[]): StoredWorkoutExercise[] => exercises.map((exercise) => ({
  ...exercise,
  sets: exercise.sets.map((set) => ({ ...set })),
}));

const nextStoredWorkoutGroupId = (usedValues: string[], prefix: 'super' | 'drop'): string => {
  const used = new Set(usedValues.map((value) => String(value || '').trim()).filter(Boolean));
  for (let code = 65; code <= 90; code++) {
    const candidate = String.fromCharCode(code);
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}-${stableHash(`${Date.now()}\u0000${usedValues.join('\u0000')}`)}`;
};

const clearSingletonSupersets = (exercises: StoredWorkoutExercise[]): void => {
  const counts = new Map<string, number>();
  for (const exercise of exercises) {
    if (exercise.supersetGroupId) counts.set(exercise.supersetGroupId, (counts.get(exercise.supersetGroupId) || 0) + 1);
  }
  for (const exercise of exercises) {
    if (exercise.supersetGroupId && (counts.get(exercise.supersetGroupId) || 0) < 2) delete exercise.supersetGroupId;
  }
};

const clearSingletonDropSets = (exercise: StoredWorkoutExercise): void => {
  const counts = new Map<string, number>();
  for (const set of exercise.sets) {
    const groupId = String(set.dropSetGroupId || '').trim();
    if (groupId) counts.set(groupId, (counts.get(groupId) || 0) + 1);
  }
  for (const set of exercise.sets) {
    const groupId = String(set.dropSetGroupId || '').trim();
    if (!groupId || (counts.get(groupId) || 0) >= 2) continue;
    delete set.dropSetGroupId;
    if (String(set.setType || '').trim().toLowerCase() === 'drop') set.setType = 'normal';
  }
};

const workoutAggregates = (exercises: StoredWorkoutExercise[]): {
  exerciseCount: number;
  setCount: number;
  totalReps: number;
  totalVolume: number;
} => {
  const sets = exercises.flatMap((exercise) => exercise.sets);
  return {
    exerciseCount: exercises.length,
    setCount: sets.length,
    totalReps: sets.reduce((sum, set) => sum + numberValue(set.reps), 0),
    totalVolume: sets.reduce((sum, set) => (
      sum + numberValue(set.reps) * numberValue(set.weight) * (set.perArm === true ? 2 : 1)
    ), 0),
  };
};

function workoutSessionDataUpdates(
  exercises: StoredWorkoutExercise[],
  updates: Record<string, unknown> = {},
  current: Record<string, unknown> = {},
  settings: TPSHealthPlugin['settings'],
): Record<string, unknown> {
  const terminal = String(updates.status || current.status || '').trim().toLocaleLowerCase() !== 'active';
  const durationMinutes = numberValue(updates.durationMinutes)
    || numberValue(updates.timeEstimate)
    || numberValue(updates.durationSeconds) / 60
    || (updates.endedAt || updates.completedDate ? 0 : workoutDurationMinutes(current, settings));
  return {
    ...clearProperties(REDUNDANT_WORKOUT_SESSION_KEYS),
    ...workoutTemporalPropertyUpdates(settings, current, {
      startedAt: updates.startedAt,
      endedAt: updates.endedAt || updates.completedDate,
      durationMinutes,
      terminal,
    }),
    session: workoutSessionPropertyValue(exercises),
    workoutData: null,
    ...compactRecordProperties({
      status: updates.status,
      caloriesBurned: updates.caloriesBurned,
      archived: updates.archived,
    }),
    ...(updates.archivedDate === null ? { archivedDate: null } : {}),
  };
}

function minimalNativeRecordProperties(
  kind: NativeHealthKind,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === 'food-entry') {
    return compactRecordProperties({
      title: properties.title || properties.foodName,
      completedDate: properties.completedDate || properties.createdDate,
      food: properties.food || properties.foodPath,
      quantity: properties.quantity,
      unit: properties.unit,
      ...foodNutritionStorageValues(properties),
      note: properties.note,
    });
  }
  if (kind === 'activity-entry') {
    const completedDate = properties.completedDate || properties.createdDate;
    return compactRecordProperties({
      title: properties.title || properties.activity,
      activityType: properties.activityType,
      startedAt: properties.startedAt && properties.startedAt !== completedDate ? properties.startedAt : undefined,
      completedDate,
      durationMinutes: properties.durationMinutes,
      distance: properties.distance,
      distanceUnit: properties.distanceUnit,
      steps: properties.steps,
      caloriesBurned: properties.caloriesBurned,
      source: properties.source && properties.source !== 'manual' ? properties.source : undefined,
      device: properties.device,
      note: properties.note,
    });
  }
  if (kind === 'workout-session') {
    return compactRecordProperties({
      title: properties.title,
      status: properties.status || 'complete',
      startedAt: properties.startedAt || properties.createdDate,
      endedAt: properties.endedAt || properties.completedDate,
      workoutPlan: properties.workoutPlan || properties.workoutPlanPath,
      caloriesBurned: properties.caloriesBurned,
      session: storedWorkoutExercises(properties.session)
        ? workoutSessionPropertyValue(storedWorkoutExercises(properties.session) || [])
        : undefined,
    });
  }
  return compactRecordProperties(properties);
}

const dateKey = (value: unknown): string => {
  const raw = String(value || '').trim();
  return raw ? isoDateKey(raw) : '';
};

function indexedDailyDates(kind: NativeHealthKind, frontmatter: Record<string, unknown>, settings: TPSHealthSettings): string[] {
  const fm = frontmatter;
  if (kind === 'food-entry') return [dateKey(fm.completedDate || fm.date)].filter(Boolean);
  if (kind === 'activity-entry') return [...new Set([
    dateKey(fm.date || fm.completedDate),
    dateKey(fm.date || fm.workoutDate || fm.completedDate || fm.startedAt || fm.endedAt),
  ].filter(Boolean))];
  if (kind === 'workout-session') {
    const startedAt = workoutStartedAt(fm, settings);
    const endedAt = workoutEndedAt(fm, settings);
    return [...new Set([
      dateKey(fm.date || fm.workoutDate || startedAt || endedAt),
      dateKey(fm.date || fm.workoutDate || fm.completedDate || startedAt || endedAt),
    ].filter(Boolean))];
  }
  return [dateKey(fm.date || fm.workoutDate || fm.completedDate || fm.startedAt || fm.endedAt)].filter(Boolean);
}

function wikilinkPath(value: unknown): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]$/u);
  const path = String(match?.[1] || raw).trim().replace(/\\/gu, '/');
  return path && !/\.[^/]+$/u.test(path) ? `${path}.md` : path;
}

interface NativeFoodEntryProjection {
  servings: number;
  amount?: number;
  amountUnit?: 'g' | 'ml';
  nutrition: Record<(typeof CORE_NUTRIENT_KEYS)[number], number> & ExtraNutrition;
}

const positiveNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const stableNumber = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const normalizedUnit = (value: unknown): string => String(value || 'serving')
  .trim()
  .toLocaleLowerCase()
  .replace(/\s+/gu, ' ') || 'serving';

const singularUnit = (value: string): string => value.length > 1 && value.endsWith('s') ? value.slice(0, -1) : value;

function metricAmount(quantity: number, unit: string): { amount: number; unit: 'g' | 'ml' } | null {
  if (['g', 'gram', 'grams'].includes(unit)) return { amount: quantity, unit: 'g' };
  if (['ml', 'milliliter', 'milliliters'].includes(unit)) return { amount: quantity, unit: 'ml' };
  if (['oz', 'ounce', 'ounces'].includes(unit)) return { amount: quantity * 28.3495, unit: 'g' };
  if (['fl oz', 'fluid ounce', 'fluid ounces'].includes(unit)) return { amount: quantity * 29.5735, unit: 'ml' };
  if (['cup', 'cups'].includes(unit)) return { amount: quantity * 240, unit: 'ml' };
  return null;
}

function foodMetricServing(food: Record<string, unknown>): { amount: number; unit: 'g' | 'ml' } | null {
  const authored = authoredMetricServing(food);
  if (authored) return authored;
  const grams = positiveNumber(food.servingGrams);
  if (grams) return { amount: grams, unit: 'g' };
  const ml = positiveNumber(food.servingMl);
  if (ml) return { amount: ml, unit: 'ml' };
  const amount = positiveNumber(food.servingAmount, 1);
  return metricAmount(amount, normalizedUnit(food.servingUnit));
}

function foodEntryPortion(
  entry: Record<string, unknown>,
  food: Record<string, unknown>,
): Pick<NativeFoodEntryProjection, 'servings' | 'amount' | 'amountUnit'> | null {
  if (entry.quantity == null || String(entry.quantity).trim() === '') return null;
  const quantity = Number(entry.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  const unit = normalizedUnit(entry.unit);
  const metricServing = foodMetricServing(food);
  const directMetric = metricAmount(quantity, unit);
  const servingAmount = positiveNumber(food.servingAmount, 1);
  const servingUnit = normalizedUnit(food.servingUnit);
  const sameServingUnit = unit === servingUnit || singularUnit(unit) === singularUnit(servingUnit);
  let servings = 0;
  let amount: number | undefined;
  let amountUnit: 'g' | 'ml' | undefined;
  if (unit === 'serving' || sameServingUnit) {
    servings = sameServingUnit ? quantity / servingAmount : quantity;
    if (metricServing) {
      amount = servings * metricServing.amount;
      amountUnit = metricServing.unit;
    }
  } else if (directMetric) {
    if (!metricServing || directMetric.unit !== metricServing.unit) return null;
    servings = directMetric.amount / metricServing.amount;
    amount = directMetric.amount;
    amountUnit = directMetric.unit;
  } else {
    return null;
  }
  if (!Number.isFinite(servings) || servings < 0) return null;
  return { servings, amount, amountUnit };
}

function foodProjectionInputsUnchanged(
  previous: Record<string, unknown> | undefined,
  current: Record<string, unknown>,
): boolean {
  if (!previous) return false;
  for (const key of ['servingAmount', 'servingUnit', 'servingGrams', 'servingMl', ...CORE_NUTRIENT_KEYS, ...EXTRA_NUTRIENT_KEYS]) {
    const value = current[key];
    // The existing shallow definition snapshot cannot prove that a reused
    // nested value is unchanged. Only exact scalar equality can skip work.
    if ((value !== null && typeof value === 'object') || typeof value === 'function'
      || !Object.is(previous[key], value)) return false;
  }
  return true;
}

/**
 * Derive a native food-entry's nutrition from its linked food definition and
 * authored consumption amount. The entry never owns an independent macro
 * value; persisted macro fields are only Base-compatible projections.
 */
export function deriveNativeFoodEntryProjection(
  entry: Record<string, unknown>,
  food: Record<string, unknown>,
): NativeFoodEntryProjection | null {
  const portion = foodEntryPortion(entry, food);
  if (!portion) return null;
  const { servings, amount, amountUnit } = portion;
  const nutrition = Object.fromEntries(CORE_NUTRIENT_KEYS.map((key) => (
    [key, stableNumber(numberValue(food[key]) * servings)]
  ))) as NativeFoodEntryProjection['nutrition'];
  Object.assign(nutrition, extraNutrition(food, servings));
  return {
    servings: stableNumber(servings),
    amount: amount == null ? undefined : stableNumber(amount),
    amountUnit,
    nutrition,
  };
}

interface HealthDiscoveryPass {
  full: boolean;
  queue: Set<string>;
  sourceFiles: Set<TFile>;
  readyWorkouts: TFile[];
  reconcilePending: boolean;
  resolved: boolean;
  completion: Promise<void>;
  complete: () => void;
  fail: (error: unknown) => void;
  previousStatus: 'loading' | 'partial' | 'ready';
  hadFiles: boolean;
}

/** Incremental frontmatter index plus the narrow GCM native-record bridge. */
export class HealthNativeRecordService {
  readonly version = TPS_HEALTH_NATIVE_RECORDS_VERSION;
  private readonly recordsByPath = new Map<string, IndexedHealthRecord>();
  private readonly pathsByKind = new Map<NativeHealthKind, Set<string>>();
  private readonly pathsByDate = new Map<string, Set<string>>();
  private readonly entryPathsByFoodPath = new Map<string, Set<string>>();
  private readonly foodDefinitionsByPath = new Map<string, Record<string, unknown>>();
  private readonly workoutDataByPath = new Map<string, StoredWorkoutExercise[]>();
  private readonly changeListeners = new Set<(change: NativeHealthRecordChange) => void>();
  private readonly dailyIndexStatusListeners = new Set<() => void>();
  private readonly refreshGenerations = new Map<string, symbol>();
  private readonly workoutMutationQueues = new Map<string, Promise<unknown>>();
  private workoutIndexReady = false;
  private metadataResolved = false;
  private readonly pendingMetadataPaths = new Map<string, TFile>();
  private indexedProvider: NativeRecordsApi | null = null;
  private indexedProviderConfiguration = '';
  // Only the current finite discovery owns continuations. Source events remain
  // incremental and supersede any cached candidate still queued in this pass.
  private discoveryPass: HealthDiscoveryPass | null = null;
  private disposed = false;

  constructor(private readonly plugin: TPSHealthPlugin) {}

  setup(): void {
    this.disposed = false;
    const metadataCache = this.plugin.app.metadataCache;
    const vault = this.plugin.app.vault;
    const metadataInitialized = (metadataCache as unknown as { initialized?: boolean })?.initialized === true;
    // Metadata can already be settled before layout. Only body hydration waits
    // for the workspace; the metadata-ready owner schedules that work once.
    this.workoutIndexReady = metadataInitialized;
    this.metadataResolved = metadataInitialized;
    this.plugin.registerEvent(this.plugin.app.workspace.on('tps:gcm-api-changed' as any, (payload: unknown) => {
      const event = payload as { source?: string; available?: boolean } | null;
      if (this.disposed || event?.source !== 'tps-global-context-menu') return;
      const api = event.available === true ? this.readApi() : null;
      if (api === this.indexedProvider && (!api
        || this.providerConfiguration(api) === this.indexedProviderConfiguration)) return;
      // A provider reload invalidates old reads, not the accepted food data.
      const previousStatus = this.getDailyIndexStatus();
      this.cancelDiscovery();
      this.refreshGenerations.clear();
      this.indexedProvider = null;
      if (api) this.refreshConfiguration(previousStatus);
      else {
        this.plugin.scheduleWorkoutActionBars();
        this.notifyDailyIndexStatusChanged(previousStatus);
      }
    }));
    const discoverOnSetup = () => {
      // A known cold cache cannot establish complete inventory yet. Its first
      // resolved event owns discovery, including files arriving during startup.
      // Unknown private initialization still permits public warm-cache proof.
      if ((metadataCache as unknown as { initialized?: boolean })?.initialized !== false
        || this.plugin.app.workspace?.layoutReady) this.rebuild();
    };
    if (typeof metadataCache?.on !== 'function' || typeof vault?.on !== 'function') {
      discoverOnSetup();
      return;
    }

    this.plugin.registerEvent(metadataCache.on('changed', (file, data, cache) => {
      // The indexed source supersedes reads started before this event. A late
      // cachedRead result must not replace its newer frontmatter or body data.
      // A queued event from an obsolete TFile must not consume a replacement's
      // pending cache path or restore the old record at that path.
      if (vault.getAbstractFileByPath(file.path) !== file) return;
      // An event without either source or cache has not established removal.
      if (!cache && typeof data !== 'string') return;
      const previousStatus = this.getDailyIndexStatus();
      const hadPendingRead = this.refreshGenerations.delete(file.path);
      const wasPending = this.pendingMetadataPaths.delete(file.path);
      let frontmatter: Record<string, unknown> | null = cache?.frontmatter ?? null;
      if (!frontmatter && data) {
        const source = getFrontMatterInfo(data);
        if (source.exists) {
          try {
            const parsed = parseYaml(source.frontmatter);
            frontmatter = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : null;
          } catch {
            // Invalid source frontmatter has no safe native-record identity.
          }
        }
      }
      this.indexFile(file, frontmatter, data);
      if (wasPending && typeof data !== 'string'
        && this.recordsByPath.get(file.path)?.kind === 'workout-session') {
        this.hydrateWorkoutBodiesAfterLayout([file]);
      }
      this.notifyDailyIndexStatusChanged(previousStatus);
      if (hadPendingRead && this.isWorkoutIndexSettled()) this.plugin.scheduleWorkoutActionBars();
    }));
    this.plugin.registerEvent(metadataCache.on('resolved', () => {
      const previousStatus = this.getDailyIndexStatus();
      this.metadataResolved = true;
      // The first cold resolution discovers files added during startup. Later
      // resolutions inspect only paths whose cache was absent in that scan.
      if (this.discoveryPass) {
        this.discoveryPass.reconcilePending = true;
        this.discoveryPass.resolved = true;
      } else if (!this.workoutIndexReady) {
        this.rebuild(true, previousStatus);
        return; // Discovery completion owns readiness and its notification.
      } else if (this.pendingMetadataPaths.size > 0) {
        this.reconcilePendingMetadata(previousStatus);
        return;
      }
      this.notifyDailyIndexStatusChanged(previousStatus);
      this.plugin.scheduleWorkoutActionBars();
    }));
    this.plugin.registerEvent(vault.on('create', (file) => {
      if (file instanceof TFile && file.extension === 'md') this.discoveryPass?.queue.add(file.path);
      // A synced active-workout file can arrive before its metadata. Keep its
      // saved pointer guarded without reading every newly discovered note.
      if (this.plugin.app.workspace?.layoutReady && file instanceof TFile
        && file.path === this.plugin.settings.activeWorkoutPath) void this.refreshFile(file);
    }));
    this.plugin.registerEvent(vault.on('modify', (file) => {
      // Metadata owns external discovery. Only already-known Health sources
      // need the in-flight guard before that event arrives; ordinary editing
      // must not enter the file queue or disable workout controls.
      if (file instanceof TFile && (
        this.recordsByPath.has(file.path) || this.entryPathsByFoodPath.has(file.path)
        || file.path === this.plugin.settings.activeWorkoutPath
      )) void this.refreshFile(file);
    }));
    this.plugin.registerEvent(vault.on('delete', (file) => {
      if (file instanceof TFile) {
        // A queued delete for an obsolete object must not remove a different
        // file that has since appeared at the same path.
        const current = vault.getAbstractFileByPath(file.path);
        if (current instanceof TFile && current !== file) return;
        const previousStatus = this.getDailyIndexStatus();
        this.pendingMetadataPaths.delete(file.path);
        const hadPendingRead = this.refreshGenerations.delete(file.path);
        const deleted = this.recordsByPath.get(file.path);
        const legacyChildren = deleted?.kind === 'workout-session'
          ? this.getWorkoutExerciseRecords(deleted)
          : [];
        this.foodDefinitionsByPath.delete(file.path);
        this.workoutDataByPath.delete(file.path);
        this.removePath(file.path);
        this.notifyDailyIndexStatusChanged(previousStatus);
        if (hadPendingRead && this.isWorkoutIndexSettled()) this.plugin.scheduleWorkoutActionBars();
        if (legacyChildren.length) void this.trashLegacyWorkoutChildren(deleted!, legacyChildren, 'health-workout-delete');
      }
    }));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
      // A stale rename must not move a different file now occupying oldPath.
      const current = vault.getAbstractFileByPath(oldPath);
      if (current instanceof TFile && current !== file) return;
      const previousStatus = this.getDailyIndexStatus();
      const wasPending = this.pendingMetadataPaths.delete(oldPath);
      if (wasPending && file instanceof TFile) this.pendingMetadataPaths.set(file.path, file);
      this.refreshGenerations.delete(oldPath);
      const wasHealthSource = this.recordsByPath.has(oldPath) || this.entryPathsByFoodPath.has(oldPath)
        || oldPath === this.plugin.settings.activeWorkoutPath || file.path === this.plugin.settings.activeWorkoutPath;
      this.foodDefinitionsByPath.delete(oldPath);
      const workoutData = this.workoutDataByPath.get(oldPath);
      this.workoutDataByPath.delete(oldPath);
      if (workoutData && file instanceof TFile) this.workoutDataByPath.set(file.path, workoutData);
      this.removePath(oldPath);
      this.notifyDailyIndexStatusChanged(previousStatus);
      // Obsidian does not emit metadata changed on rename. Preserve that
      // explicit refresh for Health files without reading unrelated notes.
      if (file instanceof TFile) {
        if (wasHealthSource) {
          this.discoveryPass?.sourceFiles.add(file);
          void this.refreshFile(file);
        } else if (file.extension === 'md') this.discoveryPass?.queue.add(file.path);
      }
    }));
    // Register incremental ownership before the first discovery can yield.
    discoverOnSetup();
  }

  isEnabled(): boolean {
    // The persisted legacy value only marks an install that needs an explicit
    // copy-only history review. New writes always use whole-note records.
    return !this.disposed;
  }

  getDailyIndexStatus(): 'loading' | 'partial' | 'ready' {
    if (this.disposed) return 'loading';
    if (!this.metadataResolved || !this.indexedProvider || this.discoveryPass) {
      return this.recordsByPath.size > 0 ? 'partial' : 'loading';
    }
    return this.pendingMetadataPaths.size > 0 ? 'partial' : 'ready';
  }

  onDailyIndexStatusChanged(listener: () => void): () => void {
    this.dailyIndexStatusListeners.add(listener);
    return () => this.dailyIndexStatusListeners.delete(listener);
  }

  private notifyDailyIndexStatusChanged(previousStatus: 'loading' | 'partial' | 'ready'): void {
    if (previousStatus === this.getDailyIndexStatus()) return;
    for (const listener of this.dailyIndexStatusListeners) listener();
  }

  async waitForWorkoutIndexSettled(timeoutMs = 3000): Promise<boolean> {
    // A layout save itself emits file events. Let that bounded in-flight work
    // finish before checking identity; never bypass startup or ambiguity guards.
    if (this.disposed || !this.indexedProvider
      || (!this.workoutIndexReady && !this.discoveryPass?.full)) return false;
    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && !this.isWorkoutIndexSettled() && Date.now() < deadline) {
      await new Promise<void>(resolve => globalThis.setTimeout(resolve, 50));
    }
    return this.isWorkoutIndexSettled();
  }

  isWorkoutIndexSettled(): boolean {
    return !this.disposed && this.workoutIndexReady && this.indexedProvider !== null
      && !this.discoveryPass?.full && this.refreshGenerations.size === 0;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelDiscovery();
    this.refreshGenerations.clear();
    this.pendingMetadataPaths.clear();
  }

  refreshConfiguration(previousStatus = this.getDailyIndexStatus()): void {
    this.refreshGenerations.clear();
    this.rebuild(false, previousStatus);
    this.notifyDailyIndexStatusChanged(previousStatus);
  }

  onRecordsChanged(listener: (change: NativeHealthRecordChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  requireApi(): NativeRecordsApi {
    const api = this.plugin.getGcmNativeRecordsApi();
    const requiredMethods = ['isEnabled', 'create', 'resolve', 'update', 'inspect'] as const;
    if (
      !api
      || api.version !== 6
      || requiredMethods.some((method) => typeof api[method] !== 'function')
      || api.isEnabled() !== true
    ) {
      throw new Error('TPS Health native records require TPS GCM native-record mode and nativeRecords API v6.');
    }
    if (hasCustomNativeKindValues(this.plugin.settings) && api.capabilities?.customKinds !== true) {
      throw new Error('Custom Health record kind values require a TPS GCM native-record build with custom-kind support.');
    }
    return api as NativeRecordsApi;
  }

  private canonicalHandle(handle: RawNativeRecordHandle | null): NativeRecordHandle | null {
    if (!handle) return null;
    const kind = canonicalNativeKind(this.plugin.settings, handle.kind);
    if (!kind) return null;
    return {
      ...handle,
      kind,
      frontmatter: decodeNativeRecordFrontmatter(this.plugin.settings, handle.frontmatter),
    };
  }

  private async resolveRecord(
    reference: string | TFile | { path?: string; id?: string; tpsId?: string },
  ): Promise<NativeRecordHandle | null> {
    return this.canonicalHandle(await this.requireApi().resolve(reference));
  }

  private async createRecord(
    kind: NativeHealthKind,
    properties: Record<string, unknown>,
    options?: Record<string, unknown>,
    freshIdentity = false,
  ): Promise<NativeRecordHandle> {
    const api = this.requireApi();
    const configuredKind = configuredNativeKind(this.plugin.settings, kind);
    const classifier = this.plugin.getGcmApi?.()?.frontmatterKinds;
    if (classifier?.version === 2 && (!classifier.definition?.(configuredKind) || classifier.writerEnabled?.(configuredKind) !== true)) {
      throw new Error(`Configure and enable the ${configuredKind} kind writer in TPS GCM before creating this Health record.`);
    }
    const useFreshIdentity = freshIdentity && api.capabilities?.freshIdentityCreates === true && typeof api.createFresh === 'function';
    const createOptions = { ...options };
    if (useFreshIdentity) delete createOptions.id;
    const created = await (useFreshIdentity ? api.createFresh! : api.create).call(api,
      configuredKind,
      encodeNativeRecordProperties(this.plugin.settings, properties),
      createOptions,
    );
    const canonical = this.canonicalHandle(created);
    if (!canonical) throw new Error(`TPS GCM returned an unrecognized Health record kind for ${kind}.`);
    return canonical;
  }

  private async updateRecord(
    reference: string | TFile | { path?: string; id?: string; tpsId?: string },
    updates: Record<string, unknown>,
    cause?: Record<string, unknown>,
  ): Promise<NativeRecordHandle | null> {
    return this.canonicalHandle(await this.requireApi().update(
      reference,
      encodeNativeRecordProperties(this.plugin.settings, updates),
      cause,
    ));
  }

  private async serializeWorkoutSessionMutation<T>(
    initialSession: NativeRecordHandle,
    surface: string,
    mutation: (session: NativeRecordHandle) => Promise<T>,
  ): Promise<T> {
    const queuePath = initialSession.file.path;
    const previous = this.workoutMutationQueues.get(queuePath) || Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await this.waitForFullDiscovery();
        if (this.disposed) throw new Error('Health native records are unloaded.');
        const session = await this.resolveRecord({
          path: initialSession.file.path,
          id: initialSession.id,
        });
        if (this.discoveryPass?.full) {
          await this.waitForFullDiscovery();
          if (this.disposed) throw new Error('Health native records are unloaded.');
          attempt -= 1;
          continue; // Resolve identity again under the completed index/config.
        }
        if (!session || session.kind !== 'workout-session') {
          throw new Error('Native workout session was not found.');
        }
        try {
          return await mutation(session);
        } catch (error) {
          if (!(error instanceof WorkoutSessionConflictError) || attempt >= 2) throw error;
          logger.flowWarn('WorkoutStorage', 'mutation:retry', {
            path: session.path,
            surface,
            attempt: attempt + 1,
          });
        }
      }
      throw new Error('Workout session kept changing before the mutation could be saved.');
    });
    this.workoutMutationQueues.set(queuePath, run);
    try {
      return await run;
    } finally {
      if (this.workoutMutationQueues.get(queuePath) === run) this.workoutMutationQueues.delete(queuePath);
    }
  }

  async createFoodEntry(entry: FoodLogEntry): Promise<NativeRecordHandle> {
    const nutrition = entry.nutritionOverride || entry.item.nutrition || {};
    const authoredQuantity = positiveNumber(entry.servingQuantity, entry.quantity);
    const authoredUnit = String(entry.servingUnit || entry.unit || 'serving').trim() || 'serving';
    const properties = compactRecordProperties({
      title: entry.item.name,
      tags: normalizeFoodLogTags(entry.tags),
      completedDate: entry.completedDate || entry.createdDate,
      food: this.recordLink(entry.item.sourcePath),
      quantity: authoredQuantity,
      unit: authoredUnit,
      ...foodNutritionStorageValues(nutrition),
      note: entry.note,
    });
    const projected = this.projectFoodEntry(properties, entry.item.sourcePath || '');
    if (projected) Object.assign(properties, foodNutritionStorageValues(projected.frontmatter, true));
    const api = this.requireApi();
    const record = await this.createRecord('food-entry', compactRecordProperties(properties), {
      id: entry.id,
      now: new Date(entry.createdDate),
      fileName: Number(api.version) >= 3 ? buildNativeHealthRecordFileName('food-entry', properties) : undefined,
      cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-food-log' },
    }, true);
    entry.id = record.id;
    this.trackHandle(record);
    return record;
  }

  async createActivityEntry(entry: ActivityLogEntry): Promise<NativeRecordHandle> {
    const properties = compactRecordProperties({
      title: entry.activity,
      activityType: entry.activityType,
      startedAt: entry.startedAt !== entry.completedDate ? entry.startedAt : undefined,
      completedDate: entry.completedDate,
      durationMinutes: entry.durationMinutes,
      distance: entry.distance,
      distanceUnit: entry.distanceUnit,
      steps: entry.steps,
      caloriesBurned: entry.caloriesBurned,
      source: entry.source && entry.source !== 'manual' ? entry.source : undefined,
      device: entry.device,
      note: entry.note,
    });
    const api = this.requireApi();
    const record = await this.createRecord('activity-entry', properties, {
      id: entry.id,
      now: new Date(entry.startedAt),
      fileName: Number(api.version) >= 3 ? buildNativeHealthRecordFileName('activity-entry', properties) : undefined,
      cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-activity-log' },
    }, true);
    entry.id = record.id;
    this.trackHandle(record);
    return record;
  }

  async createWorkoutSession(properties: Record<string, unknown>, recordId: string): Promise<NativeRecordHandle> {
    const startedAt = String(properties.startedAt || new Date().toISOString());
    const recordProperties = compactRecordProperties({
      title: properties.title,
      status: 'active',
      workoutPlan: this.recordLink(properties.workoutPlan || properties.workoutPlanPath),
      caloriesBurned: properties.caloriesBurned,
      session: workoutSessionPropertyValue([]),
      ...workoutTemporalPropertyUpdates(this.plugin.settings, {}, {
        startedAt, durationMinutes: this.plugin.settings.defaultWorkoutEstimateMinutes || 60,
      }),
    });
    const api = this.requireApi();
    const record = await this.createRecord('workout-session', recordProperties, {
      id: recordId,
      now: new Date(startedAt),
      fileName: Number(api.version) >= 3
        ? buildNativeHealthRecordFileName('workout-session', {
          ...recordProperties,
          workoutDate: properties.workoutDate,
          startedAt,
        })
        : undefined,
      cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-start' },
    }, true);
    this.workoutDataByPath.set(record.path, []);
    this.trackHandle(record);
    return record;
  }

  async appendWorkoutSet(sessionReference: string | TFile, set: WorkoutSet): Promise<{ session: NativeRecordHandle; exercise: NativeRecordHandle }> {
    const initialSession = await this.resolveRecord(sessionReference);
    if (!initialSession || initialSession.kind !== 'workout-session') throw new Error('Active native workout session was not found.');
    const exerciseName = String(set.exercise || '').trim();
    if (!exerciseName) throw new Error('Workout exercise name is required.');
    return this.serializeWorkoutSessionMutation(initialSession, 'health-workout-set', async (session) => {
      const { exercises: priorExercises, legacyChildren, markerState } = await this.workoutExercisesForWrite(session);
      const exerciseKey = exerciseName.toLocaleLowerCase();
      let targetIndex = priorExercises.findIndex((exercise) => exercise.name.toLocaleLowerCase() === exerciseKey);
      const exercises = cloneStoredWorkoutExercises(priorExercises);
      if (targetIndex < 0) {
        exercises.push({
          id: `workout-exercise-${stableHash(`${session.id}\u0000${exerciseKey}`)}`,
          name: exerciseName,
          exercisePath: wikilinkPath(set.exercisePath),
          sets: [],
        });
        targetIndex = exercises.length - 1;
      }
      const definitionPath = wikilinkPath(set.exercisePath) || exercises[targetIndex].exercisePath;
      if (!definitionPath) throw new Error('A reusable exercise note is required before logging its workout sets.');
      exercises[targetIndex].exercisePath = definitionPath;
      const matchingSets = exercises.flatMap((exercise) => exercise.sets.filter((storedSet) => (
        String(storedSet.id || '').trim() === String(set.id || '').trim()
      )));
      if (!matchingSets.length) exercises[targetIndex].sets.push({ ...set });
      else if (matchingSets.length !== 1) throw new Error('Workout set identity was ambiguous.');
      const updatedSession = await this.updateWorkoutSessionData(
        session,
        exercises,
        {},
        'health-workout-set',
        markerState,
      );
      if (!updatedSession) throw new Error('Workout session changed before the set could be saved.');
      this.trackHandle(updatedSession);
      if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updatedSession, legacyChildren, 'health-workout-storage-upgrade');
      return { session: updatedSession, exercise: this.embeddedExerciseHandle(updatedSession, exercises[targetIndex]) };
    });
  }

  async updateWorkoutSet(
    exerciseReference: string | TFile,
    setId: string,
    patch: NativeWorkoutSetPatch,
  ): Promise<NativeRecordHandle> {
    const reference = await this.resolveRecord(exerciseReference);
    const initialSession = reference?.kind === 'workout-session'
      ? reference
      : reference?.kind === 'workout-exercise'
        ? this.findWorkoutSessionHandleForExercise(reference)
        : null;
    if (!initialSession) throw new Error('Workout session was not found.');
    const expectedSetId = String(setId || '').trim();
    if (!expectedSetId) throw new Error('Workout set identity was missing.');
    return this.serializeWorkoutSessionMutation(initialSession, 'health-workout-set-inline', async (session) => {
      const { exercises: priorExercises, legacyChildren, markerState } = await this.workoutExercisesForWrite(session);
      const matches = priorExercises.flatMap((exercise, exerciseIndex) => exercise.sets.flatMap((storedSet, setIndex) => (
        String(storedSet.id || '') === expectedSetId ? [{ exerciseIndex, setIndex }] : []
      )));
      if (matches.length !== 1) throw new Error(matches.length ? 'Workout set identity was ambiguous.' : 'Workout set was not found.');
      const { exerciseIndex, setIndex } = matches[0];
      const exercises = cloneStoredWorkoutExercises(priorExercises);
      const nextSet = { ...exercises[exerciseIndex].sets[setIndex] };
      if (patch.reps !== undefined) nextSet.reps = Math.max(0, numberValue(patch.reps));
      if (patch.weight !== undefined) nextSet.weight = Math.max(0, numberValue(patch.weight));
      if (patch.weightUnit !== undefined) nextSet.weightUnit = String(patch.weightUnit || '').trim() || 'lb';
      if (patch.perArm !== undefined) nextSet.perArm = patch.perArm === true;
      if (Object.prototype.hasOwnProperty.call(patch, 'rpe')) {
        if (patch.rpe == null) delete nextSet.rpe;
        else nextSet.rpe = Math.min(10, Math.max(0, numberValue(patch.rpe)));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'restSeconds')) {
        if (patch.restSeconds == null) delete nextSet.restSeconds;
        else nextSet.restSeconds = Math.max(0, Math.round(numberValue(patch.restSeconds)));
      }
      if (patch.setType !== undefined) {
        const setType = String(patch.setType || '').trim().toLowerCase();
        if (!['normal', 'warmup', 'drop', 'failure'].includes(setType)) throw new Error('Workout set type was not supported.');
        nextSet.setType = setType;
      }
      if (patch.completed !== undefined) {
        const priorCompletedAt = String(nextSet.completedDate || nextSet.endedAt || '').trim();
        if (patch.completed) {
          const completedAt = priorCompletedAt || new Date().toISOString();
          nextSet.completedDate = completedAt;
          nextSet.endedAt = completedAt;
        } else {
          delete nextSet.completedDate;
          delete nextSet.endedAt;
          if (priorCompletedAt) {
            for (const candidate of exercises.flatMap((exercise) => exercise.sets)) {
              if (String(candidate.restStartedAt || '').trim() === priorCompletedAt) delete candidate.restStartedAt;
            }
          }
        }
      }
      exercises[exerciseIndex].sets[setIndex] = nextSet;
      const updated = await this.updateWorkoutSessionData(
        session,
        exercises,
        {},
        'health-workout-set-inline',
        markerState,
      );
      if (!updated) throw new Error('Workout session changed before the set edit could be saved.');
      this.trackHandle(updated);
      if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
      return updated;
    });
  }

  async deleteWorkoutSet(sessionReference: string | TFile, exerciseId: string, setId: string): Promise<NativeRecordHandle> {
    if (!exerciseId || !setId) throw new Error('Workout set identity was missing.');
    return this.mutateWorkoutStructure(sessionReference, 'health-workout-delete-set', (exercises) => {
      const matches = exercises.flatMap(exercise => exercise.sets
        .filter(set => set.id === setId).map(set => ({ exercise, set })));
      if (matches.length !== 1 || matches[0].exercise.id !== exerciseId) {
        throw new Error('Workout set was missing or ambiguous.');
      }
      const { exercise, set } = matches[0];
      const completedAt = String(set.completedDate || set.endedAt || '').trim();
      exercise.sets = exercise.sets.filter(candidate => candidate.id !== setId);
      clearSingletonDropSets(exercise);
      if (completedAt) for (const candidate of exercises.flatMap(item => item.sets)) {
        if (candidate.restStartedAt === completedAt) delete candidate.restStartedAt;
      }
    });
  }

  async removeWorkoutExercise(
    sessionReference: string | TFile,
    exerciseId: string,
    expectedSessionId?: string,
  ): Promise<NativeRecordHandle> {
    const expectedExerciseId = String(exerciseId || '').trim();
    if (!expectedExerciseId) throw new Error('Workout exercise identity was missing.');
    return this.mutateWorkoutStructure(sessionReference, 'health-workout-remove-exercise', (exercises) => {
      const matches = exercises.filter(exercise => exercise.id === expectedExerciseId);
      if (matches.length !== 1) throw new Error('Workout exercise was missing or ambiguous.');
      const removed = matches[0];
      const completedTimes = new Set(removed.sets
        .map(set => String(set.completedDate || set.endedAt || '').trim()).filter(Boolean));
      exercises.splice(exercises.indexOf(removed), 1);
      if (removed.supersetGroupId) clearSingletonSupersets(
        exercises.filter(exercise => exercise.supersetGroupId === removed.supersetGroupId),
      );
      for (const exercise of exercises) for (const set of exercise.sets) {
        if (typeof set.restStartedAt === 'string' && completedTimes.has(set.restStartedAt)) delete set.restStartedAt;
      }
    }, { resolveDefinitions: false, requireActive: true, expectedSessionId });
  }

  async addPlannedWorkoutSet(sessionReference: string | TFile, exerciseId: string): Promise<NativeRecordHandle> {
    const expectedExerciseId = String(exerciseId || '').trim();
    if (!expectedExerciseId) throw new Error('Workout exercise identity was missing.');
    return this.mutateWorkoutStructure(sessionReference, 'health-workout-add-set', (exercises) => {
      const exercise = exercises.find((candidate) => candidate.id === expectedExerciseId);
      if (!exercise) throw new Error('Workout exercise was not found.');
      const previous = exercise.sets.at(-1);
      exercise.sets.push({
        id: id('set'),
        reps: previous?.reps,
        weight: previous?.weight,
        weightUnit: String(previous?.weightUnit || previous?.unit || 'lb').trim() || 'lb',
        perArm: previous?.perArm === true,
        rpe: previous?.rpe,
        restSeconds: previous?.restSeconds,
        setType: 'normal',
      });
    });
  }

  async reorderWorkoutExercise(
    sessionReference: string | TFile,
    exerciseId: string,
    direction: -1 | 1,
  ): Promise<NativeRecordHandle> {
    const expectedExerciseId = String(exerciseId || '').trim();
    if (!expectedExerciseId) throw new Error('Workout exercise identity was missing.');
    return this.mutateWorkoutStructure(sessionReference, 'health-workout-reorder-exercise', (exercises) => {
      const currentIndex = exercises.findIndex((exercise) => exercise.id === expectedExerciseId);
      if (currentIndex < 0) throw new Error('Workout exercise was not found.');
      const nextIndex = Math.max(0, Math.min(exercises.length - 1, currentIndex + direction));
      if (nextIndex === currentIndex) return;
      const [exercise] = exercises.splice(currentIndex, 1);
      exercises.splice(nextIndex, 0, exercise);
    });
  }

  async setWorkoutSupersetLinks(
    sessionReference: string | TFile,
    exerciseId: string,
    selectedExerciseIds: string[],
  ): Promise<NativeRecordHandle> {
    const expectedExerciseId = String(exerciseId || '').trim();
    if (!expectedExerciseId) throw new Error('Workout exercise identity was missing.');
    return this.mutateWorkoutStructure(sessionReference, 'health-workout-superset', (exercises, session) => {
      const current = exercises.find((exercise) => exercise.id === expectedExerciseId);
      if (!current) throw new Error('Workout exercise was not found.');
      const currentGroupId = current.supersetGroupId;
      const selected = new Set([expectedExerciseId, ...selectedExerciseIds.map((value) => String(value || '').trim())].filter(Boolean));
      const validSelected = new Set(exercises.filter((exercise) => selected.has(exercise.id)).map((exercise) => exercise.id));
      const touchedGroups = new Set<string>();
      if (current.supersetGroupId) touchedGroups.add(current.supersetGroupId);
      for (const exercise of exercises) {
        if (validSelected.has(exercise.id) && exercise.supersetGroupId) touchedGroups.add(exercise.supersetGroupId);
      }
      for (const exercise of exercises) {
        if (exercise.supersetGroupId && touchedGroups.has(exercise.supersetGroupId)) delete exercise.supersetGroupId;
      }
      if (validSelected.size > 1) {
        const groupId = currentGroupId
          || nextStoredWorkoutGroupId(exercises.map((exercise) => exercise.supersetGroupId || ''), 'super');
        for (const exercise of exercises) if (validSelected.has(exercise.id)) exercise.supersetGroupId = groupId;
        logger.flow('WorkoutStorage', 'superset:linked', { workoutId: session.id, exerciseId: expectedExerciseId, members: validSelected.size, groupId });
      }
      clearSingletonSupersets(exercises);
    });
  }

  async setWorkoutDropSetLinks(
    sessionReference: string | TFile,
    exerciseId: string,
    setId: string,
    selectedSetIds: string[],
    addNewSet = false,
  ): Promise<NativeRecordHandle> {
    const expectedExerciseId = String(exerciseId || '').trim();
    const expectedSetId = String(setId || '').trim();
    if (!expectedExerciseId || !expectedSetId) throw new Error('Workout drop-set identity was missing.');
    return this.mutateWorkoutStructure(sessionReference, 'health-workout-drop-set', (exercises, session) => {
      const exercise = exercises.find((candidate) => candidate.id === expectedExerciseId);
      if (!exercise) throw new Error('Workout exercise was not found.');
      const current = exercise.sets.find((set) => String(set.id || '').trim() === expectedSetId);
      if (!current) throw new Error('Workout set was not found.');
      const selected = new Set([expectedSetId, ...selectedSetIds.map((value) => String(value || '').trim())].filter(Boolean));
      const validIds = new Set(exercise.sets.map((set) => String(set.id || '').trim()).filter(Boolean));
      const touchedGroups = new Set<string>();
      const currentGroupId = String(current.dropSetGroupId || '').trim();
      if (currentGroupId) touchedGroups.add(currentGroupId);
      for (const set of exercise.sets) {
        const candidateId = String(set.id || '').trim();
        const groupId = String(set.dropSetGroupId || '').trim();
        if (selected.has(candidateId) && groupId) touchedGroups.add(groupId);
      }
      for (const set of exercise.sets) {
        const groupId = String(set.dropSetGroupId || '').trim();
        if (!groupId || !touchedGroups.has(groupId)) continue;
        delete set.dropSetGroupId;
        if (String(set.setType || '').trim().toLowerCase() === 'drop') set.setType = 'normal';
      }
      for (const candidateId of [...selected]) if (!validIds.has(candidateId)) selected.delete(candidateId);
      if (addNewSet) {
        const addedId = id('set');
        exercise.sets.push({
          id: addedId,
          reps: current.reps,
          weight: current.weight,
          weightUnit: String(current.weightUnit || current.unit || 'lb').trim() || 'lb',
          perArm: current.perArm === true,
          rpe: current.rpe,
          restSeconds: current.restSeconds,
          setType: 'drop',
        });
        selected.add(addedId);
      }
      if (selected.size > 1) {
        const groupId = currentGroupId || nextStoredWorkoutGroupId(
          exercise.sets.map((set) => String(set.dropSetGroupId || '').trim()),
          'drop',
        );
        for (const set of exercise.sets) {
          const candidateId = String(set.id || '').trim();
          if (!selected.has(candidateId)) continue;
          set.dropSetGroupId = groupId;
          if (candidateId !== expectedSetId) set.setType = 'drop';
        }
        if (String(current.setType || '').trim().toLowerCase() === 'drop') current.setType = 'normal';
        logger.flow('WorkoutStorage', 'drop-set:linked', { workoutId: session.id, exerciseId: expectedExerciseId, setId: expectedSetId, members: selected.size, groupId });
      }
      clearSingletonDropSets(exercise);
    });
  }

  private async mutateWorkoutStructure(
    sessionReference: string | TFile,
    surface: string,
    mutation: (exercises: StoredWorkoutExercise[], session: NativeRecordHandle) => void,
    options: { resolveDefinitions?: boolean; requireActive?: boolean; expectedSessionId?: string } = {},
  ): Promise<NativeRecordHandle> {
    const initialSession = await this.resolveRecord(sessionReference);
    if (!initialSession || initialSession.kind !== 'workout-session') throw new Error('Workout session was not found.');
    const expectedSessionId = options.expectedSessionId || initialSession.id;
    if (options.requireActive && initialSession.id !== expectedSessionId) throw new Error('Workout session identity changed.');
    return this.serializeWorkoutSessionMutation(initialSession, surface, async (session) => {
      const { exercises: priorExercises, legacyChildren, markerState, authoritativeSession } = await this.workoutExercisesForWrite(
        session, undefined, options.resolveDefinitions !== false, options.requireActive ? expectedSessionId : undefined,
      );
      const exercises = cloneStoredWorkoutExercises(priorExercises);
      const currentSession = options.requireActive ? authoritativeSession : session;
      mutation(exercises, currentSession);
      const updated = await this.updateWorkoutSessionData(currentSession, exercises, {}, surface, markerState,
        options.requireActive ? expectedSessionId : undefined);
      if (!updated) throw new Error('Workout session changed before the workout could be updated.');
      this.trackHandle(updated);
      if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
      return updated;
    });
  }

  private async updateWorkoutSessionData(
    session: NativeRecordHandle,
    exercises: StoredWorkoutExercise[],
    updates: Record<string, unknown>,
    surface: string,
    expectedStorageState: string | null,
    expectedActiveSessionId?: string,
  ): Promise<NativeRecordHandle | null> {
    const beforeContent = await this.plugin.app.vault.read(session.file);
    if (this.disposed || this.discoveryPass?.full) throw new WorkoutSessionConflictError();
    if (expectedActiveSessionId) this.assertActiveWorkoutSource(workoutFrontmatterFromContent(beforeContent), expectedActiveSessionId);
    const currentStorageState = workoutStorageStateFromContent(beforeContent, this.plugin.settings);
    if (currentStorageState !== expectedStorageState) throw new WorkoutSessionConflictError();
    const legacyMarker = workoutDataMarkerState(beforeContent);
    const nextValues = encodeNativeRecordProperties(
      this.plugin.settings,
      workoutSessionDataUpdates(exercises, updates, session.frontmatter, this.plugin.settings),
    );
    let conflict = false;
    let committedFrontmatter: Record<string, unknown> | null = null;
    await this.plugin.app.fileManager.processFrontMatter(session.file, (frontmatter) => {
      const current = frontmatter as Record<string, unknown>;
      if (expectedActiveSessionId) this.assertActiveWorkoutSource(current, expectedActiveSessionId);
      if (this.disposed || this.discoveryPass?.full
        || workoutStorageState(decodeNativeRecordFrontmatter(this.plugin.settings, current), legacyMarker) !== expectedStorageState) {
        conflict = true;
        return;
      }
      for (const [key, value] of Object.entries(nextValues)) {
        if (value == null) delete current[key];
        else current[key] = value;
      }
      current.modifiedDate = new Date().toISOString();
      committedFrontmatter = { ...current };
    });
    if (conflict) throw new WorkoutSessionConflictError();
    if (!committedFrontmatter) return null;
    this.workoutDataByPath.set(session.file.path, cloneStoredWorkoutExercises(exercises));
    if (legacyMarker) {
      let markerConflict = false;
      await this.plugin.app.vault.process(session.file, (content) => {
        const currentMarker = workoutDataMarkerState(content);
        if (!currentMarker) return content;
        if (currentMarker !== legacyMarker) {
          markerConflict = true;
          return content;
        }
        return restoreWorkoutDataMarkerState(content, null);
      });
      if (markerConflict) {
        logger.flowWarn('WorkoutStorage', 'legacy-comment:changed', {
          path: session.path,
          surface,
        });
      } else {
        logger.flow('WorkoutStorage', 'legacy-comment:removed', {
          path: session.path,
          surface,
        });
      }
    }
    return await this.resolveRecord({ path: session.path, id: session.id }) || {
      ...session,
      frontmatter: decodeNativeRecordFrontmatter(this.plugin.settings, committedFrontmatter),
    };
  }

  async ensureWorkoutExercise(
    sessionReference: string | TFile | NativeRecordHandle,
    exerciseName: string,
    exercisePath?: string,
  ): Promise<NativeRecordHandle> {
    const resolvedReference = typeof sessionReference === 'object' && sessionReference !== null && 'kind' in sessionReference
      ? (sessionReference as NativeRecordHandle).file
      : sessionReference as string | TFile;
    const initialSession = await this.resolveRecord(resolvedReference);
    if (!initialSession || initialSession.kind !== 'workout-session') throw new Error('Active native workout session was not found.');
    const name = exerciseName.trim();
    if (!name) throw new Error('Workout exercise name is required.');
    return this.serializeWorkoutSessionMutation(initialSession, 'health-workout-exercise', async (session) => {
      const { exercises: priorExercises, legacyChildren, markerState } = await this.workoutExercisesForWrite(session);
      const existingIndex = priorExercises.findIndex((exercise) => exercise.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const existing = existingIndex >= 0 ? priorExercises[existingIndex] : undefined;
      const definitionPath = wikilinkPath(exercisePath) || existing?.exercisePath || '';
      if (!definitionPath) throw new Error('A reusable exercise note is required before adding it to a workout.');
      if (existing && existing.exercisePath === definitionPath && !legacyChildren.length && markerState != null) {
        return this.embeddedExerciseHandle(session, existing);
      }
      const exercises = cloneStoredWorkoutExercises(priorExercises);
      const target = existing || {
        id: `workout-exercise-${stableHash(`${session.id}\u0000${name.toLocaleLowerCase()}`)}`,
        name,
        exercisePath: definitionPath,
        sets: [],
      };
      if (!existing) exercises.push(target);
      else exercises[existingIndex].exercisePath = definitionPath;
      const updated = await this.updateWorkoutSessionData(
        session,
        exercises,
        {},
        'health-workout-exercise',
        markerState,
      );
      if (!updated) throw new Error('Workout session changed before the exercise could be added.');
      this.trackHandle(updated);
      if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
      return this.embeddedExerciseHandle(updated, target);
    });
  }

  async finishWorkout(reference: string | TFile, updates: Record<string, unknown>): Promise<NativeRecordHandle> {
    const initialSession = await this.resolveRecord(reference);
    if (!initialSession || initialSession.kind !== 'workout-session') throw new Error('Native workout session was not found.');
    return this.serializeWorkoutSessionMutation(initialSession, 'health-workout-finish', async (session) => {
      const { exercises, legacyChildren, markerState } = await this.workoutExercisesForWrite(session);
      const updated = await this.updateWorkoutSessionData(session, exercises, {
        ...updates,
        status: 'complete',
      }, 'health-workout-finish', markerState);
      if (!updated) throw new Error('Native workout session was not found.');
      this.trackHandle(updated);
      if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
      return updated;
    });
  }

  async discardWorkout(reference: string | TFile): Promise<NativeRecordHandle> {
    const initialSession = await this.resolveRecord(reference);
    if (!initialSession || initialSession.kind !== 'workout-session') throw new Error('Native workout session was not found.');
    return this.serializeWorkoutSessionMutation(initialSession, 'health-workout-discard', async (session) => {
      const { exercises, legacyChildren, markerState } = await this.workoutExercisesForWrite(session);
      const updated = await this.updateWorkoutSessionData(session, exercises, {
        status: 'discarded', archived: true, archivedDate: null,
      }, 'health-workout-discard', markerState);
      if (!updated) throw new Error('Native workout session was not found.');
      this.trackHandle(updated);
      if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
      return updated;
    });
  }

  findWorkoutExercise(workoutId: string, exercise: string): NativeRecordHandle | null {
    const key = exercise.trim().toLocaleLowerCase();
    const session = this.findWorkoutSession(workoutId);
    if (!session) return null;
    const matches = this.workoutExercisesForRead(session)
      .filter((candidate) => candidate.name.toLocaleLowerCase() === key);
    return matches.length === 1 ? this.embeddedExerciseHandle(this.toHandle(session), matches[0]) : null;
  }

  getWorkoutExerciseNames(workoutId: string): string[] {
    const session = this.findWorkoutSession(workoutId);
    if (!session) return [];
    return this.workoutExercisesForRead(session).map((exercise) => exercise.name);
  }

  planWorkoutStorageConsolidation(): NativeWorkoutStoragePlan {
    const sessions = this.getKindRecords('workout-session');
    const eligible = sessions.map((session) => ({ session, children: this.getWorkoutExerciseRecords(session) }))
      .filter(({ children }) => children.length > 0);
    return {
      sessions: eligible.length,
      childNotes: eligible.reduce((sum, entry) => sum + entry.children.length, 0),
    };
  }

  async consolidateWorkoutStorage(
    resolveDefinition?: WorkoutExerciseDefinitionResolver,
  ): Promise<NativeWorkoutStorageResult> {
    this.requireApi();
    const plan = this.planWorkoutStorageConsolidation();
    let consolidated = 0;
    let trashed = 0;
    let failed = 0;
    const sessions = this.getKindRecords('workout-session').slice()
      .sort((left, right) => left.file.path.localeCompare(right.file.path));
    for (const indexed of sessions) {
      try {
        const result = await this.serializeWorkoutSessionMutation(
          this.toHandle(indexed),
          'health-workout-storage-consolidation',
          async (session) => {
            const current = this.recordsByPath.get(session.path);
            if (!current || current.kind !== 'workout-session') return null;
            const children = this.getWorkoutExerciseRecords(current);
            if (!children.length) return null;
            const { exercises, markerState } = await this.workoutExercisesForWrite(session, resolveDefinition);
            const updated = await this.updateWorkoutSessionData(
              session,
              exercises,
              {},
              'health-workout-storage-consolidation',
              markerState,
            );
            if (!updated) throw new Error('Workout session changed before storage consolidation.');
            this.trackHandle(updated);
            const cleanup = await this.trashLegacyWorkoutChildren(updated, children, 'health-workout-storage-consolidation');
            return cleanup;
          },
        );
        if (!result) continue;
        consolidated += 1;
        trashed += result.trashed;
        failed += result.failed;
      } catch (error) {
        failed += 1;
        logger.flowError('WorkoutStorage', 'consolidate:failed', error, { workoutId: indexed.id, path: indexed.file.path });
      }
    }
    return { ...plan, consolidated, trashed, failed };
  }

  isWorkoutSession(path: string, workoutId = ''): boolean {
    const record = this.recordsByPath.get(path);
    if (!record || record.kind !== 'workout-session') return false;
    const expectedId = workoutId.trim();
    return !expectedId
      || record.id === expectedId
      || String(record.frontmatter.workoutId || '').trim() === expectedId;
  }

  /**
   * Resolve the persisted active-workout pointer without treating an exercise,
   * terminal session, or duplicate stable ID as a live workout. Stable ID is
   * authoritative; a path that points at a different session fails closed.
   */
  resolveWorkoutSession(reference: { id?: string; path?: string }): NativeWorkoutSessionResolution {
    const expectedId = String(reference.id || '').trim();
    const expectedPath = String(reference.path || '').trim();
    const sessions = this.getKindRecords('workout-session');
    const idMatches = expectedId
      ? sessions.filter((record) => record.id === expectedId || String(record.frontmatter.workoutId || '').trim() === expectedId)
      : [];
    const pathMatches = expectedPath
      ? sessions.filter((record) => record.file.path === expectedPath)
      : [];

    if (expectedId && idMatches.length > 1) {
      return emptyWorkoutSessionResolution('ambiguous', idMatches.length, 'duplicate-id');
    }
    if (
      expectedId
      && idMatches.length === 1
      && pathMatches.length === 1
      && idMatches[0].file.path !== pathMatches[0].file.path
    ) {
      return emptyWorkoutSessionResolution('ambiguous', 2, 'identity-conflict');
    }
    if (expectedId && idMatches.length === 0 && pathMatches.length > 0) {
      return emptyWorkoutSessionResolution('ambiguous', pathMatches.length, 'identity-conflict');
    }

    const matches = expectedId ? idMatches : pathMatches;
    if (matches.length > 1) return emptyWorkoutSessionResolution('ambiguous', matches.length, 'duplicate-id');
    if (matches.length === 0) return emptyWorkoutSessionResolution('missing', 0);

    const record = matches[0];
    const status = String(record.frontmatter.status || '').trim().toLocaleLowerCase();
    return {
      state: record.frontmatter.archived === true || status !== 'active' ? 'terminal' : 'active',
      matches: 1,
      id: record.id,
      path: record.file.path,
      title: String(record.frontmatter.title || record.file.basename).trim() || record.file.basename,
      status,
      startedAt: workoutStartedAt(record.frontmatter, this.plugin.settings),
    };
  }

  getWorkoutProgress(workoutId: string): { exerciseCount: number; setCount: number } {
    const snapshot = this.getWorkoutSnapshot(workoutId);
    return {
      exerciseCount: snapshot?.exerciseCount || 0,
      setCount: snapshot?.setCount || 0,
    };
  }

  /**
   * Immutable, index-backed workout projection used by the native session UI.
   * It never reads Markdown bodies and preserves the session's authored
   * exercise order before falling back to stable record identity.
   */
  getWorkoutSnapshot(reference: string): NativeWorkoutSnapshot | null {
    const key = String(reference || '').trim();
    if (!key) return null;
    const sessionMatches = this.getKindRecords('workout-session').filter((record) => (
      record.frontmatter.archived !== true
      && (record.file.path === key || record.id === key || String(record.frontmatter.workoutId || '') === key)
    ));
    if (sessionMatches.length !== 1) return null;
    const session = sessionMatches[0];
    const workoutId = session.id;
    if (!workoutId) return null;
    const exercises = this.workoutExercisesForRead(session).map((exercise): NativeWorkoutExerciseSnapshot => {
      const sets = exercise.sets.map((set, index): NativeWorkoutSetSnapshot => ({
        id: String(set.id || `set-${index + 1}`),
        ordinal: index + 1,
        reps: numberValue(set.reps),
        weight: numberValue(set.weight),
        weightUnit: String(set.weightUnit || set.unit || 'lb').trim() || 'lb',
        perArm: set.perArm === true,
        rpe: set.rpe == null || String(set.rpe).trim() === '' ? undefined : numberValue(set.rpe),
        restSeconds: set.restSeconds == null || String(set.restSeconds).trim() === ''
          ? undefined
          : Math.max(0, Math.round(numberValue(set.restSeconds))),
        setType: String(set.setType || 'normal').trim() || 'normal',
        ...(String(set.dropSetGroupId || '').trim()
          ? { dropSetGroupId: String(set.dropSetGroupId || '').trim() }
          : {}),
        completedDate: String(set.completedDate || set.endedAt || ''),
        restStartedAt: String(set.restStartedAt || ''),
        note: String(set.note || ''),
      }));
      return {
        id: exercise.id,
        path: session.file.path,
        name: exercise.name,
        exercisePath: exercise.exercisePath,
        ...(exercise.supersetGroupId ? { supersetGroupId: exercise.supersetGroupId } : {}),
        totalReps: sets.reduce((sum, set) => sum + set.reps, 0),
        totalVolume: sets.reduce((sum, set) => sum + set.reps * set.weight * (set.perArm ? 2 : 1), 0),
        sets,
      };
    });
    return {
      id: workoutId,
      path: session.file.path,
      title: String(session.frontmatter.title || session.file.basename).trim() || session.file.basename,
      status: String(session.frontmatter.status || 'active').trim().toLowerCase() || 'active',
      startedAt: workoutStartedAt(session.frontmatter, this.plugin.settings),
      endedAt: String(session.frontmatter.status || 'active').trim().toLowerCase() === 'active'
        ? '' : workoutEndedAt(session.frontmatter, this.plugin.settings),
      exerciseCount: exercises.length,
      setCount: exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
      exercises,
    };
  }

  getDailyFoodTotals(dateIso: string): NutritionTotals & { entryCount: number } {
    const records = this.getKindDateRecords('food-entry', dateIso).filter((record) => (
      record.frontmatter.archived !== true && dateKey(record.frontmatter.completedDate || record.frontmatter.date) === dateIso
    ));
    const totals: NutritionTotals = {
      calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0,
      sugarAlcoholG: 0, sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 0,
    };
    for (const record of records) {
      for (const key of CORE_NUTRIENT_KEYS) totals[key] += numberValue(record.frontmatter[key]);
      addExtraNutrition(totals, record.frontmatter);
    }
    return { entryCount: records.length, ...totals };
  }

  async readDailyFoodTotals(dateIso: string): Promise<NutritionTotals & { entryCount: number }> {
    await this.waitForFullDiscovery();
    if (this.disposed) throw new Error('Health native records are unloaded.');
    return this.getDailyFoodTotals(dateIso);
  }

  getDailyFoodEntries(dateIso: string): NativeDailyFoodEntrySnapshot[] {
    return this.getFoodEntriesForPaths(this.getKindDateRecords('food-entry', dateIso)
      .filter(record => dateKey(record.frontmatter.completedDate || record.frontmatter.date) === dateIso)
      .map(record => record.file.path))
      .sort((left, right) => left.completedDate.localeCompare(right.completedDate) || left.title.localeCompare(right.title));
  }

  /** Current whole-note consumption history; library definitions alone are not usage. */
  getFoodUsageEntries(): NativeFoodUsageEntry[] {
    return this.getKindRecords('food-entry')
      .filter(record => record.frontmatter.archived !== true)
      .map(record => {
        const food = this.foodDefinitionForEntry(record.frontmatter, record.file.path);
        const definition = food?.frontmatter;
        return {
          name: String(definition?.title || definition?.name || record.frontmatter.title || record.file.basename).trim(),
          brand: definition?.brand ? String(definition.brand) : undefined,
          barcode: definition?.barcode ? String(definition.barcode) : undefined,
          sourcePath: food?.path || this.resolveFoodSourcePath(foodReference(record.frontmatter), record.file.path) || undefined,
          completedDate: String(record.frontmatter.completedDate || ''),
        };
      });
  }

  /** Project selected food records from the normalized index, without duplicates or archived records. */
  getFoodEntriesForPaths(paths: string[]): (NativeDailyFoodEntrySnapshot & { dateIso: string })[] {
    return [...new Set(paths)].map(path => this.recordsByPath.get(path))
      .filter((record): record is IndexedHealthRecord => !!record && record.kind === 'food-entry' && record.frontmatter.archived !== true)
      .map((record) => ({
        dateIso: dateKey(record.frontmatter.completedDate || record.frontmatter.date) || "",
        id: record.id,
        path: record.file.path,
        title: String(record.frontmatter.title || record.file.basename).trim() || record.file.basename,
        completedDate: String(record.frontmatter.completedDate || ''),
        quantity: numberValue(record.frontmatter.quantity),
        unit: String(record.frontmatter.unit || 'serving').trim() || 'serving',
        calories: numberValue(record.frontmatter.calories),
        proteinG: numberValue(record.frontmatter.proteinG),
        carbsG: numberValue(record.frontmatter.carbsG),
        fatG: numberValue(record.frontmatter.fatG),
        fiberG: numberValue(record.frontmatter.fiberG),
        sugarG: numberValue(record.frontmatter.sugarG),
        sugarAlcoholG: numberValue(record.frontmatter.sugarAlcoholG),
        alcoholG: numberValue(record.frontmatter.alcoholG),
        sodiumMg: numberValue(record.frontmatter.sodiumMg),
        ...extraNutrition(record.frontmatter),
        note: String(record.frontmatter.note || ''),
        linkedFood: Boolean(foodReference(record.frontmatter)),
      }));
  }

  getDailyActivityEntries(dateIso: string): NativeDailyActivityEntrySnapshot[] {
    return this.getKindDateRecords('activity-entry', dateIso)
      .concat(this.getKindDateRecords('workout-session', dateIso))
      .filter((record) => (
        record.frontmatter.archived !== true
        && dateKey(
          record.frontmatter.date
          || record.frontmatter.workoutDate
          || record.frontmatter.completedDate
          || (record.kind === 'workout-session'
            ? workoutStartedAt(record.frontmatter, this.plugin.settings) || workoutEndedAt(record.frontmatter, this.plugin.settings)
            : record.frontmatter.startedAt || record.frontmatter.endedAt),
        ) === dateIso
      ))
      .map((record) => {
        const workout = record.kind === 'workout-session';
        const startedAt = workout
          ? workoutStartedAt(record.frontmatter, this.plugin.settings)
          : String(record.frontmatter.startedAt || '');
        const activeWorkout = workout && String(record.frontmatter.status || 'active').trim().toLowerCase() === 'active';
        const endedAt = workout
          ? activeWorkout ? '' : workoutEndedAt(record.frontmatter, this.plugin.settings)
          : String(record.frontmatter.completedDate || record.frontmatter.endedAt || startedAt);
        return {
          id: record.id,
          path: record.file.path,
          kind: record.kind as 'activity-entry' | 'workout-session',
          title: String(record.frontmatter.title || record.file.basename).trim() || record.file.basename,
          activityType: String(record.frontmatter.activityType || (workout ? 'workout' : 'other')).trim(),
          startedAt,
          completedDate: endedAt || startedAt,
          durationMinutes: nativeActivityDurationMinutes(record.frontmatter, workout ? this.plugin.settings : undefined),
          distance: numberValue(record.frontmatter.distance),
          distanceUnit: String(record.frontmatter.distanceUnit || '').trim(),
          steps: numberValue(record.frontmatter.steps),
          caloriesBurned: numberValue(record.frontmatter.caloriesBurned),
          note: String(record.frontmatter.note || ''),
          status: String(record.frontmatter.status || (workout ? 'active' : 'complete')).trim().toLowerCase(),
        };
      })
      .sort((left, right) => left.completedDate.localeCompare(right.completedDate) || left.title.localeCompare(right.title));
  }

  async updateDailyFoodEntry(reference: string | TFile, patch: NativeDailyFoodEntryPatch): Promise<NativeRecordHandle> {
    const current = await this.resolveRecord(reference);
    if (!current || current.kind !== 'food-entry') throw new Error('Food log entry was not found.');
    const title = String(patch.title || '').trim();
    const completedDate = String(patch.completedDate || '').trim();
    const unit = String(patch.unit || '').trim();
    if (!title || !completedDate || !unit || !Number.isFinite(patch.quantity) || patch.quantity <= 0) {
      throw new Error('Food log title, consumed time, quantity, and unit are required.');
    }
    const linkedFood = Boolean(foodReference(current.frontmatter));
    const nutritionUpdates = linkedFood ? {} : {
      calories: nonNegativeNumber(patch.calories),
      proteinG: nonNegativeNumber(patch.proteinG),
      carbsG: nonNegativeNumber(patch.carbsG),
      fatG: nonNegativeNumber(patch.fatG),
      fiberG: nonNegativeNumber(patch.fiberG),
      sugarG: nonNegativeNumber(patch.sugarG),
      sugarAlcoholG: nonNegativeNumber(patch.sugarAlcoholG),
      alcoholG: nonNegativeNumber(patch.alcoholG),
      sodiumMg: nonNegativeNumber(patch.sodiumMg),
      ...extraNutrition(patch),
    };
    const updates = {
      title,
      completedDate,
      quantity: patch.quantity,
      unit,
      ...nutritionUpdates,
      note: String(patch.note || '').trim() || null,
    };
    const updated = linkedFood
      ? await this.processFoodEntry(current, updates)
      : await this.updateRecord(current.file, updates,
        { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-daily-food-edit' });
    if (!updated) throw new Error('Food log entry changed before it could be saved.');
    if (!linkedFood) this.trackHandle(updated);
    return updated;
  }

  async updateDailyActivityEntry(reference: string | TFile, patch: NativeDailyActivityEntryPatch): Promise<NativeRecordHandle> {
    const current = await this.resolveRecord(reference);
    if (!current || current.kind !== 'activity-entry') throw new Error('Activity log entry was not found.');
    const title = String(patch.title || '').trim();
    const completedDate = String(patch.completedDate || '').trim();
    if (!title || !completedDate) throw new Error('Activity name and completed time are required.');
    const updated = await this.updateRecord(current.file, {
      title,
      activityType: String(patch.activityType || 'other').trim() || 'other',
      startedAt: String(patch.startedAt || '').trim() || null,
      completedDate,
      durationMinutes: optionalNonNegativeNumber(patch.durationMinutes),
      distance: optionalNonNegativeNumber(patch.distance),
      distanceUnit: patch.distance > 0 ? String(patch.distanceUnit || '').trim() || 'mi' : null,
      steps: optionalNonNegativeNumber(patch.steps),
      caloriesBurned: optionalNonNegativeNumber(patch.caloriesBurned),
      note: String(patch.note || '').trim() || null,
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-daily-activity-edit' });
    if (!updated) throw new Error('Activity log entry changed before it could be saved.');
    this.trackHandle(updated);
    return updated;
  }

  async archiveDailyEntry(reference: string | TFile, expectedKind: 'food-entry' | 'activity-entry' | 'workout-session'): Promise<NativeRecordHandle> {
    const current = await this.resolveRecord(reference);
    if (!current || current.kind !== expectedKind) throw new Error('Health log entry was not found.');
    const updated = await this.updateRecord(current.file, {
      archived: true,
      archivedDate: new Date().toISOString(),
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-daily-entry-remove' });
    if (!updated) throw new Error('Health log entry changed before it could be removed.');
    this.trackHandle(updated);
    return updated;
  }

  getDailyActivityTotals(dateIso: string): NativeDailyActivityTotals {
    const activityRecords = this.getKindDateRecords('activity-entry', dateIso).filter((record) => (
      record.frontmatter.archived !== true && dateKey(record.frontmatter.date || record.frontmatter.completedDate) === dateIso
    ));
    const workoutRecords = this.getKindDateRecords('workout-session', dateIso).filter((record) => (
      record.frontmatter.archived !== true && dateKey(
        record.frontmatter.date || record.frontmatter.workoutDate
        || workoutStartedAt(record.frontmatter, this.plugin.settings)
        || workoutEndedAt(record.frontmatter, this.plugin.settings),
      ) === dateIso
    ));
    let durationMinutes = 0;
    let caloriesBurned = 0;
    let steps = 0;
    for (const record of activityRecords) {
      const duration = nativeActivityDurationMinutes(record.frontmatter);
      durationMinutes += duration;
      caloriesBurned += numberValue(record.frontmatter.caloriesBurned);
      steps += numberValue(record.frontmatter.steps);
    }
    for (const record of workoutRecords) {
      const duration = nativeActivityDurationMinutes(record.frontmatter, this.plugin.settings);
      durationMinutes += duration;
      caloriesBurned += numberValue(record.frontmatter.caloriesBurned);
      steps += numberValue(record.frontmatter.steps);
    }
    return {
      dateIso,
      entryCount: activityRecords.length + workoutRecords.length,
      durationMinutes,
      caloriesBurned,
      steps,
    };
  }

  /**
   * Explicitly remove legacy note-level identity aliases after first replacing
   * workout child-ID joins with one durable wikilink relationship.
   */
  async normalizeNativeRecordIdentities(): Promise<NativeIdentityNormalizationResult> {
    const records = [...this.recordsByPath.values()]
      .sort((left, right) => left.file.path.localeCompare(right.file.path));
    let updated = 0;
    let skipped = 0;
    for (const record of records) {
      const updates: Record<string, unknown> = {};
      if (record.kind === 'food-entry') {
        const legacyFoodId = String(record.frontmatter.foodId || '').trim();
        if (legacyFoodId && legacyFoodId !== record.id) {
          skipped += 1;
          continue;
        }
        if (legacyFoodId === record.id) updates.foodId = null;
        const foodLink = this.recordLink(foodReference(record.frontmatter));
        if (foodLink && foodLink !== record.frontmatter.food) updates.food = foodLink;
        if (Object.prototype.hasOwnProperty.call(record.frontmatter, 'foodPath')) updates.foodPath = null;
      } else if (record.kind === 'workout-session') {
        const legacyWorkoutId = String(record.frontmatter.workoutId || '').trim();
        if (legacyWorkoutId && legacyWorkoutId !== record.id) {
          skipped += 1;
          continue;
        }
        if (legacyWorkoutId === record.id) updates.workoutId = null;
        if (Object.prototype.hasOwnProperty.call(record.frontmatter, 'exerciseRecordIds')) updates.exerciseRecordIds = null;
        const planLink = this.recordLink(record.frontmatter.workoutPlan || record.frontmatter.workoutPlanPath);
        if (planLink && planLink !== record.frontmatter.workoutPlan) updates.workoutPlan = planLink;
        if (Object.prototype.hasOwnProperty.call(record.frontmatter, 'workoutPlanPath')) updates.workoutPlanPath = null;
      } else if (record.kind === 'workout-exercise') {
        const legacyReference = String(record.frontmatter.workoutId || record.frontmatter.workoutPath || '').trim();
        const linkedPath = wikilinkPath(record.frontmatter.workout);
        const session = linkedPath
          ? this.findWorkoutSession(linkedPath)
          : this.findWorkoutSession(legacyReference);
        if (!session) {
          if (legacyReference) skipped += 1;
          continue;
        }
        const workoutLink = this.recordLink(session.file.path);
        if (workoutLink !== record.frontmatter.workout) updates.workout = workoutLink;
        if (Object.prototype.hasOwnProperty.call(record.frontmatter, 'workoutId')) updates.workoutId = null;
        if (Object.prototype.hasOwnProperty.call(record.frontmatter, 'workoutPath')) updates.workoutPath = null;
        const exerciseLink = this.recordLink(record.frontmatter.exercisePath);
        if (exerciseLink && exerciseLink !== record.frontmatter.exercisePath) updates.exercisePath = exerciseLink;
        if (numberValue(record.frontmatter.exerciseOrder) <= 0) {
          const legacyIds = Array.isArray(session.frontmatter.exerciseRecordIds)
            ? session.frontmatter.exerciseRecordIds.map(String)
            : [];
          const legacyIndex = legacyIds.indexOf(record.id);
          const siblings = this.getWorkoutExerciseRecords(session)
            .slice()
            .sort((left, right) => left.file.path.localeCompare(right.file.path));
          updates.exerciseOrder = legacyIndex >= 0
            ? legacyIndex + 1
            : Math.max(1, siblings.findIndex((candidate) => candidate.id === record.id) + 1);
        }
      }
      if (Object.keys(updates).length === 0) continue;
      const write = (reference: NativeRecordHandle) => this.updateRecord(reference.file, updates, {
        kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-identity-normalization',
      });
      const result = record.kind === 'workout-session'
        ? await this.serializeWorkoutSessionMutation(this.toHandle(record), 'health-identity-normalization', write)
        : await write(this.toHandle(record));
      if (result) {
        this.trackHandle(result);
        updated += 1;
      } else skipped += 1;
    }
    return { inspected: records.length, updated, skipped };
  }

  /**
   * Explicitly replace opaque ID filenames plus the exact title-first workout
   * pattern previously generated by Health. Other user-renamed files are left
   * untouched, and GCM owns atomic renames, link updates, and collision suffixes.
   */
  async normalizeNativeRecordFilenames(): Promise<NativeFilenameNormalizationResult> {
    const api = this.requireApi();
    if (typeof api.rename !== 'function') {
      throw new Error('Readable Health filenames require nativeRecords API v6 with rename support.');
    }
    const records = [...this.recordsByPath.values()]
      .filter((record) => record.kind === 'food-entry' || record.kind === 'activity-entry' || record.kind === 'workout-session' || record.kind === 'workout-exercise')
      .sort((left, right) => left.file.path.localeCompare(right.file.path) || left.id.localeCompare(right.id));
    const targets = records.map((record) => {
      const session = record.kind === 'workout-exercise'
        ? this.getKindRecords('workout-session').filter((candidate) => this.recordBelongsToWorkout(record, candidate))
        : [];
      const sessionDate = session.length === 1
        ? session[0].frontmatter.date || session[0].frontmatter.workoutDate
          || workoutStartedAt(session[0].frontmatter, this.plugin.settings)
        : undefined;
      const projectedFrontmatter = record.kind === 'workout-session'
        ? { ...record.frontmatter, startedAt: workoutStartedAt(migrateWorkoutTiming(record.frontmatter, this.plugin.settings, this.plugin.settings), this.plugin.settings) }
        : record.frontmatter;
      const projectedRecord = { ...record, frontmatter: projectedFrontmatter };
      return {
        record,
        projectedRecord,
        originalBasename: record.file.basename,
        opaque: record.file.basename === record.id,
        generatedTitleFirstWorkout: hasExactGeneratedTitleFirstWorkoutBasename(projectedRecord),
        fileName: buildNativeHealthRecordFileName(record.kind, projectedFrontmatter, { date: sessionDate }),
      };
    });
    let renamed = 0;
    let unchanged = 0;
    let failed = 0;
    const renamedPaths: Record<string, string> = {};
    for (const target of targets) {
      const stillEligible = target.opaque
        ? target.record.file.basename === target.record.id
        : target.generatedTitleFirstWorkout
          && target.record.file.basename === target.originalBasename
          && hasExactGeneratedTitleFirstWorkoutBasename(target.projectedRecord);
      if (!stillEligible) {
        unchanged += 1;
        continue;
      }
      if (!target.fileName) {
        failed += 1;
        continue;
      }
      const oldPath = target.record.file.path;
      try {
        const result = this.canonicalHandle(await api.rename(target.record.file, target.fileName, {
          kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-readable-filenames',
        }));
        if (!result) {
          failed += 1;
          continue;
        }
        if (result.path === oldPath) unchanged += 1;
        else {
          this.removePath(oldPath, false);
          this.trackHandle(result);
          renamedPaths[target.record.id] = result.path;
          renamed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { inspected: records.length, renamed, unchanged, failed, renamedPaths };
  }

  /** Read-only migration inventory. Legacy source files are never changed. */
  async planLegacyImport(): Promise<LegacyHealthImportPlan> {
    const candidates = await this.collectLegacyCandidates();
    const recordCandidates = candidates.records.filter((candidate) => candidate.kind !== 'workout-exercise');
    const totals = zeroNutritionTotals();
    let foodEntries = 0;
    let activityEntries = 0;
    let workoutSessions = 0;
    let workoutExercises = 0;
    let existing = 0;
    for (const candidate of candidates.records) {
      if (candidate.kind === 'food-entry') {
        foodEntries += 1;
        for (const key of NUTRITION_KEYS) totals[key] += numberValue(candidate.properties[key]);
        addExtraNutrition(totals, candidate.properties);
      } else if (candidate.kind === 'activity-entry') activityEntries += 1;
      else if (candidate.kind === 'workout-session') workoutSessions += 1;
      else if (candidate.kind === 'workout-exercise') workoutExercises += 1;
      if (candidate.kind !== 'workout-exercise' && this.findRecordById(candidate.id)) existing += 1;
    }
    return {
      candidates: recordCandidates.length,
      existing,
      foodEntries,
      activityEntries,
      workoutSessions,
      workoutExercises,
      unresolvedLines: candidates.unresolvedLines,
      totals,
    };
  }

  /** Explicit, copy-only import. Every legacy line remains byte-identical. */
  async importLegacyRecords(resolveDefinition?: WorkoutExerciseDefinitionResolver): Promise<LegacyHealthImportResult> {
    const api = this.requireApi();
    const collected = await this.collectLegacyCandidates();
    const plan = await this.planLegacyImport();
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const exerciseGroups = collected.records.filter((candidate) => candidate.kind === 'workout-exercise');
    for (const candidate of collected.records.filter((record) => record.kind !== 'workout-exercise')) {
      const existing = this.findRecordById(candidate.id) || await this.resolveRecord(candidate.id);
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        const properties = candidate.kind === 'workout-session'
          ? migrateWorkoutTiming(candidate.properties, this.plugin.settings, this.plugin.settings)
          : { ...candidate.properties };
        let importedWorkoutExercises: StoredWorkoutExercise[] | null = null;
        if (candidate.kind === 'workout-session') {
          const exercises = exerciseGroups
            .filter((exercise) => exercise.workoutReferenceId === candidate.id)
            .map((exercise): StoredWorkoutExercise => ({
              id: exercise.id,
              name: String(exercise.properties.exercise || exercise.properties.title || '').trim(),
              exercisePath: wikilinkPath(exercise.properties.exercisePath),
              sets: storedWorkoutSets(exercise.properties.sets),
            }))
            .filter((exercise) => Boolean(exercise.name));
          importedWorkoutExercises = await this.ensureWorkoutExerciseDefinitionPaths(exercises, resolveDefinition);
        }
        const minimalProperties = minimalNativeRecordProperties(candidate.kind, properties);
        const persistedProperties = candidate.kind === 'workout-session'
          ? compactRecordProperties({
            ...minimalProperties,
            ...workoutTemporalPropertyUpdates(this.plugin.settings, properties, {
              startedAt: workoutStartedAt(properties, this.plugin.settings),
              endedAt: workoutEndedAt(properties, this.plugin.settings),
              durationMinutes: workoutDurationMinutes(properties, this.plugin.settings),
              terminal: String(properties.status || 'complete').trim().toLocaleLowerCase() !== 'active',
            }),
          })
          : minimalProperties;
        const record = await this.createRecord(candidate.kind, persistedProperties, {
          id: candidate.id,
          fileName: Number(api.version) >= 3
            ? buildNativeHealthRecordFileName(candidate.kind, candidate.kind === 'workout-session'
              ? { ...persistedProperties, startedAt: workoutStartedAt(properties, this.plugin.settings) }
              : persistedProperties) || undefined
            : undefined,
          cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-legacy-import' },
        });
        if (importedWorkoutExercises) {
          await this.serializeWorkoutSessionMutation(record, 'health-legacy-import', async (session) => {
            const content = await this.plugin.app.vault.read(session.file);
            const markerState = workoutStorageStateFromContent(content, this.plugin.settings);
            const updated = await this.updateWorkoutSessionData(
              session,
              importedWorkoutExercises!,
              {},
              'health-legacy-import',
              markerState,
            );
            if (!updated) throw new Error('Imported workout body could not be saved.');
            return updated;
          });
        }
        this.trackHandle(record);
        created += 1;
      } catch {
        failed += 1;
      }
    }
    return { ...plan, created, skipped, failed };
  }

  private async collectLegacyCandidates(): Promise<{ records: LegacyHealthCandidate[]; unresolvedLines: number }> {
    const records: LegacyHealthCandidate[] = [];
    const exerciseGroups = new Map<string, LegacyHealthCandidate>();
    let unresolvedLines = 0;
    const files = [...this.plugin.app.vault.getMarkdownFiles()].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
      const content = await this.plugin.app.vault.cachedRead(file);
      let currentWorkoutId = '';
      for (const [index, line] of content.split('\n').entries()) {
        if (!line.includes('[type::')) continue;
        const fields = parseLegacyInlineFields(line);
        const type = String(fields.type || '').trim();
        if (type === 'foodLog') {
          const id = String(fields.foodId || '').trim();
          if (!id) { unresolvedLines += 1; continue; }
          const completedDate = String(fields.completedDate || fields.createdDate || '').trim();
          records.push({
            id,
            kind: 'food-entry',
            sourcePath: file.path,
            lineNumber: index,
            properties: {
              title: String(fields.food || 'Food'),
              status: 'complete',
              completedDate,
              date: legacyDateKey(completedDate, String(fields.dailyNotePath || file.path)),
              food: this.recordLink(fields.food || fields.foodPath),
              foodName: fields.food,
              brand: fields.brand,
              quantity: legacyNumber(fields.servings ?? fields.qty),
              unit: fields.unit,
              amount: legacyNumber(fields.amount),
              amountUnit: fields.amountUnit,
              calories: legacyNumber(fields.cal),
              proteinG: legacyNumber(fields.protein),
              carbsG: legacyNumber(fields.carbs),
              fatG: legacyNumber(fields.fat),
              fiberG: legacyNumber(fields.fiber),
              sugarG: legacyNumber(fields.sugar),
              sugarAlcoholG: legacyNumber(fields.sugarAlcohol),
              alcoholG: legacyNumber(fields.alcohol),
              sodiumMg: legacyNumber(fields.sodium),
              ...extraNutrition(fields),
              note: fields.note,
            },
          });
          continue;
        }
        if (type === 'activityLog') {
          const id = String(fields.activityId || fields.workoutId || '').trim();
          if (!id) { unresolvedLines += 1; continue; }
          const isWorkout = String(fields.activityType || '').toLowerCase() === 'workout' || !!fields.workoutId;
          if (isWorkout) currentWorkoutId = String(fields.workoutId || id);
          records.push({
            id,
            kind: isWorkout ? 'workout-session' : 'activity-entry',
            sourcePath: file.path,
            lineNumber: index,
            properties: {
              title: String(fields.activity || fields.workout || 'Activity'),
              status: String(fields.status || 'complete'),
              activity: fields.activity,
              activityType: fields.activityType,
              workoutPlan: this.recordLink(fields.workoutPlan || fields.workoutPlanPath),
              startedAt: fields.startedAt || fields.createdDate,
              completedDate: fields.completedDate,
              date: legacyDateKey(String(fields.completedDate || fields.startedAt || fields.createdDate || ''), file.path),
              durationMinutes: legacyNumber(fields.durationMinutes),
              distance: legacyNumber(fields.distance),
              distanceUnit: fields.distanceUnit,
              steps: legacyNumber(fields.steps),
              caloriesBurned: legacyNumber(fields.caloriesBurned),
              source: fields.source,
              sourceId: fields.sourceId,
              device: fields.device,
              note: fields.note,
            },
          });
          continue;
        }
        if (type === 'workoutSet') {
          const setId = String(fields.setId || '').trim();
          const exercise = String(fields.exercise || '').trim();
          const workoutId = currentWorkoutId || String(fields.workoutPath || fields.workout || '').trim();
          if (!setId || !exercise || !workoutId) { unresolvedLines += 1; continue; }
          const key = `${workoutId}\u0000${exercise.toLocaleLowerCase()}`;
          let candidate = exerciseGroups.get(key);
          if (!candidate) {
            const exerciseOrder = [...exerciseGroups.values()]
              .filter((existing) => existing.workoutReferenceId === workoutId).length + 1;
            candidate = {
              id: `legacy-exercise-${stableHash(key)}`,
              kind: 'workout-exercise',
              sourcePath: file.path,
              lineNumber: index,
              workoutReferenceId: workoutId,
              properties: {
                title: exercise,
                exercise,
                exercisePath: this.recordLink(fields.exercisePath),
                exerciseOrder,
                sets: [],
                setCount: 0,
                totalReps: 0,
                totalVolume: 0,
              },
            };
            exerciseGroups.set(key, candidate);
          }
          const set = {
            id: setId,
            completedDate: fields.completedDate || fields.endedAt,
            startedAt: fields.startedAt,
            endedAt: fields.endedAt,
            setType: fields.setType,
            reps: legacyNumber(fields.reps),
            weight: legacyNumber(fields.weight),
            weightUnit: fields.unit,
            perArm: String(fields.perArm || '') === 'true',
            durationSeconds: legacyNumber(fields.duration),
            distance: legacyNumber(fields.distance),
            distanceUnit: fields.distanceUnit,
            rpe: legacyNumber(fields.rpe),
            restSeconds: legacyNumber(fields.rest),
            note: fields.note,
          };
          const sets = candidate.properties.sets as Array<Record<string, unknown>>;
          sets.push(set);
          candidate.properties.setCount = sets.length;
          candidate.properties.totalReps = sets.reduce((sum, value) => sum + numberValue(value.reps), 0);
          candidate.properties.totalVolume = sets.reduce((sum, value) => sum + numberValue(value.reps) * numberValue(value.weight) * (value.perArm === true ? 2 : 1), 0);
        }
      }
    }
    records.push(...exerciseGroups.values());
    records.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.lineNumber - b.lineNumber || a.id.localeCompare(b.id));
    return { records, unresolvedLines };
  }

  private recordLink(pathValue: unknown): string | undefined {
    const path = wikilinkPath(pathValue);
    if (!path) return undefined;
    return `[[${path.replace(/\.md$/iu, '')}]]`;
  }

  private findWorkoutSession(reference: string): IndexedHealthRecord | null {
    const key = String(reference || '').trim();
    if (!key) return null;
    const matches = this.getKindRecords('workout-session').filter((record) => (
      record.frontmatter.archived !== true
      && (record.id === key || record.file.path === key || String(record.frontmatter.workoutId || '').trim() === key)
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  private recordBelongsToWorkout(record: IndexedHealthRecord, session: IndexedHealthRecord): boolean {
    const linkedPath = wikilinkPath(record.frontmatter.workout);
    return linkedPath === session.file.path
      || String(record.frontmatter.workoutId || '').trim() === session.id
      || wikilinkPath(record.frontmatter.workoutPath) === session.file.path;
  }

  private workoutExercisesForRead(session: IndexedHealthRecord | NativeRecordHandle): StoredWorkoutExercise[] {
    if (Object.prototype.hasOwnProperty.call(session.frontmatter, 'session')) {
      return cloneStoredWorkoutExercises(storedWorkoutExercises(session.frontmatter.session) || []);
    }
    const bodyData = this.workoutDataByPath.get(session.file.path);
    if (bodyData) return cloneStoredWorkoutExercises(bodyData);
    return this.workoutExercisesWithoutBodyCache(session);
  }

  private workoutExercisesWithoutBodyCache(session: IndexedHealthRecord | NativeRecordHandle): StoredWorkoutExercise[] {
    if (Object.prototype.hasOwnProperty.call(session.frontmatter, 'session')) {
      const embedded = storedWorkoutExercises(session.frontmatter.session);
      if (embedded) return embedded;
    }
    if (Object.prototype.hasOwnProperty.call(session.frontmatter, 'workoutData')) {
      const embedded = storedWorkoutExercises(session.frontmatter.workoutData);
      if (embedded) return embedded;
    }
    const order = new Map(
      (Array.isArray(session.frontmatter.exerciseRecordIds) ? session.frontmatter.exerciseRecordIds : [])
        .map((value, index) => [String(value || ''), index] as const)
        .filter(([id]) => Boolean(id)),
    );
    return this.getWorkoutExerciseRecords(session)
      .slice()
      .sort((left, right) => {
        const authoredLeft = numberValue(left.frontmatter.exerciseOrder);
        const authoredRight = numberValue(right.frontmatter.exerciseOrder);
        const leftOrder = authoredLeft > 0 ? authoredLeft : (order.get(left.id) ?? Number.MAX_SAFE_INTEGER);
        const rightOrder = authoredRight > 0 ? authoredRight : (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
        return leftOrder - rightOrder || left.id.localeCompare(right.id) || left.file.path.localeCompare(right.file.path);
      })
      .map((record) => ({
        id: record.id,
        name: String(record.frontmatter.exercise || record.frontmatter.title || record.file.basename).trim() || record.file.basename,
        exercisePath: wikilinkPath(record.frontmatter.exercisePath),
        sets: storedWorkoutSets(record.frontmatter.sets),
      }));
  }

  private async workoutExercisesForWrite(
    session: NativeRecordHandle,
    resolver?: WorkoutExerciseDefinitionResolver,
    resolveDefinitions = true,
    expectedActiveSessionId?: string,
  ): Promise<{
    exercises: StoredWorkoutExercise[];
    legacyChildren: IndexedHealthRecord[];
    markerState: string | null;
    authoritativeSession: NativeRecordHandle;
  }> {
    const content = await this.plugin.app.vault.read(session.file);
    const rawFrontmatter = workoutFrontmatterFromContent(content);
    if (expectedActiveSessionId) this.assertActiveWorkoutSource(rawFrontmatter, expectedActiveSessionId);
    const frontmatter = decodeNativeRecordFrontmatter(this.plugin.settings, rawFrontmatter);
    const hasSession = Object.prototype.hasOwnProperty.call(frontmatter, 'session');
    const nested = hasSession ? storedWorkoutExercises(frontmatter.session) : null;
    if (hasSession && !nested) {
      throw new Error('Workout session property is invalid; no changes were written.');
    }
    const markerState = workoutDataMarkerState(content);
    const bodyValue = readWorkoutDataFromNoteContent(content);
    const stored = bodyValue == null ? null : storedWorkoutExercises(bodyValue);
    if (!hasSession && markerState != null && !stored) {
      throw new Error('Workout session body data is invalid; no changes were written.');
    }
    const authoritativeSession: NativeRecordHandle = { ...session, frontmatter };
    const legacyChildren = this.getWorkoutExerciseRecords(session);
    const exercises = nested || stored || this.workoutExercisesWithoutBodyCache(authoritativeSession);
    return {
      // Unlinking existing rows needs no reusable-note resolution or creation.
      exercises: resolveDefinitions ? await this.ensureWorkoutExerciseDefinitionPaths(exercises, resolver) : exercises,
      legacyChildren,
      markerState: workoutStorageStateFromContent(content, this.plugin.settings),
      authoritativeSession,
    };
  }

  private assertActiveWorkoutSource(frontmatter: Record<string, unknown>, expectedId: string): void {
    const inspected = this.requireApi().inspect(frontmatter);
    const decoded = decodeNativeRecordFrontmatter(this.plugin.settings, inspected?.frontmatter || frontmatter);
    if (inspected?.id !== expectedId || Number(inspected?.schemaVersion) !== 1
      || canonicalNativeKind(this.plugin.settings, inspected?.kind) !== 'workout-session') {
      throw new Error('Workout session identity changed.');
    }
    if (String(decoded.status || '').trim().toLocaleLowerCase() !== 'active' || decoded.archived === true) {
      throw new Error('This workout is no longer active.');
    }
  }

  private async ensureWorkoutExerciseDefinitionPaths(
    exercises: StoredWorkoutExercise[],
    resolver?: WorkoutExerciseDefinitionResolver,
  ): Promise<StoredWorkoutExercise[]> {
    const pluginResolver = (this.plugin as TPSHealthPlugin & {
      ensureExerciseDefinitionForWorkout?: (name: string, existingPath?: string) => Promise<{ sourcePath?: string }>;
    }).ensureExerciseDefinitionForWorkout;
    const resolvePath = resolver || (typeof pluginResolver === 'function'
      ? async (name: string, existingPath: string) => (
        (await pluginResolver.call(this.plugin, name, existingPath)).sourcePath || ''
      )
      : null);
    const linked: StoredWorkoutExercise[] = [];
    for (const exercise of exercises) {
      let exercisePath = wikilinkPath(exercise.exercisePath);
      if (resolvePath) exercisePath = wikilinkPath(await resolvePath(exercise.name, exercisePath));
      if (!exercisePath) throw new Error(`Reusable exercise note could not be resolved for ${exercise.name}.`);
      linked.push({
        ...exercise,
        exercisePath,
        sets: exercise.sets.map((set) => ({ ...set })),
      });
    }
    return linked;
  }

  private embeddedExerciseHandle(session: NativeRecordHandle, exercise: StoredWorkoutExercise): NativeRecordHandle {
    const aggregates = workoutAggregates([exercise]);
    return {
      file: session.file,
      path: session.path,
      id: exercise.id,
      kind: 'workout-exercise',
      frontmatter: {
        title: exercise.name,
        exercise: exercise.name,
        exercisePath: this.recordLink(exercise.exercisePath),
        sets: exercise.sets.map((set) => ({ ...set })),
        setCount: aggregates.setCount,
        totalReps: aggregates.totalReps,
        totalVolume: aggregates.totalVolume,
      },
    };
  }

  private findWorkoutSessionHandleForExercise(exercise: NativeRecordHandle): NativeRecordHandle | null {
    const indexed = this.recordsByPath.get(exercise.path);
    if (indexed?.kind === 'workout-session') return this.toHandle(indexed);
    if (indexed?.kind !== 'workout-exercise') return null;
    const matches = this.getKindRecords('workout-session')
      .filter((session) => this.recordBelongsToWorkout(indexed, session));
    return matches.length === 1 ? this.toHandle(matches[0]) : null;
  }

  private async trashLegacyWorkoutChildren(
    session: IndexedHealthRecord | NativeRecordHandle,
    children: IndexedHealthRecord[],
    surface: string,
  ): Promise<{ trashed: number; failed: number }> {
    let trashed = 0;
    let failed = 0;
    for (const child of children) {
      const current = this.plugin.app.vault.getAbstractFileByPath(child.file.path);
      if (!(current instanceof TFile)) continue;
      try {
        await this.plugin.app.vault.trash(current, false);
        trashed += 1;
      } catch (error) {
        failed += 1;
        logger.flowError('WorkoutStorage', 'legacy-child-trash-failed', error, {
          workoutId: session.id,
          path: session.file.path,
          childPath: child.file.path,
          surface,
        });
      }
    }
    logger.flow('WorkoutStorage', 'legacy-children:trashed', {
      workoutId: session.id,
      path: session.file.path,
      childNotes: children.length,
      trashed,
      failed,
      surface,
    });
    return { trashed, failed };
  }

  private getWorkoutExerciseRecords(session: IndexedHealthRecord | NativeRecordHandle): IndexedHealthRecord[] {
    const indexed = 'file' in session && this.recordsByPath.get(session.file.path);
    const resolved = indexed || ({
      file: session.file,
      frontmatter: session.frontmatter,
      id: session.id,
      kind: 'workout-session' as const,
      dailyDates: indexedDailyDates('workout-session', session.frontmatter, this.plugin.settings),
    });
    return this.getKindRecords('workout-exercise')
      .filter((record) => record.frontmatter.archived !== true && this.recordBelongsToWorkout(record, resolved));
  }

  private findRecordById(id: string): NativeRecordHandle | null {
    const matches = [...this.recordsByPath.values()].filter((record) => record.id === id);
    return matches.length === 1 ? this.toHandle(matches[0]) : null;
  }

  private cancelDiscovery(): void {
    const pass = this.discoveryPass;
    this.discoveryPass = null;
    pass?.complete();
  }

  private rebuild(resolved = false, previousStatus = this.getDailyIndexStatus()): void {
    if (this.disposed) return;
    this.cancelDiscovery();
    const api = this.readApi();
    this.indexedProvider = api;
    if (!api) return;
    this.indexedProviderConfiguration = this.providerConfiguration(api);
    this.pendingMetadataPaths.clear();
    const vault = this.plugin.app.vault;
    if (typeof vault?.getMarkdownFiles !== 'function') return;
    this.startDiscovery(vault.getMarkdownFiles().map(file => file.path), true, resolved, previousStatus);
  }

  private reconcilePendingMetadata(previousStatus = this.getDailyIndexStatus()): void {
    this.startDiscovery(this.pendingMetadataPaths.keys(), false, false, previousStatus);
  }

  private startDiscovery(files: Iterable<string>, full: boolean, resolved: boolean, previousStatus: 'loading' | 'partial' | 'ready'): void {
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    // Startup may have no waiter. Consumers still receive the original error,
    // while this attached observer prevents an unhandled rejected owner promise.
    void completion.catch(() => undefined);
    const queue = new Set(files);
    const hadFiles = queue.size > 0;
    // Removed-record reconciliation shares the same bounded queue so events
    // arriving during any yield are drained before the pass can become ready.
    if (full) for (const path of this.recordsByPath.keys()) queue.add(path);
    const pass: HealthDiscoveryPass = {
      full, queue, sourceFiles: new Set(), readyWorkouts: [],
      reconcilePending: false, resolved, completion, complete, fail, previousStatus, hadFiles,
    };
    this.discoveryPass = pass;
    void this.runDiscovery(pass).catch(error => {
      // Completion callbacks can throw after the owner was cleared. Every
      // pass must settle its own waiters; only the current owner may revoke
      // shared readiness (never a newer replacement pass).
      pass.fail(error);
      if (this.discoveryPass === pass) {
        const beforeFailure = this.getDailyIndexStatus();
        this.discoveryPass = null;
        this.metadataResolved = false;
        this.workoutIndexReady = false;
        this.notifyDailyIndexStatusChanged(beforeFailure);
        this.plugin.scheduleWorkoutActionBars();
      }
      logger.flowError('NativeHealthIndex', 'discovery:failed', error);
    });
    if (this.discoveryPass === pass) this.notifyDailyIndexStatusChanged(previousStatus);
  }

  private async waitForFullDiscovery(): Promise<void> {
    // A replacement pass can begin while the previous owner is cancelled.
    // Await only finite work already owned here, never absent future metadata.
    while (!this.disposed && this.discoveryPass?.full) await this.discoveryPass.completion;
  }

  private yieldDiscovery(): Promise<void> {
    const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof scheduler?.yield === 'function') return scheduler.yield();
    // A message-port task permits input between slices without using the timer
    // queue (which was heavily throttled in the inactive test Electron host).
    // This does not prevent a mobile host from suspending the entire process.
    if (typeof globalThis.MessageChannel === 'function') return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
    return new Promise(resolve => globalThis.setTimeout(resolve, 0));
  }

  private async runDiscovery(pass: HealthDiscoveryPass): Promise<void> {
    const vault = this.plugin.app.vault;
    let yielded = false;
    let sliceStart = performance.now(), sliceFiles = 0;
    const needsYield = () => ++sliceFiles >= 256 || performance.now() - sliceStart >= 8;
    const yieldSlice = async () => {
      yielded = true;
      await this.yieldDiscovery();
      sliceStart = performance.now();
      sliceFiles = 0;
    };
    // Coalesce resolved bursts into one catch-up. A new resolved event while
    // that catch-up yields owns the next finite pending-only pass, not a scan.
    while (true) {
      for (const path of pass.queue) {
        if (this.disposed || this.discoveryPass !== pass) return;
        pass.queue.delete(path);
        const current = vault.getAbstractFileByPath(path);
        if (!(current instanceof TFile)) {
          this.pendingMetadataPaths.delete(path);
          this.foodDefinitionsByPath.delete(path);
          this.workoutDataByPath.delete(path);
          this.removePath(path);
        } else if (!pass.sourceFiles.has(current)) {
          // A superseded queued TFile must not leave the replacement pending
          // after the current metadata has been accepted.
          const cache = this.plugin.app.metadataCache.getFileCache(current);
          if (!cache) {
            // Missing metadata remains unknown; accepted values stay visible.
            this.pendingMetadataPaths.set(path, current);
          } else {
            this.pendingMetadataPaths.delete(path);
            this.indexFile(current, cache.frontmatter ?? null, undefined, pass);
            if (!pass.full && this.recordsByPath.get(path)?.kind === 'workout-session') pass.readyWorkouts.push(current);
          }
        }
        if (needsYield() && (pass.queue.size || (pass.reconcilePending && this.pendingMetadataPaths.size))) await yieldSlice();
      }
      if (!pass.reconcilePending) break;
      pass.reconcilePending = false;
      for (const path of this.pendingMetadataPaths.keys()) pass.queue.add(path);
    }
    if (this.disposed || this.discoveryPass !== pass) return;
    const previousStatus = yielded ? this.getDailyIndexStatus() : pass.previousStatus;
    this.discoveryPass = null;
    if (pass.full) {
      if (pass.resolved) this.workoutIndexReady = true;
      if (this.plugin.app.workspace?.layoutReady && pass.hadFiles && this.pendingMetadataPaths.size === 0) {
        // Public cache coverage proves warm mobile readiness even if the
        // private initialized flag is absent and resolved already fired.
        this.workoutIndexReady = true;
        this.metadataResolved = true;
      }
    }
    this.notifyDailyIndexStatusChanged(previousStatus);
    if (pass.full) this.hydrateWorkoutBodiesAfterLayout();
    else if (pass.readyWorkouts.length) this.hydrateWorkoutBodiesAfterLayout(pass.readyWorkouts);
    pass.complete();
    this.plugin.scheduleWorkoutActionBars();
  }

  private hydrateWorkoutBodiesAfterLayout(files?: TFile[]): void {
    if (!this.workoutIndexReady || !this.indexedProvider || this.discoveryPass?.full) return;
    // Metadata readiness owns the full index. Layout only permits the deferred
    // body reads; it must not rebuild an index that `resolved` already finished.
    const workouts = files || [...(this.pathsByKind.get('workout-session') || [])]
      .map(path => this.recordsByPath.get(path)?.file)
      .filter((file): file is TFile => !!file);
    const ready = workouts.filter(file => !this.pendingMetadataPaths.has(file.path));
    if (!ready.length) return;
    this.plugin.app.workspace?.onLayoutReady?.(() => {
      if (this.disposed || !this.indexedProvider || this.discoveryPass?.full) return;
      for (const file of ready) {
        const record = this.recordsByPath.get(file.path);
        if (record?.kind === 'workout-session' && record.file === file
          && !this.pendingMetadataPaths.has(file.path)
          && !Object.prototype.hasOwnProperty.call(record.frontmatter, 'session')) {
          void this.refreshFile(file);
        }
      }
      this.plugin.scheduleWorkoutActionBars();
    });
  }

  private indexFile(file: TFile, frontmatter?: Record<string, unknown> | null, content?: string, discovery?: HealthDiscoveryPass): void {
    if (this.discoveryPass && discovery !== this.discoveryPass) this.discoveryPass.sourceFiles.add(file);
    const api = this.readApi();
    // Provider startup/reload is not evidence that a record was deleted.
    if (!api) return;
    const previous = this.recordsByPath.get(file.path);
    const previousFoodPath = previous?.kind === 'food-entry'
      ? this.resolveFoodSourcePath(foodReference(previous.frontmatter), file.path) : '';
    this.removePath(file.path, false);
    // An explicit absent frontmatter value comes from an indexed source. Do
    // not revive its old identity from a lagging getFileCache result.
    const resolved = frontmatter === undefined
      ? this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
      : frontmatter;
    const inspected = api.inspect(resolved);
    const kind = canonicalNativeKind(this.plugin.settings, inspected?.kind);
    const recordId = String(inspected?.id || '').trim();
    const schemaVersion = Number(inspected?.schemaVersion);
    if (!recordId || schemaVersion !== 1 || !kind || !HEALTH_KINDS.has(kind)) {
      this.workoutDataByPath.delete(file.path);
      if (resolved && this.entryPathsByFoodPath.has(file.path)) {
        const inputsUnchanged = foodProjectionInputsUnchanged(this.foodDefinitionsByPath.get(file.path), resolved);
        this.foodDefinitionsByPath.set(file.path, { ...resolved });
        this.refreshLinkedFoodEntries(file.path, inputsUnchanged);
      } else this.foodDefinitionsByPath.delete(file.path);
      if (previous) this.emitChange(file.path, previous, null);
      if (previousFoodPath && !this.entryPathsByFoodPath.has(previousFoodPath)) this.foodDefinitionsByPath.delete(previousFoodPath);
      return;
    }
    const rawFrontmatter = decodeNativeRecordFrontmatter(
      this.plugin.settings,
      { ...(inspected?.frontmatter || resolved) },
    );
    if (kind === 'workout-session' && content !== undefined) {
      const nested = Object.prototype.hasOwnProperty.call(rawFrontmatter, 'session')
        ? storedWorkoutExercises(rawFrontmatter.session)
        : null;
      const bodyValue = nested ? null : readWorkoutDataFromNoteContent(content);
      const exercises = nested || (bodyValue == null ? null : storedWorkoutExercises(bodyValue));
      if (exercises) this.workoutDataByPath.set(file.path, exercises);
      else this.workoutDataByPath.delete(file.path);
    } else if (kind !== 'workout-session') {
      this.workoutDataByPath.delete(file.path);
    }
    const projected = kind === 'food-entry'
      ? this.projectFoodEntry(rawFrontmatter, file.path)
      : null;
    const record: IndexedHealthRecord = {
      file,
      frontmatter: projected?.frontmatter || rawFrontmatter,
      id: recordId,
      kind,
      dailyDates: indexedDailyDates(kind, projected?.frontmatter || rawFrontmatter, this.plugin.settings),
    };
    this.recordsByPath.set(file.path, record);
    const paths = this.pathsByKind.get(kind) || new Set<string>();
    paths.add(file.path);
    this.pathsByKind.set(kind, paths);
    this.addDailyPath(record);
    if (kind === 'food-entry') {
      const foodPath = this.resolveFoodSourcePath(foodReference(record.frontmatter), file.path);
      if (foodPath) {
        const entries = this.entryPathsByFoodPath.get(foodPath) || new Set<string>();
        entries.add(file.path);
        this.entryPathsByFoodPath.set(foodPath, entries);
      }
    }
    if (previousFoodPath && !this.entryPathsByFoodPath.has(previousFoodPath)) this.foodDefinitionsByPath.delete(previousFoodPath);
    this.emitChange(file.path, previous, record);
  }

  private readApi(): NativeRecordsApi | null {
    const api = this.plugin.getGcmNativeRecordsApi() as NativeRecordsApi | null;
    return api?.version === 6 && typeof api.inspect === 'function' && api.isEnabled?.() === true
      ? api : null;
  }

  private providerConfiguration(api: NativeRecordsApi): string {
    return JSON.stringify([
      api.getStorageProfile?.(), api.getKindPropertyKeys?.(),
      this.plugin.getGcmApi?.()?.frontmatterKinds?.snapshot?.(),
      ...[...HEALTH_KINDS].map(kind => api.getStorageProfile?.(configuredNativeKind(this.plugin.settings, kind))),
    ]);
  }

  private removePath(path: string, notify = true): void {
    const record = this.recordsByPath.get(path);
    this.recordsByPath.delete(path);
    if (!record) return;
    this.removeDailyPath(record, path);
    if (record.kind === 'food-entry') {
      const foodPath = this.resolveFoodSourcePath(foodReference(record.frontmatter), record.file.path);
      const entries = foodPath ? this.entryPathsByFoodPath.get(foodPath) : null;
      entries?.delete(path);
      if (foodPath && (!entries || entries.size === 0)) {
        this.entryPathsByFoodPath.delete(foodPath);
        if (notify) this.foodDefinitionsByPath.delete(foodPath);
      }
    }
    const paths = this.pathsByKind.get(record.kind);
    paths?.delete(path);
    if (!paths || paths.size === 0) this.pathsByKind.delete(record.kind);
    if (notify) this.emitChange(path, record, null);
  }

  private async refreshFile(file: TFile): Promise<void> {
    if (this.disposed || file.extension !== 'md') return;
    // Unique tokens cannot be reused if metadata settles one read and another
    // begins while the invalidated promise is still pending.
    const generation = Symbol();
    this.refreshGenerations.set(file.path, generation);
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      if (this.refreshGenerations.get(file.path) !== generation) return;
      if (this.plugin.app.vault.getAbstractFileByPath(file.path) !== file) return;
      const info = getFrontMatterInfo(content);
      let parsed: unknown = null;
      try {
        parsed = info.exists ? parseYaml(info.frontmatter) : null;
      } catch {
        // A known Health note with invalid YAML no longer has a safe identity.
        // Clear the projection; the next indexed source can restore it.
      }
      const resolvedFrontmatter = parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : null;
      this.indexFile(file, resolvedFrontmatter, content);
    } catch {
      // MetadataCache remains the safe eventual fallback for transient reads.
    } finally {
      if (this.refreshGenerations.get(file.path) === generation) {
        this.refreshGenerations.delete(file.path);
        // Controls disabled by an in-flight Health read need a settled-state render.
        if (this.isWorkoutIndexSettled()) this.plugin.scheduleWorkoutActionBars();
      }
    }
  }

  private resolveFoodSourcePath(value: unknown, sourcePath: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]$/u);
    const linkpath = String(match?.[1] || raw).trim();
    const metadataCache = this.plugin.app.metadataCache as unknown as {
      getFirstLinkpathDest?: (linkpath: string, sourcePath: string) => TFile | null;
    };
    const destination = metadataCache.getFirstLinkpathDest?.(linkpath, sourcePath);
    return destination instanceof TFile ? destination.path : wikilinkPath(linkpath);
  }

  private foodDefinitionForEntry(entry: Record<string, unknown>, sourcePath: string): {
    path: string;
    frontmatter: Record<string, unknown>;
  } | null {
    const foodPath = this.resolveFoodSourcePath(foodReference(entry), sourcePath);
    if (!foodPath) return null;
    const cached = this.foodDefinitionsByPath.get(foodPath);
    if (cached) return { path: foodPath, frontmatter: cached };
    const file = this.plugin.app.vault.getAbstractFileByPath(foodPath);
    if (!(file instanceof TFile)) return null;
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) return null;
    const copy = { ...frontmatter };
    this.foodDefinitionsByPath.set(foodPath, copy);
    return { path: foodPath, frontmatter: copy };
  }

  private projectFoodEntry(frontmatter: Record<string, unknown>, sourcePath: string): {
    frontmatter: Record<string, unknown>;
    needsPersist: boolean;
  } | null {
    const food = this.foodDefinitionForEntry(frontmatter, sourcePath);
    if (!food) return null;
    const projection = deriveNativeFoodEntryProjection(frontmatter, food.frontmatter);
    if (!projection) return null;
    const updates: Record<string, unknown> = {
      ...clearProperties(REDUNDANT_FOOD_ENTRY_KEYS),
      ...foodNutritionStorageValues(projection.nutrition, true),
    };
    const next = { ...frontmatter };
    let needsPersist = false;
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) {
        if (Object.prototype.hasOwnProperty.call(next, key)) {
          delete next[key];
          needsPersist = true;
        }
        continue;
      }
      if (next[key] !== value) needsPersist = true;
      next[key] = value;
    }
    return { frontmatter: next, needsPersist };
  }

  private refreshLinkedFoodEntries(foodPath: string, inputsUnchanged = false): void {
    for (const entryPath of [...(this.entryPathsByFoodPath.get(foodPath) || [])]) {
      const previous = this.recordsByPath.get(entryPath);
      if (!previous || previous.kind !== 'food-entry') continue;
      if (inputsUnchanged) {
        const food = this.foodDefinitionForEntry(previous.frontmatter, entryPath);
        if (food?.path === foodPath) {
          // Recipe/body/title consumers still need their existing notification.
          // Portion eligibility preserves the old null-projection behavior.
          if (foodEntryPortion(previous.frontmatter, food.frontmatter)) this.emitChange(entryPath, previous, previous);
          continue;
        }
      }
      const projected = this.projectFoodEntry(previous.frontmatter, entryPath);
      if (!projected) continue;
      const current = {
        ...previous,
        frontmatter: projected.frontmatter,
        dailyDates: indexedDailyDates(previous.kind, projected.frontmatter, this.plugin.settings),
      };
      if (previous.dailyDates.join('|') !== current.dailyDates.join('|')
        || (previous.frontmatter.archived === true) !== (current.frontmatter.archived === true)) {
        this.removeDailyPath(previous);
        this.addDailyPath(current);
      }
      this.recordsByPath.set(entryPath, current);
      this.emitChange(entryPath, previous, current);
    }
  }

  /** Accept the successful definition owner's source before any later body work. */
  acceptFoodDefinitionCommit(food: TFile, frontmatter: Record<string, unknown>): void {
    if (!this.isEnabled()) return;
    this.discoveryPass?.sourceFiles.add(food);
    const unchanged = foodProjectionInputsUnchanged(this.foodDefinitionsByPath.get(food.path), frontmatter);
    this.foodDefinitionsByPath.set(food.path, { ...frontmatter });
    this.refreshLinkedFoodEntries(food.path, unchanged);
  }

  /** Explicit definition edits own persistence; discovery and metadata only project display values. */
  async persistLinkedFoodEntries(food: TFile): Promise<void> {
    await this.waitForFullDiscovery();
    if (!this.isEnabled()) return;
    for (const path of [...(this.entryPathsByFoodPath.get(food.path) || [])]) {
      const entry = this.recordsByPath.get(path);
      if (!entry || entry.kind !== 'food-entry' || entry.frontmatter.archived === true) continue;
      // Cached preflight only rejects work. Native GCM rechecks identity,
      // exclusions and current source in its existing atomic write owner.
      const raw = this.plugin.app.metadataCache.getFileCache(entry.file)?.frontmatter;
      const inspected = this.readApi()?.inspect(raw);
      if (!inspected || inspected.id !== entry.id || canonicalNativeKind(this.plugin.settings, inspected.kind) !== 'food-entry') continue;
      const current = decodeNativeRecordFrontmatter(this.plugin.settings, inspected.frontmatter);
      if (this.resolveFoodSourcePath(foodReference(current), path) !== food.path
        || current.archived === true || !this.projectFoodEntry(current, path)?.needsPersist) continue;
      await this.processFoodEntry(entry, {}, food.path);
    }
  }

  private async processFoodEntry(
    entry: NativeRecordHandle | IndexedHealthRecord,
    updates: Record<string, unknown>,
    expectedFoodPath?: string,
  ): Promise<NativeRecordHandle | null> {
    const api = this.requireApi();
    if (api.capabilities?.updateFromSource !== true || typeof api.updateFromSource !== 'function') {
      throw new Error('Update TPS GCM to a build with nativeRecords.updateFromSource before saving linked food nutrition.');
    }
    const nutritionKeys = encodeNativeRecordProperties(this.plugin.settings, {
      ...clearProperties(REDUNDANT_FOOD_ENTRY_KEYS),
      ...Object.fromEntries(foodNutritionKeys().map(key => [key, null])),
      ...updates,
    });
    const updated = this.canonicalHandle(await api.updateFromSource({path: entry.file.path, id: entry.id},
      Object.keys(nutritionKeys), (frontmatter) => {
        if (!this.isEnabled()) return null;
        const current = decodeNativeRecordFrontmatter(this.plugin.settings, frontmatter);
        if (String(current.tpsId || '') !== entry.id || canonicalNativeKind(this.plugin.settings, current.kind) !== 'food-entry') return null;
        if (current.archived === true) return null;
        if (expectedFoodPath && this.resolveFoodSourcePath(foodReference(current), entry.file.path) !== expectedFoodPath) return null;
        const projected = this.projectFoodEntry({ ...current, ...updates }, entry.file.path);
        return encodeNativeRecordProperties(this.plugin.settings, {
          ...updates,
          ...(projected ? {
            ...clearProperties(REDUNDANT_FOOD_ENTRY_KEYS),
            ...foodNutritionStorageValues(projected.frontmatter, true),
          } : {}),
        });
      }, {kind: expectedFoodPath ? 'automation' : 'user', sourcePluginId: this.plugin.manifest.id,
        surface: expectedFoodPath ? 'health-food-definition-edit' : 'health-daily-food-edit'}));
    if (updated) this.trackHandle(updated);
    return updated;
  }

  private emitChange(path: string, previous: IndexedHealthRecord | null | undefined, current: IndexedHealthRecord | null): void {
    const kinds = [...new Set([previous?.kind, current?.kind].filter((kind): kind is NativeHealthKind => !!kind))];
    const dates = [...new Set([
      ...(previous?.dailyDates || []),
      ...(current?.dailyDates || []),
    ])];
    if (!kinds.length) return;
    if (kinds.includes('workout-session') || kinds.includes('workout-exercise')) {
      this.plugin.scheduleWorkoutActionBars();
    }
    const change = { path, kinds, dates };
    for (const listener of this.changeListeners) listener(change);
  }

  private getKindRecords(kind: NativeHealthKind): IndexedHealthRecord[] {
    return [...(this.pathsByKind.get(kind) || [])].map((path) => this.recordsByPath.get(path)).filter((record): record is IndexedHealthRecord => !!record);
  }

  private getKindDateRecords(kind: NativeHealthKind, dateIso: string): IndexedHealthRecord[] {
    return [...(this.pathsByDate.get(dateIso) || [])]
      .map((path) => this.recordsByPath.get(path))
      .filter((record): record is IndexedHealthRecord => !!record && record.kind === kind);
  }

  private addDailyPath(record: IndexedHealthRecord): void {
    if (record.frontmatter.archived === true || record.kind === 'workout-exercise') return;
    for (const date of record.dailyDates) {
      const paths = this.pathsByDate.get(date) || new Set<string>();
      paths.add(record.file.path);
      this.pathsByDate.set(date, paths);
    }
  }

  private removeDailyPath(record: IndexedHealthRecord, path = record.file.path): void {
    for (const date of record.dailyDates) {
      const paths = this.pathsByDate.get(date);
      paths?.delete(path);
      if (paths?.size === 0) this.pathsByDate.delete(date);
    }
  }

  private trackHandle(handle: NativeRecordHandle): void {
    this.indexFile(handle.file, handle.frontmatter);
  }

  private toHandle(record: IndexedHealthRecord): NativeRecordHandle {
    return { file: record.file, path: record.file.path, id: record.id, kind: record.kind, frontmatter: { ...record.frontmatter } };
  }
}

const NUTRITION_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sugarAlcoholG', 'alcoholG', 'sodiumMg'] as const;

function zeroNutritionTotals(): NutritionTotals {
  return {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0,
    sugarAlcoholG: 0,
    sugarAlcoholCaloriesPerG: 0,
    alcoholG: 0,
    sodiumMg: 0,
  };
}

export function parseLegacyInlineFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const matcher = /\[([^:\]]+)::\s*([^\]]*)\]/gu;
  for (const match of line.matchAll(matcher)) {
    const key = String(match[1] || '').trim();
    if (key && fields[key] == null) fields[key] = String(match[2] || '').trim();
  }
  return fields;
}

function legacyNumber(value: unknown): number | undefined {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function legacyDateKey(value: string, fallbackPath: string): string {
  const resolved = dateKey(value);
  if (resolved) return resolved;
  const match = fallbackPath.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})(?:\.md)?$/u);
  return match?.[1] || '';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
