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
  const outdir = await mkdtemp(join(tmpdir(), "tps-health-ai-gateway-client-"));
  const outfile = join(outdir, "ai-gateway-client.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/tps-ai-gateway-client.ts", import.meta.url))],
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

  on(name, callback) {
    const ref = { name, callback };
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(ref);
    this.listeners.set(name, listeners);
    return ref;
  }

  trigger(name, ...args) {
    for (const ref of Array.from(this.listeners.get(name) || [])) ref.callback(...args);
  }
}

function createApi(identity) {
  return {
    apiVersion: 1,
    capabilities: {
      structuredCompletion: true,
      guardedDecisionSelection: true,
      guardedCapabilityExecution: true,
    },
    identity,
    async completeStructured(request) {
      return {
        data: { identity: this.identity, taskId: request.taskId },
        provider: "openai",
        model: "test-model",
        traceId: `trace-${this.identity}`,
        attempts: 1,
      };
    },
    async choose() {
      return {
        data: { optionId: "one", reason: "test" },
        option: { id: "one", label: "One" },
        provider: "openai",
        model: "test-model",
        traceId: `trace-${this.identity}`,
        attempts: 1,
      };
    },
    registerCapability() {
      return () => undefined;
    },
    listCapabilities() {
      return [];
    },
    async proposeCapability() {
      return { capabilityId: "test", input: {}, reason: "test", traceId: `trace-${this.identity}` };
    },
    async executeCapability() {
      return { identity: this.identity };
    },
  };
}

function createDescriptor(api) {
  return {
    protocolVersion: 1,
    providerPluginId: "tps-ai-gateway",
    api,
  };
}

async function createClient(onAvailabilityChanged) {
  const { TPSAiGatewayClient } = await loadClientModule();
  const workspace = new FakeWorkspace();
  const refs = [];
  const client = new TPSAiGatewayClient({ workspace }, "tps-health-test");
  client.start((ref) => refs.push(ref), onAvailabilityChanged);
  return { client, workspace, refs };
}

test("Health discovers a Gateway that becomes available after Health loads and receives bound methods", async () => {
  const availability = [];
  const { client, workspace, refs } = await createClient((api) => availability.push(api ? "available" : "unavailable"));
  assert.equal(client.getApi(), undefined);
  assert.equal(refs.length, 2);

  workspace.trigger("tps:ai-gateway-api-available", createDescriptor(createApi("late")));
  const api = client.getApi();
  assert.ok(api);
  const result = await api.completeStructured({
    taskId: "health.describe-food.extract",
    messages: [{ role: "user", content: "test" }],
    schema: { type: "object" },
  });
  assert.deepEqual(result.data, { identity: "late", taskId: "health.describe-food.extract" });
  assert.deepEqual(availability, ["unavailable", "available"]);
});

test("Health ignores malformed descriptors and stale withdrawal announcements", async () => {
  const { client, workspace } = await createClient();
  const hostile = new Proxy({}, { get() { throw new Error("hostile getter"); } });
  assert.doesNotThrow(() => workspace.trigger("tps:ai-gateway-api-available", hostile));
  workspace.trigger("tps:ai-gateway-api-available", {
    protocolVersion: 1,
    providerPluginId: "tps-ai-gateway",
    api: { apiVersion: 1, capabilities: {} },
  });
  assert.equal(client.getApi(), undefined);

  const descriptorA = createDescriptor(createApi("A"));
  const descriptorB = createDescriptor(createApi("B"));
  workspace.trigger("tps:ai-gateway-api-available", descriptorA);
  workspace.trigger("tps:ai-gateway-api-available", descriptorB);
  workspace.trigger("tps:ai-gateway-api-unavailable", descriptorA);
  assert.equal((await client.getApi().completeStructured({ taskId: "current", messages: [{ role: "user", content: "test" }], schema: {} })).data.identity, "B");

  workspace.trigger("tps:ai-gateway-api-unavailable", descriptorB);
  assert.equal(client.getApi(), undefined);
});

test("Health client unload clears discovery and rejects delayed availability", async () => {
  const availability = [];
  const { client, workspace } = await createClient((api) => availability.push(api ? "available" : "unavailable"));
  workspace.trigger("tps:ai-gateway-api-available", createDescriptor(createApi("before-unload")));
  assert.ok(client.getApi());

  client.dispose();
  workspace.trigger("tps:ai-gateway-api-available", createDescriptor(createApi("after-unload")));
  assert.equal(client.getApi(), undefined);
  assert.deepEqual(availability, ["unavailable", "available", "unavailable"]);
});

test("Health main uses only the public Gateway client and retains the local unavailable route", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /import \{ TPSAiGatewayClient \} from "\.\/tps-ai-gateway-client";/);
  assert.match(main, /const aiGatewayClient = new TPSAiGatewayClient\(this\.app, this\.manifest\.id\)/);
  assert.match(main, /aiGatewayClient\.start\(/);
  assert.match(main, /const lifecycleEpoch = \+\+this\.lifecycleEpoch/);
  assert.match(main, /this\.lifecycleEpoch \+= 1;\s+logger\.flow\("Lifecycle", "unload"\)/);
  assert.match(main, /return this\.aiGatewayClient\?\.getApi\(\);/);
  assert.match(main, /this\.aiGatewayClient = undefined;\s+aiGatewayClient\?\.dispose\(\);/);
  assert.match(main, /return this\.legacyOpenFoodDescriber\(description, dateContext, onProgress\);/);
  assert.doesNotMatch(main, /\(this\.app as any\)\.tpsAiGateway/);
  assert.doesNotMatch(main, /getPlugin\?\.\("tps-ai-gateway"\)/);
});
