import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const EVENTS = Object.freeze({
  request: "tps:gcm-integration-api-request",
  available: "tps:gcm-integration-api-available",
  unavailable: "tps:gcm-integration-api-unavailable",
});

let modulesPromise;

async function loadModules() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const outdir = await mkdtemp(join(tmpdir(), "tps-gcm-integration-client-"));
      const clientOutfile = join(outdir, "gcm-integration-client.mjs");
      const contractOutfile = join(outdir, "gcm-integration-contract.mjs");
      await Promise.all([
        build({
          entryPoints: [fileURLToPath(new URL("../src/tps-gcm-integration-client.ts", import.meta.url))],
          outfile: clientOutfile,
          bundle: true,
          platform: "node",
          format: "esm",
          logLevel: "silent",
        }),
        build({
          entryPoints: [fileURLToPath(new URL("../src/tps-gcm-integration-contract.ts", import.meta.url))],
          outfile: contractOutfile,
          bundle: true,
          platform: "node",
          format: "esm",
          logLevel: "silent",
        }),
      ]);
      const [clientModule, contractModule] = await Promise.all([
        import(pathToFileURL(clientOutfile).href),
        import(pathToFileURL(contractOutfile).href),
      ]);
      test.after(async () => rm(outdir, { recursive: true, force: true }));
      return { clientModule, contractModule };
    })();
  }
  return modulesPromise;
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
    if (name === EVENTS.request) this.requestCount += 1;
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

function createApi(identity, overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    identity,
    registerExternalAction() {
      return () => {};
    },
    openFile() {
      return { status: "opened" };
    },
    startNoteTimer() {
      return { status: "started" };
    },
    stopNoteTimerForFile() {
      return { status: "stopped" };
    },
  }, overrides);
}

function createDescriptor(identityOrApi) {
  return {
    protocolVersion: 1,
    providerPluginId: "tps-global-context-menu",
    api: typeof identityOrApi === "string" ? createApi(identityOrApi) : identityOrApi,
  };
}

function apiIdentity(api) {
  return api?.sourceApi?.identity;
}

async function createClient(options = {}) {
  const { clientModule } = await loadModules();
  const workspace = options.workspace || new FakeWorkspace();
  const refs = [];
  const client = new clientModule.TPSGcmIntegrationClient({ workspace }, "tps-health");
  client.start(
    options.registerEvent || ((ref) => refs.push(ref)),
    options.onAvailabilityChanged,
  );
  return { client, workspace, refs };
}

test("consumer-first discovery accepts a late provider without polling", async () => {
  const availability = [];
  const { client, workspace, refs } = await createClient({
    onAvailabilityChanged: (api) => availability.push(apiIdentity(api) || "unavailable"),
  });

  assert.equal(client.getApi(), undefined);
  assert.equal(client.getApi(), undefined);
  assert.equal(workspace.requestCount, 1, "cache reads must not rebroadcast discovery");
  assert.equal(refs.length, 2);

  workspace.trigger(EVENTS.available, createDescriptor("late"));
  assert.equal(apiIdentity(client.getApi()), "late");
  assert.equal(workspace.requestCount, 1);
  assert.deepEqual(availability, ["unavailable", "late"]);
});

test("provider-first discovery accepts only the first valid synchronous responder", async () => {
  const workspace = new FakeWorkspace();
  const descriptorA = createDescriptor("A");
  const descriptorB = createDescriptor("B");
  let request;
  workspace.on(EVENTS.request, (candidate) => {
    request = candidate;
    candidate.accept({ ...descriptorA, providerPluginId: "not-gcm" });
    candidate.accept(descriptorA);
    candidate.accept(descriptorB);
  });
  workspace.on(EVENTS.request, (candidate) => candidate.accept(descriptorB));

  const availability = [];
  const { client } = await createClient({
    workspace,
    onAvailabilityChanged: (api) => availability.push(apiIdentity(api) || "unavailable"),
  });

  assert.equal(apiIdentity(client.getApi()), "A");
  assert.equal(workspace.requestCount, 1);
  assert.equal(Object.isFrozen(request), true);
  assert.deepEqual(
    { protocolVersion: request.protocolVersion, consumerPluginId: request.consumerPluginId },
    { protocolVersion: 1, consumerPluginId: "tps-health" },
  );
  assert.deepEqual(availability, ["A"]);
});

test("startup request acceptance is synchronous-only", async () => {
  const workspace = new FakeWorkspace();
  const delayedAccepts = [];
  workspace.on(EVENTS.request, (request) => {
    delayedAccepts.push(() => request.accept(createDescriptor("manual-late")));
    Promise.resolve().then(() => request.accept(createDescriptor("microtask")));
    setTimeout(() => request.accept(createDescriptor("timer")), 0);
  });

  const { client } = await createClient({ workspace });
  for (const accept of delayedAccepts.splice(0)) accept();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(client.getApi(), undefined);

  workspace.trigger(EVENTS.available, createDescriptor("announced"));
  assert.equal(apiIdentity(client.getApi()), "announced");
});

test("withdrawal uses exact descriptor and API identity across replacement and reload", async () => {
  const { client, workspace } = await createClient();
  const descriptorA = createDescriptor("A");
  const descriptorB = createDescriptor("B");

  workspace.trigger(EVENTS.available, descriptorA);
  workspace.trigger(EVENTS.available, descriptorB);
  workspace.trigger(EVENTS.unavailable, descriptorA);
  assert.equal(apiIdentity(client.getApi()), "B", "stale withdrawal must not clear a replacement");

  const equivalentB = createDescriptor(descriptorB.api);
  workspace.trigger(EVENTS.unavailable, equivalentB);
  assert.equal(client.getApi(), undefined, "the same source API identity must withdraw the current descriptor");
  workspace.trigger(EVENTS.available, descriptorB);
  workspace.trigger(EVENTS.available, equivalentB);
  assert.equal(client.getApi(), undefined, "a withdrawn API identity cannot be resurrected");

  const descriptorReloaded = createDescriptor("reloaded");
  workspace.trigger(EVENTS.available, descriptorReloaded);
  assert.equal(apiIdentity(client.getApi()), "reloaded", "a fresh provider instance is accepted after reload");
  workspace.trigger(EVENTS.unavailable, descriptorReloaded);
  assert.equal(client.getApi(), undefined);

  const retiredBeforeAnnouncement = createDescriptor("retired-first");
  workspace.trigger(EVENTS.unavailable, retiredBeforeAnnouncement);
  workspace.trigger(EVENTS.available, retiredBeforeAnnouncement);
  assert.equal(client.getApi(), undefined, "withdrawal tombstones delayed availability");
});

test("exact descriptor withdrawal survives a provider object becoming hostile", async () => {
  const { client, workspace } = await createClient();
  const target = createDescriptor("hostile-after-publish");
  let hostile = false;
  const descriptor = new Proxy(target, {
    getOwnPropertyDescriptor(source, key) {
      if (hostile) throw new Error("retired provider");
      return Reflect.getOwnPropertyDescriptor(source, key);
    },
  });

  workspace.trigger(EVENTS.available, descriptor);
  assert.equal(apiIdentity(client.getApi()), "hostile-after-publish");
  hostile = true;
  assert.doesNotThrow(() => workspace.trigger(EVENTS.unavailable, descriptor));
  assert.equal(client.getApi(), undefined);
});

test("malformed descriptors and hostile properties are ignored without disturbing valid state", async () => {
  const { client, workspace } = await createClient();
  const hostileDescriptor = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error("do not inspect me");
    },
  });
  const malformed = [
    null,
    [],
    {},
    { protocolVersion: 2, providerPluginId: "tps-global-context-menu", api: createApi("bad-version") },
    { protocolVersion: 1, providerPluginId: "other", api: createApi("bad-provider") },
    createDescriptor({ apiVersion: 1 }),
    Object.create(createDescriptor("inherited")),
    hostileDescriptor,
  ];

  for (const descriptor of malformed) {
    assert.doesNotThrow(() => workspace.trigger(EVENTS.available, descriptor));
    assert.equal(client.getApi(), undefined);
  }

  const valid = createDescriptor("valid");
  workspace.trigger(EVENTS.available, valid);
  for (const descriptor of malformed) {
    assert.doesNotThrow(() => workspace.trigger(EVENTS.available, descriptor));
    assert.doesNotThrow(() => workspace.trigger(EVENTS.unavailable, descriptor));
    assert.equal(apiIdentity(client.getApi()), "valid");
  }
});

test("API, request, and action callbacks preserve receivers and validate boundary values", async () => {
  const { contractModule } = await loadModules();
  const receivers = [];
  const providerRequests = [];
  const actionContexts = [];
  let registeredAction;
  let disposerCalls = 0;
  let disposerReceiver = "not-called";

  function providerDisposer() {
    disposerCalls += 1;
    disposerReceiver = this;
  }

  const sourceApi = createApi("bound", {
    registerExternalAction(action) {
      receivers.push(this);
      registeredAction = action;
      return providerDisposer;
    },
    openFile(request) {
      receivers.push(this);
      providerRequests.push(request);
      return { status: "opened" };
    },
    startNoteTimer(request) {
      receivers.push(this);
      providerRequests.push(request);
      return Promise.resolve({ status: "already-running" });
    },
    stopNoteTimerForFile(request) {
      receivers.push(this);
      providerRequests.push(request);
      return { status: "not-running" };
    },
  });
  const { client, workspace } = await createClient();
  workspace.trigger(EVENTS.available, createDescriptor(sourceApi));
  const api = client.getApi();

  assert.deepEqual(await api.openFile({
    path: "Health/Workout.md",
    leafPolicy: "reuse-current-unless-pinned",
    reveal: true,
    ignored: "not forwarded",
  }), { status: "opened" });
  assert.deepEqual(await api.startNoteTimer({
    path: "Health/Workout.md",
    title: "Leg day",
    sessionId: "gcm-workout-leg-day",
    startedAt: "2026-07-20T12:00:00.000Z",
  }), {
    status: "already-running",
  });
  assert.deepEqual(await api.stopNoteTimerForFile({
    path: "Health/Workout.md",
    endedAt: "2026-07-20T12:34:56.000Z",
    sessionId: "gcm-workout-leg-day",
  }), { status: "not-running" });
  assert.equal(receivers.slice(0, 3).every((receiver) => receiver === sourceApi), true);
  assert.equal(providerRequests.every(Object.isFrozen), true);
  assert.deepEqual(providerRequests[0], {
    path: "Health/Workout.md",
    leafPolicy: "reuse-current-unless-pinned",
    reveal: true,
  });
  assert.deepEqual(providerRequests[1], {
    path: "Health/Workout.md",
    title: "Leg day",
    sessionId: "gcm-workout-leg-day",
    startedAt: "2026-07-20T12:00:00.000Z",
  });
  assert.deepEqual(providerRequests[2], {
    path: "Health/Workout.md",
    endedAt: "2026-07-20T12:34:56.000Z",
    sessionId: "gcm-workout-leg-day",
  });

  const sourceAction = {
    id: "tps-health:log-food",
    pluginId: "tps-health",
    order: 40,
    icon: "utensils",
    label: "Log food",
    display: "icon-label",
    isVisible(context) {
      receivers.push(this);
      actionContexts.push(context);
      return true;
    },
    onClick(context) {
      receivers.push(this);
      actionContexts.push(context);
    },
  };
  const disposeAction = api.registerExternalAction(sourceAction);
  assert.equal(receivers.at(-1), sourceApi);
  assert.notEqual(disposeAction, providerDisposer);
  assert.equal(Object.isFrozen(registeredAction), true);
  assert.equal(registeredAction.display, "icon-label");
  const context = { filePath: "Daily Notes/2026-07-20.md", placement: "top", ignored: true };
  assert.equal(await registeredAction.isVisible(context), true);
  await registeredAction.onClick(context);
  assert.equal(receivers.at(-2), sourceAction);
  assert.equal(receivers.at(-1), sourceAction);
  assert.equal(actionContexts.every(Object.isFrozen), true);
  assert.deepEqual(actionContexts[0], {
    filePath: "Daily Notes/2026-07-20.md",
    placement: "top",
  });

  const callbackCount = actionContexts.length;
  await assert.rejects(
    registeredAction.onClick({ filePath: "/outside.md", placement: "top" }),
    /Invalid TPS GCM external action context/,
  );
  await assert.rejects(
    registeredAction.isVisible({ filePath: "Health/Food.md", placement: "middle" }),
    /Invalid TPS GCM external action context/,
  );
  assert.equal(actionContexts.length, callbackCount, "invalid callback arguments must not reach the provider");
  assert.throws(
    () => api.registerExternalAction({ ...sourceAction, id: " invalid " }),
    /Invalid TPS GCM external action registration/,
  );
  assert.throws(
    () => api.registerExternalAction({ ...sourceAction, display: "label-only" }),
    /Invalid TPS GCM external action registration/,
  );
  const { display: _display, ...missingDisplay } = sourceAction;
  assert.throws(
    () => api.registerExternalAction(missingDisplay),
    /Invalid TPS GCM external action registration/,
  );

  disposeAction.call({ hostile: true });
  disposeAction();
  assert.equal(disposerCalls, 1, "the consumer disposer is idempotent for the exact provider disposer");
  assert.equal(disposerReceiver, undefined, "the provider disposer is never rebound to consumer state");

  const requestSource = {
    protocolVersion: 1,
    consumerPluginId: "tps-health",
    accepted: undefined,
    receiver: undefined,
    accept(descriptor) {
      this.receiver = this;
      this.accepted = descriptor;
    },
  };
  const parsedRequest = contractModule.parseTPSGcmIntegrationServiceRequest(requestSource);
  parsedRequest.accept("descriptor");
  assert.equal(requestSource.receiver, requestSource);
  assert.equal(requestSource.accepted, "descriptor");
});

test("callback result validation rejects unsupported return values", async () => {
  const actions = [];
  const sourceApi = createApi("invalid-callback-results", {
    registerExternalAction(action) {
      actions.push(action);
      return () => {};
    },
  });
  const { client, workspace } = await createClient();
  workspace.trigger(EVENTS.available, createDescriptor(sourceApi));
  const api = client.getApi();
  const baseAction = {
    id: "tps-health:test-action",
    pluginId: "tps-health",
    icon: "activity",
    label: "Test action",
    display: "icon-only",
  };

  api.registerExternalAction({
    ...baseAction,
    isVisible() { return "yes"; },
    onClick() { return "unexpected"; },
  });
  assert.equal(actions[0].display, "icon-only");
  await assert.rejects(
    actions[0].isVisible({ filePath: "Health/Test.md", placement: "bottom" }),
    /invalid external action visibility result/i,
  );
  await assert.rejects(
    actions[0].onClick({ filePath: "Health/Test.md", placement: "bottom" }),
    /invalid external action callback result/i,
  );
});

test("dispose removes listeners and restart installs one fresh lifecycle pair", async () => {
  const workspace = new FakeWorkspace();
  let currentDescriptor = createDescriptor("first");
  workspace.on(EVENTS.request, (request) => request.accept(currentDescriptor));
  const availability = [];
  const { client, refs } = await createClient({
    workspace,
    onAvailabilityChanged: (api) => availability.push(apiIdentity(api) || "unavailable"),
  });

  assert.equal(apiIdentity(client.getApi()), "first");
  client.start(() => { throw new Error("must not register twice"); });
  assert.equal(workspace.requestCount, 1);
  assert.equal(workspace.listenerCount(EVENTS.available), 1);
  assert.equal(workspace.listenerCount(EVENTS.unavailable), 1);

  client.dispose();
  assert.equal(client.getApi(), undefined);
  assert.equal(workspace.listenerCount(EVENTS.available), 0);
  assert.equal(workspace.listenerCount(EVENTS.unavailable), 0);

  currentDescriptor = createDescriptor("restarted");
  client.start(
    (ref) => refs.push(ref),
    (api) => availability.push(apiIdentity(api) || "unavailable"),
  );
  assert.equal(apiIdentity(client.getApi()), "restarted");
  assert.equal(workspace.requestCount, 2);
  assert.equal(workspace.listenerCount(EVENTS.available), 1);
  assert.equal(workspace.listenerCount(EVENTS.unavailable), 1);
  assert.equal(refs.length, 4);
  assert.deepEqual(availability, ["first", "unavailable", "restarted"]);
});

test("hostile listeners, owners, and callbacks cannot corrupt accepted client state", async () => {
  const workspace = new FakeWorkspace();
  const descriptor = createDescriptor("accepted-before-throw");
  workspace.on(EVENTS.request, (request) => request.accept(descriptor));
  workspace.on(EVENTS.request, () => { throw new Error("hostile request listener"); });
  let registrations = 0;
  let notifications = 0;
  const { client } = await createClient({
    workspace,
    registerEvent: () => {
      registrations += 1;
      throw new Error("host owner rejected ref");
    },
    onAvailabilityChanged: () => {
      notifications += 1;
      throw new Error("consumer callback failed");
    },
  });
  assert.equal(apiIdentity(client.getApi()), "accepted-before-throw");
  assert.equal(registrations, 2);
  assert.equal(notifications, 1);

  const replacement = createDescriptor("replacement-before-hostile-event-listener");
  workspace.on(EVENTS.available, () => { throw new Error("hostile availability listener"); });
  assert.throws(() => workspace.trigger(EVENTS.available, replacement), /hostile availability listener/);
  assert.equal(apiIdentity(client.getApi()), "replacement-before-hostile-event-listener");
});

test("async-rejecting availability callbacks are owned across availability and disposal", async () => {
  let notifications = 0;
  const { client, workspace } = await createClient({
    onAvailabilityChanged: async () => {
      notifications += 1;
      throw new Error("owned async availability rejection");
    },
  });

  const descriptor = createDescriptor("async-callback-provider");
  workspace.trigger(EVENTS.available, descriptor);
  workspace.trigger(EVENTS.unavailable, descriptor);
  client.dispose();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(notifications, 3);
});

test("listener creation failure rolls back before discovery and allows a clean retry", async () => {
  const { clientModule } = await loadModules();
  const workspace = new FakeWorkspace();
  const originalOn = workspace.on.bind(workspace);
  let failUnavailable = true;
  workspace.on = (name, callback) => {
    if (failUnavailable && name === EVENTS.unavailable) throw new Error("cannot register unavailable");
    return originalOn(name, callback);
  };
  const client = new clientModule.TPSGcmIntegrationClient({ workspace }, "tps-health");

  assert.throws(() => client.start(() => {}), /cannot register unavailable/);
  assert.equal(client.getApi(), undefined);
  assert.equal(workspace.requestCount, 0);
  assert.equal(workspace.listenerCount(EVENTS.available), 0);
  assert.equal(workspace.listenerCount(EVENTS.unavailable), 0);

  failUnavailable = false;
  client.start(() => {});
  assert.equal(workspace.requestCount, 1);
  assert.equal(workspace.listenerCount(EVENTS.available), 1);
  assert.equal(workspace.listenerCount(EVENTS.unavailable), 1);
  client.dispose();
});
