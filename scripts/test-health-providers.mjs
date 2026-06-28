import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const USER_AGENT = "TPSHealth/0.1 (Obsidian plugin test)";

async function importFormatUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/format.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importSettingsNormalizationUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/settings-normalization.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importPluginWithObsidianStub() {
  const obsidianStub = `
    export class TFile {
      constructor(path) {
        this.path = path;
        this.basename = path.split("/").pop().replace(/\\.md$/i, "");
        const parentPath = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
        this.parent = parentPath ? { path: parentPath } : null;
      }
    }
    globalThis.__TPSHealthTestTFile = TFile;
    export class Plugin {
      constructor(app) { this.app = app; }
      addCommand() {}
      addSettingTab() {}
      registerBasesView() {}
      registerEditorExtension() {}
      registerEvent() {}
      loadData() { return null; }
      saveData() {}
    }
    export class Modal { constructor(app) { this.app = app; } open() {} close() {} }
    export class Notice { constructor(message) { globalThis.__TPSHealthTestNotices?.push(String(message)); } }
    export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; } display() {} }
    export class Setting { constructor() {} setName() { return this; } setDesc() { return this; } addText() { return this; } addButton() { return this; } }
    export class MarkdownView {}
    export class EditorSuggest {}
    export class BasesView {}
    export class App {}
    export const editorLivePreviewField = {};
    export function normalizePath(path) {
      return String(path || "").replace(/\\\\/g, "/").replace(/\\/+/g, "/").replace(/^\\.\\//, "");
    }
    export async function requestUrl() { return { json: {} }; }
  `;
  const emptyModule = "export class RangeSetBuilder {} export class Decoration {} export class ViewPlugin {} export class WidgetType {} export const EditorView = {}; export const DecorationSet = {}; export class ViewUpdate {}";
  const zxingBrowserStub = "export class BrowserMultiFormatOneDReader {} export class BrowserMultiFormatReader {}";
  const zxingLibraryStub = "export const BarcodeFormat = {}; export const DecodeHintType = {};";
  const virtualModules = new Map([
    ["obsidian", obsidianStub],
    ["@codemirror/state", emptyModule],
    ["@codemirror/view", emptyModule],
    ["@zxing/browser", zxingBrowserStub],
    ["@zxing/library", zxingLibraryStub],
  ]);
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "virtual-test-stubs",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (virtualModules.has(args.path)) return { path: args.path, namespace: "test-stub" };
          return null;
        });
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, (args) => ({
          contents: virtualModules.get(args.path),
          loader: "js",
        }));
      },
    }],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

function createFakeHealthApp() {
  const files = new Map();
  const folders = new Set();
  const writes = [];
  const TFile = globalThis.__TPSHealthTestTFile;
  const metadataCache = {
    getFileCache(file) {
      return { frontmatter: parseFrontmatter(files.get(file.path) || "") };
    },
  };
  const vault = {
    configDir: ".obsidian",
    adapter: { read: async () => { throw new Error("no daily-notes config"); } },
    getMarkdownFiles: () => Array.from(files.keys()).sort().map((path) => new TFile(path)),
    getAbstractFileByPath(path) {
      if (files.has(path)) return new TFile(path);
      if (folders.has(path)) return { path };
      return null;
    },
    async create(path, content) {
      if (files.has(path)) throw new Error(`File exists: ${path}`);
      files.set(path, content);
      writes.push({ op: "create", path, content });
      return new TFile(path);
    },
    async createFolder(path) {
      folders.add(path);
      writes.push({ op: "mkdir", path });
    },
    async read(file) {
      return files.get(file.path) || "";
    },
    async cachedRead(file) {
      return files.get(file.path) || "";
    },
    async modify(file, content) {
      files.set(file.path, content);
      writes.push({ op: "modify", path: file.path, content });
    },
    async append(file, content) {
      files.set(file.path, `${files.get(file.path) || ""}${content}`);
      writes.push({ op: "append", path: file.path, content });
    },
  };
  return {
    app: {
      vault,
      metadataCache,
      fileManager: {
        async processFrontMatter(file, updater) {
          const current = parseFrontmatter(files.get(file.path) || "");
          updater(current);
          const body = stripFrontmatter(files.get(file.path) || "");
          files.set(file.path, `${frontmatterToYaml(current)}${body}`);
          writes.push({ op: "frontmatter", path: file.path, frontmatter: current });
        },
      },
      workspace: {
        getActiveFile: () => null,
        getLeaf: () => ({
          openFile: async () => {},
          setPinned: () => {},
          view: {},
        }),
      },
      internalPlugins: { getPluginById: () => null, plugins: {} },
      plugins: { plugins: {}, getPlugin: () => null },
    },
    files,
    folders,
    writes,
  };
}

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end < 0) return {};
  const frontmatter = {};
  for (const line of content.slice(4, end).split("\n")) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    else if (/^-?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
    else if (value === "true" || value === "false") value = value === "true";
    frontmatter[match[1].trim()] = value;
  }
  return frontmatter;
}

function stripFrontmatter(content) {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  return end < 0 ? content : content.slice(end + 5).replace(/^\n/, "");
}

function frontmatterToYaml(frontmatter) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value == null) continue;
    lines.push(`${key}: ${typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(String(value))}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function installDeterministicBrowserGlobals() {
  globalThis.__TPSHealthTestNotices = [];
  globalThis.window = {
    moment: (value) => createFakeMoment(value),
    setTimeout: (callback) => {
      if (typeof callback === "function") callback();
      return 0;
    },
    clearTimeout: () => {},
  };
  globalThis.document = { querySelectorAll: () => [] };
}

function createFakeMoment(value) {
  const date = value ? new Date(value) : new Date("2026-06-24T12:00:00.000Z");
  return {
    isValid: () => !Number.isNaN(date.getTime()),
    format(format) {
      if (format === "YYYY-MM-DD") return date.toISOString().slice(0, 10);
      return date.toISOString().slice(0, 10);
    },
    isSame(other, unit) {
      const otherDate = other?.toDate?.() || new Date("2026-06-24T12:00:00.000Z");
      return unit === "day" && date.toISOString().slice(0, 10) === otherDate.toISOString().slice(0, 10);
    },
    toDate: () => date,
  };
}

test("USDA Foundation search returns generic apple macros per 100g", async (t) => {
  const response = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: "apple",
      dataType: ["Foundation"],
      pageSize: 3,
      pageNumber: 1,
      requireAllWords: false,
    }),
  });
  if (!response.ok) {
    t.skip(`USDA public API returned HTTP ${response.status}`);
    return;
  }
  const json = await response.json();
  assert.equal(Array.isArray(json.foods), true);
  assert.ok(json.foods.length > 0);
  const nutrients = json.foods[0].foodNutrients;
  assert.ok(nutrientValue(nutrients, [2047, 2048, 1008]) > 0, "expected calories");
  assert.ok(nutrientValue(nutrients, [1005]) > 0, "expected carbs");
});

test("Open Food Facts barcode lookup returns a packaged product with macro data", async (t) => {
  const response = await fetch("https://world.openfoodfacts.org/api/v2/product/737628064502.json?fields=code,product_name,brands,nutriments", {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!response.ok) {
    t.skip(`Open Food Facts returned HTTP ${response.status}`);
    return;
  }
  const json = await response.json();
  assert.equal(json.status, 1);
  assert.ok(json.product.product_name);
  assert.ok(hasMacroData(json.product.nutriments));
});

test("daily food rollup parser handles TPS Health food lines", () => {
  const content = [
    '- Apple - 2 100 g - 116.4 kcal [food:: Apple] [qty:: 2] [unit:: 100 g] [cal:: 116.4] [protein:: 0.2] [carbs:: 31.4] [fat:: 0.4] [fiber:: 4.2] [sugar:: 26.6] [sodium:: 2] [createdDate:: 2026-06-01T10:00:00.000Z]',
    '- Yogurt - 1 serving - 120 kcal [food:: Yogurt] [qty:: 1] [unit:: serving] [cal:: 120] [protein:: 15] [carbs:: 8] [fat:: 2] [createdDate:: 2026-06-01T12:00:00.000Z]',
    '- Skipped - 0 serving - 999 kcal [food:: Skipped] [qty:: 0] [unit:: serving] [cal:: 999] [protein:: 999] [carbs:: 999] [fat:: 999] [createdDate:: 2026-06-01T15:00:00.000Z]',
  ].join("\n");
  const totals = calculateFoodTotals(content);
  assert.equal(round(totals.calories), 236.4);
  assert.equal(round(totals.proteinG), 15.2);
  assert.equal(round(totals.carbsG), 39.4);
  assert.equal(round(totals.fatG), 2.4);
});

test("daily food rollup parser handles common packaged foods and fractional servings", () => {
  const content = [
    '- Barebells Cookies & Cream Protein Bar - 0.5 bar - 100 kcal [food:: Barebells Cookies & Cream Protein Bar] [qty:: 0.5] [unit:: bar] [cal:: 100] [protein:: 10] [carbs:: 10] [fat:: 3.5] [fiber:: 1.5] [sugar:: 0.5] [sodium:: 95]',
    '- Fairlife 2% Ultra-Filtered Milk - 2 cup - 240 kcal [food:: Fairlife 2% Ultra-Filtered Milk] [qty:: 2] [unit:: cup] [cal:: 240] [protein:: 26] [carbs:: 12] [fat:: 9] [sugar:: 12] [sodium:: 240]',
    '- Legendary Foods Protein Pastry - 1 pastry - 180 kcal [food:: Legendary Foods Protein Pastry] [qty:: 1] [unit:: pastry] [cal:: 180] [protein:: 20] [carbs:: 22] [fat:: 9] [fiber:: 6] [sugar:: 1] [sodium:: 360]',
    '- Ramen - 1 package - 380 kcal [food:: Ramen] [qty:: 1] [unit:: package] [cal:: 380] [protein:: 35] [carbs:: 52] [fat:: 14] [fiber:: 2] [sugar:: 2] [sodium:: 1600]',
  ].join("\n");
  const totals = calculateFoodTotals(content);
  assert.equal(round(totals.calories), 900);
  assert.equal(round(totals.proteinG), 91);
  assert.equal(round(totals.carbsG), 96);
  assert.equal(round(totals.fatG), 35.5);
  assert.equal(round(totals.sodiumMg), 2295);
});

test("daily food rollup parser resolves nutrients from food notes and metric amounts", () => {
  const content = [
    '- [[Health/Foods/Barebells Cookies & Cream Protein Bar|Barebells Cookies & Cream Protein Bar]] - 0.5 bar [food:: Barebells Cookies & Cream Protein Bar] [qty:: 0.5] [unit:: bar] [servings:: 0.5] [amount:: 27.5] [amountUnit:: g] [cal:: 100] [protein:: 10] [carbs:: 10] [fat:: 3.5] [fiber:: 1.5] [sugar:: 0.5] [sodium:: 95] [source:: custom-note] [foodPath:: Health/Foods/Barebells Cookies & Cream Protein Bar.md]',
    '- [[Health/Foods/Fairlife 2% Ultra-Filtered Milk|Fairlife 2% Ultra-Filtered Milk]] - 2 cup [food:: Fairlife 2% Ultra-Filtered Milk] [qty:: 2] [unit:: cup] [servings:: 2] [amount:: 480] [amountUnit:: ml] [cal:: 240] [protein:: 26] [carbs:: 12] [fat:: 9] [sugar:: 12] [sodium:: 240] [source:: custom-note] [foodPath:: Health/Foods/Fairlife 2% Ultra-Filtered Milk.md]',
  ].join("\n");
  const foods = new Map([
    ["Health/Foods/Barebells Cookies & Cream Protein Bar.md", { servingGrams: 55, nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7, fiberG: 3, sugarG: 1, sodiumMg: 190 } }],
    ["Health/Foods/Fairlife 2% Ultra-Filtered Milk.md", { servingMl: 240, nutrition: { calories: 120, proteinG: 13, carbsG: 6, fatG: 4.5, sugarG: 6, sodiumMg: 120 } }],
  ]);
  const totals = calculateFoodTotals(content, (foodPath) => foods.get(foodPath));
  assert.equal(round(totals.calories), 340);
  assert.equal(round(totals.proteinG), 36);
  assert.equal(round(totals.carbsG), 22);
  assert.equal(round(totals.fatG), 12.5);
  assert.equal(round(totals.sodiumMg), 335);
});

test("daily food rollup remains compatible with older linked lines that stored per-serving macros", () => {
  const content = '- [[Health/Foods/Barebells Cookies & Cream Protein Bar|Barebells Cookies & Cream Protein Bar]] - 2 bar [food:: Barebells Cookies & Cream Protein Bar] [qty:: 2] [unit:: bar] [servings:: 2] [amount:: 110] [amountUnit:: g] [cal:: 200] [protein:: 20] [carbs:: 20] [fat:: 7] [source:: custom-note] [foodPath:: Health/Foods/Barebells Cookies & Cream Protein Bar.md]';
  const foods = new Map([
    ["Health/Foods/Barebells Cookies & Cream Protein Bar.md", { servingGrams: 55, nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7 } }],
  ]);
  const totals = calculateFoodTotals(content, (foodPath) => foods.get(foodPath));
  assert.equal(round(totals.calories), 400);
  assert.equal(round(totals.proteinG), 40);
  assert.equal(round(totals.carbsG), 40);
  assert.equal(round(totals.fatG), 14);
});

test("daily food rollup merges partial inline overrides with food-note nutrition", () => {
  const content = '- [[Health/Foods/Barebells Cookies & Cream Protein Bar|Barebells Cookies & Cream Protein Bar]] - 0.5 bar [food:: Barebells Cookies & Cream Protein Bar] [qty:: 0.5] [unit:: bar] [servings:: 0.5] [amount:: 27.5] [amountUnit:: g] [protein:: 12] [foodPath:: Health/Foods/Barebells Cookies & Cream Protein Bar.md]';
  const foods = new Map([
    ["Health/Foods/Barebells Cookies & Cream Protein Bar.md", { servingGrams: 55, nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7 } }],
  ]);
  const totals = calculateFoodTotals(content, (foodPath) => foods.get(foodPath));
  assert.equal(round(totals.calories), 100);
  assert.equal(round(totals.proteinG), 12);
  assert.equal(round(totals.carbsG), 10);
  assert.equal(round(totals.fatG), 3.5);
});

test("daily food rollup parser handles one slice from a two-slice bread serving", () => {
  const content = '- [[Health/Foods/Sara Lee Delightful White Bread|Sara Lee Delightful White Bread]] - 1 slice [food:: Sara Lee Delightful White Bread] [qty:: 1] [unit:: slice] [servings:: 0.5] [amount:: 22.5] [amountUnit:: g] [cal:: 45] [protein:: 2.5] [carbs:: 9] [fat:: 0.5] [fiber:: 2.5] [sugar:: 1] [sodium:: 95] [source:: custom-note] [foodPath:: Health/Foods/Sara Lee Delightful White Bread.md]';
  const foods = new Map([
    ["Health/Foods/Sara Lee Delightful White Bread.md", { servingGrams: 45, nutrition: { calories: 90, proteinG: 5, carbsG: 18, fatG: 1, fiberG: 5, sugarG: 2, sodiumMg: 190 } }],
  ]);
  const totals = calculateFoodTotals(content, (foodPath) => foods.get(foodPath));
  assert.equal(round(totals.calories), 45);
  assert.equal(round(totals.proteinG), 2.5);
  assert.equal(round(totals.carbsG), 9);
  assert.equal(round(totals.sodiumMg), 95);
});

test("linked food entry lines store instance data and resolve nutrition from the food note", async () => {
  const { foodEntryLine } = await importFormatUtility();
  const line = foodEntryLine({
    id: "food-test",
    createdDate: "2026-06-04T12:00:00.000Z",
    item: {
      id: "bar",
      name: "Barebells Cookies & Cream Protein Bar",
      source: "custom-note",
      sourcePath: "Health/Foods/Barebells Cookies & Cream Protein Bar.md",
      nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7, sodiumMg: 190 },
    },
    quantity: 2,
    unit: "serving",
    servingQuantity: 2,
    servingUnit: "bar",
    amount: 110,
    amountUnit: "g",
    dailyNotePath: "Daily Notes/Thu, Jun 04 2026.md",
  });
  assert.match(line, /^- 2 bar - \[\[Health\/Foods\/Barebells Cookies & Cream Protein Bar\|Barebells Cookies & Cream Protein Bar\]\]/);
  assert.match(line, /\[servings:: 2\]/);
  assert.match(line, /\[amount:: 110\]/);
  assert.match(line, /\[amountUnit:: g\]/);
  assert.match(line, /\[foodPath:: Health\/Foods\/Barebells Cookies & Cream Protein Bar\.md\]/);
  assert.match(line, /\[dailyNotePath:: Daily Notes\/Thu, Jun 04 2026\.md\]/);
  assert.match(line, /\[dailyNote:: \[\[Daily Notes\/Thu, Jun 04 2026\|Thu, Jun 04 2026\]\]\]/);
  assert.match(line, /\[cal:: 400\]/);
  assert.match(line, /\[protein:: 40\]/);
  assert.match(line, /\[carbs:: 40\]/);
  assert.match(line, /\[fat:: 14\]/);
  assert.match(line, /\[sodium:: 380\]/);
  assert.match(line, /\[source:: custom-note\]/);
  assert.doesNotMatch(line, /\[brand::/);
});

test("single-file food logs can be filtered by scheduled daily note path", () => {
  const content = [
    '- Bar [food:: Bar] [qty:: 1] [unit:: bar] [servings:: 1] [cal:: 200] [protein:: 20] [dailyNotePath:: Daily Notes/Thu, Jun 04 2026.md]',
    '- Milk [food:: Milk] [qty:: 1] [unit:: cup] [servings:: 1] [cal:: 120] [protein:: 13] [dailyNotePath:: Daily Notes/Fri, Jun 05 2026.md]',
    '- Legacy daily inline [food:: Apple] [qty:: 1] [unit:: serving] [cal:: 80] [protein:: 1]',
  ].join("\n");
  const totals = calculateFoodTotals(content, undefined, "Daily Notes/Thu, Jun 04 2026.md");
  assert.equal(round(totals.calories), 280);
  assert.equal(round(totals.proteinG), 21);
});

test("health source keeps session-note workouts and fast rollup paths available", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  const typesSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8"));
  assert.match(typesSource, /export type WorkoutLogTarget = "session-note" \| "daily-note" \| "both"/);
  assert.match(typesSource, /workoutLogTarget: "session-note"/);
  assert.match(mainSource, /logTarget === "session-note" \|\| logTarget === "both"/);
  assert.match(mainSource, /await this\.app\.vault\.create\(path, body\)/);
  assert.match(mainSource, /const dailyFile = await this\.getOrCreateDailyNoteForDate\(completedDate\)/);
  assert.match(mainSource, /await this\.insertIntoDailyNote\(foodEntryLine\(entry\), section \|\| this\.settings\.defaultFoodLogSection, dailyFile\)/);
  assert.match(mainSource, /if \(this\.settings\.automaticDailyRollups\) await this\.updateDailyRollupForFile\(dailyFile\)/);
});

test("settings normalization removes stale fields while preserving live vault config", async () => {
  const { normalizeTPSHealthSettings } = await importSettingsNormalizationUtility();
  const normalized = normalizeTPSHealthSettings({
    foodLogHeading: "Food Log",
    dailyNoteFolder: "Dailynotes",
    foodLogTarget: "single-file",
    foodLogFilePath: "Tracked/Food.md",
    workoutLogTarget: "both",
    workoutLogHeading: "Training",
    rollupHeading: "Legacy Rollup",
    includeBrandedFoodSearch: true,
    defaultWorkoutCooldownDays: 3,
    activeWorkoutSetCount: "bad",
    workoutSetStorage: "invalid",
    healthGoals: [
      { propertyKey: " cal ", label: " Calories ", unit: " kcal ", kind: "max", max: 2100 },
      { propertyKey: "steps", label: "Steps", unit: "", kind: "not-real", min: "bad" },
    ],
  });

  assert.equal(Object.hasOwn(normalized, "foodLogHeading"), false);
  assert.equal(normalized.dailyNoteFolder, "Dailynotes");
  assert.equal(normalized.foodLogTarget, "single-file");
  assert.equal(normalized.foodLogFilePath, "Tracked/Food.md");
  assert.equal(normalized.workoutLogTarget, "both");
  assert.equal(normalized.workoutLogHeading, "Training");
  assert.equal(normalized.rollupHeading, "Legacy Rollup");
  assert.equal(normalized.includeBrandedFoodSearch, true);
  assert.equal(normalized.defaultWorkoutCooldownDays, 3);
  assert.equal(normalized.activeWorkoutSetCount, 0);
  assert.equal(normalized.workoutSetStorage, "task");
  assert.deepEqual(normalized.healthGoals, [
    { propertyKey: "cal", label: "Calories", unit: "kcal", kind: "max", min: undefined, max: 2100, color: undefined },
    { propertyKey: "steps", label: "Steps", unit: "", kind: "counter", min: undefined, max: undefined, color: undefined },
  ]);
});

test("blank default food log section stays a no-heading frontmatter insertion contract", async () => {
  const { normalizeTPSHealthSettings } = await importSettingsNormalizationUtility();
  const normalized = normalizeTPSHealthSettings({ defaultFoodLogSection: "   " });
  assert.equal(normalized.defaultFoodLogSection, "");

  const [mainSource, settingsSource, typesSource, readmeSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/settings.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
  ]);
  assert.match(typesSource, /defaultFoodLogSection: ""/);
  assert.match(mainSource, /private async insertIntoDailyNote\(line: string, section\?: string, targetFile\?: TFile\): Promise<TFile> \{\s+const file = targetFile \|\| await this\.getOrCreateDailyNote\(\);\s+if \(section\?\.trim\(\)\) return this\.appendToDailyHeading\(section\.trim\(\), line, file\);\s+const content = await this\.app\.vault\.read\(file\);\s+const insertAt = frontmatterEndIndex\(content\);/);
  assert.match(mainSource, /private async insertIntoFoodLogFile\(line: string, section\?: string\): Promise<TFile> \{\s+const file = await this\.getFoodLogFile\(true\);\s+if \(!file\) throw new Error\("Food log file is not available"\);\s+if \(section\?\.trim\(\)\) return this\.appendToHeading\(file, section\.trim\(\), line\);\s+await this\.app\.vault\.append\(file, `\$\{line\}\\n`\);/);
  assert.match(settingsSource, /\.setName\("Default food log section"\)\s+\.setDesc\("Optional\. Blank inserts food logs immediately after daily-note frontmatter\."\)[\s\S]+\.setPlaceholder\("Food Log"\)[\s\S]+defaultFoodLogSection = value\.trim\(\);/);
  assert.match(readmeSource, /`Default food log section` is intentionally blank by default\. Blank keeps food entries unheaded and inserts daily-note entries immediately after frontmatter; `Food Log` is only the settings placeholder suggestion, not the persisted default\./);
});

test("whole-note workouts use calendar fields and set task tracking", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  const typesSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8"));
  assert.match(typesSource, /activeWorkoutSetCount: number/);
  assert.match(typesSource, /workoutSessionBodyMode: "blank"/);
  assert.match(typesSource, /workoutExerciseLayout: "flat"/);
  assert.match(typesSource, /workoutSetNotation: "compact"/);
  assert.match(typesSource, /workoutSetStorage: "task"/);
  assert.match(mainSource, /frontmatter\.scheduled = frontmatter\.scheduled \|\| startedAt/);
  assert.match(mainSource, /frontmatter\.timeEstimate = durationMinutes/);
  assert.match(mainSource, /frontmatter\.durationSeconds = durationSeconds/);
  assert.match(mainSource, /frontmatter\.allDay = false/);
  assert.match(mainSource, /frontmatter\.setCount = Math\.max/);
  assert.match(mainSource, /asTask: this\.settings\.workoutSetStorage === "task"/);
  assert.match(mainSource, /appendSetToWorkoutNote/);
  assert.doesNotMatch(mainSource, /"# \{\{title\}\}"/);
  assert.match(mainSource, /normalizeWorkoutNoteSetTasks/);
  assert.match(mainSource, /frontmatterLineEnd\(lines\)/);
  assert.match(mainSource, /if \(!isChecked && !hasSetId\) continue/);
  assert.match(mainSource, /workoutSession: \["workoutId", "workout", "workoutPlanPath", "scheduled", "startedAt", "endedAt", "timeEstimate"/);
  assert.match(mainSource, /new StartWorkoutModal\(this\.app, this, await this\.getActiveDailyNoteDateContext\(\)\)\.open\(\)/);
  assert.match(mainSource, /await this\.openPinnedWorkoutFile\(file\)/);
  assert.match(mainSource, /await this\.startGcmWorkoutTimer/);
  assert.match(mainSource, /await this\.stopGcmWorkoutTimer/);
  assert.match(mainSource, /timeTracking\.startTimer/);
  assert.match(mainSource, /timeTracking\.stopActiveTimerForFile/);
});

test("active workout template commands guard before opening modals", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /id: "finish-and-save-workout-template",\s*name: "Finish active workout and save template",\s*callback: \(\) => this\.openFinishWorkoutTemplateModal\(\)/);
  assert.match(mainSource, /id: "save-active-workout-template",\s*name: "Save active workout template",\s*callback: \(\) => this\.openSaveWorkoutTemplateModal\(\)/);
  assert.match(mainSource, /private openFinishWorkoutTemplateModal\(\): void \{\s*if \(!this\.getActiveWorkoutState\(\)\) \{\s*new Notice\("No active workout"\);\s*return;\s*\}\s*new FinishWorkoutTemplateModal\(this\.app, this\)\.open\(\);/);
  assert.match(mainSource, /private openSaveWorkoutTemplateModal\(\): void \{\s*if \(!this\.getActiveWorkoutState\(\)\) \{\s*new Notice\("No active workout"\);\s*return;\s*\}\s*new SaveWorkoutTemplateModal\(this\.app, this\)\.open\(\);/);
});

test("one-off food entry lines without a food note keep nutrition for rollups", async () => {
  const { foodEntryLine } = await importFormatUtility();
  const line = foodEntryLine({
    id: "food-test",
    createdDate: "2026-06-04T12:00:00.000Z",
    item: {
      id: "inline",
      name: "Manual shake",
      source: "custom-inline",
      nutrition: { calories: 220, proteinG: 30, carbsG: 12, fatG: 4 },
    },
    quantity: 1,
    unit: "serving",
    servingQuantity: 1,
    servingUnit: "serving",
  });
  assert.match(line, /\[cal:: 220\]/);
  assert.match(line, /\[protein:: 30\]/);
  assert.match(line, /\[carbs:: 12\]/);
  assert.match(line, /\[fat:: 4\]/);
  assert.doesNotMatch(line, /\[foodPath::/);
});

test("linked food entry lines keep nutrition overrides out of the note", async () => {
  const { foodEntryLine } = await importFormatUtility();
  const line = foodEntryLine({
    id: "food-test",
    createdDate: "2026-06-04T12:00:00.000Z",
    item: {
      id: "bar",
      name: "Barebells Cookies & Cream Protein Bar",
      source: "custom-note",
      sourcePath: "Health/Foods/Barebells Cookies & Cream Protein Bar.md",
      nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7 },
    },
    nutritionOverride: { calories: 100, proteinG: 10 },
    quantity: 0.5,
    unit: "serving",
    servingQuantity: 0.5,
    servingUnit: "bar",
    amount: 27.5,
    amountUnit: "g",
  });
  assert.match(line, /\[foodPath:: Health\/Foods\/Barebells Cookies & Cream Protein Bar\.md\]/);
  assert.match(line, /\[cal:: 100\]/);
  assert.match(line, /\[protein:: 10\]/);
});

test("food log modal displays serving conversion and computed macros without persisting them", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  const formatSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/format.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /const summaryEl = this\.contentEl\.createDiv\(\{ cls: "tps-health-log-summary" \}\)/);
  assert.match(mainSource, /servingEl\.setText\(parts\.join\(" = "\)\)/);
  assert.match(mainSource, /renderMacroPills\(nutritionEl, multiplyNutrition\(this\.item\.nutrition \|\| \{\}, resolved\.servings\)\)/);
  assert.match(formatSource, /if \(entry\.nutritionOverride\) return entry\.nutritionOverride;\s+return scaleNutrition\(entry\.item\.nutrition \|\| \{\}, entry\.quantity\);/);
});

test("inline food draft parser handles overrides and half servings", () => {
  const draft = parseInlineFoodDraft("- 1/2 barebells [protein: 10] [cal: 100]");
  assert.deepEqual(draft, {
    query: "barebells",
    quantity: 0.5,
    unit: undefined,
    sourcePath: undefined,
    hasExplicitAmount: true,
    overrides: { protein: 10, cal: 100 },
  });

  const milk = parseInlineFoodDraft("- 2 fairlife milk cups");
  assert.equal(milk.query, "fairlife milk");
  assert.equal(milk.quantity, 2);
  assert.equal(milk.unit, "cup");

  const linked = parseInlineFoodDraft("- [[Foods/Legendary Foods Protein Pastry, Brown Sugar Cinnamon|Legendary Foods Protein Pastry, Brown Sugar Cinnamon]] - 61 g");
  assert.equal(linked.query, "Legendary Foods Protein Pastry, Brown Sugar Cinnamon");
  assert.equal(linked.quantity, 61);
  assert.equal(linked.unit, "g");
  assert.equal(linked.sourcePath, "Foods/Legendary Foods Protein Pastry, Brown Sugar Cinnamon.md");
  assert.equal(linked.hasExplicitAmount, true);

  const compact = parseInlineFoodDraft("- 300g apples");
  assert.equal(compact.query, "apples");
  assert.equal(compact.quantity, 300);
  assert.equal(compact.unit, "g");
  assert.equal(compact.hasExplicitAmount, true);
});

test("inline food draft parser rejects ordinary checkbox and generic list lines", () => {
  assert.equal(
    parseInlineFoodDraft("- [ ] QA task line for GCM/Kanban context menu testing [priority:: normal]"),
    null,
  );
  assert.equal(parseInlineFoodDraft("- review controller follow-up tomorrow"), null);
});

test("complete inline food log command only targets the cursor line", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /const targetLine = cursor\.line;\s+const lineText = editor\.getLine\(targetLine\);\s+const parsed = parseInlineFoodDraft\(lineText\);/);
  assert.doesNotMatch(mainSource, /for \(let line = 0; line < editor\.lineCount\(\); line\+\+\)/);
  assert.doesNotMatch(mainSource, /const finalParsed = parsed \|\|/);
});

test("log food command seeds search and amount from the active inline food draft", async () => {
  const [mainSource, readmeSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
  ]);
  assert.match(mainSource, /this\.openFoodSearchModal\(this\.getActiveInlineFoodDraft\(\), await this\.getActiveDailyNoteDateContext\(\)\)/);
  assert.match(mainSource, /new FoodSearchModal\(this\.app, this, initialDraft, dateContext\)\.open\(\)/);
  assert.doesNotMatch(mainSource, /private async handleNaturalAdd\(input: string\): Promise<void>/);
  assert.match(mainSource, /private async handleBarcodeAdd\(input: string\): Promise<void>/);
  assert.doesNotMatch(mainSource, /function parseQuickFoodInput\(input: string\): QuickFoodInput \| null/);
  assert.doesNotMatch(mainSource, /interface QuickFoodInput/);
  assert.doesNotMatch(mainSource, /function splitQuickFoodConsumedTime\(input: string\)/);
  assert.match(mainSource, /function barcodeFromInput\(input: string\): string \| null/);
  assert.match(mainSource, /async lookupFoodByBarcode\(barcode: string\): Promise<FoodItem \| null>/);
  assert.match(mainSource, /private async lookup\(rawBarcode: string, statusEl\?: HTMLElement\): Promise<void> \{\s+const trimmed = rawBarcode\.trim\(\);\s+if \(!trimmed\) \{\s+new Notice\("Barcode is required"\);\s+return;\s+\}\s+const barcode = barcodeFromInput\(trimmed\);\s+if \(!barcode\) \{\s+new Notice\("Enter a valid UPC or EAN barcode\."\);\s+return;\s+\}/);
  assert.doesNotMatch(mainSource, /const barcode = rawBarcode\.replace\(\/\\D\/g, ""\);\s+if \(!barcode\) \{\s+new Notice\("Barcode is required"\)/);
  assert.match(mainSource, /new BarcodeScannerModal\(this\.app, this\.plugin, this\.dateContext, async \(item\) =>/);
  assert.match(mainSource, /private barcodeScannerModal: BarcodeScannerModal \| null = null/);
  assert.match(mainSource, /private openBarcodeScanner\(\): void \{\s+if \(this\.barcodeScannerModal\) return;/);
  assert.match(mainSource, /autoStart: true/);
  assert.match(mainSource, /onClose: \(\) => \{\s+if \(this\.barcodeScannerModal === scanner\) this\.barcodeScannerModal = null;/);
  assert.match(mainSource, /this\.statusEl\.setText\("Enter or scan a UPC\/EAN barcode\."\);\s+this\.openBarcodeScanner\(\);/);
  assert.match(mainSource, /setButtonText\("Scan"\)\s+\.onClick\(\(\) => this\.openBarcodeScanner\(\)\)/);
  assert.match(mainSource, /private getActiveInlineFoodDraft\(\): InlineFoodDraft \| null/);
  assert.doesNotMatch(mainSource, /\.setName\("Natural add"\)/);
  assert.doesNotMatch(mainSource, /\["natural", "Text"\]/);
  assert.match(mainSource, /\["barcode", "Barcode"\], \["search", "Search"\], \["mine", "My foods\/recipes"\]/);
  assert.match(mainSource, /\.setName\("Search food"\)/);
  assert.match(mainSource, /\.setName\("Barcode"\)/);
  assert.match(mainSource, /this\.resultsEl\.empty\(\);\s+this\.actionsEl\.empty\(\);\s+if \(mode === "mine"\) \{\s+void this\.renderQuickPicks\(\);/);
  assert.match(mainSource, /else if \(mode === "search"\) \{\s+if \(this\.searchInput\.trim\(\)\.length >= 2\) this\.queueSearch\(this\.searchInput\);/);
  assert.match(mainSource, /createDiv\(\{ cls: "tps-health-food-tabs" \}\)/);
  assert.match(mainSource, /panelByMode\[candidate\]\.toggleClass\("is-active", active\)/);
  assert.match(mainSource, /this\.selectionEl\.addClass\("tps-health-floating-selection"\)/);
  assert.match(mainSource, /this\.selectionCollapsed = true;\s+this\.renderSelection\(\);/);
  assert.match(mainSource, /text\.setValue\(this\.initialDraft\.query\);\s*this\.searchInput = this\.initialDraft\.query;\s*this\.queueSearch\(this\.initialDraft\.query\);/);
  assert.match(mainSource, /row\.addEventListener\("click", async \(\) => \{\s+await this\.addSelection\(item\);/);
  assert.match(mainSource, /setButtonText\("Review"\)/);
  assert.match(mainSource, /interface BarcodeScannerAdapters \{/);
  assert.match(mainSource, /requestCameraStream\?: \(constraints: MediaStreamConstraints\) => Promise<MediaStream>/);
  assert.match(mainSource, /createLiveReader\?: \(\) => any/);
  assert.match(mainSource, /createCanvasReader\?: \(\) => any/);
  assert.match(mainSource, /createNativeDetector\?: \(\) => any/);
  assert.match(mainSource, /nativeBridgeScan\?: \(\) => Promise<unknown>/);
  assert.match(mainSource, /navigatorInfo\?: Pick<Navigator, "userAgent" \| "platform" \| "maxTouchPoints">/);
  assert.match(mainSource, /private options: BarcodeScannerOptions = \{\}/);
  assert.match(mainSource, /if \(this\.options\.autoStart\) window\.setTimeout\(\(\) => \{\s+if \(!this\.stopped\) void this\.startCamera\(status\);/);
  assert.match(mainSource, /if \(this\.cameraStartInProgress \|\| this\.stream \|\| this\.scanInterval != null\) return;/);
  assert.match(mainSource, /private desiredFacingMode: "environment" \| "user" \| "" = ""/);
  assert.match(mainSource, /private torchEnabled = false/);
  assert.match(mainSource, /setButtonText\("Flash"\)\s+\.onClick\(\(\) => this\.toggleTorch\(status\)\)/);
  assert.match(mainSource, /setButtonText\("Flip camera"\)\s+\.onClick\(\(\) => this\.flipCamera\(status\)\)/);
  assert.match(mainSource, /const capabilities = track\?\.getCapabilities\?\.\(\) as any/);
  assert.match(mainSource, /await \(track\.applyConstraints as any\)\(\{ advanced: \[\{ torch: next \}\] \}\)/);
  assert.match(mainSource, /this\.desiredFacingMode = this\.desiredFacingMode === "environment" \? "user" : "environment"/);
  assert.match(mainSource, /this\.stopScanning\(\);\s+this\.updateCameraControlButtons\(\);\s+statusEl\.setText\(`Switching to \$\{this\.desiredFacingMode === "environment" \? "rear" : "front"\} camera\.\.\.`\);/);
  assert.match(mainSource, /facingMode: \{ ideal: this\.desiredFacingMode \|\| this\.defaultFacingMode\(\) \}/);
  assert.match(mainSource, /statusEl\.setText\("Checking native barcode scanner\.\.\."\);\s+if \(await this\.tryNativeBarcodeBridge\(statusEl\)\) return;\s+statusEl\.setText\("Web camera scanner active\. Scanning\.\.\."\);/);
  assert.match(mainSource, /private async tryNativeBarcodeBridge\(statusEl: HTMLElement\): Promise<boolean>/);
  assert.match(mainSource, /private shouldTryNativeBarcodeBridge\(\): boolean/);
  assert.match(mainSource, /Macintosh\/i\.test\(userAgent\) && nav\.maxTouchPoints > 1/);
  assert.match(mainSource, /private getNativeBarcodeBridge\(\): \(\(\) => Promise<unknown>\) \| null/);
  assert.match(mainSource, /win\.Capacitor\?\.Plugins \|\| win\.Capacitor\?\.plugins \|\| \{\}/);
  assert.match(mainSource, /plugins\.BarcodeScanner \|\| win\.BarcodeScanner \|\| win\.CapacitorBarcodeScanner/);
  assert.match(mainSource, /scanner\.scanBarcode/);
  assert.match(mainSource, /scanner\.startScan/);
  assert.match(mainSource, /Native scanner bridge unavailable; using web camera scanner\./);
  assert.match(mainSource, /nativeBarcodeBridgeValue\(result\)/);
  assert.match(mainSource, /import \{ BrowserMultiFormatOneDReader, BrowserMultiFormatReader \} from "@zxing\/browser"/);
  assert.match(mainSource, /import \{ BarcodeFormat, DecodeHintType \} from "@zxing\/library"/);
  assert.match(mainSource, /const BarcodeDetector = \(window as any\)\.BarcodeDetector/);
  assert.match(mainSource, /if \(this\.options\.adapters\?\.createNativeDetector\) \{\s+this\.nativeBarcodeDetector = this\.options\.adapters\.createNativeDetector\(\);/);
  assert.match(mainSource, /formats: \["ean_13", "ean_8", "upc_a", "upc_e", "code_128"\]/);
  assert.match(mainSource, /const SHORTCUT_BARCODE_INBOX_PATH = "TPS Health Barcode Scan\.md"/);
  assert.match(mainSource, /const SHORTCUT_BARCODE_NAME = "TPS Health Scan Barcode"/);
  assert.match(mainSource, /private shortcutInboxEventRefs: EventRef\[\] = \[\]/);
  assert.match(mainSource, /if \(this\.shouldShowAppleShortcutButton\(\)\) \{\s+controls\.addButton\(\(button\) => button\s+\.setButtonText\("Apple Shortcut"\)\s+\.onClick\(\(\) => this\.openAppleShortcut\(status\)\)\);/);
  assert.match(mainSource, /statusEl\.setText\(`Opening Apple Shortcut\. TPS Health is watching \$\{SHORTCUT_BARCODE_INBOX_PATH\} for the scanned barcode\.`\);/);
  assert.match(mainSource, /const opened = window\.open\(url, "_blank"\);\s+if \(!opened\) window\.location\.href = url;/);
  assert.match(mainSource, /this\.app\.vault\.on\("create", \(changed\) => \{/);
  assert.match(mainSource, /this\.app\.vault\.on\("modify", \(changed\) => \{/);
  assert.match(mainSource, /this\.shortcutInboxPollInterval = window\.setInterval\(\(\) => \{/);
  assert.match(mainSource, /const barcode = shortcutBarcodeFromContent\(content\);/);
  assert.match(mainSource, /await this\.app\.vault\.modify\(file, `Processed by TPS Health at \$\{isoNow\(\)\}\\n`\);/);
  assert.match(mainSource, /await this\.lookup\(barcode, statusEl\);/);
  assert.match(mainSource, /function appleShortcutBarcodeUrl\(\): string \{\s+return `shortcuts:\/\/run-shortcut\?name=\$\{encodeURIComponent\(SHORTCUT_BARCODE_NAME\)\}`;/);
  assert.match(mainSource, /function shortcutBarcodeFromContent\(content: string\): string \| null \{\s+const match = content\.match\(\/\(\?:\^\|\\D\)\(\\d\{7,14\}\)\(\?:\\D\|\$\)\/\);/);
  assert.match(mainSource, /function createBarcodeReader\(\): any/);
  assert.match(mainSource, /function createLiveBarcodeReader\(\): any/);
  assert.match(mainSource, /private createLiveBarcodeReader\(\): any \{\s+return this\.options\.adapters\?\.createLiveReader\?\.\(\) \|\| createLiveBarcodeReader\(\);/);
  assert.match(mainSource, /private createCanvasBarcodeReader\(\): any \{\s+return this\.options\.adapters\?\.createCanvasReader\?\.\(\) \|\| createBarcodeReader\(\);/);
  assert.match(mainSource, /new BrowserMultiFormatOneDReader\(createBarcodeHints\(\), \{/);
  assert.match(mainSource, /delayBetweenScanAttempts: 90/);
  assert.match(mainSource, /await this\.startZxingVideoScan\(statusEl\)/);
  assert.match(mainSource, /const reader = this\.createLiveBarcodeReader\(\);\s+this\.zxingVideoControls = await reader\.decodeFromVideoElement\(this\.videoEl, \(result: any\) =>/);
  assert.match(mainSource, /this\.scheduleCanvasScanFallback\(statusEl, sessionId\)/);
  assert.match(mainSource, /this\.fallbackScanTimeout = window\.setTimeout\(\(\) => \{/);
  assert.match(mainSource, /\}, 900\);/);
  assert.match(mainSource, /this\.zxingVideoControls\?\.stop\?\.\(\)/);
  assert.match(mainSource, /DecodeHintType\.POSSIBLE_FORMATS/);
  assert.match(mainSource, /BarcodeFormat\.UPC_A/);
  assert.match(mainSource, /DecodeHintType\.TRY_HARDER, true/);
  assert.match(mainSource, /barcodeScanCanvases\(this\.canvasEl, heavy\)/);
  assert.match(mainSource, /const getUserMedia = this\.options\.adapters\?\.requestCameraStream \|\| navigator\.mediaDevices\?\.getUserMedia\?\.bind\(navigator\.mediaDevices\)/);
  assert.match(mainSource, /return await getUserMedia\(\{\s+video: \{/);
  assert.match(mainSource, /return await getUserMedia\(\{ video: true \}\)/);
  assert.match(mainSource, /const reader = this\.createCanvasBarcodeReader\(\);/);
  assert.match(mainSource, /let decodeInProgress = false/);
  assert.match(mainSource, /this\.stopped \|\| this\.lookupInProgress \|\| decodeInProgress/);
  assert.match(mainSource, /attempts % 2 === 0/);
  assert.match(mainSource, /keep the barcode steady, well lit, and centered/);
  assert.match(mainSource, /\}, 180\);/);
  assert.doesNotMatch(mainSource, /move closer so the barcode fills more of the camera frame/);
  assert.match(mainSource, /function barcodeScanRegions\(width: number, height: number, heavy: boolean\): BarcodeCanvasRegion\[\]/);
  assert.match(mainSource, /out\.splice\(Math\.min\(2, out\.length\), 0, source\)/);
  assert.match(mainSource, /x: 0\.25, y: 0\.48, width: 0\.5, height: 0\.42, scale: 2\.5, rotate: true/);
  assert.match(mainSource, /function cropCanvas\(/);
  assert.match(mainSource, /ctx\.rotate\(Math\.PI \/ 2\)/);
  assert.match(mainSource, /function barcodeImageCanvases\(img: HTMLImageElement\): HTMLCanvasElement\[\]/);
  assert.match(readmeSource, /Apple's true VisionKit scanner is native app code/);
  assert.match(readmeSource, /probes for known native barcode bridge shapes/);
  assert.match(readmeSource, /when no bridge exists, is cancelled, or errors/);
  assert.match(readmeSource, /Apple Shortcut setup:/);
  assert.match(readmeSource, /TPS Health Scan Barcode/);
  assert.match(readmeSource, /TPS Health Barcode Scan\.md/);
  assert.match(readmeSource, /Scan QR or Barcode/);
  assert.match(readmeSource, /obsidian:\/\/new\?vault=TishOS%20v0\.1&file=TPS%20Health%20Barcode%20Scan\.md&content=<Shortcut Scanned Code>&overwrite=true/);
  assert.match(readmeSource, /obsidian:\/\/advanced-uri\?vault=TishOS%20v0\.1&filepath=TPS%20Health%20Barcode%20Scan\.md&data=<Shortcut Scanned Code>&mode=overwrite/);
  assert.match(mainSource, /let quantity = this\.initialDraft\?\.quantity \|\| 1;/);
  assert.match(mainSource, /let unit = this\.initialDraft\?\.unit \|\| preferredFoodLogUnit\(this\.item\);/);
});

test("fake vault food writes cover no-write cancel, upsert, single-file, daily-note, and recipe paths", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    dailyNoteFormat: "YYYY-MM-DD",
    dailyNoteFolder: "Daily",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    workoutsFolder: "Health/Workouts",
    workoutPlansFolder: "Health/Workout Plans",
    exercisesFolder: "Health/Exercises",
    foodTemplatePath: "",
    workoutTemplatePath: "",
    workoutPlanTemplatePath: "",
    exerciseTemplatePath: "",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    foodLogTarget: "single-file",
    foodLogFilePath: "Health/Food Log.md",
    defaultFoodLogSection: "Food",
    automaticDailyRollups: false,
    rollupHeading: "Health Rollup",
    healthGoals: [],
    usdaApiKey: "DEMO_KEY",
    openFoodFactsUserAgent: USER_AGENT,
    includeBrandedFoodSearch: false,
    workoutLogHeading: "Workouts",
    workoutLogTarget: "session-note",
    activeWorkoutTarget: "session-note",
    workoutNoteBodyMode: "blank",
    workoutExerciseLayout: "flat",
    workoutSetNotation: "compact",
    workoutSetStorage: "task",
    defaultRestSeconds: 90,
    restTimerMode: "count-up",
    defaultWorkoutCooldownDays: 2,
    activeWorkoutSetCount: 0,
    showFoodLogButtonInGcm: false,
  };

  assert.equal(fake.writes.length, 0, "opening/cancelling modal paths are represented by no plugin write call");

  const savedFood = await plugin.upsertFoodFromInput({
    name: "Provider Bar",
    brand: "TPS Test",
    barcode: "123456789012",
    servingAmount: 1,
    servingUnit: "bar",
    servingGrams: 55,
    nutrition: { calories: 210, proteinG: 20, carbsG: 22, fatG: 7 },
  });
  assert.equal(savedFood.sourcePath, "Health/Foods/Provider Bar.md");
  assert.match(fake.files.get("Health/Foods/Provider Bar.md"), /barcode: "123456789012"/);

  const writeCountAfterCreate = fake.writes.length;
  const upsertedFood = await plugin.upsertFoodFromInput({
    name: "Provider Bar",
    brand: "TPS Test",
    barcode: "123456789012",
    servingAmount: 1,
    servingUnit: "bar",
    servingGrams: 60,
    nutrition: { calories: 220, proteinG: 21, carbsG: 23, fatG: 8 },
  });
  assert.equal(upsertedFood.sourcePath, "Health/Foods/Provider Bar.md");
  assert.equal(fake.files.has("Health/Foods/Provider Bar 2.md"), false);
  assert.ok(fake.writes.length > writeCountAfterCreate);
  assert.match(fake.files.get("Health/Foods/Provider Bar.md"), /servingGrams: 60/);

  const singleFileEntry = await plugin.logFoodFromInput({
    item: savedFood,
    quantity: 0.5,
    unit: "bar",
    completedDate: "2026-06-20T08:15:00.000Z",
    createFoodNote: false,
  });
  assert.equal(singleFileEntry.dailyNotePath, "Daily/2026-06-20.md");
  assert.match(fake.files.get("Health/Food Log.md"), /\[\[Health\/Foods\/Provider Bar\|Provider Bar\]\]/);
  assert.match(fake.files.get("Health/Food Log.md"), /\[dailyNotePath:: Daily\/2026-06-20\.md\]/);
  assert.equal(fake.files.get("Daily/2026-06-20.md"), "", "single-file target creates the daily context file but does not write the entry there");

  plugin.settings.foodLogTarget = "daily-note";
  const dailyEntry = await plugin.logFoodFromInput({
    item: {
      id: "search-candidate",
      name: "Search Yogurt",
      brand: "Provider",
      source: "open-food-facts",
      servingAmount: 1,
      servingUnit: "cup",
      servingMl: 150,
      nutrition: { calories: 120, proteinG: 15, carbsG: 9, fatG: 2 },
    },
    quantity: 1,
    unit: "cup",
    completedDate: "2026-06-21T12:00:00.000Z",
  });
  assert.equal(dailyEntry.item.sourcePath, "Health/Foods/Search Yogurt.md");
  assert.match(fake.files.get("Daily/2026-06-21.md"), /## Food\n\n- 1 cup - \[\[Health\/Foods\/Search Yogurt\|Search Yogurt\]\]/);
  assert.match(fake.files.get("Daily/2026-06-21.md"), /\[foodPath:: Health\/Foods\/Search Yogurt\.md\]/);
  assert.equal(fake.files.has("Calendar.md"), false);

  const recipe = await plugin.createFoodFromInput({
    type: "recipe",
    name: "Provider Snack Plate",
    servingAmount: 1,
    servingUnit: "recipe",
    nutrition: { calories: 330, proteinG: 35, carbsG: 31, fatG: 10 },
    notes: "- 0.5 bar Provider Bar (Health/Foods/Provider Bar.md)\n- 1 cup Search Yogurt (Health/Foods/Search Yogurt.md)",
  });
  assert.equal(recipe.sourcePath, "Health/Recipes/Provider Snack Plate.md");
  assert.match(fake.files.get("Health/Recipes/Provider Snack Plate.md"), /kind: recipe/);
  assert.match(fake.files.get("Health/Recipes/Provider Snack Plate.md"), /#tps\/recipe/);
  assert.match(fake.files.get("Health/Recipes/Provider Snack Plate.md"), /Provider Bar/);

  const touchedPaths = new Set(fake.writes.filter((write) => write.op !== "mkdir").map((write) => write.path));
  assert.deepEqual([...touchedPaths].sort(), [
    "Daily/2026-06-20.md",
    "Daily/2026-06-21.md",
    "Health/Food Log.md",
    "Health/Foods/Provider Bar.md",
    "Health/Foods/Search Yogurt.md",
    "Health/Recipes/Provider Snack Plate.md",
  ]);
});

test("create from food search upserts canonical local foods instead of creating duplicate copies", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.doesNotMatch(mainSource, /\$\{item\.name\} copy/);
  assert.match(mainSource, /new CustomFoodModal\(this\.app, this\.plugin, "food", item\.name, true, await this\.plugin\.enrichFoodSearchItem\(item\), this\.dateContext\)\.open\(\)/);
  assert.match(mainSource, /const saved = await this\.plugin\.upsertFoodFromInput\(\{/);
  assert.match(mainSource, /barcode: this\.baseFood\?\.barcode/);
  assert.match(mainSource, /function foodDedupeKey\(item: FoodItem\): string/);
  assert.match(mainSource, /if \(item\.barcode\) return `barcode:\$\{normalizeLookup\(item\.barcode\)\}`/);
  assert.match(mainSource, /foodCandidateCompletenessScore\(item\) > foodCandidateCompletenessScore\(existing\)/);
  assert.match(mainSource, /function sameNamedEquivalentMetricFood\(a: FoodItem, b: FoodItem\): boolean/);
  assert.match(mainSource, /const multiplier = 100 \/ metric\.amount/);
});

test("food log base view renders existing food log lines without task conversion", async () => {
  const [mainSource, stylesSource, readmeSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
  ]);
  assert.match(mainSource, /const FOOD_LOG_BASE_VIEW_TYPE = "tps-health-food-log"/);
  assert.match(mainSource, /this\.registerBasesView\(FOOD_LOG_BASE_VIEW_TYPE, \{/);
  assert.match(mainSource, /name: "Food Log"/);
  assert.match(mainSource, /factory: \(controller: QueryController, containerEl: HTMLElement\): BasesView =>\s+new FoodLogBaseView\(controller, containerEl, this\)/);
  assert.match(mainSource, /id: "open-food-log-base"/);
  assert.match(mainSource, /name: "Open Food Log base"/);
  assert.match(mainSource, /vault\.create\(DEFAULT_FOOD_LOG_BASE_PATH, defaultFoodLogBaseContent\(this\.settings\)\)/);
  assert.match(mainSource, /const repaired = repairFoodLogBaseContent\(await this\.app\.vault\.cachedRead\(file\), this\.settings\);/);
  assert.match(mainSource, /if \(repaired\) await this\.app\.vault\.modify\(file, repaired\);/);
  assert.match(mainSource, /class FoodLogBaseView extends BasesView/);
  assert.match(mainSource, /const baseFiles = this\.getBaseFilteredFiles\(\);\s+if \(baseFiles\.length\) return baseFiles;\s+return this\.getHealthFoodLogFiles\(\);/);
  assert.match(mainSource, /const groups = queryData\?\.groupedData;/);
  assert.match(mainSource, /const entries = queryData\?\.data;\s+if \(!files\.length && Array\.isArray\(entries\)\) entries\.forEach\(addEntry\);/);
  assert.match(mainSource, /const configured = normalizePath\(this\.plugin\.settings\.foodLogFilePath \|\| ""\);/);
  assert.match(mainSource, /isFoodLogBaseDailyNoteFile\(file\.path, dailyFolder\) \|\| \/\^Dailynotes\\\/\//);
  assert.match(mainSource, /const entry = createFoodLogBaseEntry\(this\.plugin, file, index, line\);/);
  assert.match(mainSource, /if \(dateContext && entry\.dateKey !== dateContext\.dateIso\) continue;/);
  assert.match(mainSource, /entries\.push\(entry\);/);
  assert.match(mainSource, /private async getDateContext\(\): Promise<FoodLogDateContext \| null>/);
  assert.match(mainSource, /this\.plugin\.getFoodLogDateContextForFile\(contextFile\)/);
  assert.match(mainSource, /resolveFoodLogNutrition\(line, \(foodPath\) =>/);
  assert.match(mainSource, /const completedDate = readStringField\(line, "completedDate"\) \|\| "";/);
  assert.match(mainSource, /const createdDate = readStringField\(line, "createdDate"\) \|\| "";/);
  assert.match(mainSource, /const date = foodLogBaseDate\(completedDate, dailyNotePath \|\| file\.path, createdDate\);/);
  assert.match(mainSource, /groupFoodLogEntries\(entries\)/);
  assert.match(mainSource, /sumFoodLogNutrition\(group\.entries\)/);
  assert.match(mainSource, /this\.plugin\.openFoodLogger\(dateContext\)/);
  assert.match(mainSource, /new BarcodeScannerModal\(this\.plugin\.app, this\.plugin, dateContext, async \(item\) =>/);
  assert.match(mainSource, /new FoodLogModal\(this\.plugin\.app, this\.plugin, item, null, dateContext\)\.open\(\)/);
  assert.match(mainSource, /type: \$\{FOOD_LOG_BASE_VIEW_TYPE\}/);
  assert.match(mainSource, /function defaultFoodLogBaseContent\(settings: TPSHealthSettings\): string/);
  assert.match(mainSource, /const filters = foodLogBaseDefaultFilters\(settings\);/);
  assert.match(mainSource, /function legacyBroadFoodLogBaseContent\(\): string/);
  assert.match(mainSource, /"    - file\.name != \\"\\""/);
  assert.match(mainSource, /if \(normalized === legacyBroadFoodLogBaseContent\(\)\.trimEnd\(\)\) return defaultFoodLogBaseContent\(settings\);/);
  assert.match(mainSource, /if \(content\.includes\(`type: \$\{FOOD_LOG_BASE_VIEW_TYPE\}`\)\) return null;/);
  assert.match(mainSource, /if \(!normalized\) return defaultFoodLogBaseContent\(settings\);/);
  assert.match(mainSource, /filters\.add\(`file\.path == \$\{baseString\(foodLogPath\)\}`\);/);
  assert.match(mainSource, /filters\.add\(`file\.folder == \$\{baseString\(dailyFolder\)\}`\);/);
  assert.match(mainSource, /filters\.add\(`file\.folder == \$\{baseString\("Dailynotes"\)\}`\);/);
  assert.doesNotMatch(mainSource, /const files = this\.plugin\.app\.vault\.getMarkdownFiles\(\);\s+for \(const file of files\)/);
  assert.doesNotMatch(mainSource, /tps-health-food-log[^\n]+task-line/);
  assert.match(stylesSource, /\.tps-health-food-log-base/);
  assert.match(stylesSource, /\.tps-health-food-log-entry/);
  assert.match(readmeSource, /`tps-health-food-log`/);
  assert.match(readmeSource, /respects the active Base query\/filter result/);
  assert.match(readmeSource, /When embedded in a daily note, it detects that note's daily-note date/);
  assert.match(readmeSource, /configured single food log file, the configured daily-note folder, and the legacy `Dailynotes\/` folder/);
  assert.match(readmeSource, /native Bases table\/list views operate on files and tasks/);
});

test("inline food autocomplete supports linked food amounts without property brackets", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /!lineHasFoodDraftProperties\(line\) && !parsed\.hasExplicitAmount && !parsed\.sourcePath/);
  assert.match(mainSource, /draft\.sourcePath/);
  assert.match(mainSource, /resolveFoodLogServing\(saved, parsed\.quantity, parsed\.unit \|\| preferredFoodLogUnit\(saved\)\)/);
});

test("completed inline food logs render as live preview chips", async () => {
  const fs = await import("node:fs/promises");
  const mainSource = await fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");
  const stylesSource = await fs.readFile(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
  assert.match(mainSource, /registerEditorExtension\(createFoodLogChipExtension\(this\)\)/);
  assert.match(mainSource, /registerEditorExtension\(createWorkoutSetChipExtension\(\)\)/);
  assert.match(mainSource, /renderFoodLogChips\(root, this\)/);
  assert.match(mainSource, /renderWorkoutSetChips\(root, ctx\.sourcePath\)/);
  assert.match(mainSource, /class FoodLogChipWidget extends WidgetType/);
  assert.match(mainSource, /class WorkoutSetChipWidget extends WidgetType/);
  assert.match(mainSource, /foodLogChipDataFromLine\(text\)/);
  assert.match(mainSource, /foodLogNutritionForLine\(line, plugin\)/);
  assert.match(mainSource, /foodLogChipDataFromRenderedItem\(item, plugin\)/);
  assert.match(mainSource, /workoutSetChipDataFromLine/);
  assert.match(mainSource, /view\.state\.field\(editorLivePreviewField, false\)/);
  assert.match(stylesSource, /\.tps-health-food-chip/);
  assert.match(stylesSource, /\.tps-health-food-chip-serving/);
  assert.match(stylesSource, /\.tps-health-food-chip-macros/);
  assert.match(stylesSource, /\.tps-health-macro-pill/);
  assert.match(stylesSource, /\.tps-health-workout-set-chip/);
  assert.match(stylesSource, /\.tps-health-workout-set-meta/);
});

test("workout checklist completion tracks rest and prompts on the final planned set", async () => {
  const fs = await import("node:fs/promises");
  const mainSource = await fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");
  assert.match(mainSource, /registerWorkoutTaskCompletionTracking\(\)/);
  assert.match(mainSource, /metadataCache\.on\("changed"/);
  assert.match(mainSource, /handleWorkoutFileModify\(file: TFile\)/);
  assert.match(mainSource, /annotateCompletedWorkoutTasks/);
  assert.match(mainSource, /latestCompletedSetEndedAt\(lines, completedIndexes\[0\]\)/);
  assert.match(mainSource, /secondsBetween\(previousEndedAt, completedAt\)/);
  assert.match(mainSource, /upsertDataviewField\(nextLine, "rest", restSeconds\)/);
  assert.match(mainSource, /parseWorkoutTaskSetLine\(lines\[index\]\)/);
  assert.match(mainSource, /hasUncheckedPlannedWorkoutTask\(lines\)/);
  assert.match(mainSource, /promptFinishWorkoutAfterLastSet\(file\)/);
  assert.match(mainSource, /class FinishWorkoutPromptModal extends Modal/);
  assert.match(mainSource, /Finish workout\?/);
  assert.match(mainSource, /setButtonText\("Add set"\)/);
  assert.match(mainSource, /new SetModal\(this\.app, this\)\.open\(\)/);
});

test("food note template placeholders render source-of-truth fields", () => {
  const template = [
    "---",
    "kind: {{kind}}",
    "name: \"{{name}}\"",
    "brand: \"{{brand}}\"",
    "servingGrams: {{servingGrams}}",
    "proteinG: {{proteinG}}",
    "---",
    "{{tag}}",
  ].join("\n");
  const rendered = renderFoodTemplate(template, {
    name: "Barebells Cookies & Cream Protein Bar",
    brand: "Barebells",
    servingGrams: 55,
    nutrition: { proteinG: 20 },
  }, "food", "#tps/food");
  assert.match(rendered, /kind: food/);
  assert.match(rendered, /servingGrams: 55/);
  assert.match(rendered, /proteinG: 20/);
  assert.match(rendered, /#tps\/food/);
});

test("sodium from Open Food Facts grams converts to milligrams", () => {
  assert.equal(sodiumGramsToMg(0.6), 600);
});

test("custom food calories are calculated from macros including alcohol", () => {
  const nutrition = nutritionWithMacroCalories({ proteinG: 10, carbsG: 20, fatG: 5, alcoholG: 2, calories: 999 });
  assert.equal(nutrition.calories, 179);
});

test("food log unit options are scoped to the food serving type", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /function foodLogUnitOptions\(item: FoodItem\): string\[\]/);
  assert.match(mainSource, /metricServing\?\.unit === "ml" \|\| isLikelyLiquidFood\(item\)/);
  assert.match(mainSource, /for \(const unit of \["cup", "ml", "fl oz"\]\) units\.add\(unit\)/);
  assert.match(mainSource, /for \(const unit of \["g", "oz"\]\) units\.add\(unit\)/);
  assert.match(mainSource, /function foodLogUnitOptionLabel\(item: FoodItem, unit: string\): string/);
  assert.match(mainSource, /`serving \(\$\{label\}\)`/);
  assert.match(mainSource, /function inferredFoodFactsDrinkServing\(product: any\): \{ unit: string; ml: number \} \| null/);
  assert.match(mainSource, /function inferredDrinkServingForFood\(item: FoodItem\): \{ unit: string; ml: number \} \| null/);
  assert.match(mainSource, /function shouldTreatNutritionAsPer100ml\(item: FoodItem, servingMl: number\): boolean/);
  assert.match(mainSource, /nutrition: inferredMultiplier !== 1 \? multiplyNutrition\(serving\.nutrition \|\| \{\}, inferredMultiplier\) : serving\.nutrition/);
  assert.match(mainSource, /return \{ unit: "can", ml: 355 \}/);
  assert.match(mainSource, /return \{ unit: "serving", ml: 240 \}/);
  assert.match(mainSource, /const MAX_REASONABLE_SERVING_ML = 3000/);
  assert.match(mainSource, /function sanitizeFoodServingMetrics\(item: FoodItem\): FoodItem/);
  assert.match(mainSource, /servingMl: saneMetricServingAmount\(item\.servingMl, "ml"\)/);
  assert.match(mainSource, /parseMetricServing\(1, servingSize\) \|\| hasMetricServingText\(servingSize\)/);
  assert.match(mainSource, /categories,categories_tags,serving_quantity,serving_size,nutriments/);
  assert.doesNotMatch(mainSource, /for \(const unit of \["slice", "piece", "bar", "cup", "g", "oz", "ml"\]\)/);
});

test("food search expands colloquial grocery queries like protein doritos", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /private openFoodSearchModal\(initialDraft: InlineFoodDraft \| null, dateContext: FoodLogDateContext \| null\): void/);
  assert.match(mainSource, /private registerGcmFoodLogButtonTapFallback\(\): void/);
  assert.match(mainSource, /document\.addEventListener\("pointerdown", handler, \{ capture: true \}\)/);
  assert.match(mainSource, /function foodSearchQueryVariants\(query: string\): string\[\]/);
  assert.match(mainSource, /variants\.add\("quest protein chips nacho cheese"\)/);
  assert.match(mainSource, /tokens\.every\(\(token\) => haystack\.includes\(token\) \|\| haystackTokens\.has\(token\)\)/);
  assert.match(mainSource, /aliases: aliasesFromFrontmatter\(fm\.aliases\)/);
  assert.match(mainSource, /aliases: foodAliasesForItem\(item\)\.length \? foodAliasesForItem\(item\) : undefined/);
  assert.match(mainSource, /function aliasesFromFrontmatter\(value: unknown\): string\[\] \| undefined/);
  assert.match(mainSource, /function inferredFoodAliases\(item: FoodItem\): string\[\]/);
  assert.match(mainSource, /aliases\.add\(`\$\{first\} cereal`\)/);
  assert.match(mainSource, /function foodSearchFields\(item: FoodItem\): Array<unknown>/);
  assert.match(mainSource, /isRelevantFoodResult\(query, \[item\.name, item\.brand, item\.aliases\?\.join\(" "\)\]\)/);
  assert.match(mainSource, /isRelevantFoodResult\(query, foodSearchFields\(item\)\)/);
  assert.match(mainSource, /name: "Egg, whole, cooked", aliases: \["eggs"\], servingUnit: "egg", servingGrams: 50/);
  assert.match(mainSource, /aliases: \["quest protein chips", "quest chips", "protein chips", "protein doritos", "doritos protein chips", "nacho protein chips"\]/);
  assert.match(mainSource, /Quest Tortilla Style Protein Chips, Nacho Cheese/);
});

test("workout cooldown date math writes the next eligible date", () => {
  assert.equal(addDaysIsoDate("2026-06-03T17:30:00.000Z", 3), "2026-06-06");
  assert.equal(addDaysIsoDate("2026-06-03T17:30:00.000Z", 0), "2026-06-03");
});

test("workout set line uses Dataview fields for reusable exercise and set groups", () => {
  const line = workoutSetLine({
    id: "set-1",
    exercise: "Bench Press",
    exercisePath: "Health/Exercises/Bench Press.md",
    workoutPath: "Health/Workouts/Push Day.md",
    workoutPlanPath: "Health/Workout Plans/Push Day.md",
    createdDate: "2026-06-03T17:30:00.000Z",
    completedDate: "2026-06-03T17:31:00.000Z",
    endedAt: "2026-06-03T17:31:00.000Z",
    reps: 8,
    weight: 185,
    weightUnit: "lb",
    restSeconds: 120,
    dropSetGroupId: "drop-a",
    supersetGroupId: "super-a",
  });
  assert.match(line, /\[\[Health\/Exercises\/Bench Press\|Bench Press\]\]/);
  assert.match(line, /\[exercise:: Bench Press\]/);
  assert.match(line, /\[exercisePath:: Health\/Exercises\/Bench Press\.md\]/);
  assert.match(line, /\[workout:: Push Day\]/);
  assert.match(line, /\[workoutPath:: Health\/Workouts\/Push Day\.md\]/);
  assert.match(line, /\[workoutPlan:: Push Day\]/);
  assert.match(line, /\[workoutPlanPath:: Health\/Workout Plans\/Push Day\.md\]/);
  assert.match(line, /\[createdDate:: 2026-06-03T17:30:00.000Z\]/);
  assert.match(line, /\[completedDate:: 2026-06-03T17:31:00.000Z\]/);
  assert.match(line, /\[reps:: 8\]/);
  assert.match(line, /\[rest:: 120\]/);
  assert.match(line, /\[dropSet:: drop-a\]/);
  assert.match(line, /\[superset:: super-a\]/);

  const taskLine = workoutSetLine({
    id: "set-2",
    exercise: "Squat",
    createdDate: "2026-06-03T17:40:00.000Z",
    completedDate: "2026-06-03T17:41:00.000Z",
    startedAt: "2026-06-03T17:40:00.000Z",
    endedAt: "2026-06-03T17:41:00.000Z",
    reps: 5,
    restSeconds: 90,
  }, { asTask: true });
  assert.match(taskLine, /^- \[x\] Squat - 5/);
  assert.match(taskLine, /\[startedAt:: 2026-06-03T17:40:00.000Z\]/);
  assert.match(taskLine, /\[endedAt:: 2026-06-03T17:41:00.000Z\]/);

  const compactLine = workoutSetLine({
    id: "set-3",
    exercise: "Bench Press",
    endedAt: "2026-06-03T17:45:00.000Z",
    reps: 15,
    weight: 225,
    weightUnit: "lb",
    setType: "drop",
    supersetGroupId: "A",
  }, { asTask: true, notation: "compact" });
  assert.match(compactLine, /^- \[x\] Bench Press - drop - superset A - 225 lb x 15/);
  assert.match(compactLine, /\[setType:: drop\]/);
  assert.match(compactLine, /\[superset:: A\]/);
});

test("daily-note workout session line is a parent bullet with queryable state", () => {
  const line = workoutSessionLine({
    id: "workout-1",
    title: "Push Day",
    startedAt: "2026-06-03T17:30:00.000Z",
    plan: { name: "Push Day", sourcePath: "Health/Workout Plans/Push Day.md" },
    cooldownDays: 3,
    status: "active",
  });
  assert.match(line, /^- \[\[Health\/Workout Plans\/Push Day\|Push Day\]\]/);
  assert.match(line, /\[workoutId:: workout-1\]/);
  assert.match(line, /\[workoutPlanPath:: Health\/Workout Plans\/Push Day\.md\]/);
  assert.match(line, /\[startedAt:: 2026-06-03T17:30:00.000Z\]/);
  assert.match(line, /\[status:: active\]/);
  assert.match(line, /\[cooldownDays:: 3\]/);
});

function nutrientValue(nutrients, nutrientIds) {
  for (const id of nutrientIds) {
    const nutrient = nutrients.find((item) => Number(item.nutrientId) === id);
    const value = Number(nutrient?.value);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function hasMacroData(nutriments) {
  if (!nutriments) return false;
  return [
    nutriments["energy-kcal_100g"],
    nutriments.proteins_100g,
    nutriments.fat_100g,
    nutriments.carbohydrates_100g,
  ].some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
}

function calculateFoodTotals(content, resolveFood, dailyNotePath) {
  const totals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, alcoholG: 0, sodiumMg: 0 };
  for (const line of content.split("\n")) {
    if (!isFoodLogLine(line)) continue;
    if (!isFoodLogForDailyNote(line, dailyNotePath)) continue;
    const resolved = resolveFoodLogNutrition(line, resolveFood);
    totals.calories += resolved.calories;
    totals.proteinG += resolved.proteinG;
    totals.carbsG += resolved.carbsG;
    totals.fatG += resolved.fatG;
    totals.fiberG += resolved.fiberG;
    totals.sugarG += resolved.sugarG;
    totals.alcoholG += resolved.alcoholG;
    totals.sodiumMg += resolved.sodiumMg;
  }
  return totals;
}

function isFoodLogForDailyNote(line, dailyNotePath) {
  if (!dailyNotePath) return true;
  const lineDailyNotePath = readStringField(line, "dailyNotePath");
  return !lineDailyNotePath || lineDailyNotePath === dailyNotePath;
}

function resolveFoodLogNutrition(line, resolveFood) {
  const foodPath = readStringField(line, "foodPath");
  const food = foodPath && resolveFood ? resolveFood(foodPath) : null;
  if (hasLineNutritionFields(line)) {
    const lineNutrition = readLineNutrition(line);
    if (food?.nutrition) {
      const baseNutrition = multiplyNutrition(food.nutrition, foodLogMultiplier(line, food));
      if (shouldTreatLineNutritionAsLegacyPerServing(lineNutrition, food.nutrition, foodLogMultiplier(line, food))) {
        return baseNutrition;
      }
      return mergeLineNutritionOverrides(baseNutrition, line);
    }
    return lineNutrition;
  }
  if (food?.nutrition) return multiplyNutrition(food.nutrition, foodLogMultiplier(line, food));
  return readLineNutrition(line);
}

function hasLineNutritionFields(line) {
  return ["cal", "protein", "carbs", "fat", "fiber", "sugar", "alcohol", "sodium"].some((key) => readNumber(line, key) != null);
}

function readLineNutrition(line) {
  if ((readNumber(line, "servings") ?? readNumber(line, "qty")) === 0) return zeroNutrition();
  return {
    calories: readNumber(line, "cal") || 0,
    proteinG: readNumber(line, "protein") || 0,
    carbsG: readNumber(line, "carbs") || 0,
    fatG: readNumber(line, "fat") || 0,
    fiberG: readNumber(line, "fiber") || 0,
    sugarG: readNumber(line, "sugar") || 0,
    alcoholG: readNumber(line, "alcohol") || 0,
    sodiumMg: readNumber(line, "sodium") || 0,
  };
}

function mergeLineNutritionOverrides(base, line) {
  return {
    calories: readNumber(line, "cal") ?? base.calories,
    proteinG: readNumber(line, "protein") ?? base.proteinG,
    carbsG: readNumber(line, "carbs") ?? base.carbsG,
    fatG: readNumber(line, "fat") ?? base.fatG,
    fiberG: readNumber(line, "fiber") ?? base.fiberG,
    sugarG: readNumber(line, "sugar") ?? base.sugarG,
    alcoholG: readNumber(line, "alcohol") ?? base.alcoholG,
    sodiumMg: readNumber(line, "sodium") ?? base.sodiumMg,
  };
}

function zeroNutrition() {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, alcoholG: 0, sodiumMg: 0 };
}

function shouldTreatLineNutritionAsLegacyPerServing(lineNutrition, foodNutrition, multiplier) {
  if (!Number.isFinite(multiplier) || Math.abs(multiplier - 1) < 0.0001) return false;
  const pairs = [
    ["calories", "calories"],
    ["proteinG", "proteinG"],
    ["carbsG", "carbsG"],
    ["fatG", "fatG"],
    ["fiberG", "fiberG"],
    ["sugarG", "sugarG"],
    ["alcoholG", "alcoholG"],
    ["sodiumMg", "sodiumMg"],
  ];
  const comparisons = pairs
    .map(([lineKey, foodKey]) => {
      const foodValue = foodNutrition[foodKey];
      if (foodValue == null || !Number.isFinite(Number(foodValue))) return null;
      return Math.abs((lineNutrition[lineKey] || 0) - Number(foodValue)) < 0.05;
    })
    .filter((value) => value != null);
  return comparisons.length > 0 && comparisons.every(Boolean);
}

function foodLogMultiplier(line, food) {
  const amount = readNumber(line, "amount");
  const unit = (readStringField(line, "amountUnit") || readStringField(line, "unit"))?.toLowerCase();
  if (amount != null && unit === "g" && food.servingGrams) return amount / food.servingGrams;
  if (amount != null && unit === "ml" && food.servingMl) return amount / food.servingMl;
  return normalizedQuantity(readNumber(line, "servings") ?? readNumber(line, "qty"));
}

function multiplyNutrition(nutrition, multiplier) {
  return {
    calories: (nutrition.calories || 0) * multiplier,
    proteinG: (nutrition.proteinG || 0) * multiplier,
    carbsG: (nutrition.carbsG || 0) * multiplier,
    fatG: (nutrition.fatG || 0) * multiplier,
    fiberG: (nutrition.fiberG || 0) * multiplier,
    sugarG: (nutrition.sugarG || 0) * multiplier,
    alcoholG: (nutrition.alcoholG || 0) * multiplier,
    sodiumMg: (nutrition.sodiumMg || 0) * multiplier,
  };
}

function isFoodLogLine(line) {
  return line.includes("tps-health:food") ||
    (/\[food::\s*[^\]]+\]/i.test(line) && /\[(qty|servings)::\s*-?\d/i.test(line));
}

function normalizedQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function readNumber(line, key) {
  const dataviewMatch = line.match(new RegExp(`\\[${key}::\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
  if (dataviewMatch) return Number(dataviewMatch[1]);
  const match = line.match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : undefined;
}

function readStringField(line, key) {
  const dataviewMatch = line.match(new RegExp(`\\[${key}::\\s*([^\\]]+)\\]`, "i"));
  return dataviewMatch ? dataviewMatch[1].trim() : undefined;
}

function parseInlineFoodDraft(line) {
  if (!/^\s*-\s+/.test(line)) return null;
  if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) return null;
  if (/\[food::/i.test(line)) return null;
  const overrides = {};
  const overridePattern = /\[([a-zA-Z]+)\s*::?\s*(-?\d+(?:\.\d+)?)\]/g;
  let match;
  while ((match = overridePattern.exec(line))) {
    const key = normalizeNutrientKey(match[1]);
    if (!key) continue;
    overrides[key] = Number(match[2]);
  }
  let body = line.replace(/^\s*-\s+/, "");
  const linkMatch = body.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  const sourcePath = linkMatch ? markdownPathFromWikilink(linkMatch[1]) : undefined;
  const hasNutritionOverride = Object.keys(overrides).length > 0;
  body = body
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path, label) => label || path.split("/").pop()?.replace(/\.md$/i, "") || path)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return null;
  let quantity = 1;
  let hasExplicitAmount = false;
  const leadingUnitMatch = body.match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half)\s*(cup|cups|bar|bars|pastry|pastries|package|packages|serving|servings|pint|pints|oz|g)\s+/i);
  if (leadingUnitMatch) {
    quantity = parseQuantity(leadingUnitMatch[1]);
    const unit = singularUnit(leadingUnitMatch[2]);
    body = body.slice(leadingUnitMatch[0].length).trim();
    return body ? { query: body, quantity, unit, sourcePath, hasExplicitAmount: true, overrides } : null;
  }
  const quantityMatch = body.match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half)\s+/i);
  if (quantityMatch) {
    quantity = parseQuantity(quantityMatch[1]);
    body = body.slice(quantityMatch[0].length).trim();
    hasExplicitAmount = true;
  }
  const trailingAmountMatch = body.match(/(?:\s+-\s+|\s+)(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half)\s*(cup|cups|bar|bars|pastry|pastries|package|packages|serving|servings|pint|pints|oz|g)$/i);
  if (trailingAmountMatch) {
    quantity = parseQuantity(trailingAmountMatch[1]);
    const unit = singularUnit(trailingAmountMatch[2]);
    body = body.slice(0, trailingAmountMatch.index).trim();
    return body ? { query: body, quantity, unit, sourcePath, hasExplicitAmount: true, overrides } : null;
  }
  const unitMatch = body.match(/\s+(cup|cups|bar|bars|pastry|pastries|package|packages|serving|servings|pint|pints|oz|g)$/i);
  const unit = unitMatch ? singularUnit(unitMatch[1]) : undefined;
  if (unitMatch) body = body.slice(0, unitMatch.index).trim();
  if (!sourcePath && !hasNutritionOverride && !hasExplicitAmount && !unit) return null;
  return body ? { query: body, quantity, unit, sourcePath, hasExplicitAmount, overrides } : null;
}

function markdownPathFromWikilink(path) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function parseQuantity(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "half") return 0.5;
  const fraction = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : 1;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function singularUnit(unit) {
  const normalized = unit.toLowerCase();
  if (normalized === "cups") return "cup";
  if (normalized === "bars") return "bar";
  if (normalized === "pastries") return "pastry";
  if (normalized === "packages") return "package";
  if (normalized === "servings") return "serving";
  if (normalized === "pints") return "pint";
  return normalized;
}

function normalizeNutrientKey(key) {
  const normalized = key.trim().toLowerCase();
  if (normalized === "cal" || normalized === "cals" || normalized === "calorie" || normalized === "calories") return "cal";
  if (normalized === "protein" || normalized === "p") return "protein";
  if (normalized === "carb" || normalized === "carbs" || normalized === "c") return "carbs";
  if (normalized === "fat" || normalized === "f") return "fat";
  if (normalized === "fiber" || normalized === "fibre") return "fiber";
  if (normalized === "sugar" || normalized === "sugars") return "sugar";
  if (normalized === "alcohol" || normalized === "alcoholg" || normalized === "alc") return "alcohol";
  if (normalized === "sodium" || normalized === "salt") return "sodium";
  return null;
}

function renderFoodTemplate(template, item, type, tag) {
  const nutrition = item.nutrition || {};
  const replacements = {
    name: item.name,
    brand: item.brand || "",
    barcode: item.barcode || "",
    imageUrl: item.imageUrl || "",
    ingredients: item.ingredients || "",
    kind: type,
    tag,
    servingAmount: String(item.servingAmount || 1),
    servingUnit: item.servingUnit || "serving",
    servingGrams: item.servingGrams == null ? "" : String(round(item.servingGrams)),
    servingMl: item.servingMl == null ? "" : String(round(item.servingMl)),
    calories: String(nutrition.calories || 0),
    proteinG: String(nutrition.proteinG || 0),
    carbsG: String(nutrition.carbsG || 0),
    fatG: String(nutrition.fatG || 0),
    fiberG: String(nutrition.fiberG || 0),
    sugarG: String(nutrition.sugarG || 0),
    alcoholG: String(nutrition.alcoholG || 0),
    sodiumMg: String(nutrition.sodiumMg || 0),
  };
  return Object.entries(replacements).reduce((output, [key, value]) => output.split(`{{${key}}}`).join(value), template);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function caloriesFromMacros(nutrition) {
  return round(
    (nutrition.proteinG || 0) * 4
    + (nutrition.carbsG || 0) * 4
    + (nutrition.fatG || 0) * 9
    + (nutrition.alcoholG || 0) * 7
  );
}

function nutritionWithMacroCalories(nutrition) {
  return { ...nutrition, calories: caloriesFromMacros(nutrition) };
}

function sodiumGramsToMg(value) {
  const sodiumG = Number(value);
  return Number.isFinite(sodiumG) ? Math.round(sodiumG * 1000 * 10) / 10 : undefined;
}

function addDaysIsoDate(isoDate, days) {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function workoutSetLine(set, options = {}) {
  const exerciseLabel = set.exercisePath
    ? `[[${set.exercisePath.replace(/\.md$/, "")}|${set.exercise}]]`
    : set.exercise;
  const summary = workoutSetSummary(set, exerciseLabel, options);
  const fields = [
    dataviewField("exercise", set.exercise),
    set.exercisePath ? dataviewField("exercisePath", set.exercisePath) : "",
    set.workoutPath ? dataviewField("workout", pathLabel(set.workoutPath)) : "",
    set.workoutPath ? dataviewField("workoutPath", set.workoutPath) : "",
    set.workoutPlanPath ? dataviewField("workoutPlan", pathLabel(set.workoutPlanPath)) : "",
    set.workoutPlanPath ? dataviewField("workoutPlanPath", set.workoutPlanPath) : "",
    dataviewField("setId", set.id),
    dataviewField("createdDate", set.createdDate || set.endedAt),
    dataviewField("completedDate", set.completedDate || set.endedAt),
    set.startedAt ? dataviewField("startedAt", set.startedAt) : "",
    dataviewField("endedAt", set.endedAt),
    set.setType ? dataviewField("setType", set.setType) : "",
    set.reps == null ? "" : dataviewField("reps", set.reps),
    set.weight == null ? "" : dataviewField("weight", set.weight),
    set.weightUnit ? dataviewField("unit", set.weightUnit) : "",
    set.durationSeconds == null ? "" : dataviewField("duration", set.durationSeconds),
    set.distance == null ? "" : dataviewField("distance", set.distance),
    set.distanceUnit ? dataviewField("distanceUnit", set.distanceUnit) : "",
    set.rpe == null ? "" : dataviewField("rpe", set.rpe),
    set.restSeconds == null ? "" : dataviewField("rest", set.restSeconds),
    set.dropSetGroupId ? dataviewField("dropSet", set.dropSetGroupId) : "",
    set.supersetGroupId ? dataviewField("superset", set.supersetGroupId) : "",
    set.note ? dataviewField("note", set.note) : "",
  ].filter(Boolean);
  return `- ${options.asTask ? "[x] " : ""}${summary} ${fields.join(" ")}`;
}

function workoutSetSummary(set, exerciseLabel, options = {}) {
  const includeExercise = options.includeExercise !== false;
  const details = options.notation === "verbose" ? verboseWorkoutSetDetails(set) : compactWorkoutSetDetails(set);
  const markers = workoutSetMarkers(set);
  return [
    includeExercise ? exerciseLabel : "",
    ...markers,
    details,
  ].filter(Boolean).join(" - ");
}

function compactWorkoutSetDetails(set) {
  const weight = set.weight == null ? "" : `${round(set.weight)}${set.weightUnit ? ` ${set.weightUnit}` : ""}`;
  const reps = set.reps == null ? "" : `${round(set.reps)}`;
  if (weight && reps) return `${weight} x ${reps}`;
  if (reps) return `${reps} reps`;
  if (weight) return weight;
  if (set.durationSeconds != null) return `${round(set.durationSeconds)}s`;
  if (set.distance != null) return `${round(set.distance)}${set.distanceUnit ? ` ${set.distanceUnit}` : ""}`;
  return "Set";
}

function verboseWorkoutSetDetails(set) {
  return [
    set.reps == null ? "" : `${round(set.reps)} reps`,
    set.weight == null ? "" : `${round(set.weight)}${set.weightUnit ? ` ${set.weightUnit}` : ""}`,
    set.durationSeconds == null ? "" : `${round(set.durationSeconds)}s`,
    set.distance == null ? "" : `${round(set.distance)}${set.distanceUnit ? ` ${set.distanceUnit}` : ""}`,
  ].filter(Boolean).join(" - ");
}

function workoutSetMarkers(set) {
  const markers = [];
  if (set.setType && set.setType !== "normal") markers.push(set.setType);
  if (set.supersetGroupId) markers.push(`superset ${set.supersetGroupId}`);
  if (set.dropSetGroupId && set.setType !== "drop") markers.push(`drop ${set.dropSetGroupId}`);
  return markers;
}

function workoutSessionLine(input) {
  const workoutLabel = input.path
    ? `[[${input.path.replace(/\.md$/, "")}|${input.title}]]`
    : input.plan?.sourcePath
      ? `[[${input.plan.sourcePath.replace(/\.md$/, "")}|${input.title}]]`
      : input.title;
  const fields = [
    dataviewField("workout", workoutLabel),
    dataviewField("workoutId", input.id),
    input.path ? dataviewField("workoutPath", input.path) : "",
    input.plan?.sourcePath ? dataviewField("workoutPlanPath", input.plan.sourcePath) : "",
    input.plan?.name ? dataviewField("workoutPlan", input.plan.name) : "",
    dataviewField("createdDate", input.startedAt),
    dataviewField("startedAt", input.startedAt),
    dataviewField("status", input.status || "active"),
    input.cooldownDays != null ? dataviewField("cooldownDays", input.cooldownDays) : "",
    input.endedAt ? dataviewField("completedDate", input.endedAt) : "",
    input.endedAt ? dataviewField("endedAt", input.endedAt) : "",
    input.nextEligibleDate ? dataviewField("nextEligibleDate", input.nextEligibleDate) : "",
  ].filter(Boolean);
  return `- ${workoutLabel} ${fields.join(" ")}`;
}

function dataviewField(key, value) {
  if (value == null || value === "") return "";
  return `[${key}:: ${value}]`;
}

function wikilinkFromPath(path) {
  const normalized = path.replace(/\.md$/i, "");
  const label = normalized.split("/").pop() || normalized;
  return `[[${normalized}|${label}]]`;
}

function pathLabel(path) {
  const normalized = path.replace(/\.md$/i, "");
  return normalized.split("/").pop() || normalized;
}
