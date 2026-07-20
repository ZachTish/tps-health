import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const GATEWAY_REQUEST = "tps:ai-gateway-api-request";
const GATEWAY_AVAILABLE = "tps:ai-gateway-api-available";
const GATEWAY_UNAVAILABLE = "tps:ai-gateway-api-unavailable";
const HEALTH_UI_REQUEST = "tps:health-ui-api-request";
const HEALTH_UI_AVAILABLE = "tps:health-ui-api-available";
const HEALTH_UI_UNAVAILABLE = "tps:health-ui-api-unavailable";

class FakeEvents {
  listeners = new Map();
  gatewayRequestCount = 0;

  on(name, callback) {
    const ref = { source: this, name, callback };
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(ref);
    this.listeners.set(name, listeners);
    return ref;
  }

  offref(ref) {
    this.listeners.get(ref.name)?.delete(ref);
  }

  trigger(name, ...args) {
    if (name === GATEWAY_REQUEST) this.gatewayRequestCount += 1;
    for (const ref of Array.from(this.listeners.get(name) || [])) ref.callback(...args);
  }

  listenerCount(name) {
    return this.listeners.get(name)?.size || 0;
  }
}

class FakeWorkspace extends FakeEvents {
  layoutCallbacks = [];
  activeViewLookupCount = 0;

  onLayoutReady(callback) {
    this.layoutCallbacks.push(callback);
  }

  getActiveFile() {
    return null;
  }

  getActiveViewOfType() {
    this.activeViewLookupCount += 1;
    return null;
  }

  iterateAllLeaves() {}

  getLeavesOfType() {
    return [];
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;
const originalHealthTestMenus = globalThis.__healthTestMenus;
const originalHealthTestOpenedModals = globalThis.__healthTestOpenedModals;
const originalHealthTestModalOpenHook = globalThis.__healthTestModalOpenHook;
const originalHealthTestNotices = globalThis.__healthTestNotices;
const originalHealthTestButtons = globalThis.__healthTestButtons;
const originalHealthTestTFile = globalThis.__HealthTestTFile;
let nextTimerId = 1;
function fakeMoment(value) {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : value == null
      ? new Date()
      : /^\d{4}-\d{2}-\d{2}$/.test(String(value))
        ? new Date(`${value}T12:00:00`)
        : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  const api = {
    isValid: () => Number.isFinite(date.getTime()),
    format: (format) => {
      const isoDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return format === "YYYY-MM-DDTHH:mm" ? `${isoDate}T${pad(date.getHours())}:${pad(date.getMinutes())}` : isoDate;
    },
    isSame: (other, unit) => unit === "day" && api.format("YYYY-MM-DD") === fakeMoment(other).format("YYYY-MM-DD"),
    hour: (value) => { if (value === undefined) return date.getHours(); date.setHours(value); return api; },
    minute: (value) => { if (value === undefined) return date.getMinutes(); date.setMinutes(value); return api; },
    second: (value) => { if (value === undefined) return date.getSeconds(); date.setSeconds(value); return api; },
    millisecond: (value) => { if (value === undefined) return date.getMilliseconds(); date.setMilliseconds(value); return api; },
    toISOString: () => date.toISOString(),
  };
  return api;
}
globalThis.__healthTestMenus = [];
globalThis.__healthTestOpenedModals = [];
globalThis.__healthTestModalOpenHook = undefined;
globalThis.__healthTestNotices = [];
globalThis.__healthTestButtons = [];
globalThis.window = {
  setTimeout: () => nextTimerId++,
  clearTimeout: () => undefined,
  setInterval: () => nextTimerId++,
  clearInterval: () => undefined,
  getSelection: () => null,
  moment: fakeMoment,
};
globalThis.document = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  querySelectorAll: () => [],
  querySelector: () => null,
  body: {
    classList: {
      contains: () => false,
      toggle: () => undefined,
    },
  },
};
globalThis.HTMLElement = class HTMLElement {};

const obsidianStub = `
export class TFile {
  constructor(path = "file.md") {
    this.path = path;
    this.basename = path.split("/").pop().replace(/\\.md$/i, "");
    this.extension = path.split(".").pop();
    this.stat = { ctime: 0, mtime: 0, size: 0 };
    this.parent = null;
  }
}
globalThis.__HealthTestTFile = TFile;
export class Plugin {
  constructor(app) {
    this.app = app;
    this.manifest = { id: "tps-health" };
    this.__events = [];
    this.__cleanups = [];
    this.__commands = [];
    this.__settingTabs = [];
  }
  addCommand(command) { this.__commands.push(command); }
  addSettingTab(tab) { this.__settingTabs.push(tab); }
  registerEditorSuggest() {}
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent(ref) { this.__events.push(ref); }
  register(callback) { this.__cleanups.push(callback); }
  registerInterval() {}
  loadData() { return null; }
  saveData() {}
  __testUnload() {
    this.onunload();
    for (const ref of this.__events.splice(0)) ref?.source?.offref?.(ref);
    for (const cleanup of this.__cleanups.splice(0).reverse()) cleanup();
    this.__commands = [];
    this.__settingTabs = [];
  }
}
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.events = new Map();
    this.textContent = options.text || "";
    this.value = options.attr?.value || "";
    this.disabled = false;
    this.readOnly = false;
    this.id = "";
    this.classList = { contains: () => false, toggle: () => undefined };
    if (tag === "button") globalThis.__healthTestButtons.push(this);
  }
  empty() { this.children = []; }
  addClass() { return this; }
  removeClass() { return this; }
  toggleClass() { return this; }
  setText(value) { this.textContent = String(value); return this; }
  setAttr(name, value) { this[name] = value; return this; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  append(value) { this.children.push(value); return this; }
  addEventListener(name, callback) {
    const callbacks = this.events.get(name) || [];
    callbacks.push(callback);
    this.events.set(name, callbacks);
  }
  dispatch(name, event = {}) {
    const safeEvent = {
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    let result;
    for (const callback of this.events.get(name) || []) result = callback(safeEvent);
    return result;
  }
  click(event) { return this.dispatch("click", event); }
  focus() {}
  blur() {}
  closest() { return null; }
  querySelector() { return null; }
}
class FakeButtonComponent {
  constructor() { this.buttonEl = new FakeElement("button"); }
  setButtonText(value) { this.buttonEl.textContent = String(value); return this; }
  setCta() { return this; }
  setWarning() { return this; }
  setDisabled(value) { this.buttonEl.disabled = value; return this; }
  onClick(callback) { this.buttonEl.addEventListener("click", callback); return this; }
}
class FakeTextComponent {
  constructor(tag = "input") { this.inputEl = new FakeElement(tag); }
  setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
  setValue(value) { this.inputEl.value = String(value); return this; }
  onChange(callback) { this.onChangeCallback = callback; return this; }
}
class FakeDropdownComponent {
  constructor() { this.selectEl = new FakeElement("select"); }
  addOption() { return this; }
  addOptions() { return this; }
  setValue(value) { this.selectEl.value = value; return this; }
  onChange(callback) { this.onChangeCallback = callback; return this; }
}
class FakeToggleComponent {
  constructor() { this.toggleEl = new FakeElement("input"); }
  setValue(value) { this.toggleEl.value = value; return this; }
  onChange(callback) { this.onChangeCallback = callback; return this; }
}
export class Modal {
  constructor(app) {
    this.app = app;
    this.__opened = false;
    this.contentEl = new FakeElement("div");
    this.modalEl = new FakeElement("div");
  }
  open() {
    this.__opened = true;
    globalThis.__healthTestOpenedModals.push(this);
    globalThis.__healthTestModalOpenHook?.(this);
  }
  close() { this.__opened = false; }
}
export class Menu {
  constructor() { this.items = []; globalThis.__healthTestMenus.push(this); }
  addItem(callback) {
    const item = {
      title: "",
      icon: "",
      click: undefined,
      setTitle(value) { this.title = value; return this; },
      setIcon(value) { this.icon = value; return this; },
      onClick(value) { this.click = value; return this; },
    };
    callback?.(item);
    this.items.push(item);
    return this;
  }
  showAtPosition(position) { this.position = { ...position }; }
  showAtMouseEvent(event) { this.mouseEvent = event; }
}
export class Notice {
  constructor(message) { globalThis.__healthTestNotices.push(message); }
}
export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; }
  display() {}
}
export class Setting {
  constructor() { this.settingEl = new FakeElement("div"); }
  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addText(callback) { callback?.(new FakeTextComponent()); return this; }
  addTextArea(callback) { callback?.(new FakeTextComponent("textarea")); return this; }
  addDropdown(callback) { callback?.(new FakeDropdownComponent()); return this; }
  addToggle(callback) { callback?.(new FakeToggleComponent()); return this; }
  addButton(callback) { callback?.(new FakeButtonComponent()); return this; }
}
export class SecretComponent {
  setValue() { return this; }
  onChange() { return this; }
}
export class MarkdownView {}
export class MarkdownRenderChild {
  constructor(containerEl) { this.containerEl = containerEl; }
  onload() {}
  onunload() {}
}
export class EditorSuggest { constructor(app) { this.app = app; } }
export class App {}
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
};
export const editorLivePreviewField = {};
export function normalizePath(path) {
  return String(path || "").replace(/\\\\/g, "/").replace(/\\/+/g, "/").replace(/^\\.\\//, "");
}
export function setIcon() {}
export async function requestUrl() { throw new Error("Network access is forbidden in lifecycle tests."); }
`;

const codeMirrorStub = `
export class RangeSetBuilder { add() {} finish() { return {}; } }
export const StateField = { define: (spec) => spec };
export class EditorState {}
export class Decoration {
  static none = {};
  static widget() { return {}; }
  static replace() { return {}; }
}
export class ViewPlugin { static fromClass() { return {}; } }
export class WidgetType {}
export const EditorView = { decorations: { from: () => ({}) } };
export const DecorationSet = {};
export class ViewUpdate {}
`;

const virtualModules = new Map([
  ["obsidian", obsidianStub],
  ["@codemirror/state", codeMirrorStub],
  ["@codemirror/view", codeMirrorStub],
  ["@zxing/browser", "export class BrowserMultiFormatOneDReader {} export class BrowserMultiFormatReader {}"],
  ["@zxing/library", "export const BarcodeFormat = {}; export const DecodeHintType = {};"],
]);

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "health-lifecycle-stubs",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => (
        virtualModules.has(args.path) ? { path: args.path, namespace: "health-lifecycle-stub" } : null
      ));
      buildApi.onLoad({ filter: /.*/, namespace: "health-lifecycle-stub" }, (args) => ({
        contents: virtualModules.get(args.path),
        loader: "js",
      }));
    },
  }],
});
const { default: TPSHealthPlugin } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test.after(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.HTMLElement = originalHTMLElement;
  globalThis.__healthTestMenus = originalHealthTestMenus;
  globalThis.__healthTestOpenedModals = originalHealthTestOpenedModals;
  globalThis.__healthTestModalOpenHook = originalHealthTestModalOpenHook;
  globalThis.__healthTestNotices = originalHealthTestNotices;
  globalThis.__healthTestButtons = originalHealthTestButtons;
  globalThis.__HealthTestTFile = originalHealthTestTFile;
});

function createHealthHost(sharedState) {
  const workspace = new FakeWorkspace();
  const shared = sharedState || {
    vault: new FakeEvents(),
    files: new Map(),
    contents: new Map(),
    vaultHooks: { create: null, read: null, modify: null, process: null, processAfterUpdate: null },
    vaultCalls: { create: 0, read: 0, modify: 0, process: 0 },
    settingsStore: { value: {} },
  };
  const { vault, files, contents, vaultHooks, vaultCalls, settingsStore } = shared;
  vault.getMarkdownFiles = () => Array.from(files.values());
  vault.getAbstractFileByPath = (path) => files.get(path) || null;
  vault.create = async (path, content) => {
    vaultCalls.create += 1;
    await vaultHooks.create?.(path, content);
    if (files.has(path)) throw new Error(`File already exists: ${path}`);
    const file = new globalThis.__HealthTestTFile(path);
    files.set(path, file);
    contents.set(path, content);
    return file;
  };
  vault.cachedRead = async (file) => {
    vaultCalls.read += 1;
    await vaultHooks.read?.(file);
    return contents.get(file.path) || "";
  };
  vault.read = async (file) => {
    vaultCalls.read += 1;
    await vaultHooks.read?.(file);
    return contents.get(file.path) || "";
  };
  vault.modify = async (file, content) => {
    vaultCalls.modify += 1;
    await vaultHooks.modify?.(file, content);
    contents.set(file.path, content);
  };
  vault.process = async (file, update) => {
    vaultCalls.process += 1;
    await vaultHooks.process?.(file, contents.get(file.path) || "");
    const current = contents.get(file.path) || "";
    const updated = update(current);
    await vaultHooks.processAfterUpdate?.(file, updated, current);
    contents.set(file.path, updated);
    return updated;
  };
  const metadataCache = new FakeEvents();
  metadataCache.getFileCache = () => null;
  const secrets = new Map();
  const app = {
    workspace,
    vault,
    metadataCache,
    secretStorage: {
      getSecret: (name) => secrets.get(name) || null,
      setSecret: (name, value) => secrets.set(name, value),
    },
    plugins: { getPlugin: () => null },
    internalPlugins: { getPluginById: () => null, plugins: {} },
  };
  const plugin = new TPSHealthPlugin(app);
  const addFile = (path, content = "") => {
    const file = new globalThis.__HealthTestTFile(path);
    files.set(path, file);
    contents.set(path, content);
    return file;
  };
  return { app, plugin, workspace, vault, files, contents, vaultHooks, vaultCalls, settingsStore, sharedState: shared, addFile };
}

function gatewayListenerCount(workspace) {
  return workspace.listenerCount(GATEWAY_AVAILABLE) + workspace.listenerCount(GATEWAY_UNAVAILABLE);
}

const exactHealthContext = Object.freeze({
  source: "tps-home",
  dateIso: "2026-07-19",
  dailyNotePath: "Daily Notes/2026-07-19.md",
  componentId: "health-provider-host-test",
  basePath: "Home.base",
});

function requestHealthUiDescriptor(workspace, accept = (descriptor) => descriptor) {
  let accepted;
  workspace.trigger(HEALTH_UI_REQUEST, {
    protocolVersion: 1,
    consumerPluginId: "health-provider-host-test",
    accept(descriptor) {
      accepted = accept(descriptor);
      if (accepted === undefined) accepted = descriptor;
    },
  });
  return accepted;
}

async function loadPublishedHealthHost(host, settings = {}) {
  host.plugin.loadData = async () => settings;
  host.plugin.saveData = async () => undefined;
  await host.plugin.onload();
  const descriptor = requestHealthUiDescriptor(host.workspace);
  assert.ok(descriptor, "TPS Health UI descriptor was not synchronously discoverable");
  return descriptor;
}

async function loadPublishedHealthHostFromSharedStore(host) {
  host.plugin.loadData = async () => JSON.parse(JSON.stringify(host.settingsStore.value));
  host.plugin.saveData = async (settings) => {
    host.settingsStore.value = JSON.parse(JSON.stringify(settings));
  };
  await host.plugin.onload();
  const descriptor = requestHealthUiDescriptor(host.workspace);
  assert.ok(descriptor, "TPS Health UI descriptor was not synchronously discoverable");
  return descriptor;
}

function resetHealthUiSurfaces() {
  globalThis.__healthTestMenus.length = 0;
  globalThis.__healthTestOpenedModals.length = 0;
  globalThis.__healthTestModalOpenHook = undefined;
  globalThis.__healthTestNotices.length = 0;
  globalThis.__healthTestButtons.length = 0;
}

function assertNoPublishedHealthRuntime(host) {
  assert.equal(host.workspace.gatewayRequestCount, 0);
  assert.equal(gatewayListenerCount(host.workspace), 0);
  assert.equal(host.plugin.aiGatewayClient, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(host.app, "tpsHealth"), false);
  assert.equal(host.plugin.__commands.length, 0);
  assert.equal(host.plugin.__settingTabs.length, 0);
}

test("unload during deferred loadData cannot publish Health or start Gateway discovery", async () => {
  const host = createHealthHost();
  const loadData = deferred();
  let saveCalls = 0;
  host.plugin.loadData = () => loadData.promise;
  host.plugin.saveData = async () => { saveCalls += 1; };

  const loading = host.plugin.onload();
  await Promise.resolve();
  host.plugin.__testUnload();
  loadData.resolve({ enableLogging: true });
  await loading;

  assertNoPublishedHealthRuntime(host);
  assert.equal(saveCalls, 0);
  assert.equal(host.plugin.settings.enableLogging, false);
});

test("unload during deferred migration save cannot resurrect Gateway discovery", async () => {
  const host = createHealthHost();
  const saveData = deferred();
  let saveCalls = 0;
  host.plugin.loadData = async () => ({});
  host.plugin.saveData = () => {
    saveCalls += 1;
    return saveData.promise;
  };

  const loading = host.plugin.onload();
  await waitFor(() => saveCalls === 1, "Health did not reach its migration save.");
  host.plugin.__testUnload();
  saveData.resolve();
  await loading;

  assertNoPublishedHealthRuntime(host);
  assert.equal(saveCalls, 1);
});

test("a newer same-instance load supersedes an older deferred load", async () => {
  const host = createHealthHost();
  const firstLoadData = deferred();
  let loadCalls = 0;
  host.plugin.loadData = () => {
    loadCalls += 1;
    return loadCalls === 1 ? firstLoadData.promise : Promise.resolve({ enableLogging: false });
  };
  host.plugin.saveData = async () => undefined;

  const firstLoad = host.plugin.onload();
  await Promise.resolve();
  const secondLoad = host.plugin.onload();
  await secondLoad;
  const requestCount = host.workspace.gatewayRequestCount;
  const listenerCount = gatewayListenerCount(host.workspace);
  const commandCount = host.plugin.__commands.length;
  const settingTabCount = host.plugin.__settingTabs.length;
  const currentClient = host.plugin.aiGatewayClient;
  const currentApi = host.app.tpsHealth;

  firstLoadData.resolve({ enableLogging: true });
  await firstLoad;

  assert.equal(host.workspace.gatewayRequestCount, requestCount);
  assert.equal(requestCount, 1);
  assert.equal(gatewayListenerCount(host.workspace), listenerCount);
  assert.equal(listenerCount, 2);
  assert.equal(host.plugin.__commands.length, commandCount);
  assert.ok(commandCount > 0);
  assert.equal(host.plugin.__settingTabs.length, settingTabCount);
  assert.equal(settingTabCount, 1);
  assert.equal(host.plugin.aiGatewayClient, currentClient);
  assert.equal(host.app.tpsHealth, currentApi);
  assert.equal(host.plugin.settings.enableLogging, false);

  host.plugin.__testUnload();
  assert.equal(gatewayListenerCount(host.workspace), 0);
});

test("same-instance unload and reload installs only the current Gateway client", async () => {
  const host = createHealthHost();
  host.plugin.loadData = async () => ({});
  host.plugin.saveData = async () => undefined;

  await host.plugin.onload();
  const firstClient = host.plugin.aiGatewayClient;
  const firstApi = host.app.tpsHealth;
  assert.equal(host.workspace.gatewayRequestCount, 1);
  assert.equal(gatewayListenerCount(host.workspace), 2);

  host.plugin.__testUnload();
  assert.equal(gatewayListenerCount(host.workspace), 0);
  assert.equal(Object.prototype.hasOwnProperty.call(host.app, "tpsHealth"), false);

  await host.plugin.onload();
  assert.notEqual(host.plugin.aiGatewayClient, firstClient);
  assert.notEqual(host.app.tpsHealth, firstApi);
  assert.equal(host.workspace.gatewayRequestCount, 2);
  assert.equal(gatewayListenerCount(host.workspace), 2);

  host.plugin.__testUnload();
  assert.equal(gatewayListenerCount(host.workspace), 0);
});

test("reentrant unload during Gateway request rolls back the local client and later integrations", async () => {
  const host = createHealthHost();
  host.plugin.loadData = async () => ({});
  host.plugin.saveData = async () => undefined;
  host.workspace.on(GATEWAY_REQUEST, () => host.plugin.__testUnload());

  await host.plugin.onload();

  assert.equal(host.workspace.gatewayRequestCount, 1);
  assert.equal(gatewayListenerCount(host.workspace), 0);
  assert.equal(host.plugin.aiGatewayClient, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(host.app, "tpsHealth"), false);
  assert.equal(host.plugin.__commands.length, 0);
  assert.equal(host.plugin.__settingTabs.length, 0);
  host.workspace.trigger(GATEWAY_AVAILABLE, {
    protocolVersion: 1,
    providerPluginId: "tps-ai-gateway",
    api: {},
  });
  assert.equal(host.plugin.aiGatewayClient, undefined);
});

test("Health UI publication is exact, listener failures are isolated, and unload fences every retained adapter", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const available = [];
  const unavailable = [];
  const unloadOrder = [];
  host.workspace.on(HEALTH_UI_AVAILABLE, (descriptor) => available.push(descriptor));
  host.workspace.on(HEALTH_UI_AVAILABLE, () => { throw new Error("hostile available listener"); });
  host.workspace.on(HEALTH_UI_UNAVAILABLE, (descriptor) => {
    unavailable.push(descriptor);
    unloadOrder.push("unavailable");
  });
  host.workspace.on(HEALTH_UI_UNAVAILABLE, () => { throw new Error("hostile unavailable listener"); });
  const originalOffref = host.workspace.offref.bind(host.workspace);
  host.workspace.offref = (ref) => {
    if (ref?.name === HEALTH_UI_REQUEST) unloadOrder.push("request-offref");
    originalOffref(ref);
  };

  const first = await loadPublishedHealthHost(host);
  assert.equal(available.length, 1);
  assert.equal(available[0], first);
  assert.equal(host.workspace.listenerCount(HEALTH_UI_REQUEST), 1);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.api), true);
  assert.deepEqual(Object.keys(first.api).sort(), [
    "apiVersion",
    "ensureLogBase",
    "executeHomeAction",
    "getMetricRenderConfigs",
    "isWorkoutFile",
    "openFoodLogEntryMenu",
    "prepareFoodDescription",
    "supportedHomeActionIds",
  ]);
  assert.doesNotThrow(() => host.workspace.trigger(HEALTH_UI_REQUEST, {
    protocolVersion: 1,
    consumerPluginId: "throwing-consumer",
    accept() { throw new Error("hostile accept"); },
  }));
  assert.equal(requestHealthUiDescriptor(host.workspace), first);

  await assert.rejects(
    first.api.executeHomeAction("tps-health:log-food", exactHealthContext),
    /Daily Note is unavailable/i,
  );
  host.addFile(exactHealthContext.dailyNotePath, "");
  assert.equal(await first.api.executeHomeAction("tps-health:log-food", exactHealthContext), true);
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);
  assert.ok(Array.isArray(first.api.getMetricRenderConfigs()));
  const activeWorkout = host.addFile("Workouts/Active.md", "");
  host.plugin.settings.activeWorkoutPath = activeWorkout.path;
  assert.equal(first.api.isWorkoutFile(activeWorkout.path), true);
  assert.equal(first.api.isWorkoutFile(host.addFile("Notes/Plain.md", "").path), false);

  host.plugin.register(() => unloadOrder.push("plugin-cleanup"));
  host.plugin.__testUnload();
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0], first);
  assert.equal(host.workspace.listenerCount(HEALTH_UI_REQUEST), 0);
  assert.ok(unloadOrder.indexOf("unavailable") < unloadOrder.indexOf("request-offref"));
  assert.ok(unloadOrder.indexOf("request-offref") < unloadOrder.indexOf("plugin-cleanup"));
  await assert.rejects(
    Promise.resolve().then(() => first.api.executeHomeAction("tps-health:log-food", exactHealthContext)),
    /unavailable/i,
  );
  assert.throws(() => first.api.getMetricRenderConfigs(), /unavailable/i);
  assert.throws(() => first.api.isWorkoutFile(activeWorkout.path), /unavailable/i);
  await assert.rejects(first.api.prepareFoodDescription({ description: "stale", context: exactHealthContext }), /unavailable/i);
  await assert.rejects(first.api.ensureLogBase("food"), /unavailable/i);
  await assert.rejects(first.api.openFoodLogEntryMenu({
    clientX: 1,
    clientY: 2,
    screenX: 3,
    screenY: 4,
    filePath: "Daily Notes/2026-07-19.md",
    lineNumber: 0,
    renderedLine: "- food [food:: stale] [qty:: 1]",
  }), /unavailable/i);

  const second = await loadPublishedHealthHost(host);
  assert.notEqual(second, first);
  assert.notEqual(second.api, first.api);
  for (const name of ["executeHomeAction", "prepareFoodDescription", "ensureLogBase", "getMetricRenderConfigs", "isWorkoutFile", "openFoodLogEntryMenu"]) {
    assert.notEqual(second.api[name], first.api[name], `${name} wrapper must have a fresh lifecycle identity`);
  }
  assert.equal(host.workspace.listenerCount(HEALTH_UI_REQUEST), 1);
  host.plugin.__testUnload();
});

test("retained legacy app API and Home actions remain stale across unload and reload", async () => {
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  await loadPublishedHealthHost(host);
  const retainedApi = host.app.tpsHealth;
  const retainedHomeActions = retainedApi.homeActions;
  const sideEffects = { metrics: 0, search: 0, base: 0, home: 0 };
  host.plugin.getMetricRenderConfigs = () => { sideEffects.metrics += 1; return []; };
  host.plugin.searchFoods = async () => { sideEffects.search += 1; return []; };
  host.plugin.ensureFoodLogBase = async () => {
    sideEffects.base += 1;
    return host.addFile("Food Log.base", "");
  };
  host.plugin.openFoodLogger = () => { sideEffects.home += 1; };

  const assertRetainedApiIsStale = async () => {
    assert.throws(() => retainedApi.getMetricRenderConfigs(), /unavailable|stale|inactive/i);
    assert.throws(() => retainedApi.getActiveWorkoutPath(), /unavailable|stale|inactive/i);
    await assert.rejects(
      Promise.resolve().then(() => retainedApi.searchFoods("stale search")),
      /unavailable|stale|inactive/i,
    );
    await assert.rejects(
      Promise.resolve().then(() => retainedApi.ensureFoodLogBase()),
      /unavailable|stale|inactive/i,
    );
    await assert.rejects(
      Promise.resolve().then(() => retainedHomeActions.execute("tps-health:log-food", exactHealthContext)),
      /unavailable|stale|inactive/i,
    );
    assert.deepEqual(sideEffects, { metrics: 0, search: 0, base: 0, home: 0 });
  };

  host.plugin.__testUnload();
  await assertRetainedApiIsStale();
  await loadPublishedHealthHost(host);
  assert.notEqual(host.app.tpsHealth, retainedApi);
  assert.notEqual(host.app.tpsHealth.homeActions, retainedHomeActions);
  await assertRetainedApiIsStale();
  host.plugin.__testUnload();
});

test("retained public Home modals refuse stale mutation submits across unload and reload", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  const descriptor = await loadPublishedHealthHost(host);
  const sideEffects = { food: 0, clearDraft: 0, activity: 0, workout: 0 };
  host.plugin.logFood = async () => { sideEffects.food += 1; };
  host.plugin.clearPendingFoodLogDraft = async () => { sideEffects.clearDraft += 1; };
  host.plugin.logActivity = async () => { sideEffects.activity += 1; };
  host.plugin.startWorkout = async () => { sideEffects.workout += 1; return "Workouts/Stale.md"; };
  host.plugin.searchWorkoutPlans = async () => [];

  assert.equal(await descriptor.api.executeHomeAction("tps-health:log-food", exactHealthContext), true);
  assert.equal(await descriptor.api.executeHomeAction("tps-health:log-activity", exactHealthContext), true);
  assert.equal(await descriptor.api.executeHomeAction("tps-health:start-workout", exactHealthContext), true);
  assert.equal(globalThis.__healthTestOpenedModals.length, 3);
  const [foodModal, activityModal, workoutModal] = globalThis.__healthTestOpenedModals;
  assert.match(foodModal.constructor.name, /FoodSearchModal$/);
  assert.match(activityModal.constructor.name, /ActivityLogModal$/);
  assert.match(workoutModal.constructor.name, /StartWorkoutModal$/);
  assert.equal(typeof foodModal.assertCurrent, "function");

  foodModal.selectionItems = [{
    item: {
      id: "retained-home-food",
      name: "Retained Home Food",
      source: "manual",
      servingAmount: 1,
      servingUnit: "serving",
      nutrition: { calories: 100, proteinG: 10, carbsG: 5, fatG: 4 },
    },
    quantity: 1,
    unit: "serving",
  }];
  foodModal.activeFoodLogTab = "search";
  foodModal.refreshSelectionItemsFromSources = async () => undefined;
  foodModal.persistDraft = async () => undefined;
  foodModal.onOpen();
  activityModal.onOpen();
  workoutModal.onOpen();

  const button = (label) => {
    const match = globalThis.__healthTestButtons.find((candidate) => candidate.textContent === label);
    assert.ok(match, `missing retained modal submit button: ${label}`);
    return match;
  };
  const retainedSubmits = [
    ["Log selected", button("Log selected")],
    ["Log activity", button("Log activity")],
    ["Start empty", button("Start empty")],
  ];
  const assertRetainedSubmitsAreStale = async (phase) => {
    const noticeStart = globalThis.__healthTestNotices.length;
    for (const [label, submit] of retainedSubmits) {
      await Promise.resolve(submit.click());
      await Promise.resolve();
      assert.deepEqual(
        sideEffects,
        { food: 0, clearDraft: 0, activity: 0, workout: 0 },
        `${label} must not mutate through a retained modal ${phase}`,
      );
    }
    const notices = globalThis.__healthTestNotices.slice(noticeStart);
    assert.equal(notices.length, 3, `each retained modal must report its handled refusal ${phase}`);
    assert.match(notices[0], /TPS Health changed while the food tray was open/i);
    assert.match(notices[1], /Could not log Walking/i);
    assert.match(notices[2], /Could not start that workout/i);
    assert.deepEqual(sideEffects, { food: 0, clearDraft: 0, activity: 0, workout: 0 });
  };

  host.plugin.__testUnload();
  assert.throws(() => foodModal.assertCurrent(), /unavailable|stale|inactive/i);
  await assertRetainedSubmitsAreStale("after unload");
  await loadPublishedHealthHost(host);
  await assertRetainedSubmitsAreStale("after provider reload");
  assert.equal(foodModal.__opened, true);
  assert.equal(activityModal.__opened, true);
  assert.equal(workoutModal.__opened, true);
  host.plugin.__testUnload();
});

test("retained public Describe tray refuses stale mutation submits across unload and reload", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  const descriptor = await loadPublishedHealthHost(host);
  const sideEffects = { food: 0, clearDraft: 0 };
  host.plugin.logFood = async () => { sideEffects.food += 1; };
  host.plugin.clearPendingFoodLogDraft = async () => { sideEffects.clearDraft += 1; };
  host.plugin.openFoodDescriber = async () => ({
    query: "Retained Describe Food",
    quantity: 1,
    unit: "serving",
    overrides: {},
  });

  assert.deepEqual(
    await descriptor.api.prepareFoodDescription({
      description: "Retained Describe Food",
      context: exactHealthContext,
    }),
    { status: "prepared" },
  );
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);
  const describeModal = globalThis.__healthTestOpenedModals[0];
  assert.match(describeModal.constructor.name, /FoodSearchModal$/);
  assert.equal(typeof describeModal.assertCurrent, "function");
  describeModal.selectionItems = [{
    item: {
      id: "retained-describe-food",
      name: "Retained Describe Food",
      source: "manual",
      servingAmount: 1,
      servingUnit: "serving",
      nutrition: { calories: 100, proteinG: 10, carbsG: 5, fatG: 4 },
    },
    quantity: 1,
    unit: "serving",
  }];
  describeModal.activeFoodLogTab = "search";
  describeModal.queueSearch = () => undefined;
  describeModal.refreshSelectionItemsFromSources = async () => undefined;
  describeModal.persistDraft = async () => undefined;
  describeModal.onOpen();
  const submit = globalThis.__healthTestButtons.find((candidate) => candidate.textContent === "Log selected");
  assert.ok(submit, "missing retained Describe tray submit button");

  const assertRetainedDescribeSubmitIsStale = async (phase) => {
    const noticeStart = globalThis.__healthTestNotices.length;
    await Promise.resolve(submit.click());
    await Promise.resolve();
    assert.deepEqual(sideEffects, { food: 0, clearDraft: 0 }, `Describe tray must not mutate ${phase}`);
    const notices = globalThis.__healthTestNotices.slice(noticeStart);
    assert.equal(notices.length, 1, `Describe tray must report its handled refusal ${phase}`);
    assert.match(notices[0], /TPS Health changed while the food tray was open/i);
  };

  host.plugin.__testUnload();
  assert.throws(() => describeModal.assertCurrent(), /unavailable|stale|inactive/i);
  await assertRetainedDescribeSubmitIsStale("after unload");
  await loadPublishedHealthHost(host);
  await assertRetainedDescribeSubmitIsStale("after provider reload");
  assert.equal(describeModal.__opened, true);
  host.plugin.__testUnload();
});

test("public Home action rejects an existing Markdown Daily Note whose configured date is wrong", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const wrongDateContext = Object.freeze({
    ...exactHealthContext,
    dailyNotePath: "Daily Notes/2026-07-18.md",
  });
  host.addFile(wrongDateContext.dailyNotePath, "");
  const descriptor = await loadPublishedHealthHost(host);
  let homeSideEffects = 0;
  host.plugin.openFoodLogger = () => { homeSideEffects += 1; };

  await assert.rejects(
    descriptor.api.executeHomeAction("tps-health:log-food", wrongDateContext),
    /Daily Note no longer matches the requested date/i,
  );
  assert.equal(homeSideEffects, 0);
  assert.equal(globalThis.__healthTestOpenedModals.length, 0);
  host.plugin.__testUnload();
});

test("reentrant Health UI availability fully withdraws the just-announced descriptor", async () => {
  const host = createHealthHost();
  host.plugin.loadData = async () => ({});
  host.plugin.saveData = async () => undefined;
  let announced;
  host.workspace.on(HEALTH_UI_AVAILABLE, (descriptor) => {
    announced = descriptor;
    host.plugin.__testUnload();
  });

  await host.plugin.onload();

  assert.ok(announced);
  assert.equal(host.plugin.healthUiDescriptor, undefined);
  assert.equal(host.workspace.listenerCount(HEALTH_UI_REQUEST), 0);
  assert.equal(requestHealthUiDescriptor(host.workspace), undefined);
  assert.throws(() => announced.api.getMetricRenderConfigs(), /unavailable/i);
  await assert.rejects(announced.api.ensureLogBase("food"), /unavailable/i);
});

test("post-call lifecycle guards reject reentrant metric and workout classifications", async () => {
  const host = createHealthHost();
  const first = await loadPublishedHealthHost(host);
  const originalGetMetricRenderConfigs = host.plugin.getMetricRenderConfigs;
  host.plugin.getMetricRenderConfigs = function reentrantMetricRead() {
    host.plugin.__testUnload();
    return [];
  };
  assert.throws(() => first.api.getMetricRenderConfigs(), /unavailable/i);
  host.plugin.getMetricRenderConfigs = originalGetMetricRenderConfigs;

  const second = await loadPublishedHealthHost(host);
  const workout = host.addFile("Workouts/Reentrant.md", "");
  host.plugin.settings.activeWorkoutPath = workout.path;
  const originalGetAbstractFileByPath = host.vault.getAbstractFileByPath;
  host.vault.getAbstractFileByPath = (path) => {
    const file = originalGetAbstractFileByPath(path);
    host.plugin.__testUnload();
    return file;
  };
  assert.throws(() => second.api.isWorkoutFile(workout.path), /unavailable/i);
  host.vault.getAbstractFileByPath = originalGetAbstractFileByPath;

  const third = await loadPublishedHealthHost(host);
  host.vault.getAbstractFileByPath = () => {
    host.plugin.__testUnload();
    return null;
  };
  await assert.rejects(
    Promise.resolve().then(() => third.api.executeHomeAction("tps-health:log-food", exactHealthContext)),
    /unavailable/i,
  );
  host.vault.getAbstractFileByPath = originalGetAbstractFileByPath;
});

test("log Base adapters coalesce per lifecycle and recover cleanly across reload", async () => {
  const host = createHealthHost();
  const first = await loadPublishedHealthHost(host);
  const foodCreate = deferred();
  host.vaultHooks.create = async (path) => {
    if (path === "Food Log.base") await foodCreate.promise;
  };

  const foodOne = first.api.ensureLogBase("food");
  const foodTwo = first.api.ensureLogBase("food");
  await waitFor(() => host.vaultCalls.create === 1, "coalesced food Base creation did not begin");
  assert.equal(host.files.has("Food Log.base"), false);
  foodCreate.resolve();
  assert.deepEqual(await Promise.all([foodOne, foodTwo]), ["Food Log.base", "Food Log.base"]);
  assert.equal(host.vaultCalls.create, 1);

  const activityCreate = deferred();
  host.vaultHooks.create = async (path) => {
    if (path === "Activity Log.base") await activityCreate.promise;
  };
  const staleActivity = first.api.ensureLogBase("activity").then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  );
  await waitFor(() => host.vaultCalls.create === 2, "old lifecycle activity Base creation did not begin");
  host.plugin.__testUnload();
  const second = await loadPublishedHealthHost(host);
  const currentActivity = second.api.ensureLogBase("activity");

  activityCreate.resolve();
  const staleActivityResult = await staleActivity;
  assert.equal(staleActivityResult.status, "rejected");
  assert.match(String(staleActivityResult.error), /unavailable/i);
  assert.equal(await currentActivity, "Activity Log.base");
  assert.equal(host.files.has("Activity Log.base"), true);
  assert.equal(Array.from(host.files.keys()).filter((path) => path === "Activity Log.base").length, 1);
  assert.match(host.contents.get("Activity Log.base"), /name: Activity Log/);
  host.plugin.__testUnload();
});

test("a stale Base repair read cannot proceed into modify", async () => {
  const host = createHealthHost();
  host.addFile("Food Log.base", "");
  const descriptor = await loadPublishedHealthHost(host);
  const readGate = deferred();
  host.vaultHooks.read = async (file) => {
    if (file.path === "Food Log.base") await readGate.promise;
  };

  const pending = descriptor.api.ensureLogBase("food");
  await waitFor(() => host.vaultCalls.read === 1, "Base repair read did not begin");
  host.plugin.__testUnload();
  readGate.resolve();

  await assert.rejects(pending, /unavailable/i);
  assert.equal(host.vaultCalls.modify, 0);
  assert.equal(host.vaultCalls.process, 0);
});

test("two plugin instances sharing vault and settings recover one concurrent Base create collision", async () => {
  const firstHost = createHealthHost();
  const secondHost = createHealthHost(firstHost.sharedState);
  const [firstDescriptor, secondDescriptor] = await Promise.all([
    loadPublishedHealthHostFromSharedStore(firstHost),
    loadPublishedHealthHostFromSharedStore(secondHost),
  ]);
  const bothCreatesStarted = deferred();
  let createArrivals = 0;
  firstHost.vaultHooks.create = async (path) => {
    if (path !== "Food Log.base") return;
    createArrivals += 1;
    if (createArrivals === 2) bothCreatesStarted.resolve();
    await bothCreatesStarted.promise;
  };

  const firstBase = firstDescriptor.api.ensureLogBase("food");
  const secondBase = secondDescriptor.api.ensureLogBase("food");
  await waitFor(() => createArrivals === 2, "both plugin instances did not reach the shared create boundary");
  assert.deepEqual(await Promise.all([firstBase, secondBase]), ["Food Log.base", "Food Log.base"]);
  assert.equal(firstHost.vaultCalls.create, 2, "the fake vault must expose the real create collision");
  assert.equal(firstHost.files.has("Food Log.base"), true);
  assert.equal(Array.from(firstHost.files.keys()).filter((path) => path === "Food Log.base").length, 1);
  assert.deepEqual(firstHost.settingsStore.value, secondHost.settingsStore.value);

  firstHost.plugin.__testUnload();
  secondHost.plugin.__testUnload();
});

function inlineFoodDraft(query = "eggs") {
  return { query, quantity: 2, unit: "serving", hasExplicitAmount: true, overrides: {} };
}

function pendingFoodDraft(id, context = exactHealthContext) {
  return {
    id,
    updatedAt: new Date().toISOString(),
    activeTab: "mine",
    searchInput: "",
    consumedDateInput: `${context.dateIso}T12:00`,
    dateContext: {
      dateIso: context.dateIso,
      label: context.dateIso,
      isToday: false,
      dailyNotePath: context.dailyNotePath,
      foodLogTarget: "daily-note",
      focusAfterLog: false,
    },
    selectionItems: [{
      item: { id: `${id}-food`, name: "Eggs", source: "manual" },
      quantity: 2,
      unit: "serving",
    }],
  };
}

function nativeFoodDateContext(context = exactHealthContext) {
  return {
    dateIso: context.dateIso,
    label: context.dateIso,
    isToday: false,
    dailyNotePath: context.dailyNotePath,
    foodLogTarget: "daily-note",
    focusAfterLog: false,
  };
}

test("Describe validates the exact Daily Note before starting any food workflow", async () => {
  resetHealthUiSurfaces();
  const missingHost = createHealthHost();
  const missingDescriptor = await loadPublishedHealthHost(missingHost);
  let starts = 0;
  missingHost.plugin.openFoodDescriber = async () => {
    starts += 1;
    return inlineFoodDraft();
  };
  await assert.rejects(missingDescriptor.api.prepareFoodDescription({
    description: "two eggs",
    context: exactHealthContext,
  }), /Daily Note is unavailable/i);
  assert.equal(starts, 0);
  assert.equal(missingHost.plugin.settings.pendingFoodLogDraft, null);
  assert.equal(globalThis.__healthTestOpenedModals.length, 0);
  missingHost.plugin.__testUnload();

  const mismatchHost = createHealthHost();
  mismatchHost.addFile(exactHealthContext.dailyNotePath, "");
  const mismatchDescriptor = await loadPublishedHealthHost(mismatchHost);
  mismatchHost.plugin.getDailyNoteDateContext = async (file) => ({
    dateIso: "2026-07-18",
    label: "wrong date",
    isToday: false,
    dailyNotePath: file.path,
  });
  mismatchHost.plugin.openFoodDescriber = async () => {
    starts += 1;
    return inlineFoodDraft();
  };
  await assert.rejects(mismatchDescriptor.api.prepareFoodDescription({
    description: "two eggs",
    context: exactHealthContext,
  }), /no longer matches/i);
  assert.equal(starts, 0);
  assert.equal(globalThis.__healthTestOpenedModals.length, 0);
  mismatchHost.plugin.__testUnload();
});

test("Describe coalesces identical work, rejects concurrent divergence, and owns exact modal or tray preparation", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  const descriptor = await loadPublishedHealthHost(host);
  const describeGate = deferred();
  let calls = 0;
  host.plugin.openFoodDescriber = async () => {
    calls += 1;
    return describeGate.promise;
  };
  const request = { description: "two eggs", context: exactHealthContext };
  const first = descriptor.api.prepareFoodDescription(request);
  const duplicate = descriptor.api.prepareFoodDescription(request);
  await waitFor(() => calls === 1, "coalesced Describe did not start");
  await assert.rejects(descriptor.api.prepareFoodDescription({
    description: "toast",
    context: exactHealthContext,
  }), /already preparing/i);
  describeGate.resolve(inlineFoodDraft());
  assert.deepEqual(await Promise.all([first, duplicate]), [{ status: "prepared" }, { status: "prepared" }]);
  assert.equal(calls, 1);
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);
  assert.equal(globalThis.__healthTestOpenedModals[0].__opened, true);

  host.plugin.openFoodDescriber = async () => {
    host.plugin.settings.pendingFoodLogDraft = pendingFoodDraft("persisted");
    return null;
  };
  assert.deepEqual(await descriptor.api.prepareFoodDescription({
    description: "persist this tray",
    context: exactHealthContext,
  }), { status: "prepared" });

  const expectedFailure = new Error("describe failed");
  host.plugin.openFoodDescriber = async () => { throw expectedFailure; };
  await assert.rejects(descriptor.api.prepareFoodDescription({
    description: "failing request",
    context: exactHealthContext,
  }), (error) => error === expectedFailure);
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);
  host.plugin.__testUnload();
});

test("stale Describe rejects while the current lifecycle starts independently", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  const firstDescriptor = await loadPublishedHealthHost(host);
  const oldWork = deferred();
  let calls = 0;
  let completedOldWork = false;
  host.plugin.openFoodDescriber = async () => {
    calls += 1;
    if (calls === 1) {
      await oldWork.promise;
      completedOldWork = true;
      host.plugin.settings.pendingFoodLogDraft = pendingFoodDraft("old-lifecycle");
      return null;
    }
    return inlineFoodDraft("new-lifecycle");
  };
  const stale = firstDescriptor.api.prepareFoodDescription({
    description: "old request",
    context: exactHealthContext,
  });
  await waitFor(() => calls === 1, "old Describe work did not begin");
  host.plugin.__testUnload();
  const secondDescriptor = await loadPublishedHealthHost(host);
  const current = secondDescriptor.api.prepareFoodDescription({
    description: "new request",
    context: exactHealthContext,
  });
  await waitFor(() => calls === 2, "replacement Describe remained coupled to stale instance work");
  assert.deepEqual(await current, { status: "prepared" });
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);

  oldWork.resolve();
  await assert.rejects(stale, /unavailable/i);
  assert.equal(completedOldWork, true, "already-issued underlying work is not falsely claimed cancellable");
  assert.equal(calls, 2);
  host.plugin.__testUnload();
});

test("native and service Describe entrypoints share one mutation owner in both call orders", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  const descriptor = await loadPublishedHealthHost(host);
  host.plugin.getAiGatewayApi = () => undefined;

  let workerCalls = 0;
  let workerGate = deferred();
  let workerReentry = new Error("Describe mutation worker was entered twice");
  host.plugin.legacyOpenFoodDescriber = async () => {
    workerCalls += 1;
    if (workerCalls > 1) throw workerReentry;
    return workerGate.promise;
  };

  const nativeFirst = host.plugin.openFoodDescriber("native first", nativeFoodDateContext());
  await waitFor(() => workerCalls === 1, "native Describe did not acquire the mutation owner");
  let serviceSecondError;
  await assert.rejects(
    descriptor.api.prepareFoodDescription({ description: "service second", context: exactHealthContext }),
    (error) => { serviceSecondError = error; return true; },
  );
  assert.notEqual(serviceSecondError, workerReentry, "service caller must fail before entering the owned worker");
  assert.equal(workerCalls, 1);
  workerGate.resolve(inlineFoodDraft("native result"));
  assert.equal((await nativeFirst).query, "native result");

  workerCalls = 0;
  workerGate = deferred();
  workerReentry = new Error("Describe mutation worker was entered twice after service ownership");
  const serviceFirst = descriptor.api.prepareFoodDescription({
    description: "service first",
    context: exactHealthContext,
  });
  await waitFor(() => workerCalls === 1, "service Describe did not acquire the mutation owner");
  let nativeSecondError;
  await assert.rejects(
    host.plugin.openFoodDescriber("native second", nativeFoodDateContext()),
    (error) => { nativeSecondError = error; return true; },
  );
  assert.notEqual(nativeSecondError, workerReentry, "native caller must fail before entering the owned worker");
  assert.equal(workerCalls, 1);
  workerGate.resolve(inlineFoodDraft("service result"));
  assert.deepEqual(await serviceFirst, { status: "prepared" });
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);

  host.plugin.__testUnload();
});

test("reentrant unload while Describe opens its owned modal closes it and rejects preparation", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile(exactHealthContext.dailyNotePath, "");
  const descriptor = await loadPublishedHealthHost(host);
  host.plugin.openFoodDescriber = async () => inlineFoodDraft();
  globalThis.__healthTestModalOpenHook = () => host.plugin.__testUnload();

  await assert.rejects(descriptor.api.prepareFoodDescription({
    description: "reentrant modal",
    context: exactHealthContext,
  }), /unavailable/i);
  assert.equal(globalThis.__healthTestOpenedModals.length, 1);
  assert.equal(globalThis.__healthTestOpenedModals[0].__opened, false);
  assert.equal(host.workspace.listenerCount(HEALTH_UI_REQUEST), 0);
  globalThis.__healthTestModalOpenHook = undefined;
});

test("AI Describe falls back only before any mutation boundary", async () => {
  const host = createHealthHost();
  let localCalls = 0;
  const productionAiDescribe = host.plugin.openFoodDescriberWithAi;
  host.plugin.getAiGatewayApi = () => ({});
  host.plugin.legacyOpenFoodDescriber = async () => {
    localCalls += 1;
    return inlineFoodDraft("local");
  };
  const preMutationFailure = new Error("gateway failed before mutation");
  host.plugin.openFoodDescriberWithAi = async () => { throw preMutationFailure; };
  assert.equal((await host.plugin.openFoodDescriber("pre-mutation")).query, "local");
  assert.equal(localCalls, 1);

  const postMutationFailure = new Error("save failed after mutation began");
  host.plugin.openFoodDescriberWithAi = async (_description, _context, _progress, _guard, mutationState) => {
    mutationState.started = true;
    throw postMutationFailure;
  };
  await assert.rejects(
    host.plugin.openFoodDescriber("post-mutation"),
    (error) => error === postMutationFailure,
  );
  assert.equal(localCalls, 1, "post-mutation failure must never start a second local flow");

  const ingredientMutationFailure = new Error("ingredient note creation failed");
  const nutrition = { calories: 100, proteinG: 5, carbsG: 10, fatG: 4, fiberG: 1, sugarG: 1, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 50 };
  const plan = {
    mealName: "Test meal",
    foods: ["Eggs", "Toast"].map((label) => ({
      label,
      quantity: 1,
      unit: "serving",
      estimatedWeightG: 100,
      foodType: "food",
      queries: [label],
      estimatedNutritionPer100G: nutrition,
      expectedCaloriesPer100GMin: 50,
      expectedCaloriesPer100GMax: 500,
    })),
  };
  host.plugin.openFoodDescriberWithAi = productionAiDescribe;
  host.plugin.describeFoodAi = async () => plan;
  host.plugin.searchFoods = async () => [];
  host.plugin.findOrCreateFoodNote = async () => { throw ingredientMutationFailure; };
  await assert.rejects(
    host.plugin.openFoodDescriber("two ingredient meal"),
    (error) => error === ingredientMutationFailure,
  );
  assert.equal(localCalls, 1, "ingredient note creation is already beyond the safe fallback boundary");
});

const foodLogRow = "- 1 serving - Eggs <!-- [type:: foodLog] [food:: Eggs] [qty:: 1] [unit:: serving] [foodId:: row-1] -->";

function foodMenuRequest(overrides = {}) {
  return {
    clientX: 41,
    clientY: 42,
    screenX: 401,
    screenY: 402,
    filePath: "Daily Notes/Food.md",
    lineNumber: 0,
    renderedLine: foodLogRow,
    ...overrides,
  };
}

test("public food-row menu resolution is exact, coordinate-based, single-row, and stale-action safe", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const descriptor = await loadPublishedHealthHost(host);

  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "missing-file" });
  assert.equal(globalThis.__healthTestMenus.length, 0);

  host.addFile("Notes/Plain.md", "ordinary text");
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest({
    filePath: "Notes/Plain.md",
    renderedLine: "ordinary text",
  })), { status: "no-match" });
  assert.equal(globalThis.__healthTestMenus.length, 0);

  host.addFile("Daily Notes/Stale.md", "- another food [food:: Toast] [qty:: 1] [foodId:: row-2]");
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest({
    filePath: "Daily Notes/Stale.md",
  })), { status: "stale-line" });
  assert.equal(globalThis.__healthTestMenus.length, 0);

  host.addFile("Daily Notes/Food.md", foodLogRow);
  let adjustCalls = 0;
  host.plugin.openAdjustFoodLogServing = () => { adjustCalls += 1; };
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  assert.equal(globalThis.__healthTestMenus.length, 1);
  const menu = globalThis.__healthTestMenus[0];
  assert.deepEqual(menu.position, { x: 41, y: 42 });
  assert.equal(menu.mouseEvent, undefined, "public API must not synthesize a MouseEvent");
  assert.equal(host.workspace.activeViewLookupCount, 0, "public API must not expand into editor selection");
  assert.equal(menu.items.some((item) => item.title.startsWith("Create recipe from")), false);
  const adjust = menu.items.find((item) => item.title === "Adjust serving consumed");
  assert.equal(typeof adjust?.click, "function");

  host.plugin.__testUnload();
  assert.doesNotThrow(() => adjust.click());
  assert.equal(adjustCalls, 0, "an already-open menu callback must become inert after unload");
});

test("unload during food-row read prevents any stale menu from opening", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  const readGate = deferred();
  host.vaultHooks.read = async (file) => {
    if (file.path === "Daily Notes/Food.md") await readGate.promise;
  };

  const pending = descriptor.api.openFoodLogEntryMenu(foodMenuRequest());
  await waitFor(() => host.vaultCalls.read === 1, "food-row snapshot read did not begin");
  host.plugin.__testUnload();
  readGate.resolve();

  await assert.rejects(pending, /unavailable/i);
  assert.equal(globalThis.__healthTestMenus.length, 0);
});

test("Open log line re-resolves a moved food row and fails closed when its snapshot is gone", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const menu = globalThis.__healthTestMenus[0];
  const openLine = menu.items.find((item) => item.title === "Open log line");
  assert.equal(typeof openLine?.click, "function");

  const openedFiles = [];
  const cursorPositions = [];
  const scrollRanges = [];
  host.workspace.getLeaf = (mode) => {
    assert.equal(mode, false);
    return { openFile: async (openedFile) => { openedFiles.push(openedFile); } };
  };
  host.workspace.getActiveViewOfType = () => ({
    file,
    editor: {
      setCursor: (position) => cursorPositions.push(position),
      scrollIntoView: (range, center) => scrollRanges.push({ range, center }),
    },
  });
  host.contents.set(file.path, `# Food log\n${foodLogRow}`);
  const originalOpenSourceLine = host.plugin.openFoodLogSourceLine.bind(host.plugin);
  let pendingOpen;
  host.plugin.openFoodLogSourceLine = (...args) => {
    pendingOpen = originalOpenSourceLine(...args);
    return pendingOpen;
  };

  openLine.click();
  assert.ok(pendingOpen, "the menu callback did not start source-line navigation");
  await pendingOpen;
  assert.deepEqual(openedFiles, [file]);
  assert.deepEqual(cursorPositions, [{ line: 1, ch: 0 }]);
  assert.deepEqual(scrollRanges, [{
    range: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } },
    center: true,
  }]);

  resetHealthUiSurfaces();
  host.contents.set(file.path, "- 1 serving - Toast <!-- [type:: foodLog] [food:: Toast] [qty:: 1] [unit:: serving] [foodId:: row-2] -->");
  pendingOpen = undefined;
  openLine.click();
  assert.ok(pendingOpen, "the retained menu callback did not retry source-line navigation");
  await pendingOpen;
  assert.equal(globalThis.__healthTestMenus.length, 0);
  assert.deepEqual(openedFiles, [file]);
  assert.deepEqual(cursorPositions, [{ line: 1, ch: 0 }]);
  assert.deepEqual(globalThis.__healthTestNotices, ["That food-log row changed. Refresh and try again."]);
  host.plugin.__testUnload();
});

test("unload while source-line leaf opening is in flight prevents stale cursor movement", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const openLine = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Open log line");
  assert.equal(typeof openLine?.click, "function");

  const leafGate = deferred();
  let leafOpenCalls = 0;
  let cursorCalls = 0;
  host.workspace.getLeaf = () => ({
    openFile: async () => {
      leafOpenCalls += 1;
      await leafGate.promise;
    },
  });
  host.workspace.getActiveViewOfType = () => ({
    file,
    editor: {
      setCursor: () => { cursorCalls += 1; },
      scrollIntoView: () => { cursorCalls += 1; },
    },
  });
  const originalOpenSourceLine = host.plugin.openFoodLogSourceLine.bind(host.plugin);
  let pendingOpen;
  host.plugin.openFoodLogSourceLine = (...args) => {
    pendingOpen = originalOpenSourceLine(...args);
    return pendingOpen;
  };

  openLine.click();
  await waitFor(() => leafOpenCalls === 1, "source-line leaf opening did not begin");
  host.plugin.__testUnload();
  leafGate.resolve();

  await assert.rejects(pendingOpen, /unavailable/i);
  assert.equal(cursorCalls, 0);
});

test("Open log line re-resolves again after leaf opening before moving the cursor", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const openLine = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Open log line");
  assert.equal(typeof openLine?.click, "function");

  let leafGate = deferred();
  let leafOpenCalls = 0;
  const cursorPositions = [];
  const scrollRanges = [];
  host.workspace.getLeaf = () => ({
    openFile: async () => {
      leafOpenCalls += 1;
      await leafGate.promise;
    },
  });
  host.workspace.getActiveViewOfType = () => ({
    file,
    editor: {
      setCursor: (position) => cursorPositions.push(position),
      scrollIntoView: (range, center) => scrollRanges.push({ range, center }),
    },
  });
  const originalOpenSourceLine = host.plugin.openFoodLogSourceLine.bind(host.plugin);
  let pendingOpen;
  host.plugin.openFoodLogSourceLine = (...args) => {
    pendingOpen = originalOpenSourceLine(...args);
    return pendingOpen;
  };

  openLine.click();
  await waitFor(() => leafOpenCalls === 1, "source-line leaf opening did not begin");
  host.contents.set(file.path, `# Inserted while opening\n${foodLogRow}`);
  leafGate.resolve();
  await pendingOpen;
  assert.deepEqual(cursorPositions, [{ line: 1, ch: 0 }]);
  assert.deepEqual(scrollRanges, [{
    range: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } },
    center: true,
  }]);

  host.contents.set(file.path, foodLogRow);
  globalThis.__healthTestNotices.length = 0;
  leafGate = deferred();
  pendingOpen = undefined;
  openLine.click();
  await waitFor(() => leafOpenCalls === 2, "second source-line leaf opening did not begin");
  host.contents.set(file.path, "- 1 serving - Toast <!-- [type:: foodLog] [food:: Toast] [qty:: 1] [unit:: serving] [foodId:: row-2] -->");
  leafGate.resolve();
  await pendingOpen;
  assert.deepEqual(cursorPositions, [{ line: 1, ch: 0 }], "a removed row must not receive a stale cursor");
  assert.equal(scrollRanges.length, 1);
  assert.deepEqual(globalThis.__healthTestNotices, ["That food-log row changed. Refresh and try again."]);
  host.plugin.__testUnload();
});

test("public food-row update re-resolves and preserves concurrent edits inside Vault.process", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  host.plugin.settings.automaticDailyRollups = false;
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const adjust = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Adjust serving consumed");
  assert.equal(typeof adjust?.click, "function");

  const updatedRow = foodLogRow.replace("[qty:: 1]", "[qty:: 2]");
  const originalReplace = host.plugin.replaceFoodLogEntryLine.bind(host.plugin);
  let pendingUpdate;
  host.plugin.openAdjustFoodLogServing = (entry, _afterSave, assertCurrent) => {
    pendingUpdate = originalReplace(entry, updatedRow, "Updated food serving", assertCurrent);
  };
  host.vaultHooks.process = async (processedFile) => {
    if (processedFile === file) host.contents.set(file.path, `# Concurrent heading\n${foodLogRow}`);
  };

  adjust.click();
  assert.ok(pendingUpdate, "the public update action did not start");
  await pendingUpdate;

  assert.equal(host.contents.get(file.path), `# Concurrent heading\n${updatedRow}`);
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(host.vaultCalls.modify, 0);
  assert.deepEqual(globalThis.__healthTestNotices, ["Updated food serving"]);
  host.plugin.__testUnload();
});

test("public food-row delete re-resolves and preserves concurrent edits inside Vault.process", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  host.plugin.settings.automaticDailyRollups = false;
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const remove = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Delete food log entry");
  assert.equal(typeof remove?.click, "function");

  const originalDelete = host.plugin.deleteFoodLogEntries.bind(host.plugin);
  let pendingDelete;
  let afterDeleteCalls = 0;
  host.plugin.deleteFoodLogEntries = (entries, _afterDelete, assertCurrent) => {
    pendingDelete = originalDelete(entries, () => { afterDeleteCalls += 1; }, assertCurrent);
    return pendingDelete;
  };
  host.vaultHooks.process = async (processedFile) => {
    if (processedFile === file) host.contents.set(file.path, `# Concurrent heading\n${foodLogRow}`);
  };

  remove.click();
  assert.ok(pendingDelete, "the public delete action did not start");
  await pendingDelete;

  assert.equal(host.contents.get(file.path), "# Concurrent heading");
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(host.vaultCalls.modify, 0);
  assert.equal(afterDeleteCalls, 1);
  assert.deepEqual(globalThis.__healthTestNotices, ["Deleted food log entry"]);
  host.plugin.__testUnload();
});

test("unload while an atomic food-row update is awaiting current content prevents its write", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const adjust = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Adjust serving consumed");
  assert.equal(typeof adjust?.click, "function");

  const updatedRow = foodLogRow.replace("[qty:: 1]", "[qty:: 2]");
  const originalReplace = host.plugin.replaceFoodLogEntryLine.bind(host.plugin);
  let pendingUpdate;
  host.plugin.openAdjustFoodLogServing = (entry, _afterSave, assertCurrent) => {
    assert.equal(typeof assertCurrent, "function", "the public menu must propagate its lifecycle guard");
    pendingUpdate = originalReplace(entry, updatedRow, "Updated food serving", assertCurrent);
  };
  let rollupCalls = 0;
  host.plugin.updateDailyRollupForFile = async () => { rollupCalls += 1; };
  const modifyGate = deferred();
  host.vaultHooks.process = async (modifiedFile) => {
    if (modifiedFile === file) await modifyGate.promise;
  };

  adjust.click();
  await waitFor(() => host.vaultCalls.process === 1, "food-row update did not reach the atomic vault write");
  host.plugin.__testUnload();
  modifyGate.resolve();

  await assert.rejects(pendingUpdate, /unavailable/i);
  assert.equal(host.contents.get(file.path), foodLogRow);
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(host.vaultCalls.modify, 0);
  assert.equal(rollupCalls, 0);
  assert.deepEqual(globalThis.__healthTestNotices, []);
});

test("unload while an atomic food-row delete is awaiting current content prevents its write", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const remove = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Delete food log entry");
  assert.equal(typeof remove?.click, "function");

  const originalDelete = host.plugin.deleteFoodLogEntries.bind(host.plugin);
  let pendingDelete;
  let afterDeleteCalls = 0;
  host.plugin.deleteFoodLogEntries = (entries, _afterDelete, assertCurrent) => {
    assert.equal(typeof assertCurrent, "function", "the public menu must propagate its lifecycle guard");
    pendingDelete = originalDelete(entries, () => { afterDeleteCalls += 1; }, assertCurrent);
    return pendingDelete;
  };
  let rollupCalls = 0;
  host.plugin.updateDailyRollupForFile = async () => { rollupCalls += 1; };
  const modifyGate = deferred();
  host.vaultHooks.process = async (modifiedFile) => {
    if (modifiedFile === file) await modifyGate.promise;
  };

  remove.click();
  await waitFor(() => host.vaultCalls.process === 1, "food-row delete did not reach the atomic vault write");
  host.plugin.__testUnload();
  modifyGate.resolve();

  await assert.rejects(pendingDelete, /unavailable/i);
  assert.equal(host.contents.get(file.path), foodLogRow);
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(host.vaultCalls.modify, 0);
  assert.equal(rollupCalls, 0);
  assert.equal(afterDeleteCalls, 0);
  assert.deepEqual(globalThis.__healthTestNotices, []);
});

test("unload after the atomic food-row updater returns fences post-write effects", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const adjust = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Adjust serving consumed");
  assert.equal(typeof adjust?.click, "function");

  const updatedRow = foodLogRow.replace("[qty:: 1]", "[qty:: 2]");
  const originalReplace = host.plugin.replaceFoodLogEntryLine.bind(host.plugin);
  let pendingUpdate;
  host.plugin.openAdjustFoodLogServing = (entry, _afterSave, assertCurrent) => {
    pendingUpdate = originalReplace(entry, updatedRow, "Updated food serving", assertCurrent);
  };
  let rollupCalls = 0;
  host.plugin.updateDailyRollupForFile = async () => { rollupCalls += 1; };
  const commitGate = deferred();
  let updaterReturns = 0;
  host.vaultHooks.processAfterUpdate = async (processedFile) => {
    if (processedFile !== file) return;
    updaterReturns += 1;
    await commitGate.promise;
  };

  adjust.click();
  await waitFor(() => updaterReturns === 1, "food-row update callback did not return its atomic write");
  host.plugin.__testUnload();
  commitGate.resolve();

  await assert.rejects(pendingUpdate, /unavailable/i);
  assert.equal(host.contents.get(file.path), updatedRow, "the callback-returned atomic write may finish after unload");
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(host.vaultCalls.modify, 0);
  assert.equal(rollupCalls, 0);
  assert.deepEqual(globalThis.__healthTestNotices, []);
});

test("unload after the atomic food-row delete updater returns fences post-write effects", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const remove = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Delete food log entry");
  assert.equal(typeof remove?.click, "function");

  const originalDelete = host.plugin.deleteFoodLogEntries.bind(host.plugin);
  let pendingDelete;
  let afterDeleteCalls = 0;
  host.plugin.deleteFoodLogEntries = (entries, _afterDelete, assertCurrent) => {
    pendingDelete = originalDelete(entries, () => { afterDeleteCalls += 1; }, assertCurrent);
    return pendingDelete;
  };
  let rollupCalls = 0;
  host.plugin.updateDailyRollupForFile = async () => { rollupCalls += 1; };
  const commitGate = deferred();
  let updaterReturns = 0;
  host.vaultHooks.processAfterUpdate = async (processedFile) => {
    if (processedFile !== file) return;
    updaterReturns += 1;
    await commitGate.promise;
  };

  remove.click();
  await waitFor(() => updaterReturns === 1, "food-row delete callback did not return its atomic write");
  host.plugin.__testUnload();
  commitGate.resolve();

  await assert.rejects(pendingDelete, /unavailable/i);
  assert.equal(host.contents.get(file.path), "", "the callback-returned atomic delete write may finish after unload");
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(host.vaultCalls.modify, 0);
  assert.equal(rollupCalls, 0);
  assert.equal(afterDeleteCalls, 0);
  assert.deepEqual(globalThis.__healthTestNotices, []);
});

test("unload during a post-update rollup fences the stale completion notice", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  host.plugin.settings.automaticDailyRollups = true;
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const adjust = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Adjust serving consumed");
  assert.equal(typeof adjust?.click, "function");

  const updatedRow = foodLogRow.replace("[qty:: 1]", "[qty:: 2]");
  const originalReplace = host.plugin.replaceFoodLogEntryLine.bind(host.plugin);
  let pendingUpdate;
  host.plugin.openAdjustFoodLogServing = (entry, _afterSave, assertCurrent) => {
    pendingUpdate = originalReplace(entry, updatedRow, "Updated food serving", assertCurrent);
  };
  const rollupGate = deferred();
  let rollupCalls = 0;
  host.plugin.updateDailyRollupForFile = async (rollupFile) => {
    assert.equal(rollupFile, file);
    rollupCalls += 1;
    await rollupGate.promise;
  };

  adjust.click();
  await waitFor(() => rollupCalls === 1, "post-update rollup did not begin");
  host.plugin.__testUnload();
  rollupGate.resolve();

  await assert.rejects(pendingUpdate, /unavailable/i);
  assert.equal(host.contents.get(file.path), updatedRow);
  assert.equal(host.vaultCalls.process, 1);
  assert.deepEqual(globalThis.__healthTestNotices, []);
});

test("unload during a post-delete rollup fences stale notice and callback effects", async () => {
  resetHealthUiSurfaces();
  const host = createHealthHost();
  const file = host.addFile("Daily Notes/Food.md", foodLogRow);
  const descriptor = await loadPublishedHealthHost(host);
  host.plugin.settings.automaticDailyRollups = true;
  assert.deepEqual(await descriptor.api.openFoodLogEntryMenu(foodMenuRequest()), { status: "opened" });
  const remove = globalThis.__healthTestMenus[0].items.find((item) => item.title === "Delete food log entry");
  assert.equal(typeof remove?.click, "function");

  const originalDelete = host.plugin.deleteFoodLogEntries.bind(host.plugin);
  let pendingDelete;
  let afterDeleteCalls = 0;
  host.plugin.deleteFoodLogEntries = (entries, _afterDelete, assertCurrent) => {
    pendingDelete = originalDelete(entries, () => { afterDeleteCalls += 1; }, assertCurrent);
    return pendingDelete;
  };
  const rollupGate = deferred();
  let rollupCalls = 0;
  host.plugin.updateDailyRollupForFile = async (rollupFile) => {
    assert.equal(rollupFile, file);
    rollupCalls += 1;
    await rollupGate.promise;
  };

  remove.click();
  await waitFor(() => rollupCalls === 1, "post-delete rollup did not begin");
  host.plugin.__testUnload();
  rollupGate.resolve();

  await assert.rejects(pendingDelete, /unavailable/i);
  assert.equal(host.contents.get(file.path), "");
  assert.equal(host.vaultCalls.process, 1);
  assert.equal(afterDeleteCalls, 0);
  assert.deepEqual(globalThis.__healthTestNotices, []);
});
