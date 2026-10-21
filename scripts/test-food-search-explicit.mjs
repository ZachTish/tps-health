import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

// Compose the real modal and plugin search methods with the existing synthetic
// Obsidian/DOM host. Only food catalog/history/provider boundaries are replaced;
// input handlers, submission guards, timers, ranking and rendering run unchanged.
const harnessUrl = new URL('./test-food-search-unified.mjs', import.meta.url);
globalThis.__TPSExplicitSearchEsbuild = esbuild;
const harnessSource = readFileSync(harnessUrl, 'utf8')
  .replace('import test from "node:test";', 'const test = () => {};')
  .replace('import * as esbuild from "esbuild";', 'const esbuild = globalThis.__TPSExplicitSearchEsbuild;');
const transformed = await esbuild.transform(harnessSource + '\nexport { nativeTrayTestElement, importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals, food, titles, turn, walk };', {
  format: 'esm', define: { 'import.meta.url': JSON.stringify(harnessUrl.href) },
});
const { nativeTrayTestElement, importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals, food, titles, turn, walk } =
  await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`);
delete globalThis.__TPSExplicitSearchEsbuild;

async function fixture(initialDraft = null) {
  installDeterministicBrowserGlobals();
  const tasks = new Map(); let nextId = 0, now = 0;
  window.setTimeout = (callback, delay = 0) => {
    tasks.set(++nextId, { callback, due: now + delay }); return nextId;
  };
  window.clearTimeout = id => tasks.delete(id);
  const advance = async milliseconds => {
    const until = now + milliseconds;
    while (true) {
      const next = [...tasks].filter(([, task]) => task.due <= until).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].due; tasks.delete(next[0]); next[1].callback(); await turn(); await turn();
    }
    now = until; await turn(); await turn();
  };
  const { default: Plugin, FoodSearchModal, RecipeIngredientModal } = await importPluginWithObsidianStub();
  const { app } = createFakeHealthApp(), plugin = new Plugin(app);
  plugin.settings = { ...plugin.settings, pendingFoodLogDraft: null, includeBrandedFoodSearch: false };
  const calls = { local: [], online: [], history: 0, usda: 0, openFoodFacts: 0, barcode: [] };
  plugin.getLoggedFoodStats = async () => { calls.history++; return new Map(); };
  plugin.getSavedFoods = async () => [food('Saved oats')];
  plugin.searchCustomFoods = async query => [food(`${query} saved`)];
  plugin.searchUsdaFoods = async query => { calls.usda++; return [food(`${query} database`)]; };
  plugin.searchOpenFoodFacts = async () => { calls.openFoodFacts++; return []; };
  const local = plugin.searchLocalFoods, online = plugin.searchFoods;
  plugin.searchLocalFoods = function (...args) { calls.local.push(args[0]); return local.apply(this, args); };
  plugin.searchFoods = function (...args) { calls.online.push(args[0]); return online.apply(this, args); };
  const tray = new FoodSearchModal(app, plugin, initialDraft);
  tray.contentEl = nativeTrayTestElement(); tray.modalEl = nativeTrayTestElement();
  tray.handleBarcodeAdd = async value => { calls.barcode.push(value); };
  globalThis.__TPSHealthTestSettingControl = (_type, _name, callback) => {
    const control = {
      inputEl: nativeTrayTestElement('input'), buttonEl: nativeTrayTestElement('button'),
      setValue(value) { this.inputEl.value = value; return this; }, setPlaceholder() { return this; },
      setButtonText() { return this; }, setTooltip() { return this; }, setCta() { return this; },
      onChange() { return this; }, addOption() { return this; }, setDisabled() { return this; },
      onClick(handler) { this.buttonEl.addEventListener('click', handler); return this; },
    };
    callback(control);
  };
  try { tray.onOpen(); } finally { delete globalThis.__TPSHealthTestSettingControl; }
  await turn();
  // Opening with no query prepares quick picks; measure subsequent input work
  // separately from that existing first-open history materialization.
  calls.history = 0;
  return {
    tray, plugin, calls, tasks, advance, RecipeIngredientModal,
    input(value) { tray.searchInputEl.value = value; tray.searchInputEl.listeners.get('input')(); },
    enter(isComposing = false) { tray.searchInputEl.listeners.get('keydown')({ key: 'Enter', isComposing, preventDefault() {} }); },
    search() { tray.searchButtonEl.listeners.get('click')(); },
    close() { tray.onClose(); },
  };
}

test('typing settles to one local search and zero online submissions or provider calls', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.input('qafood'); await f.advance(100);
  assert.deepEqual(f.calls.local, ['qafood']); assert.equal(f.calls.history, 1);
  await f.advance(10000);
  assert.deepEqual(f.calls.online, []); assert.equal(f.calls.usda, 0); assert.equal(f.calls.openFoodFacts, 0);
  assert.deepEqual(titles(f.tray), ['qafood saved']);
  assert.match(f.tray.statusEl.text, /Press Enter or Search/);
  assert.equal(f.tray.statusEl.attributes['aria-busy'], 'false'); assert.equal(f.tray.searchButtonEl.disabled, false);
});

test('a twenty-input burst coalesces to the final local query without online work', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (let index = 0; index < 20; index++) { f.input(`qafood ${index}`); await f.advance(10); }
  await f.advance(10000);
  assert.deepEqual(f.calls.local, ['qafood 19']); assert.equal(f.calls.history, 1);
  assert.deepEqual(f.calls.online, []); assert.equal(f.calls.usda, 0);
  assert.deepEqual(titles(f.tray), ['qafood 19 saved']);
});

test('separate settled local queries remain local even after the old online debounce period', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (const query of ['qafood one', 'qafood two', 'qafood three']) { f.input(query); await f.advance(1000); }
  assert.deepEqual(f.calls.local, ['qafood one', 'qafood two', 'qafood three']);
  assert.equal(f.calls.history, 3); assert.deepEqual(f.calls.online, []); assert.equal(f.calls.usda, 0);
});

test('empty saved results explain explicit online search without claiming it will start shortly', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.plugin.searchCustomFoods = async () => [];
  f.input('qafood'); await f.advance(10000);
  assert.deepEqual(titles(f.tray), []);
  assert.match(f.tray.statusEl.text, /No saved matches\. Press Enter or Search/);
  assert.doesNotMatch(f.tray.statusEl.text, /shortly|Checking online/);
  assert.deepEqual(f.calls.online, []); assert.equal(f.calls.usda, 0);
});

for (const action of ['search', 'enter']) {
  test(`explicit ${action} cancels pending typing work and starts one online submission`, async t => {
    const f = await fixture(); t.after(() => f.close());
    f.input('qafood'); f[action](); await f.advance(10000);
    assert.deepEqual(f.calls.local, ['qafood']); assert.deepEqual(f.calls.online, ['qafood']);
    assert.equal(f.calls.history, 1); assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 0);
    assert.deepEqual(titles(f.tray), ['qafood saved', 'qafood database']);
    assert.equal(f.tray.onlineSearchActive, false); assert.equal(f.tray.searchButtonEl.disabled, false);
  });
}

test('configured branded providers remain available in one explicit combined search', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.plugin.settings.includeBrandedFoodSearch = true;
  f.input('qafood'); await f.advance(1000);
  assert.equal(f.calls.usda, 0); assert.equal(f.calls.openFoodFacts, 0);
  f.search(); await f.advance(10000);
  assert.deepEqual(f.calls.online, ['qafood']);
  assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 1);
  assert.equal(f.calls.history, 2, 'The typed stage and later explicit submission keep independent current histories');
});

test('repeated explicit submissions while pending share the existing busy guard', async t => {
  const f = await fixture(); t.after(() => f.close());
  let finish; f.plugin.searchUsdaFoods = () => { f.calls.usda++; return new Promise(resolve => { finish = resolve; }); };
  f.input('qafood'); f.search(); f.enter(); f.search(); await turn();
  assert.deepEqual(f.calls.online, ['qafood']); assert.equal(f.calls.history, 1); assert.equal(f.calls.usda, 1);
  assert.equal(f.tray.onlineSearchActive, true); assert.equal(f.tray.searchButtonEl.disabled, true);
  finish([food('qafood database')]); await f.advance(10000);
  assert.equal(f.tray.onlineSearchActive, false); assert.equal(f.tray.searchButtonEl.disabled, false);
});

test('an initial query on opening stays local until explicitly submitted', async t => {
  const f = await fixture({ query: 'qafood draft' }); t.after(() => f.close());
  await f.advance(10000);
  assert.equal(f.tray.searchInputEl.value, 'qafood draft');
  assert.deepEqual(f.calls.local, ['qafood draft']); assert.equal(f.calls.history, 1);
  assert.deepEqual(f.calls.online, []); assert.equal(f.calls.usda, 0);
  f.search(); await f.advance(10000);
  assert.deepEqual(f.calls.online, ['qafood draft']); assert.equal(f.calls.usda, 1);
});

test('barcode typing is inert; Enter keeps the explicit barcode route', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.input('4006381333931'); await f.advance(10000);
  assert.deepEqual(f.calls.online, []); assert.deepEqual(f.calls.barcode, []); assert.equal(f.calls.usda, 0);
  f.enter(); await f.advance(1000);
  assert.deepEqual(f.calls.barcode, ['4006381333931']); assert.deepEqual(f.calls.online, []);
});

test('composition Enter and short queries do not start online work', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.input('qafood'); f.enter(true); await f.advance(1000);
  f.input('x'); f.enter(); await f.advance(1000);
  assert.deepEqual(f.calls.online, []); assert.equal(f.calls.usda, 0); assert.deepEqual(f.calls.barcode, []);
});

test('tab changes and closing cancel pending local search without hidden online work', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.input('qafood');
  walk(f.tray.contentEl).find(node => node.className === 'tps-health-food-tab' && node.text === 'Describe').listeners.get('click')();
  await f.advance(10000); assert.deepEqual(f.calls.local, []); assert.deepEqual(f.calls.online, []);
  f.close(); await f.advance(10000); assert.equal(f.calls.usda, 0);
});

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

async function progressiveFixture(t, route = 'log') {
  const f = await fixture();
  t.after(() => f.close());
  const providers = { usda: deferred(), openFoodFacts: deferred() };
  f.plugin.settings.includeBrandedFoodSearch = true;
  for (const [key, method] of [['usda', 'searchUsdaFoods'], ['openFoodFacts', 'searchOpenFoodFacts']]) {
    f.plugin[method] = () => { f.calls[key]++; return providers[key].promise; };
  }
  let modal = f.tray;
  let begin = () => { f.input('qafood product'); f.search(); };
  let resultTitles = () => titles(modal);
  if (route === 'recipe') {
    modal = new f.RecipeIngredientModal(f.plugin.app, f.plugin, null);
    // The real search/render/selection methods run against synthetic DOM fields;
    // mounting the Obsidian modal and provider transport are separate boundaries.
    for (const name of ['contentEl', 'resultsEl', 'statusEl', 'selectedEl', 'macrosEl', 'quantityEl', 'unitEl', 'saveButton', 'onlineSearchButton']) modal[name] = nativeTrayTestElement();
    const controls = nativeTrayTestElement();
    modal.quantityEl.closest = () => controls;
    begin = () => { modal.query = 'qafood product'; return modal.submitOnlineSearch(); };
    resultTitles = () => walk(modal.resultsEl).filter(node => node.className === 'tps-health-search-result-title').map(node => node.text);
    t.after(() => modal.onClose());
  }
  const providerFood = key => ({ ...food(`qafood product ${key}`), source: key === 'usda' ? 'usda' : 'open-food-facts' });
  return { ...f, modal, begin, resultTitles, providers, providerFood };
}

for (const route of ['log', 'recipe']) {
  for (const fast of ['usda', 'openFoodFacts']) {
    test(`${route}: ${fast} becomes usable before the other provider settles`, async t => {
      const f = await progressiveFixture(t, route);
      const slow = fast === 'usda' ? 'openFoodFacts' : 'usda';
      f.begin(); await turn(); await turn();
      assert.deepEqual(f.resultTitles(), ['qafood product saved'], 'Local results remain usable while both providers are pending');
      assert.equal(f.modal.onlineSearchActive, true);
      f.providers[fast].resolve([f.providerFood(fast)]); await turn(); await turn();
      assert.deepEqual(new Set(f.resultTitles()), new Set(['qafood product saved', `qafood product ${fast}`]));
      assert.equal(f.modal.onlineSearchActive, true, 'The other provider is still pending');
      assert.equal(f.modal.statusEl.attributes['aria-busy'], 'true');
      f.providers[slow].resolve([f.providerFood(slow)]); await turn(); await turn();
      assert.deepEqual(new Set(f.resultTitles()), new Set(['qafood product saved', 'qafood product usda', 'qafood product openFoodFacts']));
      assert.equal(f.modal.onlineSearchActive, false);
      assert.equal(f.modal.statusEl.attributes['aria-busy'], 'false');
      assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 1);
      assert.equal(f.calls.history, 1);
    });
  }

  test(`${route}: later provider results leave an existing selection and edited portion intact`, async t => {
    const f = await progressiveFixture(t, route);
    const selected = { ...food('Selected food'), servingGrams: 100 };
    if (route === 'log') {
      f.modal.selectionItems = [{ item: selected, quantity: 37.14, unit: 'g' }];
    } else {
      f.modal.selectedFood = selected;
      f.modal.quantityEl.value = '37.14'; f.modal.unitEl.value = 'g';
    }
    f.begin(); await turn();
    f.providers.usda.resolve([f.providerFood('usda')]); await turn();
    f.providers.openFoodFacts.resolve([f.providerFood('openFoodFacts')]); await turn();
    if (route === 'log') {
      assert.equal(f.modal.selectionItems[0].item, selected);
      assert.equal(f.modal.selectionItems[0].quantity, 37.14); assert.equal(f.modal.selectionItems[0].unit, 'g');
    } else {
      assert.equal(f.modal.selectedFood, selected);
      assert.equal(f.modal.quantityEl.value, '37.14'); assert.equal(f.modal.unitEl.value, 'g');
    }
  });

  for (const cancel of ['query', 'close']) {
    test(`${route}: ${cancel} rejects remaining provider paints`, async t => {
      const f = await progressiveFixture(t, route);
      f.begin(); await turn();
      f.providers.usda.resolve([f.providerFood('usda')]); await turn();
      if (cancel === 'close') f.modal.onClose(); else f.modal.queueSearch('next query');
      const snapshot = { titles: f.resultTitles(), status: f.modal.statusEl.text, busy: f.modal.statusEl.attributes['aria-busy'] };
      f.providers.openFoodFacts.resolve([f.providerFood('openFoodFacts')]); await turn(); await turn();
      assert.deepEqual({ titles: f.resultTitles(), status: f.modal.statusEl.text, busy: f.modal.statusEl.attributes['aria-busy'] }, snapshot);
      assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 1);
    });
  }
}

test('a slower local branch cannot replace a partial online result', async t => {
  const f = await progressiveFixture(t);
  const local = deferred(); f.plugin.searchLocalFoods = () => local.promise;
  f.begin(); await turn();
  f.providers.usda.resolve([f.providerFood('usda')]); await turn();
  assert.ok(f.resultTitles().includes('qafood product usda'));
  local.resolve([food('qafood product saved')]); await turn();
  assert.ok(f.resultTitles().includes('qafood product usda'));
  f.providers.openFoodFacts.resolve([]); await turn();
});

test('recipe selection cancels pending search without stranding its Search button', async t => {
  const f = await progressiveFixture(t, 'recipe');
  f.plugin.enrichFoodSearchItem = async item => item;
  f.begin(); await turn();
  f.providers.usda.resolve([f.providerFood('usda')]); await turn();
  await f.modal.selectFood({ ...f.providerFood('usda'), servingGrams: 100 });
  f.modal.quantityEl.value = '37.14'; f.modal.unitEl.value = 'g';
  assert.equal(f.modal.onlineSearchActive, false);
  assert.equal(f.modal.onlineSearchButton.disabled, false);
  assert.equal(f.modal.statusEl.attributes['aria-busy'], 'false');
  const selected = f.modal.selectedFood, status = f.modal.statusEl.text;
  f.providers.openFoodFacts.resolve([f.providerFood('openFoodFacts')]); await turn();
  assert.equal(f.modal.selectedFood, selected); assert.equal(f.modal.quantityEl.value, '37.14');
  assert.equal(f.modal.unitEl.value, 'g'); assert.equal(f.modal.statusEl.text, status);
  assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 1);
});

test('timed-out provider cannot overwrite usable results or start a repeated request', async t => {
  const f = await progressiveFixture(t);
  f.begin(); await turn(); f.providers.usda.resolve([f.providerFood('usda')]); await turn();
  assert.ok(f.resultTitles().includes('qafood product usda'));
  await f.advance(6000);
  assert.equal(f.modal.onlineSearchActive, false);
  const snapshot = f.resultTitles();
  f.providers.openFoodFacts.resolve([f.providerFood('openFoodFacts')]); await turn();
  assert.deepEqual(f.resultTitles(), snapshot);
  assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 1);
});

for (const route of ['log', 'recipe']) test(`${route}: saved food can be selected before either provider completes`, async t => {
  const f = await progressiveFixture(t, route);
  f.plugin.enrichFoodSearchItem = async item => item;
  f.begin(); await turn(); await turn();
  const saved = { ...food('qafood product saved'), servingGrams: 100 };
  if (route === 'log') {
    const add = walk(f.modal.resultsEl).find(node => node.attributes?.['aria-label'] === 'Add qafood product saved');
    assert.ok(add, 'The current local result exposes its real Add action');
    add.listeners.get('click')({ preventDefault() {}, stopPropagation() {} }); await turn();
    f.modal.selectionItems[0].quantity = 37.14; f.modal.selectionItems[0].unit = 'g';
  } else {
    const select = walk(f.modal.resultsEl).find(node => node.text === 'Select');
    assert.ok(select, 'The current local result exposes its real Select action');
    select.listeners.get('click')(); await turn();
    f.modal.quantityEl.value = '37.14'; f.modal.unitEl.value = 'g';
  }
  const selected = route === 'log' ? f.modal.selectionItems[0].item : f.modal.selectedFood;
  assert.equal(selected.name, saved.name);
  f.providers.usda.resolve([f.providerFood('usda')]);
  f.providers.openFoodFacts.resolve([f.providerFood('openFoodFacts')]); await turn(); await turn();
  if (route === 'log') {
    assert.equal(f.modal.selectionItems[0].item, selected);
    assert.equal(f.modal.selectionItems[0].quantity, 37.14); assert.equal(f.modal.selectionItems[0].unit, 'g');
  } else {
    assert.equal(f.modal.selectedFood, selected);
    assert.equal(f.modal.quantityEl.value, '37.14'); assert.equal(f.modal.unitEl.value, 'g');
  }
  assert.equal(f.modal.onlineSearchActive, false);
});

test('switching away from search rejects remaining partial and final results', async t => {
  const f = await progressiveFixture(t);
  f.begin(); await turn(); f.providers.usda.resolve([f.providerFood('usda')]); await turn();
  walk(f.tray.contentEl).find(node => node.className === 'tps-health-food-tab' && node.text === 'Describe').listeners.get('click')();
  const snapshot = { titles: f.resultTitles(), status: f.modal.statusEl.text };
  f.providers.openFoodFacts.resolve([f.providerFood('openFoodFacts')]); await turn();
  assert.deepEqual({ titles: f.resultTitles(), status: f.modal.statusEl.text }, snapshot);
  assert.equal(f.modal.onlineSearchActive, false);
});

test('non-interactive search still returns one complete ranked result independent of provider order', async t => {
  const finals = [];
  for (const first of ['usda', 'openFoodFacts']) {
    const f = await progressiveFixture(t);
    const duplicate = { ...food('qafood product duplicate'), barcode: '0012345678905', nutrition: { calories: 95, carbsG: 2.6, proteinG: 0.6, fatG: 0 } };
    const usda = [f.providerFood('usda'), { ...duplicate, source: 'usda' }];
    const off = [f.providerFood('openFoodFacts'), { ...duplicate, source: 'open-food-facts' }];
    const before = JSON.stringify({ usda, off });
    let settled = false;
    const pending = f.plugin.searchFoods('qafood product').then(items => { settled = true; return items; });
    f.providers[first].resolve(first === 'usda' ? usda : off); await turn();
    assert.equal(settled, false, 'The public Promise contract still waits for the complete result');
    f.providers[first === 'usda' ? 'openFoodFacts' : 'usda'].resolve(first === 'usda' ? off : usda);
    const result = await pending;
    assert.equal(result.filter(item => item.barcode === duplicate.barcode).length, 1);
    assert.equal(JSON.stringify({ usda, off }), before, 'Ranking does not mutate source nutrition or servings');
    finals.push(result);
    assert.equal(f.calls.usda, 1); assert.equal(f.calls.openFoodFacts, 1); f.close();
  }
  assert.deepEqual(finals[0], finals[1]);
});
