import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

// Reuse the actual-modal host harness without registering its existing tests.
// Providers, catalog and DOM are synthetic; no runtime, disk or user data is used.
const modalUrl = new URL('./test-food-search-unified.mjs', import.meta.url);
globalThis.__TPSUsageSearchEsbuild = esbuild;
const modalSource = readFileSync(modalUrl, 'utf8')
  .replace('import test from "node:test";', 'const test = () => {};')
  .replace('import * as esbuild from "esbuild";', 'const esbuild = globalThis.__TPSUsageSearchEsbuild;');
const modalModule = await esbuild.transform(modalSource + '\nexport { setup, turn, titles, walk, food };', {
  format: 'esm', define: { 'import.meta.url': JSON.stringify(modalUrl.href) },
});
const { setup, turn, titles, walk, food } = await import(`data:text/javascript;base64,${Buffer.from(modalModule.code).toString('base64')}`);
const nativeUrl = new URL('./test-native-records.mjs', import.meta.url);
const nativeSource = readFileSync(nativeUrl, 'utf8').split('const providerEvent =')[0]
  .replace("import test from 'node:test';", 'const test = () => {};')
  .replace("import { build } from 'esbuild';", 'const { build } = globalThis.__TPSUsageSearchEsbuild;');
const nativeModule = await esbuild.transform(nativeSource + '\nexport { createHarness };', {
  format: 'esm', define: { 'import.meta.url': JSON.stringify(nativeUrl.href) },
});
const { createHarness } = await import(`data:text/javascript;base64,${Buffer.from(nativeModule.code).toString('base64')}`);
delete globalThis.__TPSUsageSearchEsbuild;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function fixture(size = 37) {
  const { tray, plugin } = await setup();
  const native = createHarness({ deferSetup: true });
  const calls = { materializations: 0, visits: 0, links: 0, inventory: 0, metadata: 0, reads: 0, providers: 0 };
  for (let index = 0; index < 10; index++) {
    const path = `Foods/Food ${index}.md`;
    native.addFrontmatterFile(path, { title: `Food ${index}`, calories: 100 });
    native.service.foodDefinitionsByPath.set(path, { title: `Food ${index}`, calories: 100 });
  }
  const paths = new Set();
  for (let index = 0; index < size; index++) {
    const path = `Entries/Entry ${index}.md`;
    const frontmatter = { food: `[[Foods/Food ${index % 10}]]`, completedDate: '2026-10-06T12:00:00' };
    const file = native.addFrontmatterFile(path, frontmatter);
    native.service.recordsByPath.set(path, { file, id: `entry-${index}`, kind: 'food-entry', frontmatter, dailyDates: ['2026-10-06'] });
    paths.add(path);
  }
  native.service.pathsByKind.set('food-entry', paths);
  native.plugin.app.metadataCache.getFirstLinkpathDest = path => {
    calls.links++;
    return native.files.get(path.endsWith('.md') ? path : `${path}.md`) || null;
  };
  const originalGet = native.service.recordsByPath.get;
  native.service.recordsByPath.get = function (path) { calls.visits++; return originalGet.call(this, path); };
  const originalUsage = native.service.getFoodUsageEntries;
  native.service.getFoodUsageEntries = function () { calls.materializations++; return originalUsage.call(this); };
  plugin.nativeRecordService = native.service;
  plugin.getLoggedFoodStats = Object.getPrototypeOf(plugin).getLoggedFoodStats;
  plugin.getLocalFoodIndex = () => ({ items: [food('Usageqa saved')] });
  plugin.searchCustomFoods = async () => [food('Usageqa saved')];
  plugin.searchUsdaFoods = async () => { calls.providers++; return [food('Usageqa database')]; };
  plugin.searchOpenFoodFacts = async () => assert.fail('Disabled branded provider must not run');
  plugin.settings.includeBrandedFoodSearch = false;
  for (const app of [plugin.app, native.plugin.app]) {
    app.vault.getMarkdownFiles = () => { calls.inventory++; assert.fail('Search must not inventory the vault'); };
    app.metadataCache.getFileCache = () => { calls.metadata++; assert.fail('Usage must use its existing native projection'); };
    for (const key of ['read', 'cachedRead']) app.vault[key] = () => { calls.reads++; assert.fail('Search must not read source'); };
  }
  const inputs = { local: [], online: [] };
  const localSearch = plugin.searchLocalFoods, onlineSearch = plugin.searchFoods;
  plugin.searchLocalFoods = function (query, stats) { inputs.local.push(stats); return localSearch.call(this, query, stats); };
  plugin.searchFoods = function (query, stats, shouldContinue) { inputs.online.push(stats); return onlineSearch.call(this, query, stats, shouldContinue); };
  return { tray, plugin, native, calls, inputs, paths,
    close() { tray.onClose(); native.service.dispose(); } };
}

for (const size of [37, 1000, 10000]) {
  test(`one submitted query materializes ${size} native logs once for both branches`, async t => {
    const f = await fixture(size); t.after(() => f.close());
    f.tray.submitOnlineSearch('usageqa'); await turn(); await turn();
    assert.equal(f.tray.onlineSearchActive, false);
    assert.deepEqual(f.calls, { materializations: 1, visits: size, links: size, inventory: 0, metadata: 0, reads: 0, providers: 1 });
    assert.equal(f.inputs.local.length, 1); assert.equal(f.inputs.online.length, 1);
    assert.ok(f.inputs.local[0], 'Both branches must receive the submitted request snapshot');
    assert.equal(f.inputs.local[0], f.inputs.online[0]);
    assert.deepEqual(titles(f.tray), ['Usageqa saved', 'Usageqa database']);
  });
}

test('each independent submission rematerializes current usage instead of retaining a cache', async t => {
  const f = await fixture(2); t.after(() => f.close());
  f.tray.submitOnlineSearch('usageqa'); await turn(); await turn();
  const first = await f.inputs.online[0];
  f.paths.clear();
  f.tray.submitOnlineSearch('usageqa'); await turn(); await turn();
  const second = await f.inputs.online[1];
  assert.equal(f.calls.materializations, 2, 'Exactly one fresh materialization per accepted submission');
  assert.notEqual(first, second, 'A previous submission is not a persistent cache');
  assert.ok(first.size > 0); assert.equal(second.size, 0, 'A deleted log is absent from the next submitted query');
});

test('typed local search and later explicit submission each read their own current history', async t => {
  const f = await fixture(2); t.after(() => f.close());
  const timers = new Map(); let timerId = 0;
  window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  const snapshots = [], getStats = f.plugin.getLoggedFoodStats;
  f.plugin.getLoggedFoodStats = function (...args) {
    const stats = getStats.apply(this, args); snapshots.push(stats); return stats;
  };
  f.tray.queueSearch('usageqa');
  const [localId, local] = [...timers].find(([, timer]) => timer.delay === 100);
  timers.delete(localId); local.callback(); await turn();
  assert.equal(f.calls.materializations, 1); assert.equal(f.calls.providers, 0);
  f.paths.clear();
  assert.equal(timers.size, 0, 'Typing schedules no online submission');
  f.tray.submitOnlineSearch('usageqa'); await turn(); await turn();
  assert.equal(f.calls.materializations, 2, 'The explicit submission is not the earlier typed-local snapshot');
  assert.equal(f.calls.providers, 1); assert.equal(f.inputs.local.length, 2); assert.equal(f.inputs.online.length, 1);
  assert.ok((await snapshots[0]).size > 0); assert.equal((await snapshots[1]).size, 0);
  assert.equal(f.inputs.local[1], f.inputs.online[0]);
  assert.equal(f.tray.onlineSearchActive, false); assert.deepEqual(titles(f.tray), ['Usageqa saved', 'Usageqa database']);
});

test('shared pending history does not serialize provider startup behind local ranking', async t => {
  const f = await fixture(0); t.after(() => f.close());
  const history = deferred(); let historyRequests = 0;
  f.plugin.getLoggedFoodStats = () => { historyRequests++; return history.promise; };
  f.tray.submitOnlineSearch('usageqa');
  assert.equal(f.calls.providers, 1, 'The online provider starts before history settles');
  assert.equal(f.inputs.local.length, 1); assert.equal(f.inputs.online.length, 1);
  assert.equal(f.tray.onlineSearchActive, true); assert.equal(f.tray.searchButtonEl.disabled, true);
  assert.equal(f.tray.statusEl.attributes['aria-busy'], 'true');
  history.resolve(new Map()); await turn(); await turn();
  assert.equal(historyRequests, 1);
  assert.equal(f.tray.onlineSearchActive, false); assert.equal(f.tray.searchButtonEl.disabled, false);
  assert.equal(f.tray.statusEl.attributes['aria-busy'], 'false');
  assert.deepEqual(titles(f.tray), ['Usageqa saved', 'Usageqa database']);
});

test('completed combined results still reject a slower local result', async t => {
  const f = await fixture(0); t.after(() => f.close());
  const local = deferred();
  f.plugin.searchLocalFoods = () => local.promise;
  f.plugin.searchFoods = async () => [food('All results')];
  f.tray.submitOnlineSearch('food'); await turn();
  assert.deepEqual(titles(f.tray), ['All results']);
  local.resolve([food('Late local')]); await turn();
  assert.deepEqual(titles(f.tray), ['All results']);
});

test('a new queued query invalidates pending local and combined results', async t => {
  const f = await fixture(0); t.after(() => f.close());
  const history = deferred();
  f.plugin.getLoggedFoodStats = () => history.promise;
  const timers = new Map(); let timerId = 0;
  window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  f.tray.submitOnlineSearch('old food');
  f.tray.queueSearch('next food');
  const token = f.tray.searchToken, status = f.tray.statusEl.text;
  history.resolve(new Map()); await turn(); await turn();
  assert.equal(f.tray.searchToken, token); assert.deepEqual(titles(f.tray), []);
  assert.equal(f.tray.statusEl.text, status); assert.equal(f.tray.onlineSearchActive, false);
});

test('closing while history is pending rejects all stale display work', async t => {
  const f = await fixture(0); t.after(() => f.native.service.dispose());
  const history = deferred(); f.plugin.getLoggedFoodStats = () => history.promise;
  f.tray.submitOnlineSearch('food'); f.tray.onClose();
  const status = f.tray.statusEl.text;
  history.resolve(new Map()); await turn(); await turn();
  assert.equal(f.tray.contentEl.children.length, 0); assert.deepEqual(titles(f.tray), []);
  assert.equal(f.tray.statusEl.text, status); assert.equal(f.tray.searchButtonEl, null);
});

test('tab changes retain current loading state when old history settles', async t => {
  const f = await fixture(0); t.after(() => f.close());
  const history = deferred(); f.plugin.getLoggedFoodStats = () => history.promise;
  f.tray.submitOnlineSearch('food');
  walk(f.tray.contentEl).find(node => node.className === 'tps-health-food-tab' && node.text === 'Describe').listeners.get('click')();
  const status = f.tray.statusEl.text;
  history.resolve(new Map()); await turn(); await turn();
  assert.equal(f.tray.activeFoodLogTab, 'describe'); assert.deepEqual(titles(f.tray), []);
  assert.equal(f.tray.statusEl.text, status); assert.equal(f.tray.onlineSearchActive, false);
  assert.equal(f.tray.statusEl.attributes['aria-busy'], 'false');
});

test('online failure preserves saved matches and clears the existing loading state', async t => {
  const f = await fixture(0); t.after(() => f.close());
  const online = deferred(); f.plugin.searchFoods = () => online.promise;
  f.tray.submitOnlineSearch('usageqa'); await turn();
  assert.deepEqual(titles(f.tray), ['Usageqa saved']);
  online.reject(new Error('Synthetic provider failure')); await turn();
  assert.deepEqual(titles(f.tray), ['Usageqa saved']);
  assert.match(f.tray.statusEl.text, /Online search failed/);
  assert.equal(f.tray.onlineSearchActive, false); assert.equal(f.tray.searchButtonEl.disabled, false);
  assert.equal(f.tray.statusEl.attributes['aria-busy'], 'false');
});

test('shared history rejection is owned by both branches without leaving search busy', async t => {
  const f = await fixture(0); t.after(() => f.close());
  const history = deferred(); let historyRequests = 0;
  f.plugin.getLoggedFoodStats = () => { historyRequests++; return history.promise; };
  const runLocal = f.tray.runLocalSearch;
  const runOnline = f.tray.runOnlineSearch;
  let localPending, onlinePending;
  f.tray.runLocalSearch = function (...args) {
    localPending = runLocal.apply(this, args);
    // Observe the actual fire-and-forget method without making a baseline
    // rejection escape Node's test runner before we can assert ownership.
    void localPending.catch(() => {});
    return localPending;
  };
  f.tray.runOnlineSearch = function (...args) {
    onlinePending = runOnline.apply(this, args);
    void onlinePending.catch(() => {});
    return onlinePending;
  };
  f.tray.submitOnlineSearch('usageqa');
  assert.ok(localPending); assert.ok(onlinePending, 'Both branches start before history can reject');
  assert.equal(historyRequests, 1);
  assert.equal(f.inputs.local[0], history.promise); assert.equal(f.inputs.online[0], history.promise);
  history.reject(new Error('Synthetic history failure')); await turn(); await turn();
  assert.equal(f.tray.onlineSearchActive, false); assert.equal(f.tray.searchButtonEl.disabled, false);
  assert.equal(f.tray.statusEl.attributes['aria-busy'], 'false');
  assert.match(f.tray.statusEl.text, /Online search failed/);
  await assert.doesNotReject(Promise.all([localPending, onlinePending]), 'Both launched branches must own their rejection');
});

test('minimum length, barcode and already-running guards do not start extra history requests', async t => {
  const f = await fixture(0); t.after(() => f.close());
  let historyRequests = 0, barcode = null;
  f.plugin.getLoggedFoodStats = async () => { historyRequests++; return new Map(); };
  f.tray.handleBarcodeAdd = async value => { barcode = value; };
  f.tray.submitOnlineSearch('x'); f.tray.submitOnlineSearch('4006381333931');
  f.tray.onlineSearchActive = true; f.tray.submitOnlineSearch('food');
  assert.equal(historyRequests, 0); assert.equal(barcode, '4006381333931');
});
