import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/native-records.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'native-health-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'native-health-test' }, () => ({
          loader: 'js',
          contents: `
            export class TFile {
              static [Symbol.hasInstance](value) { return Boolean(value && value.extension && value.path); }
              constructor(path) { this.path = path; this.name = path.split('/').pop(); this.extension = this.name.split('.').pop(); this.basename = this.name.replace(/\\.[^.]+$/, ''); }
            }
            export function getFrontMatterInfo(content) {
              const match = content.match(/^---\\s*\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/);
              return match ? { exists: true, frontmatter: match[1], from: 4, to: 4 + match[1].length, contentStart: match[0].length } : { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
            }
            export function parseYaml(value) {
              const result = {};
              for (const line of value.split(/\\r?\\n/)) {
                const match = line.match(/^([A-Za-z0-9_-]+):\\s*(.*)$/);
                if (!match) continue;
                const raw = match[2].trim();
                result[match[1]] = /^-?\\d+(?:\\.\\d+)?$/.test(raw) ? Number(raw) : /^(true|false)$/.test(raw) ? raw === 'true' : raw.replace(/^['"]|['"]$/g, '');
              }
              return result;
            }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { HealthNativeRecordService, deriveNativeFoodEntryProjection, parseLegacyInlineFields } = await loadModule();
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const nativeWorkoutSurfaceSource = readFileSync(new URL('../src/native-workout-surface.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function createHarness(options = {}) {
  const files = new Map();
  const frontmatters = new Map();
  const contents = new Map();
  let generated = 0;
  const vaultEvents = new Map();
  const api = {
    version: options.apiVersion || 1,
    isEnabled: () => true,
    async create(kind, properties, options = {}) {
      const id = String(options.id || `${kind}-${++generated}`);
      const file = new (class TFile {
        constructor(path) { this.path = path; this.name = path.split('/').pop(); this.extension = 'md'; this.basename = this.name.replace(/\.md$/u, ''); }
      })(`_records/${kind}s/${id}.md`);
      const frontmatter = { ...properties, tpsId: id, tpsSchemaVersion: 1, kind, title: properties.title, createdDate: new Date().toISOString(), modifiedDate: new Date().toISOString() };
      files.set(file.path, file);
      frontmatters.set(file, frontmatter);
      return { file, path: file.path, id, kind, frontmatter };
    },
    async resolve(reference) {
      const path = typeof reference === 'string' && reference.includes('/') ? reference : reference?.path;
      const file = path ? files.get(path) : [...files.values()].find((candidate) => frontmatters.get(candidate)?.tpsId === reference);
      if (!file) return null;
      const frontmatter = frontmatters.get(file);
      return { file, path: file.path, id: frontmatter.tpsId, kind: frontmatter.kind, frontmatter: { ...frontmatter } };
    },
    async update(reference, updates) {
      const current = await this.resolve(reference);
      if (!current) return null;
      const frontmatter = { ...current.frontmatter };
      for (const [key, value] of Object.entries(updates)) {
        if (value == null) delete frontmatter[key];
        else frontmatter[key] = value;
      }
      frontmatter.modifiedDate = new Date().toISOString();
      frontmatters.set(current.file, frontmatter);
      return { ...current, frontmatter };
    },
    inspect(frontmatter) {
      const identityTag = Array.isArray(frontmatter?.tags)
        ? frontmatter.tags.find((tag) => String(tag).startsWith('tps/record/v1/'))
        : null;
      if (!identityTag) return null;
      const [, , , kind, ...idParts] = String(identityTag).split('/');
      const id = idParts.join('/');
      return id && kind
        ? { id, kind, schemaVersion: 1, frontmatter: { ...frontmatter, tpsId: id, tpsSchemaVersion: 1, kind } }
        : null;
    },
  };
  const plugin = {
    settings: { storageMode: 'native-records' },
    manifest: { id: 'tps-health' },
    app: {
      vault: {
        getMarkdownFiles: () => [...files.values()],
        cachedRead: async (file) => contents.get(file.path) || '',
        read: async (file) => contents.get(file.path) || '',
        getAbstractFileByPath: (path) => files.get(path) || null,
        on: (name, callback) => {
          const listeners = vaultEvents.get(name) || [];
          listeners.push(callback);
          vaultEvents.set(name, listeners);
          return {};
        },
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: frontmatters.get(file) }),
        getFirstLinkpathDest: (linkpath) => {
          const normalized = String(linkpath || '').replace(/^\[\[|\]\]$/gu, '').replace(/\.md$/u, '');
          return [...files.values()].find((candidate) => candidate.path.replace(/\.md$/u, '') === normalized) || null;
        },
        on: () => ({}),
      },
    },
    registerEvent: () => {},
    getGcmNativeRecordsApi: () => api,
  };
  const service = new HealthNativeRecordService(plugin);
  service.setup();
  const addLegacyFile = (path, content) => {
    const file = { path, name: path.split('/').pop(), extension: 'md', basename: path.split('/').pop().replace(/\.md$/u, '') };
    files.set(path, file);
    contents.set(path, content);
    return file;
  };
  const addFrontmatterFile = (path, frontmatter) => {
    const file = addLegacyFile(path, '');
    frontmatters.set(file, { ...frontmatter });
    return file;
  };
  const emitVault = (name, ...args) => {
    for (const listener of vaultEvents.get(name) || []) listener(...args);
  };
  return { service, api, files, frontmatters, contents, addLegacyFile, addFrontmatterFile, emitVault };
}

test('native food projection derives every macro from the consumed amount and linked serving', () => {
  const food = {
    servingAmount: 1,
    servingUnit: '5.3 oz cup',
    servingGrams: 150,
    calories: 80,
    proteinG: 12,
    carbsG: 9,
    fatG: 0,
    fiberG: 1.5,
    sugarG: 7,
    sodiumMg: 45,
  };
  assert.deepEqual(deriveNativeFoodEntryProjection({ quantity: 3, unit: 'serving' }, food), {
    servings: 3,
    amount: 450,
    amountUnit: 'g',
    nutrition: {
      calories: 240,
      proteinG: 36,
      carbsG: 27,
      fatG: 0,
      fiberG: 4.5,
      sugarG: 21,
      sugarAlcoholG: 0,
      alcoholG: 0,
      sodiumMg: 135,
    },
  });
  assert.equal(deriveNativeFoodEntryProjection({ quantity: 300, unit: 'g' }, food)?.servings, 2);
  assert.equal(deriveNativeFoodEntryProjection({ quantity: 2, unit: '5.3 oz cups' }, food)?.servings, 2);
  assert.equal(deriveNativeFoodEntryProjection({ quantity: 2, unit: 'ml' }, food), null, 'an incompatible unit fails closed');
});

test('native Health indexing follows GCM API v2 tag identity without physical ID/schema properties', () => {
  const { service } = createHarness({ apiVersion: 2 });
  const file = { path: 'food-tagged.md', name: 'food-tagged.md', extension: 'md', basename: 'food-tagged' };
  service.indexFile(file, {
    tags: ['food-log', 'tps/record/v1/food-entry/food-tagged'],
    title: 'Tagged food',
    date: '2026-08-25',
    calories: 325,
  });
  const indexed = service.recordsByPath.get(file.path);
  assert.equal(indexed?.id, 'food-tagged');
  assert.equal(indexed?.kind, 'food-entry');
  assert.equal(indexed?.frontmatter.calories, 325);
});

test('native food and activity records keep typed quantities and indexed daily macro totals', async () => {
  const { service, addFrontmatterFile } = createHarness();
  addFrontmatterFile('Apple.md', {
    kind: 'food', servingAmount: 1, servingUnit: 'apple', servingGrams: 180,
    calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3, fiberG: 4.4, sodiumMg: 2,
  });
  await service.createFoodEntry({
    id: 'food-1',
    createdDate: '2026-08-24T12:00:00.000Z',
    completedDate: '2026-08-24T12:15:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual', sourcePath: 'Apple.md', nutrition: { calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3, fiberG: 4.4, sodiumMg: 2 } },
    quantity: 1,
    unit: 'serving',
    nutritionOverride: { calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3, fiberG: 4.4, sodiumMg: 2 },
  });
  await service.createFoodEntry({
    id: 'food-2',
    createdDate: '2026-08-24T18:00:00.000Z',
    completedDate: '2026-08-24T18:00:00.000Z',
    item: { id: 'meal', name: 'Dinner', source: 'manual' },
    quantity: 1,
    unit: 'serving',
    nutritionOverride: { calories: 600, proteinG: 40, carbsG: 50, fatG: 20, fiberG: 7, sodiumMg: 800 },
  });
  const totals = service.getDailyFoodTotals('2026-08-24');
  assert.equal(totals.entryCount, 2);
  assert.equal(totals.calories, 695);
  assert.equal(totals.proteinG, 40.5);
  assert.equal(totals.fiberG, 11.4);
  assert.equal(totals.sodiumMg, 802);
  const foodRecord = [...service.recordsByPath.values()].find((record) => record.id === 'food-1');
  assert.equal(Object.hasOwn(foodRecord.frontmatter, 'foodId'), false, 'tpsId is the only food-record identity');
  assert.equal(Object.hasOwn(foodRecord.frontmatter, 'servingQuantity'), false, 'new records keep one authored quantity field');
  assert.equal(Object.hasOwn(foodRecord.frontmatter, 'servingUnit'), false, 'new records keep one authored unit field');

  const activity = await service.createActivityEntry({
    id: 'activity-1', activity: 'Walk', activityType: 'walking', startedAt: '2026-08-24T07:00:00.000Z', completedDate: '2026-08-24T07:30:00.000Z', durationMinutes: 30, source: 'manual',
  });
  assert.equal(activity.frontmatter.durationMinutes, 30);
  assert.equal(activity.frontmatter.date, '2026-08-24');
  assert.deepEqual(service.getDailyActivityTotals('2026-08-24'), {
    dateIso: '2026-08-24', entryCount: 1, durationMinutes: 30, caloriesBurned: 0, steps: 0,
  });
});

test('a Base quantity edit immediately updates indexed totals and persists Base-compatible macro projections', async () => {
  const { service, api, addFrontmatterFile, frontmatters } = createHarness();
  addFrontmatterFile('Yogurt.md', {
    kind: 'food', servingAmount: 1, servingUnit: 'cup', servingGrams: 150,
    calories: 80, proteinG: 12, carbsG: 9, fatG: 0, fiberG: 0, sugarG: 7, sodiumMg: 45,
  });
  const created = await service.createFoodEntry({
    id: 'food-yogurt',
    createdDate: '2026-08-25T17:20:00.000Z',
    completedDate: '2026-08-25T17:20:00.000Z',
    item: { id: 'yogurt', name: 'Yogurt', source: 'custom-note', sourcePath: 'Yogurt.md' },
    quantity: 1.25,
    unit: 'serving',
    servingQuantity: 1.25,
    servingUnit: 'cup',
    nutritionOverride: { calories: 100, proteinG: 15, carbsG: 11.25, sugarG: 8.75, sodiumMg: 56.25 },
  });
  assert.equal(created.frontmatter.quantity, 1.25);
  assert.equal(created.frontmatter.unit, 'cup');

  const authored = { ...(await api.resolve(created.file)).frontmatter, quantity: 3, unit: 'cup' };
  frontmatters.set(created.file, authored);
  service.indexFile(created.file, authored);

  const immediate = service.getDailyFoodTotals('2026-08-25');
  assert.equal(immediate.calories, 240, 'dashboard totals do not wait for the projection write');
  assert.equal(immediate.proteinG, 36);
  assert.equal(immediate.carbsG, 27);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const persisted = await api.resolve(created.file);
  assert.equal(persisted.frontmatter.quantity, 3);
  assert.equal(persisted.frontmatter.unit, 'cup');
  assert.equal(persisted.frontmatter.amount, 450);
  assert.equal(persisted.frontmatter.amountUnit, 'g');
  assert.equal(persisted.frontmatter.calories, 240);
  assert.equal(persisted.frontmatter.proteinG, 36);
  assert.equal(persisted.frontmatter.carbsG, 27);
  assert.equal(persisted.frontmatter.sodiumMg, 135);
});

test('editing a linked food definition recalculates only its indexed food entries', async () => {
  const { service, api, addFrontmatterFile, frontmatters } = createHarness();
  const foodFile = addFrontmatterFile('Protein.md', {
    kind: 'food', servingAmount: 1, servingUnit: 'bar', calories: 200, proteinG: 20, carbsG: 20,
  });
  const created = await service.createFoodEntry({
    id: 'food-protein', createdDate: '2026-08-25T12:00:00.000Z', completedDate: '2026-08-25T12:00:00.000Z',
    item: { id: 'protein', name: 'Protein', source: 'custom-note', sourcePath: 'Protein.md' },
    quantity: 2, unit: 'serving', nutritionOverride: { calories: 400, proteinG: 40, carbsG: 40 },
  });
  const revisedFood = { ...frontmatters.get(foodFile), calories: 210, proteinG: 22 };
  frontmatters.set(foodFile, revisedFood);
  service.indexFile(foodFile, revisedFood);
  assert.equal(service.getDailyFoodTotals('2026-08-25').calories, 420);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const persisted = await api.resolve(created.file);
  assert.equal(persisted.frontmatter.calories, 420);
  assert.equal(persisted.frontmatter.proteinG, 44);
  assert.equal(persisted.frontmatter.carbsG, 40);
});

test('a vault modify refreshes the exact record before MetadataCache catches up', async () => {
  const { service, files, contents, emitVault } = createHarness();
  const file = { path: 'food-live.md', name: 'food-live.md', extension: 'md', basename: 'food-live' };
  files.set(file.path, file);
  contents.set(file.path, [
    '---',
    'tpsId: food-live',
    'tpsSchemaVersion: 1',
    'kind: food-entry',
    'date: 2026-08-24',
    'calories: 210',
    'proteinG: 18',
    '---',
  ].join('\n'));
  const changes = [];
  service.onRecordsChanged((change) => changes.push(change));

  emitVault('modify', file);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(service.getDailyFoodTotals('2026-08-24').calories, 210);
  assert.deepEqual(changes.at(-1), {
    path: 'food-live.md', kinds: ['food-entry'], dates: ['2026-08-24'],
  });
});

test('native record dates follow the local calendar day instead of the UTC day', async (t) => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  t.after(() => {
    if (previousTimezone == null) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });

  const { service } = createHarness();
  const food = await service.createFoodEntry({
    id: 'food-evening',
    createdDate: '2026-08-25T00:33:03.127Z',
    completedDate: '2026-08-25T00:32:00.000Z',
    item: { id: 'seltzer', name: 'Hard Seltzer', source: 'manual', nutrition: { calories: 61.4 } },
    quantity: 1,
    unit: 'serving',
  });
  assert.equal(food.frontmatter.date, '2026-08-24', '7:32 PM Central remains on the Aug 24 Daily Note');

  const dateOnlyFood = await service.createFoodEntry({
    id: 'food-date-only',
    createdDate: '2026-08-24',
    completedDate: '2026-08-24',
    item: { id: 'apple', name: 'Apple', source: 'manual', nutrition: { calories: 95 } },
    quantity: 1,
    unit: 'serving',
  });
  assert.equal(dateOnlyFood.frontmatter.date, '2026-08-24', 'date-only input is never shifted by timezone parsing');

  const activity = await service.createActivityEntry({
    id: 'activity-evening',
    activity: 'Walk',
    activityType: 'walking',
    startedAt: '2026-08-25T00:02:00.000Z',
    completedDate: '2026-08-25T00:32:00.000Z',
    durationMinutes: 30,
    source: 'manual',
  });
  assert.equal(activity.frontmatter.date, '2026-08-24');

  const workout = await service.createWorkoutSession({
    title: 'Evening workout',
    startedAt: '2026-08-25T00:32:00.000Z',
    workoutDate: '2026-08-24',
  }, 'workout-evening');
  assert.equal(workout.frontmatter.date, '2026-08-24', 'an explicit Daily Note workout date wins');
});

test('native workout session stores one exercise record with an atomic set list and aggregates', async () => {
  const { service } = createHarness();
  const session = await service.createWorkoutSession({ title: 'Strength', startedAt: '2026-08-24T08:00:00.000Z' }, 'workout-1');
  assert.equal(Object.hasOwn(session.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(session.frontmatter, 'exerciseRecordIds'), false);
  await service.appendWorkoutSet(session.file, { id: 'set-1', exercise: 'Bench press', endedAt: '2026-08-24T08:05:00.000Z', reps: 8, weight: 100, weightUnit: 'lb' });
  const second = await service.appendWorkoutSet(session.file, { id: 'set-2', exercise: 'Bench press', endedAt: '2026-08-24T08:10:00.000Z', reps: 6, weight: 110, weightUnit: 'lb' });
  assert.equal(second.exercise.frontmatter.setCount, 2);
  assert.equal(second.exercise.frontmatter.totalReps, 14);
  assert.equal(second.exercise.frontmatter.totalVolume, 1460);
  assert.equal(second.exercise.frontmatter.workout, `[[_records/workout-sessions/workout-1]]`);
  assert.equal(second.exercise.frontmatter.exerciseOrder, 1);
  assert.equal(Object.hasOwn(second.exercise.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(second.exercise.frontmatter, 'workoutPath'), false);
  assert.equal(second.session.frontmatter.setCount, 2);
  assert.equal(service.isWorkoutSession(session.path, 'workout-1'), true);
  assert.equal(service.isWorkoutSession(second.exercise.path, 'workout-1'), false);
  assert.equal(service.getWorkoutExerciseNames('workout-1').length, 1);
  assert.deepEqual(service.getWorkoutProgress('workout-1'), {
    exerciseCount: 1,
    setCount: 2,
  });
  assert.deepEqual(service.getWorkoutSnapshot(session.path), {
    id: 'workout-1',
    path: session.path,
    title: 'Strength',
    status: 'active',
    startedAt: '2026-08-24T08:00:00.000Z',
    endedAt: '',
    exerciseCount: 1,
    setCount: 2,
    exercises: [{
      id: second.exercise.id,
      path: second.exercise.path,
      name: 'Bench press',
      exercisePath: '',
      totalReps: 14,
      totalVolume: 1460,
      sets: [
        {
          id: 'set-1', ordinal: 1, reps: 8, weight: 100, weightUnit: 'lb', perArm: false,
          rpe: undefined, restSeconds: undefined, setType: 'normal', completedDate: '2026-08-24T08:05:00.000Z', note: '',
        },
        {
          id: 'set-2', ordinal: 2, reps: 6, weight: 110, weightUnit: 'lb', perArm: false,
          rpe: undefined, restSeconds: undefined, setType: 'normal', completedDate: '2026-08-24T08:10:00.000Z', note: '',
        },
      ],
    }],
  }, 'the UI projection is derived from the indexed atomic set list in authored order');
  const edited = await service.updateWorkoutSet(second.exercise.file, 'set-2', {
    reps: 10,
    weight: 105,
    weightUnit: 'kg',
    perArm: true,
    rpe: 8.5,
    restSeconds: 75,
    setType: 'drop',
  });
  assert.equal(edited.frontmatter.setCount, 2, 'editing preserves the atomic set count');
  assert.equal(edited.frontmatter.totalReps, 18);
  assert.equal(edited.frontmatter.totalVolume, 2900);
  assert.deepEqual(service.getWorkoutSnapshot(session.path).exercises[0].sets[1], {
    id: 'set-2', ordinal: 2, reps: 10, weight: 105, weightUnit: 'kg', perArm: true,
    rpe: 8.5, restSeconds: 75, setType: 'drop', completedDate: '2026-08-24T08:10:00.000Z', note: '',
  }, 'inline edits retain the stable set identity and update the indexed projection');
  await assert.rejects(
    () => service.updateWorkoutSet(second.exercise.file, 'missing-set', { reps: 1 }),
    /not found/u,
    'an unresolved row never mutates a different set',
  );
  const finished = await service.finishWorkout(session.file, { endedAt: '2026-08-24T09:00:00.000Z' });
  assert.equal(finished.frontmatter.status, 'complete');
  assert.equal(service.getWorkoutSnapshot('workout-1').setCount, 2, 'finished sessions retain their table projection after active state clears');
});

test('explicit identity normalization replaces legacy workout joins before removing duplicate IDs', async () => {
  const { service, api } = createHarness();
  const food = await service.createFoodEntry({
    id: 'food-old', createdDate: '2026-08-24T12:00:00.000Z', item: { id: 'apple', name: 'Apple', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  const session = await service.createWorkoutSession({ title: 'Strength', startedAt: '2026-08-24T08:00:00.000Z' }, 'workout-old');
  const exercise = await service.ensureWorkoutExercise(session, 'Bench press');
  await api.update(food.file, { foodId: food.id });
  await api.update(session.file, { workoutId: session.id, exerciseRecordIds: [exercise.id] });
  await api.update(exercise.file, { workout: null, workoutId: session.id, workoutPath: session.path, exerciseOrder: null });
  service.setup();

  const result = await service.normalizeNativeRecordIdentities();
  assert.deepEqual(result, { inspected: 3, updated: 3, skipped: 0 });
  const normalizedFood = await api.resolve(food.file);
  const normalizedSession = await api.resolve(session.file);
  const normalizedExercise = await api.resolve(exercise.file);
  assert.equal(Object.hasOwn(normalizedFood.frontmatter, 'foodId'), false);
  assert.equal(Object.hasOwn(normalizedSession.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(normalizedSession.frontmatter, 'exerciseRecordIds'), false);
  assert.equal(normalizedExercise.frontmatter.workout, `[[_records/workout-sessions/workout-old]]`);
  assert.equal(normalizedExercise.frontmatter.exerciseOrder, 1);
  assert.equal(Object.hasOwn(normalizedExercise.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(normalizedExercise.frontmatter, 'workoutPath'), false);
  assert.deepEqual(await service.normalizeNativeRecordIdentities(), { inspected: 3, updated: 0, skipped: 0 }, 'cleanup is idempotent');
});

test('native workout sessions render one persistent table without rewriting the note body', () => {
  assert.match(mainSource, /new NativeWorkoutSurfaceWidget\(plugin, filePath\)/u);
  assert.match(mainSource, /sourceView\.classList\.contains\("is-live-preview"\)/u);
  assert.match(mainSource, /renderNativeWorkoutSurfaceInReadingView\(this\.containerEl, this\.plugin, this\.ctx\.sourcePath\)/u);
  assert.match(mainSource, /getWorkoutSnapshot\(file\.path\)/u);
  assert.match(mainSource, /getWorkoutSnapshot\(active\.path\)\?\.exercises/u);
  assert.match(mainSource, /updateNativeWorkoutSetInline\(exercise\.path, set\.id, patch\)/u);
  assert.match(mainSource, /logNativeWorkoutSetDraft\(exercise\.name, draft\)/u);
  assert.match(mainSource, /active-state:reconciled-from-native-record/u);
  assert.match(mainSource, /text\.setValue\(reps == null \? "" : String\(reps\)\)/u);
  assert.match(mainSource, /text\.setValue\(weight == null \? "" : String\(weight\)\)/u);
  assert.match(mainSource, /getWorkoutProgress\(workoutId\)/u);
  assert.match(mainSource, /this\.updateNativeWorkoutSurfaces\(\)/u);
  assert.doesNotMatch(mainSource, /registerMarkdownCodeBlockProcessor\("tps-health-workout"/u);
  assert.match(nativeWorkoutSurfaceSource, /\['Set', 'Reps', 'Weight', 'RPE', 'Rest', 'Type', ''\]/u);
  assert.match(nativeWorkoutSurfaceSource, /options\.actions\.addSet\(exercise, \{/u);
  assert.match(nativeWorkoutSurfaceSource, /options\.actions\.updateSet\(exercise, set, patch\)/u);
  assert.match(nativeWorkoutSurfaceSource, /tps-health-native-workout-row is-draft/u);
  assert.match(nativeWorkoutSurfaceSource, /root\.dataset\.renderKey === signature/u);
  assert.match(nativeWorkoutSurfaceSource, /instance: options\.instanceKey/u);
  assert.match(mainSource, /instanceKey: this\.workoutSurfaceInstanceKey/u);
  assert.match(stylesSource, /\.markdown-source-view:not\(\.is-live-preview\) \.tps-health-native-workout-surface/u);
  assert.match(stylesSource, /\.tps-health-workout-entry-modal \.setting-item-control \{[\s\S]*?flex: 0 0 auto;/u, 'mobile set fields do not inherit a tall desktop flex basis');
  assert.match(stylesSource, /\.tps-health-workout-entry-modal > \.setting-item:last-child \{[\s\S]*?position: sticky;/u, 'mobile actions remain reachable above the keyboard');
});

test('native Health storage is explicit and removes Daily Note writes only in native mode', () => {
  assert.match(typesSource, /storageMode: HealthStorageMode/u);
  assert.match(typesSource, /storageMode: "legacy"/u);
  assert.match(settingsSource, /Native TPS records/u);
  assert.match(mainSource, /this\.nativeRecordService\.createFoodEntry\(entry\)/u);
  assert.match(mainSource, /this\.nativeRecordService\.createActivityEntry\(entry\)/u);
  assert.match(mainSource, /this\.plugin\.nativeRecordService\?\.isEnabled\(\)/u);
  assert.match(mainSource, /Create one typed activity record\. The Daily Note body is not rewritten\./u);
  assert.match(mainSource, /return this\.startNativeWorkout/u);
  assert.match(mainSource, /return this\.logNativeWorkoutSet\(set, path\)/u);
  assert.match(mainSource, /storage: "native-record-index"/u);
  assert.match(mainSource, /Preview legacy Health import/u);
  assert.match(mainSource, /Copy legacy Health logs/u);
});

test('legacy Health import is deterministic, typed, copy-only, and idempotent', async () => {
  const { service, addLegacyFile, contents } = createHarness();
  const legacy = [
    '- Apple <!-- [type:: foodLog] [food:: Apple] [foodId:: food-old-1] [servings:: 2] [unit:: serving] [cal:: 190] [protein:: 1] [carbs:: 50] [fat:: 0.6] [fiber:: 8.8] [sodium:: 4] [completedDate:: 2026-08-23T12:00:00.000Z] -->',
    '- Walk <!-- [type:: activityLog] [activity:: Walk] [activityType:: walking] [activityId:: activity-old-1] [source:: manual] [durationMinutes:: 30] [startedAt:: 2026-08-23T08:00:00.000Z] [completedDate:: 2026-08-23T08:30:00.000Z] -->',
    '- Strength [type:: activityLog] [activity:: Strength] [activityType:: workout] [activityId:: workout-old-1] [workoutId:: workout-old-1] [startedAt:: 2026-08-23T09:00:00.000Z] [status:: complete]',
    '  - Bench [type:: workoutSet] [exercise:: Bench] [setId:: set-old-1] [reps:: 8] [weight:: 100] [unit:: lb] [endedAt:: 2026-08-23T09:10:00.000Z]',
  ].join('\n');
  addLegacyFile('2026-08-23.md', legacy);
  const before = contents.get('2026-08-23.md');
  const plan = await service.planLegacyImport();
  assert.equal(plan.candidates, 4);
  assert.equal(plan.foodEntries, 1);
  assert.equal(plan.workoutSessions, 1);
  assert.equal(plan.workoutExercises, 1);
  assert.equal(plan.totals.calories, 190);
  assert.equal(plan.unresolvedLines, 0);
  assert.equal(contents.get('2026-08-23.md'), before, 'dry run does not mutate the source');

  const first = await service.importLegacyRecords();
  assert.equal(first.created, 4);
  assert.equal(first.failed, 0);
  assert.equal(contents.get('2026-08-23.md'), before, 'copy import preserves legacy bytes');
  const second = await service.importLegacyRecords();
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 4);
  assert.equal(contents.get('2026-08-23.md'), before);
});

test('legacy inline parser does not interpret surrounding note text as properties', () => {
  assert.deepEqual(parseLegacyInlineFields('- Lunch note [type:: foodLog] [food:: A:B] trailing'), {
    type: 'foodLog',
    food: 'A:B',
  });
});
