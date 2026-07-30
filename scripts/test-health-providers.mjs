import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

const USER_AGENT = "TPSHealth/0.1 (Obsidian plugin test)";
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const sharedMobileOverlaySource = readFileSync(new URL("../../TPS-Global-Context-Menu (Dev)/src/utils/mobile-overlay.ts", import.meta.url), "utf8");

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

async function importLoggerUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/logger.ts", import.meta.url))],
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
      constructor(app) { this.app = app; this.__pluginData = null; }
      addCommand() {}
      addSettingTab() {}
      registerBasesView() {}
      registerEditorExtension() {}
      registerEvent() {}
      loadData() { return Promise.resolve(this.__pluginData == null ? null : JSON.parse(JSON.stringify(this.__pluginData))); }
      saveData(value) { this.__pluginData = JSON.parse(JSON.stringify(value)); return Promise.resolve(); }
    }
    export class Modal { constructor(app) { this.app = app; } open() {} close() {} }
    export class Menu {
      addItem(callback) {
        callback?.({ setTitle() { return this; }, setIcon() { return this; }, onClick() { return this; } });
        return this;
      }
      showAtMouseEvent() {}
    }
    export class Notice { constructor(message) { globalThis.__TPSHealthTestNotices?.push(String(message)); } }
    export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; } display() {} }
    export class Setting { constructor() {} setName() { return this; } setDesc() { return this; } addText() { return this; } addButton() { return this; } }
    export class SecretComponent { constructor() {} setValue() { return this; } onChange() { return this; } }
    export class MarkdownView {}
    globalThis.__TPSHealthTestMarkdownView = MarkdownView;
    export class MarkdownRenderChild { constructor(containerEl) { this.containerEl = containerEl; } onload() {} onunload() {} }
    export class EditorSuggest {}
    export class BasesView {}
    export class App {}
    export const Platform = { isDesktop: true, isMobile: false, isDesktopApp: true, isMobileApp: false, isIosApp: false, isAndroidApp: false };
    export const editorLivePreviewField = {};
    export function normalizePath(path) {
      return String(path || "").replace(/\\\\/g, "/").replace(/\\/+/g, "/").replace(/^\\.\\//, "");
    }
    export function setIcon(el, icon) {
      if (el) el.dataset = { ...(el.dataset || {}), icon };
      return el;
    }
    export async function requestUrl(options) {
      if (typeof globalThis.__TPSHealthTestRequestUrl === "function") return globalThis.__TPSHealthTestRequestUrl(options);
      return { status: 200, headers: {}, json: {} };
    }
  `;
  const emptyModule = "export class RangeSetBuilder { add() {} finish() { return {}; } } export const StateField = { define: (spec) => spec }; export class EditorState {} export class Decoration { static none = {}; static widget() { return {}; } static replace() { return {}; } } export class ViewPlugin { static fromClass() { return {}; } } export class WidgetType {} export const EditorView = { decorations: { from: () => ({}) } }; export const DecorationSet = {}; export class ViewUpdate {}";
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
  const secrets = new Map();
  const writes = [];
  const openedFiles = [];
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
      secretStorage: {
        getSecret: (name) => secrets.get(name) || null,
        setSecret: (name, value) => secrets.set(name, value),
      },
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
          openFile: async (file, options) => {
            openedFiles.push({ path: file.path, options });
          },
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
    openedFiles,
    secrets,
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

test("food logger queues searched foods without leaving the search flow", () => {
  assert.match(mainSource, /type FoodLogTab = "barcode" \| "search" \| "mine" \| "describe"/);
  assert.match(mainSource, /private activeFoodLogTab: FoodLogTab/);
  assert.doesNotMatch(mainSource, /Quick add/);
  assert.doesNotMatch(mainSource, /parseQuickFoodEntries/);
  assert.doesNotMatch(mainSource, /handleQuickAdd/);
  assert.match(mainSource, /private searchInputEl: HTMLInputElement \| null = null;/);
  assert.match(mainSource, /this\.selectionItems\.unshift\(\{/);
  assert.doesNotMatch(mainSource, /this\.selectionItems\.push\(\{\s*item: selectedItem/);
  assert.match(mainSource, /this\.resetSearchForNextFood\(enriched\.name\);/);
  assert.match(mainSource, /getPendingFoodLogDraft\(dateContext: FoodLogDateContext \| null\): PendingFoodLogDraft \| null/);
  assert.match(mainSource, /savePendingFoodLogDraft\(draft: PendingFoodLogDraft \| null\): Promise<void>/);
  assert.match(mainSource, /clearPendingFoodLogDraft\(\): Promise<void>/);
  assert.match(mainSource, /logger\.flow\("FoodDraft", "restore:none"/);
  assert.match(mainSource, /logger\.flow\("FoodDraft", "restore:context-mismatch"/);
  assert.match(mainSource, /logger\.flow\("FoodDraft", "restore:found"/);
  assert.match(mainSource, /const pendingDraft = initialDraft \? null : plugin\.getPendingFoodLogDraft\(dateContext\)/);
  assert.match(mainSource, /Restored \$\{this\.selectionItems\.length\} unlogged food/);
  assert.match(mainSource, /private async persistDraft\(\): Promise<void>/);
  assert.match(mainSource, /logger\.flowWarn\("FoodModal", "selection:log-empty"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodModal", "selection:create-recipe-empty"/);
  assert.match(mainSource, /const loggedCount = this\.selectionItems\.length;[\s\S]+await this\.plugin\.clearPendingFoodLogDraft\(\);[\s\S]+this\.selectionItems = \[\];[\s\S]+new Notice\(`Logged \$\{loggedCount\} foods\.`\);/);
  assert.match(mainSource, /Added \$\{addedName\}\. Search for another food or log selected\./);
  assert.match(mainSource, /this\.searchInput = "";/);
  assert.match(mainSource, /this\.resultsEl = this\.contentEl\.createDiv\(\{ cls: "tps-health-search-results" \}\);\s+this\.actionsEl = this\.contentEl\.createDiv\(\{ cls: "tps-health-search-actions" \}\);\s+this\.selectionEl = this\.contentEl\.createDiv\(\{ cls: "tps-health-selection" \}\);/);
  assert.doesNotMatch(stylesSource, /\.tps-health-quick-input/);
  assert.doesNotMatch(stylesSource, /\.tps-health-floating-selection/);
  assert.match(stylesSource, /\.tps-health-selection\.is-empty/);
  assert.match(stylesSource, /\.tps-health-food-tabs[\s\S]+grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(mainSource, /tabsEl\.setAttr\("role", "tablist"\)/);
  assert.match(mainSource, /button\.setAttr\("role", "tab"\)/);
  assert.match(mainSource, /panel\.setAttr\("role", "tabpanel"\)/);
  assert.match(mainSource, /button\.setAttr\("aria-selected", active \? "true" : "false"\)/);
  assert.match(mainSource, /button\.setAttr\("aria-controls", panel\.id\)/);
  assert.match(mainSource, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(stylesSource, /\.tps-health-food-tab:focus-visible/);
});

test("selected food tray edit action keeps the vault-backed pending draft valid", () => {
  assert.match(mainSource, /void this\.refreshSelectionItemsFromSources\(\);/);
  assert.match(mainSource, /const edit = controls\.createEl\("button", \{ text: "Edit", cls: "mod-muted" \}\);/);
  assert.match(mainSource, /private async openSelectionFoodEditor\(entry: BatchFoodSelection\): Promise<void>/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "selection:edit-open"/);
  assert.match(mainSource, /new CustomFoodModal\(this\.app, this\.plugin, type, freshItem\.name, false, freshItem, this\.dateContext, freshItem\.sourcePath, async \(saved\) => \{/);
  assert.match(mainSource, /logger\.flowWarn\("FoodModal", "selection:edit-missing-entry"/);
  assert.match(mainSource, /current\.item = saved;/);
  assert.match(mainSource, /if \(!unitOptions\.includes\(current\.unit\)\) current\.unit = preferredFoodLogUnit\(saved\);/);
  assert.match(mainSource, /await this\.persistDraft\(\);\s+this\.renderSelection\(\);/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "selection:edit-saved"/);
  assert.match(mainSource, /logger\.flow\("CustomFoodModal", "callback:start"/);
  assert.match(mainSource, /logger\.flow\("CustomFoodModal", "callback:done"/);
  assert.match(mainSource, /private async refreshSelectionItemsFromSources\(\): Promise<void>/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "selection:refresh-no-change"/);
  assert.match(mainSource, /private async refreshFoodItemFromSource\(item: FoodItem\): Promise<FoodItem \| null>/);
  assert.match(mainSource, /foodNoteTypeFromFrontmatter\(fm, file, this\.plugin\.settings\)/);
  assert.match(mainSource, /function foodQueueItemSignature\(item: FoodItem\): string/);
  assert.match(mainSource, /private onSaved\?: \(saved: FoodItem\) => void \| Promise<void>/);
});

test("food search ranks messy out-of-order branded queries and gram servings", () => {
  assert.match(mainSource, /function foodSearchTokenMatchScore/);
  assert.match(mainSource, /likelyBrandFirstFoodQuery\(tokens\)/);
  assert.match(mainSource, /const COMMON_FOOD_BRANDS = new Set\(\[/);
  assert.match(mainSource, /"great value"/);
  assert.match(mainSource, /breyers: "breyer"/);
  assert.match(mainSource, /"breyer"/);
  assert.match(mainSource, /score \+= tokenMatch\.exact \* 16 \+ tokenMatch\.fuzzy \* 7/);
  assert.match(mainSource, /exactNameTokenMatch\.total \+ brandTokenMatch\.total >= tokens\.length/);
  assert.match(mainSource, /item\.source === "open-food-facts"\) score \+= tokens\.length > 1 \? 8 : -18/);
  assert.match(mainSource, /metricServing\.unit === "g" \? 36 : 10/);
  assert.match(mainSource, /replace\(\/\[’'\]\/g, ""\)/);
  assert.match(mainSource, /function hasSearchableMacroData\(nutrition: Nutrition \| undefined\): boolean/);
  assert.match(mainSource, /const macros = \[nutrition\.proteinG, nutrition\.carbsG, nutrition\.fatG, nutrition\.sugarAlcoholG, nutrition\.alcoholG\]\.map\(numberOrUndefined\);/);
  assert.match(mainSource, /return macros\.some\(\(value\) => value != null && value > 0\)/);
  assert.match(mainSource, /nutrition\.sugarAlcoholG != null \? `SA \$\{round\(nutrition\.sugarAlcoholG\)\}g` : ""/);
  assert.match(mainSource, /nutrition\.alcoholG != null \? `Alc \$\{round\(nutrition\.alcoholG\)\}g` : ""/);
});

test("meal creation keeps the name input visible above mobile keyboards", () => {
  assert.match(mainSource, /class BatchFoodRecipeModal extends Modal/);
  assert.match(mainSource, /this\.contentEl\.createEl\("h2", \{ text: "Create meal" \}\)/);
  assert.match(mainSource, /\.setName\("Meal name"\)/);
  assert.match(mainSource, /logger\.flowWarn\("FoodModal", "meal:create-empty"/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "meal:create-done"/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "meal:log-modal-open"/);
  assert.match(mainSource, /logger\.flowError\("FoodModal", "meal:create-failed"/);
  assert.match(mainSource, /const mealNameInput = this\.contentEl\.querySelector<HTMLInputElement>\('\.setting-item input\[type="text"\]'\)/);
  assert.match(mainSource, /mealNameInput\?\.addEventListener\("focus", \(\) => scrollHealthModalInputIntoView\(mealNameInput\)\)/);
  assert.match(mainSource, /type: "meal",\s+name,\s+servingAmount: 1,\s+servingUnit: "meal",\s+recipeServings: 1/);
  assert.match(mainSource, /function scrollHealthModalInputIntoView\(element: HTMLElement\): void/);
  assert.match(mainSource, /window\.setTimeout\(\(\) => element\.scrollIntoView\(\{ block: "center", inline: "nearest", behavior: "smooth" \}\), 180\)/);
  assert.match(mainSource, /this\.modalEl\.addClass\("tps-keyboard-aware-modal", "tps-health-modal-frame"\)/);
  assert.doesNotMatch(mainSource, /setupKeyboardAwareHealthModal/);
  assert.match(sharedMobileOverlaySource, /target\.scrollIntoView\(\{ block: 'center'/);
  assert.match(stylesSource, /var\(--tps-visible-viewport-height, 100dvh\)/);
});

test("meal reads and writes enforce the single-serving recipe contract", () => {
  assert.match(mainSource, /function recipeServingsForFood\(item: FoodItem, type: FoodNoteType\): number \{\s*if \(type === "meal"\) return 1;/);
  assert.match(mainSource, /const isMeal = type === "meal";/);
  assert.match(mainSource, /servingAmount: isMeal \? 1 : Number\(fm\.servingAmount \|\| 1\)/);
  assert.match(mainSource, /servingUnit: isMeal \? "meal" : String\(fm\.servingUnit \|\| "serving"\)/);
  assert.match(mainSource, /recipeServings: isMeal \? 1 : numberOrUndefined\(fm\.recipeServings\)/);
});

test("food and recipe edits require an explicit linked-instance versioning choice", () => {
  assert.match(mainSource, /type FoodEditLinkScope = "update-linked" \| "new-version" \| "cancel"/);
  assert.match(mainSource, /text: "Create new version"/);
  assert.match(mainSource, /text: "Update linked instances"/);
  assert.match(mainSource, /const linkScope = this\.editPath \? await chooseFoodEditLinkScope\(this\.app, typeLabel\) : "update-linked"/);
  assert.match(mainSource, /if \(linkScope === "cancel"\) return/);
  assert.match(mainSource, /path: createNewVersion \? undefined : this\.editPath/);
  assert.match(mainSource, /merge: !createNewVersion/);
  assert.match(mainSource, /private getLocalFoodIndex\(\): LocalFoodIndex/);
  assert.match(mainSource, /const markdownFiles = this\.app\.vault\.getMarkdownFiles\(\);/);
  assert.match(mainSource, /\.filter\(\(\{ file, cache \}\) => isFoodLikeMarkdownFile\(this, file, cache\)\)/);
  assert.match(mainSource, /\.sort\(\(a, b\) => \(b\.file\.stat\?\.ctime \|\| b\.file\.stat\?\.mtime \|\| 0\) - \(a\.file\.stat\?\.ctime \|\| a\.file\.stat\?\.mtime \|\| 0\)\)/);
  assert.match(mainSource, /scannedFiles: markdownFiles\.length/);
});

test("logged meal editing exposes draft ingredient amounts before linked-instance save", () => {
  assert.match(mainSource, /tps-health-meal-ingredient-editor/);
  assert.match(mainSource, /Adjust the amount or unit, or add an ingredient/);
  assert.match(mainSource, /parseRecipeIngredientLine\(line, \(foodName\) => this\.plugin\.findRecipeIngredientFoodByName\(foodName\)\)/);
  assert.match(mainSource, /tps-health-meal-ingredient-quantity/);
  assert.match(mainSource, /tps-health-meal-ingredient-unit/);
  assert.match(mainSource, /tps-health-meal-ingredient-food/);
  assert.match(mainSource, /tps-health-meal-ingredient-macros/);
  assert.match(mainSource, /interface RecipeIngredientDraft extends RecipeIngredientLine/);
  assert.match(mainSource, /text: "\+ Add ingredient"/);
  assert.match(mainSource, /new RecipeIngredientModal\(this\.app, this\.plugin, null, async \(selection\) => \{/);
  assert.match(mainSource, /recipeIngredients\.push\(\{\s+quantity: selection\.quantity,\s+unit: selection\.unit,\s+foodPath: selection\.food\.sourcePath,\s+foodName: selection\.food\.name,\s+food: selection\.food,/);
  assert.match(mainSource, /const persistDraftIngredients = async \(\): Promise<RecipeIngredientLine\[\]> => \{[\s\S]+?await this\.plugin\.findOrCreateFoodNote\(ingredient\.food\)/);
  assert.match(mainSource, /if \(linkScope === "cancel"\) return;\s+const createNewVersion = linkScope === "new-version";\s+const savedIngredients = isRecipeLikeFoodType\(this\.type\) \? await persistDraftIngredients\(\) : \[\];/);
  assert.match(mainSource, /const ingredientsForSave = isRecipeLikeFoodType\(this\.type\)\s+\? savedIngredients\.map\(recipeIngredientMarkdown\)\.join\("\\n"\)/);
  assert.match(mainSource, /ingredients: ingredientsForSave/);
  assert.match(mainSource, /const linkScope = this\.editPath \? await chooseFoodEditLinkScope/);
  assert.match(stylesSource, /\.tps-health-meal-ingredient-row/);
});

test("meal ingredient picker returns a local draft without directly mutating the meal", () => {
  const pickerSource = mainSource.slice(
    mainSource.indexOf("class RecipeIngredientModal extends Modal"),
    mainSource.indexOf("function recipeIngredientUnitOptions"),
  );
  assert.match(pickerSource, /private onIngredientSelected\?: \(selection: RecipeIngredientSelection\) => void \| Promise<void>/);
  assert.match(pickerSource, /if \(this\.onIngredientSelected\) \{\s+if \(!isFoodLogUnitSupported\(this\.selectedFood, unit\)\) \{[\s\S]+?\}\s+const canonical = recipeIngredientCanonicalAmount\(this\.selectedFood, quantity, unit\);\s+await this\.onIngredientSelected\(\{ food: this\.selectedFood, quantity: canonical\.quantity, unit: canonical\.unit \}\);\s+logger\.flow\("RecipeIngredient", "add:draft-done"[\s\S]+?this\.close\(\);\s+return;/);
  assert.ok(
    pickerSource.indexOf("if (this.onIngredientSelected)") < pickerSource.indexOf("await this.plugin.findOrCreateFoodNote(this.selectedFood)"),
    "the callback route must run before the direct recipe-note persistence route",
  );
});

test("recipe notes keep ingredient lines editable and food buttons open linked notes safely", () => {
  assert.match(mainSource, /this\.registerEditorExtension\(createRecipeIngredientEditorExtension\(this\)\)/);
  assert.match(mainSource, /function createRecipeIngredientEditorExtension\(plugin: TPSHealthPlugin\)/);
  assert.match(mainSource, /return StateField\.define<DecorationSet>\(\{/);
  assert.match(mainSource, /provide: \(field\) => EditorView\.decorations\.from\(field\)/);
  assert.match(mainSource, /function buildRecipeIngredientEditorDecorations\(plugin: TPSHealthPlugin, state: EditorState\): DecorationSet/);
  assert.match(mainSource, /if \(!state\.field\(editorLivePreviewField, false\)\) return Decoration\.none/);
  assert.match(mainSource, /class RecipeIngredientWidget extends WidgetType/);
  assert.match(mainSource, /this\.filePath = this\.activeFilePath\(view\)/);
  assert.match(mainSource, /const filePath = this\.activeFilePath\(update\.view\)/);
  assert.match(mainSource, /filePath !== this\.filePath/);
  assert.match(mainSource, /const owningFile = markdownFilePathForRenderedElement\(plugin, view\.dom\)/);
  assert.match(mainSource, /if \(isRecipeLikeMarkdownFile\(plugin, activeFilePath\)\) return Decoration\.none/);
  assert.match(mainSource, /builder\.add\(line\.from, line\.to, Decoration\.replace\(\{\s+widget: new RecipeIngredientWidget\(plugin, ingredient, \{ filePath: sourcePath, lineNumber: line\.number - 1, line: line\.text \}\),\s+block: true,/);
  assert.doesNotMatch(mainSource, /builder\.add\(line\.to, line\.to, Decoration\.widget\(\{\s+widget: new RecipeIngredientWidget/);
  assert.match(mainSource, /class RecipeIngredientAddWidget extends WidgetType/);
  assert.match(mainSource, /widget: new RecipeIngredientAddWidget\(plugin, sourcePath\),\s+block: true,/);
  assert.match(mainSource, /class TPSHealthRenderedControlsChild extends MarkdownRenderChild/);
  assert.match(mainSource, /ctx\.addChild\(new TPSHealthRenderedControlsChild\(root, this, ctx\)\)/);
  assert.match(mainSource, /logger\.flowError\("RenderedControls", "postprocessor:failed"/);
  assert.match(mainSource, /function recipeIngredientElement\(plugin: TPSHealthPlugin, ingredient: RecipeIngredientLine, source: FoodLogLineSource\): HTMLElement/);
  assert.match(mainSource, /function safeRecipeIngredientElement\(plugin: TPSHealthPlugin, ingredient: RecipeIngredientLine, source: FoodLogLineSource\): HTMLElement \| null/);
  assert.match(mainSource, /function recipeIngredientField\(label: string, control: HTMLElement, className: string\): HTMLElement/);
  assert.match(mainSource, /recipeIngredientField\("Qty", quantity/);
  assert.match(mainSource, /recipeIngredientField\("Macros", macros/);
  assert.match(mainSource, /let currentUnit = preferredRecipeIngredientUnit\(foodItem, ingredient\.unit\)/);
  assert.match(mainSource, /recipeIngredientQuantityForUnit\(ingredient, foodItem, currentUnit\)/);
  assert.match(mainSource, /recipeIngredientConvertQuantity\(foodItem, parsedQuantity, currentUnit, nextUnit\)/);
  assert.match(mainSource, /const canonical = recipeIngredientCanonicalAmount\(resolvedFood \|\| foodItem, parsedQuantity, parsedUnit\)/);
  assert.match(mainSource, /logger\.flowError\("RecipeIngredient", "render:failed"/);
  assert.match(mainSource, /const row = document\.createElement\("div"\)/);
  assert.match(mainSource, /quantity\.type = "number"/);
  assert.match(mainSource, /const unit = document\.createElement\("select"\)/);
  assert.match(mainSource, /for \(const option of recipeIngredientUnitOptions\(foodItem, ingredient\.unit\)\)/);
  assert.match(mainSource, /function recipeIngredientUnitOptions\(food: FoodItem \| null, currentUnit: string\): string\[\]/);
  assert.match(mainSource, /function preferredRecipeIngredientUnit\(food: FoodItem \| null, currentUnit: string\): string/);
  assert.match(mainSource, /function recipeIngredientQuantityForUnit\(ingredient: RecipeIngredientLine, food: FoodItem \| null, targetUnit: string\): number/);
  assert.match(mainSource, /function recipeIngredientConvertQuantity\(food: FoodItem, quantity: number, fromUnit: string, toUnit: string\): number/);
  assert.match(mainSource, /function recipeIngredientCanonicalAmount\(food: FoodItem \| null, quantity: number, unit: string\): \{ quantity: number; unit: string \}/);
  assert.match(mainSource, /function quantityFromMetricAmount\(amount: number, amountUnit: "g" \| "ml", targetUnit: string\): number \| null/);
  assert.match(mainSource, /await plugin\.updateRecipeIngredientLine\(source, updated\)/);
  assert.match(mainSource, /async updateRecipeIngredientLine\(source: FoodLogLineSource, ingredient: RecipeIngredientLine\): Promise<boolean>/);
  assert.match(mainSource, /async addRecipeIngredientLine\(sourcePath: string, ingredient: RecipeIngredientLine\): Promise<boolean>/);
  assert.match(mainSource, /logger\.flow\("Recipe", "ingredient:add-done"/);
  assert.match(mainSource, /class RecipeIngredientModal extends Modal/);
  assert.match(mainSource, /new RecipeIngredientModal\(plugin\.app, plugin, sourcePath\)\.open\(\)/);
  assert.match(mainSource, /this\.plugin\.searchLocalFoods\(trimmed\)/);
  assert.match(mainSource, /this\.plugin\.searchFoods\(trimmed, undefined, \(\) => token === this\.searchToken\)/);
  assert.match(mainSource, /FOOD_LOCAL_SEARCH_DEBOUNCE_MS = 100/);
  assert.match(mainSource, /setButtonText\("Search online"\)/);
  assert.match(mainSource, /if \(this\.searchTimer !== null\) window\.clearTimeout\(this\.searchTimer\)/);
  assert.match(mainSource, /const savedFood = await this\.plugin\.findOrCreateFoodNote\(this\.selectedFood\)/);
  assert.match(mainSource, /await this\.plugin\.addRecipeIngredientLine\(this\.sourcePath, \{/);
  assert.match(mainSource, /await this\.refreshRecipeNutrition\(file\)/);
  assert.match(mainSource, /logger\.flow\("Recipe", "ingredient:update-done"/);
  assert.match(mainSource, /async refreshRecipeNutrition\(file: TFile\): Promise<void>/);
  assert.match(mainSource, /function parseRecipeIngredientLine\(line: string, resolveFoodByName\?: \(name: string\) => FoodItem \| null\): RecipeIngredientLine \| null/);
  assert.match(mainSource, /findRecipeIngredientFoodByName\(name: string\): FoodItem \| null/);
  assert.match(mainSource, /private normalizeRecipeIngredientLines\(ingredients: string\): string/);
  assert.match(mainSource, /logger\.flow\("Recipe", "ingredients:normalize"/);
  assert.match(mainSource, /async function recipeIngredientLineFromBatchSelection\(plugin: TPSHealthPlugin, entry: BatchFoodSelection\): Promise<string>/);
  assert.match(mainSource, /await plugin\.findOrCreateFoodNote\(entry\.item\)/);
  assert.match(mainSource, /function parseRecipeIngredientRenderedItem\(item: Element, resolveFoodByName\?: \(name: string\) => FoodItem \| null\): RecipeIngredientLine \| null/);
  assert.match(mainSource, /parseRecipeIngredientRenderedItem\(item, \(name\) => plugin\.findRecipeIngredientFoodByName\(name\)\)/);
  assert.match(mainSource, /const rawPath = link\.getAttribute\("data-href"\) \|\| link\.getAttribute\("href"\) \|\| ""/);
  assert.match(mainSource, /parseQuantity\(match\[1\]\)/);
  assert.doesNotMatch(mainSource, /line\.text\.matchAll\(\/<!--\[\\s\\S\]\*\?-->/);
  assert.match(mainSource, /renderRecipeIngredientChips\(root, plugin, ctx\)/);
  assert.match(mainSource, /renderRecipeIngredientAddAction\(root, plugin, ctx\.sourcePath, lastRenderedItem\)/);
  assert.match(mainSource, /if \(!lastRenderedItem\) return/);
  assert.match(mainSource, /function recipeIngredientAddElement\(plugin: TPSHealthPlugin, sourcePath: string\): HTMLElement/);
  assert.match(stylesSource, /\.markdown-source-view\.mod-cm6 \.cm-content \.tps-health-recipe-ingredient \{\s+align-items: center;\s+display: grid !important;/);
  assert.match(stylesSource, /grid-template-columns: minmax\(4\.5rem, 0\.45fr\) minmax\(6rem, 0\.7fr\) minmax\(10rem, 1\.5fr\) minmax\(11rem, 1fr\) !important;/);
  assert.match(stylesSource, /\.markdown-source-view\.mod-cm6 \.cm-content \.tps-health-recipe-ingredient-field--food,\s+\.markdown-source-view\.mod-cm6 \.cm-content \.tps-health-recipe-ingredient-field--macros \{\s+border-top: 0;\s+grid-column: auto;/);
  assert.match(mainSource, /function isRecipeLikeMarkdownFile\(plugin: TPSHealthPlugin, path: string \| null \| undefined\): boolean/);
  assert.match(mainSource, /fileIsInConfiguredFolder\(file\.path, plugin\.settings\.recipesFolder\)/);
  assert.match(mainSource, /function recipeIngredientLine\(item: FoodItem, quantity: number, unit: string\): string/);
  assert.match(mainSource, /return `- \$\{formatQuantityUnit\(quantity, unit \|\| "serving"\)\} - \$\{itemLabel\}`/);
  assert.match(mainSource, /function resolveRecipeIngredientNutrition\(line: string, resolveFood\?: \(foodPath: string\) => FoodItem \| null\): Required<Nutrition> \| null/);
  assert.match(mainSource, /const quantity = parseQuantity\(match\[1\]\)/);
  assert.match(mainSource, /if \(resolved\.unsupportedUnit\) return null/);
  assert.match(mainSource, /async openFoodNoteFile\(file: TFile\): Promise<void>/);
  assert.match(mainSource, /const leafMode = Platform\.isMobileApp \? false : "tab"/);
  assert.match(mainSource, /logger\.flow\("Food", "note-open:start", \{ path: file\.path, leafMode: leafMode === false \? "current" : leafMode \}\)/);
  assert.match(mainSource, /const leaf = workspace\.getLeaf\(leafMode\);\s+await leaf\.openFile\(file\);/);
  assert.match(mainSource, /logger\.flow\("Food", "note-open:done", \{ path: file\.path, leafMode: leafMode === false \? "current" : leafMode \}\)/);
  assert.match(mainSource, /logger\.flowError\("Food", "note-open:failed", error, \{ path: file\.path, leafMode: leafMode === false \? "current" : leafMode \}\)/);
  assert.match(mainSource, /food\.addEventListener\("pointerdown", keepFoodButtonTapLocal\)/);
  assert.match(mainSource, /food\.addEventListener\("touchstart", keepFoodButtonTapLocal\)/);
  assert.match(mainSource, /logger\.flow\("RecipeIngredient", "food-open"/);
  assert.match(mainSource, /logger\.flowWarn\("RecipeIngredient", "food-open:missing-file"/);
  assert.match(mainSource, /logger\.flowWarn\("RecipeIngredient", "save:invalid-quantity"/);
  assert.match(mainSource, /logger\.flowWarn\("RecipeIngredient", "save:missing-unit"/);
  assert.match(mainSource, /logger\.flowWarn\("RecipeIngredient", "save:unsupported-unit"/);
  assert.match(mainSource, /logger\.flow\("RecipeIngredient", "save:submit"/);
  assert.match(mainSource, /logger\.flowWarn\("RecipeIngredient", "save:not-written"/);
  assert.match(mainSource, /logger\.flow\("RecipeIngredient", "save:done"/);
  assert.match(mainSource, /logger\.flowError\("RecipeIngredient", "save:failed"/);
  assert.match(stylesSource, /\.tps-health-recipe-ingredient \{/);
  assert.match(stylesSource, /width: 100%/);
  assert.match(stylesSource, /overflow: hidden/);
  assert.match(stylesSource, /\.tps-health-recipe-ingredient-row::marker/);
  assert.match(stylesSource, /\.tps-health-recipe-ingredient-field--quantity/);
  assert.match(stylesSource, /\.tps-health-recipe-ingredient-label/);
  assert.match(stylesSource, /\.tps-health-recipe-ingredient select/);
  assert.match(stylesSource, /button\.tps-health-recipe-ingredient-food|\.tps-health-recipe-ingredient-food \{/);
});

test("food search excludes macro-less candidates and matches Breyer's spelling variants", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    includeBrandedFoodSearch: false,
    openFoodFactsUserAgent: USER_AGENT,
    usdaApiKey: "DEMO_KEY",
  };
  fake.files.set("Health/Foods/Breyers Vanilla.md", [
    "---",
    "kind: food",
    "name: \"Breyer's Vanilla Ice Cream\"",
    "brand: \"Breyer's\"",
    "servingAmount: 1",
    "servingUnit: \"2/3 cup\"",
    "calories: 170",
    "proteinG: 3",
    "carbsG: 29",
    "fatG: 5",
    "---",
    "",
  ].join("\n"));
  fake.files.set("Health/Foods/Breyers Missing Macros.md", [
    "---",
    "kind: food",
    "name: \"Breyers Missing Macros\"",
    "brand: \"Breyers\"",
    "servingAmount: 1",
    "servingUnit: serving",
    "calories: 170",
    "---",
    "",
  ].join("\n"));
  fake.files.set("Health/Foods/Breyers Zero Macros.md", [
    "---",
    "kind: food",
    "name: \"Breyers Zero Macros\"",
    "brand: \"Breyers\"",
    "servingAmount: 1",
    "servingUnit: serving",
    "calories: 0",
    "proteinG: 0",
    "carbsG: 0",
    "fatG: 0",
    "---",
    "",
  ].join("\n"));

  const results = await plugin.searchFoods("breyers");
  assert.ok(results.some((item) => item.name === "Breyer's Vanilla Ice Cream"));
  assert.equal(results.some((item) => item.name === "Breyers Missing Macros"), false);
  assert.equal(results.some((item) => item.name === "Breyers Zero Macros"), false);
  assert.ok(results.every((item) => [item.nutrition?.proteinG, item.nutrition?.carbsG, item.nutrition?.fatG, item.nutrition?.sugarAlcoholG, item.nutrition?.alcoholG].some((value) => value != null && value > 0)));
});

test("food search matches tokens across name brand aliases notes and ingredients", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    includeBrandedFoodSearch: false,
    openFoodFactsUserAgent: USER_AGENT,
    usdaApiKey: "DEMO_KEY",
  };
  fake.files.set("Health/Foods/Barebells Peanut Butter.md", [
    "---",
    "kind: food",
    "name: \"Peanut Butter Protein Bar\"",
    "brand: \"Barebells\"",
    "aliases:",
    "  - barebells peanut",
    "servingAmount: 1",
    "servingUnit: bar",
    "servingGrams: 55",
    "calories: 200",
    "proteinG: 20",
    "carbsG: 17",
    "fatG: 7",
    "---",
    "",
  ].join("\n"));
  fake.files.set("Health/Foods/Barebells Peanut Butter Jelly.md", [
    "---",
    "kind: food",
    "name: \"Peanut Butter and Jelly Protein Bar\"",
    "brand: \"Barebells\"",
    "aliases:",
    "  - pbj protein bar",
    "notes: \"limited flavor\"",
    "ingredients: \"peanuts, strawberry filling, milk protein\"",
    "servingAmount: 1",
    "servingUnit: bar",
    "servingGrams: 55",
    "calories: 200",
    "proteinG: 20",
    "carbsG: 20",
    "fatG: 7",
    "---",
    "",
  ].join("\n"));

  const crossFieldResults = await plugin.searchFoods("Barebells peanut butter");
  assert.ok(crossFieldResults.some((item) => item.name === "Peanut Butter Protein Bar"));
  assert.ok(crossFieldResults.some((item) => item.name === "Peanut Butter and Jelly Protein Bar"));

  const fuzzyResults = await plugin.searchFoods("Barebels peannut buter");
  assert.ok(fuzzyResults.some((item) => item.name === "Peanut Butter Protein Bar"));
  assert.ok(fuzzyResults.some((item) => item.name === "Peanut Butter and Jelly Protein Bar"));

  const ingredientResults = await plugin.searchFoods("barebells strawberry");
  assert.ok(ingredientResults.some((item) => item.name === "Peanut Butter and Jelly Protein Bar"));
});

test("food search keeps specific common foods available after provider filtering", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    includeBrandedFoodSearch: true,
    openFoodFactsUserAgent: USER_AGENT,
    usdaApiKey: "DEMO_KEY",
  };
  plugin.searchUsdaFoods = async () => [];
  plugin.searchOpenFoodFacts = async () => [];

  const results = await plugin.searchFoods("hawaiian roll");
  assert.ok(results.some((item) => item.name === "Hawaiian sweet roll"));

  const alcoholResults = await plugin.searchFoods("whisky");
  const whiskey = alcoholResults.find((item) => item.name === "Whiskey, 80 proof");
  assert.ok(whiskey, "expected curated whiskey result");
  assert.equal(whiskey.nutrition?.alcoholG, 14);
  assert.equal(whiskey.nutrition?.proteinG, undefined);
});

test("food search honors the branded-provider toggle", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
  };
  plugin.searchCustomFoods = async () => [];
  plugin.getLoggedFoodStats = async () => new Map();
  const searchUsdaFoods = plugin.searchUsdaFoods.bind(plugin);

  const brandedFlags = [];
  let openFoodFactsCalls = 0;
  plugin.searchUsdaFoods = async (_query, includeBranded) => {
    brandedFlags.push(includeBranded);
    return [];
  };
  plugin.searchOpenFoodFacts = async () => {
    openFoodFactsCalls += 1;
    return [];
  };

  plugin.settings.includeBrandedFoodSearch = false;
  await plugin.searchFoods("apple");
  assert.deepEqual(brandedFlags, [false]);
  assert.equal(openFoodFactsCalls, 0);

  plugin.settings.includeBrandedFoodSearch = true;
  await plugin.searchFoods("apple");
  assert.deepEqual(brandedFlags, [false, true]);
  assert.equal(openFoodFactsCalls, 1);

  const usdaDataTypes = [];
  plugin.searchUsdaByDataTypes = async (_query, dataTypes) => {
    usdaDataTypes.push(dataTypes.join(","));
    return [];
  };
  await searchUsdaFoods("apple", false);
  assert.equal(usdaDataTypes.length, 1);
  assert.equal(usdaDataTypes[0].split(",").includes("Branded"), false);
  usdaDataTypes.length = 0;
  await searchUsdaFoods("apple", true);
  assert.equal(usdaDataTypes.length, 1);
  assert.equal(usdaDataTypes[0].split(",").includes("Branded"), true);
});

test("local food and usage indexes are reused until explicitly invalidated", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodIdentificationMode: "folder",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    dailyNoteFolder: "Daily Notes",
    foodLogFilePath: "Food Log.md",
    includeBrandedFoodSearch: false,
  };
  fake.files.set("Health/Foods/Indexed Apple.md", [
    "---",
    "kind: food",
    "name: \"Indexed Apple\"",
    "servingAmount: 1",
    "servingUnit: serving",
    "calories: 95",
    "proteinG: 1",
    "carbsG: 25",
    "fatG: 0.3",
    "---",
    "",
  ].join("\n"));
  fake.files.set("Daily Notes/2026-07-26.md", "- Indexed Apple [food:: Indexed Apple] [qty:: 1] [unit:: serving] [createdDate:: 2026-07-26T08:00:00.000Z]\n");

  const getMarkdownFiles = fake.app.vault.getMarkdownFiles.bind(fake.app.vault);
  let markdownScans = 0;
  fake.app.vault.getMarkdownFiles = () => {
    markdownScans += 1;
    return getMarkdownFiles();
  };
  const cachedRead = fake.app.vault.cachedRead.bind(fake.app.vault);
  let historyReads = 0;
  fake.app.vault.cachedRead = async (file) => {
    historyReads += 1;
    return cachedRead(file);
  };

  const first = await plugin.searchLocalFoods("indexed");
  const second = await plugin.searchLocalFoods("indexed");
  assert.ok(first.some((item) => item.name === "Indexed Apple"));
  assert.ok(second.some((item) => item.name === "Indexed Apple"));
  assert.equal(markdownScans, 1, "repeated local searches should reuse one catalog scan");

  const firstUsage = await plugin.getLoggedFoodStats("indexed");
  const secondUsage = await plugin.getLoggedFoodStats("apple");
  assert.equal(firstUsage, secondUsage, "history lookups should reuse the same cached usage map");
  assert.equal(historyReads, 1, "repeated history lookups should not reread daily notes");
  const savedFoods = await plugin.getSavedFoods(firstUsage);
  assert.deepEqual(savedFoods.map((item) => item.name), ["Indexed Apple"]);
  assert.ok(savedFoods.every((item) => item.source === "custom-note"), "Saved must never be filled with curated suggestions");

  fake.files.set("Health/Foods/Indexed Yogurt.md", [
    "---",
    "kind: food",
    "name: \"Indexed Yogurt\"",
    "servingAmount: 1",
    "servingUnit: cup",
    "calories: 120",
    "proteinG: 15",
    "carbsG: 8",
    "fatG: 2",
    "---",
    "",
  ].join("\n"));
  assert.equal((await plugin.searchLocalFoods("indexed yogurt")).some((item) => item.name === "Indexed Yogurt"), false);
  plugin.invalidateFoodSearchIndexes("test");
  assert.ok((await plugin.searchLocalFoods("indexed yogurt")).some((item) => item.name === "Indexed Yogurt"));
  await plugin.getLoggedFoodStats("indexed");
  assert.equal(markdownScans, 4, "catalog and usage each rebuild once after invalidation");
  assert.equal(historyReads, 2);

  const invalidationSource = mainSource.slice(
    mainSource.indexOf("private registerFoodSearchIndexInvalidation"),
    mainSource.indexOf("private getLocalFoodIndex"),
  );
  for (const eventName of ["create", "modify", "delete", "rename"]) {
    assert.match(invalidationSource, new RegExp(`vault\\.on\\("${eventName}"`));
  }
  assert.match(invalidationSource, /metadataCache\.on\("changed"/);
  assert.match(invalidationSource, /this\.invalidateFoodSearchIndexes\("metadata", file\)/);
});

test("local food index filters candidates before sorting without changing order or scan accounting", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodIdentificationMode: "folder",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
  };

  const foodFiles = [
    { path: "Health/Foods/Newest.md", timestamp: 400, name: "Newest" },
    { path: "Health/Foods/Tied First.md", timestamp: 300, name: "Tied First" },
    { path: "Health/Foods/Tied Second.md", timestamp: 300, name: "Tied Second" },
    { path: "Health/Foods/Oldest.md", timestamp: 100, name: "Oldest" },
  ];
  for (const food of foodFiles) {
    fake.files.set(food.path, [
      "---",
      "kind: food",
      `name: "${food.name}"`,
      "calories: 100",
      "proteinG: 1",
      "---",
      "",
    ].join("\n"));
  }
  for (let index = 0; index < 200; index += 1) {
    fake.files.set(`Projects/Unrelated ${String(index).padStart(3, "0")}.md`, "---\nkind: project\n---\n");
  }

  const TFile = globalThis.__TPSHealthTestTFile;
  let statReads = 0;
  const descriptors = [
    ...Array.from({ length: 200 }, (_, index) => ({
      path: `Projects/Unrelated ${String(index).padStart(3, "0")}.md`,
      timestamp: 10_000 - index,
    })),
    ...foodFiles,
  ];
  fake.app.vault.getMarkdownFiles = () => descriptors.map(({ path, timestamp }) => {
    const file = new TFile(path);
    Object.defineProperty(file, "stat", {
      configurable: true,
      get() {
        statReads += 1;
        return { ctime: timestamp, mtime: timestamp };
      },
    });
    return file;
  });

  const index = plugin.getLocalFoodIndex();
  assert.deepEqual(
    index.items.map((item) => item.sourcePath),
    [
      "Health/Foods/Newest.md",
      "Health/Foods/Tied First.md",
      "Health/Foods/Tied Second.md",
      "Health/Foods/Oldest.md",
    ],
    "filtering before the stable timestamp sort must preserve the prior food ordering",
  );
  assert.equal(index.scannedFiles, descriptors.length, "scan accounting must still report every inspected Markdown file");
  assert.ok(statReads <= 32, `only the four eligible food candidates should participate in sorting (stat reads: ${statReads})`);
});

test("food index invalidation ignores unrelated metadata churn", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodIdentificationMode: "folder",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    dailyNoteFolder: "Daily Notes",
    foodLogFilePath: "Food Log.md",
  };
  fake.files.set("Health/Foods/Indexed Apple.md", [
    "---",
    "kind: food",
    "name: \"Indexed Apple\"",
    "calories: 95",
    "proteinG: 1",
    "carbsG: 25",
    "fatG: 0.3",
    "---",
    "",
  ].join("\n"));
  fake.files.set("Daily Notes/2026-07-26.md", "- Indexed Apple [food:: Indexed Apple] [createdDate:: 2026-07-26T08:00:00.000Z]\n");
  fake.files.set("Projects/Unrelated.md", "---\nkind: project\n---\n");

  await plugin.searchLocalFoods("indexed");
  await plugin.getLoggedFoodStats("indexed");
  const TFile = globalThis.__TPSHealthTestTFile;

  plugin.invalidateFoodSearchIndexes("metadata", new TFile("Projects/Unrelated.md"));
  assert.equal(plugin.localFoodIndexDirty, false, "unrelated note metadata must not force a catalog rescan");
  assert.equal(plugin.foodUsageIndexDirty, false, "unrelated note metadata must not force a history rescan");

  plugin.invalidateFoodSearchIndexes("metadata", new TFile("Daily Notes/2026-07-26.md"));
  assert.equal(plugin.localFoodIndexDirty, false, "daily-note edits must not force a food catalog rescan");
  assert.equal(plugin.foodUsageIndexDirty, true, "daily-note edits must invalidate usage ranking");

  plugin.foodUsageIndexDirty = false;
  plugin.invalidateFoodSearchIndexes("metadata", new TFile("Health/Foods/Indexed Apple.md"));
  assert.equal(plugin.localFoodIndexDirty, true, "food-note metadata changes must invalidate the catalog");
  assert.equal(plugin.foodUsageIndexDirty, false, "food-note metadata changes must not invalidate daily usage");
});

test("usage index coalesces reads and cannot publish a snapshot invalidated mid-scan", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    dailyNoteFolder: "Daily Notes",
    foodLogFilePath: "Food Log.md",
  };
  const dailyPath = "Daily Notes/2026-07-26.md";
  const logLine = "- Indexed Apple [food:: Indexed Apple] [createdDate:: 2026-07-26T08:00:00.000Z]\n";
  fake.files.set(dailyPath, logLine);
  let releaseRead;
  const heldRead = new Promise((resolve) => {
    releaseRead = resolve;
  });
  let reads = 0;
  const normalRead = fake.app.vault.cachedRead.bind(fake.app.vault);
  fake.app.vault.cachedRead = async () => {
    reads += 1;
    return heldRead;
  };

  const first = plugin.getLoggedFoodStats("first");
  const joined = plugin.getLoggedFoodStats("joined");
  assert.equal(reads, 1, "concurrent history requests should share one scan");
  const TFile = globalThis.__TPSHealthTestTFile;
  plugin.invalidateFoodSearchIndexes("modify", new TFile(dailyPath));
  releaseRead(logLine);
  await Promise.all([first, joined]);
  assert.equal(plugin.foodUsageIndexDirty, true, "a mid-scan edit must keep the usage index dirty");

  fake.app.vault.cachedRead = normalRead;
  await plugin.getLoggedFoodStats("rebuilt");
  assert.equal(plugin.foodUsageIndexDirty, false, "the next request should rebuild and publish a clean snapshot");
  assert.equal(reads, 1, "the held scan should still perform only one underlying read");
});

test("local-as-you-type search stays offline while explicit search invokes providers", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodIdentificationMode: "folder",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    includeBrandedFoodSearch: true,
  };
  fake.files.set("Health/Foods/Network Probe.md", [
    "---",
    "kind: food",
    "name: \"Network Probe Food\"",
    "servingAmount: 1",
    "servingUnit: serving",
    "calories: 100",
    "proteinG: 10",
    "carbsG: 10",
    "fatG: 2",
    "---",
    "",
  ].join("\n"));
  let usdaCalls = 0;
  let openFoodFactsCalls = 0;
  plugin.searchUsdaFoods = async () => {
    usdaCalls += 1;
    return [];
  };
  plugin.searchOpenFoodFacts = async () => {
    openFoodFactsCalls += 1;
    return [];
  };
  plugin.getLoggedFoodStats = async () => new Map();

  const local = await plugin.searchLocalFoods("network probe");
  assert.ok(local.some((item) => item.name === "Network Probe Food"));
  assert.equal(usdaCalls, 0);
  assert.equal(openFoodFactsCalls, 0);

  await plugin.searchFoods("network probe");
  assert.equal(usdaCalls, 1);
  assert.equal(openFoodFactsCalls, 1);
  assert.match(mainSource, /private queueSearch\(query: string\): void[\s\S]+this\.runLocalSearch\(query, token\)/);
  assert.match(mainSource, /private submitOnlineSearch\(query: string\): void/);
  assert.match(mainSource, /this\.plugin\.searchFoods\(trimmed, undefined, \(\) => token === this\.searchToken/);
  assert.match(mainSource, /Press Enter (?:for|to check) online databases/);
  assert.match(mainSource, /class FoodLogEditorSuggest[\s\S]+this\.plugin\.searchLocalFoods\(draft\.query\)/);
});

test("Open Food Facts text search coalesces requests, caches results, and caps route fan-out", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    openFoodFactsUserAgent: USER_AGENT,
  };
  const proteinBar = {
    code: "012345678905",
    product_name: "Acme Protein Bar",
    brands: "Acme",
    serving_quantity: 50,
    serving_size: "50 g",
    nutriments: {
      "energy-kcal_100g": 400,
      proteins_100g: 40,
      carbohydrates_100g: 30,
      fat_100g: 12,
    },
  };
  const legacySnack = {
    ...proteinBar,
    code: "012345678912",
    product_name: "Legacy Snack",
    brands: "Legacy",
  };
  const requests = [];
  let releasePrimary;
  const heldPrimary = new Promise((resolve) => {
    releasePrimary = resolve;
  });
  globalThis.__TPSHealthTestRequestUrl = async (options) => {
    requests.push(options);
    return heldPrimary;
  };
  try {
    const first = plugin.searchOpenFoodFacts("acme protein bar");
    const joined = plugin.searchOpenFoodFacts("  acme   protein bar ");
    assert.equal(requests.length, 1, "identical in-flight searches should share one provider request");
    releasePrimary({ status: 200, headers: {}, json: { hits: [proteinBar] } });
    const [firstResults, joinedResults] = await Promise.all([first, joined]);
    assert.equal(firstResults[0]?.name, "Acme Protein Bar");
    assert.equal(joinedResults[0]?.name, "Acme Protein Bar");
    assert.equal(requests.length, 1);

    const cached = await plugin.searchOpenFoodFacts("acme protein bar");
    assert.equal(cached[0]?.name, "Acme Protein Bar");
    assert.equal(requests.length, 1, "cached searches should not spend another OFF request");

    globalThis.__TPSHealthTestRequestUrl = async (options) => {
      requests.push(options);
      if (options.url.startsWith("https://search.openfoodfacts.org/")) {
        return { status: 200, headers: {}, json: { hits: [] } };
      }
      return { status: 200, headers: {}, json: { products: [legacySnack] } };
    };
    const fallbackResults = await plugin.searchOpenFoodFacts("legacy snack");
    assert.equal(fallbackResults[0]?.name, "Legacy Snack");
    assert.equal(requests.length, 3, "a miss should make one primary request and at most one legacy fallback");
    assert.equal(requests.filter((request) => request.url.startsWith("https://search.openfoodfacts.org/")).length, 2);
    assert.equal(requests.filter((request) => request.url.startsWith("https://world.openfoodfacts.org/cgi/search.pl")).length, 1);
    assert.ok(requests.every((request) => request.headers?.["User-Agent"] === USER_AGENT));

    await plugin.searchOpenFoodFacts(" legacy  snack ");
    assert.equal(requests.length, 3, "the fallback result should also be cached");

    globalThis.__TPSHealthTestRequestUrl = async (options) => {
      requests.push(options);
      throw new Error("temporary OFF outage");
    };
    assert.deepEqual(await plugin.searchOpenFoodFacts("temporary outage probe"), []);
    const failedRequestCount = requests.length;
    assert.equal(failedRequestCount, 5, "a failed primary route may spend only one legacy fallback request");

    globalThis.__TPSHealthTestRequestUrl = async (options) => {
      requests.push(options);
      return {
        status: 200,
        headers: {},
        json: { hits: [{ ...proteinBar, code: "012345678929", product_name: "Temporary Outage Probe" }] },
      };
    };
    const retryAfterFailure = await plugin.searchOpenFoodFacts("temporary outage probe");
    assert.equal(retryAfterFailure[0]?.name, "Temporary Outage Probe");
    assert.equal(requests.length, failedRequestCount + 1, "transient provider failures must not become cached misses");

    globalThis.__TPSHealthTestRequestUrl = async (options) => {
      requests.push(options);
      if (options.url.startsWith("https://search.openfoodfacts.org/")) {
        return { status: 200, headers: {}, json: { hits: [] } };
      }
      throw new Error("temporary legacy route outage");
    };
    assert.deepEqual(await plugin.searchOpenFoodFacts("partial outage probe"), []);
    const partialFailureRequestCount = requests.length;

    globalThis.__TPSHealthTestRequestUrl = async (options) => {
      requests.push(options);
      return {
        status: 200,
        headers: {},
        json: { hits: [{ ...proteinBar, code: "012345678936", product_name: "Partial Outage Probe" }] },
      };
    };
    const retryAfterPartialFailure = await plugin.searchOpenFoodFacts("partial outage probe");
    assert.equal(retryAfterPartialFailure[0]?.name, "Partial Outage Probe");
    assert.equal(requests.length, partialFailureRequestCount + 1, "a partially failed empty search must remain retryable");
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("barcode lookup resolves local UPC aliases and coalesces equivalent remote lookups", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const localFake = createFakeHealthApp();
  const localPlugin = new TPSHealthPlugin(localFake.app);
  localPlugin.settings = {
    ...localPlugin.settings,
    foodIdentificationMode: "folder",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
  };
  localFake.files.set("Health/Foods/Alias Bar.md", [
    "---",
    "kind: food",
    "name: \"Alias Bar\"",
    "barcode: \"012345678905\"",
    "servingAmount: 1",
    "servingUnit: bar",
    "calories: 200",
    "proteinG: 20",
    "carbsG: 20",
    "fatG: 7",
    "---",
    "",
  ].join("\n"));
  let localRemoteCalls = 0;
  localPlugin.lookupOpenFoodFactsBarcode = async () => {
    localRemoteCalls += 1;
    return null;
  };
  const localAlias = await localPlugin.lookupFoodByBarcode("0012345678905");
  assert.equal(localAlias?.name, "Alias Bar");
  assert.equal(localRemoteCalls, 0, "a UPC/EAN alias found in the local index must not hit the network");

  const remoteFake = createFakeHealthApp();
  const remotePlugin = new TPSHealthPlugin(remoteFake.app);
  remotePlugin.settings = {
    ...remotePlugin.settings,
    openFoodFactsUserAgent: USER_AGENT,
  };
  window.setTimeout = (callback, delay) => globalThis.setTimeout(callback, delay);
  window.clearTimeout = (timer) => globalThis.clearTimeout(timer);
  let candidateCalls = 0;
  let releaseCandidate;
  const heldCandidate = new Promise((resolve) => {
    releaseCandidate = resolve;
  });
  remotePlugin.lookupOpenFoodFactsBarcodeCandidate = async () => {
    candidateCalls += 1;
    return heldCandidate;
  };
  const remoteItem = {
    id: "012345678905",
    name: "Remote Alias Bar",
    barcode: "012345678905",
    source: "open-food-facts",
    servingAmount: 1,
    servingUnit: "bar",
    nutrition: { calories: 210, proteinG: 20, carbsG: 21, fatG: 7 },
  };
  const first = remotePlugin.lookupOpenFoodFactsBarcode("0012345678905");
  const joined = remotePlugin.lookupOpenFoodFactsBarcode("012345678905");
  assert.equal(candidateCalls, 1, "equivalent UPC/EAN lookups should join one request");
  releaseCandidate(remoteItem);
  assert.equal((await first)?.name, "Remote Alias Bar");
  assert.equal((await joined)?.name, "Remote Alias Bar");
  assert.equal((await remotePlugin.lookupOpenFoodFactsBarcode("012345678905"))?.name, "Remote Alias Bar");
  assert.equal(candidateCalls, 1, "a successful barcode lookup should be served from cache");

  remotePlugin.lookupOpenFoodFactsBarcodeCandidate = async () => {
    candidateCalls += 1;
    return null;
  };
  assert.equal(await remotePlugin.lookupOpenFoodFactsBarcode("4006381333931"), null);
  assert.equal(await remotePlugin.lookupOpenFoodFactsBarcode("4006381333931"), null);
  assert.equal(candidateCalls, 2, "a confirmed barcode miss should be negatively cached");
});

test("typed and camera barcode misses return newly created foods to the existing tray", () => {
  const typedLookup = mainSource.slice(
    mainSource.indexOf("private async handleBarcodeAdd"),
    mainSource.indexOf("private async renderQuickPicks"),
  );
  const scannerLookup = mainSource.slice(
    mainSource.indexOf("private async lookup(rawBarcode"),
    mainSource.indexOf("private stopScanning"),
  );
  const reviewModal = mainSource.slice(
    mainSource.indexOf("class BarcodeFoodReviewModal"),
    mainSource.indexOf("class FoodLogModal"),
  );
  assert.match(typedLookup, /new BarcodeFoodReviewModal\([\s\S]+this\.dateContext, async \(saved\) => \{\s+await this\.addSelection\(saved, null, \{ enrich: false \}\);\s+this\.statusEl\.setText\(`Added \$\{saved\.name\}`\);/);
  assert.match(scannerLookup, /new BarcodeFoodReviewModal\([\s\S]+this\.dateContext,\s+this\.onItem,/);
  assert.match(reviewModal, /private onSaved\?: \(item: FoodItem\) => Promise<void> \| void/);
  assert.match(reviewModal, /\.setButtonText\(this\.onSaved \? "Create and add" : "Create food"\)/);
  assert.match(reviewModal, /if \(this\.onSaved\) await this\.onSaved\(saved\);\s+else new FoodLogModal/);
  assert.doesNotMatch(reviewModal, /Create and log/);
});

test("food result metadata uses clean source labels", () => {
  assert.match(mainSource, /"custom-note": "Saved"/);
  assert.match(mainSource, /curated: "Built-in"/);
  assert.match(mainSource, /usda: "USDA"/);
  assert.match(mainSource, /"open-food-facts": "Open Food Facts"/);
  assert.match(mainSource, /manual: "Manual"/);
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf("function foodResultMeta"), mainSource.indexOf("function foodLogDraftMatchesDateContext")),
    /return \[item\.brand, item\.source/,
  );
});

test("Describe bounds provider fan-out and reuses one history snapshot", () => {
  const aiDescribe = mainSource.slice(
    mainSource.indexOf("private async openFoodDescriberWithAi"),
    mainSource.indexOf("private async describeFoodAi"),
  );
  const legacyDescribe = mainSource.slice(
    mainSource.indexOf("private async legacyOpenFoodDescriber"),
    mainSource.indexOf("openWorkoutStarter"),
  );
  assert.match(aiDescribe, /const loggedStats = await this\.getLoggedFoodStats\(""\)/);
  assert.match(aiDescribe, /mapWithConcurrency\(plannedFoods, 3, async \(food\) =>/);
  assert.match(aiDescribe, /for \(const query of food\.queries\.slice\(0, 2\)\)/);
  assert.match(aiDescribe, /this\.searchLocalFoods\(query, loggedStats\)/);
  assert.match(aiDescribe, /if \(remoteQueriesUsed >= DESCRIBE_REMOTE_QUERY_BUDGET\) continue/);
  assert.match(aiDescribe, /remoteQueriesUsed\+\+/);
  assert.match(aiDescribe, /this\.searchFoods\(query, loggedStats\)/);
  assert.match(aiDescribe, /if \(candidates\.length >= 8\) break/);
  assert.match(legacyDescribe, /const loggedStats = await this\.getLoggedFoodStats\(""\)/);
  assert.match(legacyDescribe, /mapWithConcurrency\(parts, 3, async \(part\) =>/);
  assert.match(legacyDescribe, /this\.searchLocalFoods\(part\.query, loggedStats\)/);
  assert.match(legacyDescribe, /remoteQueriesUsed < DESCRIBE_REMOTE_QUERY_BUDGET/);
  assert.match(legacyDescribe, /this\.searchFoods\(part\.query, loggedStats\)/);
  assert.match(mainSource, /const DESCRIBE_REMOTE_QUERY_BUDGET = 4/);
  assert.match(mainSource, /async function mapWithConcurrency<T, R>\(items: T\[\], concurrency: number/);
  assert.match(mainSource, /Array\.from\(\{ length: Math\.min\(Math\.max\(1, concurrency\), items\.length\) \}/);
});

test("USDA provider combines data types, parses responses, and dedupes cached requests", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = { ...plugin.settings, usdaApiKeySecrets: ["usda-primary-ref", "usda-fallback-ref"] };
  fake.secrets.set("usda-primary-ref", "test-only-usda-primary");
  fake.secrets.set("usda-fallback-ref", "test-only-usda-fallback");
  const requests = [];
  globalThis.__TPSHealthTestRequestUrl = async (options) => {
    requests.push(options);
    return {
      status: 200,
      headers: { "x-ratelimit-remaining": "999" },
      json: {
        foods: [{
          fdcId: 123,
          description: "APPLE RAW",
          foodNutrients: [
            { nutrientId: 1008, value: 52 },
            { nutrientId: 1005, value: 13.8 },
          ],
        }],
      },
    };
  };
  try {
    const [first, joined] = await Promise.all([
      plugin.searchUsdaFoods("apple", true),
      plugin.searchUsdaFoods("Apple", true),
    ]);
    assert.equal(requests.length, 1, "normalized concurrent queries should share one request");
    assert.equal(first[0]?.name, "Apple Raw");
    assert.equal(first[0]?.nutrition?.calories, 52);
    assert.equal(joined[0]?.nutrition?.carbsG, 13.8);
    const requestBody = JSON.parse(requests[0].body);
    assert.deepEqual(requestBody.dataType, ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"]);
    assert.equal(requestBody.query, "apple");
    assert.equal(requestBody.pageSize, 20);
    assert.equal(requests[0].throw, false);
    assert.match(requests[0].url, /test-only-usda-primary/);
    assert.doesNotMatch(requests[0].url, /test-only-usda-fallback/);

    const cached = await plugin.searchUsdaFoods("apple", true);
    assert.equal(cached.length, 1);
    assert.equal(requests.length, 1, "successful responses should use the TTL cache");
    const internalKeys = [...plugin.usdaSearchCache.keys(), ...plugin.usdaRejectedCredentials, ...plugin.usdaRateLimitedUntil.keys()].join("|");
    assert.doesNotMatch(internalKeys, /test-only-usda|usda-primary-ref|usda-fallback-ref/, "provider state must not contain credential names or values");
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("USDA credentials use the first populated reference and fall back to DEMO_KEY only when all are empty", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const dataTypes = ["Foundation"];
  const requests = [];
  globalThis.__TPSHealthTestRequestUrl = async (options) => {
    requests.push(options);
    return { status: 200, headers: {}, json: { foods: [] } };
  };
  try {
    const fallbackApp = createFakeHealthApp();
    const fallbackPlugin = new TPSHealthPlugin(fallbackApp.app);
    fallbackPlugin.settings = { ...fallbackPlugin.settings, usdaApiKeySecrets: ["missing-primary-ref", "populated-fallback-ref"] };
    fallbackApp.secrets.set("populated-fallback-ref", "test-only-fallback-key");
    await fallbackPlugin.searchUsdaByDataTypes("apple", dataTypes, 8);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /test-only-fallback-key/);
    assert.doesNotMatch(requests[0].url, /DEMO_KEY/);

    const demoApp = createFakeHealthApp();
    const demoPlugin = new TPSHealthPlugin(demoApp.app);
    demoPlugin.settings = { ...demoPlugin.settings, usdaApiKeySecrets: ["missing-primary-ref", "missing-fallback-ref"] };
    await demoPlugin.searchUsdaByDataTypes("pear", dataTypes, 8);
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /api_key=DEMO_KEY/);
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("USDA rotates only on exact missing or invalid key responses", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const dataTypes = ["Foundation"];
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = { ...plugin.settings, usdaApiKeySecrets: ["primary-ref", "fallback-ref"] };
  fake.secrets.set("primary-ref", "test-only-invalid-primary");
  fake.secrets.set("fallback-ref", "test-only-valid-fallback");
  const requests = [];
  globalThis.__TPSHealthTestRequestUrl = async (options) => {
    requests.push(options);
    if (options.url.includes("test-only-invalid-primary")) {
      return { status: 403, headers: {}, json: { error: { code: "API_KEY_INVALID" } } };
    }
    return { status: 200, headers: {}, json: { foods: [] } };
  };
  try {
    await plugin.searchUsdaByDataTypes("apple", dataTypes, 8);
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /test-only-invalid-primary/);
    assert.match(requests[1].url, /test-only-valid-fallback/);

    const disabledApp = createFakeHealthApp();
    const disabledPlugin = new TPSHealthPlugin(disabledApp.app);
    disabledPlugin.settings = { ...disabledPlugin.settings, usdaApiKeySecrets: ["disabled-ref", "unused-ref"] };
    disabledApp.secrets.set("disabled-ref", "test-only-disabled-key");
    disabledApp.secrets.set("unused-ref", "test-only-unused-key");
    let disabledRequests = 0;
    globalThis.__TPSHealthTestRequestUrl = async () => {
      disabledRequests += 1;
      return { status: 403, headers: {}, json: { error: { code: "API_KEY_DISABLED" } } };
    };
    await assert.rejects(() => disabledPlugin.searchUsdaByDataTypes("apple", dataTypes, 8), /API_KEY_DISABLED/);
    assert.equal(disabledRequests, 1, "disabled credentials must surface without trying a fallback");

    const serverErrorApp = createFakeHealthApp();
    const serverErrorPlugin = new TPSHealthPlugin(serverErrorApp.app);
    serverErrorPlugin.settings = { ...serverErrorPlugin.settings, usdaApiKeySecrets: ["server-error-ref", "server-error-fallback-ref"] };
    serverErrorApp.secrets.set("server-error-ref", "test-only-server-error-key");
    serverErrorApp.secrets.set("server-error-fallback-ref", "test-only-server-error-fallback");
    let serverErrorRequests = 0;
    globalThis.__TPSHealthTestRequestUrl = async () => {
      serverErrorRequests += 1;
      return { status: 503, headers: {}, json: {} };
    };
    await assert.rejects(() => serverErrorPlugin.searchUsdaByDataTypes("apple", dataTypes, 8), /HTTP 503/);
    assert.equal(serverErrorRequests, 1, "server errors must not rotate credentials");
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("USDA 429 opens one configured-stack circuit and never rotates", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = { ...plugin.settings, usdaApiKeySecrets: ["primary-ref", "fallback-ref"] };
  fake.secrets.set("primary-ref", "test-only-primary-key");
  fake.secrets.set("fallback-ref", "test-only-fallback-key");
  let requests = 0;
  globalThis.__TPSHealthTestRequestUrl = async () => {
    requests += 1;
    return { status: 429, headers: { "Retry-After": "120" }, json: { error: { code: "OVER_RATE_LIMIT" } } };
  };
  try {
    const dataTypes = ["Foundation"];
    await plugin.searchUsdaByDataTypes("apple", dataTypes, 8);
    assert.equal(requests, 1, "429 must not try the configured fallback");
    plugin.settings.usdaApiKeySecrets = ["fallback-ref", "primary-ref"];
    await plugin.searchUsdaByDataTypes("pear", dataTypes, 8);
    assert.equal(requests, 1, "reordering must not bypass the configured-stack circuit");
    assert.ok(plugin.usdaRateLimitedUntil.get("secret") > Date.now());
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("USDA queue opens a source-scoped 429 circuit without blocking a secret credential", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin, retryAfterMs } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  let requests = 0;
  globalThis.__TPSHealthTestRequestUrl = async () => {
    requests += 1;
    if (requests === 1) return { status: 429, headers: { "rEtRy-AfTeR": "120" }, json: { error: { code: "OVER_RATE_LIMIT" } } };
    return { status: 200, headers: {}, json: { foods: [{ fdcId: 456, description: "PEAR RAW", foodNutrients: [{ nutrientId: 1005, value: 15 }] }] } };
  };
  try {
    const dataTypes = ["Foundation", "SR Legacy", "Survey (FNDDS)"];
    const startedAt = Date.now();
    const burst = await Promise.all([
      plugin.searchUsdaByDataTypes("apple", dataTypes, 12),
      plugin.searchUsdaByDataTypes("banana", dataTypes, 12),
      plugin.searchUsdaByDataTypes("orange", dataTypes, 12),
    ]);
    assert.deepEqual(burst, [[], [], []]);
    assert.equal(requests, 1, "queued distinct demo queries must re-check the circuit before requesting");
    assert.equal(plugin.usdaSearchCache.size, 0, "429 and circuit skips must not be cached");
    const demoDelay = plugin.usdaRateLimitedUntil.get("demo") - startedAt;
    assert.ok(demoDelay >= 119_000 && demoDelay <= 121_000, "Retry-After seconds should control the demo circuit");

    fake.secrets.set(plugin.settings.usdaApiKeySecrets[0], "test-only-usda-secret");
    const secretResult = await plugin.searchUsdaByDataTypes("pear", dataTypes, 12);
    assert.equal(requests, 2, "the demo circuit must not block a selected secret credential");
    assert.equal(secretResult.length, 1);
    assert.equal(plugin.usdaSearchCache.size, 1, "only the successful response should be cached");

    fake.secrets.delete(plugin.settings.usdaApiKeySecrets[0]);
    plugin.usdaRateLimitedUntil.set("demo", Date.now() - 1);
    const recoveredDemo = await plugin.searchUsdaByDataTypes("apple", dataTypes, 12);
    assert.equal(requests, 3, "an expired demo circuit should allow a fresh request");
    assert.equal(recoveredDemo.length, 1);

    const now = Date.now();
    assert.equal(retryAfterMs({ "Retry-After": "invalid" }, now), 60 * 60 * 1000);
    assert.equal(retryAfterMs({ "Retry-After": new Date(now - 1000).toUTCString() }, now), 60 * 60 * 1000);
    assert.equal(retryAfterMs({ "Retry-After": "999999" }, now), 24 * 60 * 60 * 1000);
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("queued USDA work re-resolves credentials and discards stale callers before network execution", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = { ...plugin.settings, usdaApiKeySecrets: ["usda-primary-ref"] };
  fake.secrets.set("usda-primary-ref", "test-only-usda-secret");
  let requests = 0;
  const requestUrls = [];
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  globalThis.__TPSHealthTestRequestUrl = async (options) => {
    requests += 1;
    requestUrls.push(options.url);
    if (requests === 1) {
      markFirstStarted();
      await firstGate;
    }
    return { status: 200, headers: {}, json: { foods: [] } };
  };
  try {
    const dataTypes = ["Foundation"];
    const first = plugin.searchUsdaByDataTypes("apple", dataTypes, 8);
    await firstStarted;
    const refreshed = plugin.searchUsdaByDataTypes("banana", dataTypes, 8);
    let active = true;
    const stale = plugin.searchUsdaByDataTypes("orange", dataTypes, 8, () => active);
    active = false;
    fake.secrets.set("usda-primary-ref", "test-only-usda-replacement");
    releaseFirst();
    await Promise.all([first, refreshed, stale]);
    assert.equal(requests, 2, "a stale queued query must never reach requestUrl");
    assert.match(requestUrls[0], /test-only-usda-secret/);
    assert.match(requestUrls[1], /test-only-usda-replacement/, "queued work must re-read SecretStorage immediately before sending");
  } finally {
    delete globalThis.__TPSHealthTestRequestUrl;
  }
});

test("health notes can be identified by folder or tag according to settings", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    workoutsFolder: "Health/Workouts",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    workoutTag: "#tps/workout",
    includeBrandedFoodSearch: false,
    openFoodFactsUserAgent: USER_AGENT,
    usdaApiKey: "DEMO_KEY",
  };
  plugin.searchUsdaFoods = async () => [];
  plugin.searchOpenFoodFacts = async () => [];

  fake.files.set("Other/Tagged Food.md", [
    "---",
    "tags: \"#tps/food\"",
    "name: \"Tagged Food\"",
    "servingAmount: 1",
    "servingUnit: serving",
    "calories: 100",
    "proteinG: 10",
    "carbsG: 5",
    "fatG: 2",
    "---",
    "",
  ].join("\n"));
  fake.files.set("Health/Foods/Folder Food.md", [
    "---",
    "name: \"Folder Food\"",
    "servingAmount: 1",
    "servingUnit: serving",
    "calories: 120",
    "proteinG: 12",
    "carbsG: 4",
    "fatG: 3",
    "---",
    "",
  ].join("\n"));

  plugin.settings.foodIdentificationMode = "tag";
  let foods = await plugin.searchFoods("food");
  assert.ok(foods.some((item) => item.name === "Tagged Food"));
  assert.equal(foods.some((item) => item.name === "Folder Food"), false);

  plugin.settings.foodIdentificationMode = "folder";
  foods = await plugin.searchFoods("food");
  assert.ok(foods.some((item) => item.name === "Folder Food"));
  assert.equal(foods.some((item) => item.name === "Tagged Food"), false);

  const taggedWorkoutPath = "Other/Tagged Workout.md";
  fake.files.set(taggedWorkoutPath, [
    "---",
    "tags: \"#tps/workout\"",
    "title: \"Tagged Workout\"",
    "---",
    "## Sets",
    "- [x] Squat - 225 lb x 5",
    "",
  ].join("\n"));
  plugin.settings.workoutIdentificationMode = "tag";
  await plugin.handleWorkoutFileModify(fake.app.vault.getAbstractFileByPath(taggedWorkoutPath));
  assert.match(fake.files.get(taggedWorkoutPath), /\[setId::/);

  const ignoredWorkoutPath = "Other/Ignored Workout.md";
  fake.files.set(ignoredWorkoutPath, [
    "---",
    "tags: \"#tps/workout\"",
    "title: \"Ignored Workout\"",
    "---",
    "## Sets",
    "- [x] Bench press - 135 lb x 8",
    "",
  ].join("\n"));
  plugin.settings.workoutIdentificationMode = "folder";
  await plugin.handleWorkoutFileModify(fake.app.vault.getAbstractFileByPath(ignoredWorkoutPath));
  assert.doesNotMatch(fake.files.get(ignoredWorkoutPath), /\[setId::/);
});

test("health API exposes deterministic agent food logging entry points", () => {
  assert.match(apiSource, /export interface LogFoodByBarcodeInput/);
  assert.match(apiSource, /barcode: string/);
  assert.match(apiSource, /export interface LogFoodByFoodPathInput/);
  assert.match(apiSource, /foodPath: string/);
  assert.match(apiSource, /logFoodByBarcode\(input: LogFoodByBarcodeInput\): Promise<FoodLogEntry>/);
  assert.match(apiSource, /logFoodByFoodPath\(input: LogFoodByFoodPathInput\): Promise<FoodLogEntry>/);
  assert.match(apiSource, /ensureFoodLogBase\(\): Promise<string>/);
  assert.match(apiSource, /ensureWorkoutLogBase\(\): Promise<string>/);
  assert.match(apiSource, /export interface DailyFoodMacroTotals extends Required<Nutrition>/);
  assert.match(apiSource, /getDailyFoodMacroTotals\(dateIso: string\): Promise<DailyFoodMacroTotals>/);
  assert.match(mainSource, /logFoodByBarcode: \(input\) => this\.traceApiCall\("logFoodByBarcode", input, \(\) => this\.logFoodByBarcode\(input\)\)/);
  assert.match(mainSource, /logFoodByFoodPath: \(input\) => this\.traceApiCall\("logFoodByFoodPath", input, \(\) => this\.logFoodByFoodPath\(input\)\)/);
  assert.match(mainSource, /ensureFoodLogBase: \(\) => this\.traceApiCall\("ensureFoodLogBase", \{\}, async \(\) => \(await this\.ensureFoodLogBase\(\)\)\.path\)/);
  assert.match(mainSource, /ensureWorkoutLogBase: \(\) => this\.traceApiCall\("ensureWorkoutLogBase", \{\}, async \(\) => \(await this\.ensureWorkoutLogBase\(\)\)\.path\)/);
  assert.match(mainSource, /ensureActivityLogBase: \(\) => this\.traceApiCall\("ensureActivityLogBase", \{\}, async \(\) => \(await this\.ensureActivityLogBase\(\)\)\.path\)/);
  assert.match(mainSource, /logActivity: \(input\) => this\.traceApiCall\("logActivity", input, \(\) => this\.logActivity\(input\)\)/);
  assert.match(mainSource, /getDailyFoodMacroTotals: \(dateIso\) => this\.traceApiCall\("getDailyFoodMacroTotals", \{ dateIso \}, \(\) => this\.getDailyFoodMacroTotals\(dateIso\)\)/);
  assert.match(mainSource, /lookupBarcode: \(barcode\) => this\.traceApiCall\("lookupBarcode", \{ barcode \}, \(\) => this\.lookupFoodByBarcode\(barcode\)\)/);
  assert.match(mainSource, /logFoodByBarcode: \{ barcode: "012345678905"/);
  assert.match(mainSource, /logFoodByFoodPath: \{ foodPath: "Health\/Foods\/Example Protein Bar\.md"/);

  const macroTotalsMethod = mainSource.slice(
    mainSource.indexOf("async getDailyFoodMacroTotals"),
    mainSource.indexOf("private createApi"),
  );
  assert.match(macroTotalsMethod, /window\.moment\(normalizedDate, "YYYY-MM-DD", true\)\.isValid\(\)/);
  assert.match(macroTotalsMethod, /createFoodLogBaseEntry\(this, file, lineIndex, line\)/);
  assert.match(macroTotalsMethod, /entry\.dateKey === normalizedDate/);
  assert.match(macroTotalsMethod, /const totals = sumFoodLogNutrition\(entries\)/);
  assert.match(macroTotalsMethod, /logger\.flow\("FoodMacroTotals", "read"/);

  const barcodeMethod = mainSource.slice(
    mainSource.indexOf("async logFoodByBarcode"),
    mainSource.indexOf("async logFoodByFoodPath"),
  );
  const pathMethod = mainSource.slice(
    mainSource.indexOf("async logFoodByFoodPath"),
    mainSource.indexOf("async searchExercises"),
  );
  assert.match(barcodeMethod, /lookupFoodByBarcode\(barcode\)/);
  assert.match(barcodeMethod, /logger\.flowWarn\("Food", "log-by-barcode:invalid"/);
  assert.match(barcodeMethod, /logger\.flowWarn\("Food", "log-by-barcode:miss"/);
  assert.match(barcodeMethod, /logger\.flow\("Food", "log-by-barcode:hit"/);
  assert.doesNotMatch(barcodeMethod, /searchFoods/);
  assert.match(pathMethod, /getAbstractFileByPath\(path\)/);
  assert.match(pathMethod, /logger\.flowWarn\("Food", "log-by-path:missing"/);
  assert.doesNotMatch(pathMethod, /searchFoods/);
  assert.match(mainSource, /logger\.flow\("Food", "resolve-input:item"/);
  assert.match(mainSource, /logger\.flow\("Food", "resolve-input:barcode-local"/);
  assert.match(mainSource, /logger\.flow\("Food", "resolve-input:barcode-remote"/);
  assert.match(mainSource, /logger\.flowWarn\("Food", "resolve-input:barcode-miss"/);
  assert.match(mainSource, /logger\.flow\("Food", "resolve-input:query-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("Food", "resolve-input:query-miss"/);
  assert.match(mainSource, /logger\.flowWarn\("Food", "resolve-input:failed"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "lookup:local-hit"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "lookup:remote-hit"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "lookup:no-match"/);
});

test("selected food tray shows per-line macros for the chosen serving amount", () => {
  assert.match(mainSource, /tps-health-food-search-frame/);
  assert.match(mainSource, /tps-health-selection-copy/);
  assert.match(mainSource, /tps-health-selection-line-macros/);
  assert.match(mainSource, /foodLogQuantityStep\(entry\.unit\)/);
  assert.match(mainSource, /existing\.quantity = roundFoodLogQuantity\(existing\.quantity \+ \(draft\?\.quantity \|\| 1\)\)/);
  assert.match(mainSource, /Decrease amount for \$\{entry\.item\.name\}/);
  assert.match(mainSource, /Increase amount for \$\{entry\.item\.name\}/);
  assert.match(mainSource, /Math\.max\(step, roundFoodLogQuantity\(entry\.quantity \+ delta\)\)/);
  assert.match(mainSource, /function foodLogQuantityStep\(unit: string\): number/);
  assert.match(mainSource, /function roundFoodLogQuantity\(value: number\): number/);
  assert.match(mainSource, /Math\.round\(value \* 100\) \/ 100/);
  assert.match(mainSource, /multiplyNutrition\(entry\.item\.nutrition \|\| \{\}, resolveBatchFoodSelectionServing\(entry\)\.servings\)/);
  assert.match(mainSource, /function normalizeServingMultiplier\(value: number\): number/);
  assert.match(mainSource, /Math\.round\(value \* 1000000\) \/ 1000000/);
  assert.doesNotMatch(mainSource, /return \{ servings: round\(servings\), inputQuantity, inputUnit/);
  assert.match(stylesSource, /\.tps-health-selection-copy/);
  assert.match(stylesSource, /\.tps-health-selection-line-macros/);
  assert.match(stylesSource, /\.tps-health-selection-step/);
  assert.match(stylesSource, /\.tps-health-selection-quantity/);
  assert.match(stylesSource, /body\.is-mobile \.tps-health-selection-row/);
  assert.match(stylesSource, /grid-template-areas:\s*"name name"\s*"copy controls"/);
  assert.match(stylesSource, /> \.tps-health-selection-name/);
  assert.match(stylesSource, /\.tps-health-food-search-frame \.tps-health-selection-step/);
  assert.match(stylesSource, /grid-template-areas:\s*"title title"\s*"meta meta"\s*"macros actions"/);
  assert.match(stylesSource, /> \.tps-health-result-title/);
});

test("alternate gram servings scale from a known serving weight without rounding to zero", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const { app, files } = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(app);
  plugin.settings = {
    ...plugin.settings,
    dailyNoteFormat: "YYYY-MM-DD",
    dailyNoteFolder: "Daily Notes",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    defaultFoodLogSection: "",
    foodLogTarget: "daily-note",
    automaticDailyRollups: false,
  };

  await plugin.logFood({
    id: "weighted-food",
    name: "Weighted Food",
    source: "manual",
    servingAmount: 1,
    servingUnit: "serving",
    servingGrams: 46,
    nutrition: { calories: 92, proteinG: 23, carbsG: 4.6, fatG: 2.3 },
  }, 1, "g", undefined, "2026-06-24T12:00:00.000Z", false, "daily-note", { focusAfterLog: false });

  const dailyContent = files.get("Daily Notes/2026-06-24.md");
  assert.match(dailyContent, /\[servings:: 0\.02\]/);
  assert.match(dailyContent, /\[amount:: 1\]/);
  assert.match(dailyContent, /\[amountUnit:: g\]/);
  assert.doesNotMatch(dailyContent, /\[servings:: 0\]/);

  const oneGramTotals = calculateFoodTotals(dailyContent);
  assert.equal(round(oneGramTotals.calories), 2);
  assert.equal(round(oneGramTotals.proteinG), 0.5);

  const oneHundredFiftyGramLine = "- 150 g - Weighted Food <!-- [food:: Weighted Food] [qty:: 150] [unit:: g] [servings:: 3.26087] [amount:: 150] [amountUnit:: g] [cal:: 300] [protein:: 75] [carbs:: 15] [fat:: 7.5] -->";
  const oneHundredFiftyGramTotals = calculateFoodTotals(oneHundredFiftyGramLine);
  assert.equal(round(oneHundredFiftyGramTotals.calories), 300);
  assert.equal(round(oneHundredFiftyGramTotals.proteinG), 75);
  assert.equal(round(oneHundredFiftyGramTotals.carbsG), 15);
  assert.equal(round(oneHundredFiftyGramTotals.fatG), 7.5);
});

test("unsupported serving units fail closed instead of becoming a full serving", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const { app, files } = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(app);
  plugin.settings = {
    ...plugin.settings,
    dailyNoteFormat: "YYYY-MM-DD",
    dailyNoteFolder: "Daily Notes",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    defaultFoodLogSection: "",
    foodLogTarget: "daily-note",
    automaticDailyRollups: false,
  };

  await plugin.logFood({
    id: "gram-food",
    name: "Gram Food",
    source: "manual",
    servingAmount: 1,
    servingUnit: "serving",
    servingGrams: 46,
    nutrition: { calories: 92, proteinG: 23, carbsG: 4.6, fatG: 2.3 },
  }, 1, "ml", undefined, "2026-06-25T12:00:00.000Z", false, "daily-note", { focusAfterLog: false });

  const dailyContent = files.get("Daily Notes/2026-06-25.md");
  assert.match(dailyContent, /\[qty:: 1\]/);
  assert.match(dailyContent, /\[unit:: ml\]/);
  assert.match(dailyContent, /\[servings:: 0\]/);
  assert.match(dailyContent, /\[amount:: 1\]/);
  assert.match(dailyContent, /\[amountUnit:: ml\]/);
  const totals = calculateFoodTotals(dailyContent);
  assert.equal(totals.calories, 0);
  assert.equal(totals.proteinG, 0);
});

test("custom food creation validates manual input and writes deterministic food notes", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const { app, files, writes } = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(app);
  plugin.settings = {
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    foodTemplatePath: "",
  };

  const created = await plugin.createFoodFromInput({
    name: "  Manual Shake  ",
    servingAmount: 250,
    servingUnit: "g",
    nutrition: { proteinG: 30, carbsG: 12, fatG: 4 },
  });

  assert.equal(created.name, "Manual Shake");
  assert.equal(created.sourcePath, "Health/Foods/Manual Shake.md");
  assert.equal(files.has("Health/Foods/Manual Shake.md"), true);
  const content = files.get("Health/Foods/Manual Shake.md");
  assert.match(content, /kind: food/);
  assert.match(content, /name: "Manual Shake"/);
  assert.match(content, /servingAmount: 250/);
  assert.match(content, /servingUnit: "g"/);
  assert.match(content, /calories: 204/);
  assert.match(content, /proteinG: 30/);
  assert.match(content, /#tps\/food/);

  await assert.rejects(
    () => plugin.createFoodFromInput({ name: "   ", servingAmount: 1, servingUnit: "serving" }),
    /Food name is required/,
  );
  await assert.rejects(
    () => plugin.createFoodFromInput({ name: "Bad serving", servingAmount: 0, servingUnit: "serving" }),
    /Serving amount must be greater than 0/,
  );
  assert.equal(writes.filter((write) => write.op === "create" && write.path.endsWith("Untitled food.md")).length, 0);
});

function createFakeMoment(value) {
  const date = value ? new Date(value) : new Date("2026-06-24T12:00:00.000Z");
  return {
    isValid: () => !Number.isNaN(date.getTime()),
    format(format) {
      if (format === "YYYY-MM-DD") return date.toISOString().slice(0, 10);
      if (format === "YYYY-MM-DDTHH:mm") return date.toISOString().slice(0, 16);
      return date.toISOString().slice(0, 10);
    },
    toISOString: () => date.toISOString(),
    isSame(other, unit) {
      const otherDate = other?.toDate?.() || new Date("2026-06-24T12:00:00.000Z");
      return unit === "day" && date.toISOString().slice(0, 10) === otherDate.toISOString().slice(0, 10);
    },
    toDate: () => date,
  };
}

test("USDA Foundation search returns generic apple macros per 100g", async (t) => {
  const apiKey = String(process.env.USDA_FDC_TEST_API_KEY || "").trim();
  if (!apiKey) {
    t.skip("Set USDA_FDC_TEST_API_KEY to run the live USDA integration check");
    return;
  }
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
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
  assert.equal(response.ok, true, `USDA integration returned HTTP ${response.status}`);
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

test("Open Food Facts serving nutrition validates provider serving fields against metric serving math", () => {
  assert.match(mainSource, /const hasMetricServing = Boolean\(serving\.grams \|\| serving\.ml\)/);
  assert.match(mainSource, /function foodFactsServingValue\(nutrients: any, key: string, multiplier: number, hasMetricServing: boolean\)/);
  assert.match(mainSource, /foodFactsChooseServingValue\(serving, scaled, hasMetricServing\)/);
  assert.match(mainSource, /function foodFactsValuesAgree\(left: number, right: number, toleranceRatio: number, absoluteTolerance: number\)/);
  assert.match(mainSource, /if \(!hasMetricServing\) return serving;/);
  assert.match(mainSource, /if \(serving == null\) return scaled;/);
  assert.match(mainSource, /return serving;/);
  assert.match(mainSource, /foodFactsScaledValue\(n, "energy-kcal", multiplier\)/);
  assert.match(mainSource, /caloriesFromMacros\(nutrition\)/);
  assert.match(mainSource, /unitMatch = lower\.match\(\/\\b\(bag\|bags\|bar\|bars/);
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
  assert.match(line, /\[type:: foodLog\]/);
  assert.match(line, /\[servings:: 2\]/);
  assert.match(line, /\[amount:: 110\]/);
  assert.match(line, /\[amountUnit:: g\]/);
  assert.match(line, /\[foodPath:: Health\/Foods\/Barebells Cookies & Cream Protein Bar\.md\]/);
  assert.match(line, /\[dailyNotePath:: Daily Notes\/Thu, Jun 04 2026\.md\]/);
  assert.doesNotMatch(line, /\[dailyNote::/);
  assert.match(line, /\[cal:: 400\]/);
  assert.match(line, /\[protein:: 40\]/);
  assert.match(line, /\[carbs:: 40\]/);
  assert.match(line, /\[fat:: 14\]/);
  assert.match(line, /\[sodium:: 380\]/);
  assert.doesNotMatch(line, /\[source::/);
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

test("daily rollup reuses the first daily-note read for every storage route and fallback", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const TFile = globalThis.__TPSHealthTestTFile;
  const dailyPath = "Daily Notes/2026-07-28.md";
  const dailyFoodLine = "- Apple [food:: Apple] [qty:: 1] [unit:: serving] [cal:: 95] [protein:: 1] [carbs:: 25] [fat:: 0.3]";

  const runCase = async ({ target, dailyContent, logContent }) => {
    const fake = createFakeHealthApp();
    const plugin = new TPSHealthPlugin(fake.app);
    plugin.settings = {
      ...plugin.settings,
      foodLogTarget: target,
      foodLogFilePath: "Food Log.md",
      healthGoals: [],
      rollupHeading: "Health Rollup",
    };
    fake.files.set(dailyPath, dailyContent);
    if (logContent != null) fake.files.set("Food Log.md", logContent);

    const reads = new Map();
    const read = fake.app.vault.read.bind(fake.app.vault);
    fake.app.vault.read = async (file) => {
      reads.set(file.path, (reads.get(file.path) || 0) + 1);
      return read(file);
    };

    const totals = await plugin.updateDailyRollupForFile(new TFile(dailyPath));
    return { totals, reads };
  };

  const dailyRoute = await runCase({
    target: "daily-note",
    dailyContent: dailyFoodLine,
  });
  assert.equal(round(dailyRoute.totals.calories), 95);
  assert.equal(round(dailyRoute.totals.proteinG), 1);
  assert.equal(dailyRoute.reads.get(dailyPath), 1, "daily-note rollup must read its daily note once");

  const singleFileRoute = await runCase({
    target: "single-file",
    dailyContent: "# Tuesday\n",
    logContent: "- Yogurt [food:: Yogurt] [qty:: 1] [unit:: serving] [cal:: 120] [protein:: 15] [carbs:: 8] [fat:: 2] [dailyNotePath:: Daily Notes/2026-07-28.md]",
  });
  assert.equal(round(singleFileRoute.totals.calories), 120);
  assert.equal(round(singleFileRoute.totals.proteinG), 15);
  assert.equal(singleFileRoute.reads.get(dailyPath), 1, "single-file rollup must reuse the daily-note content already read");
  assert.equal(singleFileRoute.reads.get("Food Log.md"), 1, "single-file rollup must still read its configured log exactly once");

  const missingSingleFile = await runCase({
    target: "single-file",
    dailyContent: dailyFoodLine,
  });
  assert.equal(round(missingSingleFile.totals.calories), 95, "a missing single-file log must retain the daily-note fallback");
  assert.equal(round(missingSingleFile.totals.proteinG), 1);
  assert.equal(missingSingleFile.reads.get(dailyPath), 1, "the missing-log fallback must not reread the daily note");
  assert.equal(missingSingleFile.reads.has("Food Log.md"), false, "a missing log must not trigger an invalid file read");
});

test("health source keeps session-note workouts and fast rollup paths available", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  const typesSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8"));
  assert.match(typesSource, /export type WorkoutLogTarget = "session-note" \| "daily-note" \| "both"/);
  assert.match(typesSource, /workoutLogTarget: "session-note"/);
  assert.doesNotMatch(typesSource, /workoutSessionBodyMode|workoutExerciseLayout|workoutSetStorage/);
  assert.match(mainSource, /logTarget === "session-note" \|\| logTarget === "both"/);
  assert.match(mainSource, /await this\.app\.vault\.create\(path, body\)/);
  assert.match(mainSource, /id: "open-workout-log-base"/);
  assert.match(mainSource, /async ensureWorkoutLogBase\(\): Promise<TFile>/);
  assert.match(mainSource, /return this\.openActivityLogBase\(\)/);
  assert.match(mainSource, /return this\.ensureActivityLogBase\(\)/);
  assert.match(mainSource, /function defaultActivityLogBaseContent\(\): string/);
  assert.match(mainSource, /!file\.path\.startsWith\(\\"Archive\/\\"\)/);
  assert.match(mainSource, /lineFilterAnyKeys:/);
  assert.match(mainSource, /createCommandId: tps-health:log-activity/);
  assert.match(mainSource, /async logActivity\(input: LogActivityInput\)/);
  assert.match(mainSource, /new ActivityLogModal/);
  assert.match(mainSource, /const consumedAt = completedDate \|\| isoNow\(\);/);
  assert.match(mainSource, /const dailyFile = await this\.getOrCreateDailyNoteForDate\(consumedAt\)/);
  assert.match(mainSource, /completedDate: consumedAt/);
  assert.match(mainSource, /await this\.insertIntoDailyNote\(foodEntryLine\(entry\), section \|\| this\.settings\.defaultFoodLogSection, dailyFile\)/);
  assert.match(mainSource, /logger\.flow\("FoodLog", "write:inserted", \{/);
  assert.match(mainSource, /if \(this\.settings\.automaticDailyRollups\) await this\.updateDailyRollupForFile\(dailyFile\)/);
  assert.match(mainSource, /logger\.flow\("FoodLog", "focus:skipped"/);
  assert.match(mainSource, /logger\.flow\("Rollup", "update:start"/);
  assert.match(mainSource, /logger\.flow\("Rollup", "legacy-block:removed"/);
  assert.match(mainSource, /logger\.flow\("Rollup", "content:daily-note"/);
  assert.match(mainSource, /logger\.flowWarn\("Rollup", "content:single-file-missing"/);
  assert.match(mainSource, /logger\.flow\("Rollup", "content:single-file"/);
  assert.match(typesSource, /propertyKey: "consumedCalories", label: "Consumed calories"/);
  assert.match(mainSource, /const FOOD_ROLLUP_PROPERTY_KEYS = \["consumedCalories", "cal", "protein"/);
  assert.match(mainSource, /case "consumedCalories": return totals\.calories/);
  assert.match(mainSource, /case "cal": return totals\.calories/);
  assert.match(mainSource, /logger\.flow\("FoodSearch", "open-food-facts:done"/);
  assert.match(mainSource, /logger\.flow\("FoodSearch", "custom-index:done", \{ query, \.\.\.stats \}\)/);
  assert.match(mainSource, /logger\.flow\("FoodIndex", "catalog-built"/);
  assert.match(mainSource, /logger\.flow\("FoodSearch", "usage:cache-hit"/);
  assert.match(mainSource, /logger\.flow\("Food", "upsert-resolve:path-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("Food", "upsert-resolve:path-missing"/);
  assert.match(mainSource, /logger\.flow\("Food", "upsert-resolve:barcode-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("Food", "upsert-resolve:barcode-stale"/);
  assert.match(mainSource, /logger\.flow\("Food", "upsert-resolve:name-hit"/);
  assert.match(mainSource, /logger\.flow\("Food", "upsert-resolve:miss"/);
  assert.match(mainSource, /const openRequested = input\.openFile === true/);
  assert.match(mainSource, /const openReason = openRequested \? "requested" : input\.openFile === false \? "openFile=false" : "not requested"/);
  assert.match(mainSource, /logger\.flow\("Food", "upsert:create", \{ name: item\.name, requestedPath: input\.path \|\| "", merge: input\.merge !== false, openRequested, openReason \}\)/);
  assert.match(mainSource, /logger\.flow\("Food", "upsert:merge", \{ path: file\.path, name: item\.name, type, openRequested, openReason \}\)/);
  assert.match(mainSource, /logger\.flowWarn\(log\.scope, `\$\{log\.event\}:timeout`/);
  assert.match(mainSource, /logger\.flow\("FoodSearch", "usda:done"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "lookup-candidate:v2-miss"/);
  assert.doesNotMatch(mainSource, /lookup-candidate:v0-miss/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "lookup-candidate:no-macros"/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "lookup-candidate:failed"/);
  assert.match(mainSource, /private async readConfiguredTemplate\(kind: "workout" \| "workout-plan" \| "exercise" \| "food", configuredPath: string\): Promise<string>/);
  assert.match(mainSource, /logger\.flow\("Template", `\$\{kind\}:not-configured`\)/);
  assert.match(mainSource, /logger\.flowWarn\("Template", `\$\{kind\}:missing`, \{ path: configuredPath \}\)/);
  assert.match(mainSource, /logger\.flow\("Template", `\$\{kind\}:read`, \{ path: file\.path, bytes: content\.length \}\)/);
  assert.match(mainSource, /logger\.flowError\("Template", `\$\{kind\}:read-failed`, error, \{ path: file\.path \}\)/);
});

test("settings normalization removes stale fields while preserving live vault config", async () => {
  const { applyBuiltInHealthGoalTargets, isFutureTPSHealthSettings, normalizeTPSHealthSettings, normalizeHealthGoalDefinition } = await importSettingsNormalizationUtility();
  const [mainSource, settingsSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/settings.ts", import.meta.url)), "utf8")),
  ]);
  const normalized = normalizeTPSHealthSettings({
    foodLogHeading: "Food Log",
    dailyNoteFolder: "Dailynotes",
    foodLogTarget: "single-file",
    foodLogFilePath: "Tracked/Food.md",
    workoutLogTarget: "both",
    workoutLogHeading: "Training",
    foodIdentificationMode: "bad-mode",
    workoutIdentificationMode: "tag",
    workoutTag: " #custom/workout ",
    rollupHeading: "Legacy Rollup",
    includeBrandedFoodSearch: true,
    defaultWorkoutCooldownDays: 3,
    activeWorkoutSetCount: "bad",
    workoutSetStorage: "invalid",
    pendingFoodLogDraft: {
      id: "draft-1",
      updatedAt: "2026-07-06T12:00:00.000Z",
      activeTab: "search",
      searchInput: "eggs",
      consumedDateInput: "2026-07-06T07:30",
      dateContext: { dateIso: "2026-07-06", label: "Mon, Jul 6", isToday: true, foodLogTarget: "daily-note" },
      selectionItems: [
        { item: { id: "food-1", name: "Eggs", source: "manual", nutrition: { calories: 70 } }, quantity: 2, unit: "serving" },
        { item: { id: "", name: "", source: "" }, quantity: 1, unit: "serving" },
      ],
    },
    healthGoals: [
      { propertyKey: " cal ", label: " Calories ", unit: " kcal ", kind: "max", max: 2100 },
      { propertyKey: "protein", label: "Protein", unit: "g", kind: "min", min: 250, max: 50 },
      { propertyKey: "fiber", label: "Fiber", unit: "g", kind: "range", min: 30 },
      { propertyKey: "sodium", label: "Sodium", unit: "mg", kind: "range", max: 2300 },
      { propertyKey: "steps", label: "Steps", unit: "", kind: "not-real", min: "bad" },
    ],
  });

  assert.equal(Object.hasOwn(normalized, "foodLogHeading"), false);
  assert.equal(normalized.dailyNoteFolder, "Dailynotes");
  assert.equal(normalized.foodLogTarget, "single-file");
  assert.equal(normalized.foodLogFilePath, "Tracked/Food.md");
  assert.equal(normalized.workoutLogTarget, "both");
  assert.equal(Object.hasOwn(normalized, "workoutLogHeading"), false);
  assert.equal(normalized.foodIdentificationMode, "metadata-folder-tag");
  assert.equal(normalized.workoutIdentificationMode, "tag");
  assert.equal(normalized.workoutTag, "#custom/workout");
  assert.equal(normalized.rollupHeading, "Legacy Rollup");
  assert.equal(normalized.includeBrandedFoodSearch, true);
  assert.equal(normalized.defaultWorkoutCooldownDays, 3);
  assert.equal(normalized.activeWorkoutSetCount, 0);
  assert.equal(Object.hasOwn(normalized, "workoutSetStorage"), false);
  assert.equal(normalized.settingsVersion, 1);
  assert.equal(normalized.pendingFoodLogDraft?.activeTab, "search");
  assert.equal(normalized.pendingFoodLogDraft?.searchInput, "eggs");
  assert.equal(normalized.pendingFoodLogDraft?.consumedDateInput, "2026-07-06T07:30");
  assert.equal(normalized.pendingFoodLogDraft?.dateContext?.dateIso, "2026-07-06");
  assert.equal(normalized.pendingFoodLogDraft?.selectionItems.length, 1);
  assert.equal(normalized.pendingFoodLogDraft?.selectionItems[0].item.name, "Eggs");
  assert.equal(normalized.pendingFoodLogDraft?.selectionItems[0].quantity, 2);
  assert.deepEqual(normalized.healthGoals, [
    { propertyKey: "cal", label: "Calories", unit: "kcal", kind: "max", min: undefined, max: 2100, color: undefined },
    { propertyKey: "protein", label: "Protein", unit: "g", kind: "range", min: 50, max: 250, color: undefined },
    { propertyKey: "fiber", label: "Fiber", unit: "g", kind: "min", min: 30, max: undefined, color: undefined },
    { propertyKey: "sodium", label: "Sodium", unit: "mg", kind: "max", min: undefined, max: 2300, color: undefined },
    { propertyKey: "steps", label: "Steps", unit: "", kind: "counter", min: undefined, max: undefined, color: undefined },
  ]);
  assert.deepEqual(normalizeHealthGoalDefinition({ propertyKey: "protein", label: "Protein", unit: "g", kind: "min", min: 100, max: 250 }), {
    propertyKey: "protein",
    label: "Protein",
    unit: "g",
    kind: "range",
    min: 100,
    max: 250,
    color: undefined,
  });
  assert.deepEqual(applyBuiltInHealthGoalTargets(normalized.healthGoals, {
    calorieGoal: 1675,
    proteinGoalG: 140,
    activityGoalMinutes: 45,
  }).slice(0, 2).map(({ propertyKey, min, max }) => ({ propertyKey, min, max })), [
    { propertyKey: "cal", min: undefined, max: 1675 },
    { propertyKey: "protein", min: 140, max: 250 },
  ]);

  const migratedWorkout = normalizeTPSHealthSettings({
    workoutLogTarget: "daily-note",
    workoutSessionBodyMode: "blank",
    workoutExerciseLayout: "flat",
    activeWorkoutTarget: "daily-note",
  });
  assert.equal(migratedWorkout.workoutLogTarget, "daily-note");
  assert.equal(migratedWorkout.activeWorkoutTarget, "daily-note");
  assert.equal(Object.hasOwn(migratedWorkout, "workoutSessionBodyMode"), false);
  assert.equal(Object.hasOwn(migratedWorkout, "workoutExerciseLayout"), false);
  const preservedUnknown = normalizeTPSHealthSettings({
    settingsVersion: 1,
    dailyNoteFolder: "Dailynotes",
    extensionOwnedSetting: { enabled: true, nested: ["one"] },
  });
  assert.deepEqual(preservedUnknown.extensionOwnedSetting, { enabled: true, nested: ["one"] });
  const futureSettings = normalizeTPSHealthSettings({
    settingsVersion: 2,
    dailyNoteFolder: "Future Dailynotes",
    futureOnlySetting: { mode: "new" },
  });
  assert.equal(isFutureTPSHealthSettings(futureSettings), true);
  assert.equal(futureSettings.settingsVersion, 2, "normalization must never downgrade a future schema");
  assert.deepEqual(futureSettings.futureOnlySetting, { mode: "new" });
  assert.match(settingsSource, /import \* as logger from "\.\/logger"/);
  assert.match(settingsSource, /import \{[^}]*normalizeHealthGoalDefinition[^}]*\} from "\.\/settings-normalization"/);
  assert.match(settingsSource, /logger\.flowWarn\("Settings", "health-goals:invalid-shape"/);
  assert.match(settingsSource, /\.map\(\(goal\) => normalizeHealthGoalDefinition\(goal\)\)/);
  assert.match(settingsSource, /logger\.flow\("Settings", "health-goals:parsed", \{ count: this\.plugin\.settings\.healthGoals\.length \}\)/);
  assert.match(settingsSource, /logger\.flowWarn\("Settings", "health-goals:invalid-json", \{ error: logger\.errorSummary\(error\) \}\)/);
  assert.match(mainSource, /goal: goal\.kind === "counter" \? undefined : goal\.max \?\? goal\.min/);
  assert.match(mainSource, /private lastSavedSettingsSnapshot: TPSHealthSettings \| null = null/);
  assert.match(mainSource, /this\.lastSavedSettingsSnapshot = cloneSettingsSnapshot\(this\.settings\)/);
  assert.match(mainSource, /const changedKeys = changedSettingsKeys\(this\.lastSavedSettingsSnapshot, localSnapshot\)/);
  assert.match(mainSource, /changedKeys,\s+changedCount: changedKeys\.length,\s+enableLogging: persistencePayload\.enableLogging/);
  assert.match(mainSource, /this\.lastSavedSettingsSnapshot = cloneSettingsSnapshot\(persistedSnapshot\)/);
  assert.match(mainSource, /function changedSettingsKeys\(previous: TPSHealthSettings \| null, next: TPSHealthSettings\): string\[\]/);
  assert.match(mainSource, /function stableSettingsValue\(value: unknown\): string/);
});

test("USDA credential references and legacy plaintext migrate without destructive overwrite", async () => {
  const { normalizeTPSHealthSettings, normalizeUsdaApiKeySecrets, planLegacyUsdaApiKeyMigration, settingsPersistencePayload } = await importSettingsNormalizationUtility();
  const { errorSummary } = await importLoggerUtility();
  const [settingsSource, typesSource, manifestSource, versionsSource, readmeSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/settings.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../versions.json", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
  ]);
  const normalized = normalizeTPSHealthSettings({ usdaApiKey: " legacy-private-key " });
  assert.equal(Object.hasOwn(normalized, "usdaApiKey"), false);
  assert.deepEqual(normalized.usdaApiKeySecrets, ["tps-health-usda-api-key"]);
  assert.deepEqual(
    planLegacyUsdaApiKeyMigration({ usdaApiKey: " legacy-private-key " }, normalized, () => null),
    { secretName: "tps-health-usda-api-key", secretNames: ["tps-health-usda-api-key"], value: "legacy-private-key" },
  );
  assert.equal(planLegacyUsdaApiKeyMigration({ usdaApiKey: "DEMO_KEY" }, normalized, () => null), null);
  assert.equal(planLegacyUsdaApiKeyMigration({ usdaApiKey: "legacy-private-key" }, normalized, () => "legacy-private-key"), null);
  const stacked = normalizeTPSHealthSettings({ usdaApiKeySecret: "occupied-ref", usdaApiKey: "legacy-private-key" });
  assert.deepEqual(stacked.usdaApiKeySecrets, ["occupied-ref"]);
  assert.deepEqual(
    planLegacyUsdaApiKeyMigration({ usdaApiKey: "legacy-private-key" }, stacked, (name) => name === "occupied-ref" ? "different-key" : null),
    { secretName: "tps-health-usda-api-key", secretNames: ["occupied-ref", "tps-health-usda-api-key"], value: "legacy-private-key" },
    "an occupied different secret must be preserved while legacy plaintext receives a new reference",
  );
  assert.deepEqual(normalizeUsdaApiKeySecrets([" one ", "one", "two", "three", "four", "five", "six"]), ["one", "two", "three", "four", "five"]);
  const persistedStack = settingsPersistencePayload(normalizeTPSHealthSettings({ usdaApiKeySecrets: ["primary-ref", "fallback-ref"] }));
  assert.deepEqual(persistedStack.usdaApiKeySecrets, ["primary-ref", "fallback-ref"]);
  assert.equal(Object.hasOwn(persistedStack, "usdaApiKeySecret"), false);
  assert.equal(
    errorSummary(new Error("failed https://api.nal.usda.gov/fdc/v1/foods/search?api_key=private-key&mode=1 Bearer private-key")),
    "Error: failed https://api.nal.usda.gov/fdc/v1/foods/search?api_key=[redacted]&mode=1 Bearer [redacted]",
  );

  const onloadSource = mainSource.slice(mainSource.indexOf("async onload()"), mainSource.indexOf("async saveSettings()"));
  assert.match(onloadSource, /planLegacyUsdaApiKeyMigration/);
  assert.ok(onloadSource.indexOf("secretStorage.setSecret") < onloadSource.indexOf("SecretStorage did not confirm"));
  assert.ok(onloadSource.indexOf("SecretStorage did not confirm") < onloadSource.indexOf("saveData(settingsPersistencePayload(this.settings))"));
  assert.match(onloadSource, /usda-api-key:migrated/);
  assert.match(onloadSource, /usda-api-key:migration-failed/);
  assert.match(mainSource, /private readUsdaCredentials\(\): UsdaCredential\[\]/);
  assert.match(mainSource, /this\.settings\.usdaApiKeySecrets/);
  assert.match(mainSource, /credentialPosition: credential\.position/);
  assert.match(settingsSource, /new SecretComponent\(this\.plugin\.app, element\)/);
  assert.match(settingsSource, /USDA API key — Primary/);
  assert.match(settingsSource, /API_KEY_MISSING\/API_KEY_INVALID/);
  assert.match(settingsSource, /HTTP 429 responses do not rotate/);
  assert.doesNotMatch(settingsSource, /this\.plugin\.settings\.usdaApiKey\b/);
  assert.match(typesSource, /usdaApiKeySecrets: \[USDA_API_KEY_SECRET\]/);
  assert.doesNotMatch(typesSource, /usdaApiKeySecret:\s*string/);
  assert.doesNotMatch(typesSource, /usdaApiKey:\s*string/);
  assert.equal(JSON.parse(manifestSource).minAppVersion, "1.12.0");
  assert.equal(JSON.parse(versionsSource)["0.1.0"], "1.12.0");
  assert.match(readmeSource, /device-local Obsidian SecretStorage/);
  assert.match(readmeSource, /`DEMO_KEY` fallback/);
});

test("legacy USDA single-reference settings persist canonically before the stale field is removed", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  fake.app.workspace.on = () => ({});
  fake.app.workspace.onLayoutReady = () => {};
  fake.app.metadataCache.on = () => ({});
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.manifest = { id: "tps-health" };
  for (const method of [
    "registerEditorSuggest",
    "registerMarkdownPostProcessor",
    "register",
    "registerWorkoutTaskCompletionTracking",
    "refreshGcmFoodLogButtonRegistration",
    "registerGcmFoodLogButtonTapFallback",
    "registerInlineFoodLogMenuHandler",
    "scheduleGcmMenuRefresh",
    "scheduleWorkoutActionBars",
  ]) plugin[method] = () => {};
  plugin.loadData = async () => ({ usdaApiKeySecret: "legacy-reference" });
  const savedPayloads = [];
  plugin.saveData = async (payload) => { savedPayloads.push(JSON.parse(JSON.stringify(payload))); };

  await plugin.onload();
  assert.equal(savedPayloads.length, 1);
  assert.deepEqual(savedPayloads[0].usdaApiKeySecrets, ["legacy-reference"]);
  assert.equal(Object.hasOwn(savedPayloads[0], "usdaApiKeySecret"), false);
});

test("failed USDA SecretStorage migration keeps Health online without purging the retry value", async () => {
  const { normalizeTPSHealthSettings, settingsPersistencePayload } = await importSettingsNormalizationUtility();
  const normalized = normalizeTPSHealthSettings({ usdaApiKey: "legacy-private-key" });
  assert.equal(Object.hasOwn(settingsPersistencePayload(normalized), "usdaApiKey"), false);
  assert.equal(settingsPersistencePayload(normalized, " legacy-private-key ").usdaApiKey, "legacy-private-key");

  const onloadSource = mainSource.slice(mainSource.indexOf("async onload()"), mainSource.indexOf("async saveSettings()"));
  const migrationCatch = onloadSource.slice(onloadSource.indexOf("} catch (error) {"), onloadSource.indexOf("const migrationNeeded"));
  const saveSource = mainSource.slice(mainSource.indexOf("async saveSettings()"), mainSource.indexOf("async updateBuiltInHealthGoalTarget"));
  const readKeySource = mainSource.slice(mainSource.indexOf("private readUsdaCredentials()"), mainSource.indexOf("private availableUsdaCredentials()"));
  assert.match(migrationCatch, /this\.retainedLegacyUsdaApiKey = legacyUsdaApiKey/);
  assert.doesNotMatch(migrationCatch, /throw error/);
  assert.match(migrationCatch, /TPS Health will stay available/);
  assert.match(onloadSource, /initial-save:blocked-usda-migration/);
  assert.match(onloadSource, /if \(this\.retainedLegacyUsdaApiKey\) \{[\s\S]+?\} else \{\s+await this\.saveData\(settingsPersistencePayload\(this\.settings\)\);/);
  assert.match(saveSource, /mergeTPSHealthSettingsChanges\([\s\S]+?this\.retainedLegacyUsdaApiKey/);
  assert.match(saveSource, /save:retaining-legacy-usda-key/);
  assert.match(readKeySource, /const references = this\.retainedLegacyUsdaApiKey \? \[\] : this\.settings\.usdaApiKeySecrets/);

  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  fake.app.secretStorage = {
    getSecret: () => null,
    setSecret: () => { throw new Error("simulated SecretStorage outage"); },
  };
  fake.app.workspace.on = () => ({});
  fake.app.workspace.onLayoutReady = () => {};
  fake.app.metadataCache.on = () => ({});
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.manifest = { id: "tps-health" };
  for (const method of [
    "registerEditorSuggest",
    "registerMarkdownPostProcessor",
    "register",
    "registerWorkoutTaskCompletionTracking",
    "refreshGcmFoodLogButtonRegistration",
    "registerGcmFoodLogButtonTapFallback",
    "registerInlineFoodLogMenuHandler",
    "scheduleGcmMenuRefresh",
    "scheduleWorkoutActionBars",
  ]) plugin[method] = () => {};
  plugin.loadData = async () => ({ usdaApiKey: "legacy-private-key" });
  const savedPayloads = [];
  plugin.saveData = async (payload) => { savedPayloads.push(JSON.parse(JSON.stringify(payload))); };

  await assert.doesNotReject(() => plugin.onload());
  assert.equal(savedPayloads.length, 0, "initial sanitized save must be blocked when migration fails");
  assert.equal(plugin.readUsdaCredentials()[0].apiKey, "DEMO_KEY");
  assert.ok(globalThis.__TPSHealthTestNotices.some((notice) => notice.includes("TPS Health will stay available")));

  plugin.settings.calorieGoal = 1900;
  await plugin.saveSettings();
  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].calorieGoal, 1900);
  assert.equal(savedPayloads[0].usdaApiKey, "legacy-private-key", "later settings saves must retain the migration retry value");
  assert.deepEqual(savedPayloads[0].usdaApiKeySecrets, ["tps-health-usda-api-key"]);
  assert.equal(Object.hasOwn(savedPayloads[0], "usdaApiKeySecret"), false);
});

test("volatile Health state saves merge with externally updated preferences and preserve extension fields", async () => {
  installDeterministicBrowserGlobals();
  const { normalizeTPSHealthSettings } = await importSettingsNormalizationUtility();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  const baseline = normalizeTPSHealthSettings({
    settingsVersion: 1,
    dailyNoteFolder: "Original Dailynotes",
    activeWorkoutSetCount: 0,
  });
  plugin.settings = baseline;
  plugin.lastSavedSettingsSnapshot = JSON.parse(JSON.stringify(baseline));
  plugin.loadData = async () => ({
    settingsVersion: 1,
    dailyNoteFolder: "Synced Dailynotes",
    activeWorkoutSetCount: 0,
    extensionOwnedSetting: { preserved: true },
  });
  const savedPayloads = [];
  plugin.saveData = async (payload) => { savedPayloads.push(JSON.parse(JSON.stringify(payload))); };

  plugin.settings.activeWorkoutSetCount = 4;
  await plugin.saveSettings();

  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].dailyNoteFolder, "Synced Dailynotes", "an untouched preference changed by another device must win");
  assert.equal(savedPayloads[0].activeWorkoutSetCount, 4, "the intended local volatile-state change must persist");
  assert.deepEqual(savedPayloads[0].extensionOwnedSetting, { preserved: true });
  assert.equal(plugin.settings.dailyNoteFolder, "Synced Dailynotes", "the in-memory view must adopt the merged persisted settings");
});

test("a queued Health revert repairs an uncertain failed write", async () => {
  installDeterministicBrowserGlobals();
  const { normalizeTPSHealthSettings } = await importSettingsNormalizationUtility();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  const baseline = normalizeTPSHealthSettings({ settingsVersion: 1, calorieGoal: 2000, proteinGoalG: 100 });
  plugin.settings = JSON.parse(JSON.stringify(baseline));
  plugin.lastSavedSettingsSnapshot = JSON.parse(JSON.stringify(baseline));
  let disk = JSON.parse(JSON.stringify(baseline));
  let releaseFailure;
  let markFirstStarted;
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  let attempts = 0;
  plugin.loadData = async () => JSON.parse(JSON.stringify(disk));
  plugin.saveData = async (payload) => {
    attempts += 1;
    disk = JSON.parse(JSON.stringify(payload));
    if (attempts === 1) {
      markFirstStarted();
      await failureGate;
      throw new Error("uncertain write result");
    }
  };

  plugin.settings.calorieGoal = 2100;
  const first = plugin.saveSettings();
  await firstStarted;
  plugin.settings.calorieGoal = 2000;
  plugin.settings.proteinGoalG = 125;
  const newest = plugin.saveSettings();
  releaseFailure();
  await Promise.all([first, newest]);

  assert.equal(attempts, 2);
  assert.equal(disk.calorieGoal, 2000, "the same-as-baseline revert must be forced after an uncertain write");
  assert.equal(disk.proteinGoalG, 125);
});

test("future Health settings remain read-only and are never downgraded or rewritten", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  fake.app.workspace.on = () => ({});
  fake.app.workspace.onLayoutReady = () => {};
  fake.app.metadataCache.on = () => ({});
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.manifest = { id: "tps-health" };
  for (const method of [
    "registerEditorSuggest",
    "registerMarkdownPostProcessor",
    "register",
    "registerWorkoutTaskCompletionTracking",
    "refreshGcmFoodLogButtonRegistration",
    "registerGcmFoodLogButtonTapFallback",
    "registerInlineFoodLogMenuHandler",
    "scheduleGcmMenuRefresh",
    "scheduleWorkoutActionBars",
  ]) plugin[method] = () => {};
  plugin.loadData = async () => ({
    settingsVersion: 99,
    dailyNoteFolder: "Future Dailynotes",
    futureOnlySetting: { doNotLose: true },
  });
  const savedPayloads = [];
  plugin.saveData = async (payload) => { savedPayloads.push(payload); };

  await plugin.onload();
  assert.equal(plugin.settings.settingsVersion, 99);
  assert.deepEqual(plugin.settings.futureOnlySetting, { doNotLose: true });
  assert.equal(savedPayloads.length, 0, "startup must not migrate a future schema");

  plugin.settings.dailyNoteFolder = "Local edit that cannot safely persist";
  await plugin.saveSettings();
  assert.equal(savedPayloads.length, 0, "later state or settings changes must remain fail-closed");
});

test("GCM food action retries reuse one Health lifecycle listener", async () => {
  installDeterministicBrowserGlobals();
  const { normalizeTPSHealthSettings, settingsPersistencePayload } = await importSettingsNormalizationUtility();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const layoutListeners = [];
  fake.app.workspace.on = (event, callback) => {
    if (event === "layout-change") layoutListeners.push(callback);
    return { event, callback };
  };
  fake.app.workspace.onLayoutReady = () => {};
  fake.app.metadataCache.on = () => ({});
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.manifest = { id: "tps-health" };
  for (const method of [
    "register",
    "registerEditorSuggest",
    "registerMarkdownPostProcessor",
    "registerFoodSearchIndexInvalidation",
    "registerWorkoutTaskCompletionTracking",
    "registerGcmFoodLogButtonTapFallback",
    "registerInlineFoodLogMenuHandler",
    "scheduleFoodLogNutritionRepair",
    "removeWorkoutActionBars",
  ]) plugin[method] = () => {};
  let menuRefreshes = 0;
  let workoutRefreshes = 0;
  plugin.scheduleGcmMenuRefresh = () => { menuRefreshes += 1; };
  plugin.scheduleWorkoutActionBars = () => { workoutRefreshes += 1; };
  plugin.createApi = () => ({});
  const loadedSettings = settingsPersistencePayload(normalizeTPSHealthSettings({
    settingsVersion: 1,
    showFoodLogButtonInGcm: true,
  }));
  plugin.loadData = async () => structuredClone(loadedSettings);

  await plugin.onload();
  const listenerCounts = [layoutListeners.length];
  for (let dispatch = 0; dispatch < 10; dispatch += 1) {
    for (const listener of [...layoutListeners]) listener();
    listenerCounts.push(layoutListeners.length);
  }
  assert.deepEqual(listenerCounts, Array(11).fill(1), "an unavailable GCM must not multiply retry listeners");
  menuRefreshes = 0;
  workoutRefreshes = 0;

  let registrationAttempts = 0;
  let registrations = 0;
  let unregistrations = 0;
  let registration;
  fake.app.plugins.plugins["tps-global-context-menu"] = {
    api: {
      externalActions: {
        register(action) {
          registrationAttempts += 1;
          if (registrationAttempts === 1) throw new Error("GCM is still initializing");
          if (registrationAttempts === 2) return null;
          registrations += 1;
          registration = action;
          return () => {
            unregistrations += 1;
            throw new Error("stale GCM disposer failed");
          };
        },
      },
    },
  };
  for (const listener of [...layoutListeners]) listener();
  assert.equal(registrationAttempts, 1);
  assert.equal(registrations, 0);
  assert.equal(menuRefreshes, 1, "a thrown registration must not block the shared menu refresh");
  assert.equal(workoutRefreshes, 1, "a thrown registration must not block the shared workout refresh");

  for (const listener of [...layoutListeners]) listener();
  assert.equal(registrationAttempts, 2);
  assert.equal(registrations, 0);
  assert.equal(menuRefreshes, 2, "an invalid disposer must not block the shared menu refresh");
  assert.equal(workoutRefreshes, 2, "an invalid disposer must not block the shared workout refresh");

  for (const listener of [...layoutListeners]) listener();
  assert.equal(registrationAttempts, 3);
  assert.equal(registrations, 1);
  assert.equal(menuRefreshes, 4, "successful registration schedules its action and the shared lifecycle refresh");
  assert.equal(workoutRefreshes, 3);

  for (const listener of [...layoutListeners]) listener();

  assert.equal(registrations, 1, "the single lifecycle listener must register exactly once when GCM becomes ready");
  assert.equal(registrationAttempts, 3);
  assert.equal(menuRefreshes, 5);
  assert.equal(workoutRefreshes, 4);
  assert.equal(registration.id, "food-log");
  assert.equal(registration.pluginId, "tps-health");
  assert.equal(layoutListeners.length, 1);

  delete fake.app.plugins.plugins["tps-global-context-menu"];
  for (const listener of [...layoutListeners]) listener();
  assert.equal(unregistrations, 1, "provider removal must release the stale registration once");
  assert.equal(registrations, 1);

  let replacementRegistrations = 0;
  let replacementUnregistrations = 0;
  let replacementRegistration;
  fake.app.plugins.plugins["tps-global-context-menu"] = {
    api: {
      externalActions: {
        register(action) {
          replacementRegistrations += 1;
          replacementRegistration = action;
          return () => { replacementUnregistrations += 1; };
        },
      },
    },
  };
  for (const listener of [...layoutListeners]) listener();
  for (const listener of [...layoutListeners]) listener();
  assert.equal(replacementRegistrations, 1, "a replacement GCM provider must receive one fresh registration");
  assert.equal(replacementRegistration.id, "food-log");
  assert.equal(replacementRegistration.pluginId, "tps-health");

  plugin.onunload();
  assert.equal(unregistrations, 1);
  assert.equal(replacementUnregistrations, 1);
});

test("Health frontmatter writes prefer the supported GCM API exactly once and propagate its result and errors", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const TFile = globalThis.__TPSHealthTestTFile;
  const plugin = new TPSHealthPlugin(fake.app);
  const file = new TFile("Health/Workouts/GCM Route QA.md");
  const expectedResult = false;
  let gcmCalls = 0;
  let nativeCalls = 0;
  let mutatorCalls = 0;
  let capturedFrontmatter = null;

  fake.app.fileManager.processFrontMatter = async () => {
    nativeCalls += 1;
    return { route: "native" };
  };
  fake.app.plugins.plugins["tps-global-context-menu"] = {
    api: {
      frontmatter: {
        async process(target, mutator) {
          gcmCalls += 1;
          assert.equal(target, file);
          const frontmatter = {};
          mutatorCalls += 1;
          await mutator(frontmatter);
          capturedFrontmatter = frontmatter;
          return expectedResult;
        },
      },
    },
  };

  const result = await plugin.processHealthFrontmatter(file, (frontmatter) => {
    frontmatter.status = "complete";
    frontmatter.completedDate = "2026-07-30T12:34:56.000Z";
  });
  assert.equal(result, expectedResult);
  assert.equal(gcmCalls, 1);
  assert.equal(nativeCalls, 0);
  assert.equal(mutatorCalls, 1);
  assert.deepEqual(capturedFrontmatter, {
    status: "complete",
    completedDate: "2026-07-30T12:34:56.000Z",
  });

  const expectedError = new Error("GCM frontmatter write failed");
  fake.app.plugins.plugins["tps-global-context-menu"].api.frontmatter.process = async () => {
    gcmCalls += 1;
    throw expectedError;
  };
  await assert.rejects(
    () => plugin.processHealthFrontmatter(file, () => {}),
    (error) => error === expectedError,
  );
  assert.equal(gcmCalls, 2);
  assert.equal(nativeCalls, 0, "a failed GCM write must not be replayed through native Obsidian");
});

test("Health frontmatter writes use the native standalone route exactly once and propagate its result and errors", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const TFile = globalThis.__TPSHealthTestTFile;
  const plugin = new TPSHealthPlugin(fake.app);
  const file = new TFile("Health/Foods/Native Route QA.md");
  const expectedResult = { route: "native" };
  let nativeCalls = 0;
  let mutatorCalls = 0;
  let capturedFrontmatter = null;

  fake.app.fileManager.processFrontMatter = async (target, mutator) => {
    nativeCalls += 1;
    assert.equal(target, file);
    const frontmatter = {};
    mutatorCalls += 1;
    await mutator(frontmatter);
    capturedFrontmatter = frontmatter;
    return expectedResult;
  };

  const result = await plugin.processHealthFrontmatter(file, (frontmatter) => {
    frontmatter.name = "Native Route QA";
  });
  assert.equal(result, expectedResult);
  assert.equal(nativeCalls, 1);
  assert.equal(mutatorCalls, 1);
  assert.deepEqual(capturedFrontmatter, { name: "Native Route QA" });

  const expectedError = new Error("Native frontmatter write failed");
  fake.app.fileManager.processFrontMatter = async () => {
    nativeCalls += 1;
    throw expectedError;
  };
  await assert.rejects(
    () => plugin.processHealthFrontmatter(file, () => {}),
    (error) => error === expectedError,
  );
  assert.equal(nativeCalls, 2);
});

test("workout completion sends unchanged status and completedDate values through the GCM frontmatter route", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  const path = "Health/Workouts/Finish Route QA.md";
  const endedAt = "2026-07-30T12:34:56.000Z";
  fake.files.set(path, [
    "---",
    "kind: workout",
    "workoutId: workout-route-qa",
    "status: active",
    "startedAt: 2026-07-30T11:34:56.000Z",
    "cooldownDays: 0",
    "---",
    "",
  ].join("\n"));
  plugin.settings = {
    ...plugin.settings,
    activeWorkoutPath: path,
    activeWorkoutId: "workout-route-qa",
    activeWorkoutDailyNotePath: "",
    activeWorkoutPlanPath: "",
    activeWorkoutStartedAt: "2026-07-30T11:34:56.000Z",
    activeWorkoutCooldownDays: 0,
    activeWorkoutSetCount: 0,
    defaultWorkoutCooldownDays: 0,
  };
  plugin.normalizeWorkoutNoteSetTasks = async () => 0;
  plugin.stopGcmWorkoutTimer = async () => {};
  plugin.clearActiveWorkoutState = async () => {};
  let nativeCalls = 0;
  let gcmCalls = 0;
  let capturedFrontmatter = null;
  fake.app.fileManager.processFrontMatter = async () => {
    nativeCalls += 1;
  };
  fake.app.plugins.plugins["tps-global-context-menu"] = {
    api: {
      frontmatter: {
        async process(file, mutator) {
          gcmCalls += 1;
          const frontmatter = parseFrontmatter(fake.files.get(file.path) || "");
          await mutator(frontmatter);
          capturedFrontmatter = frontmatter;
          return true;
        },
      },
    },
  };

  await plugin.finishWorkout({ endedAt, cooldownDays: 0 });

  assert.equal(gcmCalls, 1);
  assert.equal(nativeCalls, 0);
  assert.equal(capturedFrontmatter.status, "complete");
  assert.equal(capturedFrontmatter.completedDate, endedAt);
  assert.equal(capturedFrontmatter.endedAt, endedAt);
});

test("all Health-owned Markdown frontmatter writes share the explicit routing helper", () => {
  assert.equal((mainSource.match(/await this\.processHealthFrontmatter\(/g) || []).length, 9);
  assert.equal((mainSource.match(/this\.app\.fileManager\.processFrontMatter\(/g) || []).length, 1);
});

test("built-in scalar health goals migrate, save, reload, and render canonically", async () => {
  const { normalizeTPSHealthSettings } = await importSettingsNormalizationUtility();
  const stale = normalizeTPSHealthSettings({
    calorieGoal: 1675,
    proteinGoalG: 140,
    activityGoalMinutes: 45,
    healthGoals: [
      { propertyKey: "consumedCalories", label: "Consumed calories", unit: "kcal", kind: "max", max: 2400 },
      { propertyKey: "protein", label: "Protein", unit: "g", kind: "min", min: 180 },
      { propertyKey: "activity", label: "Activity", unit: "min", kind: "min", min: 45 },
      { propertyKey: "fiber", label: "Fiber", unit: "g", kind: "min", min: 30 },
    ],
  });
  assert.deepEqual(stale.healthGoals.slice(0, 3).map(({ propertyKey, min, max }) => ({ propertyKey, min, max })), [
    { propertyKey: "consumedCalories", min: undefined, max: 1675 },
    { propertyKey: "protein", min: 140, max: undefined },
    { propertyKey: "activity", min: 45, max: undefined },
  ]);

  const explicitCustom = normalizeTPSHealthSettings({
    calorieGoal: 1675,
    healthGoals: [{ propertyKey: "consumedCalories", label: "Consumed calories", unit: "kcal", kind: "max", max: 2100 }],
  });
  assert.equal(explicitCustom.healthGoals[0].max, 2100, "load migration must not overwrite an explicit non-default JSON bound");

  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = stale;
  let persisted = null;
  plugin.loadData = async () => persisted;
  plugin.saveData = async (settings) => {
    persisted = JSON.parse(JSON.stringify(settings));
  };

  await plugin.updateBuiltInHealthGoalTarget("calorieGoal", 1800);
  await plugin.updateBuiltInHealthGoalTarget("proteinGoalG", 150);
  await plugin.updateBuiltInHealthGoalTarget("activityGoalMinutes", 60);
  assert.ok(persisted);

  const reloaded = normalizeTPSHealthSettings(persisted);
  plugin.settings = reloaded;
  const rendered = new Map(plugin.getMetricRenderConfigs().map((config) => [config.propertyKey, config]));
  assert.equal(rendered.get("consumedCalories")?.max, 1800);
  assert.equal(rendered.get("consumedCalories")?.goal, 1800);
  assert.equal(rendered.get("protein")?.min, 150);
  assert.equal(rendered.get("protein")?.goal, 150);
  assert.equal(rendered.get("activity")?.min, 60);
  assert.equal(rendered.get("activity")?.goal, 60);
  assert.equal(rendered.get("fiber")?.min, 30);
});

test("blank daily log sections stay a no-heading frontmatter insertion contract", async () => {
  const { normalizeTPSHealthSettings } = await importSettingsNormalizationUtility();
  const normalized = normalizeTPSHealthSettings({ defaultFoodLogSection: "   ", workoutLogHeading: "   " });
  assert.equal(normalized.defaultFoodLogSection, "");
  assert.equal("workoutLogHeading" in normalized, false);

  const [mainSource, settingsSource, typesSource, readmeSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/settings.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
  ]);
  assert.match(typesSource, /defaultFoodLogSection: ""/);
  assert.doesNotMatch(typesSource, /workoutLogHeading/);
  assert.match(mainSource, /private async insertIntoDailyNote\(line: string, section\?: string, targetFile\?: TFile\): Promise<TFile> \{\s+const file = targetFile \|\| await this\.getOrCreateDailyNote\(\);\s+if \(section\?\.trim\(\)\) return this\.appendToDailyHeading\(section\.trim\(\), line, file\);[\s\S]+const content = await this\.app\.vault\.read\(file\);\s+const insertAt = frontmatterEndIndex\(content\);/);
  assert.match(mainSource, /await this\.insertIntoDailyNote\(workoutSummaryLine\(path, startedAt\), undefined, await this\.getOrCreateDailyNoteForDate\(dailyNoteDate\)\)/);
  assert.match(mainSource, /return this\.insertIntoDailyNote\(line, undefined, await this\.getOrCreateDailyNoteForDate\(dateValue\)\)/);
  assert.match(mainSource, /private async insertIntoFoodLogFile\(line: string, section\?: string\): Promise<TFile> \{\s+const file = await this\.getFoodLogFile\(true\);\s+if \(!file\) throw new Error\("Food log file is not available"\);\s+if \(section\?\.trim\(\)\) return this\.appendToHeading\(file, section\.trim\(\), line\);[\s\S]+await this\.app\.vault\.append\(file, `\$\{line\}\\n`\);/);
  assert.match(settingsSource, /\.setName\("Default food log section"\)\s+\.setDesc\("Optional\. Blank inserts food logs immediately after daily-note frontmatter\."\)[\s\S]+\.setPlaceholder\("Food Log"\)[\s\S]+defaultFoodLogSection = value\.trim\(\);/);
  assert.doesNotMatch(settingsSource, /\.setName\("Workout log heading"\)/);
  assert.match(readmeSource, /`Default food log section` is intentionally blank by default\. Blank keeps food entries unheaded and inserts daily-note entries immediately after frontmatter; `Food Log` is only the settings placeholder suggestion, not the persisted default\./);
  assert.match(readmeSource, /Workout daily receipts are always inserted into the daily note body immediately after frontmatter\. Persisted legacy `workoutLogHeading` values are ignored for daily-note writes\./);
});

test("whole-note workouts use workout-specific date fields and plain set logs", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  const typesSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8"));
  assert.match(typesSource, /activeWorkoutSetCount: number/);
  assert.match(typesSource, /workoutSetNotation: "compact"/);
  assert.doesNotMatch(typesSource, /workoutSessionBodyMode|workoutExerciseLayout|workoutSetStorage/);
  assert.match(typesSource, /foodIdentificationMode: "metadata-folder-tag"/);
  assert.match(typesSource, /workoutIdentificationMode: "metadata-folder-tag"/);
  assert.match(typesSource, /workoutTag: "#tps\/workout"/);
  assert.match(mainSource, /frontmatter\.workoutDate = frontmatter\.workoutDate \|\| isoDateKey\(startedAt\)/);
  assert.doesNotMatch(mainSource, /frontmatter\.scheduled =/);
  assert.match(mainSource, /frontmatter\.timeEstimate = durationMinutes/);
  assert.match(mainSource, /frontmatter\.durationSeconds = durationSeconds/);
  assert.match(mainSource, /frontmatter\.allDay = false/);
  assert.match(mainSource, /frontmatter\.setCount = Math\.max/);
  assert.doesNotMatch(mainSource, /asTask:|this\.settings\.workoutSetStorage/);
  assert.match(mainSource, /appendSetToWorkoutNote/);
  assert.match(mainSource, /storage: "bullet"/);
  assert.doesNotMatch(mainSource, /lines\.push\("## Sets", line\)/);
  assert.doesNotMatch(mainSource, /"# \{\{title\}\}"/);
  assert.match(mainSource, /normalizeWorkoutNoteSetTasks/);
  assert.match(mainSource, /frontmatterLineEnd\(lines\)/);
  assert.match(mainSource, /if \(isWorkoutSetLine\(line\) && existingEndedAt\)/);
  assert.match(mainSource, /workoutSession: \["workoutId", "workout", "workoutPlanPath", "workoutDate", "startedAt", "endedAt", "timeEstimate", "durationSeconds", "caloriesBurned"/);
  assert.match(typesSource, /export type WorkflowRecurrenceMode = "completion-triggered"/);
  assert.match(typesSource, /export type WorkflowRunKind = "run"/);
  assert.match(mainSource, /frontmatter\.runKind = frontmatter\.runKind \|\| "run"/);
  assert.match(mainSource, /frontmatter\.workflowType = frontmatter\.workflowType \|\| "workout"/);
  assert.match(mainSource, /frontmatter\.recurrenceMode = frontmatter\.recurrenceMode \|\| "completion-triggered"/);
  assert.match(mainSource, /frontmatter\.secondsSincePreviousCompletion = frontmatter\.secondsSincePreviousCompletion \?\? secondsSincePreviousCompletion/);
  assert.match(mainSource, /frontmatter\.targetGapDays = frontmatter\.targetGapDays \?\? cooldownDays/);
  assert.match(mainSource, /repairActivityLogBaseContent/);
  assert.match(mainSource, /lineFilterAnyKeys:/);
  assert.match(mainSource, /- activity/);
  assert.match(mainSource, /- workout/);
  assert.match(mainSource, /logger\.flow\("FoodDateContext", "start-workout:active-file"/);
  assert.match(mainSource, /const dateContext = await this\.getActiveDailyNoteDateContext\(\);[\s\S]+new StartWorkoutModal\(this\.app, this, dateContext\)\.open\(\)/);
  assert.match(mainSource, /logger\.flow\("WorkoutModal", "start-blank:done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutModal", "start-blank:failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutModal", "start:done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutModal", "start:failed"/);
  assert.match(mainSource, /logger\.flow\("Workout", "start:note-created"/);
  assert.match(mainSource, /logger\.flow\("Workout", "start:state-saved"/);
  assert.match(mainSource, /await this\.openWorkoutFile\(file\)/);
  assert.match(mainSource, /await this\.startGcmWorkoutTimer/);
  assert.match(mainSource, /await this\.stopGcmWorkoutTimer/);
  assert.match(mainSource, /logger\.flow\("Workout", "finish:frontmatter-done"/);
  assert.match(mainSource, /timeTracking\.startTimer/);
  assert.match(mainSource, /timeTracking\.stopActiveTimerForFile/);
  assert.match(mainSource, /const timerEnd: Date \| string = Number\.isFinite\(parsedEnd\.getTime\(\)\) \? parsedEnd : endedAt/);
  assert.match(mainSource, /timeTracking\.stopActiveTimerForFile\(file, timerEnd\)/);
});

test("active workout commands expose set logging and layout saving", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /id: "start-blank-workout"/);
  assert.match(mainSource, /id: "start-blank-workout"[\s\S]+?this\.startWorkout\(\{ openFile: false \}\)[\s\S]+?new WorkoutExercisePickerModal/);
  assert.doesNotMatch(mainSource, /startWorkout\(\{ openFile: true \}\)/);
  assert.match(mainSource, /id: "log-workout-set"/);
  assert.match(mainSource, /id: "save-active-workout-layout"/);
  assert.match(mainSource, /id: "finish-workout-and-save-layout"/);
  assert.match(mainSource, /interface WorkoutOpenResult/);
  assert.match(mainSource, /let openResult: WorkoutOpenResult = \{/);
  assert.match(mainSource, /await this\.startGcmWorkoutTimer\(file instanceof TFile \? file : dailyNotePath\);\s+if \(file instanceof TFile\) await this\.cacheWorkoutFile\(file\);\s+if \(input\.openFile !== false && file instanceof TFile\) openResult = await this\.openWorkoutFile\(file\);/);
  assert.match(mainSource, /openRequested: openResult\.requested/);
  assert.match(mainSource, /openRoute: openResult\.route/);
  assert.match(mainSource, /openReason: openResult\.reason \|\| ""/);
  assert.match(mainSource, /private async openWorkoutFile\(file: TFile\): Promise<WorkoutOpenResult>/);
  assert.match(mainSource, /private async showWorkoutReadingMode\(file: TFile\): Promise<void>/);
  assert.match(mainSource, /await this\.showWorkoutReadingMode\(file\)/);
  assert.match(mainSource, /mode: "preview", source: false/);
  assert.match(mainSource, /logger\.flow\("WorkoutOpen", "start", \{ path: file\.path \}\)/);
  assert.match(mainSource, /typeof gcmApi\?\.openFileInLeaf === "function"/);
  assert.match(mainSource, /gcmApi\.openFileInLeaf\(\s*file,\s*false,\s*\(\) => this\.app\.workspace\.getLeaf\(false\),\s*\{ revealLeaf: true \}/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutOpen", "gcm:declined", \{ path: file\.path \}\)/);
  assert.match(mainSource, /logger\.flowError\("WorkoutOpen", "obsidian:failed", error, \{ path: file\.path \}\)/);
  assert.match(mainSource, /private async startGcmWorkoutTimer\(target: TFile \| string \| null\): Promise<void>/);
  assert.match(mainSource, /await timeTracking\.startTimer\(\{\s*file,\s*type: "note",\s*title: this\.settings\.activeWorkoutTitle \|\| file\.basename,\s*\}\)/);
  assert.match(mainSource, /logger\.flow\("GCM", "timer:start-unavailable", \{ hasTimeTracking: !!timeTracking \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("GCM", "timer:start-missing-target", \{ target: typeof target === "string" \? target : "" \}\)/);
  assert.match(mainSource, /logger\.flow\("GCM", "timer:start-done", \{ path: file\.path, title: this\.settings\.activeWorkoutTitle \|\| file\.basename \}\)/);
  assert.match(mainSource, /logger\.flow\("GCM", "timer:stop-unavailable"\)/);
  assert.match(mainSource, /logger\.flowWarn\("GCM", "timer:stop-missing-target", \{ target: typeof target === "string" \? target : "" \}\)/);
  assert.match(mainSource, /logger\.flow\("GCM", "timer:stop-done", \{ path: file\.path, route: "file", endedAt \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("GCM", "timer:stop-active-mismatch"/);
  assert.match(mainSource, /logger\.flowWarn\("GCM", "timer:stop-method-missing", \{ path: file\.path \}\)/);
  assert.doesNotMatch(mainSource, /setPinned\?\.\(true\)/);
  assert.match(mainSource, /new SetModal\(this\.app, this\)\.open\(\)/);
  assert.match(mainSource, /callback: \(\) => this\.traceCommand\("log-workout-set", async \(\) => \{\s+new SetModal\(this\.app, this\)\.open\(\);/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "log:resolved"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSetModal", "start-blank:done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutSetModal", "start-blank:failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSetModal", "done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutSetModal", "failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "log-file:resolved"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSetModal", "exercise-picker:stale"/);
  assert.match(mainSource, /logger\.flow\("WorkoutFileSetModal", "done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutFileSetModal", "failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutFileSetModal", "exercise-picker:stale"/);
  assert.match(mainSource, /tps-health-workout-exercise-picker/);
  assert.match(mainSource, /getActiveWorkoutExerciseNames/);
  assert.match(mainSource, /logger\.flow\("Exercise", "active-workout-names:no-active"/);
  assert.match(mainSource, /logger\.flowWarn\("Exercise", "active-workout-names:missing-file"/);
  assert.match(mainSource, /logger\.flow\("Exercise", "active-workout-names:done"/);
  assert.match(mainSource, /logger\.flow\("Exercise", "search:done", \{ query, \.\.\.stats \}\)/);
  assert.match(mainSource, /foodLike: 0,\s+recognized: 0,\s+queryMiss: 0,\s+returned: 0/);
  assert.match(mainSource, /logger\.flow\("Exercise", "set-note:skip-create", \{ exercise: set\.exercise, route: "active-workout" \}\)/);
  assert.match(mainSource, /logger\.flow\("Exercise", "set-note:skip-create", \{ exercise: set\.exercise, route: "workout-file", path: file\.path \}\)/);
  assert.match(mainSource, /private resolveExistingExerciseFile\(path: string \| undefined, name: string\): TFile \| null/);
  assert.match(mainSource, /logger\.flow\("Exercise", "upsert-resolve:path-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("Exercise", "upsert-resolve:path-missing"/);
  assert.match(mainSource, /logger\.flow\("Exercise", "upsert-resolve:name-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("Exercise", "upsert-resolve:name-stale"/);
  assert.match(mainSource, /logger\.flow\("Exercise", "upsert-resolve:miss"/);
  assert.match(mainSource, /logger\.flow\("Exercise", "find-or-create:create"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "search:done", \{ query, \.\.\.stats \}\)/);
  assert.match(mainSource, /private resolveExistingWorkoutPlanFile\(path: string \| undefined, name: string\): TFile \| null/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "upsert-resolve:path-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "upsert-resolve:path-missing"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "upsert-resolve:name-hit"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "upsert-resolve:name-stale"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "upsert-resolve:miss"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "find-or-create:create"/);
  assert.match(mainSource, /new WorkoutLayoutModal\(this\.app, this, false\)\.open\(\)/);
  assert.match(mainSource, /new WorkoutLayoutModal\(this\.app, this, true\)\.open\(\)/);
  assert.match(mainSource, /async finishWorkoutAndSaveTemplate\(input: \{ title\?: string; cooldownDays\?: number; defaultRestSeconds\?: number \} = \{\}\): Promise<string \| undefined> \{/);
  assert.match(mainSource, /async saveActiveWorkoutTemplate\(input: \{ title\?: string; cooldownDays\?: number; defaultRestSeconds\?: number \} = \{\}\): Promise<string \| undefined> \{/);
  assert.match(mainSource, /class WorkoutLayoutModal extends Modal/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "template-from-active:no-active", \{ finishAfterSave: true \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "template-from-active:no-active", \{ finishAfterSave: false \}\)/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "template-from-active:layout-source"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "template-from-active:fallback-task-names"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "template-from-active:no-entries"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "layout-extract:missing-session"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "layout-extract:missing-daily-note"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "layout-extract:missing-daily-parent"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "layout-extract:session"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "layout-extract:daily-note"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "task-extract:missing-session"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "task-extract:missing-daily-note"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "task-extract:missing-daily-parent"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "task-extract:session"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "task-extract:daily-note"/);
  assert.match(mainSource, /logger\.flow\("WorkoutLayoutModal", "open"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutLayoutModal", "open:no-active-workout"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutLayoutModal", "submit:missing-name"/);
  assert.match(mainSource, /logger\.flow\("WorkoutLayoutModal", "submit"/);
  assert.match(mainSource, /logger\.flow\("WorkoutLayoutModal", "done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutLayoutModal", "failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutLayoutModal", "cancel"/);
  assert.match(mainSource, /async addSetForExerciseToActiveWorkout\(exercise: string, after\?: WorkoutSetLineSource\): Promise<void>/);
  assert.match(mainSource, /async addSetForExerciseToWorkoutFile\(filePath: string, exercise: string, after\?: WorkoutSetLineSource, options: \{ focusAfter\?: boolean \} = \{\}\): Promise<void>/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutSet", "placeholder:create-workout-missing"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutSet", "placeholder:missing-file"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "placeholder:open-modal"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutSet", "duplicate:missing-file"/);
  assert.match(mainSource, /logger\.flowWarn\("NoteWrite", "workout-set:daily-note-missing", \{ dailyNotePath, workoutId \}\)/);
  assert.match(mainSource, /logger\.flow\("NoteWrite", "workout-set:daily-fallback-append", \{ dailyNotePath: file\.path, workoutId \}\)/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "focus:start", \{ path: file\.path, line: lineNumber, setId \}\)/);
  assert.match(mainSource, /view\.getMode\(\) !== "preview"[\s\S]*setState\.call\(view, \{ \.\.\.state, mode: "preview", source: false \}, \{ history: false \}\)[\s\S]*"focus:switch-reading"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "focus:no-editor-scroll", \{ path: file\.path, line: lineNumber \}\)/);
  assert.match(mainSource, /card\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(mainSource, /EditorView\.scrollIntoView\(documentLine\.from, \{ y: "center" \}\)/);
  assert.match(mainSource, /\.tps-health-workout-set-editor\[data-tps-health-set-id=/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "focus:done", \{ path: file\.path, line: lineNumber, setId, route: "set-card" \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutSet", "focus:card-missing", \{ path: file\.path, line: lineNumber, setId \}\)/);
  assert.match(mainSource, /logger\.flowError\("WorkoutSet", "focus:failed", error, \{ path: file\.path, line: lineNumber, setId \}\)/);
  assert.match(mainSource, /class WorkoutSetEmptyWidget extends WidgetType/);
  assert.match(mainSource, /new WorkoutSetEmptyWidget\(plugin, filePath\)/);
  assert.match(mainSource, /docHasWorkoutSetLine\(view\.state\.doc\.toString\(\)\)/);
  assert.match(mainSource, /workoutLikeFile \? workoutSetChipDataFromLine\(text\) : isWorkoutSetLine\(text\) \? workoutSetChipDataFromLine\(text\) : null/);
  assert.match(mainSource, /tps-health-workout-empty/);
  assert.match(mainSource, /void plugin\.addSeededWorkoutSetAfterBlock\(source\)/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "tracking:registered"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "snapshot:cached"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutTask", "snapshot:cache-failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "modify:skip-processing"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "modify:no-new-completions"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutTask", "modify:failed"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "annotate:detected"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutTask", "annotate:no-change"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "frontmatter:update"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutTask", "finish-prompt:duplicate"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "finish-prompt:finish"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "finish-prompt:add-set"/);
  assert.match(mainSource, /logger\.flow\("WorkoutTask", "finish-prompt:dismiss"/);
  assert.match(mainSource, /logger\.flowWarn\("Workout", "daily-complete:missing-file", \{ dailyNotePath, workoutId \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("Workout", "daily-complete:missing-row", \{ path: file\.path, workoutId, lines: lines\.length \}\)/);
  assert.match(mainSource, /logger\.flow\("Workout", "daily-complete:done", \{ path: file\.path, workoutId, line: index, nextEligibleDate: nextEligibleDate \|\| "" \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "resolve:path-missing"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "apply:start"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "apply:missing-plan"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "apply:no-exercises"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutPlan", "apply:missing-session"/);
  assert.match(mainSource, /logger\.flow\("WorkoutPlan", "apply:done"/);
});

test("workout starts use existing plans and blank starts use the slim exercise picker", () => {
  assert.match(mainSource, /workoutPlanList\.id = `tps-health-workout-plan-options-\$\{Date\.now\(\)\}`/);
  assert.match(mainSource, /this\.plugin\.searchWorkoutPlans\(""\)\.then\(\(items\) =>/);
  assert.match(mainSource, /const resolveSelectedPlanPath = async \(\): Promise<string \| undefined>/);
  assert.match(mainSource, /new Notice\("Choose an existing workout plan or start empty\."\)/);
  assert.match(mainSource, /setButtonText\("Start empty"\)/);
  assert.match(mainSource, /setButtonText\("Start with plan"\)/);
  assert.match(mainSource, /createEl\("details", \{ cls: "tps-health-workout-options" \}\)/);
  assert.match(mainSource, /startWithPlanButton\.disabled = !plan/);
  assert.doesNotMatch(mainSource, /this\.selectedWorkoutDate = "";\s*this\.onOpen\(\)/);
  assert.match(mainSource, /if \(path\) new WorkoutExercisePickerModal\(this\.app, this\.plugin, path\)\.open\(\);/);
  assert.doesNotMatch(mainSource, /if \(path\) new WorkoutFileSetModal\(this\.app, this\.plugin, path\)\.open\(\);/);
  const blankCommandStart = mainSource.indexOf('id: "start-blank-workout"');
  const blankCommandEnd = mainSource.indexOf('id: "finish-workout"', blankCommandStart);
  const blankCommand = mainSource.slice(blankCommandStart, blankCommandEnd);
  assert.match(blankCommand, /new WorkoutExercisePickerModal\(this\.app, this, path\)\.open\(\)/);
  assert.doesNotMatch(blankCommand, /new (?:SetModal|WorkoutFileSetModal)\(/);
  assert.match(mainSource, /logger\.flowError\("WorkoutExercisePicker", "choose:failed", error/);
  assert.match(mainSource, /new Notice\(`Could not add \$\{exercise\}: \$\{errorMessage\}`\)/);
  assert.match(mainSource, /status\.setText\("Adding…"\)/);
  assert.match(mainSource, /\{ focusAfter: false \}/);
  assert.match(mainSource, /focusLatestWorkoutSetAfterPicker/);
  assert.doesNotMatch(mainSource, /\.setName\("Superset group"\)/);
  assert.doesNotMatch(mainSource, /\.setName\("Dropset group"\)/);
  assert.match(mainSource, /repsInput\?\.focus\(\);\s+repsInput\?\.select\(\);/);
  assert.match(mainSource, /linkWorkoutExerciseWithPrevious/);
  assert.match(mainSource, /linkWorkoutSetWithPreviousDropSet/);
});

test("command palette only exposes polished everyday health actions", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  for (const id of [
    "start-workout",
    "start-blank-workout",
    "finish-workout",
    "log-workout-set",
    "save-active-workout-layout",
    "finish-workout-and-save-layout",
    "log-food",
    "open-food-log-base",
    "open-workout-log-base",
    "scan-food-barcode",
    "edit-current-food",
  ]) {
    assert.match(mainSource, new RegExp(`id: "${id}"`));
  }
  for (const id of [
    "finish-and-save-workout-template",
    "save-active-workout-template",
    "create-workout-plan",
    "complete-inline-food-log",
    "create-custom-food",
    "create-recipe",
  ]) {
    assert.doesNotMatch(mainSource, new RegExp(`id: "${id}"`));
  }
  assert.match(mainSource, /logger\.flowError\("BaseOpen", "food-log:ensure-failed", error, \{ path: DEFAULT_FOOD_LOG_BASE_PATH \}\)/);
  assert.match(mainSource, /logger\.flow\("BaseOpen", "food-log:open-start", \{ path: file\.path \}\)/);
  assert.match(mainSource, /logger\.flow\("BaseOpen", "food-log:open-done", \{ path: file\.path \}\)/);
  assert.match(mainSource, /logger\.flowError\("BaseOpen", "food-log:open-failed", error, \{ path: file\.path \}\)/);
  assert.match(mainSource, /logger\.flowError\("BaseOpen", "activity-log:ensure-failed", error, \{ path: DEFAULT_ACTIVITY_LOG_BASE_PATH \}\)/);
  assert.match(mainSource, /logger\.flow\("BaseOpen", "activity-log:open-start", \{ path: file\.path \}\)/);
  assert.match(mainSource, /logger\.flow\("BaseOpen", "activity-log:open-done", \{ path: file\.path \}\)/);
  assert.match(mainSource, /logger\.flowError\("BaseOpen", "activity-log:open-failed", error, \{ path: file\.path \}\)/);
  assert.match(mainSource, /class ActivityLogModal extends Modal/);
  assert.match(mainSource, /await this\.plugin\.logActivity\(\{/);
  assert.match(mainSource, /logger\.flowError\("ActivityLogModal", "failed"/);
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

test("food log modal displays serving conversion and food log lines persist scaled macros", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  const formatSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/format.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /const summaryEl = this\.contentEl\.createDiv\(\{ cls: "tps-health-log-summary" \}\)/);
  assert.match(mainSource, /servingEl\.setText\(parts\.join\(" = "\)\)/);
  assert.match(mainSource, /renderMacroPills\(nutritionEl, multiplyNutrition\(this\.item\.nutrition \|\| \{\}, resolved\.servings\)\)/);
  assert.match(formatSource, /if \(entry\.nutritionOverride\) return entry\.nutritionOverride;\s+return scaleNutrition\(entry\.item\.nutrition \|\| \{\}, entry\.quantity\);/);
  assert.match(mainSource, /private async repairFoodLogNutritionFieldsInVault\(\): Promise<void>/);
  assert.match(mainSource, /this\.registerEvent\(this\.app\.metadataCache\.on\("resolved", \(\) => this\.scheduleFoodLogNutritionRepair\("metadata-resolved", 250\)\)\);/);
  assert.match(mainSource, /private async foodFromFileForRepair\(file: TFile\): Promise<FoodItem>/);
  assert.match(mainSource, /const fm = frontmatterFromMarkdown\(content\);/);
  assert.match(mainSource, /logger\.flow\("FoodLogEntry", "nutrition-repair:done"/);
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

test("barcode normalization keeps valid UPC candidates without creating 11-digit artifacts", async () => {
  const { barcodeCandidates } = await importPluginWithObsidianStub();
  assert.deepEqual(barcodeCandidates("0012345678905"), ["0012345678905", "012345678905"]);
  assert.deepEqual(barcodeCandidates("012345678905"), ["012345678905"]);
  assert.deepEqual(barcodeCandidates("04252614"), ["04252614", "042100005264"]);
  assert.deepEqual(barcodeCandidates("24252614"), ["24252614"], "UPC-E expansion must reject unsupported number systems");
  assert.deepEqual(barcodeCandidates("04252615"), ["04252615"], "UPC-E expansion must reject an invalid check digit");
  assert.ok(barcodeCandidates("0012345678905").every((candidate) => candidate.length !== 11));
});

test("log food command seeds search and amount from the active inline food draft", async () => {
  const [mainSource, readmeSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
  ]);
  assert.match(mainSource, /logger\.flow\("FoodDateContext", "log-food:active-file"/);
  assert.match(mainSource, /this\.openFoodSearchModal\(this\.getActiveInlineFoodDraft\(\), dateContext\)/);
  assert.match(mainSource, /new FoodSearchModal\(this\.app, this, initialDraft, dateContext, initialTab\)\.open\(\)/);
  assert.doesNotMatch(mainSource, /private async handleNaturalAdd\(input: string\): Promise<void>/);
  assert.match(mainSource, /private async handleBarcodeAdd\(input: string\): Promise<void>/);
  assert.doesNotMatch(mainSource, /function parseQuickFoodInput\(input: string\): QuickFoodInput \| null/);
  assert.doesNotMatch(mainSource, /interface QuickFoodInput/);
  assert.doesNotMatch(mainSource, /function splitQuickFoodConsumedTime\(input: string\)/);
  assert.match(mainSource, /function barcodeFromInput\(input: string\): string \| null/);
  assert.match(mainSource, /async lookupFoodByBarcode\(barcode: string\): Promise<FoodItem \| null>/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "scanner-lookup:empty"\)/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "scanner-lookup:invalid", \{ input: maskBarcode\(trimmed\) \}\)/);
  assert.match(mainSource, /if \(!trimmed\) \{[\s\S]+new Notice\("Barcode is required"\);[\s\S]+return;/);
  assert.match(mainSource, /if \(!barcode\) \{[\s\S]+new Notice\("Enter a valid UPC or EAN barcode\."\);[\s\S]+return;/);
  assert.doesNotMatch(mainSource, /const barcode = rawBarcode\.replace\(\/\\D\/g, ""\);\s+if \(!barcode\) \{\s+new Notice\("Barcode is required"\)/);
  assert.match(mainSource, /new BarcodeScannerModal\(this\.app, this\.plugin, this\.dateContext, async \(item\) =>/);
  assert.match(mainSource, /new BarcodeScannerModal\(this\.app, this\.plugin, this\.dateContext, async \(item\) => \{\s+await this\.addSelection\(item, null, \{ enrich: false \}\);/);
  assert.match(mainSource, /logger\.flow\("FoodLogModal", "barcode-review:open"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogModal", "barcode-review:missing-name"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogModal", "barcode-review:invalid-serving"/);
  assert.match(mainSource, /logger\.flow\("FoodLogModal", "barcode-review:submit"/);
  assert.match(mainSource, /logger\.flow\("FoodLogModal", "barcode-review:done"/);
  assert.match(mainSource, /logger\.flowError\("FoodLogModal", "barcode-review:failed"/);
  assert.match(mainSource, /logger\.flow\("FoodLogModal", "done"/);
  assert.match(mainSource, /logger\.flowError\("FoodLogModal", "failed"/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "open-search:suppressed"/);
  assert.match(mainSource, /private barcodeScannerModal: BarcodeScannerModal \| null = null/);
  assert.match(mainSource, /logger\.flowWarn\("FoodModal", "barcode-scanner:suppressed-active"/);
  assert.match(mainSource, /autoStart: true/);
  assert.match(mainSource, /onClose: \(\) => \{\s+if \(this\.barcodeScannerModal === scanner\) this\.barcodeScannerModal = null;/);
  assert.match(mainSource, /this\.statusEl\.setText\("Enter or scan a UPC\/EAN barcode\."\);\s+this\.openBarcodeScanner\(\);/);
  assert.match(mainSource, /setButtonText\("Scan"\)\s+\.onClick\(\(\) => this\.openBarcodeScanner\(\)\)/);
  assert.match(mainSource, /private getActiveInlineFoodDraft\(\): InlineFoodDraft \| null/);
  assert.doesNotMatch(mainSource, /\.setName\("Natural add"\)/);
  assert.doesNotMatch(mainSource, /\["natural", "Text"\]/);
  assert.match(mainSource, /\["barcode", "Scan"\], \["search", "Search"\], \["mine", "Saved"\], \["describe", "Describe"\]/);
  assert.match(mainSource, /\.setName\("Search food"\)/);
  assert.match(mainSource, /\.setName\("Barcode"\)/);
  assert.match(mainSource, /const token = \+\+this\.searchToken;\s+this\.activeFoodLogTab = mode;/);
  assert.match(mainSource, /this\.resultsEl\.empty\(\);\s+this\.actionsEl\.empty\(\);\s+if \(mode === "mine"\) \{\s+void this\.renderQuickPicks\(token\);/);
  assert.match(mainSource, /else if \(mode === "search"\) \{\s+if \(this\.searchInput\.trim\(\)\.length >= 2\) this\.queueSearch\(this\.searchInput\);/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "search:stale"/);
  assert.match(mainSource, /private async renderQuickPicks\(token = this\.searchToken\): Promise<void>/);
  assert.match(mainSource, /logger\.flow\("FoodModal", "quick-picks:stale"/);
  assert.match(mainSource, /onClose\(\): void \{[\s\S]+this\.searchToken \+= 1;/);
  assert.match(mainSource, /createDiv\(\{ cls: "tps-health-food-tabs" \}\)/);
  assert.match(mainSource, /panelByMode\[candidate\]\.toggleClass\("is-active", active\)/);
  assert.match(mainSource, /this\.selectionEl\.addClass\("tps-health-inline-selection"\)/);
  assert.match(mainSource, /private consumedDateInput: string;/);
  assert.doesNotMatch(mainSource, /private recipeNameInput/);
  assert.match(mainSource, /class BatchFoodRecipeModal extends Modal/);
  assert.match(mainSource, /new BatchFoodRecipeModal\(this\.app, this\.plugin, \[\.\.\.this\.selectionItems\], this\.dateContext\)\.open\(\)/);
  assert.match(mainSource, /export function initialFoodLogConsumedDateInput/);
  assert.match(mainSource, /export function restoredFoodLogDraftConsumedDateInput/);
  assert.match(mainSource, /this\.consumedDateInput = restoredFoodLogDraftConsumedDateInput\(dateContext, pendingDraft\);/);
  assert.match(mainSource, /logger\.flow\("FoodDraft", "restore:consumed-time"/);
  assert.match(mainSource, /let consumedDateInput = initialFoodLogConsumedDateInput\(this\.dateContext\);/);
  assert.match(mainSource, /function configureFoodLogDateTimeInput\(inputEl: HTMLInputElement\): void \{\s+inputEl\.type = "datetime-local";\s+inputEl\.step = "60";/);
  assert.match(mainSource, /\.setName\("Consumed time"\)\s+\.setDesc\("Uses Obsidian's local date-time picker\. Clear it to log at the current time\."\)/);
  assert.match(mainSource, /if \(!trimmed \|\| \/\^now\$\/i\.test\(trimmed\)\) return isoNow\(\);/);
  assert.match(mainSource, /this\.resetSearchForNextFood\(enriched\.name\);/);
  assert.match(mainSource, /private resetSearchForNextFood\(addedName: string\): void/);
  assert.match(mainSource, /text\.setValue\(this\.initialDraft\.query\);\s*this\.searchInput = this\.initialDraft\.query;\s*this\.queueSearch\(this\.initialDraft\.query\);\s*window\.setTimeout\(\(\) => this\.submitOnlineSearch/);
  assert.match(mainSource, /const add = async \(\) => \{[\s\S]+await this\.addSelection\(item, null, \{ enrich: false \}\);[\s\S]+row\.addEventListener\("click", \(\) => void add\(\)\);/);
  assert.match(mainSource, /setButtonText\("Choose amount"\)/);
  assert.match(mainSource, /if \(!item\.sourcePath\) actions\.addButton/);
  assert.match(mainSource, /interface BarcodeScannerAdapters \{/);
  assert.match(mainSource, /requestCameraStream\?: \(constraints: MediaStreamConstraints\) => Promise<MediaStream>/);
  assert.match(mainSource, /createLiveReader\?: \(\) => any/);
  assert.match(mainSource, /createCanvasReader\?: \(\) => any/);
  assert.match(mainSource, /createNativeDetector\?: \(\) => any/);
  assert.match(mainSource, /nativeBridgeScan\?: \(\) => Promise<unknown>/);
  assert.match(mainSource, /navigatorInfo\?: Pick<Navigator, "userAgent" \| "platform" \| "maxTouchPoints">/);
  assert.match(mainSource, /private options: BarcodeScannerOptions = \{\}/);
  assert.match(mainSource, /if \(this\.options\.autoStart\) window\.setTimeout\(\(\) => \{\s+if \(!this\.stopped\) void this\.startCamera\(status\);/);
  assert.match(mainSource, /logger\.flow\("Barcode", "camera:start-skipped-active"/);
  assert.match(mainSource, /const sessionId = \+\+this\.cameraSessionId/);
  assert.match(mainSource, /private isCameraSessionActive\(sessionId: number\): boolean/);
  assert.match(mainSource, /if \(!this\.isCameraSessionActive\(sessionId\)\) \{\s+stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/);
  assert.match(mainSource, /logger\.flow\("Barcode", "camera:stream-discarded-stale"/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "camera:start-failed"[\s\S]+this\.stopScanning\(\);\s+statusEl\.setText\(`Camera\/scanner unavailable:/);
  assert.match(mainSource, /private desiredFacingMode: "environment" \| "user" \| "" = ""/);
  assert.match(mainSource, /private torchEnabled = false/);
  assert.match(mainSource, /setButtonText\("Flash"\)\s+\.onClick\(\(\) => this\.toggleTorch\(status\)\)/);
  assert.match(mainSource, /setButtonText\("Flip camera"\)\s+\.onClick\(\(\) => this\.flipCamera\(status\)\)/);
  assert.match(mainSource, /const capabilities = track\?\.getCapabilities\?\.\(\) as any/);
  assert.match(mainSource, /await \(track\.applyConstraints as any\)\(\{ advanced: \[\{ torch: next \}\] \}\)/);
  assert.match(mainSource, /this\.desiredFacingMode = this\.desiredFacingMode === "environment" \? "user" : "environment"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "torch:unavailable"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "camera:flip-busy"\)/);
  assert.match(mainSource, /logger\.flow\("Barcode", "camera:flip", \{ facingMode: this\.desiredFacingMode \}\)/);
  assert.match(mainSource, /this\.stopScanning\(\);\s+this\.updateCameraControlButtons\(\);\s+statusEl\.setText\(`Switching to \$\{this\.desiredFacingMode === "environment" \? "rear" : "front"\} camera\.\.\.`\);/);
  assert.match(mainSource, /facingMode: \{ ideal: this\.desiredFacingMode \|\| this\.defaultFacingMode\(\) \}/);
  assert.match(mainSource, /statusEl\.setText\("Checking native barcode scanner\.\.\."\);\s+if \(await this\.tryNativeBarcodeBridge\(statusEl, sessionId\)\) return;\s+if \(!this\.isCameraSessionActive\(sessionId\)\) return;\s+statusEl\.setText\("Web camera scanner active\. Scanning\.\.\."\);/);
  assert.match(mainSource, /private async tryNativeBarcodeBridge\(statusEl: HTMLElement, sessionId: number\): Promise<boolean>/);
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
  assert.match(mainSource, /private shortcutInboxProcessing = false/);
  assert.match(mainSource, /if \(this\.shouldShowAppleShortcutButton\(\)\) \{\s+controls\.addButton\(\(button\) => button\s+\.setButtonText\("Apple Shortcut"\)\s+\.onClick\(\(\) => this\.openAppleShortcut\(status\)\)\);/);
  assert.match(mainSource, /statusEl\.setText\(`Opening Apple Shortcut\. TPS Health is watching \$\{SHORTCUT_BARCODE_INBOX_PATH\} for the scanned barcode\.`\);/);
  assert.match(mainSource, /logger\.flow\("Barcode", "shortcut:open", \{ inboxPath: SHORTCUT_BARCODE_INBOX_PATH \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "shortcut:popup-blocked", \{ inboxPath: SHORTCUT_BARCODE_INBOX_PATH \}\)/);
  assert.match(mainSource, /this\.app\.vault\.on\("create", \(changed\) => \{/);
  assert.match(mainSource, /this\.app\.vault\.on\("modify", \(changed\) => \{/);
  assert.match(mainSource, /this\.shortcutInboxPollInterval = window\.setInterval\(\(\) => \{/);
  assert.match(mainSource, /const barcode = shortcutBarcodeFromContent\(content\);/);
  assert.match(mainSource, /content = await this\.app\.vault\.cachedRead\(file\);[\s\S]+if \(this\.stopped \|\| this\.lookupInProgress\) return;\s+const barcode = shortcutBarcodeFromContent\(content\);/);
  assert.match(mainSource, /logger\.flow\("Barcode", "shortcut-inbox:watch-start"/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "shortcut-inbox:no-barcode"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "shortcut-inbox:duplicate"/);
  assert.match(mainSource, /await this\.app\.vault\.modify\(file, `Processed by TPS Health at \$\{isoNow\(\)\}\\n`\);/);
  assert.match(mainSource, /await this\.app\.vault\.modify\(file,[\s\S]+if \(this\.stopped \|\| this\.lookupInProgress\) return;\s+await this\.lookup\(barcode, statusEl\);/);
  assert.match(mainSource, /await this\.lookup\(barcode, statusEl\);/);
  assert.match(mainSource, /function appleShortcutBarcodeUrl\(\): string \{\s+return `shortcuts:\/\/run-shortcut\?name=\$\{encodeURIComponent\(SHORTCUT_BARCODE_NAME\)\}`;/);
  assert.match(mainSource, /function shortcutBarcodeFromContent\(content: string\): string \| null \{\s+const match = content\.match\(\/\(\?:\^\|\\D\)\(\\d\{7,14\}\)\(\?:\\D\|\$\)\/\);/);
  assert.match(mainSource, /function createBarcodeReader\(\): any/);
  assert.match(mainSource, /function createLiveBarcodeReader\(\): any/);
  assert.match(mainSource, /private createLiveBarcodeReader\(\): any \{\s+return this\.options\.adapters\?\.createLiveReader\?\.\(\) \|\| createLiveBarcodeReader\(\);/);
  assert.match(mainSource, /private createCanvasBarcodeReader\(\): any \{\s+return this\.options\.adapters\?\.createCanvasReader\?\.\(\) \|\| createBarcodeReader\(\);/);
  assert.match(mainSource, /new BrowserMultiFormatOneDReader\(createBarcodeHints\(false\), \{/);
  assert.match(mainSource, /delayBetweenScanAttempts: 120/);
  assert.match(mainSource, /await this\.startZxingVideoScan\(statusEl, sessionId\)/);
  assert.match(mainSource, /const reader = this\.createLiveBarcodeReader\(\);\s+const controls = await reader\.decodeFromVideoElement\(this\.videoEl, \(result: any\) =>/);
  assert.match(mainSource, /if \(!this\.isCameraSessionActive\(sessionId\)\) \{\s+controls\?\.stop\?\.\(\);/);
  assert.match(mainSource, /const barcode = barcodeFromInput\(String\(text\)\);\s+if \(!barcode\) return;\s+logger\.flow\("Barcode", "zxing-video:decoded", \{ barcode: maskBarcode\(barcode\) \}\)/);
  assert.match(mainSource, /this\.scheduleNativeVideoFallback\(statusEl, sessionId\)/);
  assert.match(mainSource, /private scheduleNativeVideoFallback\(statusEl: HTMLElement, sessionId: number\): void/);
  assert.match(mainSource, /native-video-fallback:decoded/);
  assert.match(mainSource, /this\.clearNativeVideoFallback\(\)/);
  assert.doesNotMatch(mainSource, /scheduleCanvasScanFallback/);
  assert.doesNotMatch(mainSource, /fallbackScanTimeout/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "zxing-video:failed"[\s\S]+await this\.startCanvasScanLoop\(statusEl, sessionId\);/);
  assert.match(mainSource, /this\.zxingVideoControls\?\.stop\?\.\(\)/);
  assert.match(mainSource, /DecodeHintType\.POSSIBLE_FORMATS/);
  assert.match(mainSource, /BarcodeFormat\.UPC_A/);
  assert.match(mainSource, /if \(tryHarder\) hints\.set\(DecodeHintType\.TRY_HARDER, true\)/);
  assert.match(mainSource, /barcodeScanCanvases\(this\.canvasEl, heavy\)/);
  assert.match(mainSource, /const barcode = result \? barcodeFromInput\(result\) : null;\s+if \(barcode\) \{\s+logger\.flow\("Barcode", "canvas:decoded", \{ barcode: maskBarcode\(barcode\) \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "image-scan:not-image"/);
  assert.match(mainSource, /logger\.flow\("Barcode", "image-scan:decoded", \{ barcode: maskBarcode\(result\) \}\)/);
  assert.match(mainSource, /const getUserMedia = this\.options\.adapters\?\.requestCameraStream \|\| navigator\.mediaDevices\?\.getUserMedia\?\.bind\(navigator\.mediaDevices\)/);
  assert.match(mainSource, /return await getUserMedia\(\{\s+video: \{/);
  assert.match(mainSource, /return await getUserMedia\(\{ video: true \}\)/);
  assert.match(mainSource, /const reader = this\.createCanvasBarcodeReader\(\);/);
  assert.match(mainSource, /let decodeInProgress = false/);
  assert.match(mainSource, /!this\.isCameraSessionActive\(sessionId\) \|\| this\.lookupInProgress \|\| decodeInProgress/);
  assert.match(mainSource, /attempts % 2 === 0/);
  assert.match(mainSource, /keep the barcode steady, well lit, and centered/);
  assert.match(mainSource, /\}, 180\);/);
  assert.doesNotMatch(mainSource, /move closer so the barcode fills more of the camera frame/);
  assert.match(mainSource, /function\* barcodeScanCanvases\(source: HTMLCanvasElement, heavy: boolean\): IterableIterator<HTMLCanvasElement>/);
  assert.match(mainSource, /function barcodeScanRegions\(width: number, height: number, heavy: boolean\): BarcodeCanvasRegion\[\]/);
  assert.doesNotMatch(mainSource, /out\.splice\(Math\.min\(2, out\.length\), 0, source\)/);
  assert.match(mainSource, /x: 0\.25, y: 0\.48, width: 0\.5, height: 0\.42, scale: 2\.5, rotate: true/);
  assert.match(mainSource, /function cropCanvas\(/);
  assert.match(mainSource, /ctx\.rotate\(Math\.PI \/ 2\)/);
  assert.match(mainSource, /const BARCODE_IMAGE_MAX_DIMENSION = 1600/);
  assert.match(mainSource, /function barcodeImageScale\(img: HTMLImageElement\): number/);
  assert.match(mainSource, /function\* barcodeImageCanvases\(img: HTMLImageElement\): IterableIterator<HTMLCanvasElement>/);
  assert.match(mainSource, /private async tryDecodeCanvases\(reader: any, canvases: Iterable<HTMLCanvasElement>, sessionId\?: number\)/);
  assert.doesNotMatch(mainSource, /canvas\.toDataURL/);
  assert.doesNotMatch(mainSource, /decodeFromImageElement/);
  assert.match(mainSource, /scanner-lookup:ignored-stale/);
  assert.match(mainSource, /\(navigator as any\)\.vibrate\?\.\(35\)/);
  assert.match(mainSource, /tps-health-scanner-viewport/);
  assert.match(mainSource, /tps-health-scanner-guide/);
  assert.match(mainSource, /inputmode", "numeric"/);
  assert.match(stylesSource, /\.tps-health-scanner-status/);
  assert.match(stylesSource, /\.tps-health-scanner-viewport/);
  assert.match(stylesSource, /\.tps-health-scanner-guide/);
  assert.match(stylesSource, /\.tps-health-scanner-controls button:focus-visible/);
  assert.match(stylesSource, /min-height: 44px/);
  assert.match(mainSource, /const BARCODE_LOOKUP_TIMEOUT_MS = 5000;/);
  assert.match(mainSource, /this\.withTimeout\(\s*this\.lookupOpenFoodFactsBarcodeCandidate\(code\),\s*BARCODE_LOOKUP_TIMEOUT_MS,\s*null,/);
  assert.match(mainSource, /await this\.addSelection\(item, null, \{ enrich: false \}\);\s+logger\.flow\("FoodModal", "barcode:add-hit"/);
  assert.match(mainSource, /const loggedStats = await this\.plugin\.getLoggedFoodStats\(""\);\s+const localFoods = await this\.plugin\.getSavedFoods\(loggedStats\);/);
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

test("food logging modal consumed-time defaults are date-context aware", async () => {
  const { initialFoodLogConsumedDateInput, restoredFoodLogDraftConsumedDateInput } = await importPluginWithObsidianStub();
  assert.match(initialFoodLogConsumedDateInput(null), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.match(initialFoodLogConsumedDateInput({ dateIso: "2026-07-04", isToday: true }), /^2026-07-04T\d{2}:\d{2}$/);
  assert.match(initialFoodLogConsumedDateInput({ dateIso: "2026-06-30", isToday: false }), /^2026-06-30T\d{2}:\d{2}$/);
  const selectedDateContext = { dateIso: "2026-06-24", isToday: true };
  const selectedDateDefault = initialFoodLogConsumedDateInput(selectedDateContext);
  assert.equal(
    restoredFoodLogDraftConsumedDateInput(selectedDateContext, {
      consumedDateInput: "2026-06-23T19:46",
      updatedAt: "2026-06-23T19:46:00.000Z",
    }),
    selectedDateDefault,
  );
  assert.equal(
    restoredFoodLogDraftConsumedDateInput(selectedDateContext, {
      consumedDateInput: "2026-06-24T09:00",
      updatedAt: "2026-06-24T09:00:00.000Z",
    }),
    selectedDateDefault,
  );
  assert.equal(
    restoredFoodLogDraftConsumedDateInput(selectedDateContext, {
      consumedDateInput: "2026-06-24T11:45",
      updatedAt: new Date().toISOString(),
    }),
    "2026-06-24T11:45",
  );
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
  assert.match(fake.files.get("Daily/2026-06-21.md"), /\[servings:: 1\.6\]/);
  assert.match(fake.files.get("Daily/2026-06-21.md"), /\[cal:: 192\]/);
  assert.match(fake.files.get("Daily/2026-06-21.md"), /\[protein:: 24\]/);
  assert.match(fake.files.get("Daily/2026-06-21.md"), /\[carbs:: 14\.4\]/);
  assert.match(fake.files.get("Daily/2026-06-21.md"), /\[fat:: 3\.2\]/);
  assert.equal(fake.files.has("Calendar.md"), false);

  plugin.settings.defaultFoodLogSection = "";
  fake.files.set("Daily/2026-06-22.md", "---\ntitle: 2026-06-22\n---\n\nExisting body\n");
  await plugin.logFoodFromInput({
    item: {
      id: "manual-shake",
      name: "Manual Shake",
      source: "custom-inline",
      nutrition: { calories: 180, proteinG: 25, carbsG: 10, fatG: 3 },
    },
    quantity: 1,
    unit: "serving",
    completedDate: "2026-06-22T07:30:00.000Z",
    createFoodNote: false,
  });
  const unheadedDailyContent = fake.files.get("Daily/2026-06-22.md");
  assert.match(unheadedDailyContent, /^---\ntitle: 2026-06-22\n---\n\n- 1 serving - Manual Shake <!-- /);
  assert.match(unheadedDailyContent, /\[cal:: 180\]/);
  assert.doesNotMatch(unheadedDailyContent, /## Food/);
  assert.ok(unheadedDailyContent.indexOf("Manual Shake") < unheadedDailyContent.indexOf("Existing body"));

  const recipe = await plugin.createFoodFromInput({
    type: "recipe",
    name: "Provider Snack Plate",
    servingAmount: 1,
    servingUnit: "recipe",
    ingredients: [
      "- 0.5 bar - [[Health/Foods/Provider Bar|Provider Bar]]",
      "- 1 cup - [[Health/Foods/Search Yogurt|Search Yogurt]]",
    ].join("\n"),
  });
  assert.equal(recipe.sourcePath, "Health/Recipes/Provider Snack Plate.md");
  const recipeContent = fake.files.get("Health/Recipes/Provider Snack Plate.md");
  assert.match(recipeContent, /kind: recipe/);
  assert.match(recipeContent, /#tps\/recipe/);
  assert.match(recipeContent, /servingUnit: "serving"/);
  assert.match(recipeContent, /recipeServings: 1/);
  assert.match(recipeContent, /calories: 316/);
  assert.match(recipeContent, /proteinG: 34\.5/);
  assert.match(recipeContent, /carbsG: 25\.9/);
  assert.match(recipeContent, /fatG: 7\.2/);
  assert.match(recipeContent, /#tps\/recipe\n- 0\.5 bar - \[\[Health\/Foods\/Provider Bar\|Provider Bar\]\]/);
  assert.match(recipeContent, /- 1 cup - \[\[Health\/Foods\/Search Yogurt\|Search Yogurt\]\]/);
  assert.doesNotMatch(recipeContent, /<!--/);
  assert.doesNotMatch(recipeContent, /\[foodPath:: Health\/Foods\/Search Yogurt\.md\]/);
  assert.doesNotMatch(recipeContent, /\ningredients:/);
  assert.doesNotMatch(recipeContent, /## Notes\n- 0\.5 bar/);
  assert.doesNotMatch(recipeContent, /## Ingredients/);

  const plainRecipe = await plugin.createFoodFromInput({
    type: "recipe",
    name: "Plain Ingredient Recipe",
    servingAmount: 1,
    servingUnit: "recipe",
    ingredients: [
      "- 1 bar - Provider Bar",
      "- 2 scoop - Missing Protein Powder",
    ].join("\n"),
  });
  assert.equal(plainRecipe.sourcePath, "Health/Recipes/Plain Ingredient Recipe.md");
  const plainRecipeContent = fake.files.get("Health/Recipes/Plain Ingredient Recipe.md");
  assert.match(plainRecipeContent, /- 1 bar - \[\[Health\/Foods\/Provider Bar\|Provider Bar\]\]/);
  assert.match(plainRecipeContent, /- 2 scoop - Missing Protein Powder/);

  const multiServingRecipe = await plugin.createFoodFromInput({
    type: "recipe",
    name: "Four Serving Snack Plate",
    servingAmount: 1,
    servingUnit: "serving",
    recipeServings: 4,
    ingredients: [
      "- 0.5 bar - [[Health/Foods/Provider Bar|Provider Bar]]",
      "- 1 cup - [[Health/Foods/Search Yogurt|Search Yogurt]]",
    ].join("\n"),
  });
  assert.equal(multiServingRecipe.nutrition.calories, 79);
  assert.equal(multiServingRecipe.nutrition.proteinG, 8.625);
  const multiServingRecipeContent = fake.files.get("Health/Recipes/Four Serving Snack Plate.md");
  assert.match(multiServingRecipeContent, /kind: recipe/);
  assert.match(multiServingRecipeContent, /recipeServings: 4/);
  assert.match(multiServingRecipeContent, /calories: 79/);
  assert.match(multiServingRecipeContent, /proteinG: 8\.625/);

  const meal = await plugin.createFoodFromInput({
    type: "meal",
    name: "Single Serving Snack Plate",
    servingAmount: 1,
    servingUnit: "meal",
    recipeServings: 12,
    ingredients: [
      "- 0.5 bar - [[Health/Foods/Provider Bar|Provider Bar]]",
      "- 1 cup - [[Health/Foods/Search Yogurt|Search Yogurt]]",
    ].join("\n"),
  });
  assert.equal(meal.nutrition.calories, 316);
  const mealContent = fake.files.get("Health/Recipes/Single Serving Snack Plate.md");
  assert.match(mealContent, /kind: meal/);
  assert.match(mealContent, /servingUnit: "meal"/);
  assert.match(mealContent, /recipeServings: 1/);
  assert.match(mealContent, /calories: 316/);

  const touchedPaths = new Set(fake.writes.filter((write) => write.op !== "mkdir").map((write) => write.path));
  assert.deepEqual([...touchedPaths].sort(), [
    "Daily/2026-06-20.md",
    "Daily/2026-06-21.md",
    "Daily/2026-06-22.md",
    "Health/Food Log.md",
    "Health/Foods/Provider Bar.md",
    "Health/Foods/Search Yogurt.md",
    "Health/Recipes/Four Serving Snack Plate.md",
    "Health/Recipes/Plain Ingredient Recipe.md",
    "Health/Recipes/Provider Snack Plate.md",
    "Health/Recipes/Single Serving Snack Plate.md",
  ]);
});

test("create from food search upserts canonical local foods instead of creating duplicate copies", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.doesNotMatch(mainSource, /\$\{item\.name\} copy/);
  assert.match(mainSource, /new CustomFoodModal\(this\.app, this\.plugin, "food", item\.name, true, await this\.plugin\.enrichFoodSearchItem\(item\), this\.dateContext\)\.open\(\)/);
  assert.match(mainSource, /const saved = await this\.plugin\.upsertFoodFromInput\(\{/);
  assert.match(mainSource, /logger\.flow\("CustomFoodModal", "submit:done"/);
  assert.match(mainSource, /logger\.flow\("CustomFoodModal", "edit:done"/);
  assert.match(mainSource, /logger\.flow\("CustomFoodModal", "log-modal:open"/);
  assert.match(mainSource, /logger\.flowError\("CustomFoodModal", "submit:failed"/);
  assert.match(mainSource, /barcode: this\.baseFood\?\.barcode/);
  assert.match(mainSource, /function foodDedupeKey\(item: FoodItem\): string/);
  assert.match(mainSource, /if \(item\.barcode\) return `barcode:\$\{normalizeLookup\(item\.barcode\)\}`/);
  assert.match(mainSource, /foodCandidateCompletenessScore\(item\) > foodCandidateCompletenessScore\(existing\)/);
  assert.match(mainSource, /function sameNamedEquivalentMetricFood\(a: FoodItem, b: FoodItem\): boolean/);
  assert.match(mainSource, /const multiplier = 100 \/ metric\.amount/);
});

test("food detail editors use a compact responsive field grid", () => {
  assert.match(mainSource, /class BarcodeFoodReviewModal extends Modal[\s\S]+tps-health-food-editor-frame[\s\S]+tps-health-food-editor-grid/);
  assert.match(mainSource, /class CustomFoodModal extends Modal[\s\S]+tps-health-food-editor-frame[\s\S]+tps-health-food-editor-grid/);
  assert.match(stylesSource, /\.tps-health-food-editor-grid \{[\s\S]+grid-template-columns: repeat\(auto-fit, minmax\(min\(190px, 100%\), 1fr\)\)/);
  assert.match(stylesSource, /\.tps-health-food-editor-grid > \.setting-item \{[\s\S]+flex-direction: column/);
  assert.match(stylesSource, /\.tps-health-food-editor-grid \.setting-item-control input,[\s\S]+font-size: var\(--font-ui-small\)/);
  assert.match(stylesSource, /@media \(max-width: 600px\)[\s\S]+minmax\(min\(132px, 100%\), 1fr\)/);
});

test("food logging uses TPS Table without registering the retired custom Bases view", async () => {
  const [mainSource, stylesSource, readmeSource, foodLogBaseSource] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("./fixtures/Food Log.base", import.meta.url)), "utf8")),
  ]);

  assert.match(mainSource, /const LEGACY_FOOD_LOG_BASE_VIEW_TYPE = "tps-health-food-log"/);
  assert.doesNotMatch(mainSource, /registerBasesView\([^)]*LEGACY_FOOD_LOG_BASE_VIEW_TYPE/);
  assert.doesNotMatch(mainSource, /class FoodLogBaseView/);
  assert.doesNotMatch(mainSource, /\bBasesView\b|\bQueryController\b/);
  assert.doesNotMatch(stylesSource, /\.tps-health-food-log-base\b/);
  assert.doesNotMatch(stylesSource, /\.tps-health-food-log-table-row\b/);

  assert.match(mainSource, /id: "open-food-log-base"/);
  assert.match(mainSource, /name: "Open Food Log base"/);
  assert.match(mainSource, /vault\.create\(DEFAULT_FOOD_LOG_BASE_PATH, defaultFoodLogBaseContent\(this\.settings\)\)/);
  assert.match(mainSource, /const repaired = repairFoodLogBaseContent\(await this\.app\.vault\.cachedRead\(file\), this\.settings\);/);
  assert.match(mainSource, /logger\.flow\("Base", "food-log:repair", \{ path: file\.path \}\)/);
  assert.match(mainSource, /await this\.app\.vault\.modify\(file, repaired\)/);

  assert.match(mainSource, /const GCM_TABLE_BASE_VIEW_TYPE = "tps-table"/);
  assert.match(mainSource, /const GCM_LEGACY_LOG_BASE_VIEW_TYPE = "tps-log-table"/);
  assert.match(mainSource, /function defaultFoodLogBaseContent\(settings: TPSHealthSettings\): string/);
  assert.match(mainSource, /const filters = foodLogBaseDefaultFilters\(settings\)/);
  assert.match(mainSource, /"    lineFilterKey: food"/);
  assert.match(mainSource, /"    totalsRow: top"/);
  assert.match(mainSource, /"    createAction: command"/);
  assert.match(mainSource, /"    createCommandId: tps-health:log-food"/);
  assert.match(mainSource, /"    groupBy:"/);
  assert.match(mainSource, /"      property: completedDate"/);
  assert.match(mainSource, /"        direction: DESC"/);
  assert.match(mainSource, /function legacyBroadFoodLogBaseContent\(\): string/);
  assert.match(mainSource, /function replaceLegacyFoodLogBaseViewConfig\(content: string\): string/);
  assert.match(mainSource, /const migrated = replaceLegacyFoodLogBaseViewConfig\(normalized\)/);
  assert.match(mainSource, /function repairLogBaseViewConfig\(content: string\): string/);
  assert.match(mainSource, /const repairedView = repairLogBaseViewConfig\(normalized\)/);
  assert.match(mainSource, /if \(!normalized\) return defaultFoodLogBaseContent\(settings\)/);
  assert.match(mainSource, /function foodLogBaseDefaultFilters\(settings: TPSHealthSettings\): string\[\]/);
  assert.doesNotMatch(mainSource, /const files = this\.plugin\.app\.vault\.getMarkdownFiles\(\);\s+for \(const file of files\)/);

  assert.match(mainSource, /async openFoodLogEntryMenu\(event: MouseEvent, entry: FoodLogBaseEntry\): Promise<void>/);
  assert.match(mainSource, /const selectedEntries = await this\.getSelectedFoodLogEntries\(entry\)/);
  assert.match(mainSource, /Create recipe from/);
  assert.match(mainSource, /new FoodLogRecipeModal\(this\.app, this, selectedEntries\)\.open\(\)/);
  assert.match(mainSource, /class FoodLogRecipeModal extends Modal/);
  assert.match(mainSource, /sumFoodLogNutrition\(this\.entries\)/);
  assert.match(mainSource, /setTitle\("Adjust serving consumed"\)/);
  assert.match(mainSource, /setTitle\("Edit food macros\/title"\)/);
  assert.match(mainSource, /Delete food log entry/);
  assert.match(mainSource, /async deleteFoodLogEntries\(entries: FoodLogBaseEntry\[\]/);
  assert.match(mainSource, /class FoodLogAdjustModal extends Modal/);
  assert.match(mainSource, /async replaceFoodLogEntryLine\(entry: FoodLogBaseEntry/);
  assert.match(mainSource, /async openFoodLogFoodNote\(entry: FoodLogBaseEntry\)/);
  assert.match(mainSource, /setTitle\("Change consumed date\/time"\)/);
  assert.match(mainSource, /class FoodLogConsumedDateModal extends Modal/);
  assert.match(mainSource, /updateFoodLogEntryConsumedDate\(entry: FoodLogBaseEntry/);

  assert.match(foodLogBaseSource, /^\s*- type: tps-table\s*$/m);
  assert.match(foodLogBaseSource, /^\s+lineFilterKey: food\s*$/m);
  assert.match(foodLogBaseSource, /^\s+totalsRow: top\s*$/m);
  assert.match(foodLogBaseSource, /^\s+createCommandId: tps-health:log-food\s*$/m);
  assert.doesNotMatch(foodLogBaseSource, /tps-health-food-log|tps-log-table/);

  assert.match(readmeSource, /no longer registers .*tps-health-food-log/);
  assert.match(readmeSource, /GCM's generic .*tps-table/);
  assert.match(readmeSource, /lineFilterKey: food/);
  assert.match(readmeSource, /totalsRow: top/);
  assert.match(readmeSource, /createCommandId: tps-health:log-food/);
  assert.match(readmeSource, /GCM TPS Table scans matching Markdown inline-property lines/);
});

test("inline food autocomplete supports linked food amounts without property brackets", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /!lineHasFoodDraftProperties\(line\) && !parsed\.hasExplicitAmount && !parsed\.sourcePath/);
  assert.match(mainSource, /draft\.sourcePath/);
  assert.match(mainSource, /logger\.flowWarn\("InlineFood", "suggest:source-missing", \{ sourcePath: draft\.sourcePath \}\)/);
  assert.match(mainSource, /logger\.flowWarn\("InlineFood", "suggest:select-missing-line"/);
  assert.match(mainSource, /logger\.flowWarn\("InlineFood", "suggest:select-no-completion"/);
  assert.match(mainSource, /logger\.flowWarn\("InlineFood", "suggest:select-no-editor"/);
  assert.match(mainSource, /logger\.flow\("InlineFood", "suggest:select-done"/);
  assert.match(mainSource, /resolveFoodLogServing\(saved, parsed\.quantity, parsed\.unit \|\| preferredFoodLogUnit\(saved\)\)/);
});

test("completed inline food logs render as live preview chips", async () => {
  const fs = await import("node:fs/promises");
  const mainSource = await fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");
  const stylesSource = await fs.readFile(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
  assert.match(mainSource, /if \(Platform\.isMobileApp\) \{\s+logger\.flow\("FoodLog", "editor-extension:skip-mobile", \{ reason: "avoid-mobile-note-open-regressions" \}\);\s+\} else \{\s+this\.registerEditorExtension\(createFoodLogChipExtension\(this\)\);\s+\}/);
  assert.match(mainSource, /registerEditorExtension\(createWorkoutSetChipExtension\(this\)\)/);
  assert.match(mainSource, /class WorkoutExercisePickerModal extends Modal/);
  assert.match(mainSource, /text: "Workout • 0\/0"/);
  assert.match(mainSource, /async addSeededWorkoutSetAfterBlock\(source: WorkoutSetLineSource\)/);
  assert.match(mainSource, /previous\.textContent = data\.previous\?\.details \? `Last:/);
  assert.match(mainSource, /"render:legacy-readonly"/);
  assert.match(stylesSource, /\.tps-health-workout-exercise-add[\s\S]*width: 100%/);
  assert.match(mainSource, /scheduleWorkoutActionBars\(\)/);
  assert.match(mainSource, /ensureWorkoutActionBar\(view: MarkdownView \| null, file: TFile, source: "view" \| "active-workout" \| "active-view" = "view"\)/);
  assert.match(mainSource, /logger\.flow\("WorkoutActionBar", "refresh:scheduled"/);
  assert.match(mainSource, /logger\.flow\("WorkoutActionBar", "refresh:done"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutActionBar", "refresh:failed"/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutActionBar", "render:no-host"/);
  assert.match(mainSource, /logger\.flow\("WorkoutActionBar", "render:done"/);
  assert.match(mainSource, /new WorkoutExercisePickerModal\(this\.app, this, file\.path\)\.open\(\)/);
  assert.match(mainSource, /async logSetToWorkoutFile\(filePath: string, set: LogSetInput\): Promise<WorkoutSet>/);
  assert.match(mainSource, /logger\.flowWarn\("WorkoutSet", "log-file:missing-file"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "log-file:done"/);
  assert.match(mainSource, /countWorkoutSetRecords\(content\) \+ 1/);
  assert.match(mainSource, /ctx\.addChild\(new TPSHealthRenderedControlsChild\(root, this, ctx\)\)/);
  assert.match(mainSource, /renderFoodLogChips\(this\.containerEl, this\.plugin, this\.ctx\)/);
  assert.match(mainSource, /renderWorkoutSetChips\(this\.containerEl, this\.plugin, this\.ctx\)/);
  assert.match(mainSource, /class FoodLogChipWidget extends WidgetType/);
  assert.match(mainSource, /new FoodLogChipWidget\(plugin, chip, \{ filePath, lineNumber: line\.number - 1, line: text \}\)/);
  assert.match(mainSource, /menuButton\.className = "tps-health-food-chip-menu"/);
  assert.match(mainSource, /macros\.setAttribute\("aria-label", `Nutrition: \$\{data\.macros\.join\(", "\)\}`\)/);
  assert.match(mainSource, /macro\.className = "tps-health-food-chip-macro"/);
  assert.match(mainSource, /macro\.textContent = value/);
  assert.match(mainSource, /void plugin\.openFoodLogEntryMenuFromLine\(event, ctx\.sourcePath, lineNumber, text\)/);
  assert.match(mainSource, /looksLikeFoodLogVisibleLine\(visibleText\)/);
  assert.match(mainSource, /findFoodLogEntryByVisibleText\(file, foodLogVisibleSummary\(line\) \|\| line\)/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogEntry", "contextmenu:no-match"/);
  assert.match(mainSource, /logger\.flowError\("FoodLogEntry", "contextmenu:failed"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogEntry", "menu-from-line:missing-file"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogEntry", "menu-from-line:stale-line"/);
  assert.match(mainSource, /logger\.flow\("FoodLogEntry", "menu-from-line:fallback-match"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogEntry", "menu-from-line:no-match"/);
  assert.match(mainSource, /logger\.flow\("FoodLogEntry", "source-line:open-start"/);
  assert.match(mainSource, /logger\.flow\("FoodLogEntry", "source-line:open-done"/);
  assert.match(mainSource, /logger\.flowWarn\("FoodLogEntry", "source-line:no-active-view"/);
  assert.match(mainSource, /logger\.flowError\("FoodLogEntry", "source-line:open-failed"/);
  assert.match(mainSource, /class WorkoutSetChipWidget extends WidgetType/);
  assert.match(mainSource, /safeWorkoutSetEditorElement\(this\.plugin, this\.data, this\.source\) \|\| document\.createElement\("span"\)/);
  assert.match(mainSource, /function safeWorkoutSetEditorElement\(plugin: TPSHealthPlugin, data: WorkoutSetChipData, source: WorkoutSetLineSource\): HTMLElement \| null/);
  assert.match(mainSource, /logger\.flowError\("WorkoutSet", "render:failed"/);
  assert.match(mainSource, /plugin\.updateWorkoutSetLine\(source, \{/);
  assert.match(mainSource, /void plugin\.addSeededWorkoutSetAfterBlock\(source\)/);
  assert.match(mainSource, /void plugin\.duplicateWorkoutSetBelow\(source\)/);
  assert.match(mainSource, /function workoutSetPlaceholderLine\(exercise: string\): string/);
  assert.doesNotMatch(mainSource, /\[exercise:: Exercise\] \[setId::/);
  assert.match(mainSource, /rest\.setAttribute\("aria-label", "Rest seconds"\)/);
  assert.match(mainSource, /restLabel\.textContent = "Rest"/);
  assert.match(mainSource, /perform\.textContent = data\.status === "complete" \? "Performed" : "Play"/);
  assert.match(mainSource, /perform\.setAttribute\("aria-label", data\.status === "complete"/);
  assert.match(mainSource, /restControl\.append\(restLabel, restDown, rest, restUp, restStatus\)/);
  assert.match(mainSource, /restCountdown\.textContent = remaining > 0 \? formatRestDuration\(remaining\) : "done"/);
  assert.match(mainSource, /void plugin\.linkWorkoutExerciseWithPrevious\(source\)/);
  assert.match(mainSource, /void plugin\.linkWorkoutSetWithPreviousDropSet\(source\)/);
  assert.match(mainSource, /const metrics = document\.createElement\("span"\)/);
  assert.match(mainSource, /metrics\.className = "tps-health-workout-set-metrics"/);
  assert.match(mainSource, /setBadge\.className = `tps-health-workout-set-badge is-\$\{data\.setType \|\| "normal"\}`/);
  assert.match(mainSource, /previous\.className = "tps-health-workout-set-previous"/);
  assert.match(mainSource, /gridHeader\.className = "tps-health-workout-set-grid-header"/);
  assert.match(mainSource, /input\.addEventListener\("focus", \(\) => input\.select\(\)\)/);
  assert.match(mainSource, /event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"/);
  assert.match(mainSource, /restSeconds: restValue/);
  assert.match(mainSource, /restStartedAt: currentRestStartedAt \|\| undefined/);
  assert.match(mainSource, /performed: options\.perform/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", performsSet \? "line:perform" : "line:update"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "line:update-rebased"/);
  assert.match(mainSource, /"line:update-duplicate-set-id" : "line:update-missing-set-id"/);
  assert.match(mainSource, /ignoreEvent\(\): boolean \{\s+return true;/);
  assert.match(mainSource, /foodLogChipDataFromLine\(text\)/);
  assert.match(mainSource, /foodLogNutritionForLine\(line, plugin\)/);
  assert.match(mainSource, /foodLogChipDataFromRenderedItem\(item, plugin\)/);
  assert.match(mainSource, /workoutSetChipDataFromLine/);
  const workoutSetExtensionSource = mainSource.slice(
    mainSource.indexOf("function createWorkoutSetChipExtension"),
    mainSource.indexOf("function docHasWorkoutSetLine"),
  );
  assert.match(workoutSetExtensionSource, /view\.state\.field\(editorLivePreviewField, false\)/);
  assert.match(workoutSetExtensionSource, /workoutFilePathForEditorView\(plugin, view\)/);
  assert.match(workoutSetExtensionSource, /if \(!filePath \|\| !isWorkoutLikeMarkdownPath\(plugin, filePath\)\) return Decoration\.none;/);
  assert.doesNotMatch(workoutSetExtensionSource, /Decoration\.replace/);
  assert.match(workoutSetExtensionSource, /builder\.add\(line\.to, line\.to, Decoration\.widget/);
  assert.match(mainSource, /function workoutFilePathForRenderedRoot\(plugin: TPSHealthPlugin, root: HTMLElement, sourcePath: string \| null \| undefined\): string/);
  assert.match(mainSource, /function markdownFilePathForRenderedElement\(plugin: TPSHealthPlugin, element: HTMLElement\): string/);
  assert.match(mainSource, /const items = root\.matches\("li"\) \? \[root, \.\.\.Array\.from\(root\.querySelectorAll\("li"\)\)\] : Array\.from\(root\.querySelectorAll\("li"\)\);/);
  assert.match(stylesSource, /\.tps-health-food-chip/);
  assert.match(stylesSource, /grid-template-areas:/);
  assert.match(stylesSource, /@media \(max-width: 520px\), \(hover: none\) and \(pointer: coarse\) \{/);
  assert.match(stylesSource, /"food menu"\s+"macros macros"\s+"serving amount"/);
  assert.match(stylesSource, /width: min\(100%, calc\(100vw - 96px\)\)/);
  assert.match(stylesSource, /\.tps-health-food-chip-serving/);
  assert.match(stylesSource, /\.tps-health-food-chip-macros/);
  assert.match(stylesSource, /"food macros menu"\s+"serving amount menu"/);
  assert.match(stylesSource, /\.tps-health-food-chip-macro \{[\s\S]*font-variant-numeric: tabular-nums;/);
  assert.match(stylesSource, /\.tps-health-food-chip-macros \{[\s\S]*justify-content: flex-end;/);
  assert.match(stylesSource, /\.tps-health-food-chip-menu/);
  assert.match(stylesSource, /\.tps-health-macro-pill/);
  assert.match(stylesSource, /\.tps-health-workout-set-chip/);
  assert.match(stylesSource, /\.tps-health-workout-action-bar/);
  assert.match(stylesSource, /\.tps-health-workout-action-bar--mobile-floating/);
  assert.match(stylesSource, /\.tps-health-workout-action-return/);
  assert.match(stylesSource, /flex: 0 0 38px/);
  assert.match(stylesSource, /width: 38px/);
  assert.match(stylesSource, /bottom: calc\(var\(--tps-gcm-mobile-toolbar-offset, 0px\) \+ env\(safe-area-inset-bottom, 0px\) \+ 86px\)/);
  assert.match(stylesSource, /body\.is-mobile\.tps-health-mobile-workout-actions-active/);
  assert.match(stylesSource, /\.tps-health-workout-action-button/);
  assert.match(stylesSource, /\.tps-health-workout-set-header/);
  assert.match(stylesSource, /\.tps-health-workout-set-grid-header/);
  assert.match(stylesSource, /\.tps-health-workout-set-metrics/);
  assert.match(stylesSource, /\.tps-health-workout-set-badge/);
  assert.match(stylesSource, /\.tps-health-workout-set-previous/);
  assert.match(stylesSource, /\.tps-health-workout-set-field-label/);
  assert.match(stylesSource, /\.tps-health-workout-set-meta/);
  assert.match(stylesSource, /\.tps-health-workout-set-stepper/);
  assert.match(stylesSource, /\.tps-health-workout-set-rest/);
  assert.match(stylesSource, /\.tps-health-workout-set-actions/);
  assert.match(stylesSource, /\.tps-health-workout-rest-status/);
  assert.match(stylesSource, /\.tps-health-workout-rest-countdown/);
  assert.match(mainSource, /private shouldFloatWorkoutActionBar\(\): boolean/);
  assert.match(mainSource, /private resolveMobileWorkoutActionBarTarget\(\): \{ file: TFile; source: "active-view" \} \| null/);
  assert.match(mainSource, /private findActiveWorkoutFileFromState\(\): TFile \| null/);
  assert.match(mainSource, /logger\.flow\("Workout", "active-file:recovered"/);
  assert.match(mainSource, /logger\.flowWarn\("Workout", "active-file:missing"/);
  assert.doesNotMatch(mainSource, /return \{ file: active, source: "active-workout" \};/);
  assert.match(mainSource, /const view = this\.app\.workspace\.getActiveViewOfType\(MarkdownView\);/);
  assert.match(mainSource, /const target = this\.resolveMobileWorkoutActionBarTarget\(\);/);
  assert.match(mainSource, /ensureWorkoutActionBar\(null, target\.file, target\.source\)/);
  assert.match(mainSource, /Platform\.isMobile\s+\|\|\s+Platform\.isMobileApp/);
  assert.match(mainSource, /tps-health-workout-action-bar--mobile-floating tps-gcm-hover-element/);
  assert.match(mainSource, /bar\.setAttribute\("data-tps-hover-element", "true"\)/);
  assert.match(mainSource, /cls: "tps-health-workout-action-return"/);
  assert.match(mainSource, /setIcon\(open, "file-text"\)/);
  assert.doesNotMatch(mainSource, /text: this\.settings\.activeWorkoutTitle \|\| "Workout"/);
  assert.match(mainSource, /private async openWorkoutFileFromActionBar\(file: TFile, source: "view" \| "active-workout" \| "active-view"\): Promise<void>/);
  assert.match(mainSource, /logger\.flow\("WorkoutActionBar", "open-active:submit"/);
  assert.match(mainSource, /logger\.flowError\("WorkoutActionBar", "open-active:failed"/);
  assert.match(mainSource, /void this\.openWorkoutFileFromActionBar\(file, source\)/);
  assert.match(mainSource, /skippedInactiveMobileLeaves/);
  assert.match(mainSource, /document\.body\.classList\.toggle\(\s+"tps-health-mobile-workout-actions-active"/);
});

test("workout checklist completion tracks rest and prompts on the final planned set", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    activeWorkoutId: "workout-active",
    activeWorkoutPath: "Health/Workouts/Workout Checklist QA.md",
    activeWorkoutStartedAt: "2026-06-24T10:00:00.000Z",
    activeWorkoutPlanPath: "Health/Workout Plans/Checklist Plan.md",
    activeWorkoutSetCount: 0,
    workoutSetStorage: "task",
    defaultRestSeconds: 90,
  };
  const path = plugin.settings.activeWorkoutPath;
  const initial = [
    "---",
    "kind: workout",
    "workoutId: workout-active",
    "status: active",
    "workoutDate: 2026-06-24",
    "---",
    "## Sets",
    "- [ ] Bench press - warmup - 45 lb x 10",
    "- [ ] Bench press - 135 lb x 8",
    "",
  ].join("\n");
  fake.files.set(path, initial);
  const file = fake.app.vault.getAbstractFileByPath(path);
  const prompted = [];
  plugin.promptFinishWorkoutAfterLastSet = (promptFile) => prompted.push(promptFile.path);
  plugin.workoutFileSnapshots.set(path, initial);

  fake.files.set(path, initial.replace("- [ ] Bench press - warmup - 45 lb x 10", "- [x] Bench press - warmup - 45 lb x 10"));
  await plugin.handleWorkoutFileModify(file);

  let content = fake.files.get(path);
  assert.match(content, /- \[x\] Bench press - warmup - 45 lb x 10 .*?\[exercise:: Bench press\]/);
  assert.match(content, /\[setType:: warmup\]/);
  assert.match(content, /\[reps:: 10\]/);
  assert.match(content, /\[weight:: 45\]/);
  assert.match(content, /\[unit:: lb\]/);
  assert.match(content, /\[setId:: set-/);
  assert.match(content, /\[workoutPlanPath:: Health\/Workout Plans\/Checklist Plan\.md\]/);
  assert.match(content, /setCount: 1/);
  assert.equal(plugin.settings.activeWorkoutSetCount, 1);
  assert.deepEqual(prompted, [], "non-final planned set should not prompt to finish");

  fake.files.set(path, content.replace("- [ ] Bench press - 135 lb x 8", "- [x] Bench press - 135 lb x 8"));
  await plugin.handleWorkoutFileModify(file);

  content = fake.files.get(path);
  assert.match(content, /- \[x\] Bench press - 135 lb x 8 .*?\[exercise:: Bench press\]/);
  assert.match(content, /\[reps:: 8\]/);
  assert.match(content, /\[weight:: 135\]/);
  assert.match(content, /setCount: 2/);
  assert.equal(plugin.settings.activeWorkoutSetCount, 2);
  assert.deepEqual(prompted, [path], "final planned set should prompt to finish active workout");
});

test("blank active workouts can log sets with rest and save repeated planned sets as a layout", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    dailyNoteFolder: "Daily",
    dailyNoteFormat: "YYYY-MM-DD",
    workoutsFolder: "Health/Workouts",
    workoutPlansFolder: "Health/Workout Plans",
    exercisesFolder: "Health/Exercises",
    workoutTemplatePath: "",
    workoutPlanTemplatePath: "",
    exerciseTemplatePath: "",
    workoutLogTarget: "session-note",
    activeWorkoutTarget: "session-note",
    workoutSessionBodyMode: "sets-section",
    workoutExerciseLayout: "flat",
    workoutSetNotation: "compact",
    workoutSetStorage: "task",
    appendWorkoutSummaryToDailyNote: false,
    defaultRestSeconds: 90,
    restTimerMode: "count-up",
    defaultWorkoutCooldownDays: 2,
  };

  const workoutPath = await plugin.startWorkout({
    title: "Blank Active QA",
    logTarget: "session-note",
    startedAt: "2026-07-06T10:00:00.000Z",
    openFile: false,
  });
  assert.equal(workoutPath, "Health/Workouts/Blank Active QA.md");
  assert.match(fake.files.get(workoutPath), /kind: "workout"/);
  assert.doesNotMatch(fake.files.get(workoutPath), /## Sets|### Bench press/);
  assert.equal(plugin.getActiveWorkoutState().title, "Blank Active QA");

  await plugin.logSet({
    exercise: "Bench press",
    reps: 8,
    weight: 185,
    weightUnit: "lb",
    restSeconds: 120,
    completedDate: "2026-07-06T10:05:00.000Z",
  });
  await plugin.logSet({
    exercise: "Bench press",
    reps: 8,
    weight: 185,
    weightUnit: "lb",
    restSeconds: 120,
    completedDate: "2026-07-06T10:10:00.000Z",
  });

  const workout = fake.files.get(workoutPath);
  assert.doesNotMatch(workout, /- \[[ xX]\]/);
  assert.doesNotMatch(workout, /## Sets|### Bench press/);
  assert.equal((workout.match(/^\s*- .*?\[type:: workoutSet\]/gm) || []).length, 2);
  assert.match(workout, /\[rest:: 120\]/);
  assert.match(workout, /setCount: 2/);
  assert.equal(plugin.getActiveWorkoutState().setCount, 2);

  const layoutPath = await plugin.saveActiveWorkoutTemplate({
    title: "Blank Push Layout",
    cooldownDays: 3,
    defaultRestSeconds: 120,
  });
  assert.equal(layoutPath, "Health/Workout Plans/Blank Push Layout.md");
  const layout = fake.files.get(layoutPath);
  assert.match(layout, /kind: workout-plan/);
  assert.match(layout, /cooldownDays: 3/);
  assert.match(layout, /defaultRestSeconds: 120/);
  assert.equal((layout.match(/- \[\[Health\/Exercises\/Bench press\|Bench press\]\] - 185 lb x 8 \[rest:: 120\]/g) || []).length, 2);
});

test("concurrent workout set logs serialize per file without losing a set", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  const path = "Health/Workouts/Concurrent Sets QA.md";
  plugin.settings = {
    ...plugin.settings,
    activeWorkoutPath: path,
    activeWorkoutId: "workout-concurrent",
    activeWorkoutTarget: "session-note",
    activeWorkoutTitle: "Concurrent Sets QA",
    activeWorkoutStartedAt: "2026-07-11T12:00:00.000Z",
    activeWorkoutSetCount: 0,
    workoutLogTarget: "session-note",
    workoutSetNotation: "compact",
    restTimerMode: "count-up",
    defaultRestSeconds: 90,
  };
  fake.files.set(path, [
    "---",
    "kind: workout",
    "workoutId: workout-concurrent",
    "status: active",
    "setCount: 0",
    "---",
    "#tps/workout",
    "",
  ].join("\n"));

  const [squat, press] = await Promise.all([
    plugin.logSet({
      exercise: "Squat",
      reps: 5,
      weight: 225,
      weightUnit: "lb",
      createExerciseNote: false,
      completedDate: "2026-07-11T12:05:00.000Z",
    }),
    plugin.logSet({
      exercise: "Bench press",
      reps: 8,
      weight: 185,
      weightUnit: "lb",
      createExerciseNote: false,
      completedDate: "2026-07-11T12:10:00.000Z",
    }),
  ]);

  const content = fake.files.get(path);
  assert.notEqual(squat.id, press.id);
  assert.equal((content.match(/\[type:: workoutSet\]/g) || []).length, 2);
  assert.match(content, /Squat - 225 lb x 5/);
  assert.match(content, /Bench press - 185 lb x 8/);
  assert.match(content, /setCount: 2/);
  assert.equal(plugin.getActiveWorkoutState().setCount, 2);
  assert.equal(plugin.workoutMutationQueues.size, 0);

  const logSetSource = mainSource.slice(mainSource.indexOf("async logSet(set:"), mainSource.indexOf("async logFood(item:"));
  assert.match(logSetSource, /serializeWorkoutMutation\(mutationPath, "log-active-set"/);
  assert.match(logSetSource, /serializeWorkoutMutation\(filePath, "log-file-set"/);
  assert.match(mainSource, /logger\.flow\("WorkoutSet", "mutation:queued", \{ path: filePath, operation, queuedBehindExisting \}\)/);
});

test("active workout set rows recover stale state and stay simple in the workout note", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    workoutsFolder: "Health/Workouts",
    workoutPlansFolder: "Health/Workout Plans",
    exercisesFolder: "Health/Exercises",
    foodsFolder: "Health/Exercises",
    workoutLogTarget: "session-note",
    activeWorkoutPath: "Health/Workouts/Missing Workout.md",
    activeWorkoutId: "workout-missing",
    activeWorkoutTarget: "session-note",
    activeWorkoutTitle: "Missing Workout",
    activeWorkoutSetCount: 4,
  };

  await plugin.addSetForExerciseToActiveWorkout("Squat");
  assert.notEqual(plugin.settings.activeWorkoutPath, "Health/Workouts/Missing Workout.md");
  assert.match(plugin.settings.activeWorkoutPath, /^Health\/Workouts\/Workout /);
  const activePath = plugin.settings.activeWorkoutPath;
  assert.match(fake.files.get(activePath), /#tps\/workout\n\n- Squat - 0 lb x 0 \[type:: workoutSet\]/);
  assert.doesNotMatch(fake.files.get(activePath), /## Sets|### Squat|- \[ \] Squat/);

  await plugin.addSetForExerciseToActiveWorkout("Squat", {
    filePath: activePath,
    lineNumber: fake.files.get(activePath).split("\n").findIndex((line) => line.includes("Squat - 0 lb x 0")),
    line: fake.files.get(activePath).split("\n").find((line) => line.includes("Squat - 0 lb x 0")),
  });
  assert.equal((fake.files.get(activePath).match(/- Squat - 0 lb x 0/g) || []).length, 2);

  const lineNumber = fake.files.get(activePath).split("\n").findIndex((line) => line.includes("Squat - 0 lb x 0"));
  await plugin.updateWorkoutSetLine({
    filePath: activePath,
    lineNumber,
    line: fake.files.get(activePath).split("\n")[lineNumber],
  }, {
    exercise: "Squat",
    reps: 5,
    weight: 225,
    weightUnit: "lb",
    completed: false,
  });
  assert.match(fake.files.get(activePath), /- Squat - 225 lb x 5/);
  assert.doesNotMatch(fake.files.get(activePath), /\[superset::|\[dropSet::/);

  const groupedLineNumber = fake.files.get(activePath).split("\n").findIndex((line) => line.includes("Squat - 225 lb x 5"));
  await plugin.updateWorkoutSetLine({
    filePath: activePath,
    lineNumber: groupedLineNumber,
    line: fake.files.get(activePath).split("\n")[groupedLineNumber],
  }, {
    exercise: "Squat",
    reps: 5,
    weight: 225,
    weightUnit: "lb",
    setType: "drop",
    supersetGroupId: "A",
    dropSetGroupId: "B",
    completed: false,
  });
  assert.match(fake.files.get(activePath), /- Squat - 225 lb x 5 .*?\[setType:: drop\] \[superset:: A\] \[dropSet:: B\]/);
  assert.match(fake.files.get(activePath), /\[exercise:: Squat\] \[reps:: 5\] \[weight:: 225\] \[unit:: lb\]/);

  const squatLineNumber = fake.files.get(activePath).split("\n").findIndex((line) => line.includes("Squat - 225 lb x 5"));
  await plugin.duplicateWorkoutSetBelow({
    filePath: activePath,
    lineNumber: squatLineNumber,
    line: fake.files.get(activePath).split("\n")[squatLineNumber],
  });
  assert.equal((fake.files.get(activePath).match(/- Squat - 225 lb x 5/g) || []).length, 2);
  assert.equal((fake.files.get(activePath).match(/\[superset:: A\]/g) || []).length, 2);
  assert.equal((fake.files.get(activePath).match(/\[dropSet:: B\]/g) || []).length, 2);
  assert.equal((fake.files.get(activePath).match(/\[setId::/g) || []).length, 3);

  const inactivePath = "Health/Workouts/Inactive Empty Workout.md";
  fake.files.set(inactivePath, [
    "---",
    "kind: workout",
    "status: active",
    "cssclasses:",
    "  - tps-health-workout",
    "---",
    "#tps/workout",
    "## Sets",
  ].join("\n"));
  await plugin.addSetForExerciseToWorkoutFile(inactivePath, "Bench press");
  assert.match(fake.files.get(inactivePath), /## Sets\n\n- Bench press - 0 lb x 0 \[type:: workoutSet\]/);
  assert.equal((fake.files.get(activePath).match(/- Squat - 0 lb x 0/g) || []).length, 1);
});

test("active workout session loads after a stale saved path by recovering the workout id", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    workoutsFolder: "Health/Workouts",
    exercisesFolder: "Health/Exercises",
    workoutLogTarget: "session-note",
    activeWorkoutPath: "Health/Workouts/Missing Workout.md",
    activeWorkoutId: "workout-recover",
    activeWorkoutTarget: "session-note",
    activeWorkoutTitle: "Recovered Workout",
    activeWorkoutSetCount: 1,
  };
  fake.files.set("Health/Workouts/Renamed Workout.md", [
    "---",
    "kind: workout",
    "status: active",
    "title: Recovered Workout",
    "workoutId: workout-recover",
    "---",
    "",
    "## Sets",
    "",
  ].join("\n"));

  const recovered = plugin["activeWorkoutFile"]();
  assert.equal(recovered?.path, "Health/Workouts/Renamed Workout.md");
  assert.equal(plugin.settings.activeWorkoutPath, "Health/Workouts/Renamed Workout.md");

  await plugin.addSetForExerciseToActiveWorkout("Row");
  assert.match(fake.files.get("Health/Workouts/Renamed Workout.md"), /## Sets\n\n- Row - 0 lb x 0 \[type:: workoutSet\]/);
  assert.doesNotMatch(fake.files.get("Health/Workouts/Renamed Workout.md"), /### Row|- \[ \] Row/);
});

test("workout set Play rebases a stale rendered line number by stable set id", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    workoutIdentificationMode: "metadata-folder-tag",
    defaultRestSeconds: 90,
  };
  const path = "Health/Workouts/Stale Set Row QA.md";
  const originalLine = "- Dumbbell shoulder press - 40 lb x 8 [type:: workoutSet] [setId:: set-original] [exercise:: Dumbbell shoulder press] [reps:: 8] [weight:: 40] [unit:: lb] [completedDate:: 2026-07-09T20:00:00.000Z] [endedAt:: 2026-07-09T20:00:00.000Z]";
  const plannedLine = "- Dumbbell shoulder press - 0 lb x 0 [type:: workoutSet] [setId:: set-planned] [exercise:: Dumbbell shoulder press] [reps:: 0] [weight:: 0] [unit:: lb]";
  fake.files.set(path, [
    "---",
    "kind: workout",
    "status: active",
    "---",
    originalLine,
    plannedLine,
  ].join("\n"));

  const capturedPlannedLineNumber = 5;
  await plugin.addSetForExerciseToWorkoutFile(path, "Dumbbell shoulder press", {
    filePath: path,
    lineNumber: 4,
    line: originalLine,
  });
  assert.equal(fake.files.get(path).split("\n").findIndex((line) => line.includes("[setId:: set-planned]")), 6);

  await plugin.updateWorkoutSetLine({
    filePath: path,
    lineNumber: capturedPlannedLineNumber,
    line: plannedLine,
  }, {
    exercise: "Dumbbell shoulder press",
    reps: 10,
    weight: 45,
    weightUnit: "lb",
    restSeconds: 90,
    performed: true,
  });

  const content = fake.files.get(path);
  const originalAfter = content.split("\n").find((line) => line.includes("[setId:: set-original]")) || "";
  const plannedAfter = content.split("\n").find((line) => line.includes("[setId:: set-planned]")) || "";
  const insertedAfter = content.split("\n").find((line) => line.includes("[setId::") && !line.includes("set-original") && !line.includes("set-planned")) || "";
  assert.match(originalAfter, /40 lb x 8/);
  assert.match(originalAfter, /\[reps:: 8\] \[weight:: 40\]/);
  assert.match(plannedAfter, /45 lb x 10/);
  assert.match(plannedAfter, /\[completedDate:: .+?\]/);
  assert.match(plannedAfter, /\[restStartedAt:: .+?\]/);
  assert.match(insertedAfter, /0 lb x 0/);
  assert.doesNotMatch(insertedAfter, /\[completedDate::|\[endedAt::/);
});

test("source to Reading workout views stay synchronized while truly unwritable source buffers fail closed", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();

  const preview = createFakeHealthApp();
  const previewPlugin = new TPSHealthPlugin(preview.app);
  const previewPath = "Health/Workouts/Source Reading Sequence QA.md";
  const previewInitial = ["---", "kind: workout", "status: active", "---", "#tps/workout"].join("\n");
  preview.files.set(previewPath, previewInitial);
  let previewMode = "source";
  let previewViewData = previewInitial;
  let previewRenders = 0;
  const previewView = new globalThis.__TPSHealthTestMarkdownView();
  previewView.file = new globalThis.__TPSHealthTestTFile(previewPath);
  previewView.getMode = () => previewMode;
  previewView.editor = { getValue: () => previewViewData };
  previewView.getViewData = () => previewViewData;
  previewView.setViewData = (content, clear) => {
    assert.equal(clear, false);
    previewViewData = content;
  };
  previewView.previewMode = {
    rerender: (force) => {
      assert.equal(force, true);
      previewRenders++;
    },
  };
  preview.app.workspace.iterateAllLeaves = (callback) => callback({ view: previewView });
  await previewPlugin.addSetForExerciseToWorkoutFile(previewPath, "Squat", undefined, { focusAfter: false });
  const firstLineNumber = previewViewData.split("\n").findIndex((line) => line.includes("[type:: workoutSet]"));
  const firstLine = previewViewData.split("\n")[firstLineNumber];
  assert.match(firstLine, /\[setId::/);
  previewMode = "preview";
  await previewPlugin.addSeededWorkoutSetAfterBlock({ filePath: previewPath, lineNumber: firstLineNumber, line: firstLine });
  assert.equal((previewViewData.match(/\[type:: workoutSet\]/g) || []).length, 2);
  assert.equal((preview.files.get(previewPath).match(/\[type:: workoutSet\]/g) || []).length, 2);
  assert.equal(previewRenders, 1);
  await preview.app.vault.modify(previewView.file, previewViewData);
  assert.equal((preview.files.get(previewPath).match(/\[type:: workoutSet\]/g) || []).length, 2);

  const source = createFakeHealthApp();
  const sourcePlugin = new TPSHealthPlugin(source.app);
  const sourcePath = "Health/Workouts/Unwritable Source QA.md";
  const sourceInitial = ["---", "kind: workout", "status: active", "---", "#tps/workout"].join("\n");
  source.files.set(sourcePath, sourceInitial);
  const sourceView = new globalThis.__TPSHealthTestMarkdownView();
  sourceView.file = new globalThis.__TPSHealthTestTFile(sourcePath);
  sourceView.getMode = () => "source";
  sourceView.editor = { getValue: () => sourceInitial };
  source.app.workspace.iterateAllLeaves = (callback) => callback({ view: sourceView });
  await assert.rejects(
    () => sourcePlugin.addSetForExerciseToWorkoutFile(sourcePath, "Squat", undefined, { focusAfter: false }),
    /Could not synchronize 1 open workout editor/,
  );
  assert.equal(source.files.get(sourcePath), sourceInitial);
});

test("seeded workout add keeps the active editor buffer and disk in sync through a later row save", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  const path = "Health/Workouts/Editor Buffer QA.md";
  const originalLine = "- Squat - 225 lb x 5 [type:: workoutSet] [setId:: set-buffer-original] [exercise:: Squat] [reps:: 5] [weight:: 225] [unit:: lb] [rest:: 90]";
  const initial = ["---", "kind: workout", "status: active", "---", "#tps/workout", "", originalLine].join("\n");
  fake.files.set(path, initial);

  let editorContent = initial;
  const editorDoc = () => ({
    length: editorContent.length,
    toString: () => editorContent,
  });
  const cm = {
    state: { doc: editorDoc() },
    dispatch: ({ changes }) => {
      assert.equal(changes.from, 0);
      assert.equal(changes.to, editorContent.length);
      editorContent = changes.insert;
      cm.state.doc = editorDoc();
    },
  };
  const view = new globalThis.__TPSHealthTestMarkdownView();
  view.file = new globalThis.__TPSHealthTestTFile(path);
  view.editor = {
    getValue: () => editorContent,
    cm,
    setValue: () => assert.fail("CM6 dispatch should synchronize before generic setValue"),
    lastLine: () => editorContent.split("\n").length - 1,
    getLine: (line) => editorContent.split("\n")[line] || "",
    replaceRange: (content) => { editorContent = content; },
  };
  view.setViewData = () => assert.fail("source-mode synchronization must update the CodeMirror buffer before setViewData");
  fake.app.workspace.iterateAllLeaves = (callback) => callback({ view });

  const source = { filePath: path, lineNumber: 6, line: originalLine };
  await plugin.addSeededWorkoutSetAfterBlock(source);
  assert.equal((editorContent.match(/\[type:: workoutSet\]/g) || []).length, 2);
  assert.equal((fake.files.get(path).match(/\[type:: workoutSet\]/g) || []).length, 2);
  assert.match(editorContent, /\[setId:: set-buffer-original\]/);

  editorContent = "---\nkind: workout\n";
  cm.state.doc = editorDoc();
  await plugin.addSetForExerciseToWorkoutFile(path, "Cable row", undefined, { focusAfter: false });
  assert.equal((editorContent.match(/\[type:: workoutSet\]/g) || []).length, 3, "incomplete editor frontmatter should fall back to complete disk content");
  assert.equal((fake.files.get(path).match(/\[type:: workoutSet\]/g) || []).length, 3);
  assert.match(editorContent, /^---[\s\S]+\n---\n/);

  editorContent = initial;
  cm.state.doc = editorDoc();
  await plugin.addSetForExerciseToWorkoutFile(path, "Bench press", undefined, { focusAfter: false });
  assert.equal((editorContent.match(/\[type:: workoutSet\]/g) || []).length, 4, "stale editor should merge all disk sets before append");
  assert.equal((fake.files.get(path).match(/\[type:: workoutSet\]/g) || []).length, 4);
  assert.match(editorContent, /\[exercise:: Bench press\]/);

  await plugin.updateWorkoutSetLine(source, {
    exercise: "Squat",
    reps: 5,
    weight: 225,
    weightUnit: "lb",
    restSeconds: 90,
  });
  assert.equal((editorContent.match(/\[type:: workoutSet\]/g) || []).length, 4);
  assert.equal((fake.files.get(path).match(/\[type:: workoutSet\]/g) || []).length, 4);

  await fake.app.vault.modify(view.file, editorContent);
  assert.equal((fake.files.get(path).match(/\[type:: workoutSet\]/g) || []).length, 4);
});

test("workout row controls link adjacent exercises and sets while starting inline rest", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    workoutIdentificationMode: "metadata-folder-tag",
    defaultRestSeconds: 90,
  };
  const path = "Health/Workouts/Adjacent Link QA.md";
  fake.files.set(path, [
    "---",
    "kind: workout",
    "status: active",
    "---",
    "## Sets",
    "### Bench press",
    "- [ ] Bench press - 185 lb x 8 [setId:: set-b1] [exercise:: Bench press] [reps:: 8] [weight:: 185] [unit:: lb]",
    "- [ ] Bench press - 185 lb x 8 [setId:: set-b2] [exercise:: Bench press] [reps:: 8] [weight:: 185] [unit:: lb]",
    "### Chest-supported row",
    "- [ ] Chest-supported row - 100 lb x 10 [setId:: set-r1] [exercise:: Chest-supported row] [reps:: 10] [weight:: 100] [unit:: lb]",
    "- [ ] Chest-supported row - 90 lb x 12 [setId:: set-r2] [exercise:: Chest-supported row] [reps:: 12] [weight:: 90] [unit:: lb]",
    "",
  ].join("\n"));

  await plugin.linkWorkoutExerciseWithPrevious({
    filePath: path,
    lineNumber: 9,
    line: "- [ ] Chest-supported row - 100 lb x 10 [setId:: set-r1] [exercise:: Chest-supported row]",
  });
  let content = fake.files.get(path);
  assert.equal((content.match(/\[superset:: A\]/g) || []).length, 4);

  await plugin.linkWorkoutSetWithPreviousDropSet({
    filePath: path,
    lineNumber: 10,
    line: "- [ ] Chest-supported row - 90 lb x 12 [setId:: set-r2] [exercise:: Chest-supported row]",
  });
  content = fake.files.get(path);
  assert.equal((content.match(/\[dropSet:: A\]/g) || []).length, 2);
  assert.match(content.split("\n")[10], /\[setType:: drop\]/);

  await plugin.updateWorkoutSetLine({
    filePath: path,
    lineNumber: 10,
    line: content.split("\n")[10],
  }, {
    exercise: "Chest-supported row",
    reps: 12,
    weight: 90,
    weightUnit: "lb",
    restSeconds: 75,
    performed: true,
  });
  content = fake.files.get(path);
  const performedLine = content.split("\n").find((line) => line.includes("[setId:: set-r2]")) || "";
  assert.match(performedLine, /- Chest-supported row - 90 lb x 12/);
  assert.doesNotMatch(performedLine, /- \[[ xX]\]/);
  assert.match(performedLine, /\[type:: workoutSet\]/);
  assert.match(performedLine, /\[completedDate:: .+?\]/);
  assert.match(performedLine, /\[endedAt:: .+?\]/);
  assert.match(performedLine, /\[rest:: 75\]/);
  assert.match(performedLine, /\[restStartedAt:: .+?\]/);
});

test("active workout can log five exercises with superset and dropset groups", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    workoutsFolder: "Health/Workouts",
    workoutPlansFolder: "Health/Workout Plans",
    exercisesFolder: "Health/Exercises",
    workoutLogTarget: "session-note",
    activeWorkoutTarget: "session-note",
    workoutSessionBodyMode: "sets-section",
    workoutExerciseLayout: "flat",
    workoutSetNotation: "compact",
    workoutSetStorage: "task",
    appendWorkoutSummaryToDailyNote: false,
    restTimerMode: "count-up",
  };

  await plugin.upsertFoodFromInput({
    name: "TPS Food Not Exercise",
    servingAmount: 1,
    servingUnit: "serving",
    nutrition: { calories: 100, proteinG: 5, carbsG: 10, fatG: 2 },
  });
  fake.files.set("Archive/TPS Archived Exercise.md", [
    "---",
    "kind: exercise",
    "name: TPS Archived Exercise",
    "---",
    "#tps/exercise",
  ].join("\n"));
  assert.deepEqual(await plugin.searchExercises("TPS Food Not Exercise"), []);
  assert.deepEqual(await plugin.searchExercises("TPS Archived Exercise"), []);

  const workoutPath = await plugin.startWorkout({
    title: "Five Exercise QA",
    logTarget: "session-note",
    startedAt: "2026-07-06T12:00:00.000Z",
    openFile: false,
  });

  await plugin.logSet({ exercise: "Squat", reps: 5, weight: 225, weightUnit: "lb", completedDate: "2026-07-06T12:05:00.000Z" });
  await plugin.logSet({ exercise: "Bench press", reps: 8, weight: 185, weightUnit: "lb", supersetGroupId: "A", completedDate: "2026-07-06T12:10:00.000Z" });
  await plugin.logSet({ exercise: "Chest-supported row", reps: 10, weight: 100, weightUnit: "lb", supersetGroupId: "A", completedDate: "2026-07-06T12:12:00.000Z" });
  await plugin.logSet({ exercise: "Lateral raise", reps: 12, weight: 25, weightUnit: "lb", dropSetGroupId: "B", completedDate: "2026-07-06T12:18:00.000Z" });
  await plugin.logSet({ exercise: "Lateral raise", reps: 10, weight: 15, weightUnit: "lb", setType: "drop", dropSetGroupId: "B", completedDate: "2026-07-06T12:19:00.000Z" });
  await plugin.logSet({ exercise: "Plank", durationSeconds: 60, completedDate: "2026-07-06T12:25:00.000Z" });

  const workout = fake.files.get(workoutPath);
  assert.equal(plugin.getActiveWorkoutState().setCount, 6);
  assert.match(workout, /setCount: 6/);
  assert.match(workout, /Bench press\]\] - superset A - 185 lb x 8/);
  assert.match(workout, /Chest-supported row\]\] - superset A - 100 lb x 10/);
  assert.match(workout, /Lateral raise\]\] - drop B - 25 lb x 12/);
  assert.match(workout, /Lateral raise\]\] - drop - 15 lb x 10/);
  assert.equal((workout.match(/\[superset:: A\]/g) || []).length, 2);
  assert.equal((workout.match(/\[dropSet:: B\]/g) || []).length, 2);
  assert.equal((workout.match(/\[setId::/g) || []).length, 6);
  assert.deepEqual(await plugin.getActiveWorkoutExerciseNames(), [
    "Plank",
    "Lateral raise",
    "Chest-supported row",
    "Bench press",
    "Squat",
  ]);
});

test("exercise and workout-plan searches preserve legacy order, counters, and one metadata lookup per file", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    exercisesFolder: "Health/Exercises",
    workoutPlansFolder: "Health/Workout Plans",
    enableLogging: true,
  };

  const TFile = globalThis.__TPSHealthTestTFile;
  const exerciseResult = (path, name, overrides = {}) => ({
    id: path, name, sourcePath: path, category: "strength",
    primaryMuscles: [], secondaryMuscles: [], equipment: [],
    defaultRestSeconds: undefined, defaultSetType: "normal", recommendedRestDays: undefined,
    ...overrides,
  });
  const workoutPlanResult = (path, name, overrides = {}) => ({
    id: path, name, sourcePath: path,
    workflowKind: "workflow", workflowType: "workout", recurrenceMode: "completion-triggered",
    cooldownDays: undefined, targetGapDays: undefined, defaultRestSeconds: undefined,
    lastCompletedDate: undefined, nextEligibleDate: undefined, notes: undefined,
    ...overrides,
  });
  const scenarios = [
    {
      query: "nEeDlE",
      logMessage: "[TPS Health] [Exercise] search:done",
      stats: { scanned: 8, archived: 1, foodLike: 1, recognized: 5, queryMiss: 1, returned: 4 },
      search: (query) => plugin.searchExercises(query),
      cases: [
        { path: "Health/Exercises/Zulu Needle.md", cache: { frontmatter: { name: "Zulu Needle", category: "cardio", primaryMuscles: ["heart"], defaultRestSeconds: 12 } }, expected: exerciseResult("Health/Exercises/Zulu Needle.md", "Zulu Needle", { category: "cardio", primaryMuscles: ["heart"], defaultRestSeconds: 12 }) },
        { path: "Elsewhere/Type Needle.md", cache: { frontmatter: { name: "Type Needle", tpsType: "health-exercise", equipment: ["band"] } }, expected: exerciseResult("Elsewhere/Type Needle.md", "Type Needle", { equipment: ["band"] }) },
        { path: "Elsewhere/Tagged Needle.md", cache: { frontmatter: { name: "Tagged Needle", recommendedRestDays: 2 }, tags: [{ tag: plugin.settings.exerciseTag }] }, expected: exerciseResult("Elsewhere/Tagged Needle.md", "Tagged Needle", { recommendedRestDays: 2 }) },
        { path: "Elsewhere/Kind Needle.md", cache: { frontmatter: { name: "Kind Needle", kind: "exercise", defaultSetType: "warmup" } }, expected: exerciseResult("Elsewhere/Kind Needle.md", "Kind Needle", { defaultSetType: "warmup" }) },
        { path: "Elsewhere/Exercise Miss.md", cache: { frontmatter: { name: "No Match", kind: "exercise" } } },
        { path: "Health/Exercises/Food Needle.md", cache: { frontmatter: { name: "Food Needle", kind: "food" } } },
        { path: "Archive/Exercise Needle.md", cache: { frontmatter: { name: "Archived Needle", kind: "exercise" } } },
        { path: "Elsewhere/Unrecognized Needle.md", cache: { frontmatter: { name: "Unrecognized Needle" } } },
      ],
    },
    {
      query: "NeEdLe",
      logMessage: "[TPS Health] [WorkoutPlan] search:done",
      stats: { scanned: 6, recognized: 5, queryMiss: 1, returned: 4 },
      search: (query) => plugin.searchWorkoutPlans(query),
      cases: [
        { path: "Health/Workout Plans/Zulu Needle Plan.md", cache: { frontmatter: { title: "Zulu Needle Plan", cooldownDays: 3 } }, expected: workoutPlanResult("Health/Workout Plans/Zulu Needle Plan.md", "Zulu Needle Plan", { cooldownDays: 3 }) },
        { path: "Elsewhere/Routine Needle.md", cache: { frontmatter: { name: "Routine Needle", tpsType: "health-routine", targetGapDays: 4 } }, expected: workoutPlanResult("Elsewhere/Routine Needle.md", "Routine Needle", { targetGapDays: 4 }) },
        { path: "Elsewhere/Type Needle Plan.md", cache: { frontmatter: { name: "Type Needle Plan", tpsType: "health-workout-plan", defaultRestSeconds: 90 } }, expected: workoutPlanResult("Elsewhere/Type Needle Plan.md", "Type Needle Plan", { defaultRestSeconds: 90 }) },
        { path: "Elsewhere/Kind Needle Plan.md", cache: { frontmatter: { name: "Kind Needle Plan", kind: "workout-plan", notes: "Keep order" } }, expected: workoutPlanResult("Elsewhere/Kind Needle Plan.md", "Kind Needle Plan", { notes: "Keep order" }) },
        { path: "Elsewhere/Workout Miss.md", cache: { frontmatter: { name: "No Match", kind: "workout-plan" } } },
        { path: "Elsewhere/Unrecognized Needle Plan.md", cache: { frontmatter: { name: "Unrecognized Needle Plan" } } },
      ],
    },
  ];
  const installScenario = (scenario) => {
    const files = scenario.cases.map(({ path }) => new TFile(path));
    const caches = new Map(scenario.cases.map(({ path, cache }) => [path, cache]));
    const lookups = [];
    fake.app.vault.getMarkdownFiles = () => files;
    fake.app.metadataCache.getFileCache = (file) => {
      lookups.push(file.path);
      return caches.get(file.path);
    };
    return { files, lookups };
  };

  const originalConsoleLog = console.log;
  const logCalls = [];
  console.log = (...args) => logCalls.push(args);
  try {
    await plugin.saveSettings();
    logCalls.length = 0;
    for (const scenario of scenarios) {
      const { files, lookups } = installScenario(scenario);
      const results = await scenario.search(scenario.query);
      assert.deepEqual(results, scenario.cases.flatMap(({ expected }) => expected ? [expected] : []));
      assert.deepEqual(lookups, files.map((file) => file.path));
      const logCall = logCalls.find(([message]) => message === scenario.logMessage);
      assert.deepEqual(logCall?.[1], { query: scenario.query, ...scenario.stats });
    }
  } finally {
    plugin.settings.enableLogging = false;
    await plugin.saveSettings();
    console.log = originalConsoleLog;
  }

  const exerciseMethod = mainSource.slice(
    mainSource.indexOf("async searchExercises"),
    mainSource.indexOf("async getActiveWorkoutExerciseNames"),
  );
  const workoutPlanMethod = mainSource.slice(
    mainSource.indexOf("async searchWorkoutPlans"),
    mainSource.indexOf("async createWorkoutPlan"),
  );
  assert.match(exerciseMethod, /for \(const file of files\)/);
  assert.match(workoutPlanMethod, /for \(const file of files\)/);
  assert.doesNotMatch(exerciseMethod, /\.map\(\(file\) => \(\{ file, cache:/);
  assert.doesNotMatch(workoutPlanMethod, /\.map\(\(file\) => \(\{ file, cache:/);
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

test("sugar alcohol calories subtract polyols from regular carb calories", () => {
  assert.equal(caloriesFromMacros({ carbsG: 100, sugarAlcoholG: 100, sugarAlcoholCaloriesPerG: 0 }), 0);
  assert.equal(caloriesFromMacros({ carbsG: 20, sugarAlcoholG: 10, sugarAlcoholCaloriesPerG: 2 }), 60);
  assert.match(mainSource, /foodFactsServingValue\(nutrients, "polyols"/);
  assert.match(mainSource, /foodFactsLooksLikePureSugarAlcohol\(product\)/);
  assert.match(mainSource, /if \(\/\\berythritol\\b\/\.test\(text\)\) return 0;/);
});

test("food log unit options are scoped to the food serving type", async () => {
  const mainSource = await import("node:fs/promises").then((fs) => fs.readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"));
  assert.match(mainSource, /function foodLogUnitOptions\(item: FoodItem\): string\[\]/);
  assert.match(mainSource, /if \(metricServing\?\.unit === "ml"\)/);
  assert.match(mainSource, /for \(const unit of \["cup", "ml", "fl oz"\]\) units\.add\(unit\)/);
  assert.match(mainSource, /for \(const unit of \["g", "oz"\]\) units\.add\(unit\)/);
  assert.match(mainSource, /if \(directMetric\.unit === metricServing\.unit\)/);
  assert.match(mainSource, /return unsupportedFoodLogServing\(inputQuantity, inputUnit, directMetric\)/);
  assert.match(mainSource, /function unsupportedFoodLogServing\(inputQuantity: number, inputUnit: string, amount\?: \{ amount: number; unit: "g" \| "ml" \}\): ResolvedFoodLogServing/);
  assert.match(mainSource, /function isFoodLogUnitSupported\(item: FoodItem, unit: string\): boolean/);
  assert.match(mainSource, /unsupportedUnit: true/);
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
  assert.match(mainSource, /private openFoodSearchModal\(initialDraft: InlineFoodDraft \| null, dateContext: FoodLogDateContext \| null, initialTab\?: FoodLogTab\): void/);
  assert.match(mainSource, /logger\.flow\("FoodDateContext", "open-food-logger:provided"/);
  assert.match(mainSource, /logger\.flow\("FoodDateContext", "scan-barcode:active-file"/);
  assert.match(mainSource, /private async summarizeDailyNoteDateContext\(file: TFile \| null \| undefined, dateContext: FoodLogDateContext \| null\): Promise<Record<string, unknown>>/);
  assert.match(mainSource, /formatSource = "daily-notes-plugin"/);
  assert.match(mainSource, /folderSource = "daily-notes-plugin"/);
  assert.match(mainSource, /formatSource = "daily-notes-config"/);
  assert.match(mainSource, /folderSource = "daily-notes-config"/);
  assert.match(mainSource, /logger\.flowWarn\("DailyNote", "settings:plugin-read-failed", \{ error: logger\.errorSummary\(error\) \}\)/);
  assert.match(mainSource, /logger\.flow\("DailyNote", "settings:config-read-failed", \{ error: logger\.errorSummary\(error\) \}\)/);
  assert.match(mainSource, /logger\.flow\("DailyNote", "settings:resolved", \{ \.\.\.resolved, formatSource, folderSource \}\)/);
  assert.match(mainSource, /reason: "folder-mismatch"/);
  assert.match(mainSource, /reason: "date-format-mismatch"/);
  assert.match(mainSource, /logger\.flowWarn\("GCM", "food-log-action:fallback-not-daily-note"/);
  assert.match(mainSource, /logger\.flow\("GCM", "food-log-action:visibility"/);
  assert.match(mainSource, /candidates: candidates\.length/);
  assert.match(mainSource, /private registerGcmFoodLogButtonTapFallback\(\): void/);
  assert.match(mainSource, /document\.addEventListener\("pointerdown", handler, \{ capture: true \}\)/);
  assert.match(mainSource, /target\?\.closest<HTMLElement>\('\[data-tps-gcm-external-action-id="tps-health:food-log"\]'\)/);
  assert.doesNotMatch(mainSource, /button\[aria-label="Log food"\]/);
  assert.doesNotMatch(mainSource, /button\[title="Log food"\]/);
  assert.match(mainSource, /const providerQuery = foodSearchCorrectedQuery\(normalized\) \|\| normalized/);
  assert.match(mainSource, /const primary = await this\.searchOpenFoodFactsRoute\(providerQuery, "search"/);
  assert.match(mainSource, /const fallback = primary\.items\.length\s+\? null\s+: await this\.searchOpenFoodFactsRoute\(providerQuery, "legacy"/);
  assert.doesNotMatch(mainSource.slice(
    mainSource.indexOf("private async searchOpenFoodFacts(query: string)"),
    mainSource.indexOf("private async searchOpenFoodFactsRoute"),
  ), /foodSearchQueryVariants/);
  assert.match(mainSource, /private async searchOpenFoodFactsRoute\(\s+query: string,\s+route: "search" \| "legacy"/);
  assert.match(mainSource, /open-food-facts:\$\{route\}:failed/);
  assert.match(mainSource, /const FOOD_SEARCH_TOKEN_CORRECTIONS: Record<string, string> = \{/);
  assert.match(mainSource, /carmel: "caramel"/);
  assert.match(mainSource, /caramal: "caramel"/);
  assert.match(mainSource, /mozarella: "mozzarella"/);
  assert.match(mainSource, /const FOOD_SEARCH_CONNECTOR_WORDS = new Set\(\["an", "and", "by", "of", "or", "the", "with"\]\)/);
  assert.match(mainSource, /!FOOD_SEARCH_CONNECTOR_WORDS\.has\(token\)/);
  assert.match(mainSource, /\.replace\(\/&\/g, " and "\)/);
  assert.match(mainSource, /function foodSearchCorrectedQuery\(normalizedQuery: string\): string/);
  assert.match(mainSource, /foodSearchTokenVariants\(token\)/);
  assert.match(mainSource, /function foodSearchHasFuzzyTokenMatch\(queryToken: string, haystackTokens: Set<string>\): boolean/);
  assert.match(mainSource, /function foodSearchEditDistance\(left: string, right: string, maxDistance: number\): number/);
  assert.match(mainSource, /variants\.add\("quest protein chips nacho cheese"\)/);
  assert.match(mainSource, /tokens\.every\(\(token\) => foodSearchTokenVariants\(token\)/);
  assert.match(mainSource, /aliases: aliasesFromFrontmatter\(fm\.aliases\)/);
  assert.match(mainSource, /aliases: foodAliasesForItem\(item\)\.length \? foodAliasesForItem\(item\) : undefined/);
  assert.match(mainSource, /function aliasesFromFrontmatter\(value: unknown\): string\[\] \| undefined/);
  assert.match(mainSource, /function inferredFoodAliases\(item: FoodItem\): string\[\]/);
  assert.match(mainSource, /aliases\.add\(`\$\{first\} cereal`\)/);
  assert.match(mainSource, /function foodSearchFields\(item: FoodItem\): Array<unknown>/);
  assert.match(mainSource, /function foodFactsProductSearchFields\(product: any\): Array<unknown>/);
  assert.match(mainSource, /function foodFactsProductAliases\(product: any\): string\[\] \| undefined/);
  assert.match(mainSource, /replace\(\/\\bsugar\[\\s-\]\*free\\b\/g, "sugar free"\)/);
  assert.match(mainSource, /isRelevantFoodResult\(query, \[item\.name, item\.brand, item\.aliases\?\.join\(" "\)\]\)/);
  assert.match(mainSource, /isRelevantFoodResult\(query, foodSearchFields\(item\)\)/);
  assert.match(mainSource, /name: "Egg, whole, cooked", aliases: \["eggs"\], servingUnit: "egg", servingGrams: 50/);
  assert.match(mainSource, /name: "Mozzarella cheese, whole milk", aliases: \["mozarella", "mozzarella", "mozzarella cheese", "whole milk mozzarella"\]/);
  assert.match(mainSource, /name: "Mozzarella cheese, part skim"/);
  assert.match(mainSource, /name: "Mozzarella string cheese"/);
  assert.match(mainSource, /name: "Great Value Shredded Hash Browns", brand: "Great Value"/);
  assert.match(mainSource, /aliases: \["great value hash brown potatoes", "great value hash browns", "great value shredded hash brown potatoes", "walmart hash browns", "hash brown potatoes"\]/);
  assert.match(mainSource, /const scoreQueryVariants = correctedQuery && correctedQuery !== normalizedQuery/);
  assert.match(mainSource, /if \(item\.source === "curated"\) score \+= 80/);
  assert.match(mainSource, /if \(item\.source === "usda" && !item\.brand\) score \+= 18/);
  assert.match(mainSource, /if \(item\.source === "custom-note"\) score \+= 45/);
  assert.match(mainSource, /if \(usage\.count\) score \+= 90 \+ Math\.min\(usage\.count, 10\) \* 10/);
  assert.match(mainSource, /logger\.flowWarn\("FoodSearch", "usage-read:failed", \{ path: file\.path, error: logger\.errorSummary\(error\) \}\)/);
  assert.match(mainSource, /logger\.flow\("FoodSearch", "usage:done", \{[\s\S]+files: built\.files,[\s\S]+usageKeys: built\.stats\.size,[\s\S]+cached:/);
  assert.match(mainSource, /if \(item\.source === "open-food-facts"\) score \+= tokens\.length > 1 \? 8 : -18/);
  assert.match(mainSource, /if \(item\.source === "usda" && item\.brand\) score -= 24/);
  assert.match(mainSource, /tokens\.length === 1 && item\.source === "open-food-facts" && !usage\.count/);
  assert.match(mainSource, /function isUnloggedBroadExternalFoodResult\(item: FoodItem, tokens: string\[\], usageStats: Map<string, FoodUsageStats>\): boolean/);
  assert.match(mainSource, /item\.source !== "open-food-facts" && !\(item\.source === "usda" && item\.brand\)/);
  assert.doesNotMatch(mainSource, /item\.source === "open-food-facts" && !metricServingForFood\(item\)\) return true/);
  assert.match(mainSource, /function foodSearchTrustedSingleTokenExternalMatch\(item: FoodItem, token: string\): boolean/);
  assert.match(mainSource, /COMMON_FOOD_BRANDS\.has\(variant\) && normalizedBrand\.includes\(variant\)/);
  assert.match(mainSource, /const FOOD_SEARCH_GENERIC_SINGLE_TOKEN_QUERIES = new Set/);
  assert.match(mainSource, /\.filter\(\(item\) => !isUnloggedBroadExternalFoodResult\(item, tokens, usageStats\)\)/);
  assert.match(mainSource, /if \(!hasSearchableMacroData\(item\.nutrition\)\) \{/);
  assert.match(mainSource, /logger\.flowWarn\("Barcode", "lookup-candidate:no-macros"/);
  assert.match(mainSource, /aliases: \["quest protein chips", "quest chips", "protein chips", "protein doritos", "doritos protein chips", "nacho protein chips"\]/);
  assert.match(mainSource, /Quest Tortilla Style Protein Chips, Nacho Cheese/);
  assert.match(mainSource, /name: "Hawaiian sweet roll", aliases: \["hawaiian roll", "hawaiian rolls", "sweet roll", "dinner roll"\]/);

  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    includeBrandedFoodSearch: false,
  };
  const greatValueResults = await plugin.searchFoods("great value hash brown potatoes");
  assert.equal(greatValueResults[0]?.name, "Great Value Shredded Hash Browns");
  assert.equal(greatValueResults[0]?.servingGrams, 85);
  assert.deepEqual(greatValueResults[0]?.nutrition, { calories: 70, proteinG: 1, carbsG: 17, fatG: 0 });
  const hashBrownResults = await plugin.searchFoods("hash browns");
  assert.ok(hashBrownResults.some((item) => item.name === "Great Value Shredded Hash Browns"));
  for (const [query, expected] of [
    ["kraft mac and cheese", "Kraft Original Macaroni & Cheese Dinner"],
    ["hidden valley ranch", "Hidden Valley Original Ranch Dressing"],
    ["tyson chicken nuggets", "Tyson White Meat Chicken Nuggets"],
    ["pepperidge farm goldfish", "Pepperidge Farm Goldfish Cheddar Crackers"],
    ["nature valley granola bar", "Nature Valley Crunchy Oats 'n Honey Granola Bars"],
    ["sugarfree jolly ranchers", "Jolly Rancher Sugar Free Hard Candy"],
  ]) {
    const results = await plugin.searchFoods(query);
    assert.equal(results[0]?.name, expected, query);
    assert.ok(results[0]?.nutrition?.calories > 0, query);
  }
});

test("food logging can write dashboard-launched daily-note entries without focusing the daily note", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    dailyNoteFolder: "Daily",
    dailyNoteFormat: "YYYY-MM-DD",
    workoutsFolder: "Health/Workouts",
    workoutPlansFolder: "Health/Workout Plans",
    exercisesFolder: "Health/Exercises",
    foodsFolder: "Health/Foods",
    recipesFolder: "Health/Recipes",
    workoutTemplatePath: "Templates/Workout.md",
    workoutPlanTemplatePath: "Templates/Workout Plan.md",
    exerciseTemplatePath: "Templates/Exercise.md",
    foodTemplatePath: "Templates/Food.md",
    workoutTag: "#tps/workout",
    workoutPlanTag: "#tps/workout-plan",
    exerciseTag: "#tps/exercise",
    customFoodTag: "#tps/food",
    recipeTag: "#tps/recipe",
    defaultFoodLogSection: "",
    foodLogFilePath: "Health/Food Log.md",
    foodLogTarget: "daily-note",
    automaticDailyRollups: false,
    rollupHeading: "Health Rollup",
    calorieGoal: 2200,
    proteinGoalG: 180,
    activityGoalMinutes: 45,
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

  const entry = await plugin.logFood(
    {
      id: "dashboard-yogurt",
      name: "Dashboard Yogurt",
      source: "custom-inline",
      nutrition: { calories: 120, proteinG: 15, carbsG: 9, fatG: 2 },
    },
    1,
    "serving",
    undefined,
    "2026-07-04T09:30:00.000Z",
    false,
    "daily-note",
    { focusAfterLog: false },
  );

  assert.equal(entry.dailyNotePath, "Daily/2026-07-04.md");
  assert.match(fake.files.get("Daily/2026-07-04.md"), /- 1 serving - Dashboard Yogurt/);
  assert.match(fake.files.get("Daily/2026-07-04.md"), /\[foodId:: food-/);
  assert.deepEqual(fake.openedFiles, [], "dashboard logging must not open or focus the target daily note");
});

test("food log entry consumed date edits move daily-note lines and refresh both rollups", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  plugin.settings = {
    ...plugin.settings,
    dailyNoteFolder: "Daily",
    dailyNoteFormat: "YYYY-MM-DD",
    foodLogTarget: "daily-note",
    defaultFoodLogSection: "",
    automaticDailyRollups: true,
    healthGoals: [
      { propertyKey: "consumedCalories", label: "Consumed calories", unit: "kcal", kind: "max", max: 2400, color: "" },
      { propertyKey: "protein", label: "Protein", unit: "g", kind: "min", min: 120, color: "" },
    ],
  };

  await plugin.logFood(
    {
      id: "date-yogurt",
      name: "Date Yogurt",
      source: "custom-inline",
      nutrition: { calories: 100, proteinG: 10, carbsG: 12, fatG: 2 },
    },
    1,
    "serving",
    undefined,
    "2026-07-04T08:00:00.000Z",
    false,
    "daily-note",
    { focusAfterLog: false },
  );

  const oldPath = "Daily/2026-07-04.md";
  const oldFile = fake.app.vault.getAbstractFileByPath(oldPath);
  const oldLines = fake.files.get(oldPath).split("\n");
  const lineNumber = oldLines.findIndex((line) => line.includes("Date Yogurt"));
  assert.ok(lineNumber >= 0, "expected logged food line in original daily note");

  await plugin.updateFoodLogEntryConsumedDate({
    file: oldFile,
    lineNumber,
    line: oldLines[lineNumber],
    id: `${oldPath}:${lineNumber}`,
    name: "Date Yogurt",
    serving: "1 serving",
    source: oldPath,
    foodPath: "",
    dateKey: "2026-07-04",
    dateLabel: "Sat, Jul 4 2026",
    nutrition: { calories: 100, proteinG: 10, carbsG: 12, fatG: 2, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 0 },
  }, "2026-07-05T09:30");

  const newPath = "Daily/2026-07-05.md";
  assert.doesNotMatch(fake.files.get(oldPath), /Date Yogurt/);
  assert.match(fake.files.get(newPath), /Date Yogurt/);
  assert.match(fake.files.get(newPath), /\[completedDate:: 2026-07-05T/);
  assert.match(fake.files.get(newPath), /\[dailyNotePath:: Daily\/2026-07-05\.md\]/);
  assert.equal(parseFrontmatter(fake.files.get(oldPath)).consumedCalories, 0);
  assert.equal(parseFrontmatter(fake.files.get(newPath)).consumedCalories, 100);
  assert.equal(parseFrontmatter(fake.files.get(newPath)).protein, 10);
});

test("workout cooldown date math writes the next eligible date", () => {
  assert.equal(addDaysIsoDate("2026-06-03T17:30:00.000Z", 3), "2026-06-06");
  assert.equal(addDaysIsoDate("2026-06-03T17:30:00.000Z", 0), "2026-06-03");
});

test("workout finish hands GCM an absolute Date instead of a schedule-parsed ISO string", async () => {
  installDeterministicBrowserGlobals();
  const { default: TPSHealthPlugin } = await importPluginWithObsidianStub();
  const fake = createFakeHealthApp();
  const plugin = new TPSHealthPlugin(fake.app);
  const path = "Health/Workouts/Timer Date QA.md";
  fake.files.set(path, "---\nkind: workout\n---\n");
  const file = fake.app.vault.getAbstractFileByPath(path);
  let receivedEnd = null;
  plugin.getGcmApi = () => ({
    timeTracking: {
      stopActiveTimerForFile: async (_file, end) => { receivedEnd = end; },
    },
  });

  await plugin.stopGcmWorkoutTimer(file, "2026-07-09T22:58:57.086Z");

  assert.ok(receivedEnd instanceof Date);
  assert.equal(receivedEnd.toISOString(), "2026-07-09T22:58:57.086Z");
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
  });
  assert.match(taskLine, /^- Squat - 5/);
  assert.doesNotMatch(taskLine, /^- \[[ xX]\]/);
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
  }, { notation: "compact" });
  assert.match(compactLine, /^- Bench Press - drop - superset A - 225 lb x 15/);
  assert.match(compactLine, /\[type:: workoutSet\]/);
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
  assert.match(line, /\[workoutDate:: 2026-06-03\]/);
  assert.match(line, /\[startedAt:: 2026-06-03T17:30:00.000Z\]/);
  assert.match(line, /\[status:: active\]/);
  assert.match(line, /\[cooldownDays:: 3\]/);
  assert.match(line, /\[runKind:: run\]/);
  assert.match(line, /\[runType:: workout\]/);
  assert.match(line, /\[workflowType:: workout\]/);
  assert.match(line, /\[recurrenceMode:: completion-triggered\]/);
  assert.match(line, /\[workflowPath:: Health\/Workout Plans\/Push Day\.md\]/);
  assert.match(line, /\[workflowName:: Push Day\]/);
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
  const totals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 0 };
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
    totals.sugarAlcoholG += resolved.sugarAlcoholG;
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
  return ["cal", "protein", "carbs", "fat", "fiber", "sugar", "sugarAlcohol", "alcohol", "sodium"].some((key) => readNumber(line, key) != null);
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
    sugarAlcoholG: readNumber(line, "sugarAlcohol") || 0,
    sugarAlcoholCaloriesPerG: 0,
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
    sugarAlcoholG: readNumber(line, "sugarAlcohol") ?? base.sugarAlcoholG,
    sugarAlcoholCaloriesPerG: base.sugarAlcoholCaloriesPerG || 0,
    alcoholG: readNumber(line, "alcohol") ?? base.alcoholG,
    sodiumMg: readNumber(line, "sodium") ?? base.sodiumMg,
  };
}

function zeroNutrition() {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 0 };
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
    ["sugarAlcoholG", "sugarAlcoholG"],
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
    sugarAlcoholG: (nutrition.sugarAlcoholG || 0) * multiplier,
    sugarAlcoholCaloriesPerG: nutrition.sugarAlcoholCaloriesPerG || 0,
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
  for (const candidate of nutritionFieldAliases(key)) {
    const dataviewMatch = line.match(new RegExp(`\\[${candidate}::\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    if (dataviewMatch) return Number(dataviewMatch[1]);
    const match = line.match(new RegExp(`${candidate}=(-?\\d+(?:\\.\\d+)?)`, "i"));
    if (match) return Number(match[1]);
  }
  return undefined;
}

function nutritionFieldAliases(key) {
  if (key === "sugarAlcohol") return ["sugarAlcohol", "sugarAlcohols", "polyol", "polyols"];
  return [key];
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
  if (normalized === "sugaralcohol" || normalized === "sugaralcohols" || normalized === "polyol" || normalized === "polyols") return "sugarAlcohol";
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
    sugarAlcoholG: String(nutrition.sugarAlcoholG || 0),
    alcoholG: String(nutrition.alcoholG || 0),
    sodiumMg: String(nutrition.sodiumMg || 0),
  };
  return Object.entries(replacements).reduce((output, [key, value]) => output.split(`{{${key}}}`).join(value), template);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function caloriesFromMacros(nutrition) {
  const sugarAlcoholG = Math.max(0, nutrition.sugarAlcoholG || 0);
  const regularCarbsG = Math.max(0, (nutrition.carbsG || 0) - sugarAlcoholG);
  return round(
    (nutrition.proteinG || 0) * 4
    + regularCarbsG * 4
    + sugarAlcoholG * sugarAlcoholCaloriesPerGram(nutrition)
    + (nutrition.fatG || 0) * 9
    + (nutrition.alcoholG || 0) * 7
  );
}

function sugarAlcoholCaloriesPerGram(nutrition) {
  const explicit = Number(nutrition.sugarAlcoholCaloriesPerG);
  return Number.isFinite(explicit) ? explicit : 2;
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
    dataviewField("type", "workoutSet"),
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
    set.restStartedAt ? dataviewField("restStartedAt", set.restStartedAt) : "",
    set.dropSetGroupId ? dataviewField("dropSet", set.dropSetGroupId) : "",
    set.supersetGroupId ? dataviewField("superset", set.supersetGroupId) : "",
    set.note ? dataviewField("note", set.note) : "",
  ].filter(Boolean);
  return `- ${summary} ${fields.join(" ")}`;
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
    dataviewField("runKind", "run"),
    dataviewField("runType", "workout"),
    dataviewField("workflowType", "workout"),
    dataviewField("recurrenceMode", "completion-triggered"),
    input.plan?.sourcePath ? dataviewField("workflowPath", input.plan.sourcePath) : "",
    input.plan?.name ? dataviewField("workflowName", input.plan.name) : "",
    dataviewField("createdDate", input.startedAt),
    dataviewField("workoutDate", input.startedAt.slice(0, 10)),
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
