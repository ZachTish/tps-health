export type RestTimerMode = "count-up" | "count-down";
export type FoodSource = "custom-note" | "custom-inline" | "open-food-facts" | "usda" | "curated" | "manual";
export type FoodNoteType = "food" | "recipe" | "meal";
export type HealthGoalKind = "min" | "max" | "range" | "counter";
export type FoodLogTarget = "daily-note" | "single-file";
export type WorkoutLogTarget = "session-note" | "daily-note" | "both";
export type ActivitySource = "manual" | "workout" | "apple-health";
export type WorkoutSetNotation = "compact" | "verbose";
export type HealthEntityIdentificationMode = "metadata-folder-tag" | "folder" | "tag" | "metadata";
export type WorkflowRecurrenceMode = "completion-triggered";
export type WorkflowTemplateKind = "workflow";
export type WorkflowRunKind = "run";
export type WorkflowRunType = "workout" | "workflow";

export const USDA_API_KEY_SECRET = "tps-health-usda-api-key";
export const USDA_API_KEY_SECRET_MAX = 5;
export const USDA_DEMO_API_KEY = "DEMO_KEY";
export const TPS_HEALTH_SCHEMA_VERSION = 1;

export interface HealthGoal {
  propertyKey: string;
  label: string;
  unit: string;
  kind: HealthGoalKind;
  min?: number;
  max?: number;
  color?: string;
}

export interface TPSHealthSettings {
  settingsVersion: number;
  dailyNoteFormat: string;
  dailyNoteFolder: string;
  workoutsFolder: string;
  workoutPlansFolder: string;
  exercisesFolder: string;
  foodsFolder: string;
  recipesFolder: string;
  workoutTemplatePath: string;
  workoutPlanTemplatePath: string;
  exerciseTemplatePath: string;
  foodTemplatePath: string;
  restTimerMode: RestTimerMode;
  defaultRestSeconds: number;
  defaultWorkoutCooldownDays: number;
  workoutSetNotation: WorkoutSetNotation;
  appendWorkoutSummaryToDailyNote: boolean;
  defaultFoodLogSection: string;
  foodLogFilePath: string;
  workoutLogTarget: WorkoutLogTarget;
  foodIdentificationMode: HealthEntityIdentificationMode;
  workoutIdentificationMode: HealthEntityIdentificationMode;
  workoutTag: string;
  exerciseTag: string;
  customFoodTag: string;
  recipeTag: string;
  foodLogTarget: FoodLogTarget;
  showFoodLogButtonInGcm: boolean;
  automaticDailyRollups: boolean;
  includeBrandedFoodSearch: boolean;
  healthGoals: HealthGoal[];
  calorieGoal: number;
  proteinGoalG: number;
  activityGoalMinutes: number;
  rollupHeading: string;
  openFoodFactsUserAgent: string;
  usdaApiKeySecrets: string[];
  activeWorkoutPath: string;
  activeWorkoutId: string;
  activeWorkoutTarget: WorkoutLogTarget | "";
  activeWorkoutDailyNotePath: string;
  activeWorkoutPlanPath: string;
  activeWorkoutTitle: string;
  activeWorkoutStartedAt: string;
  activeWorkoutCooldownDays: number;
  lastSetEndedAt: string;
  activeWorkoutSetCount: number;
  pendingFoodLogDraft: PendingFoodLogDraft | null;
  enableLogging: boolean;
}

export interface Nutrition {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sugarAlcoholG?: number;
  sugarAlcoholCaloriesPerG?: number;
  alcoholG?: number;
  sodiumMg?: number;
}

export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  aliases?: string[];
  barcode?: string;
  imageUrl?: string;
  sourceImagePath?: string;
  ingredients?: string;
  servingAmount?: number;
  servingUnit?: string;
  servingGrams?: number;
  servingMl?: number;
  recipeServings?: number;
  source: FoodSource;
  sourcePath?: string;
  confidence?: number;
  notes?: string;
  nutrition?: Nutrition;
}

export interface FoodLogEntry {
  id: string;
  createdDate: string;
  completedDate?: string;
  item: FoodItem;
  nutritionOverride?: Nutrition;
  quantity: number;
  unit: string;
  servingQuantity?: number;
  servingUnit?: string;
  amount?: number;
  amountUnit?: "g" | "ml";
  section?: string;
  note?: string;
  dailyNotePath?: string;
}

export interface ActivityLogEntry {
  id: string;
  activity: string;
  activityType: string;
  startedAt: string;
  completedDate: string;
  durationMinutes?: number;
  distance?: number;
  distanceUnit?: string;
  steps?: number;
  caloriesBurned?: number;
  source: ActivitySource;
  sourceId?: string;
  device?: string;
  note?: string;
  dailyNotePath?: string;
}

export interface PendingFoodLogDraft {
  id: string;
  updatedAt: string;
  activeTab?: "barcode" | "search" | "mine" | "describe";
  searchInput?: string;
  consumedDateInput?: string;
  dateContext?: {
    dateIso: string;
    label: string;
    isToday: boolean;
    foodLogTarget?: FoodLogTarget;
    focusAfterLog?: boolean;
  } | null;
  selectionItems: Array<{
    item: FoodItem;
    quantity: number;
    unit: string;
    describedUnit?: string;
    estimatedUnitGrams?: number;
  }>;
}

export interface WorkoutSet {
  id: string;
  exercise: string;
  exercisePath?: string;
  workoutPath?: string;
  workoutPlanPath?: string;
  createdDate?: string;
  completedDate?: string;
  startedAt?: string;
  endedAt: string;
  setType?: "normal" | "warmup" | "drop" | "failure";
  reps?: number;
  weight?: number;
  weightUnit?: string;
  perArm?: boolean;
  distance?: number;
  distanceUnit?: string;
  durationSeconds?: number;
  rpe?: number;
  restSeconds?: number;
  restStartedAt?: string;
  dropSetGroupId?: string;
  supersetGroupId?: string;
  note?: string;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  supersetGroupId?: string;
  sets: WorkoutSet[];
}

export interface ExerciseItem {
  id: string;
  name: string;
  sourcePath?: string;
  category?: "strength" | "cardio" | "mobility" | "bodyweight" | "timed" | "other";
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  equipment?: string[];
  defaultRestSeconds?: number;
  defaultSetType?: "normal" | "warmup" | "drop" | "failure";
  recommendedRestDays?: number;
  notes?: string;
}

export interface WorkoutPlanItem {
  id: string;
  name: string;
  sourcePath?: string;
  workflowType?: WorkflowRunType;
  workflowKind?: WorkflowTemplateKind;
  recurrenceMode?: WorkflowRecurrenceMode;
  cooldownDays?: number;
  targetGapDays?: number;
  defaultRestSeconds?: number;
  lastCompletedDate?: string;
  nextEligibleDate?: string;
  notes?: string;
}

export interface WorkoutSession {
  id: string;
  title: string;
  path: string;
  workoutPlanPath?: string;
  runKind?: WorkflowRunKind;
  runType?: WorkflowRunType;
  workflowPath?: string;
  workflowName?: string;
  recurrenceMode?: WorkflowRecurrenceMode;
  startedAt: string;
  endedAt?: string;
  previousCompletedDate?: string;
  secondsSincePreviousCompletion?: number;
  cooldownDays?: number;
  targetGapDays?: number;
  nextEligibleDate?: string;
  exercises: WorkoutExercise[];
}

export const DEFAULT_SETTINGS: TPSHealthSettings = {
  settingsVersion: TPS_HEALTH_SCHEMA_VERSION,
  dailyNoteFormat: "ddd, MMM DD YYYY",
  dailyNoteFolder: "",
  workoutsFolder: "Health/Workouts",
  workoutPlansFolder: "Health/Workout Plans",
  exercisesFolder: "Health/Exercises",
  foodsFolder: "Health/Foods",
  recipesFolder: "Health/Recipes",
  workoutTemplatePath: "",
  workoutPlanTemplatePath: "",
  exerciseTemplatePath: "",
  foodTemplatePath: "",
  restTimerMode: "count-up",
  defaultRestSeconds: 90,
  defaultWorkoutCooldownDays: 0,
  workoutSetNotation: "compact",
  appendWorkoutSummaryToDailyNote: true,
  defaultFoodLogSection: "",
  foodLogFilePath: "Health/Food Log.md",
  workoutLogTarget: "session-note",
  foodIdentificationMode: "metadata-folder-tag",
  workoutIdentificationMode: "metadata-folder-tag",
  workoutTag: "#tps/workout",
  exerciseTag: "#tps/exercise",
  customFoodTag: "#tps/food",
  recipeTag: "#tps/recipe",
  foodLogTarget: "daily-note",
  showFoodLogButtonInGcm: false,
  automaticDailyRollups: true,
  includeBrandedFoodSearch: true,
  healthGoals: [
    { propertyKey: "consumedCalories", label: "Consumed calories", unit: "kcal", kind: "max", max: 2400, color: "var(--interactive-accent)" },
    { propertyKey: "protein", label: "Protein", unit: "g", kind: "min", min: 180, color: "var(--color-green)" },
    { propertyKey: "carbs", label: "Carbs", unit: "g", kind: "range", min: 120, max: 260, color: "var(--color-blue)" },
    { propertyKey: "fat", label: "Fat", unit: "g", kind: "range", min: 45, max: 90, color: "var(--color-yellow)" },
    { propertyKey: "fiber", label: "Fiber", unit: "g", kind: "min", min: 30, color: "var(--color-green)" },
    { propertyKey: "sodium", label: "Sodium", unit: "mg", kind: "max", max: 2300, color: "var(--color-orange)" },
    { propertyKey: "activity", label: "Activity", unit: "min", kind: "min", min: 45, color: "var(--color-orange)" },
  ],
  calorieGoal: 2400,
  proteinGoalG: 180,
  activityGoalMinutes: 45,
  rollupHeading: "Health Rollup",
  openFoodFactsUserAgent: "TPSHealth/0.1 (Obsidian plugin)",
  usdaApiKeySecrets: [USDA_API_KEY_SECRET],
  activeWorkoutPath: "",
  activeWorkoutId: "",
  activeWorkoutTarget: "",
  activeWorkoutDailyNotePath: "",
  activeWorkoutPlanPath: "",
  activeWorkoutTitle: "",
  activeWorkoutStartedAt: "",
  activeWorkoutCooldownDays: 0,
  lastSetEndedAt: "",
  activeWorkoutSetCount: 0,
  pendingFoodLogDraft: null,
  enableLogging: false,
};
