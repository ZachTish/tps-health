import { DEFAULT_SETTINGS, HealthGoal, HealthGoalKind, TPSHealthSettings } from "./types";

export const LEGACY_SETTING_KEYS = ["foodLogHeading"] as const;

type SettingsRecord = Record<string, unknown>;

const WORKOUT_LOG_TARGETS = ["session-note", "daily-note", "both"];
const FOOD_LOG_TARGETS = ["daily-note", "single-file"];
const REST_TIMER_MODES = ["count-up", "count-down"];
const WORKOUT_SESSION_BODY_MODES = ["blank", "sets-section"];
const WORKOUT_EXERCISE_LAYOUTS = ["flat", "exercise-bullets", "exercise-headings"];
const WORKOUT_SET_NOTATIONS = ["compact", "verbose"];
const WORKOUT_SET_STORAGES = ["task", "bullet"];
const HEALTH_GOAL_KINDS: HealthGoalKind[] = ["min", "max", "range", "counter"];

export function normalizeTPSHealthSettings(stored: Partial<TPSHealthSettings> | SettingsRecord | null | undefined): TPSHealthSettings {
  const raw = { ...DEFAULT_SETTINGS, ...(stored || {}) } as SettingsRecord;
  const settings = Object.keys(DEFAULT_SETTINGS).reduce((normalized, key) => {
    normalized[key] = cloneSettingValue(raw[key]);
    return normalized;
  }, {} as SettingsRecord) as unknown as TPSHealthSettings;

  settings.dailyNoteFormat = stringSetting(settings.dailyNoteFormat, DEFAULT_SETTINGS.dailyNoteFormat);
  settings.dailyNoteFolder = optionalStringSetting(settings.dailyNoteFolder);
  settings.workoutsFolder = stringSetting(settings.workoutsFolder, DEFAULT_SETTINGS.workoutsFolder);
  settings.workoutPlansFolder = stringSetting(settings.workoutPlansFolder, DEFAULT_SETTINGS.workoutPlansFolder);
  settings.exercisesFolder = stringSetting(settings.exercisesFolder, DEFAULT_SETTINGS.exercisesFolder);
  settings.foodsFolder = stringSetting(settings.foodsFolder, DEFAULT_SETTINGS.foodsFolder);
  settings.recipesFolder = stringSetting(settings.recipesFolder, DEFAULT_SETTINGS.recipesFolder);
  settings.workoutTemplatePath = optionalStringSetting(settings.workoutTemplatePath);
  settings.workoutPlanTemplatePath = optionalStringSetting(settings.workoutPlanTemplatePath);
  settings.exerciseTemplatePath = optionalStringSetting(settings.exerciseTemplatePath);
  settings.foodTemplatePath = optionalStringSetting(settings.foodTemplatePath);
  settings.defaultFoodLogSection = optionalStringSetting(settings.defaultFoodLogSection);
  settings.foodLogFilePath = stringSetting(settings.foodLogFilePath, DEFAULT_SETTINGS.foodLogFilePath);
  settings.workoutLogHeading = stringSetting(settings.workoutLogHeading, DEFAULT_SETTINGS.workoutLogHeading);
  settings.exerciseTag = stringSetting(settings.exerciseTag, DEFAULT_SETTINGS.exerciseTag);
  settings.customFoodTag = stringSetting(settings.customFoodTag, DEFAULT_SETTINGS.customFoodTag);
  settings.recipeTag = stringSetting(settings.recipeTag, DEFAULT_SETTINGS.recipeTag);
  settings.rollupHeading = stringSetting(settings.rollupHeading, DEFAULT_SETTINGS.rollupHeading);
  settings.openFoodFactsUserAgent = stringSetting(settings.openFoodFactsUserAgent, DEFAULT_SETTINGS.openFoodFactsUserAgent);
  settings.usdaApiKey = stringSetting(settings.usdaApiKey, DEFAULT_SETTINGS.usdaApiKey);
  settings.activeWorkoutPath = optionalStringSetting(settings.activeWorkoutPath);
  settings.activeWorkoutId = optionalStringSetting(settings.activeWorkoutId);
  settings.activeWorkoutDailyNotePath = optionalStringSetting(settings.activeWorkoutDailyNotePath);
  settings.activeWorkoutPlanPath = optionalStringSetting(settings.activeWorkoutPlanPath);
  settings.activeWorkoutTitle = optionalStringSetting(settings.activeWorkoutTitle);
  settings.activeWorkoutStartedAt = optionalStringSetting(settings.activeWorkoutStartedAt);
  settings.lastSetEndedAt = optionalStringSetting(settings.lastSetEndedAt);

  if (!WORKOUT_LOG_TARGETS.includes(settings.workoutLogTarget)) settings.workoutLogTarget = DEFAULT_SETTINGS.workoutLogTarget;
  if (!FOOD_LOG_TARGETS.includes(settings.foodLogTarget)) settings.foodLogTarget = DEFAULT_SETTINGS.foodLogTarget;
  if (!REST_TIMER_MODES.includes(settings.restTimerMode)) settings.restTimerMode = DEFAULT_SETTINGS.restTimerMode;
  if (!WORKOUT_SESSION_BODY_MODES.includes(settings.workoutSessionBodyMode)) settings.workoutSessionBodyMode = DEFAULT_SETTINGS.workoutSessionBodyMode;
  if (!WORKOUT_EXERCISE_LAYOUTS.includes(settings.workoutExerciseLayout)) settings.workoutExerciseLayout = DEFAULT_SETTINGS.workoutExerciseLayout;
  if (!WORKOUT_SET_NOTATIONS.includes(settings.workoutSetNotation)) settings.workoutSetNotation = DEFAULT_SETTINGS.workoutSetNotation;
  if (!WORKOUT_SET_STORAGES.includes(settings.workoutSetStorage)) settings.workoutSetStorage = DEFAULT_SETTINGS.workoutSetStorage;
  if (!WORKOUT_LOG_TARGETS.includes(settings.activeWorkoutTarget)) settings.activeWorkoutTarget = "";

  settings.defaultRestSeconds = positiveInteger(settings.defaultRestSeconds, DEFAULT_SETTINGS.defaultRestSeconds);
  settings.defaultWorkoutCooldownDays = nonNegativeInteger(settings.defaultWorkoutCooldownDays, DEFAULT_SETTINGS.defaultWorkoutCooldownDays);
  settings.calorieGoal = positiveNumber(settings.calorieGoal, DEFAULT_SETTINGS.calorieGoal);
  settings.proteinGoalG = positiveNumber(settings.proteinGoalG, DEFAULT_SETTINGS.proteinGoalG);
  settings.activityGoalMinutes = positiveNumber(settings.activityGoalMinutes, DEFAULT_SETTINGS.activityGoalMinutes);
  settings.activeWorkoutCooldownDays = nonNegativeInteger(settings.activeWorkoutCooldownDays, DEFAULT_SETTINGS.activeWorkoutCooldownDays);
  settings.activeWorkoutSetCount = nonNegativeInteger(settings.activeWorkoutSetCount, 0);

  settings.appendWorkoutSummaryToDailyNote = booleanSetting(settings.appendWorkoutSummaryToDailyNote, DEFAULT_SETTINGS.appendWorkoutSummaryToDailyNote);
  settings.showFoodLogButtonInGcm = booleanSetting(settings.showFoodLogButtonInGcm, DEFAULT_SETTINGS.showFoodLogButtonInGcm);
  settings.automaticDailyRollups = booleanSetting(settings.automaticDailyRollups, DEFAULT_SETTINGS.automaticDailyRollups);
  settings.includeBrandedFoodSearch = booleanSetting(settings.includeBrandedFoodSearch, DEFAULT_SETTINGS.includeBrandedFoodSearch);

  settings.healthGoals = normalizeHealthGoals(settings.healthGoals, settings);
  return settings;
}

function cloneSettingValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? { ...item } : item);
  if (typeof value === "object" && value) return { ...value };
  return value;
}

function stringSetting(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function optionalStringSetting(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeHealthGoals(value: unknown, settings: TPSHealthSettings): HealthGoal[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_SETTINGS.healthGoals;
  const goals = source.map((goal) => {
    const input = typeof goal === "object" && goal ? goal as SettingsRecord : {};
    const propertyKey = String(input.propertyKey || "").trim();
    const label = String(input.label || input.propertyKey || "").trim();
    const kind = HEALTH_GOAL_KINDS.includes(input.kind as HealthGoalKind) ? input.kind as HealthGoalKind : "counter";
    return {
      propertyKey,
      label,
      unit: String(input.unit || "").trim(),
      kind,
      min: optionalNumber(input.min),
      max: optionalNumber(input.max),
      color: typeof input.color === "string" ? input.color : undefined,
    };
  }).filter((goal) => goal.propertyKey && goal.label);

  const normalizedGoals = goals.length ? goals : DEFAULT_SETTINGS.healthGoals.map((goal) => ({ ...goal }));
  for (const goal of normalizedGoals) {
    if (goal.propertyKey === "cal" && goal.max == null) goal.max = settings.calorieGoal;
    if (goal.propertyKey === "protein" && goal.min == null) goal.min = settings.proteinGoalG;
    if (goal.propertyKey === "activity" && goal.min == null) goal.min = settings.activityGoalMinutes;
  }
  return normalizedGoals;
}
