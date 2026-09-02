import { DEFAULT_SETTINGS, HealthEntityIdentificationMode, HealthGoal, HealthGoalKind, TPS_HEALTH_SCHEMA_VERSION, TPSHealthSettings, USDA_API_KEY_SECRET, USDA_API_KEY_SECRET_MAX, USDA_DEMO_API_KEY } from "./types";
import { normalizeVaultDestinationFolder } from "./vault-destination";
import { isValidWorkoutPropertyKey } from "./workout-properties";

export const LEGACY_SETTING_KEYS = ["foodLogHeading", "workoutLogHeading", "workoutSessionBodyMode", "workoutExerciseLayout", "workoutSetStorage"] as const;

type SettingsRecord = Record<string, unknown>;

const REMOVED_SETTING_KEYS = [...LEGACY_SETTING_KEYS, "dailyNoteFormat", "dailyNoteFolder", "usdaApiKeySecret", "usdaApiKey"] as const;

const WORKOUT_LOG_TARGETS = ["session-note", "daily-note", "both"];
const WORKOUT_DAILY_NOTE_PLACEMENTS = ["after-frontmatter", "before-first-h2", "bottom"];
const FOOD_LOG_TARGETS = ["daily-note", "single-file"];
const REST_TIMER_MODES = ["count-up", "count-down"];
const WORKOUT_SET_NOTATIONS = ["compact", "verbose"];
const WORKOUT_INTERVAL_MODES = ["duration", "end"];
const HEALTH_ENTITY_IDENTIFICATION_MODES: HealthEntityIdentificationMode[] = ["metadata-folder-tag", "folder", "tag", "metadata"];
const HEALTH_STORAGE_MODES = ["legacy", "native-records"];
const HEALTH_GOAL_KINDS: HealthGoalKind[] = ["min", "max", "range", "counter"];

export function normalizeTPSHealthSettings(stored: unknown): TPSHealthSettings {
  const storedRecord = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as SettingsRecord : {};
  const raw = { ...DEFAULT_SETTINGS, ...storedRecord } as SettingsRecord;
  const settings = Object.keys(DEFAULT_SETTINGS).reduce((normalized, key) => {
    normalized[key] = cloneSettingValue(raw[key]);
    return normalized;
  }, {} as SettingsRecord) as unknown as TPSHealthSettings;

  settings.workoutsFolder = folderSetting(settings.workoutsFolder, DEFAULT_SETTINGS.workoutsFolder);
  settings.workoutPlansFolder = folderSetting(settings.workoutPlansFolder, DEFAULT_SETTINGS.workoutPlansFolder);
  settings.exercisesFolder = folderSetting(settings.exercisesFolder, DEFAULT_SETTINGS.exercisesFolder);
  settings.foodsFolder = folderSetting(settings.foodsFolder, DEFAULT_SETTINGS.foodsFolder);
  settings.recipesFolder = folderSetting(settings.recipesFolder, DEFAULT_SETTINGS.recipesFolder);
  if (!HEALTH_STORAGE_MODES.includes(settings.storageMode)) settings.storageMode = DEFAULT_SETTINGS.storageMode;
  settings.workoutTemplatePath = optionalStringSetting(settings.workoutTemplatePath);
  settings.workoutPlanTemplatePath = optionalStringSetting(settings.workoutPlanTemplatePath);
  settings.exerciseTemplatePath = optionalStringSetting(settings.exerciseTemplatePath);
  settings.foodTemplatePath = optionalStringSetting(settings.foodTemplatePath);
  settings.defaultFoodLogSection = optionalStringSetting(settings.defaultFoodLogSection);
  settings.foodLogFilePath = stringSetting(settings.foodLogFilePath, DEFAULT_SETTINGS.foodLogFilePath);
  settings.workoutTag = optionalStringSetting(settings.workoutTag);
  settings.exerciseTag = optionalStringSetting(settings.exerciseTag);
  settings.customFoodTag = optionalStringSetting(settings.customFoodTag);
  settings.recipeTag = optionalStringSetting(settings.recipeTag);
  settings.foodFrontmatterKey = frontmatterPropertyKeySetting(settings.foodFrontmatterKey, DEFAULT_SETTINGS.foodFrontmatterKey);
  settings.foodFrontmatterFoodValue = stringSetting(settings.foodFrontmatterFoodValue, DEFAULT_SETTINGS.foodFrontmatterFoodValue);
  settings.foodFrontmatterRecipeValue = stringSetting(settings.foodFrontmatterRecipeValue, DEFAULT_SETTINGS.foodFrontmatterRecipeValue);
  settings.foodFrontmatterMealValue = stringSetting(settings.foodFrontmatterMealValue, DEFAULT_SETTINGS.foodFrontmatterMealValue);
  settings.workoutStartPropertyKey = isValidWorkoutPropertyKey(settings.workoutStartPropertyKey)
    ? String(settings.workoutStartPropertyKey).trim()
    : DEFAULT_SETTINGS.workoutStartPropertyKey;
  settings.workoutIntervalPropertyKey = isValidWorkoutPropertyKey(settings.workoutIntervalPropertyKey)
    ? String(settings.workoutIntervalPropertyKey).trim()
    : DEFAULT_SETTINGS.workoutIntervalPropertyKey;
  if (settings.workoutIntervalPropertyKey.toLocaleLowerCase() === settings.workoutStartPropertyKey.toLocaleLowerCase()) {
    settings.workoutIntervalPropertyKey = settings.workoutStartPropertyKey.toLocaleLowerCase() === DEFAULT_SETTINGS.workoutIntervalPropertyKey.toLocaleLowerCase()
      ? "workoutDuration"
      : DEFAULT_SETTINGS.workoutIntervalPropertyKey;
  }
  settings.rollupHeading = stringSetting(settings.rollupHeading, DEFAULT_SETTINGS.rollupHeading);
  settings.openFoodFactsUserAgent = stringSetting(settings.openFoodFactsUserAgent, DEFAULT_SETTINGS.openFoodFactsUserAgent);
  const storedUsdaReferences = Object.prototype.hasOwnProperty.call(storedRecord, "usdaApiKeySecrets")
    ? storedRecord.usdaApiKeySecrets
    : Object.prototype.hasOwnProperty.call(storedRecord, "usdaApiKeySecret")
      ? [storedRecord.usdaApiKeySecret]
      : DEFAULT_SETTINGS.usdaApiKeySecrets;
  settings.usdaApiKeySecrets = normalizeUsdaApiKeySecrets(storedUsdaReferences);
  if (!settings.usdaApiKeySecrets.length && legacyUsdaApiKeyValue(storedRecord)) settings.usdaApiKeySecrets = [USDA_API_KEY_SECRET];
  settings.activeWorkoutPath = optionalStringSetting(settings.activeWorkoutPath);
  settings.activeWorkoutId = optionalStringSetting(settings.activeWorkoutId);
  settings.activeWorkoutDailyNotePath = optionalStringSetting(settings.activeWorkoutDailyNotePath);
  settings.activeWorkoutPlanPath = optionalStringSetting(settings.activeWorkoutPlanPath);
  settings.activeWorkoutTitle = optionalStringSetting(settings.activeWorkoutTitle);
  settings.activeWorkoutStartedAt = optionalStringSetting(settings.activeWorkoutStartedAt);
  settings.lastSetEndedAt = optionalStringSetting(settings.lastSetEndedAt);

  if (!WORKOUT_LOG_TARGETS.includes(settings.workoutLogTarget)) settings.workoutLogTarget = DEFAULT_SETTINGS.workoutLogTarget;
  if (settings.workoutLogTarget === "session-note") settings.workoutLogTarget = "both";
  if (!WORKOUT_DAILY_NOTE_PLACEMENTS.includes(settings.workoutDailyNotePlacement)) settings.workoutDailyNotePlacement = DEFAULT_SETTINGS.workoutDailyNotePlacement;
  if (!FOOD_LOG_TARGETS.includes(settings.foodLogTarget)) settings.foodLogTarget = DEFAULT_SETTINGS.foodLogTarget;
  if (!REST_TIMER_MODES.includes(settings.restTimerMode)) settings.restTimerMode = DEFAULT_SETTINGS.restTimerMode;
  if (!WORKOUT_SET_NOTATIONS.includes(settings.workoutSetNotation)) settings.workoutSetNotation = DEFAULT_SETTINGS.workoutSetNotation;
  if (!WORKOUT_INTERVAL_MODES.includes(settings.workoutIntervalMode)) settings.workoutIntervalMode = DEFAULT_SETTINGS.workoutIntervalMode;
  if (!HEALTH_ENTITY_IDENTIFICATION_MODES.includes(settings.foodIdentificationMode)) settings.foodIdentificationMode = DEFAULT_SETTINGS.foodIdentificationMode;
  if (!HEALTH_ENTITY_IDENTIFICATION_MODES.includes(settings.workoutIdentificationMode)) settings.workoutIdentificationMode = DEFAULT_SETTINGS.workoutIdentificationMode;
  if (!WORKOUT_LOG_TARGETS.includes(settings.activeWorkoutTarget)) settings.activeWorkoutTarget = "";

  settings.defaultRestSeconds = positiveInteger(settings.defaultRestSeconds, DEFAULT_SETTINGS.defaultRestSeconds);
  settings.defaultWorkoutCooldownDays = nonNegativeInteger(settings.defaultWorkoutCooldownDays, DEFAULT_SETTINGS.defaultWorkoutCooldownDays);
  settings.calorieGoal = positiveNumber(settings.calorieGoal, DEFAULT_SETTINGS.calorieGoal);
  settings.proteinGoalG = positiveNumber(settings.proteinGoalG, DEFAULT_SETTINGS.proteinGoalG);
  settings.activityGoalMinutes = positiveNumber(settings.activityGoalMinutes, DEFAULT_SETTINGS.activityGoalMinutes);
  settings.activeWorkoutCooldownDays = nonNegativeInteger(settings.activeWorkoutCooldownDays, DEFAULT_SETTINGS.activeWorkoutCooldownDays);
  settings.activeWorkoutSetCount = nonNegativeInteger(settings.activeWorkoutSetCount, 0);
  settings.pendingFoodLogDraft = normalizePendingFoodLogDraft(settings.pendingFoodLogDraft);

  settings.appendWorkoutSummaryToDailyNote = booleanSetting(settings.appendWorkoutSummaryToDailyNote, DEFAULT_SETTINGS.appendWorkoutSummaryToDailyNote);
  settings.showFoodLogButtonInGcm = booleanSetting(settings.showFoodLogButtonInGcm, DEFAULT_SETTINGS.showFoodLogButtonInGcm);
  settings.automaticDailyRollups = booleanSetting(settings.automaticDailyRollups, DEFAULT_SETTINGS.automaticDailyRollups);
  settings.includeBrandedFoodSearch = booleanSetting(settings.includeBrandedFoodSearch, DEFAULT_SETTINGS.includeBrandedFoodSearch);
  settings.enableLogging = booleanSetting(settings.enableLogging, DEFAULT_SETTINGS.enableLogging);

  settings.healthGoals = normalizeHealthGoals(settings.healthGoals, settings);
  settings.settingsVersion = isFutureTPSHealthSettings(storedRecord)
    ? healthSettingsVersion(storedRecord)
    : TPS_HEALTH_SCHEMA_VERSION;

  const preserved = Object.entries(storedRecord).reduce((result, [key, value]) => {
    result[key] = cloneSettingValue(value);
    return result;
  }, {} as SettingsRecord);
  for (const key of REMOVED_SETTING_KEYS) delete preserved[key];
  for (const [key, value] of Object.entries(settings as unknown as SettingsRecord)) {
    preserved[key] = cloneSettingValue(value);
  }
  return preserved as unknown as TPSHealthSettings;
}

export function healthSettingsVersion(value: unknown): number {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as SettingsRecord : {};
  const parsed = Number(record.settingsVersion);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function isFutureTPSHealthSettings(value: unknown): boolean {
  return healthSettingsVersion(value) > TPS_HEALTH_SCHEMA_VERSION;
}

export function mergeTPSHealthSettingsChanges(
  latestStored: unknown,
  localSettings: TPSHealthSettings,
  changedKeys: readonly string[],
  retainedLegacyUsdaApiKey = "",
): TPSHealthSettings & { usdaApiKey?: string } {
  const merged = normalizeTPSHealthSettings(latestStored);
  const mergedRecord = merged as unknown as SettingsRecord;
  const localRecord = localSettings as unknown as SettingsRecord;
  for (const key of changedKeys) {
    if (key === "settingsVersion" || !Object.prototype.hasOwnProperty.call(localRecord, key)) continue;
    mergedRecord[key] = cloneSettingValue(localRecord[key]);
  }
  return settingsPersistencePayload(normalizeTPSHealthSettings(mergedRecord), retainedLegacyUsdaApiKey);
}

export interface LegacyUsdaApiKeyMigration {
  secretName: string;
  secretNames: string[];
  value: string;
}

export function normalizeUsdaApiKeySecrets(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of source) {
    const reference = typeof entry === "string" ? entry.trim() : "";
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    normalized.push(reference);
    if (normalized.length >= USDA_API_KEY_SECRET_MAX) break;
  }
  return normalized;
}

export function legacyUsdaApiKeyValue(stored: unknown): string {
  const raw = stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored as SettingsRecord
    : {};
  const value = typeof raw.usdaApiKey === "string" ? raw.usdaApiKey.trim() : "";
  return value === USDA_DEMO_API_KEY ? "" : value;
}

export function planLegacyUsdaApiKeyMigration(
  stored: unknown,
  settings: TPSHealthSettings,
  readSecret: (name: string) => string | null,
): LegacyUsdaApiKeyMigration | null {
  const value = legacyUsdaApiKeyValue(stored);
  if (!value) return null;
  const secretNames = normalizeUsdaApiKeySecrets(settings.usdaApiKeySecrets);
  for (const secretName of secretNames) {
    if (String(readSecret(secretName) || "").trim() === value) return null;
  }
  for (const secretName of secretNames) {
    if (!String(readSecret(secretName) || "").trim()) return { secretName, secretNames, value };
  }
  if (secretNames.length >= USDA_API_KEY_SECRET_MAX) throw new Error("No empty USDA SecretStorage reference is available for legacy credential migration.");
  for (let suffix = 0; suffix < USDA_API_KEY_SECRET_MAX; suffix += 1) {
    const secretName = suffix === 0 ? USDA_API_KEY_SECRET : `${USDA_API_KEY_SECRET}-legacy-${suffix}`;
    if (secretNames.includes(secretName) || String(readSecret(secretName) || "").trim()) continue;
    return { secretName, secretNames: [...secretNames, secretName], value };
  }
  throw new Error("No safe USDA SecretStorage reference is available for legacy credential migration.");
}

export function settingsPersistencePayload(
  settings: TPSHealthSettings,
  retainedLegacyUsdaApiKey = "",
): TPSHealthSettings & { usdaApiKey?: string } {
  const payload: TPSHealthSettings & { usdaApiKey?: string } = { ...settings };
  for (const key of REMOVED_SETTING_KEYS) delete (payload as unknown as SettingsRecord)[key];
  const retained = retainedLegacyUsdaApiKey.trim();
  if (retained) payload.usdaApiKey = retained;
  return payload;
}

function normalizePendingFoodLogDraft(value: unknown): TPSHealthSettings["pendingFoodLogDraft"] {
  if (!value || typeof value !== "object") return null;
  const input = value as SettingsRecord;
  const rawItems = Array.isArray(input.selectionItems) ? input.selectionItems : [];
  const selectionItems = rawItems.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as SettingsRecord;
    const item = record.item && typeof record.item === "object" ? record.item as SettingsRecord : null;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const source = typeof item?.source === "string" ? item.source : "";
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!name || !source || !id) return null;
    const quantity = Number(record.quantity);
    const unit = typeof record.unit === "string" ? record.unit.trim() : "";
    const describedUnit = typeof record.describedUnit === "string" ? record.describedUnit.trim() : "";
    const estimatedUnitGrams = Number(record.estimatedUnitGrams);
    return {
      item: { ...item, id, name, source } as any,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit: unit || "serving",
      describedUnit: describedUnit || undefined,
      estimatedUnitGrams: Number.isFinite(estimatedUnitGrams) && estimatedUnitGrams > 0 ? estimatedUnitGrams : undefined,
    };
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  if (!selectionItems.length) return null;
  const context = input.dateContext && typeof input.dateContext === "object" ? input.dateContext as SettingsRecord : null;
  const dateIso = typeof context?.dateIso === "string" ? context.dateIso.trim() : "";
  const activeTab = input.activeTab === "barcode" || input.activeTab === "search" || input.activeTab === "mine" || input.activeTab === "describe" || input.activeTab === "quick" ? input.activeTab : undefined;
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : "pending-food-log",
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt.trim() ? input.updatedAt.trim() : new Date().toISOString(),
    activeTab,
    searchInput: typeof input.searchInput === "string" ? input.searchInput : "",
    consumedDateInput: typeof input.consumedDateInput === "string" ? input.consumedDateInput : "",
    dateContext: dateIso ? {
      dateIso,
      label: typeof context?.label === "string" ? context.label : dateIso,
      isToday: context?.isToday === true,
      foodLogTarget: context?.foodLogTarget === "daily-note" || context?.foodLogTarget === "single-file" ? context.foodLogTarget : undefined,
      focusAfterLog: typeof context?.focusAfterLog === "boolean" ? context.focusAfterLog : undefined,
    } : null,
    selectionItems,
  };
}

function cloneSettingValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneSettingValue);
  if (typeof value === "object" && value) {
    return Object.entries(value as SettingsRecord).reduce((clone, [key, entryValue]) => {
      clone[key] = cloneSettingValue(entryValue);
      return clone;
    }, {} as SettingsRecord);
  }
  return value;
}

function stringSetting(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function folderSetting(value: unknown, fallback: string): string {
  return normalizeVaultDestinationFolder(value, fallback);
}

function optionalStringSetting(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function frontmatterPropertyKeySetting(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(normalized) ? normalized : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeHealthGoalDefinition(value: unknown): HealthGoal | null {
  const input = typeof value === "object" && value ? value as SettingsRecord : {};
  const propertyKey = String(input.propertyKey || "").trim();
  const label = String(input.label || input.propertyKey || "").trim();
  if (!propertyKey || !label) return null;
  const rawKind = HEALTH_GOAL_KINDS.includes(input.kind as HealthGoalKind) ? input.kind as HealthGoalKind : "counter";
  const min = optionalNumber(input.min);
  const max = optionalNumber(input.max);
  const hasMin = min != null;
  const hasMax = max != null;
  const [lower, upper] = hasMin && hasMax && Number(min) > Number(max) ? [max, min] : [min, max];
  const kind =
    rawKind === "counter" ? "counter"
      : hasMin && hasMax ? "range"
      : rawKind === "range" && hasMin ? "min"
      : rawKind === "range" && hasMax ? "max"
      : rawKind;
  return {
    propertyKey,
    label,
    unit: String(input.unit || "").trim(),
    kind,
    min: lower,
    max: upper,
    color: typeof input.color === "string" ? input.color : undefined,
  };
}

function normalizeHealthGoals(value: unknown, settings: TPSHealthSettings): HealthGoal[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_SETTINGS.healthGoals;
  const goals = source.map((goal) => normalizeHealthGoalDefinition(goal)).filter((goal): goal is HealthGoal => Boolean(goal));

  const normalizedGoals = goals.length ? goals : DEFAULT_SETTINGS.healthGoals.map((goal) => ({ ...goal }));
  return applyBuiltInHealthGoalTargets(normalizedGoals, settings, "migrate-stale-defaults");
}

type BuiltInHealthGoalTargetSettings = Pick<TPSHealthSettings, "calorieGoal" | "proteinGoalG" | "activityGoalMinutes">;
type BuiltInHealthGoalTargetMode = "canonical" | "migrate-stale-defaults";

export function applyBuiltInHealthGoalTargets(
  goals: HealthGoal[],
  settings: BuiltInHealthGoalTargetSettings,
  mode: BuiltInHealthGoalTargetMode = "canonical",
): HealthGoal[] {
  return goals.map((goal) => {
    if (goal.propertyKey === "consumedCalories" || goal.propertyKey === "cal") {
      if (mode === "migrate-stale-defaults" && goal.max != null && goal.max !== DEFAULT_SETTINGS.calorieGoal) return { ...goal };
      return normalizeHealthGoalDefinition({
        ...goal,
        kind: goal.min == null ? "max" : "range",
        max: settings.calorieGoal,
      }) || { ...goal };
    }
    if (goal.propertyKey === "protein") {
      if (mode === "migrate-stale-defaults" && goal.min != null && goal.min !== DEFAULT_SETTINGS.proteinGoalG) return { ...goal };
      return normalizeHealthGoalDefinition({
        ...goal,
        kind: goal.max == null ? "min" : "range",
        min: settings.proteinGoalG,
      }) || { ...goal };
    }
    if (goal.propertyKey === "activity") {
      if (mode === "migrate-stale-defaults" && goal.min != null && goal.min !== DEFAULT_SETTINGS.activityGoalMinutes) return { ...goal };
      return normalizeHealthGoalDefinition({
        ...goal,
        kind: goal.max == null ? "min" : "range",
        min: settings.activityGoalMinutes,
      }) || { ...goal };
    }
    return { ...goal };
  });
}
