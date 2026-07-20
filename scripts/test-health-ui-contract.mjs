import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

let contractModule;

async function loadContractModule() {
  if (contractModule) return contractModule;
  const outdir = await mkdtemp(join(tmpdir(), "tps-health-ui-contract-"));
  const outfile = join(outdir, "health-ui-contract.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/tps-health-ui-contract.ts", import.meta.url))],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  contractModule = await import(pathToFileURL(outfile).href);
  test.after(async () => rm(outdir, { recursive: true, force: true }));
  return contractModule;
}

const exactContext = {
  source: "tps-home",
  dateIso: "2026-07-19",
  dailyNotePath: "Daily Notes/2026-07-19.md",
  componentId: "base:food-log.base",
  basePath: "Food Log.base",
};

const menuRequest = {
  clientX: 120,
  clientY: 240,
  screenX: -900,
  screenY: 340,
  filePath: "Daily Notes/2026-07-19.md",
  lineNumber: 14,
  renderedLine: "- [ ] Greek yogurt [type:: foodLog]",
};

function createRawApi(identity = "raw", overrides = {}) {
  const calls = [];
  const metrics = [{
    propertyKey: "protein",
    label: "Protein",
    unit: "g",
    kind: "range",
    goal: 150,
    min: 120,
    max: 180,
    color: "var(--color-green)",
  }];
  const api = {
    apiVersion: 1,
    supportedHomeActionIds: [
      "tps-health:log-food",
      "tps-health:log-activity",
      "tps-health:start-workout",
    ],
    identity,
    executeHomeAction(commandId, context) {
      calls.push({ method: "executeHomeAction", identity: this.identity, commandId, context });
      return true;
    },
    prepareFoodDescription(request) {
      calls.push({ method: "prepareFoodDescription", identity: this.identity, request });
      return Promise.resolve({ status: "prepared", ignored: true });
    },
    ensureLogBase(kind) {
      calls.push({ method: "ensureLogBase", identity: this.identity, kind });
      return Promise.resolve(kind === "food" ? "Food Log.base" : "Activity Log.base");
    },
    getMetricRenderConfigs() {
      calls.push({ method: "getMetricRenderConfigs", identity: this.identity });
      return metrics;
    },
    isWorkoutFile(path) {
      calls.push({ method: "isWorkoutFile", identity: this.identity, path });
      return path.includes("Workout");
    },
    openFoodLogEntryMenu(request) {
      calls.push({ method: "openFoodLogEntryMenu", identity: this.identity, request });
      return Promise.resolve({ status: "opened", ignored: true });
    },
    ...overrides,
  };
  return { api, calls, metrics };
}

test("Health UI contract publishes an exact frozen six-capability surface", async () => {
  const contract = await loadContractModule();
  assert.deepEqual(contract.TPS_HEALTH_UI_SERVICE_EVENTS, {
    REQUEST: "tps:health-ui-api-request",
    AVAILABLE: "tps:health-ui-api-available",
    UNAVAILABLE: "tps:health-ui-api-unavailable",
  });
  assert.equal(Object.isFrozen(contract.TPS_HEALTH_UI_SERVICE_EVENTS), true);
  assert.equal(Object.isFrozen(contract.TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS), true);
  assert.deepEqual(contract.TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS, [
    "tps-health:log-food",
    "tps-health:log-activity",
    "tps-health:start-workout",
  ]);

  const { api: rawApi } = createRawApi();
  const api = contract.createTPSHealthUiApi(rawApi);
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api).sort(), [
    "apiVersion",
    "ensureLogBase",
    "executeHomeAction",
    "getMetricRenderConfigs",
    "isWorkoutFile",
    "openFoodLogEntryMenu",
    "prepareFoodDescription",
    "supportedHomeActionIds",
  ]);
  const descriptor = contract.createTPSHealthUiServiceDescriptor(rawApi);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(descriptor.protocolVersion, 1);
  assert.equal(descriptor.providerPluginId, "tps-health");
  assert.equal(contract.isTPSHealthUiApi(api), true);
  assert.equal(contract.isTPSHealthUiServiceDescriptor(descriptor), true);
});

test("descriptor parsing preserves exact identities, receiver binding, and detached frozen values", async () => {
  const contract = await loadContractModule();
  const { api: rawApi, calls, metrics } = createRawApi("bound");
  const rawDescriptor = { protocolVersion: 1, providerPluginId: "tps-health", api: rawApi };
  const descriptor = contract.parseTPSHealthUiServiceDescriptor(rawDescriptor);
  assert.ok(descriptor);
  assert.equal(descriptor.sourceDescriptor, rawDescriptor);
  assert.equal(descriptor.api.sourceApi, rawApi);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.api), true);
  assert.equal(Object.isFrozen(descriptor.api.supportedHomeActionIds), true);

  const mutableContext = { ...exactContext };
  const homeActionPromise = descriptor.api.executeHomeAction("tps-health:log-food", mutableContext);
  assert.equal(calls.at(-1).method, "executeHomeAction", "provider invocation must begin synchronously");
  mutableContext.dailyNotePath = "Changed.md";
  assert.equal(await homeActionPromise, true);
  assert.equal(calls[0].identity, "bound");
  assert.notEqual(calls[0].context, mutableContext);
  assert.equal(calls[0].context.dailyNotePath, exactContext.dailyNotePath);
  assert.equal(Object.isFrozen(calls[0].context), true);

  const descriptionRequest = { description: "Two eggs and toast", context: { ...exactContext } };
  const preparedPromise = descriptor.api.prepareFoodDescription(descriptionRequest);
  assert.equal(calls.at(-1).method, "prepareFoodDescription", "provider invocation must begin synchronously");
  descriptionRequest.context.dailyNotePath = "Changed.md";
  const prepared = await preparedPromise;
  assert.deepEqual(prepared, { status: "prepared" });
  assert.equal(Object.isFrozen(prepared), true);
  const preparedCall = calls.find((call) => call.method === "prepareFoodDescription");
  assert.notEqual(preparedCall.request, descriptionRequest);
  assert.equal(preparedCall.request.context.dailyNotePath, exactContext.dailyNotePath);
  assert.equal(Object.isFrozen(preparedCall.request), true);
  assert.equal(Object.isFrozen(preparedCall.request.context), true);

  assert.equal(await descriptor.api.ensureLogBase("food"), "Food Log.base");
  const configs = descriptor.api.getMetricRenderConfigs();
  assert.notEqual(configs, metrics);
  assert.notEqual(configs[0], metrics[0]);
  assert.equal(Object.isFrozen(configs), true);
  assert.equal(Object.isFrozen(configs[0]), true);
  metrics[0].label = "Changed";
  metrics.push({ propertyKey: "late", label: "Late", unit: "", kind: "counter" });
  assert.equal(configs.length, 1);
  assert.equal(configs[0].label, "Protein");
  assert.equal(descriptor.api.isWorkoutFile("Health/Workouts/Workout.md"), true);

  const mutableMenuRequest = { ...menuRequest };
  const menuResultPromise = descriptor.api.openFoodLogEntryMenu(mutableMenuRequest);
  mutableMenuRequest.filePath = "Changed.md";
  const menuResult = await menuResultPromise;
  assert.deepEqual(menuResult, { status: "opened" });
  assert.equal(Object.isFrozen(menuResult), true);
  const menuCall = calls.find((call) => call.method === "openFoodLogEntryMenu");
  assert.equal(menuCall.identity, "bound");
  assert.notEqual(menuCall.request, mutableMenuRequest);
  assert.equal(menuCall.request.filePath, menuRequest.filePath);
  assert.equal(Object.isFrozen(menuCall.request), true);
});

test("all capability inputs and outputs are strictly bounded and fail closed", async () => {
  const contract = await loadContractModule();
  const { api: rawApi, calls } = createRawApi();
  const api = contract.parseTPSHealthUiApiSnapshot(rawApi);
  assert.ok(api);

  await assert.rejects(api.executeHomeAction("other:command", exactContext), TypeError);
  await assert.rejects(api.executeHomeAction("tps-health:log-food", { ...exactContext, dateIso: "2026-02-31" }), TypeError);
  await assert.rejects(api.executeHomeAction("tps-health:log-food", { ...exactContext, dailyNotePath: "../Outside.md" }), TypeError);
  assert.equal(calls.length, 0);

  await assert.rejects(api.prepareFoodDescription({ description: "   ", context: exactContext }), TypeError);
  await assert.rejects(api.ensureLogBase("workout"), TypeError);
  assert.throws(() => api.isWorkoutFile("Health/Workouts/Workout.canvas"), TypeError);
  await assert.rejects(api.openFoodLogEntryMenu({ ...menuRequest, lineNumber: -1 }), TypeError);
  await assert.rejects(api.openFoodLogEntryMenu({ ...menuRequest, clientX: Number.POSITIVE_INFINITY }), TypeError);
  assert.equal(calls.length, 0, "invalid arguments must not reach provider methods");

  const invalidCases = [
    ["executeHomeAction", { executeHomeAction: () => "yes" }, () => "sync"],
    ["prepareFoodDescription", { prepareFoodDescription: () => ({ status: "queued" }) }, () => "async"],
    ["ensureLogBase", { ensureLogBase: () => "../Food Log.base" }, () => "async"],
    ["getMetricRenderConfigs", { getMetricRenderConfigs: () => [{ propertyKey: "x", label: "X", unit: "g", kind: "range", min: 2, max: 1 }] }, () => "sync"],
    ["isWorkoutFile", { isWorkoutFile: () => "yes" }, () => "sync"],
    ["openFoodLogEntryMenu", { openFoodLogEntryMenu: () => ({ status: "guessed" }) }, () => "async"],
  ];
  for (const [name, override, mode] of invalidCases) {
    const invalidApi = contract.parseTPSHealthUiApiSnapshot(createRawApi("invalid", override).api);
    assert.ok(invalidApi, `${name} API shape should parse before its result is checked`);
    if (name === "executeHomeAction") {
      await assert.rejects(invalidApi.executeHomeAction("tps-health:log-food", exactContext), TypeError);
    } else if (name === "prepareFoodDescription") {
      await assert.rejects(invalidApi.prepareFoodDescription({ description: "food", context: exactContext }), TypeError);
    } else if (name === "ensureLogBase") {
      await assert.rejects(invalidApi.ensureLogBase("food"), TypeError);
    } else if (name === "getMetricRenderConfigs") {
      assert.throws(() => invalidApi.getMetricRenderConfigs(), TypeError);
    } else if (name === "isWorkoutFile") {
      assert.throws(() => invalidApi.isWorkoutFile("Workout.md"), TypeError);
    } else if (name === "openFoodLogEntryMenu") {
      await assert.rejects(invalidApi.openFoodLogEntryMenu(menuRequest), TypeError);
    }
    assert.ok(mode() === "sync" || mode() === "async");
  }
});

test("promise capabilities invoke synchronously and normalize provider throws into rejection", async () => {
  const contract = await loadContractModule();
  let invoked = false;
  const raw = createRawApi("throw", {
    prepareFoodDescription() {
      invoked = true;
      throw new Error("provider failed");
    },
  }).api;
  const api = contract.parseTPSHealthUiApiSnapshot(raw);
  let pending;
  assert.doesNotThrow(() => {
    pending = api.prepareFoodDescription({ description: "food", context: exactContext });
  });
  assert.equal(invoked, true);
  await assert.rejects(pending, /provider failed/);
});

test("hostile getters, proxies, and mutation cannot escape the bounded snapshots", async () => {
  const contract = await loadContractModule();
  const hostile = new Proxy({}, { get() { throw new Error("hostile getter"); } });
  assert.doesNotThrow(() => contract.parseTPSHealthUiServiceDescriptor(hostile));
  assert.equal(contract.parseTPSHealthUiServiceDescriptor(hostile), undefined);
  assert.equal(contract.parseTPSHealthUiExactContext(hostile), undefined);
  assert.equal(contract.parseTPSHealthUiFoodDescriptionRequest(hostile), undefined);
  assert.equal(contract.parseTPSHealthUiMetricRenderConfigs(new Proxy([], { get() { throw new Error("array getter"); } })), undefined);
  assert.equal(contract.parseTPSHealthUiFoodLogEntryMenuResult(hostile), undefined);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.doesNotThrow(() => contract.parseTPSHealthUiApiSnapshot(revoked.proxy));
  assert.equal(contract.parseTPSHealthUiApiSnapshot(revoked.proxy), undefined);

  const { api: rawApi } = createRawApi();
  const counts = new Map();
  const apiWithGetters = {};
  for (const key of [
    "apiVersion",
    "supportedHomeActionIds",
    "executeHomeAction",
    "prepareFoodDescription",
    "ensureLogBase",
    "getMetricRenderConfigs",
    "isWorkoutFile",
    "openFoodLogEntryMenu",
  ]) {
    Object.defineProperty(apiWithGetters, key, {
      enumerable: true,
      get() {
        counts.set(key, (counts.get(key) || 0) + 1);
        return rawApi[key];
      },
    });
  }
  const snapshot = contract.parseTPSHealthUiApiSnapshot(apiWithGetters);
  assert.equal(snapshot, undefined, "accessor-backed API fields are not canonical boundary data");
  assert.equal(counts.size, 0, "API accessors must be rejected without invocation");

  let discoveryGetterCalls = 0;
  const accessorDescriptor = {};
  for (const [key, value] of Object.entries({
    protocolVersion: 1,
    providerPluginId: "tps-health",
    api: rawApi,
  })) {
    Object.defineProperty(accessorDescriptor, key, {
      get() {
        discoveryGetterCalls += 1;
        return value;
      },
    });
  }
  assert.equal(contract.parseTPSHealthUiServiceDescriptor(accessorDescriptor), undefined);
  const accessorRequest = {};
  for (const [key, value] of Object.entries({
    protocolVersion: 1,
    consumerPluginId: "tps-global-context-menu",
    accept() {},
  })) {
    Object.defineProperty(accessorRequest, key, {
      get() {
        discoveryGetterCalls += 1;
        return value;
      },
    });
  }
  assert.equal(contract.parseTPSHealthUiServiceRequest(accessorRequest), undefined);
  assert.equal(discoveryGetterCalls, 0, "discovery accessors must be rejected without invocation");

  const outputHostile = contract.parseTPSHealthUiApiSnapshot(createRawApi("hostile-output", {
    openFoodLogEntryMenu: () => hostile,
  }).api);
  await assert.rejects(outputHostile.openFoodLogEntryMenu(menuRequest), TypeError);
});

test("request parsing is frozen, receiver-bound, and rejects malformed consumers", async () => {
  const contract = await loadContractModule();
  const accepted = [];
  const source = {
    protocolVersion: 1,
    consumerPluginId: "tps-global-context-menu",
    marker: "request",
    accept(descriptor) {
      accepted.push({ marker: this.marker, descriptor });
    },
  };
  const request = contract.parseTPSHealthUiServiceRequest(source);
  assert.ok(request);
  assert.equal(Object.isFrozen(request), true);
  const descriptor = { test: true };
  request.accept(descriptor);
  assert.deepEqual(accepted, [{ marker: "request", descriptor }]);
  assert.equal(contract.parseTPSHealthUiServiceRequest({ ...source, consumerPluginId: " spaced " }), undefined);
  assert.equal(contract.parseTPSHealthUiServiceRequest({ ...source, accept: true }), undefined);
});
