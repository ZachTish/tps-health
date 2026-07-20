// Canonical TPS Health UI inter-plugin contract.
// Keep this file self-contained so consumers can synchronize it without importing Health internals.

export const TPS_HEALTH_UI_SERVICE_EVENTS = Object.freeze({
  REQUEST: "tps:health-ui-api-request",
  AVAILABLE: "tps:health-ui-api-available",
  UNAVAILABLE: "tps:health-ui-api-unavailable",
} as const);

export const TPS_HEALTH_UI_SERVICE_PROTOCOL_VERSION = 1 as const;
export const TPS_HEALTH_UI_API_VERSION = 1 as const;
export const TPS_HEALTH_UI_PROVIDER_PLUGIN_ID = "tps-health" as const;

export const TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS = Object.freeze([
  "tps-health:log-food",
  "tps-health:log-activity",
  "tps-health:start-workout",
] as const);

export type TPSHealthUiHomeActionId = typeof TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS[number];
export type TPSHealthUiLogBaseKind = "food" | "activity";
export type TPSHealthUiMetricKind = "min" | "max" | "range" | "counter";
export type TPSHealthUiFoodLogEntryMenuStatus = "opened" | "missing-file" | "stale-line" | "no-match";

export interface TPSHealthUiExactContext {
  readonly source: "tps-home";
  readonly dateIso: string;
  readonly dailyNotePath: string;
  readonly componentId: string;
  readonly basePath?: string;
}

export interface TPSHealthUiFoodDescriptionRequest {
  readonly description: string;
  readonly context: TPSHealthUiExactContext;
}

export interface TPSHealthUiFoodDescriptionResult {
  /** The provider has prepared a persisted tray or opened the exact owned Health workflow. */
  readonly status: "prepared";
}

export interface TPSHealthUiMetricRenderConfig {
  readonly propertyKey: string;
  readonly label: string;
  readonly unit: string;
  readonly kind: TPSHealthUiMetricKind;
  readonly goal?: number;
  readonly min?: number;
  readonly max?: number;
  readonly color?: string;
}

export interface TPSHealthUiFoodLogEntryMenuRequest {
  readonly clientX: number;
  readonly clientY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly filePath: string;
  /** Zero-based source line number. */
  readonly lineNumber: number;
  readonly renderedLine: string;
}

export interface TPSHealthUiFoodLogEntryMenuResult {
  /**
   * `opened` means exactly one current source entry was matched and its menu opened.
   * The provider may relocate a moved row by unique embedded identity, then by a
   * unique exact raw-line match. `missing-file` means `filePath` no longer resolves
   * to a file; `stale-line` means no unique current row matches that snapshot; and
   * `no-match` means the supplied snapshot is not a food-log entry.
   */
  readonly status: TPSHealthUiFoodLogEntryMenuStatus;
}

export interface TPSHealthUiApi {
  readonly apiVersion: 1;
  readonly supportedHomeActionIds: readonly TPSHealthUiHomeActionId[];
  /** Verifies and executes only the named action against the supplied exact context. */
  executeHomeAction(commandId: TPSHealthUiHomeActionId, context: TPSHealthUiExactContext): Promise<boolean>;
  /** Resolves `prepared` only after the exact owned Health workflow has been prepared or opened. */
  prepareFoodDescription(request: TPSHealthUiFoodDescriptionRequest): Promise<TPSHealthUiFoodDescriptionResult>;
  ensureLogBase(kind: TPSHealthUiLogBaseKind): Promise<string>;
  getMetricRenderConfigs(): readonly TPSHealthUiMetricRenderConfig[];
  /** Uses current provider settings/cache and returns false when no current match is available. */
  isWorkoutFile(path: string): boolean;
  openFoodLogEntryMenu(request: TPSHealthUiFoodLogEntryMenuRequest): Promise<TPSHealthUiFoodLogEntryMenuResult>;
}

export interface TPSHealthUiServiceDescriptor {
  readonly protocolVersion: 1;
  readonly providerPluginId: "tps-health";
  readonly api: Readonly<TPSHealthUiApi>;
}

export interface TPSHealthUiServiceRequest {
  readonly protocolVersion: 1;
  readonly consumerPluginId: string;
  readonly accept: (descriptor: unknown) => void;
}

export interface TPSHealthUiApiSnapshot extends TPSHealthUiApi {
  /** Exact source identity for lifecycle withdrawal. Never inspect it after parsing. */
  readonly sourceApi: object;
}

export interface TPSHealthUiServiceDescriptorSnapshot {
  readonly protocolVersion: 1;
  readonly providerPluginId: "tps-health";
  readonly api: Readonly<TPSHealthUiApiSnapshot>;
  /** Exact source identity for lifecycle withdrawal. Never inspect it after parsing. */
  readonly sourceDescriptor: object;
}

const MAX_CONSUMER_PLUGIN_ID_LENGTH = 128;
const MAX_COMPONENT_ID_LENGTH = 256;
const MAX_VAULT_PATH_LENGTH = 4096;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_RENDERED_LINE_LENGTH = 100_000;
const MAX_METRIC_CONFIGS = 256;
const MAX_METRIC_TEXT_LENGTH = 512;
const MAX_METRIC_UNIT_LENGTH = 128;
const MAX_COLOR_LENGTH = 256;
const MAX_ABSOLUTE_METRIC_VALUE = 1_000_000_000_000_000;
const MAX_ABSOLUTE_MENU_COORDINATE = 10_000_000;
const MAX_SOURCE_LINE_NUMBER = 10_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBoundedExactString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= maxLength
    && (allowEmpty || value.length > 0)
    && value.trim() === value
    && !value.includes("\u0000");
}

function parseRelativeVaultPath(
  value: unknown,
  requiredExtension: ".md" | ".base",
): string | undefined {
  if (!isBoundedExactString(value, MAX_VAULT_PATH_LENGTH)) return undefined;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes("//")) return undefined;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return undefined;
  if (!value.toLowerCase().endsWith(requiredExtension)) return undefined;
  return value;
}

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function invalidInput(name: string): never {
  throw new TypeError(`Invalid TPS Health UI ${name}.`);
}

function invalidOutput(name: string): never {
  throw new TypeError(`TPS Health UI returned an invalid ${name}.`);
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
      return Promise.reject(new TypeError(`TPS Health UI returned an invalid ${outputName}.`));
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

export function parseTPSHealthUiHomeActionId(value: unknown): TPSHealthUiHomeActionId | undefined {
  return TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS.includes(value as TPSHealthUiHomeActionId)
    ? value as TPSHealthUiHomeActionId
    : undefined;
}

export function parseTPSHealthUiSupportedHomeActionIds(
  value: unknown,
): readonly TPSHealthUiHomeActionId[] | undefined {
  try {
    if (!Array.isArray(value) || value.length !== TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS.length) return undefined;
    for (let index = 0; index < TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS.length; index += 1) {
      if (value[index] !== TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS[index]) return undefined;
    }
    return TPS_HEALTH_UI_SUPPORTED_HOME_ACTION_IDS;
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiExactContext(
  value: unknown,
): Readonly<TPSHealthUiExactContext> | undefined {
  try {
    if (!isRecord(value) || value.source !== "tps-home") return undefined;
    const dateIso = value.dateIso;
    const dailyNotePath = parseRelativeVaultPath(value.dailyNotePath, ".md");
    const componentId = value.componentId;
    const basePathValue = value.basePath;
    if (typeof dateIso !== "string"
      || !isValidIsoDate(dateIso)
      || !dailyNotePath
      || !isBoundedExactString(componentId, MAX_COMPONENT_ID_LENGTH)) return undefined;
    const basePath = basePathValue === undefined
      ? undefined
      : parseRelativeVaultPath(basePathValue, ".base");
    if (basePathValue !== undefined && !basePath) return undefined;
    return Object.freeze({
      source: "tps-home",
      dateIso,
      dailyNotePath,
      componentId,
      ...(basePath ? { basePath } : {}),
    });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiHomeActionExecutionResult(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseTPSHealthUiFoodDescriptionRequest(
  value: unknown,
): Readonly<TPSHealthUiFoodDescriptionRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const description = value.description;
    const context = parseTPSHealthUiExactContext(value.context);
    if (typeof description !== "string"
      || description.length > MAX_DESCRIPTION_LENGTH
      || description.trim().length === 0
      || description.includes("\u0000")
      || !context) return undefined;
    return Object.freeze({ description, context });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiFoodDescriptionResult(
  value: unknown,
): Readonly<TPSHealthUiFoodDescriptionResult> | undefined {
  try {
    if (!isRecord(value) || value.status !== "prepared") return undefined;
    return Object.freeze({ status: "prepared" });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiLogBaseKind(value: unknown): TPSHealthUiLogBaseKind | undefined {
  return value === "food" || value === "activity" ? value : undefined;
}

export function parseTPSHealthUiLogBasePath(value: unknown): string | undefined {
  return parseRelativeVaultPath(value, ".base");
}

function parseOptionalMetricNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number"
    || !Number.isFinite(value)
    || Math.abs(value) > MAX_ABSOLUTE_METRIC_VALUE) return undefined;
  return value;
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

export function parseTPSHealthUiMetricRenderConfig(
  value: unknown,
): Readonly<TPSHealthUiMetricRenderConfig> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const propertyKey = value.propertyKey;
    const label = value.label;
    const unit = value.unit;
    const kind = value.kind;
    const goalValue = value.goal;
    const minValue = value.min;
    const maxValue = value.max;
    const goal = parseOptionalMetricNumber(goalValue);
    const min = parseOptionalMetricNumber(minValue);
    const max = parseOptionalMetricNumber(maxValue);
    const colorValue = value.color;
    const hasGoal = hasOwn(value, "goal");
    const hasMin = hasOwn(value, "min");
    const hasMax = hasOwn(value, "max");
    if (!isBoundedExactString(propertyKey, MAX_METRIC_TEXT_LENGTH)
      || !isBoundedExactString(label, MAX_METRIC_TEXT_LENGTH)
      || !isBoundedExactString(unit, MAX_METRIC_UNIT_LENGTH, true)
      || (kind !== "min" && kind !== "max" && kind !== "range" && kind !== "counter")
      || (hasGoal && goalValue !== undefined && goal === undefined)
      || (hasMin && minValue !== undefined && min === undefined)
      || (hasMax && maxValue !== undefined && max === undefined)
      || (min !== undefined && max !== undefined && min > max)
      || (colorValue !== undefined && (
        !isBoundedExactString(colorValue, MAX_COLOR_LENGTH)
        || !/^[#(),.%\-\sA-Za-z0-9]+$/.test(colorValue)
      ))) return undefined;
    const color = colorValue as string | undefined;
    return Object.freeze({
      propertyKey,
      label,
      unit,
      kind,
      ...(goal !== undefined ? { goal } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(color !== undefined ? { color } : {}),
    });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiMetricRenderConfigs(
  value: unknown,
): readonly Readonly<TPSHealthUiMetricRenderConfig>[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = value.length;
    if (!Number.isSafeInteger(length) || length > MAX_METRIC_CONFIGS) return undefined;
    const seen = new Set<string>();
    const configs: Readonly<TPSHealthUiMetricRenderConfig>[] = [];
    for (let index = 0; index < length; index += 1) {
      const candidate = value[index];
      const config = parseTPSHealthUiMetricRenderConfig(candidate);
      if (!config) return undefined;
      const key = config.propertyKey.toLowerCase();
      if (seen.has(key)) return undefined;
      seen.add(key);
      configs.push(config);
    }
    return Object.freeze(configs);
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiWorkoutFilePath(value: unknown): string | undefined {
  return parseRelativeVaultPath(value, ".md");
}

export function parseTPSHealthUiWorkoutFileResult(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isBoundedCoordinate(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= MAX_ABSOLUTE_MENU_COORDINATE;
}

export function parseTPSHealthUiFoodLogEntryMenuRequest(
  value: unknown,
): Readonly<TPSHealthUiFoodLogEntryMenuRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const clientX = value.clientX;
    const clientY = value.clientY;
    const screenX = value.screenX;
    const screenY = value.screenY;
    const filePath = parseRelativeVaultPath(value.filePath, ".md");
    const lineNumber = value.lineNumber;
    const renderedLine = value.renderedLine;
    if (!isBoundedCoordinate(clientX)
      || !isBoundedCoordinate(clientY)
      || !isBoundedCoordinate(screenX)
      || !isBoundedCoordinate(screenY)
      || !filePath
      || typeof lineNumber !== "number"
      || !Number.isSafeInteger(lineNumber)
      || lineNumber < 0
      || lineNumber > MAX_SOURCE_LINE_NUMBER
      || typeof renderedLine !== "string"
      || renderedLine.length > MAX_RENDERED_LINE_LENGTH
      || renderedLine.includes("\u0000")) return undefined;
    return Object.freeze({
      clientX,
      clientY,
      screenX,
      screenY,
      filePath,
      lineNumber,
      renderedLine,
    });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiFoodLogEntryMenuResult(
  value: unknown,
): Readonly<TPSHealthUiFoodLogEntryMenuResult> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const status = value.status;
    if (status !== "opened"
      && status !== "missing-file"
      && status !== "stale-line"
      && status !== "no-match") return undefined;
    return Object.freeze({ status });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiApiSnapshot(
  value: unknown,
): Readonly<TPSHealthUiApiSnapshot> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const apiVersionProperty = readOwnDataProperty(value, "apiVersion");
    const supportedHomeActionIdsProperty = readOwnDataProperty(value, "supportedHomeActionIds");
    const executeHomeActionProperty = readOwnDataProperty(value, "executeHomeAction");
    const prepareFoodDescriptionProperty = readOwnDataProperty(value, "prepareFoodDescription");
    const ensureLogBaseProperty = readOwnDataProperty(value, "ensureLogBase");
    const getMetricRenderConfigsProperty = readOwnDataProperty(value, "getMetricRenderConfigs");
    const isWorkoutFileProperty = readOwnDataProperty(value, "isWorkoutFile");
    const openFoodLogEntryMenuProperty = readOwnDataProperty(value, "openFoodLogEntryMenu");
    if (!apiVersionProperty
      || !supportedHomeActionIdsProperty
      || !executeHomeActionProperty
      || !prepareFoodDescriptionProperty
      || !ensureLogBaseProperty
      || !getMetricRenderConfigsProperty
      || !isWorkoutFileProperty
      || !openFoodLogEntryMenuProperty) return undefined;
    const apiVersion = apiVersionProperty.value;
    const supportedHomeActionIds = parseTPSHealthUiSupportedHomeActionIds(
      supportedHomeActionIdsProperty.value,
    );
    const executeHomeActionValue = executeHomeActionProperty.value;
    const prepareFoodDescriptionValue = prepareFoodDescriptionProperty.value;
    const ensureLogBaseValue = ensureLogBaseProperty.value;
    const getMetricRenderConfigsValue = getMetricRenderConfigsProperty.value;
    const isWorkoutFileValue = isWorkoutFileProperty.value;
    const openFoodLogEntryMenuValue = openFoodLogEntryMenuProperty.value;
    if (apiVersion !== TPS_HEALTH_UI_API_VERSION
      || !supportedHomeActionIds
      || typeof executeHomeActionValue !== "function"
      || typeof prepareFoodDescriptionValue !== "function"
      || typeof ensureLogBaseValue !== "function"
      || typeof getMetricRenderConfigsValue !== "function"
      || typeof isWorkoutFileValue !== "function"
      || typeof openFoodLogEntryMenuValue !== "function") return undefined;

    const sourceApi = value;
    const executeHomeAction = executeHomeActionValue as TPSHealthUiApi["executeHomeAction"];
    const prepareFoodDescription = prepareFoodDescriptionValue as TPSHealthUiApi["prepareFoodDescription"];
    const ensureLogBase = ensureLogBaseValue as TPSHealthUiApi["ensureLogBase"];
    const getMetricRenderConfigs = getMetricRenderConfigsValue as TPSHealthUiApi["getMetricRenderConfigs"];
    const isWorkoutFile = isWorkoutFileValue as TPSHealthUiApi["isWorkoutFile"];
    const openFoodLogEntryMenu = openFoodLogEntryMenuValue as TPSHealthUiApi["openFoodLogEntryMenu"];

    return Object.freeze({
      apiVersion: TPS_HEALTH_UI_API_VERSION,
      supportedHomeActionIds,
      executeHomeAction: (commandId: TPSHealthUiHomeActionId, context: TPSHealthUiExactContext): Promise<boolean> => {
        const commandIdSnapshot = parseTPSHealthUiHomeActionId(commandId);
        const contextSnapshot = parseTPSHealthUiExactContext(context);
        if (!commandIdSnapshot || !contextSnapshot) {
          return Promise.reject(new TypeError("Invalid TPS Health UI Home action request."));
        }
        return callValidatedPromise(
          () => executeHomeAction.call(sourceApi, commandIdSnapshot, contextSnapshot),
          parseTPSHealthUiHomeActionExecutionResult,
          "Home action result",
        );
      },
      prepareFoodDescription: (request: TPSHealthUiFoodDescriptionRequest) => {
        const requestSnapshot = parseTPSHealthUiFoodDescriptionRequest(request);
        if (!requestSnapshot) return Promise.reject(new TypeError("Invalid TPS Health UI food description request."));
        return callValidatedPromise(
          () => prepareFoodDescription.call(sourceApi, requestSnapshot),
          parseTPSHealthUiFoodDescriptionResult,
          "food description result",
        );
      },
      ensureLogBase: (kind: TPSHealthUiLogBaseKind) => {
        const kindSnapshot = parseTPSHealthUiLogBaseKind(kind);
        if (!kindSnapshot) return Promise.reject(new TypeError("Invalid TPS Health UI log Base kind."));
        return callValidatedPromise(
          () => ensureLogBase.call(sourceApi, kindSnapshot),
          parseTPSHealthUiLogBasePath,
          "log Base path",
        );
      },
      getMetricRenderConfigs: () => {
        const configs = parseTPSHealthUiMetricRenderConfigs(getMetricRenderConfigs.call(sourceApi));
        if (!configs) return invalidOutput("metric render configs");
        return configs;
      },
      isWorkoutFile: (path: string): boolean => {
        const pathSnapshot = parseTPSHealthUiWorkoutFilePath(path);
        if (!pathSnapshot) return invalidInput("workout file path");
        const result = parseTPSHealthUiWorkoutFileResult(isWorkoutFile.call(sourceApi, pathSnapshot));
        if (result === undefined) return invalidOutput("workout file result");
        return result;
      },
      openFoodLogEntryMenu: (request: TPSHealthUiFoodLogEntryMenuRequest) => {
        const requestSnapshot = parseTPSHealthUiFoodLogEntryMenuRequest(request);
        if (!requestSnapshot) return Promise.reject(new TypeError("Invalid TPS Health UI food-log menu request."));
        return callValidatedPromise(
          () => openFoodLogEntryMenu.call(sourceApi, requestSnapshot),
          parseTPSHealthUiFoodLogEntryMenuResult,
          "food-log menu result",
        );
      },
      sourceApi,
    });
  } catch {
    return undefined;
  }
}

export function parseTPSHealthUiServiceDescriptor(
  value: unknown,
): Readonly<TPSHealthUiServiceDescriptorSnapshot> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const protocolVersionProperty = readOwnDataProperty(value, "protocolVersion");
    const providerPluginIdProperty = readOwnDataProperty(value, "providerPluginId");
    const apiProperty = readOwnDataProperty(value, "api");
    if (!protocolVersionProperty || !providerPluginIdProperty || !apiProperty) return undefined;
    const protocolVersion = protocolVersionProperty.value;
    const providerPluginId = providerPluginIdProperty.value;
    const apiValue = apiProperty.value;
    if (protocolVersion !== TPS_HEALTH_UI_SERVICE_PROTOCOL_VERSION
      || providerPluginId !== TPS_HEALTH_UI_PROVIDER_PLUGIN_ID) return undefined;
    const api = parseTPSHealthUiApiSnapshot(apiValue);
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

export function parseTPSHealthUiServiceRequest(
  value: unknown,
): Readonly<TPSHealthUiServiceRequest> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const protocolVersionProperty = readOwnDataProperty(value, "protocolVersion");
    const consumerPluginIdProperty = readOwnDataProperty(value, "consumerPluginId");
    const acceptProperty = readOwnDataProperty(value, "accept");
    if (!protocolVersionProperty || !consumerPluginIdProperty || !acceptProperty) return undefined;
    const protocolVersion = protocolVersionProperty.value;
    const consumerPluginId = consumerPluginIdProperty.value;
    const acceptValue = acceptProperty.value;
    if (protocolVersion !== TPS_HEALTH_UI_SERVICE_PROTOCOL_VERSION
      || !isBoundedExactString(consumerPluginId, MAX_CONSUMER_PLUGIN_ID_LENGTH)
      || typeof acceptValue !== "function") return undefined;
    const accept = acceptValue as TPSHealthUiServiceRequest["accept"];
    return Object.freeze({
      protocolVersion,
      consumerPluginId,
      accept: (descriptor: unknown) => accept.call(value, descriptor),
    });
  } catch {
    return undefined;
  }
}

export function createTPSHealthUiApi(value: unknown): Readonly<TPSHealthUiApi> {
  const snapshot = parseTPSHealthUiApiSnapshot(value);
  if (!snapshot) throw new TypeError("Invalid TPS Health UI API.");
  return Object.freeze({
    apiVersion: snapshot.apiVersion,
    supportedHomeActionIds: snapshot.supportedHomeActionIds,
    executeHomeAction: snapshot.executeHomeAction,
    prepareFoodDescription: snapshot.prepareFoodDescription,
    ensureLogBase: snapshot.ensureLogBase,
    getMetricRenderConfigs: snapshot.getMetricRenderConfigs,
    isWorkoutFile: snapshot.isWorkoutFile,
    openFoodLogEntryMenu: snapshot.openFoodLogEntryMenu,
  });
}

export function createTPSHealthUiServiceDescriptor(
  api: unknown,
): Readonly<TPSHealthUiServiceDescriptor> {
  return Object.freeze({
    protocolVersion: TPS_HEALTH_UI_SERVICE_PROTOCOL_VERSION,
    providerPluginId: TPS_HEALTH_UI_PROVIDER_PLUGIN_ID,
    api: createTPSHealthUiApi(api),
  });
}

export function isTPSHealthUiApi(value: unknown): value is Readonly<TPSHealthUiApi> {
  return parseTPSHealthUiApiSnapshot(value) !== undefined;
}

export function isTPSHealthUiServiceDescriptor(
  value: unknown,
): value is Readonly<TPSHealthUiServiceDescriptor> {
  return parseTPSHealthUiServiceDescriptor(value) !== undefined;
}

export function isTPSHealthUiServiceRequest(
  value: unknown,
): value is Readonly<TPSHealthUiServiceRequest> {
  return parseTPSHealthUiServiceRequest(value) !== undefined;
}
