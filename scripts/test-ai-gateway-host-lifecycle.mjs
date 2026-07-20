import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const GATEWAY_REQUEST = "tps:ai-gateway-api-request";
const GATEWAY_AVAILABLE = "tps:ai-gateway-api-available";
const GATEWAY_UNAVAILABLE = "tps:ai-gateway-api-unavailable";

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

  onLayoutReady(callback) {
    this.layoutCallbacks.push(callback);
  }

  getActiveFile() {
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
let nextTimerId = 1;
globalThis.window = {
  setTimeout: () => nextTimerId++,
  clearTimeout: () => undefined,
  setInterval: () => nextTimerId++,
  clearInterval: () => undefined,
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
export class Modal { constructor(app) { this.app = app; } open() {} close() {} }
export class Menu {
  addItem(callback) {
    callback?.({ setTitle() { return this; }, setIcon() { return this; }, onClick() { return this; } });
    return this;
  }
  showAtMouseEvent() {}
}
export class Notice {}
export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; }
  display() {}
}
export class Setting {
  constructor() {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addButton() { return this; }
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
});

function createHealthHost() {
  const workspace = new FakeWorkspace();
  const vault = new FakeEvents();
  vault.getMarkdownFiles = () => [];
  vault.getAbstractFileByPath = () => null;
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
  return { app, plugin, workspace };
}

function gatewayListenerCount(workspace) {
  return workspace.listenerCount(GATEWAY_AVAILABLE) + workspace.listenerCount(GATEWAY_UNAVAILABLE);
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
