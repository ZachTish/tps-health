import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

let clientModule;

async function loadClientModule() {
  if (clientModule) return clientModule;
  const outdir = await mkdtemp(join(tmpdir(), "tps-health-ui-client-"));
  const outfile = join(outdir, "health-ui-client.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/tps-health-ui-client.ts", import.meta.url))],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  clientModule = await import(pathToFileURL(outfile).href);
  test.after(async () => rm(outdir, { recursive: true, force: true }));
  return clientModule;
}

class FakeWorkspace {
  listeners = new Map();
  requestCount = 0;

  on(name, callback) {
    const ref = { name, callback };
    const listeners = this.listeners.get(name) || [];
    listeners.push(ref);
    this.listeners.set(name, listeners);
    return ref;
  }

  trigger(name, ...args) {
    if (name === "tps:health-ui-api-request") this.requestCount += 1;
    for (const ref of Array.from(this.listeners.get(name) || [])) ref.callback(...args);
  }

  offref(ref) {
    const listeners = this.listeners.get(ref.name) || [];
    this.listeners.set(ref.name, listeners.filter((candidate) => candidate !== ref));
  }

  listenerCount(name) {
    return (this.listeners.get(name) || []).length;
  }
}

function createApi(identity) {
  return {
    apiVersion: 1,
    supportedHomeActionIds: [
      "tps-health:log-food",
      "tps-health:log-activity",
      "tps-health:start-workout",
    ],
    identity,
    executeHomeAction() {
      return this.identity === identity;
    },
    async prepareFoodDescription() {
      return { status: "prepared" };
    },
    async ensureLogBase(kind) {
      return kind === "food" ? "Food Log.base" : "Activity Log.base";
    },
    getMetricRenderConfigs() {
      return [{ propertyKey: "protein", label: this.identity, unit: "g", kind: "min", min: 100 }];
    },
    isWorkoutFile(path) {
      return this.identity === identity && path.includes("Workout");
    },
    async openFoodLogEntryMenu() {
      return { status: "opened" };
    },
  };
}

function createDescriptor(identityOrApi) {
  return {
    protocolVersion: 1,
    providerPluginId: "tps-health",
    api: typeof identityOrApi === "string" ? createApi(identityOrApi) : identityOrApi,
  };
}

async function createClient(options = {}) {
  const { TPSHealthUiClient } = await loadClientModule();
  const workspace = options.workspace || new FakeWorkspace();
  const refs = [];
  const client = new TPSHealthUiClient({ workspace }, "tps-global-context-menu");
  client.start(
    options.registerEvent || ((ref) => refs.push(ref)),
    options.onAvailabilityChanged,
  );
  return { client, workspace, refs };
}

test("consumer-first discovery accepts later availability and preserves method receivers", async () => {
  const availability = [];
  const { client, workspace, refs } = await createClient({
    onAvailabilityChanged: (api) => availability.push(api ? api.getMetricRenderConfigs()[0].label : "unavailable"),
  });
  assert.equal(client.getApi(), undefined);
  assert.equal(client.getApi(), undefined);
  assert.equal(client.getApi(), undefined);
  assert.equal(refs.length, 2);
  assert.equal(workspace.requestCount, 1, "absent cache reads must not rebroadcast discovery requests");

  const descriptor = createDescriptor("late");
  workspace.trigger("tps:health-ui-api-available", descriptor);
  const api = client.getApi();
  assert.ok(api);
  assert.equal(api.getMetricRenderConfigs()[0].label, "late");
  assert.equal(api.isWorkoutFile("Health/Workout.md"), true);
  assert.equal(workspace.requestCount, 1, "cached reads must not rebroadcast discovery requests");
  assert.deepEqual(availability, ["unavailable", "late"]);
});

test("provider-first request discovery accepts only the first valid synchronous responder", async () => {
  const workspace = new FakeWorkspace();
  const descriptorA = createDescriptor("A");
  const descriptorB = createDescriptor("B");
  workspace.on("tps:health-ui-api-request", (request) => {
    request.accept({ protocolVersion: 1, providerPluginId: "other", api: descriptorA.api });
    request.accept(descriptorA);
  });
  workspace.on("tps:health-ui-api-request", (request) => request.accept(descriptorB));

  const availability = [];
  const { client } = await createClient({
    workspace,
    onAvailabilityChanged: (api) => availability.push(api?.getMetricRenderConfigs()[0].label || "unavailable"),
  });
  assert.equal(client.getApi().getMetricRenderConfigs()[0].label, "A");
  assert.deepEqual(availability, ["A"]);
  assert.equal(workspace.requestCount, 1);
});

test("request acceptance is synchronous-only across microtasks and timers", async () => {
  const workspace = new FakeWorkspace();
  const delayedAccepts = [];
  workspace.on("tps:health-ui-api-request", (request) => {
    delayedAccepts.push(() => request.accept(createDescriptor("delayed")));
    Promise.resolve().then(() => request.accept(createDescriptor("microtask")));
    setTimeout(() => request.accept(createDescriptor("timer")), 0);
  });
  const { client } = await createClient({ workspace });
  assert.equal(client.getApi(), undefined);
  for (const accept of delayedAccepts.splice(0)) accept();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(client.getApi(), undefined);
});

test("exact stale withdrawal cannot clear a replacement or resurrect a withdrawn provider", async () => {
  const { client, workspace } = await createClient();
  const descriptorA = createDescriptor("A");
  const descriptorB = createDescriptor("B");
  workspace.trigger("tps:health-ui-api-available", descriptorA);
  workspace.trigger("tps:health-ui-api-available", descriptorB);
  workspace.trigger("tps:health-ui-api-unavailable", descriptorA);
  assert.equal(client.getApi().getMetricRenderConfigs()[0].label, "B");

  workspace.trigger("tps:health-ui-api-unavailable", {
    protocolVersion: 1,
    providerPluginId: "tps-health",
    api: descriptorB.api,
  });
  assert.equal(client.getApi(), undefined);
  workspace.trigger("tps:health-ui-api-available", descriptorB);
  assert.equal(client.getApi(), undefined, "a delayed available event cannot resurrect withdrawn identity");
  workspace.trigger("tps:health-ui-api-available", createDescriptor(descriptorB.api));
  assert.equal(client.getApi(), undefined, "a new descriptor cannot reuse a withdrawn API identity");
  workspace.trigger("tps:health-ui-api-available", descriptorA);
  assert.equal(client.getApi(), undefined, "a stale withdrawal must tombstone without clearing its replacement");

  const descriptorRetiredBeforeAvailability = createDescriptor("retired-before-availability");
  workspace.trigger("tps:health-ui-api-unavailable", descriptorRetiredBeforeAvailability);
  workspace.trigger("tps:health-ui-api-available", descriptorRetiredBeforeAvailability);
  assert.equal(client.getApi(), undefined, "withdrawal without a cached provider prevents delayed resurrection");

  const descriptorC = createDescriptor("C");
  workspace.trigger("tps:health-ui-api-available", descriptorC);
  assert.equal(client.getApi().getMetricRenderConfigs()[0].label, "C");
});

test("exact descriptor identity withdraws even after its getters become hostile", async () => {
  const { client, workspace } = await createClient();
  const api = createApi("hostile-after-publish");
  let hostile = false;
  const descriptorTarget = { protocolVersion: 1, providerPluginId: "tps-health", api };
  const descriptor = new Proxy(descriptorTarget, {
    getOwnPropertyDescriptor(target, key) {
      if (hostile) throw new Error("descriptor retired");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  workspace.trigger("tps:health-ui-api-available", descriptor);
  assert.ok(client.getApi());
  hostile = true;
  assert.doesNotThrow(() => workspace.trigger("tps:health-ui-api-unavailable", descriptor));
  assert.equal(client.getApi(), undefined);
});

test("reentrant announcements cannot let a request response overwrite newer state", async () => {
  const workspace = new FakeWorkspace();
  const descriptorA = createDescriptor("A");
  const descriptorB = createDescriptor("B");
  workspace.on("tps:health-ui-api-request", (request) => {
    workspace.trigger("tps:health-ui-api-available", descriptorB);
    request.accept(descriptorA);
  });
  const { client } = await createClient({ workspace });
  assert.equal(client.getApi().getMetricRenderConfigs()[0].label, "B");

  const workspaceSecond = new FakeWorkspace();
  workspaceSecond.on("tps:health-ui-api-request", (request) => {
    request.accept(descriptorA);
    workspaceSecond.trigger("tps:health-ui-api-available", descriptorB);
  });
  const second = await createClient({ workspace: workspaceSecond });
  assert.equal(second.client.getApi().getMetricRenderConfigs()[0].label, "B");
});

test("availability callbacks are isolated and can reentrantly withdraw the accepted descriptor", async () => {
  const workspace = new FakeWorkspace();
  const descriptor = createDescriptor("reentrant");
  let client;
  const notifications = [];
  ({ client } = await createClient({
    workspace,
    onAvailabilityChanged: (api) => {
      notifications.push(api ? "available" : "unavailable");
      if (api) workspace.trigger("tps:health-ui-api-unavailable", descriptor);
      throw new Error("consumer callback failure");
    },
  }));
  assert.doesNotThrow(() => workspace.trigger("tps:health-ui-api-available", descriptor));
  assert.equal(client.getApi(), undefined);
  assert.deepEqual(notifications, ["unavailable", "available", "unavailable"]);
});

test("dispose finishes before its unavailable callback can restart the client", async () => {
  const workspace = new FakeWorkspace();
  const descriptor = createDescriptor("provider");
  workspace.on("tps:health-ui-api-request", (request) => request.accept(descriptor));
  const { TPSHealthUiClient } = await loadClientModule();
  const client = new TPSHealthUiClient({ workspace }, "tps-global-context-menu");
  const refs = [];
  let restartOnUnavailable = false;
  const restartedAvailability = [];
  client.start((ref) => refs.push(ref), (api) => {
    if (!api && restartOnUnavailable) {
      restartOnUnavailable = false;
      client.start((ref) => refs.push(ref), (nextApi) => {
        restartedAvailability.push(nextApi ? "available" : "unavailable");
      });
    }
  });
  assert.ok(client.getApi());
  restartOnUnavailable = true;
  client.dispose();
  assert.ok(client.getApi(), "reentrant start must survive the remainder of dispose");
  assert.deepEqual(restartedAvailability, ["available"]);
  assert.equal(refs.length, 4);
  assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 1);
  assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 1);
});

test("dispose physically removes owned listener refs and restart installs only one fresh pair", async () => {
  const { client, workspace } = await createClient();
  assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 1);
  assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 1);

  client.dispose();
  assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 0);
  assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 0);

  client.start(() => {});
  assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 1);
  assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 1);
  assert.equal(workspace.requestCount, 2, "each lifecycle makes exactly one startup request");

  client.dispose();
  assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 0);
  assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 0);
});

test("throwing request listeners and registration callbacks do not corrupt validated state", async () => {
  const workspace = new FakeWorkspace();
  const descriptor = createDescriptor("accepted-before-throw");
  workspace.on("tps:health-ui-api-request", (request) => request.accept(descriptor));
  workspace.on("tps:health-ui-api-request", () => { throw new Error("later listener failed"); });
  let registrations = 0;
  const { client } = await createClient({
    workspace,
    registerEvent: () => {
      registrations += 1;
      if (registrations === 1) throw new Error("registration owner failed");
    },
  });
  assert.equal(client.getApi().getMetricRenderConfigs()[0].label, "accepted-before-throw");
  assert.equal(registrations, 2);
});

test("failure to create either lifecycle listener rolls back before discovery", async () => {
  const { TPSHealthUiClient } = await loadClientModule();
  for (const failedEvent of ["tps:health-ui-api-available", "tps:health-ui-api-unavailable"]) {
    const workspace = new FakeWorkspace();
    const originalOn = workspace.on.bind(workspace);
    let shouldFail = true;
    workspace.on = (name, callback) => {
      if (shouldFail && name === failedEvent) throw new Error(`cannot register ${name}`);
      return originalOn(name, callback);
    };
    const availability = [];
    const client = new TPSHealthUiClient({ workspace }, "tps-global-context-menu");
    assert.throws(
      () => client.start(() => {}, (api) => availability.push(api)),
      /cannot register/,
    );
    assert.equal(client.getApi(), undefined);
    assert.equal(workspace.requestCount, 0);
    assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 0);
    assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 0);
    assert.deepEqual(availability, []);

    shouldFail = false;
    client.start(() => {}, (api) => availability.push(api));
    assert.equal(workspace.requestCount, 1);
    assert.equal(workspace.listenerCount("tps:health-ui-api-available"), 1);
    assert.equal(workspace.listenerCount("tps:health-ui-api-unavailable"), 1);
    assert.deepEqual(availability, [undefined]);
    client.dispose();
  }
});

test("dispose rejects delayed availability and all private discovery fallbacks remain absent", async () => {
  const availability = [];
  const { client, workspace } = await createClient({
    onAvailabilityChanged: (api) => availability.push(api ? "available" : "unavailable"),
  });
  const descriptor = createDescriptor("before-dispose");
  workspace.trigger("tps:health-ui-api-available", descriptor);
  client.dispose();
  workspace.trigger("tps:health-ui-api-available", createDescriptor("after-dispose"));
  assert.equal(client.getApi(), undefined);
  assert.deepEqual(availability, ["unavailable", "available", "unavailable"]);

  const source = await readFile(new URL("../src/tps-health-ui-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getPlugin|plugins\.plugins|app\.tpsHealth|\.tpsHealth\b/);
  assert.match(source, /TPS_HEALTH_UI_SERVICE_EVENTS\.REQUEST/);
  assert.match(source, /accepting = false/);
});
