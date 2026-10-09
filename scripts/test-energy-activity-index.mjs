import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const result = await build({
  stdin: {
    contents: 'export { HealthNativeRecordService } from "./native-records"; export { DEFAULT_SETTINGS } from "./types"; export { decodeNativeRecordFrontmatter } from "./native-record-schema";',
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{
    name: 'energy-index-obsidian',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'energy-index-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'energy-index-test' }, () => ({
        loader: 'js',
        contents: `
          export class TFile {
            static [Symbol.hasInstance](value) { return Boolean(value && value.extension && value.path); }
          }
          export function getFrontMatterInfo(content) {
            const match = content.match(/^---\\s*\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/);
            return match ? { exists: true, frontmatter: match[1] } : { exists: false, frontmatter: '' };
          }
          export function parseYaml(value) {
            return Object.fromEntries(value.split(/\\r?\\n/).flatMap(line => {
              const match = line.match(/^([A-Za-z0-9_-]+):\\s*(.*)$/);
              if (!match) return [];
              const raw = match[2].trim();
              return [[match[1], raw.startsWith('[') ? JSON.parse(raw) : /^-?\\d+(?:\\.\\d+)?$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw]];
            }));
          }
        `,
      }));
    },
  }],
});
const { HealthNativeRecordService, DEFAULT_SETTINGS, decodeNativeRecordFrontmatter } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

const day = '2032-01-03';
const selector = {
  energyEstimateMode: 'activity-notes',
  energyActivityIdentificationMode: 'property',
  energyActivityPropertyKey: 'kind',
  energyActivityPropertyValue: 'movement',
  energyActivityTag: '',
  energyActivityCaloriesPropertyKey: 'burnKcal',
  energyActivityDatePropertyKey: 'happenedAt',
};

function harness(options = {}) {
  const files = new Map(), caches = new Map();
  const events = { metadata: new Map(), vault: new Map(), workspace: new Map() };
  const counts = { inventories: 0, metadata: 0, raw: 0, cached: 0, writes: 0 };
  const on = owner => (name, callback) => {
    const listeners = events[owner].get(name) || [];
    listeners.push(callback); events[owner].set(name, listeners); return {};
  };
  const api = {
    version: 6,
    isEnabled: () => true,
    inspect: fm => fm?.tpsId && fm.tpsSchemaVersion === 1
      ? { id: fm.tpsId, schemaVersion: 1, kind: fm.kind, frontmatter: fm }
      : null,
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, ...selector, ...options.settings },
    manifest: { id: 'tps-health' },
    app: {
      workspace: { on: on('workspace'), layoutReady: options.layoutReady ?? true, onLayoutReady: callback => callback() },
      metadataCache: {
        on: on('metadata'), initialized: options.initialized ?? true,
        getFileCache: file => { counts.metadata++; return caches.get(file) ?? null; },
      },
      vault: {
        on: on('vault'),
        getMarkdownFiles: () => { counts.inventories++; return [...files.values()]; },
        getAbstractFileByPath: path => files.get(path) ?? null,
        read: async () => { counts.raw++; throw new Error('Unexpected raw read'); },
        cachedRead: async () => { counts.cached++; throw new Error('Unexpected body read'); },
        process: async () => { counts.writes++; throw new Error('Unexpected write'); },
      },
      fileManager: { processFrontMatter: async () => { counts.writes++; throw new Error('Unexpected frontmatter write'); } },
    },
    registerEvent: () => {}, scheduleWorkoutActionBars: () => {},
    getGcmNativeRecordsApi: () => options.noProvider ? null : api,
  };
  const service = new HealthNativeRecordService(plugin);
  const add = (path, frontmatter, inlineTags = []) => {
    const file = { path, extension: 'md', basename: path.split('/').at(-1).replace(/\.md$/u, ''), name: path.split('/').at(-1) };
    files.set(path, file);
    caches.set(file, { frontmatter, tags: inlineTags.map(tag => ({ tag })) });
    return file;
  };
  const emit = (owner, name, ...args) => { for (const callback of events[owner].get(name) || []) callback(...args); };
  const settle = async () => {
    for (let attempts = 0; service.discoveryPass && attempts < 100; attempts++) await service.discoveryPass.completion;
    assert.equal(service.discoveryPass, null, 'the finite discovery completed');
  };
  const change = (file, frontmatter, inlineTags = []) => {
    const cache = { frontmatter, tags: inlineTags.map(tag => ({ tag })) };
    caches.set(file, cache); emit('metadata', 'changed', file, undefined, cache);
  };
  const reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
  const rename = (file, nextPath) => {
    const oldPath = file.path; files.delete(oldPath); file.path = nextPath; files.set(nextPath, file);
    emit('vault', 'rename', file, oldPath);
  };
  return { service, plugin, api, files, caches, counts, add, emit, settle, change, reset, rename };
}

function activity(burnKcal = 100, happenedAt = day) {
  return { kind: 'movement', burnKcal, happenedAt };
}
function expectNoIO(h, expectedInventories = 0) {
  assert.deepEqual(h.counts, { inventories: expectedInventories, metadata: h.counts.metadata, raw: 0, cached: 0, writes: 0 });
}

test('arbitrary property-selected notes need no native identity and count once per path', async () => {
  const h = harness();
  h.add('Inbox/walk.md', activity(120));
  h.add('Inbox/lift.md', { ...activity(230), kind: ['movement', 'movement'] });
  h.add('Inbox/tomorrow.md', activity(900, '2032-01-04'));
  h.add('Inbox/unrelated.md', { ...activity(1000), kind: 'food' });
  h.service.setup(); await h.settle();
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 350, entryCount: 2 });
  assert.equal(h.service.recordsByPath.size, 0, 'projections never invent native identities');
  assert.equal(h.counts.metadata, 4, 'initial discovery uses one supplied cache per file');
  expectNoIO(h, 1);
  h.service.dispose();
});

test('native and arbitrary matches share one read-only energy total without adding native totals again', async () => {
  const h = harness({ settings: { energyActivityPropertyValue: 'activity-entry', energyActivityCaloriesPropertyKey: 'caloriesBurned', energyActivityDatePropertyKey: 'completedDate' } });
  h.add('Inbox/native.md', { tpsId: 'walk', tpsSchemaVersion: 1, kind: 'activity-entry', completedDate: day, caloriesBurned: 125 });
  h.add('Inbox/plain.md', { kind: ['activity-entry'], completedDate: day, caloriesBurned: 75 });
  h.service.setup(); await h.settle();
  assert.equal(h.service.getDailyActivityTotals(day).caloriesBurned, 125);
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 200, entryCount: 2 });
  expectNoIO(h, 1);
  h.service.dispose();
});

test('decoded native handle aliases cannot authorize activity matching or replace accepted physical evidence', async () => {
  const h = harness({ settings: {
    energyActivityPropertyValue: 'activity-entry', energyActivityCaloriesPropertyKey: 'caloriesBurned',
    energyActivityDatePropertyKey: 'completedDate',
    nativeRecordProperties: { ...DEFAULT_SETTINGS.nativeRecordProperties, caloriesBurned: 'burnKcal' },
  } });
  const raw = { tpsId: 'walk', tpsSchemaVersion: 1, kind: 'activity-entry', completedDate: day, burnKcal: 125 };
  const file = h.add('Inbox/native.md', raw); h.service.setup(); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).entryCount, 0, 'configured canonical alias is absent from source');
  const handle = frontmatter => ({ file, path: file.path, id: raw.tpsId, kind: raw.kind,
    frontmatter: decodeNativeRecordFrontmatter(h.plugin.settings, frontmatter) });
  assert.equal(handle(raw).frontmatter.caloriesBurned, 125, 'the actual native decoder introduces this alias');
  h.reset(); h.service.trackHandle(handle(raw));
  assert.equal(h.service.getDailyEnergyActivityTotals(day).entryCount, 0, 'a native update must not invent physical field presence');
  assert.equal(h.counts.metadata, 0, 'tracking a decoded handle needs no energy protection lookup');
  expectNoIO(h);
  h.plugin.settings.energyActivityCaloriesPropertyKey = 'burnKcal'; h.service.refreshConfiguration(); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 125);
  h.reset(); const next = { ...raw, burnKcal: 250 }; h.service.trackHandle(handle(next));
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 125, 'retain last accepted physical projection until metadata arrives');
  assert.equal(h.counts.metadata, 0);
  h.change(file, next);
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 250, 'physical metadata publishes the committed measurement');
  expectNoIO(h); h.service.dispose();
});

test('frontmatter and inline tag descendants match with no body reads and no duplicate entries', async () => {
  const h = harness({ settings: { energyActivityIdentificationMode: 'tag', energyActivityTag: '#Activity' } });
  h.add('Inbox/walk.md', { ...activity(120), tags: ['activity/walk', '#activity'] }, ['#activity/walk']);
  h.add('Inbox/lift.md', activity(80), ['#ACTIVITY/lift']);
  h.add('Inbox/unrelated.md', activity(900), ['#activityElse']);
  h.service.setup(); await h.settle();
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 200, entryCount: 2 });
  h.reset(); h.change(h.files.get('Inbox/lift.md'), activity(80), ['#somethingElse']);
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 120);
  expectNoIO(h);
  h.service.dispose();
});

test('unchanged metadata bursts and repeated date displays cause zero IO or redundant energy notifications', async () => {
  const h = harness(); const file = h.add('Inbox/walk.md', activity());
  h.service.setup(); await h.settle();
  const changes = []; h.service.onRecordsChanged(change => changes.push(change)); h.reset();
  for (let index = 0; index < 200; index++) {
    h.change(file, { ...activity(index % 2 ? '100' : 100), title: `Edit ${index}` });
    assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 100);
  }
  assert.deepEqual(changes, []);
  assert.equal(h.counts.metadata, 0, 'accepted event cache is reused');
  expectNoIO(h); h.service.dispose();
});

test('source edits invalidate old and new dates and source removals drop only the affected projection', async () => {
  const h = harness(); const file = h.add('Inbox/walk.md', activity());
  h.add('Inbox/lift.md', activity(200)); h.service.setup(); await h.settle();
  const changes = []; h.service.onRecordsChanged(change => changes.push(change)); h.reset();
  h.change(file, activity(150, '2032-01-04'));
  assert.deepEqual(changes.at(-1), { path: file.path, kinds: ['activity-entry'], dates: [day, '2032-01-04'] });
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 200);
  assert.equal(h.service.getDailyEnergyActivityTotals('2032-01-04').caloriesBurned, 150);
  h.change(file, { ...activity(150, '2032-01-04'), kind: 'other' });
  assert.equal(h.service.getDailyEnergyActivityTotals('2032-01-04').entryCount, 0);
  assert.equal(h.service.energyActivityPathsByDate.has('2032-01-04'), false);
  const second = h.files.get('Inbox/lift.md'); h.files.delete(second.path); h.emit('vault', 'delete', second);
  assert.equal(h.service.getDailyEnergyActivityTotals(day).entryCount, 0);
  assert.equal(h.service.energyActivityPathsByDate.size, 0);
  expectNoIO(h); h.service.dispose();
});

test('configured archive exclusion and malformed or missing measurements do not contribute', async () => {
  const h = harness({ settings: { nativeRecordProperties: { ...DEFAULT_SETTINGS.nativeRecordProperties, archived: 'retired' } } });
  const valid = h.add('Inbox/valid-zero.md', activity(0));
  for (const [index, invalid] of [undefined, null, true, -1, 'not a number', Infinity].entries()) h.add(`Inbox/invalid-${index}.md`, { ...activity(), burnKcal: invalid });
  h.add('Inbox/retired.md', { ...activity(500), retired: true });
  h.add('Inbox/no-date.md', { kind: 'movement', burnKcal: 500 });
  h.add('Inbox/bad-date.md', activity(500, 'not a date'));
  h.service.setup(); await h.settle();
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 0, entryCount: 1 });
  h.change(valid, { ...activity(100), retired: true });
  assert.equal(h.service.getDailyEnergyActivityTotals(day).entryCount, 0);
  expectNoIO(h, 1); h.service.dispose();
});

test('missing metadata preserves accepted totals while pending and resolves incrementally', async () => {
  const h = harness(); const file = h.add('Inbox/walk.md', activity(200));
  h.service.setup(); await h.settle(); h.caches.delete(file);
  h.service.refreshConfiguration(); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 200);
  assert.equal(h.service.getDailyIndexStatus(), 'partial');
  h.reset(); h.change(file, activity(250)); h.emit('metadata', 'resolved'); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 250);
  assert.equal(h.service.getDailyIndexStatus(), 'ready');
  expectNoIO(h); h.service.dispose();
});

test('an unproven empty day stays unknown during partial indexing while accepted matching dates remain visible', async () => {
  const h = harness();
  h.add('Inbox/food.md', { tpsId: 'food', tpsSchemaVersion: 1, kind: 'food-entry', completedDate: day, calories: 200 });
  h.add('Inbox/known-activity.md', activity(125, '2032-01-02'));
  const pending = h.add('Inbox/unknown-activity.md', activity(500)); h.caches.delete(pending);
  h.service.setup(); await h.settle();
  assert.equal(h.service.getDailyIndexStatus(), 'partial');
  assert.equal(h.service.getDailyFoodTotals(day).calories, 200, 'a mounted overview has accepted food evidence');
  assert.equal(h.service.getDailyEnergyActivityTotals(day), null, 'unknown metadata cannot prove no activity');
  assert.equal(h.service.getDailyEnergyActivityTotals('2032-01-02').caloriesBurned, 125, 'retain accepted activity while other evidence is pending');
  h.reset(); h.change(pending, { kind: 'reference' });
  assert.equal(h.service.getDailyIndexStatus(), 'ready');
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 0, entryCount: 0 });
  assert.equal(h.counts.metadata, 0);
  expectNoIO(h); h.service.dispose();
});

for (const missingCache of [false, true]) test(`rename moves only the accepted path without body reads (${missingCache ? 'unknown' : 'known'} cache)`, async () => {
  const h = harness(); const file = h.add('Inbox/walk.md', activity(200));
  h.service.setup(); await h.settle();
  if (missingCache) h.caches.delete(file);
  const changes = []; h.service.onRecordsChanged(change => changes.push(change)); h.reset();
  h.rename(file, 'Inbox/renamed.md');
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 200);
  assert.equal(h.service.energyActivitiesByPath.has('Inbox/walk.md'), false);
  assert.equal(h.service.energyActivitiesByPath.has('Inbox/renamed.md'), true);
  assert.deepEqual(changes, [{ path: 'Inbox/renamed.md', kinds: ['activity-entry'], dates: [day] }]);
  if (missingCache) {
    assert.equal(h.service.getDailyIndexStatus(), 'partial');
    h.change(file, activity(200)); h.emit('metadata', 'resolved'); await h.settle();
    assert.equal(h.service.getDailyIndexStatus(), 'ready');
  }
  expectNoIO(h); h.service.dispose();
});

test('stale source and delete events cannot overwrite a replacement file at the same path', async () => {
  const h = harness(); const old = h.add('Inbox/walk.md', activity(200));
  h.service.setup(); await h.settle();
  const current = h.add(old.path, activity(350)); h.change(current, activity(350)); h.reset();
  h.emit('metadata', 'changed', old, undefined, { frontmatter: activity(900) });
  h.emit('vault', 'delete', old);
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 350);
  expectNoIO(h); h.service.dispose();
});

test('a stale rename cannot replace accepted destination evidence with an obsolete object cache', async () => {
  const h = harness(); const old = h.add('Inbox/walk.md', activity(200));
  h.service.setup(); await h.settle();
  h.rename(old, 'Inbox/renamed.md');
  const current = h.add('Inbox/renamed.md', activity(350)); h.change(current, activity(350));
  const changes = []; h.service.onRecordsChanged(change => changes.push(change)); h.reset();
  h.emit('vault', 'rename', old, 'Inbox/walk.md');
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 350);
  assert.equal(h.service.energyActivitiesByPath.get(current.path).file, current);
  assert.equal(h.service.energyActivitiesByPath.has('Inbox/walk.md'), false);
  assert.deepEqual(changes, []);
  assert.equal(h.counts.metadata, 0, 'reject the stale object before reading its cache');
  expectNoIO(h); h.service.dispose();
});

test('a changed selector reuses one metadata discovery and leaving activity mode clears all projections', async () => {
  const h = harness(); h.add('Inbox/walk.md', activity(200));
  h.add('Inbox/lift.md', { ...activity(300), kind: 'exercise' });
  h.service.setup(); await h.settle(); h.reset();
  h.plugin.settings.energyActivityPropertyValue = 'exercise'; h.service.refreshConfiguration(); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 300);
  expectNoIO(h, 1); h.reset();
  h.plugin.settings.energyEstimateMode = 'fixed'; h.service.refreshConfiguration(); await h.settle();
  assert.equal(h.service.energyActivitiesByPath.size, 0);
  assert.equal(h.service.energyActivityPathsByDate.size, 0);
  assert.equal(h.service.getDailyEnergyActivityTotals(day), null);
  expectNoIO(h, 1); h.service.dispose();
});

test('cold startup waits for metadata and then discovers once, including earlier source bursts', async () => {
  const h = harness({ initialized: false, layoutReady: false });
  const file = h.add('Inbox/walk.md', activity(200)); h.service.setup();
  assert.equal(h.counts.inventories, 0);
  h.change(file, activity(350)); h.emit('metadata', 'resolved'); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 350);
  expectNoIO(h, 1); h.service.dispose();
});

test('activity metadata projection does not require the native-record mutation provider', async () => {
  const h = harness({ noProvider: true }); h.add('Inbox/walk.md', activity(200));
  h.service.setup(); await h.settle();
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 200);
  assert.equal(h.service.recordsByPath.size, 0);
  expectNoIO(h, 1); h.service.dispose();
});

test('provider loss leaves finite energy discovery running and repeated provider events do not add inventories', async () => {
  const previousScheduler = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  let release;
  Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: { yield: () => new Promise(resolve => { release = resolve; }) } });
  const h = harness();
  try {
    for (let index = 0; index < 600; index++) h.add(`Inbox/activity-${index}.md`, activity(1));
    h.service.setup();
    const pass = h.service.discoveryPass;
    assert.ok(pass && release, 'discovery is paused at its existing cooperative boundary');
    h.plugin.getGcmNativeRecordsApi = () => null;
    h.emit('workspace', 'tps:gcm-api-changed', { source: 'tps-global-context-menu', available: false });
    assert.equal(h.service.discoveryPass, pass, 'provider loss cannot cancel independent energy work');
    if (previousScheduler) Object.defineProperty(globalThis, 'scheduler', previousScheduler); else delete globalThis.scheduler;
    release(); await h.settle();
    assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 600, entryCount: 600 });
    assert.equal(h.service.getDailyIndexStatus(), 'partial', 'native food authority is honestly unavailable');
    expectNoIO(h, 1); h.reset();
    for (let index = 0; index < 20; index++) h.emit('workspace', 'tps:gcm-api-changed', { source: 'tps-global-context-menu', available: false });
    expectNoIO(h);
    h.plugin.getGcmNativeRecordsApi = () => h.api;
    h.emit('workspace', 'tps:gcm-api-changed', { source: 'tps-global-context-menu', available: true });
    await h.settle();
    assert.equal(h.service.getDailyIndexStatus(), 'ready');
    expectNoIO(h, 1); h.reset();
    for (let index = 0; index < 20; index++) h.emit('workspace', 'tps:gcm-api-changed', { source: 'tps-global-context-menu', available: true });
    expectNoIO(h);
    assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 600);
  } finally {
    if (previousScheduler) Object.defineProperty(globalThis, 'scheduler', previousScheduler); else delete globalThis.scheduler;
    h.service.dispose();
  }
});

test('a representative 4,049-note startup and repeated date displays have no source IO, writes or repeated inventories', async () => {
  const h = harness();
  for (let index = 0; index < 4049; index++) h.add(`Inbox/note-${index}.md`, index < 3 ? activity(100) : { title: `Reference ${index}` });
  h.service.setup();
  assert.equal(h.service.getDailyEnergyActivityTotals('2032-01-04'), null, 'an in-flight full discovery cannot prove an empty day');
  const accepted = h.service.energyActivitiesByPath.size;
  assert.ok(accepted > 0, 'the first bounded slice accepts matching evidence');
  assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, accepted * 100, 'already accepted matches survive the pending full pass');
  await h.settle();
  assert.equal(h.counts.metadata, 4049);
  expectNoIO(h, 1); h.reset();
  let projectionsRead = 0;
  const get = h.service.energyActivitiesByPath.get;
  h.service.energyActivitiesByPath.get = function (path) { projectionsRead++; return get.call(this, path); };
  for (let index = 0; index < 100; index++) {
    assert.equal(h.service.getDailyEnergyActivityTotals(day).caloriesBurned, 300);
    assert.equal(h.service.getDailyEnergyActivityTotals('2032-01-04').entryCount, 0);
  }
  assert.equal(projectionsRead, 300, 'each visible day reads only its three indexed matches');
  assert.equal(h.counts.metadata, 0);
  expectNoIO(h); h.service.dispose();
});

test('other TDEE modes perform no projection work and disposal prevents late metadata work', async () => {
  for (const mode of ['fixed', 'calculated']) {
    const h = harness({ settings: { energyEstimateMode: mode } }); h.add('Inbox/walk.md', activity(200));
    h.service.setup(); await h.settle();
    assert.equal(h.service.energyActivitiesByPath.size, 0);
    assert.equal(h.service.getDailyEnergyActivityTotals(day), null);
    expectNoIO(h, 1); h.service.dispose();
  }
  const h = harness(); const file = h.add('Inbox/walk.md', activity(200)); h.service.setup(); await h.settle();
  h.service.dispose(); h.reset(); h.change(file, activity(900));
  assert.equal(h.service.energyActivitiesByPath.size, 0);
  assert.equal(h.service.getDailyEnergyActivityTotals(day), null);
  expectNoIO(h);
});

test('invalid source configuration is unknown while a valid empty day is explicitly measured zero', async () => {
  const h = harness(); h.service.setup(); await h.settle(); h.reset();
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 0, entryCount: 0 });
  for (const invalid of [
    { energyActivityIdentificationMode: 'unknown' },
    { energyActivityPropertyKey: '' },
    { energyActivityPropertyValue: '' },
    { energyActivityCaloriesPropertyKey: '' },
    { energyActivityDatePropertyKey: '' },
    { energyActivityIdentificationMode: 'tag', energyActivityTag: '' },
    { energyActivityIdentificationMode: 'tag', energyActivityTag: 'activity another' },
  ]) {
    Object.assign(h.plugin.settings, selector, invalid);
    assert.equal(h.service.getDailyEnergyActivityTotals(day), null, 'invalid selectors cannot invent a BMR-only baseline');
  }
  Object.assign(h.plugin.settings, selector);
  assert.deepEqual(h.service.getDailyEnergyActivityTotals(day), { dateIso: day, caloriesBurned: 0, entryCount: 0 });
  assert.equal(h.counts.metadata, 0);
  expectNoIO(h); h.service.dispose();
  assert.equal(h.service.getDailyEnergyActivityTotals(day), null);
});
