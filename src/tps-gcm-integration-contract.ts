// Canonical TPS GCM inter-plugin integration contract.
// Keep this file self-contained so consumers can synchronize it without importing GCM internals.

export const TPS_GCM_INTEGRATION_SERVICE_EVENTS = Object.freeze({
  REQUEST: "tps:gcm-integration-api-request",
  AVAILABLE: "tps:gcm-integration-api-available",
  UNAVAILABLE: "tps:gcm-integration-api-unavailable",
} as const);

export const TPS_GCM_INTEGRATION_SERVICE_PROTOCOL_VERSION = 1 as const;
export const TPS_GCM_INTEGRATION_API_VERSION = 1 as const;
export const TPS_GCM_INTEGRATION_PROVIDER_PLUGIN_ID = "tps-global-context-menu" as const;
export const TPS_GCM_TIMER_END_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type TPSGcmExternalActionPlacement = "top" | "bottom";
export type TPSGcmOpenFileStatus = "opened" | "declined" | "missing-file";
export type TPSGcmStartNoteTimerStatus =
  | "started"
  | "already-running"
  | "declined"
  | "disabled"
  | "missing-file";
export type TPSGcmStopNoteTimerStatus =
  | "stopped"
  | "not-running"
  | "invalid-end"
  | "missing-file";

export interface TPSGcmExternalActionContext {
  readonly filePath: string;
  readonly placement: TPSGcmExternalActionPlacement;
}

export interface TPSGcmExternalActionRegistration {
  readonly id: string;
  readonly pluginId: string;
  readonly order?: number;
  readonly icon: string;
  readonly label: string;
  readonly display: "icon-label" | "icon-only";
  readonly title?: string;
  readonly isVisible?: (context: TPSGcmExternalActionContext) => boolean | Promise<boolean>;
  readonly onClick: (context: TPSGcmExternalActionContext) => void | Promise<void>;
}

export interface TPSGcmOpenFileRequest {
  readonly path: string;
  readonly leafPolicy: "reuse-current-unless-pinned";
  readonly reveal: true;
}

export interface TPSGcmOpenFileResult {
  readonly status: TPSGcmOpenFileStatus;
}

export interface TPSGcmStartNoteTimerRequest {
  readonly path: string;
  readonly title: string;
  readonly sessionId: string;
  readonly startedAt: string;
}

export interface TPSGcmStartNoteTimerResult {
  readonly status: TPSGcmStartNoteTimerStatus;
}

export interface TPSGcmStopNoteTimerRequest {
  readonly path: string;
  readonly endedAt: string;
  readonly sessionId: string;
}

export interface TPSGcmStopNoteTimerResult {
  readonly status: TPSGcmStopNoteTimerStatus;
}

export interface TPSGcmIntegrationApi {
  readonly apiVersion: 1;
  registerExternalAction(action: TPSGcmExternalActionRegistration): () => void;
  openFile(request: TPSGcmOpenFileRequest): Promise<TPSGcmOpenFileResult>;
  startNoteTimer(request: TPSGcmStartNoteTimerRequest): Promise<TPSGcmStartNoteTimerResult>;
  stopNoteTimerForFile(request: TPSGcmStopNoteTimerRequest): Promise<TPSGcmStopNoteTimerResult>;
}

export interface TPSGcmIntegrationServiceDescriptor {
  readonly protocolVersion: 1;
  readonly providerPluginId: "tps-global-context-menu";
  readonly api: Readonly<TPSGcmIntegrationApi>;
}

export interface TPSGcmIntegrationServiceRequest {
  readonly protocolVersion: 1;
  readonly consumerPluginId: string;
  readonly accept: (descriptor: unknown) => void;
}

export interface TPSGcmIntegrationApiSnapshot extends TPSGcmIntegrationApi {
  /** Exact source identity for lifecycle withdrawal. Never inspect it after parsing. */
  readonly sourceApi: object;
}

export interface TPSGcmIntegrationServiceDescriptorSnapshot {
  readonly protocolVersion: 1;
  readonly providerPluginId: "tps-global-context-menu";
  readonly api: Readonly<TPSGcmIntegrationApiSnapshot>;
  /** Exact source identity for lifecycle withdrawal. Never inspect it after parsing. */
  readonly sourceDescriptor: object;
}

const MAX_CONSUMER_PLUGIN_ID_LENGTH = 128;
const MAX_ACTION_ID_LENGTH = 128;
const MAX_PLUGIN_ID_LENGTH = 128;
const MAX_ACTION_TEXT_LENGTH = 512;
const MAX_ICON_LENGTH = 128;
const MAX_VAULT_PATH_LENGTH = 4096;
const MAX_TIMER_TITLE_LENGTH = 1000;
const MAX_TIMER_SESSION_ID_LENGTH = 256;
const MAX_ACTION_ORDER = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readOwnDataProperty(
  value: object,
  key: string,
): { readonly value: unknown } | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && hasOwn(descriptor, "value")
    ? { value: descriptor.value }
    : undefined;
}

function isBoundedExactString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= maxLength
    && (allowEmpty || value.length > 0)
    && value.trim() === value
    && !value.includes("\u0000");
}

function parseIdentifier(value: unknown, maxLength: number): string | undefined {
  if (!isBoundedExactString(value, maxLength)) return undefined;
  return /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i.test(value) ? value : undefined;
}

function parseMarkdownPath(value: unknown): string | undefined {
  if (!isBoundedExactString(value, MAX_VAULT_PATH_LENGTH)) return undefined;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes("//")) return undefined;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return undefined;
  return value.toLowerCase().endsWith(".md") ? value : undefined;
}

function parseIsoInstant(value: unknown): string | undefined {
  if (!isBoundedExactString(value, 64)) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  try {
    return parsed.toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function invalidOutput(name: string): never {
  throw new TypeError(`TPS GCM Integration returned an invalid ${name}.`);
}

function callValidatedPromise<T>(
  invoke: () => unknown,
  parse: (value: unknown) => T | undefined,
  outputName: string,
): Promise<T> {
  let pending: unknown;
  try {
    pending = invoke();
  } catch (error) {
    return Promise.reject(error);
  }
  const validate = (value: unknown): T => {
    const parsed = parse(value);
    if (parsed === undefined) return invalidOutput(outputName);
    return parsed;
  };
  if ((typeof pending === "object" && pending !== null) || typeof pending === "function") {
    let thenValue: unknown;
    try {
      thenValue = (pending as { then?: unknown }).then;
    } catch {
      return Promise.reject(new TypeError(`TPS GCM Integration returned an invalid ${outputName}.`));
    }
    if (typeof thenValue === "function") {
      const then = thenValue as (
        onFulfilled: (value: unknown) => void,
        onRejected: (reason?: unknown) => void,
      ) => unknown;
      return new Promise<unknown>((resolve, reject) => {
        then.call(pending, resolve, reject);
      }).then(validate);
    }
  }
  return Promise.resolve().then(() => validate(pending));
}

function callValidatedVoidPromise(
  invoke: () => unknown,
  outputName: string,
): Promise<void> {
  let pending: unknown;
  try {
    pending = invoke();
  } catch (error) {
    return Promise.reject(error);
  }
  const validate = (value: unknown): void => {
    if (value !== undefined) invalidOutput(outputName);
  };
  if ((typeof pending === "object" && pending !== null) || typeof pending === "function") {
    let thenValue: unknown;
    try {
      thenValue = (pending as { then?: unknown }).then;
    } catch {
      return Promise.reject(new TypeError(`TPS GCM Integration returned an invalid ${outputName}.`));
    }
    if (typeof thenValue === "function") {
      const then = thenValue as (
        onFulfilled: (value: unknown) => void,
        onRejected: (reason?: unknown) => void,
      ) => unknown;
      return new Promise<unknown>((resolve, reject) => {
        then.call(pending, resolve, reject);
      }).then(validate);
    }
  }
  return Promise.resolve().then(() => validate(pending));
}

function requireSynchronousVoid(value: unknown, callbackName: string): void {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    let thenValue: unknown;
    try {
      thenValue = (value as { then?: unknown }).then;
    } catch {
      throw new TypeError(`${callbackName} must return undefined synchronously.`);
    }
    if (typeof thenValue === "function") {
      const then = thenValue as (
        onFulfilled: (result: unknown) => void,
        onRejected: (reason?: unknown) => void,
      ) => unknown;
      void new Promise<unknown>((resolve, reject) => {
        try {
          then.call(value, resolve, reject);
        } catch (error) {
          reject(error);
        }
      }).catch(() => undefined);
      throw new TypeError(`${callbackName} must return undefined synchronously.`);
    }
  }
  if (value !== undefined) {
    throw new TypeError(`${callbackName} must return undefined synchronously.`);
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseTPSGcmExternalActionContext(
  value: unknown,
): Readonly<TPSGcmExternalActionContext> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const filePathProperty = readOwnDataProperty(value, "filePath");
    const placementProperty = readOwnDataProperty(value, "placement");
    if (!filePathProperty || !placementProperty) return undefined;
    const filePath = parseMarkdownPath(filePathProperty.value);
    const placement = placementProperty.value;
    if (!filePath || (placement !== "top" && placement !== "bottom")) return undefined;
    return Object.freeze({ filePath, placement });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmExternalActionRegistration(
  value: unknown,
): Readonly<TPSGcmExternalActionRegistration> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const idProperty = readOwnDataProperty(value, "id");
    const pluginIdProperty = readOwnDataProperty(value, "pluginId");
    const orderProperty = readOwnDataProperty(value, "order");
    const iconProperty = readOwnDataProperty(value, "icon");
    const labelProperty = readOwnDataProperty(value, "label");
    const displayProperty = readOwnDataProperty(value, "display");
    const titleProperty = readOwnDataProperty(value, "title");
    const isVisibleProperty = readOwnDataProperty(value, "isVisible");
    const onClickProperty = readOwnDataProperty(value, "onClick");
    if (!idProperty
      || !pluginIdProperty
      || !iconProperty
      || !labelProperty
      || !displayProperty
      || !onClickProperty) return undefined;
    const id = parseIdentifier(idProperty.value, MAX_ACTION_ID_LENGTH);
    const pluginId = parseIdentifier(pluginIdProperty.value, MAX_PLUGIN_ID_LENGTH);
    const orderValue = orderProperty?.value;
    const icon = iconProperty.value;
    const label = labelProperty.value;
    const display = displayProperty.value;
    const titleValue = titleProperty?.value;
    const isVisibleValue = isVisibleProperty?.value;
    const onClickValue = onClickProperty.value;
    if (!id
      || !pluginId
      || (orderProperty && (typeof orderValue !== "number"
        || !Number.isSafeInteger(orderValue)
        || Math.abs(orderValue) > MAX_ACTION_ORDER))
      || !isBoundedExactString(icon, MAX_ICON_LENGTH)
      || !isBoundedExactString(label, MAX_ACTION_TEXT_LENGTH)
      || (display !== "icon-label" && display !== "icon-only")
      || (titleProperty && !isBoundedExactString(titleValue, MAX_ACTION_TEXT_LENGTH))
      || (isVisibleProperty && typeof isVisibleValue !== "function")
      || typeof onClickValue !== "function") return undefined;

    const sourceAction = value;
    const isVisible = isVisibleValue as TPSGcmExternalActionRegistration["isVisible"];
    const onClick = onClickValue as TPSGcmExternalActionRegistration["onClick"];
    return Object.freeze({
      id,
      pluginId,
      ...(orderProperty ? { order: orderValue as number } : {}),
      icon,
      label,
      display,
      ...(titleProperty ? { title: titleValue as string } : {}),
      ...(isVisible ? {
        isVisible: (context: TPSGcmExternalActionContext): Promise<boolean> => {
          const contextSnapshot = parseTPSGcmExternalActionContext(context);
          if (!contextSnapshot) return Promise.reject(new TypeError("Invalid TPS GCM external action context."));
          return callValidatedPromise(
            () => isVisible.call(sourceAction, contextSnapshot),
            parseBoolean,
            "external action visibility result",
          );
        },
      } : {}),
      onClick: (context: TPSGcmExternalActionContext): Promise<void> => {
        const contextSnapshot = parseTPSGcmExternalActionContext(context);
        if (!contextSnapshot) return Promise.reject(new TypeError("Invalid TPS GCM external action context."));
        return callValidatedVoidPromise(
          () => onClick.call(sourceAction, contextSnapshot),
          "external action callback result",
        );
      },
    });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmOpenFileRequest(
  value: unknown,
): Readonly<TPSGcmOpenFileRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const pathProperty = readOwnDataProperty(value, "path");
    const leafPolicyProperty = readOwnDataProperty(value, "leafPolicy");
    const revealProperty = readOwnDataProperty(value, "reveal");
    if (!pathProperty || !leafPolicyProperty || !revealProperty) return undefined;
    const path = parseMarkdownPath(pathProperty.value);
    if (!path
      || leafPolicyProperty.value !== "reuse-current-unless-pinned"
      || revealProperty.value !== true) return undefined;
    return Object.freeze({ path, leafPolicy: "reuse-current-unless-pinned", reveal: true });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmOpenFileResult(
  value: unknown,
): Readonly<TPSGcmOpenFileResult> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const statusProperty = readOwnDataProperty(value, "status");
    if (!statusProperty) return undefined;
    const status = statusProperty.value;
    if (status !== "opened" && status !== "declined" && status !== "missing-file") return undefined;
    return Object.freeze({ status });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmStartNoteTimerRequest(
  value: unknown,
): Readonly<TPSGcmStartNoteTimerRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const pathProperty = readOwnDataProperty(value, "path");
    const titleProperty = readOwnDataProperty(value, "title");
    const sessionIdProperty = readOwnDataProperty(value, "sessionId");
    const startedAtProperty = readOwnDataProperty(value, "startedAt");
    if (!pathProperty || !titleProperty || !sessionIdProperty || !startedAtProperty) return undefined;
    const path = parseMarkdownPath(pathProperty.value);
    const title = titleProperty.value;
    const sessionId = parseIdentifier(sessionIdProperty.value, MAX_TIMER_SESSION_ID_LENGTH);
    const startedAt = parseIsoInstant(startedAtProperty.value);
    if (!path || !isBoundedExactString(title, MAX_TIMER_TITLE_LENGTH) || !sessionId || !startedAt) return undefined;
    return Object.freeze({ path, title, sessionId, startedAt });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmStartNoteTimerResult(
  value: unknown,
): Readonly<TPSGcmStartNoteTimerResult> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const statusProperty = readOwnDataProperty(value, "status");
    if (!statusProperty) return undefined;
    const status = statusProperty.value;
    if (status !== "started"
      && status !== "already-running"
      && status !== "declined"
      && status !== "disabled"
      && status !== "missing-file") return undefined;
    return Object.freeze({ status });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmStopNoteTimerRequest(
  value: unknown,
): Readonly<TPSGcmStopNoteTimerRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const pathProperty = readOwnDataProperty(value, "path");
    const endedAtProperty = readOwnDataProperty(value, "endedAt");
    const sessionIdProperty = readOwnDataProperty(value, "sessionId");
    if (!pathProperty || !endedAtProperty || !sessionIdProperty) return undefined;
    const path = parseMarkdownPath(pathProperty.value);
    const endedAt = parseIsoInstant(endedAtProperty.value);
    const sessionId = parseIdentifier(sessionIdProperty.value, MAX_TIMER_SESSION_ID_LENGTH);
    if (!path || !endedAt || !sessionId) return undefined;
    return Object.freeze({ path, endedAt, sessionId });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmStopNoteTimerResult(
  value: unknown,
): Readonly<TPSGcmStopNoteTimerResult> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const statusProperty = readOwnDataProperty(value, "status");
    if (!statusProperty) return undefined;
    const status = statusProperty.value;
    if (status !== "stopped"
      && status !== "not-running"
      && status !== "invalid-end"
      && status !== "missing-file") return undefined;
    return Object.freeze({ status });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmIntegrationApiSnapshot(
  value: unknown,
): Readonly<TPSGcmIntegrationApiSnapshot> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const apiVersionProperty = readOwnDataProperty(value, "apiVersion");
    const registerExternalActionProperty = readOwnDataProperty(value, "registerExternalAction");
    const openFileProperty = readOwnDataProperty(value, "openFile");
    const startNoteTimerProperty = readOwnDataProperty(value, "startNoteTimer");
    const stopNoteTimerForFileProperty = readOwnDataProperty(value, "stopNoteTimerForFile");
    if (!apiVersionProperty
      || !registerExternalActionProperty
      || !openFileProperty
      || !startNoteTimerProperty
      || !stopNoteTimerForFileProperty) return undefined;
    const apiVersion = apiVersionProperty.value;
    const registerExternalActionValue = registerExternalActionProperty.value;
    const openFileValue = openFileProperty.value;
    const startNoteTimerValue = startNoteTimerProperty.value;
    const stopNoteTimerForFileValue = stopNoteTimerForFileProperty.value;
    if (apiVersion !== TPS_GCM_INTEGRATION_API_VERSION
      || typeof registerExternalActionValue !== "function"
      || typeof openFileValue !== "function"
      || typeof startNoteTimerValue !== "function"
      || typeof stopNoteTimerForFileValue !== "function") return undefined;

    const sourceApi = value;
    const registerExternalAction = registerExternalActionValue as TPSGcmIntegrationApi["registerExternalAction"];
    const openFile = openFileValue as TPSGcmIntegrationApi["openFile"];
    const startNoteTimer = startNoteTimerValue as TPSGcmIntegrationApi["startNoteTimer"];
    const stopNoteTimerForFile = stopNoteTimerForFileValue as TPSGcmIntegrationApi["stopNoteTimerForFile"];

    return Object.freeze({
      apiVersion: TPS_GCM_INTEGRATION_API_VERSION,
      registerExternalAction: (action: TPSGcmExternalActionRegistration): (() => void) => {
        const actionSnapshot = parseTPSGcmExternalActionRegistration(action);
        if (!actionSnapshot) throw new TypeError("Invalid TPS GCM external action registration.");
        const disposer = registerExternalAction.call(sourceApi, actionSnapshot);
        if (typeof disposer !== "function") return invalidOutput("external action disposer");
        let disposed = false;
        return () => {
          if (disposed) return;
          disposed = true;
          disposer.call(undefined);
        };
      },
      openFile: (request: TPSGcmOpenFileRequest) => {
        const requestSnapshot = parseTPSGcmOpenFileRequest(request);
        if (!requestSnapshot) return Promise.reject(new TypeError("Invalid TPS GCM open-file request."));
        return callValidatedPromise(
          () => openFile.call(sourceApi, requestSnapshot),
          parseTPSGcmOpenFileResult,
          "open-file result",
        );
      },
      startNoteTimer: (request: TPSGcmStartNoteTimerRequest) => {
        const requestSnapshot = parseTPSGcmStartNoteTimerRequest(request);
        if (!requestSnapshot) return Promise.reject(new TypeError("Invalid TPS GCM start-timer request."));
        return callValidatedPromise(
          () => startNoteTimer.call(sourceApi, requestSnapshot),
          parseTPSGcmStartNoteTimerResult,
          "start-timer result",
        );
      },
      stopNoteTimerForFile: (request: TPSGcmStopNoteTimerRequest) => {
        const requestSnapshot = parseTPSGcmStopNoteTimerRequest(request);
        if (!requestSnapshot) return Promise.reject(new TypeError("Invalid TPS GCM stop-timer request."));
        return callValidatedPromise(
          () => stopNoteTimerForFile.call(sourceApi, requestSnapshot),
          parseTPSGcmStopNoteTimerResult,
          "stop-timer result",
        );
      },
      sourceApi,
    });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmIntegrationServiceDescriptor(
  value: unknown,
): Readonly<TPSGcmIntegrationServiceDescriptorSnapshot> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const protocolVersionProperty = readOwnDataProperty(value, "protocolVersion");
    const providerPluginIdProperty = readOwnDataProperty(value, "providerPluginId");
    const apiProperty = readOwnDataProperty(value, "api");
    if (!protocolVersionProperty || !providerPluginIdProperty || !apiProperty) return undefined;
    const protocolVersion = protocolVersionProperty.value;
    const providerPluginId = providerPluginIdProperty.value;
    if (protocolVersion !== TPS_GCM_INTEGRATION_SERVICE_PROTOCOL_VERSION
      || providerPluginId !== TPS_GCM_INTEGRATION_PROVIDER_PLUGIN_ID) return undefined;
    const api = parseTPSGcmIntegrationApiSnapshot(apiProperty.value);
    if (!api) return undefined;
    return Object.freeze({
      protocolVersion,
      providerPluginId,
      api,
      sourceDescriptor: value,
    });
  } catch {
    return undefined;
  }
}

export function parseTPSGcmIntegrationServiceRequest(
  value: unknown,
): Readonly<TPSGcmIntegrationServiceRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const protocolVersionProperty = readOwnDataProperty(value, "protocolVersion");
    const consumerPluginIdProperty = readOwnDataProperty(value, "consumerPluginId");
    const acceptProperty = readOwnDataProperty(value, "accept");
    if (!protocolVersionProperty || !consumerPluginIdProperty || !acceptProperty) return undefined;
    const protocolVersion = protocolVersionProperty.value;
    const consumerPluginId = parseIdentifier(consumerPluginIdProperty.value, MAX_CONSUMER_PLUGIN_ID_LENGTH);
    const acceptValue = acceptProperty.value;
    if (protocolVersion !== TPS_GCM_INTEGRATION_SERVICE_PROTOCOL_VERSION
      || !consumerPluginId
      || typeof acceptValue !== "function") return undefined;
    const accept = acceptValue as TPSGcmIntegrationServiceRequest["accept"];
    return Object.freeze({
      protocolVersion,
      consumerPluginId,
      accept: (descriptor: unknown) => {
        const result = accept.call(value, descriptor);
        requireSynchronousVoid(result, "TPS GCM Integration request accept callback");
      },
    });
  } catch {
    return undefined;
  }
}

export function createTPSGcmIntegrationApi(value: unknown): Readonly<TPSGcmIntegrationApi> {
  const snapshot = parseTPSGcmIntegrationApiSnapshot(value);
  if (!snapshot) throw new TypeError("Invalid TPS GCM Integration API.");
  return Object.freeze({
    apiVersion: snapshot.apiVersion,
    registerExternalAction: snapshot.registerExternalAction,
    openFile: snapshot.openFile,
    startNoteTimer: snapshot.startNoteTimer,
    stopNoteTimerForFile: snapshot.stopNoteTimerForFile,
  });
}

export function createTPSGcmIntegrationServiceDescriptor(
  api: unknown,
): Readonly<TPSGcmIntegrationServiceDescriptor> {
  return Object.freeze({
    protocolVersion: TPS_GCM_INTEGRATION_SERVICE_PROTOCOL_VERSION,
    providerPluginId: TPS_GCM_INTEGRATION_PROVIDER_PLUGIN_ID,
    api: createTPSGcmIntegrationApi(api),
  });
}

export function isTPSGcmIntegrationApi(value: unknown): value is Readonly<TPSGcmIntegrationApi> {
  return parseTPSGcmIntegrationApiSnapshot(value) !== undefined;
}

export function isTPSGcmIntegrationServiceDescriptor(
  value: unknown,
): value is Readonly<TPSGcmIntegrationServiceDescriptor> {
  return parseTPSGcmIntegrationServiceDescriptor(value) !== undefined;
}

export function isTPSGcmIntegrationServiceRequest(
  value: unknown,
): value is Readonly<TPSGcmIntegrationServiceRequest> {
  return parseTPSGcmIntegrationServiceRequest(value) !== undefined;
}
