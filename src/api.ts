import { ActivityLogEntry, ActivitySource, ExerciseItem, FoodItem, FoodLogEntry, FoodNoteType, HealthGoalKind, Nutrition, NutritionBasis, TPSHealthSettings, WorkoutLogTarget, WorkoutPlanItem, WorkoutSet } from "./types";
import type { TPSHealthHomeActionProvider } from "./home-actions";

export interface LogFoodInput {
  item?: FoodItem;
  query?: string;
  barcode?: string;
  quantity?: number;
  unit?: string;
  servingQuantity?: number;
  servingUnit?: string;
  section?: string;
  completedDate?: string;
  createFoodNote?: boolean;
}

export interface CreateFoodInput {
  type?: FoodNoteType;
  name: string;
  brand?: string;
  aliases?: string[];
  barcode?: string;
  imageUrl?: string;
  ingredients?: string;
  recipeBody?: string;
  servingAmount?: number;
  servingUnit?: string;
  servingGrams?: number;
  servingMl?: number;
  nutritionBasis?: NutritionBasis;
  recipeServings?: number;
  nutrition?: Nutrition;
  sourceImagePath?: string;
  confidence?: number;
  notes?: string;
}

export interface UpsertFoodInput extends CreateFoodInput {
  path?: string;
  merge?: boolean;
  openFile?: boolean;
}

export interface FoodLabelInput extends UpsertFoodInput {
  servingSizeText?: string;
  labelImagePath?: string;
}

export interface LogFoodByNameInput extends Omit<LogFoodInput, "item" | "query" | "barcode"> {
  name: string;
  brand?: string;
}

export interface LogFoodByBarcodeInput extends Omit<LogFoodInput, "item" | "query" | "barcode"> {
  barcode: string;
}

export interface LogFoodByFoodPathInput extends Omit<LogFoodInput, "item" | "query" | "barcode"> {
  foodPath: string;
}

export interface LogSetInput extends Omit<WorkoutSet, "id" | "endedAt" | "restSeconds"> {
  restSeconds?: number;
  createExerciseNote?: boolean;
}

export interface CreateExerciseInput {
  name: string;
  category?: ExerciseItem["category"];
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  equipment?: string[];
  defaultRestSeconds?: number;
  defaultSetType?: ExerciseItem["defaultSetType"];
  recommendedRestDays?: number;
  notes?: string;
}

export interface UpsertExerciseInput extends CreateExerciseInput {
  path?: string;
  merge?: boolean;
}

export interface CreateWorkoutPlanInput {
  name: string;
  cooldownDays?: number;
  defaultRestSeconds?: number;
  notes?: string;
}

export interface UpsertWorkoutPlanInput extends CreateWorkoutPlanInput {
  path?: string;
  merge?: boolean;
}

export interface StartWorkoutInput {
  title?: string;
  plan?: string;
  planPath?: string;
  createPlanNote?: boolean;
  cooldownDays?: number;
  logTarget?: WorkoutLogTarget;
  startedAt?: string;
  dailyNoteDate?: string;
  openFile?: boolean;
}

export interface LogActivityInput {
  activity: string;
  activityType?: string;
  startedAt?: string;
  completedDate?: string;
  durationMinutes?: number;
  distance?: number;
  distanceUnit?: string;
  steps?: number;
  caloriesBurned?: number;
  source?: ActivitySource;
  sourceId?: string;
  device?: string;
  note?: string;
  dailyNoteDate?: string;
}

export interface FinishWorkoutInput {
  endedAt?: string;
  cooldownDays?: number;
}

export interface DailyRollup {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sugarAlcoholG: number;
  alcoholG: number;
  sodiumMg: number;
}

export interface HealthMetricRenderConfig {
  propertyKey: string;
  label: string;
  unit: string;
  kind: HealthGoalKind;
  goal?: number;
  min?: number;
  max?: number;
  color?: string;
}

export type HealthPropertyCatalogType = "text" | "number" | "datetime" | "selector" | "list";

export interface HealthPropertyCatalogScope {
  mode: "any" | "all";
  tags?: string[];
  paths?: string[];
  properties?: Array<{
    key: string;
    value: string;
    operator: "equals" | "exists";
  }>;
}

export interface HealthPropertyCatalogEntry {
  id: string;
  key: string;
  label: string;
  type: HealthPropertyCatalogType;
  icon?: string;
  options?: string[];
  listItemType?: "text";
  scope: HealthPropertyCatalogScope;
}

export interface HealthPropertyCatalog {
  version: 1;
  food: HealthPropertyCatalogEntry[];
  dailyRollups: HealthPropertyCatalogEntry[];
}

export interface TPSHealthApiSchema {
  version: 1;
  entities: {
    food: string[];
    foodLog: string[];
    activityLog: string[];
    exercise: string[];
    workoutPlan: string[];
    workoutSession: string[];
    workoutSet: string[];
  };
  examples: Record<string, unknown>;
}

export interface ActiveWorkoutState {
  id: string;
  target: WorkoutLogTarget | "";
  path: string;
  dailyNotePath: string;
  planPath: string;
  title: string;
  startedAt: string;
  cooldownDays: number;
  lastSetEndedAt: string;
  setCount: number;
}

export interface DailyFoodMacroTotals extends Required<Nutrition> {
  dateIso: string;
  entryCount: number;
}

export interface TPSHealthApi {
  version: 1;
  homeActions?: TPSHealthHomeActionProvider;
  getSchema(): TPSHealthApiSchema;
  searchFoods(query: string): Promise<FoodItem[]>;
  lookupBarcode(barcode: string): Promise<FoodItem | null>;
  createFood(input: CreateFoodInput): Promise<FoodItem>;
  upsertFood(input: UpsertFoodInput): Promise<FoodItem>;
  createFoodFromLabel(input: FoodLabelInput): Promise<FoodItem>;
  findOrCreateFood(item: FoodItem): Promise<FoodItem>;
  logFoodByName(input: LogFoodByNameInput): Promise<FoodLogEntry>;
  logFoodByBarcode(input: LogFoodByBarcodeInput): Promise<FoodLogEntry>;
  logFoodByFoodPath(input: LogFoodByFoodPathInput): Promise<FoodLogEntry>;
  ensureFoodLogBase(): Promise<string>;
  getDailyFoodMacroTotals(dateIso: string): Promise<DailyFoodMacroTotals>;
  ensureWorkoutLogBase(): Promise<string>;
  ensureActivityLogBase(): Promise<string>;
  logActivity(input: LogActivityInput): Promise<ActivityLogEntry>;
  searchExercises(query: string): Promise<ExerciseItem[]>;
  createExercise(input: CreateExerciseInput): Promise<ExerciseItem>;
  upsertExercise(input: UpsertExerciseInput): Promise<ExerciseItem>;
  findOrCreateExercise(input: CreateExerciseInput): Promise<ExerciseItem>;
  searchWorkoutPlans(query: string): Promise<WorkoutPlanItem[]>;
  createWorkoutPlan(input: CreateWorkoutPlanInput): Promise<WorkoutPlanItem>;
  upsertWorkoutPlan(input: UpsertWorkoutPlanInput): Promise<WorkoutPlanItem>;
  findOrCreateWorkoutPlan(input: CreateWorkoutPlanInput): Promise<WorkoutPlanItem>;
  logFood(input: LogFoodInput): Promise<FoodLogEntry>;
  startWorkout(input?: StartWorkoutInput): Promise<string>;
  finishWorkout(input?: FinishWorkoutInput): Promise<void>;
  logSet(input: LogSetInput): Promise<WorkoutSet>;
  getActiveWorkoutPath(): string;
  getActiveWorkout(): ActiveWorkoutState | null;
  getSettings(): TPSHealthSettings;
  getDailyRollup(): Promise<DailyRollup>;
  updateDailyRollup(): Promise<DailyRollup>;
  getMetricRenderConfigs(): HealthMetricRenderConfig[];
  getMetricRenderConfig(propertyKey: string): HealthMetricRenderConfig | null;
  getPropertyCatalog(): HealthPropertyCatalog;
  openFoodLogEntryMenuFromLine(event: MouseEvent, filePath: string, lineNumber: number, line: string): Promise<void>;
}
