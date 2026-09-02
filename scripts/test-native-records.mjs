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
                result[match[1]] = raw.startsWith('__json__:')
                  ? JSON.parse(decodeURIComponent(raw.slice('__json__:'.length)))
                  : /^-?\\d+(?:\\.\\d+)?$/.test(raw) ? Number(raw) : /^(true|false)$/.test(raw) ? raw === 'true' : raw.replace(/^['"]|['"]$/g, '');
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

const {
  HealthNativeRecordService,
  buildNativeHealthRecordFileName,
  deriveNativeFoodEntryProjection,
  parseLegacyInlineFields,
  readWorkoutDataFromNoteContent,
  resolveActiveWorkoutAfterFilenameMigration,
  workoutSessionPropertyValue,
  writeWorkoutDataToNoteContent,
} = await loadModule();
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const nativeWorkoutSurfaceSource = readFileSync(new URL('../src/native-workout-surface.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function createHarness(options = {}) {
  const files = new Map();
  const frontmatters = new Map();
  const contents = new Map();
  const createCalls = [];
  const updateCalls = [];
  const trashedPaths = [];
  const exerciseDefinitions = new Set();
  let generated = 0;
  let processCalls = 0;
  const vaultEvents = new Map();
  const metadataEvents = new Map();
  const encodedYamlValue = (value) => value && typeof value === 'object'
    ? `__json__:${encodeURIComponent(JSON.stringify(value))}`
    : String(value ?? '');
  const writeFrontmatterContent = (file, frontmatter) => {
    const current = contents.get(file.path) || '';
    const body = current.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '');
    const yaml = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${encodedYamlValue(value)}`)
      .join('\n');
    contents.set(file.path, `---\n${yaml}\n---\n${body}`);
  };
  const recordFolder = (kind) => ({
    'food-entry': 'food-entries',
    'activity-entry': 'activity-entries',
    'workout-session': 'workout-sessions',
    'workout-exercise': 'workout-exercises',
  })[kind] || `${kind}s`;
  const availablePath = (kind, fileName, current = null) => {
    const stem = String(fileName || '').replace(/\.md$/u, '');
    const preferred = `_records/${recordFolder(kind)}/${stem}.md`;
    if (!files.has(preferred) || files.get(preferred) === current) return preferred;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `_records/${recordFolder(kind)}/${stem} (${suffix}).md`;
      if (!files.has(candidate) || files.get(candidate) === current) return candidate;
    }
    throw new Error('No filename available.');
  };
  const legacyFileNames = options.legacyFileNames === true;
  const api = {
    version: options.apiVersion ?? 6,
    isEnabled: () => options.apiEnabled !== false,
    async create(kind, properties, options = {}) {
      const id = String(options.id || `${kind}-${++generated}`);
      createCalls.push({ kind, properties: { ...properties }, options: { ...options } });
      const path = availablePath(kind, legacyFileNames ? id : options.fileName || id);
      const file = new (class TFile {
        constructor(path) { this.path = path; this.name = path.split('/').pop(); this.extension = 'md'; this.basename = this.name.replace(/\.md$/u, ''); }
      })(path);
      const frontmatter = { ...properties, tpsId: id, tpsSchemaVersion: 1, kind, title: properties.title, createdDate: new Date().toISOString(), modifiedDate: new Date().toISOString() };
      files.set(file.path, file);
      frontmatters.set(file, frontmatter);
      writeFrontmatterContent(file, frontmatter);
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
      updateCalls.push({ reference, updates: { ...updates } });
      if (typeof options.beforeApiUpdate === 'function') {
        const outcome = await options.beforeApiUpdate(updateCalls.length, reference, updates);
        if (outcome === null) return null;
      }
      const current = await this.resolve(reference);
      if (!current) return null;
      const frontmatter = { ...current.frontmatter };
      for (const [key, value] of Object.entries(updates)) {
        if (value == null) delete frontmatter[key];
        else frontmatter[key] = value;
      }
      frontmatter.modifiedDate = new Date().toISOString();
      frontmatters.set(current.file, frontmatter);
      writeFrontmatterContent(current.file, frontmatter);
      return { ...current, frontmatter };
    },
    async rename(reference, fileName) {
      const current = await this.resolve(reference);
      if (!current) return null;
      const oldPath = current.file.path;
      const nextPath = availablePath(current.kind, fileName, current.file);
      if (nextPath !== oldPath) {
        files.delete(oldPath);
        current.file.path = nextPath;
        current.file.name = nextPath.split('/').pop();
        current.file.basename = current.file.name.replace(/\.md$/u, '');
        files.set(nextPath, current.file);
      }
      return { ...current, path: current.file.path, file: current.file, frontmatter: { ...frontmatters.get(current.file) } };
    },
    inspect(frontmatter) {
      const physicalKeys = Object.keys(frontmatter || {});
      const idKey = physicalKeys.find((key) => key.toLowerCase() === 'tpsid');
      const schemaKey = physicalKeys.find((key) => key.toLowerCase() === 'tpsschemaversion');
      const kindKey = physicalKeys.find((key) => key.toLowerCase() === 'kind');
      if (idKey && schemaKey && kindKey && Number(frontmatter[schemaKey]) === 1) {
        return {
          id: String(frontmatter[idKey]),
          kind: String(frontmatter[kindKey]),
          schemaVersion: 1,
          frontmatter: { ...frontmatter, tpsId: String(frontmatter[idKey]), tpsSchemaVersion: 1, kind: String(frontmatter[kindKey]) },
        };
      }
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
      fileManager: {
        async processFrontMatter(file, mutation) {
          if (typeof options.beforeFrontmatterProcess === 'function') {
            await options.beforeFrontmatterProcess({ file, files, frontmatters, contents, writeFrontmatterContent });
          }
          const frontmatter = { ...frontmatters.get(file) };
          mutation(frontmatter);
          frontmatters.set(file, frontmatter);
          writeFrontmatterContent(file, frontmatter);
        },
      },
      workspace: {
        layoutReady: options.layoutReady ?? true,
        onLayoutReady(callback) {
          if (this.layoutReady) callback();
        },
      },
      vault: {
        getMarkdownFiles: () => [...files.values()],
        cachedRead: async (file) => contents.get(file.path) || '',
        read: async (file) => contents.get(file.path) || '',
        process: async (file, mutation) => {
          processCalls += 1;
          if (typeof options.beforeVaultProcess === 'function') {
            await options.beforeVaultProcess({ call: processCalls, file, contents });
          }
          const current = contents.get(file.path) || '';
          const next = mutation(current);
          contents.set(file.path, next);
        },
        getAbstractFileByPath: (path) => files.get(path) || null,
        trash: async (file) => {
          trashedPaths.push(file.path);
          files.delete(file.path);
          frontmatters.delete(file);
          contents.delete(file.path);
          for (const listener of vaultEvents.get('delete') || []) listener(file);
        },
        on: (name, callback) => {
          const listeners = vaultEvents.get(name) || [];
          listeners.push(callback);
          vaultEvents.set(name, listeners);
          return {};
        },
      },
      metadataCache: {
        initialized: options.metadataInitialized ?? true,
        getFileCache: (file) => ({ frontmatter: frontmatters.get(file) }),
        getFirstLinkpathDest: (linkpath) => {
          const normalized = String(linkpath || '').replace(/^\[\[|\]\]$/gu, '').replace(/\.md$/u, '');
          return [...files.values()].find((candidate) => candidate.path.replace(/\.md$/u, '') === normalized) || null;
        },
        on: (name, callback) => {
          const listeners = metadataEvents.get(name) || [];
          listeners.push(callback);
          metadataEvents.set(name, listeners);
          return {};
        },
      },
    },
    registerEvent: () => {},
    scheduleWorkoutActionBars: () => {},
    getGcmNativeRecordsApi: () => api,
    ensureExerciseDefinitionForWorkout: async (name, existingPath = '') => {
      const sourcePath = existingPath || `Health/Exercises/${String(name).replace(/[\\/:*?"<>|]/gu, '-')}.md`;
      exerciseDefinitions.add(sourcePath);
      return { name, sourcePath };
    },
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
    writeFrontmatterContent(file, frontmatter);
    return file;
  };
  const emitVault = (name, ...args) => {
    for (const listener of vaultEvents.get(name) || []) listener(...args);
  };
  const emitMetadata = (name, ...args) => {
    for (const listener of metadataEvents.get(name) || []) listener(...args);
  };
  return { service, api, plugin, files, frontmatters, contents, createCalls, updateCalls, trashedPaths, exerciseDefinitions, addLegacyFile, addFrontmatterFile, emitVault, emitMetadata };
}

test('native Health filenames use the record date and plain human title', () => {
  assert.equal(buildNativeHealthRecordFileName('food-entry', {
    date: '2026-08-25', foodName: 'Honeycrisp apple, large', title: 'Ignored fallback',
  }), '2026-08-25 - Honeycrisp apple, large');
  assert.equal(buildNativeHealthRecordFileName('activity-entry', {
    completedDate: '2026-08-25T08:30:00.000Z', title: 'Morning walk',
  }), '2026-08-25 - Morning walk');
  assert.equal(buildNativeHealthRecordFileName('activity-entry', {
    date: '2026-08-24', completedDate: '2026-08-25T00:30:00.000Z', title: 'Evening walk',
  }), '2026-08-24 - Evening walk', 'an explicit normalized activity date remains authoritative');
  assert.equal(buildNativeHealthRecordFileName('workout-session', {
    date: '2026-08-25', startedAt: '2026-08-25T06:16:00', title: 'Workout 2026-08-25 06.16',
  }), '2026-08-25 - Workout 06.16', 'the generated workout date is not duplicated');
  assert.equal(buildNativeHealthRecordFileName('workout-session', {
    workoutDate: '2026-08-25', startedAt: '2026-08-26T00:05:00', title: 'Workout 2026-08-26 00.05',
  }), '2026-08-25 - Workout 00.05', 'a generated local-day title cannot add a second date beside the authoritative Daily Note date');
  assert.equal(buildNativeHealthRecordFileName('workout-session', {
    workoutDate: '2026-08-25', startedAt: '2026-08-26T00:05:00', title: 'Strength cycle 2026-08-26 00.05',
  }), '2026-08-25 - Strength cycle 00.05', 'generated plan titles use the same one-date filename projection');
  assert.equal(buildNativeHealthRecordFileName('workout-session', {
    workoutDate: '2026-08-25', title: 'Anniversary workout 2026-08-25',
  }), '2026-08-25 - Anniversary workout 2026-08-25', 'meaningful authored date-bearing titles remain intact');
  assert.equal(buildNativeHealthRecordFileName('workout-session', {
    workoutDate: '2026-08-25', startedAt: '2026-08-25T07:30:00', title: 'Race recap 2026-08-25 06.16',
  }), '2026-08-25 - Race recap 2026-08-25 06.16', 'a timestamp-like authored title is preserved when it does not match the workout start');
  assert.equal(buildNativeHealthRecordFileName('workout-session', {
    workoutDate: '2026-08-25', title: 'Leg day',
  }), '2026-08-25 - Leg day');
  assert.equal(buildNativeHealthRecordFileName('workout-exercise', {
    title: 'Leg curl', exercise: 'Leg curl',
  }, { date: '2026-08-25' }), '2026-08-25 - Leg curl');
});

test('workout session data uses one compact Bases-queryable property while legacy body markers remain readable', () => {
  const session = workoutSessionPropertyValue([{
    id: 'exercise-one',
    name: 'Bench press',
    exercisePath: 'Health/Exercises/Bench press.md',
    supersetGroupId: 'A',
    sets: [{ id: 'set-one', reps: 8, weight: 135, weightUnit: 'lb', restSeconds: 90 }],
  }]);
  assert.deepEqual(session, {
    version: 1,
    exercises: [{
      id: 'exercise-one', name: 'Bench press', exercise: '[[Health/Exercises/Bench press]]', superset: 'A',
      sets: [{ id: 'set-one', reps: 8, weight: 135, unit: 'lb', rest: 90 }],
    }],
  });

  const original = '---\nkind: workout-session\ntpsId: workout-one\n---\nNotes stay here.\n';
  const firstData = JSON.stringify({ version: 1, exercises: [{ id: 'exercise-one', sets: [] }] });
  const first = writeWorkoutDataToNoteContent(original, firstData);
  assert.equal(readWorkoutDataFromNoteContent(first), firstData);
  assert.equal(first.endsWith('Notes stay here.\n'), true, 'authored body content is preserved');

  const secondData = JSON.stringify({ version: 1, exercises: [] });
  const second = writeWorkoutDataToNoteContent(first, secondData);
  assert.equal(readWorkoutDataFromNoteContent(second), secondData);
  assert.equal(second.match(/tps-health-workout-data:v1:/gu)?.length, 1, 'updates replace the atomic marker');
});

test('GCM API v6 receives readable filenames while stable record IDs remain authoritative', async () => {
  const { service, createCalls } = createHarness({ apiVersion: 6 });
  const firstFood = await service.createFoodEntry({
    id: 'food-one', createdDate: '2026-08-25T12:00:00.000Z', completedDate: '2026-08-25T12:00:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  const secondFood = await service.createFoodEntry({
    id: 'food-two', createdDate: '2026-08-25T13:00:00.000Z', completedDate: '2026-08-25T13:00:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  const activity = await service.createActivityEntry({
    id: 'activity-one', activity: 'Morning walk', activityType: 'walking',
    startedAt: '2026-08-25T08:00:00.000Z', completedDate: '2026-08-25T08:30:00.000Z',
    durationMinutes: 30, source: 'manual',
  });
  const session = await service.createWorkoutSession({
    title: 'Workout 2026-08-25 06.16', startedAt: '2026-08-25T11:16:00.000Z', workoutDate: '2026-08-25',
  }, 'workout-one');
  const authoredDateSession = await service.createWorkoutSession({
    title: 'Backdated strength', startedAt: '2026-08-25T12:00:00.000Z', workoutDate: '2026-08-27',
  }, 'workout-two');
  const exercise = await service.ensureWorkoutExercise(session, 'Leg curl', 'Health/Exercises/Leg curl.md');

  assert.equal(firstFood.id, 'food-one');
  assert.equal(firstFood.path, '_records/food-entries/2026-08-25 - Apple.md');
  assert.equal(secondFood.path, '_records/food-entries/2026-08-25 - Apple (2).md', 'GCM owns deterministic collision suffixes');
  assert.equal(activity.id, 'activity-one');
  assert.equal(activity.path, '_records/activity-entries/2026-08-25 - Morning walk.md');
  assert.equal(session.id, 'workout-one');
  assert.equal(session.path, '_records/workout-sessions/2026-08-25 - Workout 06.16.md');
  assert.equal(authoredDateSession.id, 'workout-two');
  assert.equal(authoredDateSession.path, '_records/workout-sessions/2026-08-27 - Backdated strength.md', 'the authored workout date wins over the started-at day');
  assert.equal(Object.hasOwn(authoredDateSession.frontmatter, 'workoutDate'), false, 'the filename projection does not add a redundant stored date');
  assert.equal(exercise.path, session.path, 'embedded exercises live in the workout note');
  assert.deepEqual(createCalls.map((call) => call.options.fileName), [
    '2026-08-25 - Apple',
    '2026-08-25 - Apple',
    '2026-08-25 - Morning walk',
    '2026-08-25 - Workout 06.16',
    '2026-08-27 - Backdated strength',
  ]);
});

test('native Health writes fail closed before GCM API v6', () => {
  const { service } = createHarness({ apiVersion: 5 });
  assert.throws(
    () => service.requireApi(),
    /nativeRecords API v6/u,
  );
});

test('native Health requires exactly API v6 and every method it uses', () => {
  assert.throws(() => createHarness({ apiVersion: 7 }).service.requireApi(), /nativeRecords API v6/u);
  assert.throws(() => createHarness({ apiEnabled: false }).service.requireApi(), /nativeRecords API v6/u);
  for (const method of ['isEnabled', 'create', 'resolve', 'update', 'inspect']) {
    const { service, api } = createHarness();
    delete api[method];
    assert.throws(() => service.requireApi(), /nativeRecords API v6/u, `${method} is required`);
  }
});

test('readable filename migration renames only opaque ID paths and is idempotent', async () => {
  const { service, api, addFrontmatterFile } = createHarness({ apiVersion: 6, legacyFileNames: true });
  const food = await service.createFoodEntry({
    id: 'food-old', createdDate: '2026-08-24T12:00:00.000Z', completedDate: '2026-08-24T12:00:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  const activity = await service.createActivityEntry({
    id: 'activity-old', activity: 'Walk', activityType: 'walking',
    startedAt: '2026-08-24T07:00:00.000Z', completedDate: '2026-08-24T07:30:00.000Z',
    durationMinutes: 30, source: 'manual',
  });
  const session = await service.createWorkoutSession({
    title: 'Strength', startedAt: '2026-08-24T08:00:00.000Z', workoutDate: '2026-08-24',
  }, 'workout-old');
  const exercise = await service.ensureWorkoutExercise(session, 'Bench press', 'Health/Exercises/Bench press.md');
  const customFrontmatter = {
    tpsId: 'food-custom', tpsSchemaVersion: 1, kind: 'food-entry', title: 'Apple', foodName: 'Apple', date: '2026-08-24',
  };
  const custom = addFrontmatterFile('_records/food-entries/My custom apple.md', customFrontmatter);
  service.indexFile(custom, customFrontmatter);

  assert.equal(food.file.basename, 'food-old');
  assert.equal(activity.file.basename, 'activity-old');
  assert.equal(session.file.basename, 'workout-old');
  assert.equal(exercise.file, session.file, 'adding an exercise does not create another note');
  api.version = 6;
  const first = await service.normalizeNativeRecordFilenames();
  assert.deepEqual(first, {
    inspected: 4,
    renamed: 3,
    unchanged: 1,
    failed: 0,
    renamedPaths: {
      'activity-old': '_records/activity-entries/2026-08-24 - Walk.md',
      'food-old': '_records/food-entries/2026-08-24 - Apple.md',
      'workout-old': '_records/workout-sessions/2026-08-24 - Strength.md',
    },
  });
  assert.equal(food.path, '_records/food-entries/food-old.md', 'prior immutable handles are not treated as live path authority');
  assert.equal(activity.file.path, '_records/activity-entries/2026-08-24 - Walk.md');
  assert.equal(food.file.path, '_records/food-entries/2026-08-24 - Apple.md');
  assert.equal(session.file.path, '_records/workout-sessions/2026-08-24 - Strength.md');
  assert.equal(exercise.file.path, '_records/workout-sessions/2026-08-24 - Strength.md');
  assert.equal(service.getWorkoutSnapshot('workout-old')?.path, '_records/workout-sessions/2026-08-24 - Strength.md', 'the live index resolves an active workout after its TFile moves');
  assert.equal(custom.path, '_records/food-entries/My custom apple.md', 'a user-owned filename is preserved');
  assert.deepEqual(await service.normalizeNativeRecordFilenames(), {
    inspected: 4, renamed: 0, unchanged: 4, failed: 0, renamedPaths: {},
  });
});

test('readable filename migration narrowly repairs generated title-first workout names', async () => {
  const { service, addFrontmatterFile } = createHarness({ apiVersion: 6 });
  const localStartedAt = (hour, minute) => new Date(2026, 7, 24, hour, minute, 0, 0).toISOString();
  const generatedFrontmatter = {
    tpsId: 'workout-generated', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Workout 2026-08-24 06.16', workoutDate: '2026-08-24', startedAt: localStartedAt(6, 16),
  };
  const generated = addFrontmatterFile('_records/workout-sessions/Workout 2026-08-24 06.16.md', generatedFrontmatter);
  service.indexFile(generated, generatedFrontmatter);
  const mismatchedDateFrontmatter = {
    tpsId: 'workout-wrong-date', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Workout 2026-08-23 06.16', workoutDate: '2026-08-24', startedAt: localStartedAt(6, 16),
  };
  const mismatchedDate = addFrontmatterFile('_records/workout-sessions/Workout 2026-08-23 06.16.md', mismatchedDateFrontmatter);
  service.indexFile(mismatchedDate, mismatchedDateFrontmatter);
  const customBasenameFrontmatter = {
    tpsId: 'workout-custom-name', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Workout 2026-08-24 07.00', workoutDate: '2026-08-24', startedAt: localStartedAt(7, 0),
  };
  const customBasename = addFrontmatterFile('_records/workout-sessions/My preferred workout.md', customBasenameFrontmatter);
  service.indexFile(customBasename, customBasenameFrontmatter);
  const manualTitleFirstFrontmatter = {
    tpsId: 'workout-manual-title-first', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Strength', workoutDate: '2026-08-24', startedAt: localStartedAt(7, 30),
  };
  const manualTitleFirst = addFrontmatterFile('_records/workout-sessions/Strength 2026-08-24 07.30.md', manualTitleFirstFrontmatter);
  service.indexFile(manualTitleFirst, manualTitleFirstFrontmatter);
  const nonGeneratedTimeFrontmatter = {
    tpsId: 'workout-non-generated-time', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Workout 2026-08-24 7.45', workoutDate: '2026-08-24', startedAt: localStartedAt(7, 45),
  };
  const nonGeneratedTime = addFrontmatterFile('_records/workout-sessions/Workout 2026-08-24 7.45.md', nonGeneratedTimeFrontmatter);
  service.indexFile(nonGeneratedTime, nonGeneratedTimeFrontmatter);
  const mismatchedTimeFrontmatter = {
    tpsId: 'workout-wrong-time', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Workout 2026-08-24 08.30', workoutDate: '2026-08-24', startedAt: localStartedAt(9, 30),
  };
  const mismatchedTime = addFrontmatterFile('_records/workout-sessions/Workout 2026-08-24 08.30.md', mismatchedTimeFrontmatter);
  service.indexFile(mismatchedTime, mismatchedTimeFrontmatter);
  const missingStartedAtFrontmatter = {
    tpsId: 'workout-missing-start', tpsSchemaVersion: 1, kind: 'workout-session',
    title: 'Workout 2026-08-24 10.00', workoutDate: '2026-08-24',
  };
  const missingStartedAt = addFrontmatterFile('_records/workout-sessions/Workout 2026-08-24 10.00.md', missingStartedAtFrontmatter);
  service.indexFile(missingStartedAt, missingStartedAtFrontmatter);

  assert.deepEqual(await service.normalizeNativeRecordFilenames(), {
    inspected: 7,
    renamed: 1,
    unchanged: 6,
    failed: 0,
    renamedPaths: {
      'workout-generated': '_records/workout-sessions/2026-08-24 - Workout 06.16.md',
    },
  });
  assert.equal(generated.path, '_records/workout-sessions/2026-08-24 - Workout 06.16.md');
  assert.equal(mismatchedDate.path, '_records/workout-sessions/Workout 2026-08-23 06.16.md');
  assert.equal(customBasename.path, '_records/workout-sessions/My preferred workout.md');
  assert.equal(manualTitleFirst.path, '_records/workout-sessions/Strength 2026-08-24 07.30.md');
  assert.equal(nonGeneratedTime.path, '_records/workout-sessions/Workout 2026-08-24 7.45.md');
  assert.equal(mismatchedTime.path, '_records/workout-sessions/Workout 2026-08-24 08.30.md');
  assert.equal(missingStartedAt.path, '_records/workout-sessions/Workout 2026-08-24 10.00.md');
  assert.deepEqual(await service.normalizeNativeRecordFilenames(), {
    inspected: 7, renamed: 0, unchanged: 7, failed: 0, renamedPaths: {},
  });
});

test('readable filename migration preserves a manual rename that lands while the batch is running', async () => {
  const { service, api, files } = createHarness({ apiVersion: 6, legacyFileNames: true });
  await service.createFoodEntry({
    id: 'food-a', createdDate: '2026-08-24T12:00:00.000Z', completedDate: '2026-08-24T12:00:00.000Z',
    item: { id: 'apple-a', name: 'Apple A', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  const later = await service.createFoodEntry({
    id: 'food-b', createdDate: '2026-08-24T13:00:00.000Z', completedDate: '2026-08-24T13:00:00.000Z',
    item: { id: 'apple-b', name: 'Apple B', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  api.version = 6;
  const rename = api.rename.bind(api);
  let injected = false;
  api.rename = async (...args) => {
    const result = await rename(...args);
    if (!injected) {
      injected = true;
      files.delete(later.file.path);
      later.file.path = '_records/food-entries/My manual apple.md';
      later.file.name = 'My manual apple.md';
      later.file.basename = 'My manual apple';
      files.set(later.file.path, later.file);
    }
    return result;
  };

  assert.deepEqual(await service.normalizeNativeRecordFilenames(), {
    inspected: 2,
    renamed: 1,
    unchanged: 1,
    failed: 0,
    renamedPaths: { 'food-a': '_records/food-entries/2026-08-24 - Apple A.md' },
  });
  assert.equal(later.file.path, '_records/food-entries/My manual apple.md');
});

test('active workout filename reconciliation is atomic against finish, discard, and replacement races', () => {
  const result = {
    inspected: 1,
    renamed: 1,
    unchanged: 0,
    failed: 0,
    renamedPaths: { 'workout-a': '_records/workout-sessions/2026-08-24 - Strength.md' },
  };
  const captured = { id: 'workout-a', path: '_records/workout-sessions/workout-a.md' };
  const indexedSession = { id: 'workout-a', path: '_records/workout-sessions/2026-08-24 - Strength.md' };

  assert.deepEqual(resolveActiveWorkoutAfterFilenameMigration({ captured, current: captured, result, indexedSession }), {
    id: 'workout-a', path: '_records/workout-sessions/2026-08-24 - Strength.md',
  });
  assert.equal(resolveActiveWorkoutAfterFilenameMigration({
    captured, current: { id: '', path: '' }, result, indexedSession,
  }), null, 'a concurrent finish or discard cannot resurrect path-only active state');
  assert.equal(resolveActiveWorkoutAfterFilenameMigration({
    captured, current: { id: 'workout-b', path: '_records/workout-sessions/workout-b.md' }, result, indexedSession,
  }), null, 'a replacement active session cannot receive the prior session path');
  assert.deepEqual(resolveActiveWorkoutAfterFilenameMigration({
    captured,
    current: captured,
    result: { ...result, renamed: 0, unchanged: 1, renamedPaths: {} },
    indexedSession,
  }), { id: 'workout-a', path: indexedSession.path }, 'an already-renamed idempotent rerun repairs a stale persisted path');
});

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

test('native Health indexing follows GCM API v6 legacy tag inspection without physical ID/schema properties', () => {
  const { service } = createHarness({ apiVersion: 6 });
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
  assert.deepEqual(service.getDailyFoodEntries('2026-08-24').map((entry) => ({
    id: entry.id,
    title: entry.title,
    quantity: entry.quantity,
    unit: entry.unit,
    calories: entry.calories,
    proteinG: entry.proteinG,
    carbsG: entry.carbsG,
    fatG: entry.fatG,
  })), [
    { id: 'food-1', title: 'Apple', quantity: 1, unit: 'serving', calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3 },
    { id: 'food-2', title: 'Dinner', quantity: 1, unit: 'serving', calories: 600, proteinG: 40, carbsG: 50, fatG: 20 },
  ], 'macro contribution rows preserve chronological entry identity, serving, and projected core macros');
  const foodRecord = [...service.recordsByPath.values()].find((record) => record.id === 'food-1');
  assert.equal(Object.hasOwn(foodRecord.frontmatter, 'foodId'), false, 'tpsId is the only food-record identity');
  assert.equal(Object.hasOwn(foodRecord.frontmatter, 'servingQuantity'), false, 'new records keep one authored quantity field');
  assert.equal(Object.hasOwn(foodRecord.frontmatter, 'servingUnit'), false, 'new records keep one authored unit field');
  for (const redundant of ['status', 'date', 'foodName', 'brand', 'amount', 'amountUnit', 'tags']) {
    assert.equal(Object.hasOwn(foodRecord.frontmatter, redundant), false, `${redundant} is not duplicated on a food entry`);
  }

  const activity = await service.createActivityEntry({
    id: 'activity-1', activity: 'Walk', activityType: 'walking', startedAt: '2026-08-24T07:00:00.000Z', completedDate: '2026-08-24T07:30:00.000Z', durationMinutes: 30, source: 'manual',
  });
  assert.equal(activity.frontmatter.durationMinutes, 30);
  assert.equal(activity.frontmatter.completedDate, '2026-08-24T07:30:00.000Z');
  for (const redundant of ['status', 'date', 'activity', 'source', 'tags']) {
    assert.equal(Object.hasOwn(activity.frontmatter, redundant), false, `${redundant} is implied or duplicated`);
  }
  assert.deepEqual(service.getDailyActivityTotals('2026-08-24'), {
    dateIso: '2026-08-24', entryCount: 1, durationMinutes: 30, caloriesBurned: 0, steps: 0,
  });
});

test('daily dashboard record actions edit snapshots and archive only the selected entry', async () => {
  const { service, addFrontmatterFile } = createHarness();
  addFrontmatterFile('Apple.md', {
    kind: 'food', servingAmount: 1, servingUnit: 'apple', servingGrams: 180,
    calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3, fiberG: 4.4, sodiumMg: 2,
  });
  const food = await service.createFoodEntry({
    id: 'food-edit', createdDate: '2026-08-24T12:00:00.000Z', completedDate: '2026-08-24T12:00:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual', sourcePath: 'Apple.md' },
    quantity: 1, unit: 'serving', nutritionOverride: { calories: 95, proteinG: 0.5, carbsG: 25, fatG: 0.3 },
  });
  const activity = await service.createActivityEntry({
    id: 'activity-edit', activity: 'Walk', activityType: 'walking', startedAt: '2026-08-24T07:00:00.000Z',
    completedDate: '2026-08-24T07:30:00.000Z', durationMinutes: 30, steps: 3200, source: 'manual',
  });

  const foodSnapshot = service.getDailyFoodEntries('2026-08-24')[0];
  assert.equal(foodSnapshot.linkedFood, true);
  await service.updateDailyFoodEntry(food.path, {
    ...foodSnapshot,
    title: 'Two apples',
    quantity: 2,
    calories: 999,
  });
  const editedFood = service.getDailyFoodEntries('2026-08-24')[0];
  assert.equal(editedFood.title, 'Two apples');
  assert.equal(editedFood.quantity, 2);
  assert.equal(editedFood.calories, 190, 'linked logs reproject nutrition from their food definition instead of accepting stale manual macros');

  const activitySnapshot = service.getDailyActivityEntries('2026-08-24')[0];
  assert.deepEqual({ kind: activitySnapshot.kind, title: activitySnapshot.title, durationMinutes: activitySnapshot.durationMinutes, steps: activitySnapshot.steps }, {
    kind: 'activity-entry', title: 'Walk', durationMinutes: 30, steps: 3200,
  });
  await service.updateDailyActivityEntry(activity.path, {
    ...activitySnapshot,
    title: 'Long walk',
    durationMinutes: 45,
    steps: 5000,
  });
  assert.deepEqual(service.getDailyActivityEntries('2026-08-24').map((entry) => [entry.title, entry.durationMinutes, entry.steps]), [
    ['Long walk', 45, 5000],
  ]);

  await service.archiveDailyEntry(food.path, 'food-entry');
  assert.equal(service.getDailyFoodEntries('2026-08-24').length, 0);
  assert.equal(service.getDailyFoodTotals('2026-08-24').entryCount, 0);
  assert.equal(service.getDailyActivityEntries('2026-08-24').length, 1, 'archiving food does not remove activity');
  await service.archiveDailyEntry(activity.path, 'activity-entry');
  assert.equal(service.getDailyActivityEntries('2026-08-24').length, 0);
  assert.equal(service.getDailyActivityTotals('2026-08-24').entryCount, 0);
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

  const authored = {
    ...(await api.resolve(created.file)).frontmatter,
    quantity: 3,
    unit: 'cup',
    tags: ['tps/record/v1/food-entry/food-yogurt', 'user/keep'],
  };
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
  assert.equal(Object.hasOwn(persisted.frontmatter, 'amount'), false, 'converted amount remains a derived in-memory value');
  assert.equal(Object.hasOwn(persisted.frontmatter, 'amountUnit'), false);
  assert.equal(persisted.frontmatter.calories, 240);
  assert.equal(persisted.frontmatter.proteinG, 36);
  assert.equal(persisted.frontmatter.carbsG, 27);
  assert.equal(persisted.frontmatter.sodiumMg, 135);
  assert.deepEqual(persisted.frontmatter.tags, authored.tags, 'projection cleanup preserves GCM identity and user tags');
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
  assert.equal(food.frontmatter.completedDate, '2026-08-25T00:32:00.000Z');
  assert.equal(Object.hasOwn(food.frontmatter, 'date'), false, 'the local day derives from one timestamp instead of a duplicate date property');
  assert.equal(service.getDailyFoodTotals('2026-08-24').entryCount, 1, '7:32 PM Central remains on the Aug 24 dashboard');

  const dateOnlyFood = await service.createFoodEntry({
    id: 'food-date-only',
    createdDate: '2026-08-24',
    completedDate: '2026-08-24',
    item: { id: 'apple', name: 'Apple', source: 'manual', nutrition: { calories: 95 } },
    quantity: 1,
    unit: 'serving',
  });
  assert.equal(dateOnlyFood.frontmatter.completedDate, '2026-08-24', 'date-only input is stored once and never shifted');

  const activity = await service.createActivityEntry({
    id: 'activity-evening',
    activity: 'Walk',
    activityType: 'walking',
    startedAt: '2026-08-25T00:02:00.000Z',
    completedDate: '2026-08-25T00:32:00.000Z',
    durationMinutes: 30,
    source: 'manual',
  });
  assert.equal(activity.frontmatter.completedDate, '2026-08-25T00:32:00.000Z');
  assert.equal(Object.hasOwn(activity.frontmatter, 'date'), false);

  const workout = await service.createWorkoutSession({
    title: 'Evening workout',
    startedAt: '2026-08-25T00:32:00.000Z',
    workoutDate: '2026-08-24',
  }, 'workout-evening');
  assert.equal(Object.hasOwn(workout.frontmatter, 'date'), false);
  assert.equal(Object.hasOwn(workout.frontmatter, 'workoutDate'), false);
  assert.equal(service.getDailyActivityTotals('2026-08-24').entryCount, 2, 'the activity and workout days both derive from their timestamps');
});

test('native workout session stores every exercise and set atomically in one note', async () => {
  const { service, createCalls, files, frontmatters } = createHarness();
  const session = await service.createWorkoutSession({ title: 'Strength', startedAt: '2026-08-24T08:00:00.000Z' }, 'workout-1');
  frontmatters.set(session.file, {
    ...frontmatters.get(session.file),
    tags: ['tps/record/v1/workout-session/workout-1', 'user/keep'],
  });
  service.indexFile(session.file, frontmatters.get(session.file));
  assert.equal(Object.hasOwn(session.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(session.frontmatter, 'exerciseRecordIds'), false);
  await assert.rejects(
    () => service.appendWorkoutSet(session.file, { id: 'set-missing-definition', exercise: 'Bench press', reps: 1 }),
    /reusable exercise note is required/i,
    'session data cannot create an unlinked exercise occurrence',
  );
  await service.appendWorkoutSet(session.file, { id: 'set-1', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', endedAt: '2026-08-24T08:05:00.000Z', reps: 8, weight: 100, weightUnit: 'lb' });
  const second = await service.appendWorkoutSet(session.file, { id: 'set-2', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', endedAt: '2026-08-24T08:10:00.000Z', reps: 6, weight: 110, weightUnit: 'lb' });
  assert.equal(second.exercise.frontmatter.setCount, 2);
  assert.equal(second.exercise.frontmatter.totalReps, 14);
  assert.equal(second.exercise.frontmatter.totalVolume, 1460);
  for (const derived of ['setCount', 'exerciseCount', 'totalReps', 'totalVolume', 'lastSetEndedAt']) {
    assert.equal(Object.hasOwn(second.session.frontmatter, derived), false, `${derived} derives from the nested session graph`);
  }
  assert.equal(Object.hasOwn(second.session.frontmatter, 'workoutData'), false, 'the legacy JSON property is removed');
  assert.equal(second.session.frontmatter.session.exercises[0].sets.length, 2, 'one nested property owns the complete graph');
  assert.deepEqual(second.session.frontmatter.tags, ['tps/record/v1/workout-session/workout-1', 'user/keep']);
  assert.equal(createCalls.filter((call) => call.kind === 'workout-exercise').length, 0, 'exercise occurrences never create child notes');
  assert.equal([...files.values()].filter((file) => file.path.includes('/workout-exercises/')).length, 0);
  assert.equal(service.isWorkoutSession(session.path, 'workout-1'), true);
  assert.equal(second.exercise.path, session.path);
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
      path: session.path,
      name: 'Bench press',
      exercisePath: 'Health/Exercises/Bench press.md',
      totalReps: 14,
      totalVolume: 1460,
      sets: [
        {
          id: 'set-1', ordinal: 1, reps: 8, weight: 100, weightUnit: 'lb', perArm: false,
          rpe: undefined, restSeconds: undefined, setType: 'normal', completedDate: '2026-08-24T08:05:00.000Z', restStartedAt: '', note: '',
        },
        {
          id: 'set-2', ordinal: 2, reps: 6, weight: 110, weightUnit: 'lb', perArm: false,
          rpe: undefined, restSeconds: undefined, setType: 'normal', completedDate: '2026-08-24T08:10:00.000Z', restStartedAt: '', note: '',
        },
      ],
    }],
  }, 'the UI projection is derived from the indexed atomic set list in authored order');
  const edited = await service.updateWorkoutSet(session.file, 'set-2', {
    reps: 10,
    weight: 105,
    weightUnit: 'kg',
    perArm: true,
    rpe: 8.5,
    restSeconds: 75,
    setType: 'drop',
  });
  for (const derived of ['setCount', 'exerciseCount', 'totalReps', 'totalVolume']) {
    assert.equal(Object.hasOwn(edited.frontmatter, derived), false, `${derived} remains a projection after editing`);
  }
  assert.equal(service.getWorkoutSnapshot(session.path).exercises[0].totalReps, 18);
  assert.equal(service.getWorkoutSnapshot(session.path).exercises[0].totalVolume, 2900);
  assert.deepEqual(service.getWorkoutSnapshot(session.path).exercises[0].sets[1], {
    id: 'set-2', ordinal: 2, reps: 10, weight: 105, weightUnit: 'kg', perArm: true,
    rpe: 8.5, restSeconds: 75, setType: 'drop', completedDate: '2026-08-24T08:10:00.000Z', restStartedAt: '', note: '',
  }, 'inline edits retain the stable set identity and update the indexed projection');
  await assert.rejects(
    () => service.updateWorkoutSet(session.file, 'missing-set', { reps: 1 }),
    /not found/u,
    'an unresolved row never mutates a different set',
  );
  const finished = await service.finishWorkout(session.file, { endedAt: '2026-08-24T09:00:00.000Z' });
  assert.equal(finished.frontmatter.status, 'complete');
  assert.equal(service.getWorkoutSnapshot('workout-1').setCount, 2, 'finished sessions retain their table projection after active state clears');
});

test('one service-owned queue preserves concurrent workout-session mutations', async () => {
  const { service, frontmatters } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Concurrent strength',
    startedAt: '2026-08-31T08:00:00.000Z',
  }, 'workout-concurrent');
  await Promise.all([
    service.appendWorkoutSet(session.file, {
      id: 'set-a', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', reps: 8, weight: 100,
    }),
    service.appendWorkoutSet(session.file, {
      id: 'set-b', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', reps: 6, weight: 110,
    }),
  ]);

  const snapshot = service.getWorkoutSnapshot(session.path);
  assert.deepEqual(snapshot.exercises[0].sets.map((set) => set.id), ['set-a', 'set-b']);
  assert.deepEqual(frontmatters.get(session.file).session.exercises[0].sets.map((set) => set.id), ['set-a', 'set-b']);
});

test('workout mutation retries from frontmatter changed immediately before its atomic write', async () => {
  const externalData = {
    version: 1,
    exercises: [{
      id: 'external-exercise',
      name: 'Row',
      exercise: '[[Health/Exercises/Row]]',
      sets: [{ id: 'external-set', reps: 10, weight: 50, unit: 'lb' }],
    }],
  };
  const { service } = createHarness({
    beforeFrontmatterProcess({ file, frontmatters, writeFrontmatterContent }) {
      const next = { ...frontmatters.get(file), session: externalData };
      frontmatters.set(file, next);
      writeFrontmatterContent(file, next);
      this.beforeFrontmatterProcess = null;
    },
  });
  const session = await service.createWorkoutSession({
    title: 'Synced strength',
    startedAt: '2026-08-31T08:00:00.000Z',
  }, 'workout-synced');
  await service.appendWorkoutSet(session.file, {
    id: 'local-set', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', reps: 8, weight: 100,
  });

  const snapshot = service.getWorkoutSnapshot(session.path);
  assert.deepEqual(snapshot.exercises.map((exercise) => exercise.name), ['Row', 'Bench press']);
  assert.deepEqual(snapshot.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)), ['external-set', 'local-set']);
});

test('the next workout edit migrates a legacy body comment into the nested session property', async () => {
  const { service, contents, frontmatters } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Legacy comment workout', startedAt: '2026-08-31T08:00:00.000Z',
  }, 'workout-legacy-comment');
  const legacyData = JSON.stringify({
    version: 1,
    exercises: [{
      id: 'legacy-exercise', name: 'Row', exercisePath: 'Health/Exercises/Row.md',
      sets: [{ id: 'legacy-set', reps: 10, weight: 50, weightUnit: 'lb' }],
    }],
  });
  const legacyFrontmatter = { ...frontmatters.get(session.file) };
  delete legacyFrontmatter.session;
  frontmatters.set(session.file, legacyFrontmatter);
  const withoutSession = contents.get(session.path).replace(/^session:.*\n/mu, '');
  contents.set(session.path, writeWorkoutDataToNoteContent(withoutSession, legacyData));

  await service.appendWorkoutSet(session.file, {
    id: 'new-set', exercise: 'Row', exercisePath: 'Health/Exercises/Row.md', reps: 8, weight: 60,
  });

  assert.deepEqual(frontmatters.get(session.file).session.exercises[0].sets.map((set) => set.id), ['legacy-set', 'new-set']);
  assert.equal(readWorkoutDataFromNoteContent(contents.get(session.path)), null, 'the legacy comment is removed after the atomic property write');
});

test('an unreadable nested workout session fails closed instead of being mistaken for an empty session', async () => {
  const { service, contents, frontmatters } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Corrupt sync payload', startedAt: '2026-08-31T08:00:00.000Z',
  }, 'workout-corrupt');
  const corrupt = contents.get(session.path).replace(/^session:.*$/mu, 'session: invalid-synced-value');
  contents.set(session.path, corrupt);
  frontmatters.set(session.file, { ...frontmatters.get(session.file), session: 'invalid-synced-value' });
  await assert.rejects(
    () => service.appendWorkoutSet(session.file, {
      id: 'must-not-write', exercise: 'Row', exercisePath: 'Health/Exercises/Row.md', reps: 10,
    }),
    /session property is invalid/u,
  );
  assert.equal(contents.get(session.path), corrupt);
});

test('a failed atomic frontmatter write can be retried without duplicating a workout set', async () => {
  const harness = createHarness({
    beforeFrontmatterProcess() {
      this.beforeFrontmatterProcess = null;
      throw new Error('simulated frontmatter failure');
    },
  });
  const session = await harness.service.createWorkoutSession({
    title: 'Retry-safe strength', startedAt: '2026-08-31T08:00:00.000Z',
  }, 'workout-retry-safe');
  const set = { id: 'stable-set', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', reps: 8 };
  await assert.rejects(() => harness.service.appendWorkoutSet(session.file, set), /simulated frontmatter failure/u);
  await harness.service.appendWorkoutSet(session.file, set);
  await harness.service.appendWorkoutSet(session.file, set);
  assert.deepEqual(harness.service.getWorkoutSnapshot(session.path).exercises[0].sets.map((entry) => entry.id), ['stable-set']);
});

test('a failed terminal workout update leaves the nested session and semantic state untouched', async () => {
  const failed = createHarness({
    beforeFrontmatterProcess() {
      throw new Error('simulated frontmatter failure');
    },
  });
  const session = await failed.service.createWorkoutSession({
    title: 'Failed finish', startedAt: '2026-08-31T10:00:00.000Z',
  }, 'workout-failed-finish');
  const before = failed.contents.get(session.path);

  await assert.rejects(
    () => failed.service.finishWorkout(session.file, '2026-08-31T11:00:00.000Z'),
    /simulated frontmatter failure/u,
  );
  assert.equal(failed.contents.get(session.path), before, 'session data and semantic frontmatter are one atomic write');
  assert.equal(failed.service.getWorkoutSnapshot(session.path).status, 'active');
});

test('native workout structure edits persist sets, exercise order, supersets, and drop sets in the session note', async () => {
  const { service, files, frontmatters, contents } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Live strength',
    startedAt: '2026-08-31T08:00:00.000Z',
  }, 'workout-structure');
  await service.ensureWorkoutExercise(session, 'Bench press', 'Health/Exercises/Bench press.md');
  await service.ensureWorkoutExercise(session, 'Row', 'Health/Exercises/Row.md');
  await service.ensureWorkoutExercise(session, 'Overhead press', 'Health/Exercises/Overhead press.md');
  await service.appendWorkoutSet(session.file, {
    id: 'bench-1', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md',
    reps: 8, weight: 100, weightUnit: 'lb', rpe: 8, restSeconds: 90,
    completedDate: '2026-08-31T08:05:00.000Z',
  });

  let snapshot = service.getWorkoutSnapshot(session.path);
  const benchId = snapshot.exercises.find((exercise) => exercise.name === 'Bench press').id;
  const rowId = snapshot.exercises.find((exercise) => exercise.name === 'Row').id;
  const pressId = snapshot.exercises.find((exercise) => exercise.name === 'Overhead press').id;

  await service.addPlannedWorkoutSet(session.path, benchId);
  snapshot = service.getWorkoutSnapshot(session.path);
  const bench = snapshot.exercises.find((exercise) => exercise.id === benchId);
  assert.equal(bench.sets.length, 2, '+ Set appends a persisted row instead of opening a transient draft');
  assert.deepEqual(bench.sets[1], {
    id: bench.sets[1].id,
    ordinal: 2,
    reps: 8,
    weight: 100,
    weightUnit: 'lb',
    perArm: false,
    rpe: 8,
    restSeconds: 90,
    setType: 'normal',
    completedDate: '',
    restStartedAt: '',
    note: '',
  }, 'the new set is editable and seeded from the prior set without copying completion state');

  await service.reorderWorkoutExercise(session.path, pressId, -1);
  snapshot = service.getWorkoutSnapshot(session.path);
  assert.deepEqual(snapshot.exercises.map((exercise) => exercise.name), ['Bench press', 'Overhead press', 'Row']);

  await service.setWorkoutSupersetLinks(session.path, benchId, [rowId]);
  snapshot = service.getWorkoutSnapshot(session.path);
  const supersetMembers = snapshot.exercises.filter((exercise) => exercise.supersetGroupId);
  assert.deepEqual(supersetMembers.map((exercise) => exercise.id).sort(), [benchId, rowId].sort());
  assert.equal(supersetMembers[0].supersetGroupId, supersetMembers[1].supersetGroupId, 'arbitrary exercises share one superset group');
  assert.equal(snapshot.exercises.find((exercise) => exercise.id === pressId).supersetGroupId, undefined);

  const firstSet = snapshot.exercises.find((exercise) => exercise.id === benchId).sets[0];
  const secondSet = snapshot.exercises.find((exercise) => exercise.id === benchId).sets[1];
  await service.setWorkoutDropSetLinks(session.path, benchId, firstSet.id, [secondSet.id]);
  snapshot = service.getWorkoutSnapshot(session.path);
  let benchSets = snapshot.exercises.find((exercise) => exercise.id === benchId).sets;
  assert.equal(benchSets[0].dropSetGroupId, benchSets[1].dropSetGroupId);
  assert.equal(benchSets[0].setType, 'normal');
  assert.equal(benchSets[1].setType, 'drop');

  await service.setWorkoutDropSetLinks(session.path, benchId, firstSet.id, [], true);
  snapshot = service.getWorkoutSnapshot(session.path);
  benchSets = snapshot.exercises.find((exercise) => exercise.id === benchId).sets;
  assert.equal(benchSets.length, 3, 'the drop-set picker can create a real additional set');
  assert.equal(benchSets[0].dropSetGroupId, benchSets[2].dropSetGroupId);
  assert.equal(benchSets[1].dropSetGroupId, undefined, 'relinking clears the prior group instead of duplicating membership');
  assert.equal(benchSets[1].setType, 'normal');
  assert.equal(benchSets[2].setType, 'drop');

  const stored = frontmatters.get(session.file).session;
  assert.deepEqual(stored.exercises.map((exercise) => exercise.name), ['Bench press', 'Overhead press', 'Row']);
  assert.equal(readWorkoutDataFromNoteContent(contents.get(session.file.path)), null, 'new storage never writes a body comment');
  assert.equal([...files.values()].filter((file) => file.path.includes('/workout-exercises/')).length, 0, 'structural edits never create child notes');
});

test('native set completion starts rest only after the final superset exercise and can be undone', async () => {
  const { service } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Superset timing',
    startedAt: '2026-09-01T11:00:00.000Z',
  }, 'workout-superset-timing');
  await service.ensureWorkoutExercise(session, 'Pulldown', 'Health/Exercises/Pulldown.md');
  await service.ensureWorkoutExercise(session, 'Pushdown', 'Health/Exercises/Pushdown.md');
  let snapshot = service.getWorkoutSnapshot(session.path);
  const pulldown = snapshot.exercises.find((exercise) => exercise.name === 'Pulldown');
  const pushdown = snapshot.exercises.find((exercise) => exercise.name === 'Pushdown');
  await service.addPlannedWorkoutSet(session.path, pulldown.id);
  await service.addPlannedWorkoutSet(session.path, pulldown.id);
  await service.addPlannedWorkoutSet(session.path, pushdown.id);
  await service.addPlannedWorkoutSet(session.path, pushdown.id);
  await service.setWorkoutSupersetLinks(session.path, pulldown.id, [pushdown.id]);

  snapshot = service.getWorkoutSnapshot(session.path);
  const firstPulldown = snapshot.exercises.find((exercise) => exercise.id === pulldown.id).sets[0];
  const firstPushdown = snapshot.exercises.find((exercise) => exercise.id === pushdown.id).sets[0];
  await service.updateWorkoutSet(session.path, firstPulldown.id, { completed: true });
  snapshot = service.getWorkoutSnapshot(session.path);
  assert.ok(snapshot.exercises.find((exercise) => exercise.id === pulldown.id).sets[0].completedDate);
  assert.equal(snapshot.exercises.find((exercise) => exercise.id === pushdown.id).sets[0].restStartedAt, '', 'moving to the next superset member does not start rest');
  assert.equal(snapshot.exercises.find((exercise) => exercise.id === pulldown.id).sets[1].restStartedAt, '');

  await service.updateWorkoutSet(session.path, firstPushdown.id, { completed: true });
  snapshot = service.getWorkoutSnapshot(session.path);
  const completedPushdownAt = snapshot.exercises.find((exercise) => exercise.id === pushdown.id).sets[0].completedDate;
  assert.ok(completedPushdownAt);
  assert.equal(
    snapshot.exercises.find((exercise) => exercise.id === pulldown.id).sets[1].restStartedAt,
    completedPushdownAt,
    'the next round starts resting only when the last superset member is complete',
  );

  await service.updateWorkoutSet(session.path, firstPushdown.id, { completed: false });
  snapshot = service.getWorkoutSnapshot(session.path);
  assert.equal(snapshot.exercises.find((exercise) => exercise.id === pushdown.id).sets[0].completedDate, '');
  assert.equal(snapshot.exercises.find((exercise) => exercise.id === pulldown.id).sets[1].restStartedAt, '', 'undoing completion removes only the timer it started');
});

test('a one-set exercise can add a drop set directly and completion starts rest only after the drop chain', async () => {
  const { service } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Direct drop set',
    startedAt: '2026-09-02T11:00:00.000Z',
  }, 'workout-direct-drop');
  await service.ensureWorkoutExercise(session, 'Curl', 'Health/Exercises/Curl.md');
  let snapshot = service.getWorkoutSnapshot(session.path);
  const curl = snapshot.exercises[0];
  await service.addPlannedWorkoutSet(session.path, curl.id);
  snapshot = service.getWorkoutSnapshot(session.path);
  const rootSet = snapshot.exercises[0].sets[0];
  await service.setWorkoutDropSetLinks(session.path, curl.id, rootSet.id, [], true);
  snapshot = service.getWorkoutSnapshot(session.path);
  const firstDropSet = snapshot.exercises[0].sets[1];
  await service.setWorkoutDropSetLinks(session.path, curl.id, rootSet.id, [firstDropSet.id], true);
  await service.addPlannedWorkoutSet(session.path, curl.id);

  snapshot = service.getWorkoutSnapshot(session.path);
  const sets = snapshot.exercises[0].sets;
  assert.equal(sets.length, 4);
  assert.ok(sets[0].dropSetGroupId);
  assert.equal(sets[1].dropSetGroupId, sets[0].dropSetGroupId);
  assert.equal(sets[2].dropSetGroupId, sets[0].dropSetGroupId, 'adding another drop set keeps the existing chain linked');
  assert.equal(sets[1].setType, 'drop');
  assert.equal(sets[2].setType, 'drop');

  await service.updateWorkoutSet(session.path, sets[0].id, { completed: true });
  snapshot = service.getWorkoutSnapshot(session.path);
  assert.equal(snapshot.exercises[0].sets[1].restStartedAt, '', 'the linked drop set follows immediately without rest');

  await service.updateWorkoutSet(session.path, sets[1].id, { completed: true });
  snapshot = service.getWorkoutSnapshot(session.path);
  assert.equal(snapshot.exercises[0].sets[2].restStartedAt, '', 'every linked drop set remains immediate');

  await service.updateWorkoutSet(session.path, sets[2].id, { completed: true });
  snapshot = service.getWorkoutSnapshot(session.path);
  const completedDropAt = snapshot.exercises[0].sets[2].completedDate;
  assert.equal(snapshot.exercises[0].sets[3].restStartedAt, completedDropAt, 'the first normal set after the drop chain receives the rest timer');
});

test('a blank native workout projects a newly attached exercise before its first set', async () => {
  const { service } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Blank workout',
    startedAt: '2026-08-27T08:00:00.000Z',
  }, 'workout-blank');

  const exercise = await service.ensureWorkoutExercise(session, 'Bench press', 'Health/Exercises/Bench press.md');
  const snapshot = service.getWorkoutSnapshot(session.path);

  assert.equal(exercise.frontmatter.setCount, 0);
  assert.equal(snapshot.exerciseCount, 1);
  assert.equal(snapshot.setCount, 0);
  assert.equal(snapshot.exercises[0].name, 'Bench press');
  assert.equal(snapshot.exercises[0].exercisePath, 'Health/Exercises/Bench press.md');
  assert.deepEqual(snapshot.exercises[0].sets, [], 'the live table can render its first editable draft row immediately');
});

test('legacy workout child notes consolidate into the parent and follow it to trash', async () => {
  const { service, addFrontmatterFile, files, frontmatters, contents, trashedPaths, exerciseDefinitions, emitVault } = createHarness();
  const session = addFrontmatterFile('_records/workout-sessions/legacy-workout.md', {
    tpsId: 'legacy-workout', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Legacy strength', status: 'complete',
    startedAt: '2026-08-22T08:00:00.000Z', setCount: 1, workoutData: 'invalid synced value',
  });
  const child = addFrontmatterFile('_records/workout-exercises/legacy-bench.md', {
    tpsId: 'legacy-bench', tpsSchemaVersion: 1, kind: 'workout-exercise', title: 'Bench press', exercise: 'Bench press',
    workout: '[[_records/workout-sessions/legacy-workout]]', exerciseOrder: 1,
    sets: [{ id: 'legacy-set', reps: 8, weight: 100, weightUnit: 'lb', completedDate: '2026-08-22T08:05:00.000Z' }],
  });
  service.indexFile(session, frontmatters.get(session));
  service.indexFile(child, frontmatters.get(child));

  assert.deepEqual(service.planWorkoutStorageConsolidation(), { sessions: 1, childNotes: 1 });
  assert.equal(service.getWorkoutSnapshot(session.path).exercises[0].sets[0].id, 'legacy-set');
  const result = await service.consolidateWorkoutStorage();
  assert.deepEqual(result, { sessions: 1, childNotes: 1, consolidated: 1, trashed: 1, failed: 0 });
  assert.equal(files.has(child.path), false);
  assert.equal(Object.hasOwn(frontmatters.get(session), 'workoutData'), false);
  assert.equal(typeof frontmatters.get(session).session, 'object');
  assert.equal(readWorkoutDataFromNoteContent(contents.get(session.path)), null);
  assert.equal(service.getWorkoutSnapshot(session.path).setCount, 1, 'the parent remains complete after child cleanup');
  assert.ok(exerciseDefinitions.has('Health/Exercises/Bench press.md'), 'consolidation backfills a reusable definition without moving session sets into it');
  assert.equal(service.getWorkoutSnapshot(session.path).exercises[0].exercisePath, 'Health/Exercises/Bench press.md');

  const orphanSession = addFrontmatterFile('_records/workout-sessions/delete-me.md', {
    tpsId: 'delete-me', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Delete me', status: 'complete',
  });
  const orphanChild = addFrontmatterFile('_records/workout-exercises/delete-me-child.md', {
    tpsId: 'delete-me-child', tpsSchemaVersion: 1, kind: 'workout-exercise', title: 'Row', exercise: 'Row',
    workout: '[[_records/workout-sessions/delete-me]]', sets: [],
  });
  service.indexFile(orphanSession, frontmatters.get(orphanSession));
  service.indexFile(orphanChild, frontmatters.get(orphanChild));
  files.delete(orphanSession.path);
  emitVault('delete', orphanSession);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(files.has(orphanChild.path), false, 'deleting an old workout also trashes only its redundant child notes');
  assert.ok(trashedPaths.includes(orphanChild.path));
});

test('the next live mutation upgrades an active child-note workout without losing sets', async () => {
  const { service, addFrontmatterFile, frontmatters, files, trashedPaths } = createHarness();
  const session = addFrontmatterFile('_records/workout-sessions/active-legacy.md', {
    tpsId: 'active-legacy', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Active legacy', status: 'active',
    startedAt: '2026-08-22T08:00:00.000Z', setCount: 1,
  });
  const child = addFrontmatterFile('_records/workout-exercises/active-bench.md', {
    tpsId: 'active-bench', tpsSchemaVersion: 1, kind: 'workout-exercise', title: 'Bench press', exercise: 'Bench press',
    workout: '[[_records/workout-sessions/active-legacy]]', exerciseOrder: 1,
    sets: [{ id: 'set-1', reps: 8, weight: 100, weightUnit: 'lb' }],
  });
  service.indexFile(session, frontmatters.get(session));
  service.indexFile(child, frontmatters.get(child));

  await service.appendWorkoutSet(session, { id: 'set-2', exercise: 'Bench press', exercisePath: 'Health/Exercises/Bench press.md', reps: 6, weight: 110, weightUnit: 'lb' });
  const snapshot = service.getWorkoutSnapshot(session.path);
  assert.deepEqual(snapshot.exercises[0].sets.map((set) => set.id), ['set-1', 'set-2']);
  assert.equal(snapshot.setCount, 2);
  assert.equal(files.has(child.path), false);
  assert.ok(trashedPaths.includes(child.path));
});

test('active workout resolution distinguishes moved, terminal, missing, conflicting, and duplicate sessions', async () => {
  const { service, addFrontmatterFile } = createHarness();
  const session = await service.createWorkoutSession({
    title: 'Strength', startedAt: '2026-08-24T08:00:00.000Z',
  }, 'workout-live');
  assert.deepEqual(service.resolveWorkoutSession({ id: 'workout-live', path: 'stale-name.md' }), {
    state: 'active', matches: 1, id: 'workout-live', path: session.path, title: 'Strength', status: 'active',
    startedAt: '2026-08-24T08:00:00.000Z',
  }, 'stable ID repairs a stale filename');

  const conflict = service.resolveWorkoutSession({ id: 'workout-missing', path: session.path });
  assert.equal(conflict.state, 'ambiguous');
  assert.equal(conflict.reason, 'identity-conflict');
  assert.equal(service.resolveWorkoutSession({ id: 'workout-missing', path: 'missing.md' }).state, 'missing');

  const otherSession = await service.createWorkoutSession({
    title: 'Cardio', startedAt: '2026-08-24T09:00:00.000Z',
  }, 'workout-other');
  const bothValidConflict = service.resolveWorkoutSession({ id: 'workout-live', path: otherSession.path });
  assert.equal(bothValidConflict.state, 'ambiguous', 'an ID and path that resolve to different valid sessions must fail closed');
  assert.equal(bothValidConflict.reason, 'identity-conflict');
  assert.equal(bothValidConflict.matches, 2);

  const duplicate = addFrontmatterFile('Duplicate Strength.md', {
    tpsId: 'workout-live', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Duplicate Strength', status: 'active',
    startedAt: '2026-08-24T08:01:00.000Z',
  });
  service.indexFile(duplicate);
  const ambiguous = service.resolveWorkoutSession({ id: 'workout-live', path: session.path });
  assert.equal(ambiguous.state, 'ambiguous');
  assert.equal(ambiguous.reason, 'duplicate-id');
  assert.equal(ambiguous.matches, 2);

  service.removePath(duplicate.path);
  const terminalFrontmatter = { ...session.frontmatter, status: 'complete', endedAt: '2026-08-24T09:00:00.000Z' };
  service.indexFile(session.file, terminalFrontmatter);
  const terminal = service.resolveWorkoutSession({ id: 'workout-live', path: session.path });
  assert.equal(terminal.state, 'terminal');
  assert.equal(terminal.status, 'complete');
});

test('workout resolution stays fail-closed until MetadataCache reports a settled generation', () => {
  const cold = createHarness({ layoutReady: true, metadataInitialized: false });
  assert.equal(cold.service.isWorkoutIndexSettled(), false, 'layout readiness alone cannot authorize stale-state clearing');
  cold.emitMetadata('resolved');
  assert.equal(cold.service.isWorkoutIndexSettled(), true, 'the authoritative resolved generation enables reconciliation');
});

test('explicit identity normalization replaces legacy workout joins before removing duplicate IDs', async () => {
  const { service, api, addFrontmatterFile } = createHarness();
  const food = await service.createFoodEntry({
    id: 'food-old', createdDate: '2026-08-24T12:00:00.000Z', item: { id: 'apple', name: 'Apple', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  const session = await service.createWorkoutSession({ title: 'Strength', startedAt: '2026-08-24T08:00:00.000Z' }, 'workout-old');
  const exercise = addFrontmatterFile('_records/workout-exercises/legacy-bench.md', {
    tpsId: 'legacy-bench', tpsSchemaVersion: 1, kind: 'workout-exercise', title: 'Bench press', exercise: 'Bench press',
    workoutId: session.id, workoutPath: session.path, sets: [],
  });
  service.indexFile(exercise);
  await api.update(food.file, { foodId: food.id });
  await api.update(session.file, { workoutId: session.id, exerciseRecordIds: ['legacy-bench'] });
  await api.update(exercise, { workout: null, workoutId: session.id, workoutPath: session.path, exerciseOrder: null });
  service.setup();

  const result = await service.normalizeNativeRecordIdentities();
  assert.deepEqual(result, { inspected: 3, updated: 3, skipped: 0 });
  const normalizedFood = await api.resolve(food.file);
  const normalizedSession = await api.resolve(session.file);
  const normalizedExercise = await api.resolve(exercise);
  assert.equal(Object.hasOwn(normalizedFood.frontmatter, 'foodId'), false);
  assert.equal(Object.hasOwn(normalizedSession.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(normalizedSession.frontmatter, 'exerciseRecordIds'), false);
  assert.equal(normalizedExercise.frontmatter.workout, `[[${session.path.replace(/\.md$/u, '')}]]`);
  assert.equal(normalizedExercise.frontmatter.exerciseOrder, 1);
  assert.equal(Object.hasOwn(normalizedExercise.frontmatter, 'workoutId'), false);
  assert.equal(Object.hasOwn(normalizedExercise.frontmatter, 'workoutPath'), false);
  assert.deepEqual(await service.normalizeNativeRecordIdentities(), { inspected: 3, updated: 0, skipped: 0 }, 'cleanup is idempotent');
});

test('native workout sessions render one persistent table without rewriting the note body', () => {
  assert.match(mainSource, /new NativeWorkoutSurfaceWidget\(plugin, filePath\)/u);
  assert.match(mainSource, /sourceView\.classList\.contains\("is-live-preview"\)/u);
  assert.match(mainSource, /renderNativeWorkoutSurfaceInReadingView\(this\.containerEl, this\.plugin, this\.ctx\.sourcePath\)/u);
  assert.match(mainSource, /this\.ensureNativeWorkoutReadingSurfaces\(\);/u);
  assert.match(mainSource, /view\.getMode\(\) !== "preview"/u);
  assert.match(mainSource, /\.markdown-preview-view \.markdown-preview-sizer/u);
  assert.match(mainSource, /getWorkoutSnapshot\(file\.path\)/u);
  assert.match(mainSource, /getWorkoutSnapshot\(active\.path\)\?\.exercises/u);
  assert.match(mainSource, /updateNativeWorkoutSetInline\(exercise\.path, set\.id, patch\)/u);
  assert.match(mainSource, /addNativePlannedWorkoutSet\(snapshot, exercise\)/u);
  assert.match(mainSource, /openNativeWorkoutExerciseMenu\(snapshot, exercise, event\)/u);
  assert.match(mainSource, /openNativeWorkoutSetMenu\(snapshot, exercise, set, event\)/u);
  assert.match(mainSource, /reorderWorkoutExercise\(snapshot\.path, exercise\.id, direction\)/u);
  assert.match(mainSource, /setWorkoutSupersetLinks\(snapshot\.path, exercise\.id, selectedIds\)/u);
  assert.match(mainSource, /setWorkoutDropSetLinks\(snapshot\.path, exercise\.id, set\.id, selected, Boolean\(created\)\)/u);
  assert.match(mainSource, /active-state:reconciled-from-native-record/u);
  const activeSurfaceGuard = mainSource.slice(
    mainSource.indexOf("  private isActiveNativeWorkoutSnapshot"),
    mainSource.indexOf("  private async logNativeWorkoutSetDraft"),
  );
  assert.match(activeSurfaceGuard, /isWorkoutIndexSettled\(\)/u);
  assert.match(activeSurfaceGuard, /resolveWorkoutSession\(\{ id: active\.id, path: active\.path \}\)/u);
  assert.match(activeSurfaceGuard, /resolution\.state !== "active" \|\| resolution\.id !== snapshot\.id \|\| resolution\.path !== snapshot\.path/u);
  assert.match(mainSource, /text\.setValue\(reps == null \? "" : String\(reps\)\)/u);
  assert.match(mainSource, /text\.setValue\(weight == null \? "" : String\(weight\)\)/u);
  assert.match(mainSource, /getWorkoutProgress\(workoutId\)/u);
  assert.match(mainSource, /this\.updateNativeWorkoutSurfaces\(\)/u);
  assert.doesNotMatch(mainSource, /registerMarkdownCodeBlockProcessor\("tps-health-workout"/u);
  assert.match(nativeWorkoutSurfaceSource, /\['Set', 'Reps', 'Weight', 'RPE', 'Rest', 'Type', 'Done'\]/u);
  assert.match(nativeWorkoutSurfaceSource, /options\.actions\.addSet\(exercise\)/u);
  assert.match(nativeWorkoutSurfaceSource, /options\.actions\.updateSet\(exercise, set, patch\)/u);
  assert.match(nativeWorkoutSurfaceSource, /priorCompleted \? 'Done ✓' : 'Complete'/u);
  assert.match(nativeWorkoutSurfaceSource, /\{ completed: !priorCompleted \}/u);
  assert.match(nativeWorkoutSurfaceSource, /aria-pressed/u);
  assert.match(nativeWorkoutSurfaceSource, /restCountdownLabel\(set\.restStartedAt, targetSeconds\)/u);
  assert.match(nativeWorkoutSurfaceSource, /options\.actions\.openExerciseMenu\(exercise, event\)/u);
  assert.match(nativeWorkoutSurfaceSource, /options\.actions\.openSetMenu\(exercise, set, event\)/u);
  assert.match(nativeWorkoutSurfaceSource, /tps-health-native-workout-row\$\{set\.dropSetGroupId \? ' is-drop-set' : ''\}/u);
  assert.doesNotMatch(nativeWorkoutSurfaceSource, /tps-health-native-workout-row is-draft/u);
  assert.match(nativeWorkoutSurfaceSource, /root\.dataset\.renderKey === signature/u);
  assert.match(nativeWorkoutSurfaceSource, /instance: options\.instanceKey/u);
  assert.match(mainSource, /instanceKey: this\.workoutSurfaceInstanceKey/u);
  assert.match(mainSource, /surface\.dataset\.renderContext = "reading"/u);
  assert.match(mainSource, /for \(const duplicate of matches\) duplicate\.remove\(\)/u);
  assert.match(mainSource, /if \(!target\?\.isConnected\) return false/u);
  assert.match(stylesSource, /\.markdown-source-view:not\(\.is-live-preview\) \.tps-health-native-workout-surface/u);
  assert.match(stylesSource, /\.tps-health-workout-entry-modal \.setting-item-control \{[\s\S]*?flex: 0 0 auto;/u, 'mobile set fields do not inherit a tall desktop flex basis');
  assert.match(stylesSource, /\.tps-health-workout-entry-modal > \.setting-item:last-child \{[\s\S]*?position: sticky;/u, 'mobile actions remain reachable above the keyboard');
  assert.match(stylesSource, /\.tps-health-native-workout-exercise\.is-superset/u);
  assert.match(stylesSource, /\.tps-health-native-workout-row\.is-drop-set/u);
  assert.match(stylesSource, /@container tps-health-native-workout \(max-width: 470px\)[\s\S]*?\.tps-health-native-workout-row \{[\s\S]*?min-width: 0;/u, 'narrow workout rows keep completion and the set menu on screen');
  assert.match(stylesSource, /\.tps-health-native-workout-button\.is-complete-toggle/u);
  assert.match(mainSource, /\.setTitle\("Add drop set"\)[\s\S]*?addNativeWorkoutDropSet\(snapshot, exercise, set\)/u);
  assert.match(mainSource, /const linkedSetIds = set\.dropSetGroupId[\s\S]*?candidate\.dropSetGroupId === set\.dropSetGroupId/u, 'direct add extends an existing drop chain');
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
  assert.match(mainSource, /Native records: Apply readable Health filenames/u);
  assert.match(mainSource, /Native records: Consolidate workouts into one note each/u);
  assert.match(mainSource, /planWorkoutStorageConsolidation\(\)/u);
  assert.match(mainSource, /consolidateWorkoutStorage\(\s*\(name, existingPath\) => this\.ensureExerciseDefinitionForWorkout/u);
  assert.doesNotMatch(mainSource, /serializeWorkoutMutation\([^\n]*native-/u, 'native sessions have one queue owner inside the native-record service');
  assert.match(mainSource, /normalizeNativeRecordFilenames\(\)/u);
  assert.match(mainSource, /const capturedActiveWorkout = \{[\s\S]*?id: this\.settings\.activeWorkoutId[\s\S]*?path: this\.settings\.activeWorkoutPath/u);
  assert.match(mainSource, /resolveActiveWorkoutAfterFilenameMigration\(\{[\s\S]*?current: \{ id: this\.settings\.activeWorkoutId[\s\S]*?getWorkoutSnapshot\(capturedWorkoutId\)/u);
  assert.match(mainSource, /persistActiveWorkoutFilenameMigration\(capturedActiveWorkout, reconciledActiveWorkout\)/u);
  assert.match(mainSource, /buildNativeHealthRecordFileName\("workout-session", \{[\s\S]*?workoutDate: isoDateKey\(dailyNoteDate\)[\s\S]*?startedAt/u);
  assert.match(settingsSource, /nativeRecords API v6 owns the note's single tpsId and readable filename/u);
});

test('legacy Health import is deterministic, typed, copy-only, and idempotent', async () => {
  const { service, addLegacyFile, contents, files, exerciseDefinitions } = createHarness({ apiVersion: 6 });
  const legacy = [
    '- Apple <!-- [type:: foodLog] [food:: Apple] [foodId:: food-old-1] [servings:: 2] [unit:: serving] [cal:: 190] [protein:: 1] [carbs:: 50] [fat:: 0.6] [fiber:: 8.8] [sodium:: 4] [completedDate:: 2026-08-23T12:00:00.000Z] -->',
    '- Walk <!-- [type:: activityLog] [activity:: Walk] [activityType:: walking] [activityId:: activity-old-1] [source:: manual] [durationMinutes:: 30] [startedAt:: 2026-08-23T08:00:00.000Z] [completedDate:: 2026-08-23T08:30:00.000Z] -->',
    '- Strength [type:: activityLog] [activity:: Strength] [activityType:: workout] [activityId:: workout-old-1] [workoutId:: workout-old-1] [startedAt:: 2026-08-23T09:00:00.000Z] [status:: complete]',
    '  - Bench [type:: workoutSet] [exercise:: Bench] [setId:: set-old-1] [reps:: 8] [weight:: 100] [unit:: lb] [endedAt:: 2026-08-23T09:10:00.000Z]',
  ].join('\n');
  addLegacyFile('2026-08-23.md', legacy);
  const before = contents.get('2026-08-23.md');
  const plan = await service.planLegacyImport();
  assert.equal(plan.candidates, 3, 'one imported workout produces one note regardless of exercise count');
  assert.equal(plan.foodEntries, 1);
  assert.equal(plan.workoutSessions, 1);
  assert.equal(plan.workoutExercises, 1);
  assert.equal(plan.totals.calories, 190);
  assert.equal(plan.unresolvedLines, 0);
  assert.equal(contents.get('2026-08-23.md'), before, 'dry run does not mutate the source');

  const first = await service.importLegacyRecords();
  assert.equal(first.created, 3);
  assert.equal(first.failed, 0);
  assert.equal(files.has('_records/food-entries/2026-08-23 - Apple.md'), true);
  assert.equal(files.has('_records/workout-sessions/2026-08-23 - Strength.md'), true);
  assert.equal(files.has('_records/workout-exercises/2026-08-23 - Bench.md'), false);
  assert.equal(service.getWorkoutSnapshot('workout-old-1').setCount, 1);
  assert.equal(service.getWorkoutSnapshot('workout-old-1').exercises[0].name, 'Bench');
  assert.equal(service.getWorkoutSnapshot('workout-old-1').exercises[0].exercisePath, 'Health/Exercises/Bench.md');
  assert.ok(exerciseDefinitions.has('Health/Exercises/Bench.md'));
  assert.equal(contents.get('2026-08-23.md'), before, 'copy import preserves legacy bytes');
  const second = await service.importLegacyRecords();
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 3);
  assert.equal(contents.get('2026-08-23.md'), before);
});

test('legacy inline parser does not interpret surrounding note text as properties', () => {
  assert.deepEqual(parseLegacyInlineFields('- Lunch note [type:: foodLog] [food:: A:B] trailing'), {
    type: 'foodLog',
    food: 'A:B',
  });
});
