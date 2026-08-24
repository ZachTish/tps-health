import { TFile } from 'obsidian';
import type TPSHealthPlugin from './main';
import type { ActivityLogEntry, FoodLogEntry, Nutrition, WorkoutSet } from './types';

export const TPS_HEALTH_NATIVE_RECORDS_VERSION = 1;

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
}

interface IndexedHealthRecord {
  file: TFile;
  frontmatter: Record<string, unknown>;
  id: string;
  kind: NativeHealthKind;
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

interface LegacyHealthCandidate {
  id: string;
  kind: NativeHealthKind;
  properties: Record<string, unknown>;
  sourcePath: string;
  lineNumber: number;
}

const HEALTH_KINDS = new Set<NativeHealthKind>(['food-entry', 'activity-entry', 'workout-session', 'workout-exercise']);

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateKey = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
};

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
      foodId: entry.id,
      foodPath: entry.item.sourcePath,
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
      workoutId: recordId,
      date: dateKey(startedAt),
      exerciseRecordIds: [],
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
    const exerciseRecordIds = Array.from(new Set([
      ...(Array.isArray(session.frontmatter.exerciseRecordIds) ? session.frontmatter.exerciseRecordIds.map(String) : []),
      updatedExercise.id,
    ]));
    const updatedSession = await api.update(session.file, {
      exerciseRecordIds,
      setCount: numberValue(session.frontmatter.setCount) + 1,
      lastSetEndedAt: set.completedDate || set.endedAt,
    }, { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-set' });
    if (!updatedSession) throw new Error('Workout session changed before the set count could be saved.');
    this.trackHandle(updatedSession);
    return { session: updatedSession, exercise: updatedExercise };
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
    const created = await api.create('workout-exercise', {
      title: name,
      workoutId: session.id,
      workoutPath: session.path,
      exercise: name,
      exercisePath,
      sets: [],
      setCount: 0,
      totalReps: 0,
      totalVolume: 0,
      tags: ['health', 'workout-exercise'],
    }, { cause: { kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-exercise' } });
    this.trackHandle(created);
    const exerciseRecordIds = Array.from(new Set([
      ...(Array.isArray(session.frontmatter.exerciseRecordIds) ? session.frontmatter.exerciseRecordIds.map(String) : []),
      created.id,
    ]));
    const updatedSession = await api.update(session.file, { exerciseRecordIds }, {
      kind: 'user', sourcePluginId: this.plugin.manifest.id, surface: 'health-workout-exercise',
    });
    if (updatedSession) this.trackHandle(updatedSession);
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
    const matches = this.getKindRecords('workout-exercise').filter((record) => (
      String(record.frontmatter.workoutId || '') === workoutId
      && String(record.frontmatter.exercise || record.frontmatter.title || '').trim().toLocaleLowerCase() === key
    ));
    return matches.length === 1 ? this.toHandle(matches[0]) : null;
  }

  getWorkoutExerciseNames(workoutId: string): string[] {
    return this.getKindRecords('workout-exercise')
      .filter((record) => String(record.frontmatter.workoutId || '') === workoutId)
      .map((record) => String(record.frontmatter.exercise || record.frontmatter.title || '').trim())
      .filter(Boolean);
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
        const record = await api.create(candidate.kind, {
          ...candidate.properties,
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
              foodId: id,
              foodPath: fields.foodPath,
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
              workoutId: isWorkout ? currentWorkoutId : undefined,
              workoutPath: fields.workoutPath,
              workoutPlanPath: fields.workoutPlanPath,
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
            candidate = {
              id: `legacy-exercise-${stableHash(key)}`,
              kind: 'workout-exercise',
              sourcePath: file.path,
              lineNumber: index,
              properties: {
                title: exercise,
                workoutId,
                exercise,
                exercisePath: fields.exercisePath,
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
    const kind = String(resolved?.kind || '') as NativeHealthKind;
    const recordId = String(resolved?.tpsId || '').trim();
    if (!recordId || Number(resolved?.tpsSchemaVersion) !== 1 || !HEALTH_KINDS.has(kind)) return;
    const record = { file, frontmatter: { ...resolved }, id: recordId, kind };
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
