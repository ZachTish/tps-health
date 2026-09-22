import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";

const harnessUrl = new URL("./test-health-providers.mjs", import.meta.url);
globalThis.__TPSAddSearchRaceEsbuild = esbuild;
const harnessSource = readFileSync(harnessUrl, "utf8")
  .replace('import test from "node:test";', 'const test = () => {};')
  .replace('import * as esbuild from "esbuild";', 'const esbuild = globalThis.__TPSAddSearchRaceEsbuild;')
  .replaceAll("import.meta.url", JSON.stringify(harnessUrl.href));
const { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals } = await import(`data:text/javascript;base64,${Buffer.from(harnessSource + "\nexport { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals };\n//# sourceURL=add-selection-search-race-harness.mjs").toString("base64")}`);
delete globalThis.__TPSAddSearchRaceEsbuild;

function nativeTrayTestElement(tag = "div", options = {}) {
  const listeners = new Map();
  const node = { tag, text: options.text || "", value: options.attr?.value || "", className: options.cls || "", children: [],
    attributes: { ...options.attr }, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
    addClass() {}, removeClass() {}, toggleClass() {}, empty() { this.children = []; }, setText(value) { this.text = value; },
    setAttr(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(name, fn) { const previous = listeners.get(name); listeners.set(name, (...args) => { previous?.(...args); return fn(...args); }); }, removeEventListener() {}, listeners,
    createEl(tag, options) { const child = nativeTrayTestElement(tag, options); child.parentElement = this; this.children.push(child); return child; },
    createDiv(options) { return this.createEl("div", options); }, createSpan(options) { return this.createEl("span", options); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() {}, blur() {}, scrollIntoView() {},
  };
  return node;
}

const walk = node => [node, ...node.children.flatMap(walk)];
const turn = () => new Promise(resolve => setImmediate(resolve));

const food = name => ({ id: name, name, source: "custom-note", servingAmount: 1, servingUnit: "serving", nutrition: { calories: 100 } });
async function setup(existingPlugin = null) {
  if (!existingPlugin) installDeterministicBrowserGlobals();
  const { default: Plugin, FoodSearchModal } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp(), plugin = existingPlugin || new Plugin(fake.app);
  if (!existingPlugin) plugin.settings = { ...plugin.settings, pendingFoodLogDraft: null };
  const tray = new FoodSearchModal(plugin.app, plugin);
  const h = { tray, plugin };
  tray.searchInput = "";
  tray.contentEl = nativeTrayTestElement(); tray.modalEl = nativeTrayTestElement();
  h.plugin.getLoggedFoodStats = async () => new Map();
  h.plugin.getSavedFoods = async () => [food("Saved oats")];
  globalThis.__TPSHealthTestSettingControl = (_type, _name, callback) => {
    const control = { inputEl: nativeTrayTestElement("input"), buttonEl: nativeTrayTestElement("button"),
      setValue(value) { this.inputEl.value = value; return this; }, setPlaceholder() { return this; },
      setButtonText() { return this; }, setTooltip() { return this; }, setCta() { return this; }, onChange() { return this; },
      onClick() { return this; }, addOption() { return this; }, setDisabled() { return this; } };
    callback(control);
  };
  try { tray.onOpen(); } finally { delete globalThis.__TPSHealthTestSettingControl; }
  await turn();
  return { ...h, tray };
}
const titles = tray => walk(tray.resultsEl).filter(n => n.className === "tps-health-result-title").map(n => n.text);
test("Search opens with saved foods, only Search and Describe tabs, and inline scan action", async () => {
  const { tray } = await setup();
  assert.deepEqual(walk(tray.contentEl).filter(n => n.className === "tps-health-food-tab").map(n => n.text), ["Search", "Describe"]);
  assert.deepEqual(titles(tray), ["Saved oats"]);
  let scans = 0; tray.openBarcodeScanner = () => scans++;
  const scan = walk(tray.contentEl).find(n => n.className === "tps-health-food-scan-button");
  assert.ok(scan); scan.listeners.get("click")(); assert.equal(scans, 1);
  const quick = walk(tray.contentEl).find(n => n.text === "Quick add");
  quick.listeners.get("click")(); assert.equal(tray.activeFoodLogTab, "quick");
  walk(tray.contentEl).find(n => n.text === "Back to search").listeners.get("click")();
  assert.equal(tray.activeFoodLogTab, "search");
});
test("a slower local search cannot overwrite completed combined results", async () => {
  const { tray, plugin } = await setup();
  let finishLocal;
  plugin.searchLocalFoods = () => new Promise(resolve => { finishLocal = resolve; });
  plugin.searchFoods = async () => [food("Saved oats"), food("Database oats")];
  tray.submitOnlineSearch("oats"); await turn();
  assert.deepEqual(titles(tray), ["Saved oats", "Database oats"]);
  finishLocal([food("Saved oats")]); await turn();
  assert.deepEqual(titles(tray), ["Saved oats", "Database oats"]);
});
test("barcode search uses lookup, and switching tabs lets a fresh search start", async () => {
  const { tray, plugin } = await setup();
  let barcode; tray.handleBarcodeAdd = async value => { barcode = value; };
  tray.submitOnlineSearch("4006381333931"); assert.equal(barcode, "4006381333931");
  let completeOld; plugin.searchLocalFoods = async () => [];
  plugin.searchFoods = () => new Promise(resolve => { completeOld = resolve; });
  tray.submitOnlineSearch("old");
  const tab = label => walk(tray.contentEl).find(n => n.className === "tps-health-food-tab" && n.text === label).listeners.get("click")();
  tab("Describe"); tab("Search");
  plugin.searchFoods = async () => [food("New")];
  tray.submitOnlineSearch("new"); await turn();
  completeOld([food("Old")]); await turn();
  assert.deepEqual(titles(tray), ["New"]);
  assert.equal(tray.onlineSearchActive, false);
});

test("reported package energy survives incomplete alcohol macros", async () => {
  const { foodFactsNutrition } = await importPluginWithObsidianStub();
  const nutrition = foodFactsNutrition({nutriments: {"energy-kcal_serving":95, "energy-kcal_100g":26.76, proteins_serving:0.8, carbohydrates_serving:2, fat_serving:0}}, {servingAmount:1,servingUnit:"can",ml:355}, "labeled-serving");
  assert.equal(nutrition.calories,95);
  assert.equal(nutrition.alcoholG,undefined);
});

test("saved discovery excludes archived folders and flags while retaining active foods", async () => {
  installDeterministicBrowserGlobals();
  const { default: Plugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp(), plugin = new Plugin(fake.app);
  for (const [path, flag] of [["Health/Foods/Active.md",false],["Health/Foods/Archived.md",true],["_archive/Retired.md",false]]) {
    fake.files.set(path, `---\ntags: [food]\ntitle: ${path}\ncalories: 100\nproteinG: 5\ncarbsG: 15\nfatG: 2\narchived: ${flag}\n---\n`);
  }
  const saved = await plugin.getSavedFoods(new Map());
  assert.deepEqual(saved.map(item => item.sourcePath), ["Health/Foods/Active.md"]);
});

test("two food tabs preserve five settings destinations and narrow tray controls", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tps-health-food-tabs \{[^}]*grid-template-columns: repeat\(2,/);
  assert.match(css, /\.tps-health-settings-route-grid \{[^}]*grid-template-columns: repeat\(5,/);
  assert.match(css, /@container tps-health-food-search \(max-width: 520px\)[\s\S]*?min-height: 44px/);
});


test("Create meal sits with the tray's top actions and preserves the existing flow", async () => {
  const { tray } = await setup();
  tray.selectionItems = [{ item: food('Oats'), quantity: 1, unit: 'serving' }];
  tray.renderSelection();
  const button = walk(tray.selectionEl).find(n => n.text === 'Create meal');
  assert.equal(button.parentElement.className, 'tps-health-review-actions');
  let calls = 0; tray.createRecipeFromSelection = () => calls++;
  button.listeners.get('click')(); assert.equal(calls, 1);
  assert.equal(walk(tray.selectionEl).filter(n => n.text === 'Create recipe').length, 0);
});

test('recipe component disclosure scales half a serving and keeps missing ingredients explicit', async () => {
  installDeterministicBrowserGlobals();
  const { default: Plugin, renderNativeDailyComponents } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp(), plugin = new Plugin(fake.app);
  fake.files.set('entry.md', '---\nfood: "[[recipe]]"\n---\n');
  fake.files.set('recipe.md', '---\nkind: recipe\nrecipeServings: 4\nservingAmount: 1\nservingUnit: serving\n---\n- 8 serving - [[oats]]\n- 2 serving - [[missing]]\n');
  fake.files.set('oats.md', '---\nkind: food\nservingAmount: 1\nservingUnit: serving\ncalories: 100\nproteinG: 10\n---\n');
  fake.app.metadataCache.getFirstLinkpathDest = path => fake.app.vault.getAbstractFileByPath(path.endsWith('.md') ? path : path + '.md');
  plugin.settings.foodIdentificationMode = 'frontmatter';
  plugin.settings.foodFrontmatterKey = 'kind';
  plugin.settings.foodFrontmatterRecipeValue = 'recipe';
  plugin.findRecipeIngredientFoodByName = () => null;
  const root = nativeTrayTestElement();
  renderNativeDailyComponents(root, plugin, {path:'entry.md',title:'Recipe',quantity:0.5,unit:'serving'}, new Map());
  const details = root.children[0]; assert.ok(details);
  details.open = true; details.listeners.get('toggle')(); await turn(); await turn();
  const text = walk(root).map(n => n.text).join(' ');
  assert.match(text, /1 serving · oats/);
  assert.match(text, /100 kcal/);
  assert.match(text, /0.25 serving · missing/);
  assert.match(text, /Nutrition unavailable/);
  assert.equal(fake.writes.length, 0);
});

test('adding food opens review while retaining query, result nodes and scroll', async () => {
  const { tray } = await setup();
  tray.searchInput = 'oats'; tray.searchInputEl.value = 'oats';
  tray.contentEl.scrollTop = 120;
  const results = tray.resultsEl.children;
  await tray.addSelection(food('Oats'), null, { enrich: false });
  assert.equal(tray.searchInput, 'oats');
  assert.equal(tray.searchInputEl.value, 'oats');
  assert.equal(tray.resultsEl.children, results);
  assert.equal(tray.contentEl.scrollTop, 120);
  const body = walk(tray.selectionEl).find(n => n.className === 'tps-health-selection-body');
  const toggle = walk(tray.selectionEl).find(n => n.className === 'tps-health-selection-title');
  assert.equal(body.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  toggle.listeners.get('click')();
  assert.equal(body.hidden, true);
  await tray.addSelection(food('Oats'), null, { enrich: false });
  assert.equal(tray.selectionItems.length, 1);
  assert.equal(tray.selectionItems[0].quantity, 2);
  assert.equal(walk(tray.selectionEl).find(n => n.className === 'tps-health-selection-body').hidden, false);
  assert.equal(tray.contentEl.scrollTop, 120);
});

test('review scroll survives rebuilding selected rows', async () => {
  const {tray} = await setup();
  tray.selectionItems = [{item:food('Oats'),quantity:1,unit:'serving'}];
  tray.selectionEl.querySelector = selector => walk(tray.selectionEl).find(n => n.className === selector.slice(1));
  tray.renderSelection();
  tray.selectionEl.querySelector('.tps-health-selection-body').scrollTop = 120;
  tray.renderSelection();
  assert.equal(tray.selectionEl.querySelector('.tps-health-selection-body').scrollTop,120);
});


test('macro rings expand one full-width contribution list and keep nutrients compact', async () => {
  const { renderNativeDailyMacrosBlock } = await importPluginWithObsidianStub();
  const root = nativeTrayTestElement();
  const metrics = ['consumedCalories','protein','carbs','fat','fiber','sodium'].map((propertyKey, i) => ({ propertyKey, label: propertyKey, value: 10, unit: i === 0 ? 'kcal' : 'g', targetLabel: 'up to 100 g', progress: 0.1, state: 'within' }));
  const actions = { disclosures: new Map(), components() {}, addFood() {}, openFoodEntry() {} };
  renderNativeDailyMacrosBlock(root, { metrics, calories: 10, entryCount: 0 }, [], { macroStyle: 'rings', foodList: 'hidden', nutrientRows: 'collapsed' }, actions);
  const rings = walk(root).filter(n => n.className === 'tps-health-native-ring-button');
  assert.equal(rings.length, 4);
  const nutrients = walk(root).find(n => n.className === 'tps-health-native-daily-nutrients');
  assert.equal(nutrients.open, false);
  rings[0].listeners.get('click')();
  assert.equal(rings[0].attributes['aria-expanded'], 'true');
  const sources = walk(root).find(n => n.className === 'tps-health-native-ring-sources');
  assert.equal(sources.children.length, 1);
  assert.equal(sources.parentElement, rings[0].parentElement.parentElement.parentElement);
  rings[1].listeners.get('click')();
  assert.equal(rings[0].attributes['aria-expanded'], 'false');
  assert.equal(rings[1].attributes['aria-expanded'], 'true');
  rings[1].listeners.get('click')();
  assert.equal(sources.children.length, 0);
  const hidden = nativeTrayTestElement();
  renderNativeDailyMacrosBlock(hidden, { metrics, calories: 0, entryCount: 0 }, [], { macroStyle: 'table', foodList: 'hidden', nutrientRows: 'hidden' }, actions);
  assert.equal(walk(hidden).some(n => n.className === 'tps-health-native-daily-nutrients'), false);
  assert.equal(walk(hidden).some(n => n.className === 'tps-health-native-ring-button'), false);
});


test('typing a valid tray amount persists immediately without replacing the focused input', async () => {
  const { tray } = await setup();
  tray.selectionItems = [{ item: food('Creatine'), quantity: 1, unit: 'serving' }];
  tray.selectionExpanded = true;
  tray.renderSelection();
  let saved = null;
  tray.persistDraft = () => { saved = tray.selectionItems[0].quantity; };
  const input = walk(tray.selectionEl).find(n => n.className === 'tps-health-selection-quantity');
  input.value = '0.125';
  input.listeners.get('input')();
  assert.equal(saved, .125);
  assert.equal(tray.selectionItems[0].quantity, .125);
  assert.equal(input.value, '0.125');
  assert.ok(walk(tray.selectionEl).includes(input), 'the input is not replaced while typing');
  input.listeners.get('change')();
  assert.equal(tray.selectionItems[0].quantity, .125, 'blur keeps fractional supplement servings');
  input.value = '';
  input.listeners.get('input')();
  assert.equal(saved, .125, 'an unfinished empty edit does not replace the valid draft with zero');
  tray.onClose();
});


test("tray refresh notices a serving basis change even when amount and nutrients stay the same", async () => {
  const {tray} = await setup();
  const original = {...food("QA"),servingAmount:100,servingUnit:"g",servingGrams:100,nutritionBasis:"per-100g"};
  tray.selectionItems = [{item:original,quantity:1,unit:"serving"}];
  tray.refreshFoodItemFromSource = async () => ({...original,nutritionBasis:"labeled-serving"});
  let persisted = 0;
  tray.persistDraft = async () => {persisted++;};
  tray.renderSelection = () => {};
  await tray.refreshSelectionItemsFromSources();
  assert.equal(tray.selectionItems[0].item.nutritionBasis,"labeled-serving");
  assert.equal(tray.selectionItems[0].quantity,1);
  assert.equal(persisted,1);
});


test("refresh preserves an incompatible queued unit instead of reinterpreting its quantity", async () => {
  const {tray,plugin} = await setup();
  const original = {...food("Unit QA"),servingAmount:355,servingUnit:"g",servingGrams:355};
  tray.selectionItems=[{item:original,quantity:177.5,unit:"g"}];
  tray.refreshFoodItemFromSource=async()=>({...original,servingUnit:"ml",servingGrams:undefined,servingMl:355});
  tray.persistDraft=async()=>{};tray.renderSelection=()=>{};
  await tray.refreshSelectionItemsFromSources();
  assert.equal(tray.selectionItems[0].unit,"g");
  assert.equal(tray.selectionItems[0].quantity,177.5);
  let writes=0;plugin.logFood=async()=>{writes++;};
  await tray.logSelected();
  assert.equal(writes,0,"invalid tray entries must be caught before any food log is written");
  assert.equal(tray.selectionItems.length,1,"invalid selections stay available for correction");
});


test("incompatible tray units remain visible with a correction message and valid units recover", async () => {
  const {tray}=await setup();
  const item={...food("Drink"),servingAmount:355,servingUnit:"ml",servingMl:355};
  tray.selectionItems=[{item,quantity:177.5,unit:"g"}];
  tray.renderSelection();
  let nodes=walk(tray.selectionEl);
  assert.ok(nodes.some(n=>n.className==="tps-health-selection-line-macros" && n.text.includes("Choose a supported unit")));
  assert.ok(nodes.some(n=>n.tag==="option" && n.text==="g"));
  tray.selectionItems[0].unit="ml";
  tray.renderSelection();nodes=walk(tray.selectionEl);
  assert.ok(!nodes.some(n=>n.text.includes("Choose a supported unit")));
  assert.equal(tray.selectedNutrition().calories,50);
});

test('typing Michelob Ultra searches databases after settling, and old queries cannot win', async () => {
  const {tray, plugin} = await setup();
  const timers = new Map(); let next = 0;
  window.setTimeout = (fn, delay) => { timers.set(++next, {fn, delay}); return next; };
  window.clearTimeout = id => timers.delete(id);
  const tick = async delay => { for (const [id, task] of [...timers]) if (task.delay === delay) { timers.delete(id); task.fn(); } await turn(); };
  plugin.searchLocalFoods = async () => [];
  const queries = []; plugin.searchFoods = async query => { queries.push(query); return [food('Michelob Ultra')]; };
  tray.queueSearch('michelob'); await tick(100);
  tray.queueSearch('michelob ultra'); await tick(100);
  assert.deepEqual(queries, []);
  await tick(700);
  assert.deepEqual(queries, ['michelob ultra']);
  assert.deepEqual(titles(tray), ['Michelob Ultra']);
  tray.queueSearch('later'); await tick(100);
  tray.onClose(); await tick(700);
  assert.deepEqual(queries, ['michelob ultra']);
});

test('typing a barcode never adds a food without explicit submission', async () => {
  const {tray, plugin} = await setup(); let lookups = 0;
  plugin.searchLocalFoods = async () => [];
  tray.handleBarcodeAdd = async () => lookups++;
  tray.queueSearch('4006381333931'); await turn();
  assert.equal(lookups, 0);
  tray.submitOnlineSearch('4006381333931'); await turn();
  assert.equal(lookups, 1);
});

test('Describe shows completed estimates in the same expanded tray and preserves earlier foods', async () => {
  const {tray, plugin} = await setup();
  await tray.addSelection(food('Existing oats'), null, {enrich:false});
  plugin.searchLocalFoods = async () => [food('Banana')];
  plugin.getAiGatewayApi = () => null;
  plugin.searchFoods = async () => [];
  walk(tray.contentEl).find(n=>n.text === 'Describe').listeners.get('click')();
  const input = walk(tray.contentEl).find(n=>n.className === 'tps-health-describe-input');
  input.value = 'a banana';
  await walk(tray.contentEl).find(n=>n.className === 'mod-cta tps-health-describe-action').listeners.get('click')();
  // The button listener starts an async job; wait for matching and persistence.
  for (let i=0;i<12;i++) await turn();
  assert.equal(tray.activeFoodLogTab, 'search');
  assert.equal(tray.selectionExpanded, true);
  assert.equal(tray.selectionItems.length, 2);
  assert.equal(tray.selectionItems[0].item.name, 'Existing oats');
  assert.match(tray.selectionItems[1].item.name, /banana/i);
  assert.equal(walk(tray.selectionEl).find(n=>n.className === 'tps-health-selection-body').hidden, false);
  assert.equal(tray.__closed, undefined);
  assert.equal(input.value, '');
  await tray.persistDraft();
  assert.equal(plugin.settings.pendingFoodLogDraft.selectionItems.length, 2);
});

test('prepared Describe retries append exactly once and keep the selected consumption time', async () => {
  const {plugin} = await setup();
  plugin.settings.pendingFoodLogDraft = {id:'earlier',consumedDateInput:'2026-09-17T12:30',selectionItems:[{item:food('Oats'),quantity:2,unit:'serving'}]};
  const estimate = [{item:food('Banana'),quantity:1,unit:'serving'}];
  await plugin.appendDescribedFoods(estimate, null, 'describe-fixture');
  await plugin.appendDescribedFoods(estimate, null, 'describe-fixture');
  assert.equal(plugin.settings.pendingFoodLogDraft.selectionItems.length, 2);
  assert.equal(plugin.settings.pendingFoodLogDraft.selectionItems[0].quantity, 2);
  assert.equal(plugin.settings.pendingFoodLogDraft.consumedDateInput, '2026-09-17T12:30');
});

test('a failed Describe keeps its text and existing tray for retry', async () => {
  const {tray, plugin} = await setup();
  await tray.addSelection(food('Oats'), null, {enrich:false});
  plugin.openFoodDescriber = async () => {throw new Error('Provider offline');};
  const input=walk(tray.contentEl).find(n=>n.className==='tps-health-describe-input'); input.value='two eggs';
  const action=walk(tray.contentEl).find(n=>n.className==='mod-cta tps-health-describe-action');
  action.listeners.get('click')(); for(let i=0;i<5;i++) await turn();
  assert.equal(input.value,'two eggs'); assert.equal(action.disabled,false);
  assert.equal(action.text,'Try again'); assert.equal(tray.selectionItems.length,1);
  assert.match(tray.statusEl.text,/Provider offline/);
});

test('an exact Michelob Ultra product ranks ahead of a curated seltzer variant', async () => {
  const {plugin} = await setup();
  plugin.searchCustomFoods = async () => [];
  plugin.searchUsdaFoods = async () => [];
  plugin.searchOpenFoodFacts = async () => [{...food('Michelob Ultra'), source:'open-food-facts', brand:'Michelob', nutrition:{calories:95,carbsG:2.6}}];
  const results=await plugin.searchFoods('michelob ultra');
  assert.equal(results[0].name,'Michelob Ultra');
});


test('Describe completion refreshes a reopened logger and keeps subsequent additions durable', async () => {
  const {tray: original, plugin} = await setup();
  await original.addSelection(food('Existing oats'), null, {enrich:false});
  await original.persistDraft();
  let finishDescribe;
  plugin.openFoodDescriber = async () => {
    await new Promise(resolve => { finishDescribe = resolve; });
    await plugin.appendDescribedFoods([{item:food('Described banana'),quantity:1,unit:'serving'}], null, 'describe-reopened');
  };
  const originalCreateFragment = document.createDocumentFragment;
  document.createDocumentFragment = () => ({append() {},createEl() { return {addEventListener() {}}; }});
  try {
    walk(original.contentEl).find(n=>n.className==='tps-health-describe-input').value = 'banana';
    walk(original.contentEl).find(n=>n.className==='mod-cta tps-health-describe-action').listeners.get('click')();
    for (let i=0;i<4;i++) await turn();
    original.onClose();
    const {tray: reopened} = await setup(plugin);
    finishDescribe();
    for (let i=0;i<12;i++) await turn();
    assert.deepEqual(original.selectionItems.map(e=>e.item.name), ['Existing oats'], 'closed logger must unsubscribe');
    assert.deepEqual(reopened.selectionItems.map(e=>e.item.name), ['Existing oats','Described banana']);
    assert.equal(reopened.selectionExpanded, true);
    assert.equal(walk(reopened.selectionEl).find(n=>n.className==='tps-health-selection-body').hidden, false);
    await reopened.addSelection(food('New yoghurt'), null, {enrich:false});
    await reopened.persistDraft();
    assert.deepEqual(plugin.settings.pendingFoodLogDraft.selectionItems.map(e=>e.item.name), ['New yoghurt','Existing oats','Described banana']);
    const logged=[];
    plugin.logFood = async item => { logged.push(item.name); };
    await reopened.logSelected();
    assert.deepEqual(logged, ['New yoghurt','Existing oats','Described banana']);
    assert.equal(plugin.settings.pendingFoodLogDraft, null);
    reopened.onClose();
  } finally {
    document.createDocumentFragment = originalCreateFragment;
  }
});

test('a stale logger refreshes the newer tray before it is allowed to write any food logs', async () => {
  const {tray,plugin} = await setup();
  await tray.addSelection(food('Stale oats'), null, {enrich:false});
  await tray.persistDraft();
  await plugin.savePendingFoodLogDraft({id:'new-owner',selectionItems:[{item:food('Current banana'),quantity:2,unit:'serving'}],consumedDateInput:'2026-09-17T13:00'});
  const logged=[];
  plugin.logFood = async (item,quantity) => { logged.push({name:item.name,quantity}); };
  await tray.logSelected();
  assert.deepEqual(logged, [], 'stale visible items must never be logged');
  assert.deepEqual(tray.selectionItems.map(e=>e.item.name), ['Current banana']);
  assert.equal(plugin.settings.pendingFoodLogDraft.selectionItems[0].quantity, 2);
  assert.equal(tray.selectionExpanded, true);
  await tray.logSelected();
  assert.deepEqual(logged, [{name:'Current banana',quantity:2}]);
  assert.equal(plugin.settings.pendingFoodLogDraft, null);
  tray.onClose();
});

test('Describe completing during a food write never requeues the food already logged', async () => {
  const {tray,plugin} = await setup();
  await tray.addSelection(food('Existing oats'), null, {enrich:false});
  await tray.persistDraft();
  let finishLog;
  const logged=[];
  plugin.logFood = async item => {
    await new Promise(resolve => { finishLog = resolve; });
    logged.push(item.name);
  };
  const inFlightLog=tray.logSelected();
  for (let i=0;i<4;i++) await turn();
  await plugin.appendDescribedFoods([{item:food('Described banana'),quantity:1,unit:'serving'}], null, 'describe-during-log');
  finishLog();
  await inFlightLog;
  assert.deepEqual(logged, ['Existing oats']);
  assert.deepEqual(tray.selectionItems.map(e=>e.item.name), ['Described banana']);
  assert.deepEqual(plugin.settings.pendingFoodLogDraft.selectionItems.map(e=>e.item.name), ['Described banana']);
  tray.onClose();
});

test('an unrelated tray owner arriving during a batch write stops remaining stale submissions', async () => {
  const {tray,plugin} = await setup();
  tray.selectionItems = [{item:food('First oats'),quantity:1,unit:'serving'},{item:food('Second eggs'),quantity:1,unit:'serving'}];
  await tray.persistDraft();
  let finishLog;
  const logged=[];
  plugin.logFood = async item => {
    if (!logged.length) await new Promise(resolve => { finishLog = resolve; });
    logged.push(item.name);
  };
  const inFlightLog=tray.logSelected();
  for (let i=0;i<4;i++) await turn();
  await plugin.savePendingFoodLogDraft({id:'unrelated-owner',selectionItems:[{item:food('Current yoghurt'),quantity:3,unit:'serving'}]});
  finishLog();
  await inFlightLog;
  assert.deepEqual(logged, ['First oats']);
  assert.deepEqual(tray.selectionItems.map(e=>e.item.name), ['Current yoghurt']);
  assert.equal(plugin.settings.pendingFoodLogDraft.id, 'unrelated-owner');
  assert.equal(plugin.settings.pendingFoodLogDraft.selectionItems[0].quantity, 3);
  assert.equal(tray.selectionSubmitting, false);
  tray.onClose();
});


for (const editBeforeRetry of [false, true]) test(`a prepared Describe tray survives a failed settings save ${editBeforeRetry ? 'and later edits ' : ''}without duplicate estimates`, async () => {
  const {tray,plugin} = await setup();
  await tray.addSelection(food('Existing oats'),null,{enrich:false});
  await tray.persistDraft();
  plugin.app.vault.getName = () => 'Synthetic Describe Save Failure';
  const stored=new Map();
  window.localStorage = {getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  const workflow={version:2,id:'describe-save-failure',description:'banana',createdAt:new Date().toISOString(),dateContext:null,preparedSelectionItems:[{item:food('Banana'),quantity:1,unit:'serving'}]};
  plugin.writePendingFoodDescribeWorkflow(workflow);
  let saves=0;
  const saveSettings=plugin.saveSettings.bind(plugin);
  plugin.saveSettings=async ()=>{
    if (++saves===1) throw new Error('Synthetic settings save failure');
    await saveSettings();
  };
  let fallbackCalls=0;
  plugin.legacyOpenFoodDescriber=async ()=>{
    fallbackCalls++;
    await plugin.appendDescribedFoods(workflow.preparedSelectionItems,null,'fallback-should-not-run');
    return null;
  };
  await assert.rejects(plugin.runFoodDescribeWorkflow(workflow), /Synthetic settings save failure/);
  assert.equal(fallbackCalls,0,'a storage failure is not an AI failure');
  assert.equal(plugin.readPendingFoodDescribeWorkflow()?.id,workflow.id);
  assert.deepEqual(plugin.settings.pendingFoodLogDraft.selectionItems.map(e=>e.item.name),['Existing oats','Banana']);
  if (editBeforeRetry) {
    tray.selectionItems.find(entry=>entry.item.name==='Banana').quantity=3;
    await tray.persistDraft();
    assert.notEqual(plugin.settings.pendingFoodLogDraft.id,workflow.id,'editing must exercise a different modal owner');
    assert.equal(plugin.readPendingFoodDescribeWorkflow(),null,'a durable edit acknowledges the published estimates');
  } else {
    await plugin.runFoodDescribeWorkflow(plugin.readPendingFoodDescribeWorkflow());
  }
  assert.ok(saves>=2,'retry must actually persist the already prepared tray');
  assert.equal(fallbackCalls,0);
  assert.equal(plugin.readPendingFoodDescribeWorkflow(),null);
  assert.deepEqual(plugin.settings.pendingFoodLogDraft.selectionItems.map(e=>e.item.name),['Existing oats','Banana']);
  assert.equal(plugin.settings.pendingFoodLogDraft.selectionItems.find(entry=>entry.item.name==='Banana').quantity,editBeforeRetry ? 3 : 1);
  tray.onClose();
});


for (const action of ['log','remove','clear']) test(`successfully ${action === 'log' ? 'logging' : action === 'remove' ? 'removing an estimate from' : 'clearing'} a tray after a Describe save failure prevents resurrection on resume`, async () => {
  const {tray,plugin}=await setup();
  await tray.addSelection(food('Existing oats'),null,{enrich:false});
  await tray.persistDraft();
  const workflow={version:2,id:`describe-after-save-failure-${action}`,description:'banana',createdAt:new Date().toISOString(),dateContext:null,preparedSelectionItems:[{item:food('Described banana'),quantity:1,unit:'serving'}]};
  plugin.writePendingFoodDescribeWorkflow(workflow);
  let saves=0;
  const saveSettings=plugin.saveSettings.bind(plugin);
  plugin.saveSettings=async ()=>{
    if (++saves===1) throw new Error('Synthetic settings save failure');
    await saveSettings();
  };
  await assert.rejects(plugin.runFoodDescribeWorkflow(workflow),/Synthetic settings save failure/);
  assert.equal(plugin.readPendingFoodDescribeWorkflow()?.id,workflow.id);
  assert.deepEqual(tray.selectionItems.map(entry=>entry.item.name),['Existing oats','Described banana']);
  const logged=[];
  plugin.logFood=async item=>{logged.push(item.name);};
  if (action==='log') {
    await tray.logSelected();
    assert.deepEqual(logged,['Existing oats','Described banana']);
  } else {
    const control=walk(tray.selectionEl).find(node=>action==='clear' ? node.text==='Clear tray' : node.attributes?.['aria-label']==='Remove Described banana');
    assert.ok(control,'exercise the visible tray action');
    control.listeners.get('click')();
    for (let i=0;i<8;i++) await turn();
    assert.deepEqual(logged,[]);
  }
  const expectedRemaining=action==='remove' ? ['Existing oats'] : [];
  assert.deepEqual(tray.selectionItems.map(entry=>entry.item.name),expectedRemaining);
  assert.equal(plugin.readPendingFoodDescribeWorkflow(),null,'successful persistence must acknowledge the prepared workflow');
  tray.onClose();
  await plugin.resumePendingFoodDescribeWorkflow('layout-ready');
  assert.deepEqual(plugin.settings.pendingFoodLogDraft?.selectionItems.map(entry=>entry.item.name)||[],expectedRemaining);
  assert.equal(plugin.readPendingFoodDescribeWorkflow(),null);
});

test('macro rings, rows, nutrient contributions and food summaries display one decimal', async () => {
  const {renderNativeDailyMacrosBlock} = await importPluginWithObsidianStub();
  const metric = {propertyKey:'protein',label:'Protein',value:12.345,unit:'g',targetLabel:'up to 20 g',progress:.61725,state:'within'};
  const food = {title:'Precision fixture',path:'Inbox/Precision.md',calories:123.456,proteinG:12.345,carbsG:23.456,fatG:3.678,quantity:.025,unit:'serving'};
  for (const macroStyle of ['rings','table']) {
    const root=nativeTrayTestElement(), actions={disclosures:new Map(),components(){},addFood(){},openFoodEntry(){},editFoodEntry(){},removeFoodEntry(){}};
    renderNativeDailyMacrosBlock(root,{metrics:[metric],calories:123.456,entryCount:1},[food],{macroStyle,foodList:'expanded',nutrientRows:'expanded'},actions);
    const ring=walk(root).find(n=>n.className==='tps-health-native-ring-button');
    if(ring){ assert.match(ring.attributes['aria-label'],/Protein: 12\.3 g/); ring.listeners.get('click')(); }
    const text=walk(root).map(n=>n.text).join(' ');
    assert.match(text,/123\.5 kcal/); assert.match(text,/12\.3 g/); assert.match(text,/P 12\.3g · C 23\.5g · F 3\.7g/);
    assert.match(text,/0\.025 serving/); assert.doesNotMatch(text,/12\.345|123\.456/);
  }
  assert.equal(food.proteinG,12.345); assert.equal(metric.value,12.345);
});

test('the day banner stays visible across food modes and updates with the tray consumed date', async () => {
  const {tray}=await setup();
  const banner=tray.dateBannerEl;
  assert.equal(banner.parentElement,tray.contentEl);
  assert.equal(banner.attributes['role'],'status'); assert.equal(banner.attributes['aria-atomic'],'true');
  tray.consumedDateInput='2000-01-01T12:00'; tray.renderSelection();
  assert.equal(banner.attributes['data-date-state'],'past');
  assert.equal(walk(banner).find(n=>n.className==='tps-health-log-date-icon').dataset.icon,'moon');
  walk(tray.contentEl).find(n=>n.className==='tps-health-food-tab'&&n.text==='Describe').listeners.get('click')();
  assert.equal(banner.parentElement,tray.contentEl); assert.equal(banner.attributes['data-date-state'],'past');
  tray.selectionItems=[{item:food('Oats'),quantity:1,unit:'serving'}];
  let timeInput;
  globalThis.__TPSHealthTestSettingControl=(type,name,callback)=> {
    const control={inputEl:nativeTrayTestElement('input'),setValue(v){this.inputEl.value=v;return this;},setPlaceholder(){return this;},onChange(){return this;}};
    callback(control); if(name==='Consumed time')timeInput=control.inputEl;
  };
  try {tray.renderSelection();} finally {delete globalThis.__TPSHealthTestSettingControl;}
  timeInput.value='2099-01-01T12:00'; timeInput.listeners.get('input')();
  assert.equal(banner.attributes['data-date-state'],'future');
  assert.equal(walk(banner).find(n=>n.className==='tps-health-log-date-icon').dataset.icon,'calendar');
  timeInput.value=''; timeInput.listeners.get('input')();
  assert.equal(banner.attributes['data-date-state'],'today');
});

test('single-food date banner tracks the picker and Now/selected-day buttons together', async () => {
  installDeterministicBrowserGlobals();
  const {default:Plugin,FoodLogModal}=await importPluginWithObsidianStub();
  const plugin=new Plugin(createFakeHealthApp().app);
  const modal=new FoodLogModal(plugin.app,plugin,food('Oats'),null,{dateIso:'2000-01-01',label:'Jan 1, 2000',isToday:false});
  modal.contentEl=nativeTrayTestElement(); modal.modalEl=nativeTrayTestElement();
  const controls=[];
  globalThis.__TPSHealthTestSettingControl=(type,name,callback)=>{
    const c={type,name,inputEl:nativeTrayTestElement('input'),buttonEl:nativeTrayTestElement('button'),setValue(v){this.inputEl.value=v;return this;},setPlaceholder(){return this;},setButtonText(v){this.label=v;return this;},setCta(){return this;},addOption(){return this;},onChange(fn){this.change=fn;return this;},onClick(fn){this.click=fn;return this;}};
    callback(c);controls.push(c);
  };
  try {modal.onOpen();} finally {delete globalThis.__TPSHealthTestSettingControl;}
  const banner=walk(modal.contentEl).find(n=>n.className==='tps-health-log-date-banner');
  const time=controls.find(c=>c.name==='Consumed time');
  assert.equal(banner.attributes['data-date-state'],'past');
  time.change('2099-01-01T12:00'); assert.equal(banner.attributes['data-date-state'],'future');
  controls.find(c=>c.label==='Now').click(); assert.equal(banner.attributes['data-date-state'],'today');
  assert.ok(!time.inputEl.value.startsWith('2099'));
  controls.find(c=>c.label==='Jan 1, 2000').click();
  assert.equal(banner.attributes['data-date-state'],'past'); assert.equal(time.inputEl.value,'2000-01-01T00:00');
});


test('tray and search log actions share submission and stay synchronized', async () => {
  const {tray}=await setup();
  await tray.addSelection(food('Oats'),null,{enrich:false});
  const buttons=()=>walk(tray.selectionEl).filter(n=>n.className.includes('tps-health-selection-log'));
  assert.equal(buttons().length,2);
  const review=walk(tray.selectionEl).find(n=>n.className==='tps-health-review-actions');
  const log=review.children.find(n=>n.className.includes('tps-health-selection-log'));
  assert.equal(log.text,'Log 1 food');
  let calls=0;tray.logSelected=async()=>{calls++;};
  await log.listeners.get('click')();assert.equal(calls,1);
  tray.selectionEl.querySelectorAll=()=>buttons();
  tray.selectionItems.push({item:food('Milk'),quantity:1,unit:'serving'});
  tray.refreshSelectionSummary();
  assert.ok(buttons().every(b=>b.text==='Log 2 foods'&&!b.disabled));
  tray.selectionSubmitting=true;tray.refreshSelectionSummary();
  assert.ok(buttons().every(b=>b.text==='Logging…'&&b.disabled&&b.attributes['aria-busy']==='true'));
  tray.selectionSubmitting=false;tray.selectionItems=[];tray.refreshSelectionSummary();
  assert.ok(buttons().every(b=>b.disabled&&b.attributes['aria-busy']==='false'));
});
