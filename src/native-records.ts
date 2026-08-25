import { TFile } from 'obsidian';
import type TPSHealthPlugin from './main';
import { isoDateKey } from './format';
import type { ActivityLogEntry, FoodLogEntry, Nutrition, WorkoutSet } from './types';

export const TPS_HEALTH_NATIVE_RECORDS_VERSION = 2;

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

interface LegacyHealthCandidate {
  id: string;
  kind: NativeHealthKind;
  properties: Record<string, unknown>;
  sourcePath: string;
  lineNumber: number;
  workoutReferenceId?: string;
}

const HEALTH_KINDS = new Set<NativeHealthKind>(['food-entry', 'activity-entry', 'workout-session', 'workout-exercise']);

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

/** Incremental frontmatter index plus the narrow GCM native-record bridge. */
export class HealthNativeRecordService {
  readonly version = TPS_HEALTH_NATIVE_RECORDS_VERSION;
  private readonly recordsByPath = new Map<string, IndexedHealthRecord>();
  private readonly pathsByKind = new Map<NativeHealthKind, Set<string>>();

  constructor(private readonly plugin: TPSHealthPlugin) {}

  setup(): void {
    this.rebuild();
    const metadataCache = this.plugin.app.metadataCache;
    const vault = this.plugin.app.vault;
    if (typeof metadataCache?.on !== 'function' || typeof vault?.on !== 'function') return;

    this.plugin.registerEvent(metadataCache.on('changed', (file, _data, cache) => this.indexFile(file, cache?.frontmatter)));
    this.plugin.registerEvent(metadataCache.on('resolved', () => {
      this.rebuild();
      this.plugin.scheduleWorkoutActionBars();
    }));
    this.plugin.app.workspace?.onLayoutReady?.(() => {
      this.rebuild();
      this.plugin.scheduleWorkoutActionBars();
    });
    this.plugin.registerEvent(vault.on('create', (file) => {
      if (file instanceof TFile) this.indexFile(file);
    }));
    this.plugin.registerEvent(vault.on('delete', (file) => {
      if (file instanceof TFile) this.removePath(file.path);
    }));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
      this.removePath(oldPath);
      if (file instanceof TFile) this.indexFile(file);
    }));
  }

  isEnabled(): boolean {
    return this.plugin.settings.storageMode === 'native-records';
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
    const record = await this.requireApi().create('food-entry', {
      title: entry.item.name,
      status: 'complete',
      completedDate: entry.completedDate || entry.createdDate,
      date: dateKey(entry.completedDate || entry.createdDate),
      foodPath: this.recordLink(entry.item.sourcePath),
      foodName: entry.item.name,
      brand: entry.item.brand,
      quantity: entry.quantity,
      unit: entry.unit,
      servingQuantity: entry.servingQuantity,
      servingUnit: entry.servingUnit,
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
    }, {
      id: entry.id,
      now: new Date(entry.createdDate),
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
    const record = await this.requireApi().create('workout-session', {
      ...properties,
      status: 'active',
      date: dateKey(properties.workoutDate || startedAt),
      setCount: 0,
      tags: ['health', 'workout'],
    }, {
      id: recordId,
      now: new Date(startedAt),
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
    let exercise = await this.ensureWorkoutExercise(session, exerciseName, set.exercisePath);
    const priorSets = Array.isArray(exercise.frontmatter.sets)
      ? exercise.frontmatter.sets.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
      : [];
    const sets = [...priorSets, { ...set }];
    const totalReps = sets.reduce((sum, current) => sum + numberValue(current.reps), 0);
    const totalVolume = sets.reduce((sum, current) => sum + numberValue(current.reps) * numberValue(current.weight) * (current.perArm === true ? 2 : 1), 0);
    const updatedExercise = await api.update(exercise.file, {
      sets,
      setCount: sets.length,
      totalReps,
      totalVolume,
      lastCompletedDate: set.completedDate || set.endedAt,
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-set' });
    if (!updatedExercise) throw new Error('Workout exercise record changed before the set could be saved.');
    this.trackHandle(updatedExercise);
    const updatedSession = await api.update(session.file, {
      setCount: numberValue(session.frontmatter.setCount) + 1,
      lastSetEndedAt: set.completedDate || set.endedAt,
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-set' });
    if (!updatedSession) throw new Error('Workout session changed before the set count could be saved.');
    this.trackHandle(updatedSession);
    return { session: updatedSession, exercise: updatedExercise };
  }

  async updateWorkoutSet(
    exerciseReference: string | TFile,
    setId: string,
    patch: NativeWorkoutSetPatch,
  ): Promise<NativeRecordHandle> {
    const api = this.requireApi();
    const exercise = await api.resolve(exerciseReference);
    if (!exercise || exercise.kind !== 'workout-exercise') throw new Error('Workout exercise record was not found.');
    const expectedSetId = String(setId || '').trim();
    if (!expectedSetId) throw new Error('Workout set identity was missing.');
    const priorSets = Array.isArray(exercise.frontmatter.sets)
      ? exercise.frontmatter.sets.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
      : [];
    const matchingIndexes = priorSets
      .map((set, index) => String(set.id || '') === expectedSetId ? index : -1)
      .filter((index) => index >= 0);
    if (matchingIndexes.length !== 1) throw new Error(matchingIndexes.length ? 'Workout set identity was ambiguous.' : 'Workout set was not found.');
    const targetIndex = matchingIndexes[0];
    const nextSet = { ...priorSets[targetIndex] };
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
    const sets = priorSets.map((set, index) => index === targetIndex ? nextSet : set);
    const totalReps = sets.reduce((sum, current) => sum + numberValue(current.reps), 0);
    const totalVolume = sets.reduce((sum, current) => sum + numberValue(current.reps) * numberValue(current.weight) * (current.perArm === true ? 2 : 1), 0);
    const updated = await api.update(exercise.file, {
      sets,
      setCount: sets.length,
      totalReps,
      totalVolume,
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-set-inline' });
    if (!updated) throw new Error('Workout exercise record changed before the set edit could be saved.');
    this.trackHandle(updated);
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
    const existing = this.findWorkoutExercise(session.id, name);
    if (existing) return existing;
    const exerciseOrder = this.getWorkoutExerciseRecords(session)
      .reduce((maximum, record) => Math.max(maximum, numberValue(record.frontmatter.exerciseOrder)), 0) + 1;
    const created = await api.create('workout-exercise', {
      title: name,
      workout: this.recordLink(session.path),
      exercise: name,
      exercisePath: this.recordLink(exercisePath),
      exerciseOrder,
      sets: [],
      setCount: 0,
      totalReps: 0,
      totalVolume: 0,
      tags: ['health', 'workout-exercise'],
    }, { cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-exercise' } });
    this.trackHandle(created);
    return created;
  }

  async finishWorkout(reference: string | TFile, updates: Record<string, unknown>): Promise<NativeRecordHandle> {
    const updated = await this.requireApi().update(reference, { ...updates, status: 'complete' }, {
      kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-finish',
    });
    if (!updated) throw new Error('Native workout session was not found.');
    this.trackHandle(updated);
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
    const matches = this.getKindRecords('workout-exercise').filter((record) => (
      this.recordBelongsToWorkout(record, session)
      && String(record.frontmatter.exercise || record.frontmatter.title || '').trim().toLocaleLowerCase() === key
    ));
    return matches.length === 1 ? this.toHandle(matches[0]) : null;
  }

  getWorkoutExerciseNames(workoutId: string): string[] {
    const session = this.findWorkoutSession(workoutId);
    if (!session) return [];
    return this.getWorkoutExerciseRecords(session)
      .map((record) => String(record.frontmatter.exercise || record.frontmatter.title || '').trim())
      .filter(Boolean);
  }

  isWorkoutSession(path: string, workoutId = ''): boolean {
    const record = this.recordsByPath.get(path);
    if (!record || record.kind !== 'workout-session') return false;
    const expectedId = workoutId.trim();
    return !expectedId
      || record.id === expectedId
      || String(record.frontmatter.workoutId || '').trim() === expectedId;
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
    const order = new Map(
      (Array.isArray(session.frontmatter.exerciseRecordIds) ? session.frontmatter.exerciseRecordIds : [])
        .map((value, index) => [String(value || ''), index] as const)
        .filter(([id]) => Boolean(id)),
    );
    const exerciseRecords = this.getWorkoutExerciseRecords(session)
      .sort((left, right) => {
        const authoredLeft = numberValue(left.frontmatter.exerciseOrder);
        const authoredRight = numberValue(right.frontmatter.exerciseOrder);
        const leftOrder = authoredLeft > 0 ? authoredLeft : (order.get(left.id) ?? Number.MAX_SAFE_INTEGER);
        const rightOrder = authoredRight > 0 ? authoredRight : (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
        return leftOrder - rightOrder || left.id.localeCompare(right.id) || left.file.path.localeCompare(right.file.path);
      });
    const exercises = exerciseRecords.map((record): NativeWorkoutExerciseSnapshot => {
      const rawSets = Array.isArray(record.frontmatter.sets)
        ? record.frontmatter.sets.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
        : [];
      const sets = rawSets.map((set, index): NativeWorkoutSetSnapshot => ({
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
        id: record.id,
        path: record.file.path,
        name: String(record.frontmatter.exercise || record.frontmatter.title || record.file.basename).trim() || record.file.basename,
        exercisePath: wikilinkPath(record.frontmatter.exercisePath),
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

  /** Read-only migration inventory. Legacy source files are never changed. */
  async planLegacyImport(): Promise<LegacyHealthImportPlan> {
    const candidates = await this.collectLegacyCandidates();
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
      if (this.findRecordById(candidate.id)) existing += 1;
    }
    return {
      candidates: candidates.records.length,
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
  async importLegacyRecords(): Promise<LegacyHealthImportResult> {
    const api = this.requireApi();
    const collected = await this.collectLegacyCandidates();
    const plan = await this.planLegacyImport();
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of collected.records) {
      const existing = this.findRecordById(candidate.id) || await api.resolve(candidate.id);
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        const properties = { ...candidate.properties };
        if (candidate.kind === 'workout-exercise') {
          const session = candidate.workoutReferenceId
            ? this.findRecordById(candidate.workoutReferenceId) || await api.resolve(candidate.workoutReferenceId)
            : null;
          if (!session || session.kind !== 'workout-session') {
            failed += 1;
            continue;
          }
          properties.workout = this.recordLink(session.path);
        }
        const record = await api.create(candidate.kind, {
          ...properties,
          legacySourcePath: candidate.sourcePath,
          legacySourceLine: candidate.lineNumber,
          legacyImportedAt: new Date().toISOString(),
        }, {
          id: candidate.id,
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
    const vault = this.plugin.app.vault;
    if (typeof vault?.getMarkdownFiles !== 'function') return;
    for (const file of vault.getMarkdownFiles()) this.indexFile(file);
  }

  private indexFile(file: TFile, frontmatter?: Record<string, unknown> | null): void {
    this.removePath(file.path);
    const resolved = frontmatter || this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    const api = this.plugin.getGcmNativeRecordsApi() as NativeRecordsApi | null;
    const inspected = Number(api?.version) >= 2 && typeof api?.inspect === 'function'
      ? api.inspect(resolved)
      : null;
    const kind = String(inspected?.kind || resolved?.kind || '') as NativeHealthKind;
    const recordId = String(inspected?.id || resolved?.tpsId || '').trim();
    const schemaVersion = Number(inspected?.schemaVersion || resolved?.tpsSchemaVersion);
    if (!recordId || schemaVersion !== 1 || !HEALTH_KINDS.has(kind)) return;
    const record = {
      file,
      frontmatter: { ...(inspected?.frontmatter || resolved) },
      id: recordId,
      kind,
    };
    this.recordsByPath.set(file.path, record);
    const paths = this.pathsByKind.get(kind) || new Set<string>();
    paths.add(file.path);
    this.pathsByKind.set(kind, paths);
  }

  private removePath(path: string): void {
    const record = this.recordsByPath.get(path);
    this.recordsByPath.delete(path);
    if (!record) return;
    const paths = this.pathsByKind.get(record.kind);
    paths?.delete(path);
    if (!paths || paths.size === 0) this.pathsByKind.delete(record.kind);
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
