import { FoodItem, FoodLogEntry, Nutrition, WorkoutPlanItem, WorkoutSet } from "./types";

export function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function formatNutrition(nutrition?: Nutrition): string {
  if (!nutrition) return "";
  const parts = [
    valuePart("cal", nutrition.calories),
    valuePart("protein", nutrition.proteinG, "g"),
    valuePart("carbs", nutrition.carbsG, "g"),
    valuePart("fat", nutrition.fatG, "g"),
    valuePart("fiber", nutrition.fiberG, "g"),
    valuePart("sugar", nutrition.sugarG, "g"),
    valuePart("alcohol", nutrition.alcoholG, "g"),
    valuePart("sodium", nutrition.sodiumMg, "mg"),
  ].filter(Boolean);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function foodEntryLine(entry: FoodLogEntry): string {
  const itemLabel = entry.item.sourcePath
    ? `[[${entry.item.sourcePath.replace(/\.md$/, "")}|${entry.item.name}]]`
    : entry.item.name;
  const itemName = entry.item.name;
  const servingLabel = entry.servingQuantity != null && entry.servingUnit ? `${entry.servingQuantity} ${entry.servingUnit}` : entry.amount != null && entry.amountUnit ? `${entry.amount} ${entry.amountUnit}` : `${entry.quantity} ${entry.unit}`;
  const summary = [
    servingLabel,
    itemLabel,
  ].filter(Boolean).join(" - ");
  const nutrition = getLogLineNutrition(entry);
  const fields = [
    dataviewField("food", itemName),
    dataviewField("qty", entry.servingQuantity ?? entry.quantity),
    dataviewField("unit", entry.servingUnit || entry.unit),
    dataviewField("servings", entry.quantity),
    entry.amount != null ? dataviewField("amount", entry.amount) : "",
    entry.amountUnit ? dataviewField("amountUnit", entry.amountUnit) : "",
    ...foodItemMetadataFields(entry.item),
    dataviewField("cal", nutrition.calories),
    dataviewField("protein", nutrition.proteinG),
    dataviewField("carbs", nutrition.carbsG),
    dataviewField("fat", nutrition.fatG),
    dataviewField("fiber", nutrition.fiberG),
    dataviewField("sugar", nutrition.sugarG),
    dataviewField("alcohol", nutrition.alcoholG),
    dataviewField("sodium", nutrition.sodiumMg),
    entry.item.sourcePath ? dataviewField("foodPath", entry.item.sourcePath) : "",
    entry.dailyNotePath ? dataviewField("dailyNotePath", entry.dailyNotePath) : "",
    entry.dailyNotePath ? dataviewField("dailyNote", wikilinkFromPath(entry.dailyNotePath)) : "",
    dataviewField("foodId", entry.id),
    dataviewField("createdDate", entry.createdDate),
    entry.completedDate ? dataviewField("completedDate", entry.completedDate) : "",
    entry.note ? dataviewField("note", entry.note) : "",
  ].filter(Boolean);
  return `- ${summary} ${fields.join(" ")}`;
}

function wikilinkFromPath(path: string): string {
  const normalized = path.replace(/\.md$/i, "");
  const label = normalized.split("/").pop() || normalized;
  return `[[${normalized}|${label}]]`;
}

function foodItemMetadataFields(item: FoodItem): string[] {
  return [
    item.brand ? dataviewField("brand", item.brand) : "",
    item.barcode ? dataviewField("barcode", item.barcode) : "",
    item.source ? dataviewField("source", item.source) : "",
    item.servingAmount != null ? dataviewField("foodServingAmount", item.servingAmount) : "",
    item.servingUnit ? dataviewField("foodServingUnit", item.servingUnit) : "",
    item.servingGrams != null ? dataviewField("foodServingGrams", item.servingGrams) : "",
    item.servingMl != null ? dataviewField("foodServingMl", item.servingMl) : "",
    item.imageUrl ? dataviewField("imageUrl", item.imageUrl) : "",
  ].filter(Boolean);
}

function getLogLineNutrition(entry: FoodLogEntry): Nutrition {
  if (entry.nutritionOverride) return entry.nutritionOverride;
  return scaleNutrition(entry.item.nutrition || {}, entry.quantity);
}

function scaleNutrition(nutrition: Nutrition, multiplier: number): Nutrition {
  const safeMultiplier = Number.isFinite(multiplier) ? multiplier : 1;
  return {
    calories: scaledValue(nutrition.calories, safeMultiplier),
    proteinG: scaledValue(nutrition.proteinG, safeMultiplier),
    carbsG: scaledValue(nutrition.carbsG, safeMultiplier),
    fatG: scaledValue(nutrition.fatG, safeMultiplier),
    fiberG: scaledValue(nutrition.fiberG, safeMultiplier),
    sugarG: scaledValue(nutrition.sugarG, safeMultiplier),
    alcoholG: scaledValue(nutrition.alcoholG, safeMultiplier),
    sodiumMg: scaledValue(nutrition.sodiumMg, safeMultiplier),
  };
}

function scaledValue(value: number | undefined, multiplier: number): number | undefined {
  if (value == null) return undefined;
  return Math.round(value * multiplier * 10) / 10;
}

export function workoutSetLine(set: WorkoutSet, options: { asTask?: boolean; notation?: "compact" | "verbose"; includeExercise?: boolean } = {}): string {
  const exerciseLabel = set.exercisePath
    ? `[[${set.exercisePath.replace(/\.md$/, "")}|${set.exercise}]]`
    : set.exercise;
  const summary = workoutSetSummary(set, exerciseLabel, options);
  const fields = [
    dataviewField("exercise", set.exercise),
    set.exercisePath ? dataviewField("exercisePath", set.exercisePath) : "",
    set.workoutPath ? dataviewField("workout", pathLabel(set.workoutPath)) : "",
    set.workoutPath ? dataviewField("workoutPath", set.workoutPath) : "",
    set.workoutPlanPath ? dataviewField("workoutPlan", pathLabel(set.workoutPlanPath)) : "",
    set.workoutPlanPath ? dataviewField("workoutPlanPath", set.workoutPlanPath) : "",
    dataviewField("setId", set.id),
    dataviewField("createdDate", set.createdDate || set.endedAt),
    dataviewField("completedDate", set.completedDate || set.endedAt),
    set.startedAt ? dataviewField("startedAt", set.startedAt) : "",
    dataviewField("endedAt", set.endedAt),
    set.setType ? dataviewField("setType", set.setType) : "",
    set.reps == null ? "" : dataviewField("reps", set.reps),
    set.weight == null ? "" : dataviewField("weight", set.weight),
    set.weightUnit ? dataviewField("unit", set.weightUnit) : "",
    set.durationSeconds == null ? "" : dataviewField("duration", set.durationSeconds),
    set.distance == null ? "" : dataviewField("distance", set.distance),
    set.distanceUnit ? dataviewField("distanceUnit", set.distanceUnit) : "",
    set.rpe == null ? "" : dataviewField("rpe", set.rpe),
    set.restSeconds == null ? "" : dataviewField("rest", set.restSeconds),
    set.dropSetGroupId ? dataviewField("dropSet", set.dropSetGroupId) : "",
    set.supersetGroupId ? dataviewField("superset", set.supersetGroupId) : "",
    set.note ? dataviewField("note", set.note) : "",
  ].filter(Boolean);
  return `- ${options.asTask ? "[x] " : ""}${summary} ${fields.join(" ")}`;
}

function pathLabel(path: string): string {
  const normalized = path.replace(/\.md$/i, "");
  return normalized.split("/").pop() || normalized;
}

function workoutSetSummary(set: WorkoutSet, exerciseLabel: string, options: { notation?: "compact" | "verbose"; includeExercise?: boolean }): string {
  const includeExercise = options.includeExercise !== false;
  const details = options.notation === "verbose" ? verboseWorkoutSetDetails(set) : compactWorkoutSetDetails(set);
  const markers = workoutSetMarkers(set);
  return [
    includeExercise ? exerciseLabel : "",
    ...markers,
    details,
  ].filter(Boolean).join(" - ");
}

function compactWorkoutSetDetails(set: WorkoutSet): string {
  const weight = set.weight == null ? "" : `${round(set.weight)}${set.weightUnit ? ` ${set.weightUnit}` : ""}`;
  const reps = set.reps == null ? "" : `${round(set.reps)}`;
  if (weight && reps) return `${weight} x ${reps}`;
  if (reps) return `${reps} reps`;
  if (weight) return weight;
  if (set.durationSeconds != null) return `${round(set.durationSeconds)}s`;
  if (set.distance != null) return `${round(set.distance)}${set.distanceUnit ? ` ${set.distanceUnit}` : ""}`;
  return "Set";
}

function verboseWorkoutSetDetails(set: WorkoutSet): string {
  return [
    set.reps == null ? "" : `${round(set.reps)} reps`,
    set.weight == null ? "" : `${round(set.weight)}${set.weightUnit ? ` ${set.weightUnit}` : ""}`,
    set.durationSeconds == null ? "" : `${round(set.durationSeconds)}s`,
    set.distance == null ? "" : `${round(set.distance)}${set.distanceUnit ? ` ${set.distanceUnit}` : ""}`,
  ].filter(Boolean).join(" - ");
}

function workoutSetMarkers(set: WorkoutSet): string[] {
  const markers: string[] = [];
  if (set.setType && set.setType !== "normal") markers.push(set.setType);
  if (set.supersetGroupId) markers.push(`superset ${set.supersetGroupId}`);
  if (set.dropSetGroupId && set.setType !== "drop") markers.push(`drop ${set.dropSetGroupId}`);
  return markers;
}

export function workoutSessionLine(input: {
  id: string;
  title: string;
  startedAt: string;
  path?: string;
  plan?: WorkoutPlanItem | null;
  cooldownDays?: number;
  status?: "active" | "complete";
  endedAt?: string;
  nextEligibleDate?: string;
}): string {
  const workoutLabel = input.path
    ? `[[${input.path.replace(/\.md$/, "")}|${input.title}]]`
    : input.plan?.sourcePath
      ? `[[${input.plan.sourcePath.replace(/\.md$/, "")}|${input.title}]]`
      : input.title;
  const fields = [
    dataviewField("workout", workoutLabel),
    dataviewField("workoutId", input.id),
    input.path ? dataviewField("workoutPath", input.path) : "",
    input.plan?.sourcePath ? dataviewField("workoutPlanPath", input.plan.sourcePath) : "",
    input.plan?.name ? dataviewField("workoutPlan", input.plan.name) : "",
    dataviewField("createdDate", input.startedAt),
    dataviewField("startedAt", input.startedAt),
    dataviewField("status", input.status || "active"),
    input.cooldownDays != null ? dataviewField("cooldownDays", input.cooldownDays) : "",
    input.endedAt ? dataviewField("completedDate", input.endedAt) : "",
    input.endedAt ? dataviewField("endedAt", input.endedAt) : "",
    input.nextEligibleDate ? dataviewField("nextEligibleDate", input.nextEligibleDate) : "",
  ].filter(Boolean);
  return `- ${workoutLabel} ${fields.join(" ")}`;
}

export function workoutSummaryLine(path: string, startedAt: string, endedAt?: string): string {
  const endPart = endedAt ? ` endedAt=${endedAt}` : "";
  return `- [tps-health:workout path="${escapeAttr(path)}" startedAt=${startedAt}${endPart}] [[${path.replace(/\.md$/, "")}]]`;
}

function valuePart(label: string, value?: number, unit = ""): string {
  return Number.isFinite(value) ? `${label}=${value}${unit}` : "";
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function dataviewField(key: string, value?: string | number): string {
  if (value == null || value === "") return "";
  return `[${key}:: ${typeof value === "number" ? round(value) : value}]`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
