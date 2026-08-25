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
              constructor(path) { this.path = path; this.name = path.split('/').pop(); this.extension = this.name.split('.').pop(); this.basename = this.name.replace(/\\.[^.]+$/, ''); }
            }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { HealthNativeRecordService, parseLegacyInlineFields } = await loadModule();
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

function createHarness() {
  const files = new Map();
  const frontmatters = new Map();
  const contents = new Map();
  let generated = 0;
  const api = {
    version: 1,
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
      const frontmatter = { ...current.frontmatter, ...updates, modifiedDate: new Date().toISOString() };
      frontmatters.set(current.file, frontmatter);
      return { ...current, frontmatter };
    },
  };
  const plugin = {
    settings: { storageMode: 'native-records' },
    manifest: { id: 'tps-health' },
    app: {
      vault: {
        getMarkdownFiles: () => [...files.values()],
        cachedRead: async (file) => contents.get(file.path) || '',
        on: () => ({}),
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: frontmatters.get(file) }),
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
  return { service, api, files, frontmatters, contents, addLegacyFile };
}

test('native food and activity records keep typed quantities and indexed daily macro totals', async () => {
  const { service } = createHarness();
  await service.createFoodEntry({
    id: 'food-1',
    createdDate: '2026-08-24T12:00:00.000Z',
    completedDate: '2026-08-24T12:15:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual', nutrition: { calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3, fiberG: 4.4, sodiumMg: 2 } },
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

  const activity = await service.createActivityEntry({
    id: 'activity-1', activity: 'Walk', activityType: 'walking', startedAt: '2026-08-24T07:00:00.000Z', completedDate: '2026-08-24T07:30:00.000Z', durationMinutes: 30, source: 'manual',
  });
  assert.equal(activity.frontmatter.durationMinutes, 30);
  assert.equal(activity.frontmatter.date, '2026-08-24');
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
  await service.appendWorkoutSet(session.file, { id: 'set-1', exercise: 'Bench press', endedAt: '2026-08-24T08:05:00.000Z', reps: 8, weight: 100, weightUnit: 'lb' });
  const second = await service.appendWorkoutSet(session.file, { id: 'set-2', exercise: 'Bench press', endedAt: '2026-08-24T08:10:00.000Z', reps: 6, weight: 110, weightUnit: 'lb' });
  assert.equal(second.exercise.frontmatter.setCount, 2);
  assert.equal(second.exercise.frontmatter.totalReps, 14);
  assert.equal(second.exercise.frontmatter.totalVolume, 1460);
  assert.equal(second.session.frontmatter.setCount, 2);
  assert.equal(service.getWorkoutExerciseNames('workout-1').length, 1);
  const finished = await service.finishWorkout(session.file, { endedAt: '2026-08-24T09:00:00.000Z' });
  assert.equal(finished.frontmatter.status, 'complete');
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
