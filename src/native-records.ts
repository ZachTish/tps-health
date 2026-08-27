import { getFrontMatterInfo, parseYaml, TFile } from 'obsidian';
import type TPSHealthPlugin from './main';
import { isoDateKey } from './format';
import * as logger from './logger';
import type { ActivityLogEntry, FoodLogEntry, Nutrition, WorkoutSet } from './types';

export const TPS_HEALTH_NATIVE_RECORDS_VERSION = 3;
const WORKOUT_DATA_VERSION = 1;

type NativeHealthKind = 'food-entry' | 'activity-entry' | 'workout-session' | 'workout-exercise';

export interface NativeRecordHandle {
  file: TFile;
  path: string;
  id: string;
  kind: NativeHealthKind;
  frontmatter: Record<string, unknown>;
}

interface NativeRecordsApi {
  version: number;
  isEnabled(): boolean;
  create(kind: NativeHealthKind, properties: Record<string, unknown>, options?: Record<string, unknown>): Promise<NativeRecordHandle>;
  resolve(reference: string | TFile | { path?: string; id?: string; tpsId?: string }): Promise<NativeRecordHandle | null>;
  update(reference: string | TFile | { path?: string; id?: string; tpsId?: string }, updates: Record<string, unknown>, cause?: Record<string, unknown>): Promise<NativeRecordHandle | null>;
  rename?(reference: string | TFile | { path?: string; id?: string; tpsId?: string }, fileName: string, cause?: Record<string, unknown>): Promise<NativeRecordHandle | null>;
  inspect?(frontmatter: unknown): {
    id: string;
    kind: string;
    schemaVersion: number;
    frontmatter: Record<string, unknown>;
  } | null;
}

interface IndexedHealthRecord {
  file: TFile;
  frontmatter: Record<string, unknown>;
  id: string;
  kind: NativeHealthKind;
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
  completedDate: string;
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
}

export interface NativeWorkoutExerciseSnapshot {
  id: string;
  path: string;
  name: string;
  exercisePath: string;
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
  sets: Array<Record<string, unknown>>;
}

interface StoredWorkoutData {
  version: number;
  exercises: StoredWorkoutExercise[];
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
  totals: Required<Nutrition>;
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

interface LegacyHealthCandidate {
  id: string;
  kind: NativeHealthKind;
  properties: Record<string, unknown>;
  sourcePath: string;
  lineNumber: number;
  workoutReferenceId?: string;
}

const HEALTH_KINDS = new Set<NativeHealthKind>(['food-entry', 'activity-entry', 'workout-session', 'workout-exercise']);
const FOOD_NUTRITION_KEYS = [
  'calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sugarAlcoholG', 'alcoholG', 'sodiumMg',
] as const;
const FOOD_PROJECTION_DEBOUNCE_MS = 120;

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

const workoutTitleWithoutRepeatedDate = (title: string, date: string): string => {
  if (!title || !date) return title;
  const escaped = date.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return title
    .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'u'), ' ')
    .replace(/\s+/gu, ' ')
    .trim() || title;
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
  if (kind === 'workout-session') {
    const date = strictDateKey(properties.date, properties.workoutDate, properties.startedAt, properties.createdDate);
    const title = workoutTitleWithoutRepeatedDate(readableTitle(properties.title, 'Workout'), date);
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

const storedWorkoutSets = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((set): set is Record<string, unknown> => !!set && typeof set === 'object' && !Array.isArray(set))
    .map((set) => ({ ...set }))
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
    const name = String(record.name || record.exercise || record.title || '').trim();
    if (!name) return [];
    return [{
      id: String(record.id || `exercise-${index + 1}`).trim() || `exercise-${index + 1}`,
      name,
      exercisePath: wikilinkPath(record.exercisePath),
      sets: storedWorkoutSets(record.sets),
    }];
  });
};

const workoutDataValue = (exercises: StoredWorkoutExercise[]): string => JSON.stringify({
  version: WORKOUT_DATA_VERSION,
  exercises: exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    exercisePath: exercise.exercisePath || '',
    sets: exercise.sets.map((set) => ({ ...set })),
  })),
} as StoredWorkoutData);

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

const dateKey = (value: unknown): string => {
  const raw = String(value || '').trim();
  return raw ? isoDateKey(raw) : '';
};

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
  nutrition: Record<(typeof FOOD_NUTRITION_KEYS)[number], number>;
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
  const grams = positiveNumber(food.servingGrams);
  if (grams) return { amount: grams, unit: 'g' };
  const ml = positiveNumber(food.servingMl);
  if (ml) return { amount: ml, unit: 'ml' };
  const amount = positiveNumber(food.servingAmount, 1);
  return metricAmount(amount, normalizedUnit(food.servingUnit));
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
    servings = unit === 'serving' ? quantity : quantity / servingAmount;
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
  const nutrition = Object.fromEntries(FOOD_NUTRITION_KEYS.map((key) => (
    [key, stableNumber(numberValue(food[key]) * servings)]
  ))) as NativeFoodEntryProjection['nutrition'];
  return {
    servings: stableNumber(servings),
    amount: amount == null ? undefined : stableNumber(amount),
    amountUnit,
    nutrition,
  };
}

/** Incremental frontmatter index plus the narrow GCM native-record bridge. */
export class HealthNativeRecordService {
  readonly version = TPS_HEALTH_NATIVE_RECORDS_VERSION;
  private readonly recordsByPath = new Map<string, IndexedHealthRecord>();
  private readonly pathsByKind = new Map<NativeHealthKind, Set<string>>();
  private readonly entryPathsByFoodPath = new Map<string, Set<string>>();
  private readonly foodDefinitionsByPath = new Map<string, Record<string, unknown>>();
  private readonly changeListeners = new Set<(change: NativeHealthRecordChange) => void>();
  private readonly refreshGenerations = new Map<string, number>();
  private readonly foodProjectionTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  private readonly foodProjectionGenerations = new Map<string, number>();
  private workoutIndexReady = false;

  constructor(private readonly plugin: TPSHealthPlugin) {}

  setup(): void {
    this.rebuild();
    const metadataCache = this.plugin.app.metadataCache;
    const vault = this.plugin.app.vault;
    const metadataInitialized = (metadataCache as unknown as { initialized?: boolean })?.initialized === true;
    this.workoutIndexReady = this.plugin.app.workspace?.layoutReady === true && metadataInitialized;
    if (typeof metadataCache?.on !== 'function' || typeof vault?.on !== 'function') return;

    this.plugin.registerEvent(metadataCache.on('changed', (file, _data, cache) => this.indexFile(file, cache?.frontmatter)));
    this.plugin.registerEvent(metadataCache.on('resolved', () => {
      this.rebuild();
      this.workoutIndexReady = true;
      this.plugin.scheduleWorkoutActionBars();
    }));
    this.plugin.app.workspace?.onLayoutReady?.(() => {
      this.rebuild();
      this.workoutIndexReady = (metadataCache as unknown as { initialized?: boolean })?.initialized === true;
      this.plugin.scheduleWorkoutActionBars();
    });
    this.plugin.registerEvent(vault.on('create', (file) => {
      if (file instanceof TFile) void this.refreshFile(file);
    }));
    this.plugin.registerEvent(vault.on('modify', (file) => {
      if (file instanceof TFile) void this.refreshFile(file);
    }));
    this.plugin.registerEvent(vault.on('delete', (file) => {
      if (file instanceof TFile) {
        const deleted = this.recordsByPath.get(file.path);
        const legacyChildren = deleted?.kind === 'workout-session'
          ? this.getWorkoutExerciseRecords(deleted)
          : [];
        this.foodDefinitionsByPath.delete(file.path);
        this.removePath(file.path);
        if (legacyChildren.length) void this.trashLegacyWorkoutChildren(deleted!, legacyChildren, 'health-workout-delete');
      }
    }));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
      this.foodDefinitionsByPath.delete(oldPath);
      this.removePath(oldPath);
      if (file instanceof TFile) this.indexFile(file);
    }));
  }

  isEnabled(): boolean {
    return this.plugin.settings.storageMode === 'native-records';
  }

  isWorkoutIndexSettled(): boolean {
    return this.workoutIndexReady && this.refreshGenerations.size === 0;
  }

  dispose(): void {
    for (const timer of this.foodProjectionTimers.values()) globalThis.clearTimeout(timer);
    this.foodProjectionTimers.clear();
    this.foodProjectionGenerations.clear();
  }

  onRecordsChanged(listener: (change: NativeHealthRecordChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  requireApi(): NativeRecordsApi {
    const api = this.plugin.getGcmNativeRecordsApi();
    if (!api || Number(api.version) < 1 || api.isEnabled?.() !== true) {
      throw new Error('TPS Health native records require TPS GCM native-record mode and nativeRecords API v1.');
    }
    return api as NativeRecordsApi;
  }

  async createFoodEntry(entry: FoodLogEntry): Promise<NativeRecordHandle> {
    const nutrition = entry.nutritionOverride || entry.item.nutrition || {};
    const authoredQuantity = positiveNumber(entry.servingQuantity, entry.quantity);
    const authoredUnit = String(entry.servingUnit || entry.unit || 'serving').trim() || 'serving';
    const properties = {
      title: entry.item.name,
      status: 'complete',
      completedDate: entry.completedDate || entry.createdDate,
      date: dateKey(entry.completedDate || entry.createdDate),
      foodPath: this.recordLink(entry.item.sourcePath),
      foodName: entry.item.name,
      brand: entry.item.brand,
      quantity: authoredQuantity,
      unit: authoredUnit,
      amount: entry.amount,
      amountUnit: entry.amountUnit,
      calories: numberValue(nutrition.calories),
      proteinG: numberValue(nutrition.proteinG),
      carbsG: numberValue(nutrition.carbsG),
      fatG: numberValue(nutrition.fatG),
      fiberG: numberValue(nutrition.fiberG),
      sugarG: numberValue(nutrition.sugarG),
      sugarAlcoholG: numberValue(nutrition.sugarAlcoholG),
      alcoholG: numberValue(nutrition.alcoholG),
      sodiumMg: numberValue(nutrition.sodiumMg),
      note: entry.note,
      tags: ['health', 'food-log'],
    };
    const api = this.requireApi();
    const record = await api.create('food-entry', properties, {
      id: entry.id,
      now: new Date(entry.createdDate),
      fileName: Number(api.version) >= 3 ? buildNativeHealthRecordFileName('food-entry', properties) : undefined,
      cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-food-log' },
    });
    this.trackHandle(record);
    return record;
  }

  async createActivityEntry(entry: ActivityLogEntry): Promise<NativeRecordHandle> {
    const record = await this.requireApi().create('activity-entry', {
      title: entry.activity,
      status: 'complete',
      activity: entry.activity,
      activityType: entry.activityType,
      startedAt: entry.startedAt,
      completedDate: entry.completedDate,
      date: dateKey(entry.completedDate),
      durationMinutes: entry.durationMinutes,
      distance: entry.distance,
      distanceUnit: entry.distanceUnit,
      steps: entry.steps,
      caloriesBurned: entry.caloriesBurned,
      source: entry.source,
      sourceId: entry.sourceId,
      device: entry.device,
      note: entry.note,
      tags: ['health', 'activity'],
    }, {
      id: entry.id,
      now: new Date(entry.startedAt),
      cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-activity-log' },
    });
    this.trackHandle(record);
    return record;
  }

  async createWorkoutSession(properties: Record<string, unknown>, recordId: string): Promise<NativeRecordHandle> {
    const startedAt = String(properties.startedAt || new Date().toISOString());
    const recordProperties = {
      ...properties,
      status: 'active',
      date: dateKey(properties.workoutDate || startedAt),
      workoutData: workoutDataValue([]),
      exerciseCount: 0,
      setCount: 0,
      totalReps: 0,
      totalVolume: 0,
      tags: ['health', 'workout'],
    };
    const api = this.requireApi();
    const record = await api.create('workout-session', recordProperties, {
      id: recordId,
      now: new Date(startedAt),
      fileName: Number(api.version) >= 3 ? buildNativeHealthRecordFileName('workout-session', recordProperties) : undefined,
      cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-start' },
    });
    this.trackHandle(record);
    return record;
  }

  async appendWorkoutSet(sessionReference: string | TFile, set: WorkoutSet): Promise<{ session: NativeRecordHandle; exercise: NativeRecordHandle }> {
    const api = this.requireApi();
    const session = await api.resolve(sessionReference);
    if (!session || session.kind !== 'workout-session') throw new Error('Active native workout session was not found.');
    const exerciseName = String(set.exercise || '').trim();
    if (!exerciseName) throw new Error('Workout exercise name is required.');
    const { exercises: priorExercises, legacyChildren } = await this.workoutExercisesForWrite(session);
    const exerciseKey = exerciseName.toLocaleLowerCase();
    let targetIndex = priorExercises.findIndex((exercise) => exercise.name.toLocaleLowerCase() === exerciseKey);
    const exercises = priorExercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((storedSet) => ({ ...storedSet })) }));
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
    exercises[targetIndex].sets.push({ ...set });
    const aggregates = workoutAggregates(exercises);
    const updatedSession = await api.update(session.file, {
      workoutData: workoutDataValue(exercises),
      ...aggregates,
      lastSetEndedAt: set.completedDate || set.endedAt,
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-set' });
    if (!updatedSession) throw new Error('Workout session changed before the set could be saved.');
    this.trackHandle(updatedSession);
    if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updatedSession, legacyChildren, 'health-workout-storage-upgrade');
    return { session: updatedSession, exercise: this.embeddedExerciseHandle(updatedSession, exercises[targetIndex]) };
  }

  async updateWorkoutSet(
    exerciseReference: string | TFile,
    setId: string,
    patch: NativeWorkoutSetPatch,
  ): Promise<NativeRecordHandle> {
    const api = this.requireApi();
    const reference = await api.resolve(exerciseReference);
    const session = reference?.kind === 'workout-session'
      ? reference
      : reference?.kind === 'workout-exercise'
        ? this.findWorkoutSessionHandleForExercise(reference)
        : null;
    if (!session) throw new Error('Workout session was not found.');
    const expectedSetId = String(setId || '').trim();
    if (!expectedSetId) throw new Error('Workout set identity was missing.');
    const { exercises: priorExercises, legacyChildren } = await this.workoutExercisesForWrite(session);
    const matches = priorExercises.flatMap((exercise, exerciseIndex) => exercise.sets.flatMap((set, setIndex) => (
      String(set.id || '') === expectedSetId ? [{ exerciseIndex, setIndex }] : []
    )));
    if (matches.length !== 1) throw new Error(matches.length ? 'Workout set identity was ambiguous.' : 'Workout set was not found.');
    const { exerciseIndex, setIndex } = matches[0];
    const exercises = priorExercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => ({ ...set })) }));
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
    exercises[exerciseIndex].sets[setIndex] = nextSet;
    const updated = await api.update(session.file, {
      workoutData: workoutDataValue(exercises),
      ...workoutAggregates(exercises),
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-set-inline' });
    if (!updated) throw new Error('Workout session changed before the set edit could be saved.');
    this.trackHandle(updated);
    if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
    return updated;
  }

  async ensureWorkoutExercise(
    sessionReference: string | TFile | NativeRecordHandle,
    exerciseName: string,
    exercisePath?: string,
  ): Promise<NativeRecordHandle> {
    const api = this.requireApi();
    const session = typeof sessionReference === 'object' && sessionReference !== null && 'kind' in sessionReference
      ? sessionReference as NativeRecordHandle
      : await api.resolve(sessionReference as string | TFile);
    if (!session || session.kind !== 'workout-session') throw new Error('Active native workout session was not found.');
    const name = exerciseName.trim();
    if (!name) throw new Error('Workout exercise name is required.');
    const { exercises: priorExercises, legacyChildren } = await this.workoutExercisesForWrite(session);
    const existingIndex = priorExercises.findIndex((exercise) => exercise.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const existing = existingIndex >= 0 ? priorExercises[existingIndex] : undefined;
    const definitionPath = wikilinkPath(exercisePath) || existing?.exercisePath || '';
    if (!definitionPath) throw new Error('A reusable exercise note is required before adding it to a workout.');
    if (existing && existing.exercisePath === definitionPath && !legacyChildren.length && Object.prototype.hasOwnProperty.call(session.frontmatter, 'workoutData')) {
      return this.embeddedExerciseHandle(session, existing);
    }
    const exercises = priorExercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => ({ ...set })) }));
    const target = existing || {
      id: `workout-exercise-${stableHash(`${session.id}\u0000${name.toLocaleLowerCase()}`)}`,
      name,
      exercisePath: definitionPath,
      sets: [],
    };
    if (!existing) exercises.push(target);
    else exercises[existingIndex].exercisePath = definitionPath;
    const updated = await api.update(session.file, {
      workoutData: workoutDataValue(exercises),
      ...workoutAggregates(exercises),
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-exercise' });
    if (!updated) throw new Error('Workout session changed before the exercise could be added.');
    this.trackHandle(updated);
    if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
    return this.embeddedExerciseHandle(updated, target);
  }

  async finishWorkout(reference: string | TFile, updates: Record<string, unknown>): Promise<NativeRecordHandle> {
    const api = this.requireApi();
    const session = await api.resolve(reference);
    if (!session || session.kind !== 'workout-session') throw new Error('Native workout session was not found.');
    const { exercises, legacyChildren } = await this.workoutExercisesForWrite(session);
    const updated = await api.update(session.file, {
      ...updates,
      status: 'complete',
      workoutData: workoutDataValue(exercises),
      ...workoutAggregates(exercises),
    }, {
      kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-finish',
    });
    if (!updated) throw new Error('Native workout session was not found.');
    this.trackHandle(updated);
    if (legacyChildren.length) await this.trashLegacyWorkoutChildren(updated, legacyChildren, 'health-workout-storage-upgrade');
    return updated;
  }

  async discardWorkout(reference: string | TFile): Promise<NativeRecordHandle> {
    const updated = await this.requireApi().update(reference, {
      status: 'discarded', archived: true, archivedDate: new Date().toISOString(),
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-discard' });
    if (!updated) throw new Error('Native workout session was not found.');
    this.trackHandle(updated);
    return updated;
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
    serialize: <T>(path: string, mutation: () => Promise<T>) => Promise<T> = async (_path, mutation) => mutation(),
    resolveDefinition?: WorkoutExerciseDefinitionResolver,
  ): Promise<NativeWorkoutStorageResult> {
    const api = this.requireApi();
    const plan = this.planWorkoutStorageConsolidation();
    let consolidated = 0;
    let trashed = 0;
    let failed = 0;
    const sessions = this.getKindRecords('workout-session').slice()
      .sort((left, right) => left.file.path.localeCompare(right.file.path));
    for (const indexed of sessions) {
      try {
        const result = await serialize(indexed.file.path, async () => {
          const current = this.recordsByPath.get(indexed.file.path);
          if (!current || current.kind !== 'workout-session') return null;
          const children = this.getWorkoutExerciseRecords(current);
          if (!children.length) return null;
          const exercises = await this.ensureWorkoutExerciseDefinitionPaths(
            this.workoutExercisesForRead(current),
            resolveDefinition,
          );
          const updated = await api.update(current.file, {
            workoutData: workoutDataValue(exercises),
            ...workoutAggregates(exercises),
          }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-storage-consolidation' });
          if (!updated) throw new Error('Workout session changed before storage consolidation.');
          this.trackHandle(updated);
          const cleanup = await this.trashLegacyWorkoutChildren(updated, children, 'health-workout-storage-consolidation');
          return cleanup;
        });
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
      startedAt: String(record.frontmatter.startedAt || '').trim(),
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
        completedDate: String(set.completedDate || set.endedAt || ''),
        note: String(set.note || ''),
      }));
      return {
        id: exercise.id,
        path: session.file.path,
        name: exercise.name,
        exercisePath: exercise.exercisePath,
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
      startedAt: String(session.frontmatter.startedAt || ''),
      endedAt: String(session.frontmatter.endedAt || ''),
      exerciseCount: exercises.length,
      setCount: exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
      exercises,
    };
  }

  getDailyFoodTotals(dateIso: string): Required<Nutrition> & { entryCount: number } {
    const records = this.getKindRecords('food-entry').filter((record) => (
      record.frontmatter.archived !== true && dateKey(record.frontmatter.date || record.frontmatter.completedDate) === dateIso
    ));
    const totals = {
      calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0,
      sugarAlcoholG: 0, sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 0,
    };
    for (const record of records) {
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += numberValue(record.frontmatter[key]);
    }
    return { entryCount: records.length, ...totals };
  }

  getDailyActivityTotals(dateIso: string): NativeDailyActivityTotals {
    const activityRecords = this.getKindRecords('activity-entry').filter((record) => (
      record.frontmatter.archived !== true && dateKey(record.frontmatter.date || record.frontmatter.completedDate) === dateIso
    ));
    const workoutRecords = this.getKindRecords('workout-session').filter((record) => (
      record.frontmatter.archived !== true && dateKey(record.frontmatter.date || record.frontmatter.workoutDate || record.frontmatter.completedDate) === dateIso
    ));
    let durationMinutes = 0;
    let caloriesBurned = 0;
    let steps = 0;
    for (const record of [...activityRecords, ...workoutRecords]) {
      const duration = numberValue(record.frontmatter.durationMinutes)
        || numberValue(record.frontmatter.timeEstimate)
        || numberValue(record.frontmatter.durationSeconds) / 60;
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
    const api = this.requireApi();
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
        const foodLink = this.recordLink(record.frontmatter.foodPath);
        if (foodLink && foodLink !== record.frontmatter.foodPath) updates.foodPath = foodLink;
      } else if (record.kind === 'workout-session') {
        const legacyWorkoutId = String(record.frontmatter.workoutId || '').trim();
        if (legacyWorkoutId && legacyWorkoutId !== record.id) {
          skipped += 1;
          continue;
        }
        if (legacyWorkoutId === record.id) updates.workoutId = null;
        if (Object.prototype.hasOwnProperty.call(record.frontmatter, 'exerciseRecordIds')) updates.exerciseRecordIds = null;
        const planLink = this.recordLink(record.frontmatter.workoutPlanPath);
        if (planLink && planLink !== record.frontmatter.workoutPlanPath) updates.workoutPlanPath = planLink;
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
      const result = await api.update(record.file, updates, {
        kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-identity-normalization',
      });
      if (result) {
        this.trackHandle(result);
        updated += 1;
      } else skipped += 1;
    }
    return { inspected: records.length, updated, skipped };
  }

  /**
   * Explicitly replace only opaque ID filenames. User-renamed files are left
   * untouched, and GCM owns atomic renames, link updates, and collision suffixes.
   */
  async normalizeNativeRecordFilenames(): Promise<NativeFilenameNormalizationResult> {
    const api = this.requireApi();
    if (Number(api.version) < 3 || typeof api.rename !== 'function') {
      throw new Error('Readable Health filenames require TPS Global Context Menu 1.43.1 or newer.');
    }
    const records = [...this.recordsByPath.values()]
      .filter((record) => record.kind === 'food-entry' || record.kind === 'workout-session' || record.kind === 'workout-exercise')
      .sort((left, right) => left.file.path.localeCompare(right.file.path) || left.id.localeCompare(right.id));
    const targets = records.map((record) => {
      const session = record.kind === 'workout-exercise'
        ? this.getKindRecords('workout-session').filter((candidate) => this.recordBelongsToWorkout(record, candidate))
        : [];
      const sessionDate = session.length === 1
        ? session[0].frontmatter.date || session[0].frontmatter.workoutDate || session[0].frontmatter.startedAt
        : undefined;
      return {
        record,
        opaque: record.file.basename === record.id,
        fileName: buildNativeHealthRecordFileName(record.kind, record.frontmatter, { date: sessionDate }),
      };
    });
    let renamed = 0;
    let unchanged = 0;
    let failed = 0;
    const renamedPaths: Record<string, string> = {};
    for (const target of targets) {
      if (!target.opaque || target.record.file.basename !== target.record.id) {
        unchanged += 1;
        continue;
      }
      if (!target.fileName) {
        failed += 1;
        continue;
      }
      const oldPath = target.record.file.path;
      try {
        const result = await api.rename(target.record.file, target.fileName, {
          kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-readable-filenames',
        });
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
      const existing = this.findRecordById(candidate.id) || await api.resolve(candidate.id);
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        const properties = { ...candidate.properties };
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
          const linkedExercises = await this.ensureWorkoutExerciseDefinitionPaths(exercises, resolveDefinition);
          properties.workoutData = workoutDataValue(linkedExercises);
          Object.assign(properties, workoutAggregates(linkedExercises));
        }
        const persistedProperties = {
          ...properties,
          legacySourcePath: candidate.sourcePath,
          legacySourceLine: candidate.lineNumber,
          legacyImportedAt: new Date().toISOString(),
        };
        const record = await api.create(candidate.kind, persistedProperties, {
          id: candidate.id,
          fileName: Number(api.version) >= 3
            ? buildNativeHealthRecordFileName(candidate.kind, persistedProperties) || undefined
            : undefined,
          cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-legacy-import' },
        });
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
              foodPath: this.recordLink(fields.foodPath),
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
              note: fields.note,
              tags: ['health', 'food-log'],
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
              workoutPlanPath: this.recordLink(fields.workoutPlanPath),
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
              tags: isWorkout ? ['health', 'workout'] : ['health', 'activity'],
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
                tags: ['health', 'workout-exercise'],
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

  private async workoutExercisesForWrite(session: NativeRecordHandle): Promise<{
    exercises: StoredWorkoutExercise[];
    legacyChildren: IndexedHealthRecord[];
  }> {
    const legacyChildren = this.getWorkoutExerciseRecords(session);
    return {
      exercises: await this.ensureWorkoutExerciseDefinitionPaths(this.workoutExercisesForRead(session)),
      legacyChildren,
    };
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
    });
    return this.getKindRecords('workout-exercise')
      .filter((record) => record.frontmatter.archived !== true && this.recordBelongsToWorkout(record, resolved));
  }

  private findRecordById(id: string): NativeRecordHandle | null {
    const matches = [...this.recordsByPath.values()].filter((record) => record.id === id);
    return matches.length === 1 ? this.toHandle(matches[0]) : null;
  }

  private rebuild(): void {
    this.recordsByPath.clear();
    this.pathsByKind.clear();
    this.entryPathsByFoodPath.clear();
    this.foodDefinitionsByPath.clear();
    const vault = this.plugin.app.vault;
    if (typeof vault?.getMarkdownFiles !== 'function') return;
    for (const file of vault.getMarkdownFiles()) this.indexFile(file);
  }

  private indexFile(file: TFile, frontmatter?: Record<string, unknown> | null): void {
    const previous = this.recordsByPath.get(file.path);
    this.removePath(file.path, false);
    const resolved = frontmatter || this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    const api = this.plugin.getGcmNativeRecordsApi() as NativeRecordsApi | null;
    const inspected = Number(api?.version) >= 2 && typeof api?.inspect === 'function'
      ? api.inspect(resolved)
      : null;
    const kind = String(inspected?.kind || resolved?.kind || '') as NativeHealthKind;
    const recordId = String(inspected?.id || resolved?.tpsId || '').trim();
    const schemaVersion = Number(inspected?.schemaVersion || resolved?.tpsSchemaVersion);
    if (!recordId || schemaVersion !== 1 || !HEALTH_KINDS.has(kind)) {
      if (resolved && this.entryPathsByFoodPath.has(file.path)) {
        this.foodDefinitionsByPath.set(file.path, { ...resolved });
        this.refreshLinkedFoodEntries(file.path);
      }
      if (previous) this.emitChange(file.path, previous, null);
      return;
    }
    const rawFrontmatter = { ...(inspected?.frontmatter || resolved) };
    const projected = kind === 'food-entry'
      ? this.projectFoodEntry(rawFrontmatter, file.path)
      : null;
    const record = {
      file,
      frontmatter: projected?.frontmatter || rawFrontmatter,
      id: recordId,
      kind,
    };
    this.recordsByPath.set(file.path, record);
    const paths = this.pathsByKind.get(kind) || new Set<string>();
    paths.add(file.path);
    this.pathsByKind.set(kind, paths);
    if (kind === 'food-entry') {
      const foodPath = this.resolveFoodSourcePath(record.frontmatter.foodPath, file.path);
      if (foodPath) {
        const entries = this.entryPathsByFoodPath.get(foodPath) || new Set<string>();
        entries.add(file.path);
        this.entryPathsByFoodPath.set(foodPath, entries);
      }
      if (projected?.needsPersist) this.scheduleFoodEntryProjection(file.path);
    }
    this.emitChange(file.path, previous, record);
  }

  private removePath(path: string, notify = true): void {
    const record = this.recordsByPath.get(path);
    this.recordsByPath.delete(path);
    if (!record) return;
    if (record.kind === 'food-entry') {
      const foodPath = this.resolveFoodSourcePath(record.frontmatter.foodPath, record.file.path);
      const entries = foodPath ? this.entryPathsByFoodPath.get(foodPath) : null;
      entries?.delete(path);
      if (foodPath && (!entries || entries.size === 0)) {
        this.entryPathsByFoodPath.delete(foodPath);
        this.foodDefinitionsByPath.delete(foodPath);
      }
      if (notify) {
        const timer = this.foodProjectionTimers.get(path);
        if (timer) globalThis.clearTimeout(timer);
        this.foodProjectionTimers.delete(path);
        this.foodProjectionGenerations.delete(path);
      }
    }
    const paths = this.pathsByKind.get(record.kind);
    paths?.delete(path);
    if (!paths || paths.size === 0) this.pathsByKind.delete(record.kind);
    if (notify) this.emitChange(path, record, null);
  }

  private async refreshFile(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    const generation = (this.refreshGenerations.get(file.path) || 0) + 1;
    this.refreshGenerations.set(file.path, generation);
    try {
      const content = await this.plugin.app.vault.read(file);
      if (this.refreshGenerations.get(file.path) !== generation) return;
      if (this.plugin.app.vault.getAbstractFileByPath(file.path) !== file) return;
      const info = getFrontMatterInfo(content);
      const parsed = info.exists ? parseYaml(info.frontmatter) : null;
      this.indexFile(file, parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null);
    } catch {
      // MetadataCache remains the safe eventual fallback for transient reads.
    } finally {
      if (this.refreshGenerations.get(file.path) === generation) this.refreshGenerations.delete(file.path);
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
    const foodPath = this.resolveFoodSourcePath(entry.foodPath, sourcePath);
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
      amount: projection.amount ?? null,
      amountUnit: projection.amountUnit ?? null,
      ...projection.nutrition,
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

  private refreshLinkedFoodEntries(foodPath: string): void {
    for (const entryPath of [...(this.entryPathsByFoodPath.get(foodPath) || [])]) {
      const previous = this.recordsByPath.get(entryPath);
      if (!previous || previous.kind !== 'food-entry') continue;
      const projected = this.projectFoodEntry(previous.frontmatter, entryPath);
      if (!projected) continue;
      const current = { ...previous, frontmatter: projected.frontmatter };
      this.recordsByPath.set(entryPath, current);
      this.emitChange(entryPath, previous, current);
      if (projected.needsPersist) this.scheduleFoodEntryProjection(entryPath);
    }
  }

  private scheduleFoodEntryProjection(path: string): void {
    const previousTimer = this.foodProjectionTimers.get(path);
    if (previousTimer) globalThis.clearTimeout(previousTimer);
    const generation = (this.foodProjectionGenerations.get(path) || 0) + 1;
    this.foodProjectionGenerations.set(path, generation);
    const timer = globalThis.setTimeout(() => {
      this.foodProjectionTimers.delete(path);
      void this.persistFoodEntryProjection(path, generation);
    }, FOOD_PROJECTION_DEBOUNCE_MS);
    this.foodProjectionTimers.set(path, timer);
  }

  private async persistFoodEntryProjection(path: string, generation: number): Promise<void> {
    if (this.foodProjectionGenerations.get(path) !== generation || !this.isEnabled()) return;
    try {
      const indexed = this.recordsByPath.get(path);
      if (!indexed || indexed.kind !== 'food-entry') return;
      const current = await this.requireApi().resolve(indexed.file);
      if (this.foodProjectionGenerations.get(path) !== generation) return;
      if (!current || current.kind !== 'food-entry') return;
      const projected = this.projectFoodEntry(current.frontmatter, current.path);
      if (!projected?.needsPersist) return;
      const updates: Record<string, unknown> = {
        amount: projected.frontmatter.amount ?? null,
        amountUnit: projected.frontmatter.amountUnit ?? null,
      };
      for (const key of FOOD_NUTRITION_KEYS) updates[key] = projected.frontmatter[key];
      const updated = await this.requireApi().update(current.file, updates, {
        kind: 'automation',
        sourcePluginId: this.plugin.manifest.id,
        surface: 'health-food-projection',
      });
      if (!updated) return;
      this.trackHandle(updated);
      logger.flow('NativeFoodProjection', 'reconcile:done', {
        path,
        foodPath: this.resolveFoodSourcePath(updated.frontmatter.foodPath, path),
        quantity: numberValue(updated.frontmatter.quantity),
        unit: String(updated.frontmatter.unit || ''),
        changedKeys: ['amount', 'amountUnit', ...FOOD_NUTRITION_KEYS],
      });
    } catch (error) {
      logger.flowError('NativeFoodProjection', 'reconcile:failed', error, { path });
    } finally {
      if (this.foodProjectionGenerations.get(path) === generation) this.foodProjectionGenerations.delete(path);
    }
  }

  private emitChange(path: string, previous: IndexedHealthRecord | null | undefined, current: IndexedHealthRecord | null): void {
    const kinds = [...new Set([previous?.kind, current?.kind].filter((kind): kind is NativeHealthKind => !!kind))];
    const dates = [...new Set([
      previous && dateKey(previous.frontmatter.date || previous.frontmatter.workoutDate || previous.frontmatter.completedDate),
      current && dateKey(current.frontmatter.date || current.frontmatter.workoutDate || current.frontmatter.completedDate),
    ].filter((date): date is string => !!date))];
    if (!kinds.length) return;
    const change = { path, kinds, dates };
    for (const listener of this.changeListeners) listener(change);
  }

  private getKindRecords(kind: NativeHealthKind): IndexedHealthRecord[] {
    return [...(this.pathsByKind.get(kind) || [])].map((path) => this.recordsByPath.get(path)).filter((record): record is IndexedHealthRecord => !!record);
  }

  private trackHandle(handle: NativeRecordHandle): void {
    this.indexFile(handle.file, handle.frontmatter);
  }

  private toHandle(record: IndexedHealthRecord): NativeRecordHandle {
    return { file: record.file, path: record.file.path, id: record.id, kind: record.kind, frontmatter: { ...record.frontmatter } };
  }
}

const NUTRITION_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sugarAlcoholG', 'alcoholG', 'sodiumMg'] as const;

function zeroNutritionTotals(): Required<Nutrition> {
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
