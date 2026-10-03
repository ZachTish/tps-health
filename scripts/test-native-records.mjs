import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    stdin: {contents: 'export * from "./native-records"; export {configureCustomNutrients} from "./nutrients";', resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader:'ts'},
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
                if (raw.startsWith('[') && !raw.endsWith(']')) throw new Error('Invalid YAML sequence');
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
  configureCustomNutrients,
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
  const readCalls = [];
  const cachedReadCalls = [];
  const layoutReadyCallbacks = [];
  const trashedPaths = [];
  const exerciseDefinitions = new Set();
  let generated = 0;
  let processCalls = 0;
  const vaultEvents = new Map();
  const metadataEvents = new Map();
  const workspaceEvents = new Map();
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
    capabilities: options.customKinds === true ? { customKinds: true } : undefined,
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
    settings: { storageMode: 'native-records', ...(options.settings || {}) },
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
        on(name, callback) {
          const listeners = workspaceEvents.get(name) || [];
          listeners.push(callback);
          workspaceEvents.set(name, listeners);
          return {};
        },
        layoutReady: options.layoutReady ?? true,
        onLayoutReady(callback) {
          if (this.layoutReady) callback();
          else layoutReadyCallbacks.push(callback);
        },
      },
      vault: {
        getMarkdownFiles: () => [...files.values()],
        cachedRead: async (file) => {
          cachedReadCalls.push(file.path);
          return contents.get(file.path) || '';
        },
        read: async (file) => {
          readCalls.push(file.path);
          return contents.get(file.path) || '';
        },
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
  if (!options.deferSetup) service.setup();
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
  const finishLayout = () => {
    plugin.app.workspace.layoutReady = true;
    for (const callback of layoutReadyCallbacks.splice(0)) callback();
  };
  const emitWorkspace = (name, ...args) => {
    for (const listener of workspaceEvents.get(name) || []) listener(...args);
  };
  return { service, api, plugin, files, frontmatters, contents, createCalls, updateCalls, readCalls, cachedReadCalls, trashedPaths, exerciseDefinitions, addLegacyFile, addFrontmatterFile, emitVault, emitMetadata, emitWorkspace, finishLayout };
}

const providerEvent = available => ({ source: 'tps-global-context-menu', available });
function addProviderFood(h, path = 'Inbox/provider-food.md') {
  return h.addFrontmatterFile(path, {
    tpsId: 'provider-food', tpsSchemaVersion: 1, kind: 'food-entry',
    title: 'Synthetic food', completedDate: '2026-09-29T12:00:00.000Z', calories: 210,
  });
}

test('GCM v2 native kind writer settings gate new food records before a write', async () => {
  const h = createHarness();
  let enabled = false;
  h.plugin.getGcmApi = () => ({ frontmatterKinds: {
    version: 2,
    definition: kind => kind === 'food-entry' ? { kindList: { key: 'kind', value: 'transaction/food' } } : null,
    writerEnabled: () => enabled,
    snapshot: () => ({ 'food-entry': { writerEnabled: enabled } }),
  } });
  const entry = {
    id: 'configured-kind-food', createdDate: '2026-09-29T12:00:00.000Z', completedDate: '2026-09-29T12:00:00.000Z',
    item: { id: 'configured-kind-food', name: 'Lunch', source: 'manual' }, quantity: 1, unit: 'serving',
    nutritionOverride: { calories: 210 },
  };
  await assert.rejects(h.service.createFoodEntry(entry), /Configure and enable the food-entry kind writer/);
  assert.equal(h.createCalls.length, 0);
  enabled = true;
  await h.service.createFoodEntry(entry);
  assert.equal(h.createCalls.length, 1);
  assert.equal(h.createCalls[0].kind, 'food-entry', 'GCM receives the configured internal kind identifier');
  assert.deepEqual(h.createCalls[0].properties.tags || [], [], 'Health adds no classification tags');
  h.service.dispose();
});

test('daily index signals an empty day only after provider and metadata are ready', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: false });
  let available = false;
  h.plugin.getGcmNativeRecordsApi = () => available ? h.api : null;
  h.service.setup();
  const statuses = [];
  h.service.onDailyIndexStatusChanged(() => statuses.push(h.service.getDailyIndexStatus()));
  assert.equal(h.service.getDailyIndexStatus(), 'loading');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0);
  available = true;
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.getDailyIndexStatus(), 'loading', 'provider alone does not prove cache readiness');
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyIndexStatus(), 'ready');
  assert.deepEqual(statuses, ['ready'], 'an empty day still wakes its mounted block');
  h.emitMetadata('resolved');
  assert.deepEqual(statuses, ['ready'], 'repeat resolution does not cause redundant renders');
  h.plugin.getGcmNativeRecordsApi = () => ({ ...h.api });
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.deepEqual(statuses, ['ready'], 'a ready-to-ready provider refresh does not rerender an empty day');
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('known food stays visible while 256 unrelated metadata paths remain unavailable', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  const food = addProviderFood(h);
  for (let index = 0; index < 256; index++) h.addLegacyFile(`Inbox/pending-${index}.md`, 'Ordinary note.');
  const getCache = h.plugin.app.metadataCache.getFileCache;
  let scans = 0;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return getMarkdownFiles(); };
  h.plugin.app.metadataCache.getFileCache = file => file === food ? getCache(file) : null;
  h.service.setup();
  assert.equal(h.service.getDailyIndexStatus(), 'partial');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  const statuses = [];
  h.service.onDailyIndexStatusChanged(() => statuses.push(h.service.getDailyIndexStatus()));
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(h.service.getDailyIndexStatus(), 'partial');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.equal(scans, 1, 'repeated resolution checks pending files without another vault scan');
  assert.deepEqual(statuses, [], 'unchanged partial readiness does not rerender the block');
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('staggered metadata readiness indexes pending food without repeated vault scans', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  const food = addProviderFood(h);
  let cacheReady = false, scans = 0, cacheInspections = 0;
  h.plugin.app.metadataCache.getFileCache = file => {
    cacheInspections += 1;
    return cacheReady ? { frontmatter: h.frontmatters.get(file) } : null;
  };
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 0);
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1, 'unresolved metadata bursts inspect only pending paths');
  assert.equal(changes.length, 0);
  cacheReady = true;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.deepEqual(h.service.getDailyFoodEntries('2026-09-29').map(entry => entry.id), ['provider-food']);
  assert.equal(changes.length, 1, 'the newly accepted food wakes the day consumer once');
  assert.deepEqual(changes[0].dates, ['2026-09-29']);
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.equal(cacheInspections, 52, 'resolved events stop inspecting once the pending cache is accepted');
  assert.equal(changes.length, 1);

  h.contents.set(food.path, 'Food body without frontmatter.');
  h.frontmatters.delete(food);
  h.emitMetadata('changed', food, h.contents.get(food.path), {});
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0, 'a current indexed source still removes a real record');
  assert.equal(changes.length, 2);
  assert.equal(scans, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  assert.deepEqual(h.createCalls, []);
  h.service.dispose();
});

test('provider rebuild preserves accepted food while its metadata cache is unknown', () => {
  const h = createHarness({ deferSetup: true });
  const food = addProviderFood(h);
  let scans = 0;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  h.plugin.app.metadataCache.getFileCache = () => null;
  h.plugin.getGcmNativeRecordsApi = () => ({ ...h.api });
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.equal(changes.length, 0, 'unknown cache is not deletion evidence');
  assert.equal(scans, 2);
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 2, 'pending resolution stays scoped to the food path');
  assert.equal(changes.length, 0);

  h.frontmatters.set(food, { ...h.frontmatters.get(food), calories: 320 });
  h.plugin.app.metadataCache.getFileCache = file => ({ frontmatter: h.frontmatters.get(file) });
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 320);
  assert.equal(changes.length, 1);
  assert.equal(scans, 2);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  assert.deepEqual(h.createCalls, []);
  h.service.dispose();
});

test('a same-path file replacement remains pending until its new cache can be indexed', () => {
  const h = createHarness({ deferSetup: true });
  const food = addProviderFood(h);
  h.service.setup();
  let scans = 0;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  let cacheReady = false;
  h.plugin.app.metadataCache.getFileCache = file => cacheReady ? { frontmatter: h.frontmatters.get(file) } : null;
  h.plugin.getGcmNativeRecordsApi = () => ({ ...h.api });
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  const replacement = { ...food };
  h.files.set(food.path, replacement);
  h.frontmatters.set(replacement, { ...h.frontmatters.get(food) });
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210,
    'a new file object at the same path is not deletion evidence');
  assert.equal(changes.length, 0);
  cacheReady = true;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.equal(h.service.recordsByPath.get(food.path).file, replacement);
  assert.equal(scans, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('a late metadata event for a replaced file cannot consume its pending path', () => {
  const h = createHarness({ deferSetup: true });
  const food = addProviderFood(h);
  const originalPath = food.path;
  h.service.setup();
  let cacheReady = false;
  h.plugin.app.metadataCache.getFileCache = file => cacheReady ? { frontmatter: h.frontmatters.get(file) } : null;
  h.plugin.getGcmNativeRecordsApi = () => ({ ...h.api });
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  const replacement = { ...food };
  h.files.set(food.path, replacement);
  h.frontmatters.set(replacement, { ...h.frontmatters.get(food), calories: 320 });
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  h.emitMetadata('changed', food, h.contents.get(food.path), { frontmatter: h.frontmatters.get(food) });
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.equal(changes.length, 0, 'the stale event is not an accepted source update');
  h.emitVault('delete', food);
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210,
    'a queued delete for the obsolete object cannot remove its replacement');
  assert.equal(changes.length, 0);
  food.path = 'Inbox/obsolete-move.md';
  h.emitVault('rename', food, originalPath);
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210,
    'a queued rename for the obsolete object cannot move its replacement');
  assert.equal(changes.length, 0);
  cacheReady = true;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 320);
  assert.equal(h.service.recordsByPath.get(originalPath).file, replacement);
  assert.equal(changes.length, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('unresolved metadata bursts inspect pending caches without repeated vault scans or writes', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  for (let index = 0; index < 256; index++) h.addLegacyFile(`Inbox/pending-${index}.md`, 'Ordinary note.');
  let scans = 0, cacheInspections = 0;
  h.plugin.app.metadataCache.getFileCache = () => { cacheInspections += 1; return null; };
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.equal(cacheInspections, 256 * 51, 'each unresolved event inspects only the 256 known pending paths');
  assert.deepEqual(changes, []);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  assert.deepEqual(h.createCalls, []);
  h.service.dispose();
});

test('a provider rebuild drops a linked-food definition only when current cached frontmatter is absent', () => {
  const h = createHarness({ deferSetup: true });
  const definition = h.addFrontmatterFile('Inbox/definition.md', {
    kind: 'food', servingAmount: 1, servingUnit: 'serving', calories: 100, proteinG: 10, carbsG: 0, fatG: 0,
  });
  h.addFrontmatterFile('Inbox/linked-entry.md', {
    tpsId: 'linked-entry', tpsSchemaVersion: 1, kind: 'food-entry', title: 'Linked food',
    food: '[[Inbox/definition]]', quantity: 1, unit: 'serving',
    completedDate: '2026-09-29T12:00:00.000Z', calories: 100, proteinG: 10, carbsG: 0, fatG: 0,
  });
  h.service.setup();
  assert.equal(h.service.foodDefinitionsByPath.has(definition.path), true);
  h.frontmatters.delete(definition);
  h.contents.set(definition.path, 'The food definition frontmatter was removed.');
  h.plugin.getGcmNativeRecordsApi = () => ({ ...h.api });
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.foodDefinitionsByPath.has(definition.path), false);
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 100,
    'the logged nutrition snapshot remains until its own current source changes');
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('pending metadata follows a rename and a real vault deletion without a new scan', () => {
  const h = createHarness({ deferSetup: true });
  const food = addProviderFood(h);
  let cacheReady = false, scans = 0;
  h.plugin.app.metadataCache.getFileCache = file => cacheReady
    ? { frontmatter: h.frontmatters.get(file) } : null;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  const oldPath = food.path;
  h.files.delete(oldPath);
  food.path = 'Inbox/renamed-food.md';
  h.files.set(food.path, food);
  h.emitVault('rename', food, oldPath);
  cacheReady = true;
  h.emitMetadata('resolved');
  assert.deepEqual(h.service.getDailyFoodEntries('2026-09-29').map(entry => entry.path), [food.path]);
  assert.equal(scans, 1);

  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  h.files.delete(food.path);
  h.emitVault('delete', food);
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0);
  assert.equal(changes.length, 1);
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('metadata changes use their saved source when cached frontmatter is absent', async () => {
  const h = createHarness();
  const food = await h.service.createFoodEntry({
    id: 'changed-food', createdDate: '2026-09-29T12:00:00.000Z', completedDate: '2026-09-29T12:00:00.000Z',
    item: { id: 'changed-food', name: 'Lunch', source: 'manual' }, quantity: 1, unit: 'serving',
    nutritionOverride: { calories: 210, proteinG: 12 },
  });
  const activity = await h.service.createActivityEntry({
    id: 'changed-activity', activity: 'Walk', activityType: 'walking',
    startedAt: '2026-09-29T13:00:00.000Z', completedDate: '2026-09-29T13:30:00.000Z',
    durationMinutes: 30, source: 'manual',
  });
  let scans = 0;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  const reads = h.readCalls.length;
  const cachedReads = h.cachedReadCalls.length;
  const updates = h.updateCalls.length;
  const creates = h.createCalls.length;
  const displayed = [];
  h.service.onRecordsChanged(() => displayed.push({
    calories: h.service.getDailyFoodTotals('2026-09-29').calories,
    activityMinutes: h.service.getDailyActivityTotals('2026-09-29').durationMinutes,
  }));

  for (const record of [food, activity]) {
    h.emitMetadata('changed', record.file, h.contents.get(record.path), {});
  }
  assert.deepEqual(displayed, [
    { calories: 210, activityMinutes: 30 },
    { calories: 210, activityMinutes: 30 },
  ], 'subscribed Daily Note widgets must never observe an empty index after saved changes');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.deepEqual(h.service.getDailyFoodEntries('2026-09-29').map(entry => entry.id), ['changed-food']);
  assert.equal(h.service.getDailyActivityTotals('2026-09-29').durationMinutes, 30);
  assert.deepEqual(h.service.getDailyActivityEntries('2026-09-29').map(entry => entry.id), ['changed-activity']);

  h.contents.set(food.path, 'Food body without frontmatter.');
  h.frontmatters.delete(food.file);
  h.emitMetadata('changed', food.file, h.contents.get(food.path), {});
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0,
    'removing the saved frontmatter must remove the indexed food');
  assert.equal(h.service.getDailyActivityTotals('2026-09-29').entryCount, 1);

  assert.equal(scans, 0, 'a scoped metadata change must not scan the vault');
  assert.equal(h.readCalls.length, reads);
  assert.equal(h.cachedReadCalls.length, cachedReads);
  assert.equal(h.updateCalls.length, updates);
  assert.equal(h.createCalls.length, creates);
  h.service.dispose();
});

test('an initialized MetadataCache reconciles food missed by an incomplete startup scan', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  const food = h.addFrontmatterFile('Inbox/food-sept-30.md', {
    tpsId: 'food-sept-30', title: 'Lunch', tags: ['kind/food/transaction'],
    completedDate: '2026-09-30T13:00:00.000Z', calories: 420,
  });
  const inspect = h.api.inspect;
  h.api.inspect = (frontmatter) => frontmatter?.tags?.includes('kind/food/transaction')
    ? { id: frontmatter.tpsId, kind: 'food-entry', schemaVersion: 1,
        frontmatter: { ...frontmatter, tpsSchemaVersion: 1, kind: 'food-entry' } }
    : inspect(frontmatter);
  let cacheReady = false;
  let cacheInspections = 0;
  h.plugin.app.metadataCache.getFileCache = () => {
    cacheInspections += 1;
    return cacheReady ? { frontmatter: h.frontmatters.get(food) } : null;
  };
  let scans = 0;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  assert.equal(h.service.getDailyFoodTotals('2026-09-30').entryCount, 0);
  assert.equal(h.service.isWorkoutIndexSettled(), true,
    'uncached ordinary notes must not block workout controls');
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  cacheReady = true;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-30').entryCount, 1);
  assert.equal(h.service.getDailyFoodTotals('2026-09-30').calories, 420);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(scans, 1, 'the pending path resolves without another vault scan');
  assert.equal(cacheInspections, 2, 'the pending file cache is inspected once per resolution');
  assert.ok(changes.some(change => change.kinds.includes('food-entry') && change.dates.includes('2026-09-30')),
    'the recovered food record notifies the dashboard');
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1, 'settled metadata bursts keep the index warm');
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('startup metadata reconciliation restores saved activity and food together', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  addProviderFood(h);
  h.addFrontmatterFile('Inbox/provider-activity.md', {
    tpsId: 'provider-activity', tpsSchemaVersion: 1, kind: 'activity-entry',
    title: 'Synthetic walk', completedDate: '2026-09-29T13:30:00.000Z', durationMinutes: 30,
  });
  let cacheReady = false;
  let scans = 0;
  h.plugin.app.metadataCache.getFileCache = file => cacheReady
    ? { frontmatter: h.frontmatters.get(file) } : null;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0);
  assert.equal(h.service.getDailyActivityTotals('2026-09-29').entryCount, 0);

  cacheReady = true;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.equal(h.service.getDailyActivityTotals('2026-09-29').entryCount, 1);
  assert.equal(h.service.getDailyActivityTotals('2026-09-29').durationMinutes, 30);
  assert.equal(scans, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('partially cached startup food is retained while resolved adds missing records once', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  const first = h.addFrontmatterFile('Inbox/first-food.md', {
    tpsId: 'first-food', title: 'First', tags: ['kind/food/transaction'],
    completedDate: '2026-09-30T12:00:00.000Z', calories: 100,
  });
  const second = h.addFrontmatterFile('Inbox/second-food.md', {
    tpsId: 'second-food', title: 'Second', tags: ['kind/food/transaction'],
    completedDate: '2026-09-30T13:00:00.000Z', calories: 200,
  });
  const inspect = h.api.inspect;
  h.api.inspect = (frontmatter) => frontmatter?.tags?.includes('kind/food/transaction')
    ? { id: frontmatter.tpsId, kind: 'food-entry', schemaVersion: 1,
        frontmatter: { ...frontmatter, tpsSchemaVersion: 1, kind: 'food-entry' } }
    : inspect(frontmatter);
  let secondCacheReady = false;
  h.plugin.app.metadataCache.getFileCache = (file) => file === first || secondCacheReady
    ? { frontmatter: h.frontmatters.get(file) }
    : null;
  let scans = 0;
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  assert.equal(h.service.getDailyFoodTotals('2026-09-30').entryCount, 1);
  secondCacheReady = true;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2026-09-30').entryCount, 2);
  assert.equal(h.service.getDailyFoodTotals('2026-09-30').calories, 300);
  for (let index = 0; index < 50; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('late GCM readiness populates a settled empty Health index and notifies day consumers once', () => {
  const h = createHarness({ deferSetup: true });
  addProviderFood(h);
  let ready = false, scans = 0;
  h.plugin.getGcmNativeRecordsApi = () => ready ? h.api : null;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
  h.service.setup();
  assert.equal(h.service.isWorkoutIndexSettled(), false, 'metadata alone is not record readiness');
  assert.equal(scans, 0, 'do not scan while classification is unavailable');
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  ready = true;
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
  assert.equal(h.service.getDailyFoodEntries('2026-09-29').length, 1);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(scans, 1);
  assert.ok(changes.some(c => c.dates.includes('2026-09-29') && c.kinds.includes('food-entry')));
  const notifications = changes.length;
  for (let i = 0; i < 100; i++) {
    h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
    h.emitMetadata('resolved');
    h.emitWorkspace('file-open');
  }
  assert.equal(scans, 1);
  assert.equal(changes.length, notifications);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('provider reload reconciles edits and removals from cached metadata without replaying old reads', () => {
  const h = createHarness({ deferSetup: true });
  const food = addProviderFood(h);
  const removed = h.addFrontmatterFile('Inbox/removed-food.md', {
    tpsId: 'removed-food', tpsSchemaVersion: 1, kind: 'food-entry',
    title: 'Removed synthetic food', completedDate: '2026-09-28T12:00:00.000Z', calories: 120,
  });
  h.service.setup();
  const changes = [];
  h.service.onRecordsChanged(c => changes.push(c));
  h.plugin.getGcmNativeRecordsApi = () => null;
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(false));
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  const changed = { ...h.frontmatters.get(food), calories: 320 };
  h.frontmatters.set(food, changed);
  h.emitMetadata('changed', food, '', { frontmatter: changed });
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210, 'provider absence is not deletion evidence');
  h.files.delete(removed.path);
  const replacement = { ...h.api };
  h.plugin.getGcmNativeRecordsApi = () => replacement;
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 320);
  assert.equal(h.service.getDailyFoodTotals('2026-09-28').entryCount, 0);
  assert.ok(changes.some(c => c.dates.includes('2026-09-28')), 'removed-day consumers must redraw');
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('provider configuration changes rebuild classification but unchanged announcements and disposal do not', () => {
  const h = createHarness({ deferSetup: true });
  addProviderFood(h);
  let binding = 'kind', scans = 0;
  h.api.getStorageProfile = () => ({ kindPropertyKey: binding });
  h.api.getKindPropertyKeys = () => ({});
  const inspect = h.api.inspect;
  h.api.inspect = fm => binding === 'kind' ? inspect(fm) : null;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
  h.service.setup();
  const changes = [];
  h.service.onRecordsChanged(c => changes.push(c));
  binding = 'category';
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0);
  assert.ok(changes.some(c => c.dates.includes('2026-09-29')));
  assert.equal(scans, 2);
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  h.service.dispose();
  binding = 'kind';
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(scans, 2);
});

for (const order of [['provider', 'metadata', 'layout'], ['metadata', 'layout', 'provider'], ['layout', 'provider', 'metadata']]) {
  test(`cold Health startup settles across provider/metadata/layout ordering: ${order.join(', ')}`, () => {
    const h = createHarness({ deferSetup: true, layoutReady: false, metadataInitialized: false });
    const food = addProviderFood(h);
    let providerReady = false, metadataReady = false;
    h.plugin.getGcmNativeRecordsApi = () => providerReady ? h.api : null;
    h.plugin.app.metadataCache.getFileCache = file => metadataReady
      ? { frontmatter: h.frontmatters.get(file) } : null;
    h.service.setup();
    assert.equal(h.service.isWorkoutIndexSettled(), false);
    for (const step of order) {
      if (step === 'provider') {
        providerReady = true;
        h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
      } else if (step === 'metadata') {
        metadataReady = true;
        h.emitMetadata('changed', food, '', { frontmatter: h.frontmatters.get(food) });
        h.emitMetadata('resolved');
      } else h.finishLayout();
      assert.equal(h.service.isWorkoutIndexSettled(), providerReady && metadataReady);
    }
    assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 210);
    assert.deepEqual(h.readCalls, []);
    assert.deepEqual(h.cachedReadCalls, []);
    assert.deepEqual(h.updateCalls, []);
    h.service.dispose();
  });
}

test('a read started before provider replacement cannot overwrite its newer metadata index', async () => {
  const h = createHarness({ deferSetup: true });
  const food = addProviderFood(h);
  h.service.setup();
  const older = h.contents.get(food.path);
  let release;
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => { release = resolve; });
  h.emitVault('modify', food);
  const replacement = { ...h.api };
  h.frontmatters.set(food, { ...h.frontmatters.get(food), calories: 320 });
  h.plugin.getGcmNativeRecordsApi = () => replacement;
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  release(older);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 320);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('per-kind classification tags are part of the provider configuration fingerprint', () => {
  const h = createHarness({ deferSetup: true });
  addProviderFood(h);
  let tag = 'kind/food/transaction', scans = 0;
  h.api.getStorageProfile = kind => kind === 'food-entry'
    ? { classification: { recordKind: kind, tag } } : {};
  h.api.getKindPropertyKeys = () => ({}); // Tag classifications are not property keys.
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
  h.service.setup();
  tag = 'kind/food/log';
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(scans, 2);
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(scans, 2);
  h.service.dispose();
});

test('late provider startup before layout queues legacy workout hydration only once', async () => {
  for (const metadataInitialized of [false, true]) {
    const h = createHarness({ deferSetup: true, layoutReady: false, metadataInitialized });
    const workout = h.addFrontmatterFile('Inbox/provider-workout.md', {
      tpsId: 'provider-workout', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Synthetic workout',
    });
    h.plugin.getGcmNativeRecordsApi = () => null;
    h.service.setup();
    h.plugin.getGcmNativeRecordsApi = () => h.api;
    h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
    h.emitMetadata('resolved');
    h.finishLayout();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(h.cachedReadCalls, [workout.path]);
    assert.deepEqual(h.readCalls, []);
    h.service.dispose();
  }
});

test('ordinary note create, edit and rename bursts do not read sources or unsettle workouts', async () => {
  const h = createHarness();
  const workout = await h.service.createWorkoutSession({ title: 'Active workout' }, 'ordinary-burst');
  let scans = 0;
  let writes = 0;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
  h.plugin.app.vault.process = async () => { writes++; };
  h.plugin.app.fileManager.processFrontMatter = async () => { writes++; };
  h.readCalls.length = h.cachedReadCalls.length = 0;
  const notifications = [];
  h.service.onRecordsChanged(change => notifications.push(change));
  for (let index = 0; index < 128; index++) {
    const file = h.addLegacyFile(`Inbox/ordinary-${index}.md`, 'Body');
    h.emitVault('create', file);
    h.emitVault('modify', file);
    assert.equal(h.service.isWorkoutIndexSettled(), true, 'unrelated edits cannot block workout controls');
    h.emitMetadata('changed', file, 'Body', {});
    const oldPath = file.path;
    h.files.delete(oldPath);
    file.path = `Inbox/renamed-${index}.md`;
    h.files.set(file.path, file);
    h.emitVault('rename', file, oldPath);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.equal(scans, 0);
  assert.equal(writes, 0);
  assert.deepEqual(notifications, []);
  assert.equal(h.service.resolveWorkoutSession({ id: workout.id }).state, 'active');
  h.service.dispose();
});

test('external Health discovery and workout body edits use the indexed event source without another read', async () => {
  const h = createHarness();
  const file = h.addLegacyFile('Inbox/external.md', 'Ordinary note');
  h.emitVault('create', file);
  await Promise.resolve();
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  const fm = { tpsId: 'external-workout', tpsSchemaVersion: 1, kind: 'workout-session', title: 'External', status: 'active' };
  const body = reps => writeWorkoutDataToNoteContent('---\ntpsId: external-workout\n---\n', JSON.stringify({
    version: 1, exercises: [{ id: 'press', name: 'Press', sets: [{ id: 'set', reps }] }],
  }));
  // The event's cache/source are current even when getFileCache still returns the old note.
  h.emitMetadata('changed', file, body(5), { frontmatter: fm });
  assert.equal(h.service.getWorkoutSnapshot(file.path).exercises[0].sets[0].reps, 5);
  h.emitMetadata('changed', file, body(9), { frontmatter: fm });
  assert.equal(h.service.getWorkoutSnapshot(file.path).exercises[0].sets[0].reps, 9);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  h.service.dispose();
});

test('missing or malformed indexed frontmatter clears old Health identity instead of consulting stale cache', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Remove identity' }, 'remove-identity');
  assert.ok(h.frontmatters.get(record.file), 'retain a deliberately stale getFileCache value');
  h.emitMetadata('changed', record.file, '---\nkind: [invalid\n---\nBody', {});
  assert.equal(h.service.getWorkoutSnapshot(record.path), null);
  assert.equal(h.service.recordsByPath.has(record.path), false);
  assert.equal(h.service.workoutDataByPath.has(record.path), false);
  assert.deepEqual(h.readCalls, []);
  h.service.dispose();
});

test('known workout edits preserve the pending guard and newest source when reads finish out of order', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Concurrent' }, 'concurrent');
  const original = h.contents.get(record.path);
  const releases = [];
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => releases.push(resolve));
  h.emitVault('modify', record.file);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  h.emitVault('modify', record.file);
  releases[1](original.replace('title: Concurrent', 'title: Latest'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(h.service.getWorkoutSnapshot(record.path).title, 'Latest');
  releases[0](original);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getWorkoutSnapshot(record.path).title, 'Latest');
  assert.deepEqual(h.readCalls, []);
  h.service.dispose();
});

test('newer indexed source wins over an older pending Health cached read', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Before event' }, 'metadata-wins');
  const older = h.contents.get(record.path);
  let release;
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => { release = resolve; });
  h.emitVault('modify', record.file);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  const newerFm = { ...record.frontmatter, title: 'After event' };
  delete newerFm.session;
  const newer = writeWorkoutDataToNoteContent(older.replace('title: Before event', 'title: After event'), JSON.stringify({
    version: 1, exercises: [{ id: 'press', name: 'Press', sets: [{ id: 'set', reps: 12 }] }],
  }));
  const settledStates = [];
  h.plugin.scheduleWorkoutActionBars = () => settledStates.push(h.service.isWorkoutIndexSettled());
  h.emitMetadata('changed', record.file, newer, { frontmatter: newerFm });
  assert.equal(h.service.getWorkoutSnapshot(record.path).title, 'After event');
  assert.equal(h.service.getWorkoutSnapshot(record.path).exercises[0].sets[0].reps, 12);
  release(older);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getWorkoutSnapshot(record.path).title, 'After event');
  assert.equal(h.service.getWorkoutSnapshot(record.path).exercises[0].sets[0].reps, 12);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(settledStates.at(-1), true, 'metadata ownership must wake the controls once its source is indexed');
  h.service.dispose();
});

test('an invalidated read cannot reuse a later refresh token or release its pending guard', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Before event' }, 'metadata-aba');
  const original = h.contents.get(record.path);
  const releases = [];
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => releases.push(resolve));
  h.emitVault('modify', record.file);
  h.emitMetadata('changed', record.file, original.replace('title: Before event', 'title: Indexed'), {
    frontmatter: { ...record.frontmatter, title: 'Indexed' },
  });
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  h.emitVault('modify', record.file);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  releases[0](original);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getWorkoutSnapshot(record.path).title, 'Indexed');
  assert.equal(h.service.isWorkoutIndexSettled(), false, 'the old read cannot release the later read guard');
  releases[1](original.replace('title: Before event', 'title: Latest'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getWorkoutSnapshot(record.path).title, 'Latest');
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  h.service.dispose();
});

test('a newly arrived saved active-workout path remains guarded before metadata discovery', async () => {
  const path = 'Inbox/synced-active-workout.md';
  const h = createHarness({ settings: { activeWorkoutPath: path } });
  const file = h.addLegacyFile(path, [
    '---', 'tpsId: synced-active', 'tpsSchemaVersion: 1', 'kind: workout-session',
    'title: Synced active', 'status: active', '---',
  ].join('\n'));
  let release;
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => { release = resolve; });
  h.emitVault('create', file);
  assert.equal(h.service.isWorkoutIndexSettled(), false, 'Finish must not treat the saved pointer as missing before its source arrives');
  release(h.contents.get(path));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(h.service.resolveWorkoutSession({ id: 'synced-active', path }).state, 'active');
  assert.deepEqual(h.readCalls, []);
  h.service.dispose();
});

test('known workout rename updates the index without depending on a metadata changed event', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Rename me' }, 'rename-known');
  const oldPath = record.path;
  const nextPath = 'Inbox/renamed-workout.md';
  h.files.delete(oldPath);
  h.files.set(nextPath, record.file);
  h.contents.set(nextPath, h.contents.get(oldPath));
  h.contents.delete(oldPath);
  record.file.path = nextPath;
  h.emitVault('rename', record.file, oldPath);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.recordsByPath.has(oldPath), false);
  assert.equal(h.service.getWorkoutSnapshot(nextPath).id, record.id);
  assert.deepEqual(h.cachedReadCalls, [nextPath]);
  assert.deepEqual(h.readCalls, []);
  h.service.dispose();
});

test('rename during a Health read clears its old path token without releasing the new path guard', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Rename pending' }, 'rename-pending');
  const oldPath = record.path;
  const nextPath = 'Inbox/renamed-pending.md';
  const content = h.contents.get(oldPath);
  const releases = [];
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => releases.push(resolve));
  h.emitVault('modify', record.file);
  h.files.delete(oldPath);
  h.files.set(nextPath, record.file);
  h.contents.set(nextPath, content);
  h.contents.delete(oldPath);
  record.file.path = nextPath;
  h.emitVault('rename', record.file, oldPath);
  releases[0](content);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.refreshGenerations.has(oldPath), false);
  assert.equal(h.service.isWorkoutIndexSettled(), false, 'the new path refresh retains its own guard');
  releases[1](content);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(h.service.getWorkoutSnapshot(nextPath).id, record.id);
  h.service.dispose();
});

test('deleting a Health source cancels its pending guard and late data cannot restore the record', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Delete pending' }, 'delete-pending');
  const content = h.contents.get(record.path);
  let release;
  h.plugin.app.vault.cachedRead = () => new Promise(resolve => { release = resolve; });
  h.emitVault('modify', record.file);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  await h.plugin.app.vault.trash(record.file);
  assert.equal(h.service.isWorkoutIndexSettled(), true, 'a deleted file cannot keep controls waiting for its irrelevant read');
  assert.equal(h.service.getWorkoutSnapshot(record.path), null);
  release(content);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getWorkoutSnapshot(record.path), null);
  assert.equal(h.service.refreshGenerations.size, 0);
  h.service.dispose();
});

test('known source losing valid YAML or Health classification evicts its stale identity', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Malformed' }, 'malformed-known');
  h.contents.set(record.path, '---\ntpsId: malformed-known\ntpsSchemaVersion: 1\nkind: [invalid\n---\nBody');
  h.emitVault('modify', record.file);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getWorkoutSnapshot(record.path), null);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  h.emitMetadata('changed', record.file, '', { frontmatter: record.frontmatter });
  assert.ok(h.service.getWorkoutSnapshot(record.path));
  h.emitMetadata('changed', record.file, '---\nkind: note\n---\nBody', { frontmatter: { kind: 'note' } });
  assert.equal(h.service.getWorkoutSnapshot(record.path), null);
  assert.equal(h.service.workoutDataByPath.has(record.path), false);
  assert.deepEqual(h.readCalls, []);
  h.service.dispose();
});

test('startup discovery does not queue a body read for every Markdown file in either storage mode', async () => {
  for (const storageMode of ['legacy', 'native-records']) {
    const harness = createHarness({ layoutReady: false, metadataInitialized: false, settings: { storageMode } });
    for (let index = 0; index < 2048; index++) {
      const file = harness.addLegacyFile(`Inbox/discovered-${index}.md`, 'Unrelated note.');
      harness.emitVault('create', file);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(harness.readCalls, [], `${storageMode}: startup discovery must leave the adapter queue available to workspace restoration`);
    harness.finishLayout();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(harness.readCalls, [], 'layout readiness must not replay a whole-vault body scan');
    harness.service.dispose();
  }
});

test('startup metadata restores food records and hydrates legacy workout bodies after layout readiness', async () => {
  const harness = createHarness({ layoutReady: false, metadataInitialized: false });
  const food = harness.addFrontmatterFile('Inbox/startup-food.md', {
    tpsId: 'startup-food', tpsSchemaVersion: 1, kind: 'food-entry', date: '2026-09-08', calories: 210,
  });
  const workout = harness.addFrontmatterFile('Inbox/startup-workout.md', {
    tpsId: 'startup-workout', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Startup workout', status: 'active',
  });
  harness.contents.set(workout.path, writeWorkoutDataToNoteContent(harness.contents.get(workout.path), JSON.stringify({
    version: 1, exercises: [{ id: 'legacy-exercise', name: 'Bench press', sets: [{ id: 'legacy-set', reps: 8 }] }],
  })));
  for (const file of [food, workout]) {
    harness.emitVault('create', file);
    harness.emitMetadata('changed', file, harness.contents.get(file.path), { frontmatter: harness.frontmatters.get(file) });
  }
  harness.plugin.app.metadataCache.initialized = true;
  harness.emitMetadata('resolved');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.readCalls, [], 'metadata indexing must not hydrate bodies before workspace restoration');
  assert.equal(harness.service.getDailyFoodTotals('2026-09-08').calories, 210);

  harness.finishLayout();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.readCalls, [], 'read-only startup hydration must not use raw reads');
  assert.deepEqual(harness.cachedReadCalls, [workout.path], 'only a recognized workout needs legacy body hydration');
  assert.equal(harness.service.getWorkoutSnapshot('startup-workout').exercises[0].sets[0].reps, 8);
  assert.equal(harness.service.getDailyFoodTotals('2026-09-08').calories, 210);
  harness.service.dispose();
});

test('startup reads only legacy workout bodies while modern sessions stay current from metadata', async () => {
  const h = createHarness({ deferSetup: true, layoutReady: false, metadataInitialized: false });
  const modern = [];
  for (let index = 0; index < 128; index += 1) {
    modern.push(h.addFrontmatterFile(`Inbox/modern-workout-${index}.md`, {
      tpsId: `modern-workout-${index}`, tpsSchemaVersion: 1, kind: 'workout-session',
      title: `Modern workout ${index}`, status: 'complete',
      session: workoutSessionPropertyValue([{
        id: `exercise-${index}`, name: 'Squat', sets: [{ id: `set-${index}`, reps: 5 }],
      }]),
    }));
  }
  const legacy = h.addFrontmatterFile('Inbox/legacy-workout.md', {
    tpsId: 'legacy-workout', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Legacy workout',
  });
  h.contents.set(legacy.path, writeWorkoutDataToNoteContent(h.contents.get(legacy.path), JSON.stringify({
    version: 1, exercises: [{ id: 'legacy-exercise', name: 'Row', sets: [{ id: 'legacy-set', reps: 8 }] }],
  })));

  let writes = 0;
  h.plugin.app.vault.process = async () => { writes += 1; };
  h.plugin.app.fileManager.processFrontMatter = async () => { writes += 1; };
  h.service.setup();
  h.plugin.app.metadataCache.initialized = true;
  h.emitMetadata('resolved');
  assert.deepEqual(h.cachedReadCalls, [], 'workout body reads wait until layout is ready');
  h.finishLayout();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.readCalls, [], 'startup does not request authoritative disk reads');
  assert.equal(h.cachedReadCalls.length, 1, 'modern nested sessions need no source reads');
  assert.deepEqual(h.cachedReadCalls, [legacy.path]);
  assert.equal(writes, 0);
  assert.deepEqual(h.updateCalls, []);
  assert.equal(h.service.getWorkoutSnapshot(modern[42].path).exercises[0].sets[0].reps, 5);
  assert.equal(h.service.getWorkoutSnapshot(legacy.path).exercises[0].sets[0].reps, 8);

  const updated = {
    ...h.frontmatters.get(modern[42]),
    session: workoutSessionPropertyValue([{
      id: 'exercise-42', name: 'Squat', sets: [{ id: 'set-42', reps: 9 }],
    }]),
  };
  h.frontmatters.set(modern[42], updated);
  h.emitMetadata('changed', modern[42], undefined, { frontmatter: updated });
  assert.equal(h.service.getWorkoutSnapshot(modern[42].path).exercises[0].sets[0].reps, 9,
    'a later metadata edit replaces the modern session without a body read');
  for (let index = 0; index < 20; index += 1) h.emitMetadata('resolved');
  assert.deepEqual(h.cachedReadCalls, [legacy.path]);
  assert.deepEqual(h.readCalls, []);
  assert.equal(writes, 0);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('an externally created Health record is discovered by its metadata event without a competing source read', async () => {
  const harness = createHarness({ layoutReady: false });
  harness.finishLayout();
  const file = harness.addLegacyFile('Inbox/new-food.md', [
    '---', 'tpsId: new-food', 'tpsSchemaVersion: 1', 'kind: food-entry',
    'date: 2026-09-08', 'calories: 320', '---',
  ].join('\n'));
  harness.emitVault('create', file);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.readCalls, []);
  assert.deepEqual(harness.cachedReadCalls, []);
  assert.equal(harness.service.getDailyFoodTotals('2026-09-08').calories, 0);
  harness.emitMetadata('changed', file, harness.contents.get(file.path), { frontmatter: {
    tpsId: 'new-food', tpsSchemaVersion: 1, kind: 'food-entry', date: '2026-09-08', calories: 320,
  } });
  assert.equal(harness.service.getDailyFoodTotals('2026-09-08').calories, 320);
  harness.service.dispose();
});

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
    tags: ['#food/healthy', 'food/healthy', '#meal/breakfast'],
    id: 'food-one', createdDate: '2026-08-25T12:00:00.000Z', completedDate: '2026-08-25T12:00:00.000Z',
    item: { id: 'apple', name: 'Apple', source: 'manual' }, quantity: 1, unit: 'serving',
  });
  assert.deepEqual(firstFood.frontmatter.tags, ['food/healthy', 'meal/breakfast']);
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

test('multi-serving labels keep the same portion denominator after native indexing', () => {
  const food = { servingAmount: 2, servingUnit: 'serving', servingGrams: 100, calories: 200 };
  assert.equal(deriveNativeFoodEntryProjection({ quantity: 1, unit: 'serving' }, food).nutrition.calories, 100);
  assert.equal(deriveNativeFoodEntryProjection({ quantity: 2, unit: 'servings' }, food).nutrition.calories, 200);
  assert.equal(deriveNativeFoodEntryProjection({ quantity: 100, unit: 'g' }, food).nutrition.calories, 200);
});

test('editing consumed time moves an older food record out of its redundant legacy date', async () => {
  const h = createHarness();
  const file = h.addFrontmatterFile('Inbox/legacy-date-food.md', {
    tpsId: 'date-food', tpsSchemaVersion: 1, kind: 'food-entry', title: 'Food',
    date: '2026-09-29', completedDate: '2026-09-29T12:00:00', quantity: 1, unit: 'serving', calories: 210,
  });
  h.service.indexFile(file, h.frontmatters.get(file));
  const changes = [];
  h.service.onRecordsChanged(c => changes.push(c));
  await h.service.updateDailyFoodEntry(file, {
    ...h.service.getDailyFoodEntries('2026-09-29')[0], completedDate: '2026-09-28T12:00:00',
  });
  assert.equal(h.service.getDailyFoodTotals('2026-09-29').entryCount, 0);
  assert.equal(h.service.getDailyFoodTotals('2026-09-28').calories, 210);
  assert.deepEqual(changes.at(-1).dates.sort(), ['2026-09-28', '2026-09-29']);
  h.service.dispose();
});

test('daily queries stay date-scoped across ten years of records and current mutations', async () => {
  const h = createHarness({ deferSetup: true });
  for (let index = 0; index < 10_050; index++) {
    const historicalDay = new Date(Date.UTC(2018, 0, 1 + index % 3650)).toISOString().slice(0, 10);
    const activity = index % 2 === 0;
    h.addFrontmatterFile(`Inbox/history-${index}.md`, activity ? {
      tpsId: `history-activity-${index}`, tpsSchemaVersion: 1, kind: 'activity-entry',
      title: `Activity ${index}`, completedDate: `${historicalDay}T12:00:00`, durationMinutes: 10,
    } : {
      tpsId: `history-food-${index}`, tpsSchemaVersion: 1, kind: 'food-entry',
      title: `Food ${index}`, completedDate: `${historicalDay}T12:00:00`, calories: 100,
      quantity: 1, unit: 'serving',
    });
  }
  const first = h.addFrontmatterFile('Inbox/current-a.md', {
    tpsId: 'current-a', tpsSchemaVersion: 1, kind: 'food-entry', title: 'A food',
    completedDate: '2032-01-03T12:00:00', calories: 100, quantity: 1, unit: 'serving',
  });
  const second = h.addFrontmatterFile('Inbox/current-b.md', {
    tpsId: 'current-b', tpsSchemaVersion: 1, kind: 'food-entry', title: 'B food',
    completedDate: '2032-01-03T12:00:00', calories: 200, quantity: 1, unit: 'serving',
  });
  const movement = h.addFrontmatterFile('Inbox/current-activity.md', {
    tpsId: 'current-activity', tpsSchemaVersion: 1, kind: 'activity-entry', title: 'Walk',
    completedDate: '2032-01-03T13:00:00', durationMinutes: 30,
  });
  const workout = h.addFrontmatterFile('Inbox/current-workout.md', {
    tpsId: 'current-workout', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Lift',
    scheduled: '2032-01-03T14:00:00', timeEstimate: 20, status: 'complete',
  });
  h.service.setup();
  await new Promise(resolve => setTimeout(resolve, 0));
  h.readCalls.length = h.cachedReadCalls.length = 0;
  let lookups = 0, fullKindReads = 0;
  const originalGet = h.service.recordsByPath.get;
  const originalKindRecords = h.service.getKindRecords;
  h.service.recordsByPath.get = function (path) { lookups++; return originalGet.call(this, path); };
  h.service.getKindRecords = function (kind) { fullKindReads++; return originalKindRecords.call(this, kind); };
  for (let day = 1; day <= 7; day++) {
    const date = `2032-01-0${day}`;
    const target = day === 3;
    assert.equal(h.service.getDailyFoodTotals(date).calories, target ? 300 : 0);
    assert.deepEqual(h.service.getDailyFoodEntries(date).map(entry => entry.id), target ? ['current-a', 'current-b'] : []);
    assert.equal(h.service.getDailyActivityTotals(date).durationMinutes, target ? 50 : 0);
    assert.deepEqual(h.service.getDailyActivityEntries(date).map(entry => entry.id), target ? ['current-activity', 'current-workout'] : []);
  }
  assert.equal(fullKindReads, 0, 'seven-day reads never materialize every record of a kind');
  assert.equal(lookups, 26, 'seven-day reads inspect only the four records indexed to the selected week');
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);

  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  const firstEntry = h.service.getDailyFoodEntries('2032-01-03').find(entry => entry.id === 'current-a');
  await h.service.updateDailyFoodEntry(first, { ...firstEntry, completedDate: '2032-01-04T12:00:00' });
  assert.equal(h.service.getDailyFoodTotals('2032-01-03').calories, 200);
  assert.equal(h.service.getDailyFoodTotals('2032-01-04').calories, 100);
  assert.equal(h.service.pathsByDate.get('2032-01-03').has(first.path), false);
  assert.deepEqual(changes.at(-1).dates, ['2032-01-03', '2032-01-04']);
  const activityEntry = h.service.getDailyActivityEntries('2032-01-03').find(entry => entry.id === 'current-activity');
  await h.service.updateDailyActivityEntry(movement, { ...activityEntry, completedDate: '2032-01-04T13:00:00' });
  assert.equal(h.service.getDailyActivityTotals('2032-01-03').durationMinutes, 20);
  assert.equal(h.service.getDailyActivityTotals('2032-01-04').durationMinutes, 30);
  const nextWorkout = { ...h.frontmatters.get(workout), scheduled: '2032-01-04T14:00:00' };
  h.frontmatters.set(workout, nextWorkout);
  h.emitMetadata('changed', workout, undefined, { frontmatter: nextWorkout });
  assert.equal(h.service.getDailyActivityTotals('2032-01-03').durationMinutes, 0);
  assert.equal(h.service.getDailyActivityTotals('2032-01-04').durationMinutes, 50);
  await h.service.archiveDailyEntry(first, 'food-entry');
  assert.equal(h.service.getDailyFoodTotals('2032-01-04').entryCount, 0);
  assert.equal(h.service.pathsByDate.get('2032-01-04').has(first.path), false);

  const oldPath = second.path;
  const renamed = await h.api.rename(second, 'current-b-renamed');
  h.contents.set(renamed.path, h.contents.get(oldPath));
  h.contents.delete(oldPath);
  h.emitVault('rename', second, oldPath);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.service.getDailyFoodEntries('2032-01-03')[0].path, renamed.path);
  assert.equal(h.service.pathsByDate.get('2032-01-03').has(oldPath), false,
    'renaming removes the old path even though Obsidian has already mutated its TFile');
  const currentCache = h.plugin.app.metadataCache.getFileCache;
  h.plugin.app.metadataCache.getFileCache = file => file === second ? null : currentCache(file);
  h.plugin.getGcmNativeRecordsApi = () => ({ ...h.api });
  h.emitWorkspace('tps:gcm-api-changed', providerEvent(true));
  assert.equal(h.service.getDailyFoodTotals('2032-01-03').calories, 200,
    'a provider rebuild preserves a record whose metadata is temporarily unavailable');
  h.plugin.app.metadataCache.getFileCache = currentCache;
  h.emitMetadata('resolved');
  assert.equal(h.service.getDailyFoodTotals('2032-01-03').calories, 200);
  h.files.delete(second.path);
  h.emitVault('delete', second);
  assert.equal(h.service.getDailyFoodTotals('2032-01-03').entryCount, 0);
  assert.equal(h.service.pathsByDate.has('2032-01-03'), false, 'deleted paths leave no empty date bucket');
  h.service.dispose();
});

test('date buckets retain the distinct activity totals and entry date rules', () => {
  const h = createHarness();
  const activity = h.addFrontmatterFile('Inbox/activity-dates.md', {
    tpsId: 'activity-dates', tpsSchemaVersion: 1, kind: 'activity-entry', title: 'Walk',
    workoutDate: '2032-01-03', completedDate: '2032-01-04T12:00:00', durationMinutes: 10,
  });
  const workout = h.addFrontmatterFile('Inbox/workout-dates.md', {
    tpsId: 'workout-dates', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Lift',
    scheduled: '2032-01-03T10:00:00', completedDate: '2032-01-04T10:30:00',
    timeEstimate: 30, status: 'complete',
  });
  const changes = [];
  h.service.onRecordsChanged(change => changes.push(change));
  h.service.indexFile(activity, h.frontmatters.get(activity));
  h.service.indexFile(workout, h.frontmatters.get(workout));
  assert.equal(h.service.getDailyActivityTotals('2032-01-03').durationMinutes, 30);
  assert.equal(h.service.getDailyActivityTotals('2032-01-04').durationMinutes, 10);
  assert.deepEqual(h.service.getDailyActivityEntries('2032-01-03').map(entry => entry.id), ['activity-dates']);
  assert.deepEqual(h.service.getDailyActivityEntries('2032-01-04').map(entry => entry.id), ['workout-dates']);
  assert.deepEqual(changes.map(change => change.dates), [
    ['2032-01-04', '2032-01-03'], ['2032-01-03', '2032-01-04'],
  ], 'both dates that a dashboard can read receive invalidation');
  h.service.dispose();
});

test('food lifecycle retains exact portions and local days through edits, linked updates, reload and archive', async () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  const h = createHarness({ settings: { nativeRecordProperties: { completedDate: 'consumedAt', calories: 'energyKcal' } } });
  try {
    const definition = h.addFrontmatterFile('Inbox/portion-food.md', {
      kind: 'food', title: 'Synthetic food', servingAmount: 1, servingUnit: 'bowl', servingGrams: 100,
      calories: 200, proteinG: 10, carbsG: 25, fatG: 6,
    });
    const record = await h.service.createFoodEntry({
      id: 'roundtrip-portion', createdDate: '2026-09-30T00:30:00Z', completedDate: '2026-09-30T00:30:00Z',
      item: { id: 'food', name: 'Synthetic food', source: 'custom-note', sourcePath: definition.path },
      quantity: 3, unit: 'serving', servingQuantity: 300, servingUnit: 'g',
      nutritionOverride: { calories: 600, proteinG: 30, carbsG: 75, fatG: 18 },
    });
    const assertDay = (day, calories) => {
      const totals = h.service.getDailyFoodTotals(day), rows = h.service.getDailyFoodEntries(day);
      assert.equal(totals.calories, calories);
      assert.equal(totals.calories, rows.reduce((sum, row) => sum + row.calories, 0));
    };
    assertDay('2026-09-29', 600);
    assertDay('2026-09-30', 0);
    h.service.refreshConfiguration();
    assertDay('2026-09-29', 600);
    await h.service.updateDailyFoodEntry(record.path, {
      ...h.service.getDailyFoodEntries('2026-09-29')[0], quantity: 150,
      completedDate: '2026-09-29T00:30:00Z',
    });
    assertDay('2026-09-29', 0);
    assertDay('2026-09-28', 300);
    const next = { ...h.frontmatters.get(definition), calories: 220 };
    h.frontmatters.set(definition, next);
    h.emitMetadata('changed', definition, '', { frontmatter: next });
    assertDay('2026-09-28', 330);
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(h.frontmatters.get(record.file).energyKcal, 330);
    assert.equal(h.frontmatters.get(record.file).quantity, 150);
    h.service.refreshConfiguration();
    assertDay('2026-09-28', 330);
    await h.service.archiveDailyEntry(record.path, 'food-entry');
    assertDay('2026-09-28', 0);
    assert.deepEqual(h.readCalls, []);
  } finally {
    h.service.dispose();
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('food notes arriving before their linked definition converge without reopening the day', async () => {
  const h = createHarness();
  try {
    const entry = h.addFrontmatterFile('Inbox/synced-food.md', {
      tpsId: 'synced-food', tpsSchemaVersion: 1, kind: 'food-entry', title: 'Synced food',
      completedDate: '2026-09-29T12:00:00', quantity: 2, unit: 'serving',
      food: '[[Inbox/late-definition]]', calories: 400,
    });
    h.emitMetadata('changed', entry, '', { frontmatter: h.frontmatters.get(entry) });
    assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 400);
    const food = h.addFrontmatterFile('Inbox/late-definition.md', {
      kind: 'food', title: 'Food', servingAmount: 1, servingUnit: 'serving', calories: 210,
    });
    const changes = [];
    h.service.onRecordsChanged(change => changes.push(change));
    h.emitMetadata('changed', food, '', { frontmatter: h.frontmatters.get(food) });
    assert.equal(h.service.getDailyFoodTotals('2026-09-29').calories, 420);
    assert.ok(changes.some(change => change.dates.includes('2026-09-29')));
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(h.frontmatters.get(entry).calories, 420);
    assert.deepEqual(h.readCalls, []);
    assert.deepEqual(h.cachedReadCalls, []);
  } finally { h.service.dispose(); }
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

test('custom Health kind values and property keys write once and decode to the canonical runtime model', async () => {
  const settings = {
    nativeRecordKinds: {
      foodEntry: 'nutrition-log',
      activityEntry: 'movement-log',
      workoutSession: 'training-session',
      workoutExercise: 'training-exercise',
    },
    nativeRecordKindAliases: {},
    nativeRecordProperties: {
      completedDate: 'loggedAt',
      food: 'foodRef',
      quantity: 'consumedQuantity',
      unit: 'consumedUnit',
      calories: 'energyKcal',
      proteinG: 'protein',
    },
    nativeRecordPropertyAliases: {},
  };
  const { service, createCalls } = createHarness({ settings, customKinds: true });
  const created = await service.createFoodEntry({
    id: 'custom-food-1',
    createdDate: '2026-09-03T12:00:00.000Z',
    completedDate: '2026-09-03T12:05:00.000Z',
    item: { id: 'sandwich', name: 'Sandwich', source: 'manual' },
    quantity: 1,
    unit: 'serving',
    nutritionOverride: { calories: 410, proteinG: 24, carbsG: 38, fatG: 18 },
  });
  assert.equal(createCalls[0].kind, 'nutrition-log');
  assert.equal(createCalls[0].properties.loggedAt, '2026-09-03T12:05:00.000Z');
  assert.equal(createCalls[0].properties.energyKcal, 410);
  assert.equal(createCalls[0].properties.protein, 24);
  assert.equal(Object.hasOwn(createCalls[0].properties, 'completedDate'), false);
  assert.equal(Object.hasOwn(createCalls[0].properties, 'calories'), false);
  assert.equal(created.kind, 'food-entry');
  assert.equal(created.frontmatter.completedDate, '2026-09-03T12:05:00.000Z');
  assert.equal(created.frontmatter.calories, 410);
  assert.deepEqual(service.getDailyFoodTotals('2026-09-03'), {
    entryCount: 1,
    calories: 410,
    proteinG: 24,
    carbsG: 38,
    fatG: 18,
    fiberG: 0,
    sugarG: 0,
    sugarAlcoholG: 0,
    sugarAlcoholCaloriesPerG: 0,
    alcoholG: 0,
    sodiumMg: 0,
  });
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

test('a known Health modify refreshes its cached source before MetadataCache catches up', async () => {
  const { service, addFrontmatterFile, contents, emitVault, readCalls, cachedReadCalls } = createHarness();
  const original = { tpsId: 'food-live', tpsSchemaVersion: 1, kind: 'food-entry', date: '2026-08-24', calories: 100 };
  const file = addFrontmatterFile('food-live.md', original);
  service.indexFile(file, original);
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
  assert.deepEqual(readCalls, []);
  assert.deepEqual(cachedReadCalls, [file.path]);
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

test('native workouts use the calendar-friendly start and duration properties without temporal duplicates', async () => {
  const { service } = createHarness();
  const startedAt = '2026-08-24T15:00:00.000Z';
  const endedAt = '2026-08-24T15:35:30.000Z';
  const session = await service.createWorkoutSession({ title: 'Calendar strength', startedAt }, 'workout-calendar');

  assert.equal(session.frontmatter.scheduled, startedAt);
  assert.equal(session.frontmatter.timeEstimate, 60);
  assert.equal(service.getWorkoutSnapshot(session.path).endedAt, '');
  assert.equal(service.getDailyActivityTotals('2026-08-24').durationMinutes, 0);
  for (const redundant of ['startedAt', 'end', 'endedAt', 'completedDate', 'durationMinutes', 'durationSeconds']) {
    assert.equal(Object.hasOwn(session.frontmatter, redundant), false, `${redundant} is absent while the workout is active`);
  }

  const finished = await service.finishWorkout(session.file, { endedAt });
  assert.equal(finished.frontmatter.scheduled, startedAt);
  assert.equal(finished.frontmatter.timeEstimate, 35.5);
  for (const redundant of ['startedAt', 'end', 'endedAt', 'completedDate', 'durationMinutes', 'durationSeconds']) {
    assert.equal(Object.hasOwn(finished.frontmatter, redundant), false, `${redundant} is not duplicated after finishing`);
  }
  assert.equal(service.getWorkoutSnapshot(session.path).startedAt, startedAt);
  assert.equal(service.getWorkoutSnapshot(session.path).endedAt, endedAt);
  assert.equal(service.getDailyActivityTotals('2026-08-24').durationMinutes, 35.5);
});

test('native workouts use custom start and end keys without reading old timing names', async () => {
  const { service, frontmatters } = createHarness({
    settings: {
      workoutStartPropertyKey: 'calendarStart',
      workoutIntervalMode: 'end',
      workoutIntervalPropertyKey: 'calendarEnd',
    },
  });
  const startedAt = '2026-08-24T16:00:00.000Z';
  const endedAt = '2026-08-24T16:42:00.000Z';
  const session = await service.createWorkoutSession({ title: 'Custom calendar strength', startedAt }, 'workout-custom-calendar');

  assert.equal(session.frontmatter.calendarStart, startedAt);
  assert.equal(session.frontmatter.calendarEnd, '2026-08-24T17:00:00.000Z');
  assert.equal(Object.hasOwn(session.frontmatter, 'scheduled'), false);
  assert.equal(Object.hasOwn(session.frontmatter, 'startedAt'), false);

  frontmatters.set(session.file, {
    ...frontmatters.get(session.file),
    startedAt,
    endedAt,
    durationMinutes: 42,
    timeEstimate: 42,
  });
  service.indexFile(session.file, frontmatters.get(session.file));
  assert.equal(service.getWorkoutSnapshot(session.path).endedAt, '', 'legacy ending fields are not fallback reads');
  const finished = await service.finishWorkout(session.file, { endedAt });

  assert.equal(finished.frontmatter.calendarStart, startedAt);
  assert.equal(finished.frontmatter.calendarEnd, endedAt);
  assert.equal(service.getWorkoutSnapshot(session.path).startedAt, startedAt);
  assert.equal(service.getWorkoutSnapshot(session.path).endedAt, endedAt);
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
  assert.match(mainSource, /nativeWorkoutReadingMountTarget\(target, root\)/u);
  assert.match(mainSource, /renderedRoot\?\.closest<HTMLElement>\("\.markdown-preview-section"\)/u);
  assert.match(mainSource, /previewSizer\.children/u);
  assert.doesNotMatch(mainSource, /target\.appendChild\(surface\)/u, 'Reading surfaces must stay inside an Obsidian-managed preview section so scroll virtualization cannot delete them');
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
  assert.match(nativeWorkoutSurfaceSource, /showSessionActions: options\.showSessionActions/u);
  assert.match(nativeWorkoutSurfaceSource, /if \(options\.showSessionActions\) \{[\s\S]*?button\('\+ Exercise'[\s\S]*?button\('Finish'/u, 'inline mode owns the session actions inside the workout card');
  assert.match(nativeWorkoutSurfaceSource, /if \(options\.showSessionActions\) \{[\s\S]*?button\('\+ Exercise', 'Add first exercise'/u, 'floating mode does not leave a duplicate empty-state action');
  assert.match(mainSource, /instanceKey: this\.workoutSurfaceInstanceKey/u);
  assert.match(mainSource, /showSessionActions: !this\.workoutActionBarOwnsNativeSession\(snapshot\)/u);
  assert.match(mainSource, /private workoutActionBarOwnsNativeSession\(snapshot: NativeWorkoutSnapshot\): boolean \{[\s\S]*?workoutControlPlacement !== "floating"[\s\S]*?\.tps-health-workout-action-bar\[data-path\][\s\S]*?bar\.dataset\.path === snapshot\.path/u, 'floating mode hides native session actions only after its action bar owns them');
  assert.match(mainSource, /surface\.dataset\.renderContext = "reading"/u);
  assert.match(mainSource, /for \(const duplicate of matches\) duplicate\.remove\(\)/u);
  assert.match(mainSource, /if \(!target\?\.isConnected\) return false/u);
  assert.match(stylesSource, /\.markdown-source-view:not\(\.is-live-preview\) \.tps-health-native-workout-surface/u);
  assert.match(stylesSource, /\.tps-health-form-grid \.setting-item-control \{[\s\S]*?flex: 0 0 auto;/u, "grid fields do not inherit a tall desktop flex basis");
  assert.match(stylesSource, /\.tps-health-modal \.tps-health-modal-actions \{[\s\S]*?position: sticky;/u, "shared actions remain reachable above the keyboard");
  assert.match(stylesSource, /\.tps-health-native-workout-exercise\.is-superset/u);
  assert.match(stylesSource, /\.tps-health-native-workout-row\.is-drop-set/u);
  assert.match(stylesSource, /@container tps-health-native-workout \(max-width: 620px\)[\s\S]*?\.tps-health-native-workout-row \{[\s\S]*?min-width: 0;/u, 'narrow workout rows keep completion and the set menu on screen');
  assert.match(stylesSource, /@container tps-health-native-workout \(max-width: 620px\)[\s\S]*?grid-template-columns: 20px minmax\(36px, \.55fr\) minmax\(82px, 1\.25fr\) minmax\(42px, \.72fr\) minmax\(72px, \.9fr\)/u, 'phone rows fit their five visible columns without horizontal clipping');
  assert.match(stylesSource, /\.tps-health-native-workout-button\.is-complete-toggle::before \{[\s\S]*?content: "○"/u, 'phone completion remains a clear compact toggle');
  assert.match(stylesSource, /\.tps-health-native-workout-button\.is-complete-toggle\[aria-pressed="true"\]::before \{[\s\S]*?content: "✓"/u);
  assert.match(stylesSource, /\.tps-health-native-workout-per-arm > span \{[\s\S]*?display: none/u, 'the redundant per-arm text does not force the weight cell wider than the phone');
  assert.match(stylesSource, /@container tps-health-native-workout \(max-width: 360px\)[\s\S]*?grid-template-columns: 18px minmax\(32px, \.55fr\) minmax\(74px, 1\.2fr\) minmax\(38px, \.68fr\) minmax\(70px, \.86fr\)/u, 'the smallest supported phone width retains every visible control');
  assert.match(mainSource, /nativeSnapshot && this\.settings\.workoutControlPlacement === "inline"[\s\S]*?native:inline-surface-owns-actions[\s\S]*?return null/u, 'inline mode suppresses the floating or sticky native action bar');
  assert.match(mainSource, /this\.settings\.workoutControlPlacement === "inline" && this\.nativeRecordService\?\.isEnabled\(\)[\s\S]*?mobile:native-surface-owns-actions[\s\S]*?return null/u, 'mobile target selection follows the configured action owner');
  assert.match(stylesSource, /\.tps-health-native-workout-button\.is-complete-toggle/u);
  assert.match(mainSource, /\.setTitle\("Add drop set"\)[\s\S]*?addNativeWorkoutDropSet\(snapshot, exercise, set\)/u);
  assert.match(mainSource, /const linkedSetIds = set\.dropSetGroupId[\s\S]*?candidate\.dropSetGroupId === set\.dropSetGroupId/u, 'direct add extends an existing drop chain');
});

test('whole-note storage is mandatory while legacy import remains explicit and copy-only', () => {
  assert.match(typesSource, /storageMode: HealthStorageMode/u);
  assert.match(typesSource, /storageMode: "native-records"/u);
  assert.doesNotMatch(settingsSource, /addOption\("legacy", "Atomic lines"\)/u);
  assert.match(mainSource, /this\.nativeRecordService\.createFoodEntry\(entry\)/u);
  assert.match(mainSource, /this\.nativeRecordService\.createActivityEntry\(entry\)/u);
  assert.match(mainSource, /this\.plugin\.nativeRecordService\?\.isEnabled\(\)/u);
  assert.match(mainSource, /Record duration, distance, steps, or calories for this activity\./u);
  assert.match(mainSource, /return this\.startNativeWorkout/u);
  assert.match(mainSource, /return this\.logNativeWorkoutSet\(set, active\.path\)/u);
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
  assert.match(mainSource, /createWorkoutSession\(\{[\s\S]*?workoutDate: isoDateKey\(context\.dailyNoteDate\)/u);
  assert.match(settingsSource, /setButtonText\("Preview import"\)/u);
  assert.match(settingsSource, /setButtonText\("Copy into notes"\)/u);
  const { service } = createHarness({ settings: { storageMode: 'legacy' } });
  assert.equal(service.isEnabled(), true, 'a persisted inline setting cannot re-enable line writers');
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

test('workout finish waits for transient indexing but remains bounded and fails closed during startup', async()=>{
 const cold=createHarness({layoutReady:true,metadataInitialized:false});
 assert.equal(await cold.service.waitForWorkoutIndexSettled(0),false);
 cold.emitMetadata('resolved');
 cold.service.refreshGenerations.set('Synthetic/layout.md',1);
 assert.equal(await cold.service.waitForWorkoutIndexSettled(0),false);
 const timer=setTimeout(()=>cold.service.refreshGenerations.delete('Synthetic/layout.md'),5);
 try { assert.equal(await cold.service.waitForWorkoutIndexSettled(250),true); }
 finally {clearTimeout(timer);}
});

test('mobile layout readiness cannot revoke an already resolved metadata generation', async () => {
  const h = createHarness({ layoutReady: false, metadataInitialized: false });
  // initialized is an internal desktop implementation detail, not a required mobile API.
  delete h.plugin.app.metadataCache.initialized;
  h.emitMetadata('resolved');
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  h.finishLayout();
  await Promise.resolve();
  assert.equal(h.service.isWorkoutIndexSettled(), true, 'layout must preserve the authoritative resolved event');
});

test('delayed known-Health reads refresh workout controls after the last pending read settles', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Mobile', startedAt: '2026-09-12T12:00:00Z' }, 'mobile');
  const second = await h.service.createWorkoutSession({ title: 'Second' }, 'second');
  const releases = new Map();
  h.plugin.app.vault.cachedRead = file => new Promise(resolve => releases.set(file.path, () => resolve(h.contents.get(file.path))));
  const states = [];
  h.plugin.scheduleWorkoutActionBars = () => states.push(h.service.isWorkoutIndexSettled());
  const workoutRead = h.service.refreshFile(record.file);
  const otherRead = h.service.refreshFile(second.file);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  releases.get(record.path)();
  await workoutRead;
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  releases.get(second.path)();
  await otherRead;
  assert.equal(states.at(-1), true, 'the final read must wake controls even when it belongs to another file');
  assert.equal(h.service.resolveWorkoutSession({ id: record.id, path: record.path }).state, 'active');
  assert.equal(h.service.getWorkoutSnapshot(record.path).status, 'active');
});

test('metadata-only workout changes schedule controls without a page navigation', async () => {
  const h = createHarness();
  const record = await h.service.createWorkoutSession({ title: 'Mobile', startedAt: '2026-09-12T12:00:00Z' }, 'mobile');
  let refreshes = 0;
  h.plugin.scheduleWorkoutActionBars = () => refreshes++;
  h.emitMetadata('changed', record.file, '', { frontmatter: { ...record.frontmatter, status: 'complete' } });
  assert.ok(refreshes > 0);
  assert.equal(h.service.resolveWorkoutSession({ id: record.id }).state, 'terminal');
});

test('warm mobile load uses public cache coverage when initialized is absent and resolved already fired', async () => {
 const h=createHarness({metadataInitialized:false});
 delete h.plugin.app.metadataCache.initialized;
 const record=await h.service.createWorkoutSession({title:'Warm mobile'},'warm');
 h.service.refreshConfiguration();
 assert.equal(await h.service.waitForWorkoutIndexSettled(250),true);
 assert.equal(h.service.resolveWorkoutSession({id:record.id}).state,'active');
 const original=h.plugin.app.metadataCache.getFileCache;
 h.plugin.app.metadataCache.getFileCache=()=>null;
 h.service.workoutIndexReady=false;
 h.service.refreshConfiguration();
 await Promise.resolve();
 assert.equal(h.service.isWorkoutIndexSettled(),false,'partial cache coverage cannot authorize recovery');
 h.plugin.app.metadataCache.getFileCache=original;
 h.service.refreshConfiguration();
 assert.equal(await h.service.waitForWorkoutIndexSettled(250),true);
});

test('an unloaded service cannot refresh controls when an old mobile read finishes', async()=>{
 const h=createHarness(),record=await h.service.createWorkoutSession({title:'Unload'},'unload');
 let release;h.plugin.app.vault.cachedRead=()=>new Promise(resolve=>release=()=>resolve(h.contents.get(record.path)));
 let refreshes=0;h.plugin.scheduleWorkoutActionBars=()=>refreshes++;
 const read=h.service.refreshFile(record.file);h.service.dispose();release();await read;
 assert.equal(refreshes,0);
 assert.equal(await h.service.waitForWorkoutIndexSettled(),false);
});

test('food record projection preserves requested order and excludes duplicates and non-food records', async () => {
  const { service } = createHarness({ apiVersion: 6 });
  const food = (id, amount) => ({id,createdDate:'2026-09-14T12:00:00.000Z',completedDate:'2026-09-14T12:00:00.000Z',item:{id,name:id,source:'manual',nutrition:{calories:amount}},quantity:1,unit:'serving'});
  const a=await service.createFoodEntry(food('base-a',100));
  const b=await service.createFoodEntry(food('base-b',200));
  const activity=await service.createActivityEntry({id:'base-walk',activity:'Walk',activityType:'walking',startedAt:'2026-09-14T12:00:00.000Z',completedDate:'2026-09-14T12:30:00.000Z',durationMinutes:30,source:'manual'});
  const entries=service.getFoodEntriesForPaths([b.path,a.path,b.path,activity.path,'missing.md']);
  assert.deepEqual(entries.map(e=>e.id),['base-b','base-a']);
  assert.deepEqual(entries.map(e=>e.calories),[200,100]);
  assert.deepEqual(entries.map(e=>e.dateIso),['2026-09-14','2026-09-14']);
  assert.deepEqual(service.getFoodEntriesForPaths([]),[]);
});

test('deleting an atomic workout set preserves neighbors and clears a singleton drop chain', async () => {
  const { service } = createHarness();
  const session = await service.createWorkoutSession({title:'Delete set QA',startedAt:'2026-09-15T10:00:00.000Z'},'delete-set-qa');
  await service.ensureWorkoutExercise(session,'Curl','Health/Exercises/Curl.md');
  let snapshot=service.getWorkoutSnapshot(session.path);
  const exercise=snapshot.exercises[0];
  await service.addPlannedWorkoutSet(session.path,exercise.id);
  snapshot=service.getWorkoutSnapshot(session.path);
  const original=snapshot.exercises[0].sets[0];
  await service.setWorkoutDropSetLinks(session.path,exercise.id,original.id,[],true);
  snapshot=service.getWorkoutSnapshot(session.path);
  const drop=snapshot.exercises[0].sets[1];
  await service.updateWorkoutSet(session.path,drop.id,{completed:true});
  await assert.rejects(service.deleteWorkoutSet(session.path,'wrong-exercise',drop.id),/missing or ambiguous/);
  assert.equal(service.getWorkoutSnapshot(session.path).exercises[0].sets.length,2);
  await service.deleteWorkoutSet(session.path,exercise.id,drop.id);
  snapshot=service.getWorkoutSnapshot(session.path);
  assert.equal(snapshot.exercises[0].sets.length,1);
  assert.equal(snapshot.exercises[0].sets[0].id,original.id);
  assert.ok(!snapshot.exercises[0].sets[0].dropSetGroupId);
  await assert.rejects(service.deleteWorkoutSet(session.path,exercise.id,drop.id),/missing or ambiguous/);
  await service.deleteWorkoutSet(session.path,exercise.id,original.id);
  assert.equal(service.getWorkoutSnapshot(session.path).exercises[0].sets.length,0);
});


test('supplement label amounts survive native creation, serving edits, daily totals and removal', async () => {
  const { service, api, addFrontmatterFile, frontmatters } = createHarness();
  const food = addFrontmatterFile('Supplement.md', {
    kind: 'food', servingAmount: 2, servingUnit: 'capsule', vitaminB12Mcg: 2.4, vitaminDMcg: 25, calciumMg: 200, creatineG: 0,
  });
  const created = await service.createFoodEntry({ id: 'supplement-1', createdDate: '2026-08-25T17:20:00.000Z', completedDate: '2026-08-25T17:20:00.000Z',
    item: { id: 'supplement', name: 'Supplement', source: 'custom-note', sourcePath: 'Supplement.md' },
    quantity: .5, unit: 'serving', servingQuantity: 1, servingUnit: 'capsule',
  });
  let total = service.getDailyFoodTotals('2026-08-25');
  assert.equal(total.vitaminB12Mcg, 1.2);
  assert.equal(total.vitaminDMcg, 12.5);
  assert.equal(total.calciumMg, 100);
  assert.equal(total.creatineG, 0, 'explicit zero remains known');
  assert.equal(total.magnesiumMg, undefined, 'unknown nutrients stay absent');
  assert.equal(service.getDailyFoodEntries('2026-08-25')[0].vitaminB12Mcg, 1.2);
  const authored = { ...(await api.resolve(created.file)).frontmatter, quantity: 4, unit: 'capsule' };
  frontmatters.set(created.file, authored); service.indexFile(created.file, authored);
  total = service.getDailyFoodTotals('2026-08-25');
  assert.equal(total.vitaminDMcg, 50);
  assert.equal(total.vitaminB12Mcg, 4.8);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal((await api.resolve(created.file)).frontmatter.vitaminB12Mcg, 4.8);
  const definition = { ...frontmatters.get(food) }; delete definition.vitaminDMcg;
  frontmatters.set(food, definition); service.indexFile(food, definition);
  assert.equal(service.getDailyFoodTotals('2026-08-25').vitaminDMcg, undefined);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal((await api.resolve(created.file)).frontmatter.vitaminDMcg, undefined);
});

test('supplement properties honor configured atomic keys and aliases', async () => {
 const { service, createCalls } = createHarness({ settings: { nativeRecordProperties: { creatineG: 'creatineDose' }, nativeRecordPropertyAliases: {} } });
 await service.createFoodEntry({ id:'dose-key', createdDate:'2026-08-25T17:20:00.000Z', completedDate:'2026-08-25T17:20:00.000Z', item:{id:'dose',name:'Creatine',source:'manual'}, quantity:1, unit:'serving', nutritionOverride:{creatineG:3} });
 assert.equal(createCalls[0].properties.creatineDose, 3);
 assert.equal(createCalls[0].properties.creatineG, undefined);
 assert.equal(service.getDailyFoodTotals('2026-08-25').creatineG, 3);
});


test('edited metric food serving governs atomic gram conversions and serving amounts', () => {
  for (const unit of ['g', 'ml']) {
    const food = {servingAmount:355,servingUnit:unit,servingGrams:100,servingMl:100,nutritionBasis:'per-100g',calories:46.5,alcoholG:6.3};
    const half = deriveNativeFoodEntryProjection({quantity:177.5,unit},food);
    assert.equal(half.servings,.5);
    assert.equal(half.nutrition.calories,23.25);
    assert.equal(deriveNativeFoodEntryProjection({quantity:1,unit:'serving'},food).amount,355);
    assert.equal(deriveNativeFoodEntryProjection({quantity:1,unit: unit === 'g' ? 'ml' : 'g'},food),null);
  }
});


test('tracking nutrients requires the record bridge but no GCM menu definitions or Health goals', async () => {
  const { service, api, createCalls } = createHarness({ settings: {healthGoals:[],nativeRecordProperties:{},nativeRecordPropertyAliases:{}} });
  const nutrients = {creatineG:2.5,alcoholG:14,fiberG:3.5,vitaminCMg:90,magnesiumMg:125};
  const created = await service.createFoodEntry({ id:'independent-nutrients',createdDate:'2026-08-25T17:20:00.000Z',completedDate:'2026-08-25T17:20:00.000Z',item:{id:'independent',name:'Synthetic nutrition',source:'manual'},quantity:1,unit:'serving',nutritionOverride:nutrients });
  const persisted = (await api.resolve(created.file)).frontmatter;
  const totals = service.getDailyFoodTotals('2026-08-25');
  for (const [key,value] of Object.entries(nutrients)) {
    assert.equal(createCalls[0].properties[key], value, key);
    assert.equal(persisted[key], value, key);
    assert.equal(totals[key], value, key);
    assert.equal(service.getDailyFoodEntries('2026-08-25')[0][key], value, key);
  }
});


test('custom nutrients persist through native creation, food serving edits and removal with no configured properties', async () => {
 const key='healthNutrient_polyphenols';
 configureCustomNutrients([{key,label:'Polyphenols',unit:'mg'}]);
 try {
  const {service,api,addFrontmatterFile,frontmatters}=createHarness();
  const food=addFrontmatterFile('Custom.md',{kind:'food',servingAmount:2,servingUnit:'capsule',[key]:120});
  const record=await service.createFoodEntry({id:'custom-nutrient',nutritionOverride:{[key]:60},createdDate:'2026-08-25T17:20:00Z',completedDate:'2026-08-25T17:20:00Z',item:{id:'food',name:'Custom',source:'custom-note',sourcePath:food.path},quantity:.5,unit:'serving',servingQuantity:1,servingUnit:'capsule'});
  assert.equal((await api.resolve(record.file)).frontmatter[key],60);
  assert.equal(service.getDailyFoodTotals('2026-08-25')[key],60);
  const edited={...frontmatters.get(food),[key]:140};frontmatters.set(food,edited);service.indexFile(food,edited);
  assert.equal(service.getDailyFoodTotals('2026-08-25')[key],70);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal((await api.resolve(record.file)).frontmatter[key],70);
  delete edited[key];frontmatters.set(food,edited);service.indexFile(food,edited);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal((await api.resolve(record.file)).frontmatter[key],undefined);
  assert.equal(service.getDailyFoodTotals('2026-08-25')[key],undefined);
 } finally {configureCustomNutrients([]);}
});


test('custom workout kind and session property survive source refresh with all sets intact', async () => {
  const h = createHarness({customKinds:true,settings:{nativeRecordKinds:{workoutSession:'training'},nativeRecordProperties:{session:'trainingData'}}});
  const record = await h.service.createWorkoutSession({title:'Mapped session'},'mapped-session');
  await h.service.appendWorkoutSet(record.file,{id:'mapped-set-1',exercise:'Press',exercisePath:'Inbox/Press.md',reps:8,weight:80,weightUnit:'lb',createdDate:'2026-09-20T12:00:00Z',endedAt:'2026-09-20T12:01:00Z'});
  await h.service.refreshFile(record.file);
  await h.service.appendWorkoutSet(record.file,{id:'mapped-set-2',exercise:'Press',exercisePath:'Inbox/Press.md',reps:6,weight:85,weightUnit:'lb'});
  await h.service.refreshFile(record.file);
  const snapshot = h.service.getWorkoutSnapshot(record.path);
  assert.deepEqual(snapshot.exercises[0].sets.map(set=>set.reps),[8,6]);
  assert.equal(h.frontmatters.get(record.file).kind,'training');
  assert.ok(h.frontmatters.get(record.file).trainingData);
  assert.equal(h.frontmatters.get(record.file).session,undefined);
  h.service.dispose();
});

test('warm metadata resolution keeps the incremental Health index without rescanning the vault', async () => {
  const h = createHarness();
  const food = await h.service.createFoodEntry({
    id: 'indexed-food', createdDate: '2026-09-20T12:00:00.000Z', completedDate: '2026-09-20T12:00:00.000Z',
    item: { id: 'indexed-food', name: 'Indexed food', source: 'manual' }, quantity: 1, unit: 'serving',
    nutritionOverride: { calories: 210, proteinG: 0, carbsG: 0, fatG: 0 },
  });
  let scans = 0;
  const getFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return getFiles(); };
  h.emitMetadata('changed', food.file, '', { frontmatter: { ...food.frontmatter, calories: 320 } });
  for (let i = 0; i < 3; i++) h.emitMetadata('resolved');
  assert.equal(scans, 0, 'settled metadata batches must not clear and rebuild every record');
  assert.equal(h.service.getDailyFoodTotals('2026-09-20').calories, 320, 'incremental edits remain authoritative');
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  h.service.dispose();
});

test('cold metadata resolution builds once and later batches preserve the settled index', () => {
  const h = createHarness({ layoutReady: false, metadataInitialized: false });
  let scans = 0;
  const getFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return getFiles(); };
  h.emitMetadata('resolved');
  h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  h.finishLayout();
  assert.equal(scans, 1, 'layout hydration must reuse the metadata index');
  h.emitMetadata('resolved');
  assert.equal(scans, 1);
  h.service.dispose();
});

function addStartupRecords(h) {
  for (let index = 0; index < 2048; index++) h.addFrontmatterFile(`Inbox/startup-${index}.md`, { title: `Note ${index}` });
  const workout = h.addFrontmatterFile('Inbox/startup-session.md', {
    tpsId: 'startup-session', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Workout', status: 'active',
  });
  h.contents.set(workout.path, writeWorkoutDataToNoteContent(h.contents.get(workout.path), JSON.stringify({
    version: 1, exercises: [{ id: 'exercise', name: 'Bench press', sets: [{ id: 'set', reps: 8 }] }],
  })));
  return workout;
}

test('an incomplete warm startup hydrates known workouts without waiting for unrelated metadata', async () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  const workout = addStartupRecords(h);
  const getCache = h.plugin.app.metadataCache.getFileCache;
  const getFiles = h.plugin.app.vault.getMarkdownFiles;
  let cacheReady = false;
  let scans = 0;
  h.plugin.app.metadataCache.getFileCache = (file) => file.path === 'Inbox/startup-0.md' && !cacheReady
    ? null : getCache(file);
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getFiles(); };

  h.service.setup();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scans, 1);
  assert.equal(h.service.isWorkoutIndexSettled(), true, 'an unrelated cache gap does not block controls');
  assert.deepEqual(h.cachedReadCalls, [workout.path], 'known workout bodies hydrate despite unrelated pending metadata');
  cacheReady = true;
  h.emitMetadata('resolved');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scans, 1, 'pending cache resolution does not enumerate the vault again');
  assert.deepEqual(h.cachedReadCalls, [workout.path], 'reconciliation does not reread the known workout');
  assert.equal(h.service.getWorkoutSnapshot('startup-session').exercises[0].sets[0].reps, 8);
  for (let index = 0; index < 10; index++) h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.deepEqual(h.cachedReadCalls, [workout.path]);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('unrelated missing metadata does not prevent scoped hydration of indexed workouts', async () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  h.addLegacyFile('Inbox/unrelated.md', 'Ordinary note.');
  const ready = h.addFrontmatterFile('Inbox/ready-session.md', {
    tpsId: 'ready-session', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Ready workout', status: 'active',
  });
  const later = h.addFrontmatterFile('Inbox/later-session.md', {
    tpsId: 'later-session', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Later workout', status: 'active',
  });
  for (const file of [ready, later]) {
    h.contents.set(file.path, writeWorkoutDataToNoteContent(h.contents.get(file.path), JSON.stringify({
      version: 1, exercises: [{ id: 'exercise', name: 'Bench press', sets: [{ id: 'set', reps: 8 }] }],
    })));
  }
  const getCache = h.plugin.app.metadataCache.getFileCache;
  let laterReady = false, scans = 0;
  h.plugin.app.metadataCache.getFileCache = file => file.path === 'Inbox/unrelated.md'
    || (file.path === later.path && !laterReady) ? null : getCache(file);
  const getMarkdownFiles = h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles = () => { scans += 1; return getMarkdownFiles(); };
  h.service.setup();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.cachedReadCalls, [ready.path], 'known workout body hydrates despite an unrelated null cache');
  assert.equal(h.service.getWorkoutSnapshot('ready-session').exercises[0].sets[0].reps, 8);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  laterReady = true;
  h.emitMetadata('resolved');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.cachedReadCalls, [ready.path, later.path], 'newly indexed workout hydrates without rereading its sibling');
  assert.equal(h.service.getWorkoutSnapshot('later-session').exercises[0].sets[0].reps, 8);
  assert.equal(scans, 1);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

test('a pending workout indexed from changed source does not reread its supplied body', () => {
  const h = createHarness({ deferSetup: true, metadataInitialized: true });
  const workout = h.addFrontmatterFile('Inbox/changed-session.md', {
    tpsId: 'changed-session', tpsSchemaVersion: 1, kind: 'workout-session', title: 'Changed workout', status: 'active',
  });
  const source = writeWorkoutDataToNoteContent(h.contents.get(workout.path), JSON.stringify({
    version: 1, exercises: [{ id: 'exercise', name: 'Bench press', sets: [{ id: 'set', reps: 8 }] }],
  }));
  h.contents.set(workout.path, source);
  h.plugin.app.metadataCache.getFileCache = () => null;
  h.service.setup();
  h.emitMetadata('changed', workout, source, { frontmatter: h.frontmatters.get(workout) });
  assert.equal(h.service.getWorkoutSnapshot('changed-session').exercises[0].sets[0].reps, 8);
  assert.deepEqual(h.cachedReadCalls, [], 'the changed event already supplied the authoritative body');
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.updateCalls, []);
  h.service.dispose();
});

for (const order of ['resolved-before-layout', 'layout-before-resolved', 'resolved-before-delayed-layout-callback']) {
  test(`startup indexes once and hydrates once: ${order}`, async () => {
    const h = createHarness({ layoutReady: false, metadataInitialized: false });
    const workout = addStartupRecords(h);
    let scans = 0;
    h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
    if (order === 'layout-before-resolved') {
      h.finishLayout();
      assert.equal(scans, 0, 'layout must not preempt metadata readiness with a whole-vault scan');
      assert.equal(h.service.isWorkoutIndexSettled(), false);
    } else if (order === 'resolved-before-delayed-layout-callback') {
      // Obsidian sets layoutReady before its queued callbacks run. This is the
      // order observed in the installed startup profile, not a second event.
      h.plugin.app.workspace.layoutReady = true;
    }
    h.plugin.app.metadataCache.initialized = true;
    h.emitMetadata('resolved');
    await new Promise(resolve => setTimeout(resolve, 0));
    h.finishLayout();
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let i = 0; i < 10; i++) h.emitMetadata('resolved');
    assert.equal(scans, 1, 'metadata owns the single nonempty startup index');
    assert.deepEqual(h.cachedReadCalls, [workout.path], 'each recognized workout hydrates once');
    assert.deepEqual(h.readCalls, []);
    assert.equal(h.service.getWorkoutSnapshot('startup-session').exercises[0].sets[0].reps, 8);
    assert.equal(h.service.isWorkoutIndexSettled(), true);
    h.service.dispose();
  });
}

test('warm setup indexes and hydrates once even when onLayoutReady calls synchronously', async () => {
  for (const metadataInitialized of [true, false]) {
    const h = createHarness({ deferSetup: true, metadataInitialized });
    if (!metadataInitialized) delete h.plugin.app.metadataCache.initialized;
    const workout = addStartupRecords(h);
    let scans = 0;
    h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
    h.service.setup();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(scans, 1);
    assert.deepEqual(h.cachedReadCalls, [workout.path]);
    assert.equal(h.service.isWorkoutIndexSettled(), true, 'complete public caches still support warm mobile loading');
    assert.equal(h.service.getDailyIndexStatus(), 'ready', 'the same public coverage unblocks daily blocks without another resolved event');
    h.service.refreshConfiguration();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(scans, 2, 'explicit settings refresh retains its full rebuild');
    assert.deepEqual(h.cachedReadCalls, [workout.path, workout.path]);
    h.service.dispose();
  }
});

test('metadata already initialized before layout defers only workout hydration', async () => {
  const h = createHarness({ deferSetup: true, layoutReady: false, metadataInitialized: true });
  const workout = addStartupRecords(h);
  let scans = 0;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
  h.service.setup();
  h.emitMetadata('resolved');
  assert.equal(scans, 1);
  assert.deepEqual(h.cachedReadCalls, [], 'legacy bodies wait for layout even when metadata is ready');
  h.finishLayout();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scans, 1);
  assert.deepEqual(h.cachedReadCalls, [workout.path]);
  assert.equal(h.service.getWorkoutSnapshot('startup-session').exercises[0].sets[0].reps, 8);
  h.service.dispose();
});

test('layout with an incomplete or blank metadata cache does not preempt resolved discovery', async () => {
  const h = createHarness({ layoutReady: false, metadataInitialized: false });
  const workout = addStartupRecords(h);
  const getCache = h.plugin.app.metadataCache.getFileCache;
  let scans = 0;
  h.plugin.app.vault.getMarkdownFiles = () => { scans++; return [...h.files.values()]; };
  h.plugin.app.metadataCache.getFileCache = () => null;
  h.finishLayout();
  assert.equal(scans, 0);
  assert.deepEqual(h.cachedReadCalls, []);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
  h.plugin.app.metadataCache.getFileCache = getCache;
  h.emitMetadata('resolved');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scans, 1);
  assert.deepEqual(h.cachedReadCalls, [workout.path]);
  assert.equal(h.service.getWorkoutSnapshot('startup-session').exercises[0].sets[0].reps, 8);
  h.service.dispose();
});

test('deferred startup hydration uses current indexed paths and cannot replace a newer indexed body', async () => {
  const h = createHarness({ layoutReady: false, metadataInitialized: false });
  const workout = addStartupRecords(h);
  h.emitMetadata('resolved');
  const oldContent = h.contents.get(workout.path);
  const currentContent = writeWorkoutDataToNoteContent(oldContent, JSON.stringify({
    version: 1, exercises: [{ id: 'exercise', name: 'Bench press', sets: [{ id: 'set', reps: 12 }] }],
  }));
  let completeRead;
  h.plugin.app.vault.cachedRead = file => {
    h.cachedReadCalls.push(file.path);
    return new Promise(resolve => { completeRead = () => resolve(oldContent); });
  };
  h.finishLayout();
  assert.equal(h.service.isWorkoutIndexSettled(), false, 'pending legacy hydration protects workout controls');
  h.contents.set(workout.path, currentContent);
  h.emitMetadata('changed', workout, currentContent, { frontmatter: h.frontmatters.get(workout) });
  completeRead();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.cachedReadCalls, [workout.path]);
  assert.equal(h.service.getWorkoutSnapshot('startup-session').exercises[0].sets[0].reps, 12);
  assert.equal(h.service.isWorkoutIndexSettled(), true);
  assert.equal(h.contents.get(workout.path), currentContent, 'startup is read-only');
  h.service.dispose();
});

test('a deferred layout callback cannot hydrate after Health is unloaded', () => {
  const h = createHarness({ layoutReady: false, metadataInitialized: false });
  addStartupRecords(h);
  h.emitMetadata('resolved');
  h.service.dispose();
  h.plugin.scheduleWorkoutActionBars = () => { throw new Error('Disposed callback must not refresh controls'); };
  h.finishLayout();
  assert.deepEqual(h.cachedReadCalls, []);
  assert.equal(h.service.isWorkoutIndexSettled(), false);
});

const freshFoodEntry=()=>({id:'uncommitted-food-id',createdDate:'2026-09-23T12:00:00.000Z',completedDate:'2026-09-23T12:00:00.000Z',item:{id:'food',name:'Synthetic food',source:'manual'},quantity:0.5,unit:'serving',servingQuantity:50,servingUnit:'g',nutritionOverride:{calories:100,proteinG:5,fiberG:2},tags:['lunch']});

test('food logging uses fresh identity creation and returns the persisted ID and unchanged nutrients',async()=>{
 const h=createHarness();let freshCalls=0;const create=h.api.create;
 h.api.capabilities={freshIdentityCreates:true};
 h.api.create=async()=>{throw Error('Must not use the scanning create route');};
 h.api.createFresh=async function(kind,properties,options){
  freshCalls++;assert.equal(Object.hasOwn(options,'id'),false);
  assert.equal(options.cause.surface,'health-food-log');
  return create.call(this,kind,properties,{...options,id:'food-generated-uuid'});
 };
 const entry=freshFoodEntry(),record=await h.service.createFoodEntry(entry);
 assert.equal(freshCalls,1);assert.equal(entry.id,'food-generated-uuid');assert.equal(record.id,entry.id);
 assert.equal(record.frontmatter.quantity,50);assert.equal(record.frontmatter.unit,'g');
 assert.equal(record.frontmatter.calories,100);assert.equal(record.frontmatter.fiberG,2);
 assert.equal(h.service.getDailyFoodTotals('2026-09-23').calories,100);
});

test('older GCM retains the existing food ID when the optional fresh-create contract is unavailable',async()=>{
 for(const withCapability of [false,true]){
  const h=createHarness();h.api.capabilities={freshIdentityCreates:withCapability};
  const entry=freshFoodEntry();const record=await h.service.createFoodEntry(entry);
  assert.equal(record.id,'uncommitted-food-id');assert.equal(entry.id,record.id);
  assert.equal(h.createCalls[0].options.id,entry.id);
 }
});

test('fresh-create errors never fall through to a second food write',async()=>{
 const h=createHarness();let calls=0;
 h.api.capabilities={freshIdentityCreates:true};h.api.createFresh=async()=>{calls++;throw Error('Storage unavailable');};
 const entry=freshFoodEntry();
 await assert.rejects(h.service.createFoodEntry(entry),/Storage unavailable/);
 assert.equal(calls,1);assert.equal(h.createCalls.length,0);assert.equal(entry.id,'uncommitted-food-id');
});

test('new activity uses one fresh GCM identity without a cold vault scan', async () => {
  const h = createHarness();
  for (let index = 0; index < 10_000; index++) h.addLegacyFile(`Inbox/unrelated-${index}.md`, 'Body');
  const create = h.api.create;
  let coldScans = 0, freshCalls = 0;
  h.api.capabilities = { freshIdentityCreates: true };
  h.api.create = async () => { coldScans++; h.plugin.app.vault.getMarkdownFiles(); throw Error('Scanning create must not run'); };
  h.api.createFresh = async function (kind, properties, options) {
    freshCalls++;
    assert.equal(this, h.api);
    assert.equal(Object.hasOwn(options, 'id'), false);
    assert.equal(options.cause.surface, 'health-activity-log');
    return create.call(this, kind, properties, { ...options, id: 'persisted-activity-id' });
  };
  const entry = {
    id: 'uncommitted-activity-id', activity: 'Walk', activityType: 'walking',
    startedAt: '2026-09-29T12:00:00', completedDate: '2026-09-29T12:30:00',
    durationMinutes: 30, source: 'manual',
  };
  const record = await h.service.createActivityEntry(entry);
  assert.equal(freshCalls, 1);
  assert.equal(coldScans, 0);
  assert.equal(record.id, 'persisted-activity-id');
  assert.equal(entry.id, record.id, 'the activity returned to callers uses the persisted identity');
  assert.equal(h.service.getDailyActivityTotals('2026-09-29').durationMinutes, 30);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
  h.service.dispose();
});

test('activity creation keeps the supplied ID without a complete fresh contract and does not retry failures', async () => {
  for (const capability of [false, true]) {
    const h = createHarness();
    h.api.capabilities = { freshIdentityCreates: capability };
    const entry = {
      id: 'legacy-activity-id', activity: 'Walk', activityType: 'walking',
      startedAt: '2026-09-29T12:00:00', completedDate: '2026-09-29T12:30:00',
      durationMinutes: 30, source: 'manual',
    };
    const record = await h.service.createActivityEntry(entry);
    assert.equal(record.id, entry.id);
    assert.equal(h.createCalls.length, 1);
    assert.equal(h.createCalls[0].options.id, entry.id);
    h.service.dispose();
  }
  const h = createHarness();
  let freshCalls = 0;
  h.api.capabilities = { freshIdentityCreates: true };
  h.api.createFresh = async () => { freshCalls++; throw Error('Storage unavailable'); };
  const entry = {
    id: 'uncommitted-activity-id', activity: 'Walk', activityType: 'walking',
    startedAt: '2026-09-29T12:00:00', completedDate: '2026-09-29T12:30:00',
    durationMinutes: 30, source: 'manual',
  };
  await assert.rejects(h.service.createActivityEntry(entry), /Storage unavailable/);
  assert.equal(freshCalls, 1);
  assert.equal(h.createCalls.length, 0);
  assert.equal(entry.id, 'uncommitted-activity-id');
  h.service.dispose();
});


test('workout estimates survive set edits and real completion replaces them in either interval mode', async () => {
  for (const mode of ['duration', 'end']) {
    const { service, frontmatters } = createHarness({ settings: {
      defaultWorkoutEstimateMinutes: 90, workoutStartPropertyKey: 'began',
      workoutIntervalPropertyKey: 'interval', workoutIntervalMode: mode,
    } });
    const startedAt = '2026-08-24T12:00:00.000Z';
    const record = await service.createWorkoutSession({ title: 'Scheduled', startedAt }, `schedule-${mode}`);
    const estimated = mode === 'duration' ? 90 : '2026-08-24T13:30:00.000Z';
    assert.equal(record.frontmatter.interval, estimated);
    assert.equal(record.frontmatter.began, startedAt);
    assert.equal(Object.hasOwn(record.frontmatter, 'scheduled'), false);
    assert.equal(Object.hasOwn(record.frontmatter, 'timeEstimate'), false);
    await service.appendWorkoutSet(record.file, { id: 'set-schedule', exercise: 'Press', exercisePath: 'Exercises/Press.md', reps: 10 });
    assert.equal(frontmatters.get(record.file).interval, estimated, 'editing sets preserves the schedule');
    const after = await service.resolveWorkoutSession({ id: record.id });
    assert.equal(after.state, 'active');
    const snapshot = service.getWorkoutSnapshot(record.path);
    assert.equal(snapshot.endedAt, '');
    assert.equal(service.getDailyActivityEntries('2026-08-24')[0].durationMinutes, 0);
    assert.equal(service.getDailyActivityTotals('2026-08-24').durationMinutes, 0);
    const finished = await service.finishWorkout(record.file, { endedAt: '2026-08-24T12:22:30.000Z' });
    assert.equal(finished.frontmatter.interval, mode === 'duration' ? 22.5 : '2026-08-24T12:22:30.000Z');
    assert.equal(service.getDailyActivityTotals('2026-08-24').durationMinutes, 22.5);
  }
});


test('new workout bursts use one fresh create each and adopt the persisted identity', async () => {
  const h = createHarness();
  const create = h.api.create;
  let freshCalls = 0;
  h.api.capabilities = { freshIdentityCreates: true };
  h.api.create = async () => { throw Error('Unexpected scanning create'); };
  h.api.createFresh = async function (kind, properties, options) {
    assert.equal(this, h.api, 'API receiver is retained');
    assert.equal(Object.hasOwn(options, 'id'), false);
    assert.equal(options.cause.surface, 'health-workout-start');
    assert.equal(options.now.toISOString(), '2026-09-28T12:00:00.000Z');
    return create.call(this, kind, properties, { ...options, id: `fresh-workout-${++freshCalls}` });
  };
  for (let i = 0; i < 25; i++) {
    const record = await h.service.createWorkoutSession({ title: `Workout ${i}`, startedAt: '2026-09-28T12:00:00Z' }, `uncommitted-${i}`);
    assert.equal(record.id, `fresh-workout-${i + 1}`);
    assert.equal(record.frontmatter.status, 'active');
    assert.equal(record.frontmatter.scheduled, '2026-09-28T12:00:00Z');
    assert.equal(record.frontmatter.timeEstimate, 60);
    assert.deepEqual(record.frontmatter.session, workoutSessionPropertyValue([]));
    assert.equal(h.service.getWorkoutSnapshot(record.id).path, record.path);
  }
  assert.equal(freshCalls, 25);
  assert.equal(h.createCalls.length, 25);
  assert.deepEqual(h.readCalls, []);
  assert.deepEqual(h.cachedReadCalls, []);
});

for (const capability of [undefined, false, true, 'true']) {
  test(`workout creation preserves the legacy ID without the complete fresh contract (${capability})`, async () => {
    const h = createHarness();
    h.api.capabilities = { freshIdentityCreates: capability };
    if (capability !== true) h.api.createFresh = () => { throw Error('Unadvertised API must not run'); };
    const record = await h.service.createWorkoutSession({ title: 'Compatible workout' }, 'legacy-workout');
    assert.equal(h.createCalls.length, 1);
    assert.equal(h.createCalls[0].options.id, 'legacy-workout');
    assert.equal(record.id, 'legacy-workout');
  });
}

test('a failed fresh workout write rejects once without publishing an active snapshot or writing again', async () => {
  const h = createHarness();
  let calls = 0;
  h.api.capabilities = { freshIdentityCreates: true };
  h.api.createFresh = async () => { calls++; throw Error('Storage unavailable'); };
  await assert.rejects(h.service.createWorkoutSession({ title: 'Failed' }, 'uncommitted-workout'), /Storage unavailable/);
  assert.equal(calls, 1);
  assert.equal(h.createCalls.length, 0);
  assert.equal(h.service.getWorkoutSnapshot('uncommitted-workout'), null);
});
