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
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener() {}, listeners,
    createEl(tag, options) { const child = nativeTrayTestElement(tag, options); child.parentElement = this; this.children.push(child); return child; },
    createDiv(options) { return this.createEl("div", options); }, createSpan(options) { return this.createEl("span", options); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() {}, blur() {}, scrollIntoView() {},
  };
  return node;
}

const walk = node => [node, ...node.children.flatMap(walk)];
const turn = () => new Promise(resolve => setImmediate(resolve));

const food = name => ({ id: name, name, source: "custom-note", servingAmount: 1, servingUnit: "serving", nutrition: { calories: 100 } });
async function setup() {
  installDeterministicBrowserGlobals();
  const { default: Plugin, FoodSearchModal } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp(), plugin = new Plugin(fake.app);
  const tray = new FoodSearchModal(fake.app, plugin);
  const h = { tray, plugin };
  tray.searchInput = "";
  tray.contentEl = nativeTrayTestElement(); tray.modalEl = nativeTrayTestElement();
  h.plugin.getLoggedFoodStats = async () => new Map();
  h.plugin.getSavedFoods = async () => [food("Saved oats")];
  globalThis.__TPSHealthTestSettingControl = (_type, _name, callback) => {
    const control = { inputEl: nativeTrayTestElement("input"), buttonEl: nativeTrayTestElement("button"),
      setValue(value) { this.inputEl.value = value; return this; }, setPlaceholder() { return this; },
      setButtonText() { return this; }, setCta() { return this; }, onChange() { return this; },
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
