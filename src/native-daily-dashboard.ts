import { EXTRA_NUTRIENTS, extraNutrition, isExtraNutrientKey } from "./nutrients";
import type { DailyFoodMacroTotals, HealthMetricRenderConfig } from "./api";

export type NativeDailyMetricState = "below" | "within" | "above" | "neutral";
export type NativeDailyMacroStyle = "table" | "rings";
export type NativeDailyFoodListMode = "hidden" | "collapsed" | "expanded";

export interface NativeDailyDisplayOptions {
  macroStyle: NativeDailyMacroStyle;
  showCalories?: boolean;
  foodList: NativeDailyFoodListMode;
  nutrientRows?: NativeDailyFoodListMode;
}

export type NativeDailyDisplayParseResult =
  | { kind: "valid"; options: NativeDailyDisplayOptions; filterSource: string }
  | { kind: "invalid"; message: string };

const unquotedOptionValue = (value: string): string => {
  const withoutComment = value.replace(/\s+#.*$/u, "").trim();
  const quoted = withoutComment.match(/^(["'])([\s\S]*)\1$/u);
  return String(quoted?.[2] ?? withoutComment).trim().toLowerCase();
};

export function parseNativeDailyDisplayOptions(source: string, defaults: Partial<NativeDailyDisplayOptions> = {}): NativeDailyDisplayParseResult {
  let macroStyle: NativeDailyMacroStyle = defaults.macroStyle ?? "table";
  let foodList: NativeDailyFoodListMode = defaults.foodList ?? "hidden";
  let nutrientRows = defaults.nutrientRows;
  let sawNutrients = false;
  let sawStyle = false;
  let sawFoods = false;
  const filterLines: string[] = [];
  for (const line of String(source || "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const option = trimmed.match(/^(style|foods|nutrients)\s*:\s*(.*?)\s*$/iu);
    if (!option) {
      filterLines.push(line);
      continue;
    }
    const key = option[1].toLowerCase();
    const value = unquotedOptionValue(option[2]);
    if (key === "style") {
      if (sawStyle) return { kind: "invalid", message: "Add at most one macro style option." };
      sawStyle = true;
      if (value !== "table" && value !== "rings") {
        return { kind: "invalid", message: "Macro style must be table or rings." };
      }
      macroStyle = value;
      continue;
    }
    if (key === "nutrients") {
      if (sawNutrients) return { kind: "invalid", message: "Add at most one nutrients option." };
      sawNutrients = true;
      if (!["collapsed", "expanded", "hidden"].includes(value)) return { kind: "invalid", message: "Nutrients must be hidden, collapsed, or expanded." };
      nutrientRows = value as NativeDailyFoodListMode;
      continue;
    }
    if (sawFoods) return { kind: "invalid", message: "Add at most one foods option." };
    sawFoods = true;
    if (value === "true") foodList = "collapsed";
    else if (value === "false") foodList = "hidden";
    else if (value === "hidden" || value === "collapsed" || value === "expanded") foodList = value;
    else return { kind: "invalid", message: "Foods must be hidden, collapsed, or expanded." };
  }
  return {
    kind: "valid",
    options: { macroStyle, foodList, ...(nutrientRows ? { nutrientRows } : {}) },
    filterSource: filterLines.join("\n").trim(),
  };
}

export interface NativeDailyMetricModel {
  propertyKey: string;
  label: string;
  value: number;
  unit: string;
  targetLabel: string;
  progress: number;
  state: NativeDailyMetricState;
  color?: string;
}

export interface NativeDailyDashboardModel {
  dateIso: string;
  entryCount: number;
  calories: number;
  metrics: NativeDailyMetricModel[];
  activity: NativeDailyActivityModel;
}

export interface NativeDailyActivityTotals {
  dateIso: string;
  entryCount: number;
  durationMinutes: number;
  caloriesBurned: number;
  steps: number;
}

export interface NativeDailyActivityModel extends NativeDailyActivityTotals {
  metrics: NativeDailyMetricModel[];
}

export function buildNativeDailyActivityModel(
  activityTotals: NativeDailyActivityTotals,
  configs: readonly HealthMetricRenderConfig[],
): NativeDailyActivityModel {
  return {
    ...activityTotals,
    metrics: configs.flatMap((config) => {
      if (config.propertyKey !== "activity") return [];
      return [{
        propertyKey: config.propertyKey,
        label: config.label,
        value: activityTotals.durationMinutes,
        unit: config.unit,
        targetLabel: targetLabel(config),
        progress: metricProgress(activityTotals.durationMinutes, config),
        state: metricState(activityTotals.durationMinutes, config),
        color: config.color,
      }];
    }),
  };
}

const metricValue = (totals: DailyFoodMacroTotals, propertyKey: string): number | null => {
  switch (propertyKey) {
    case "consumedCalories":
    case "cal": return totals.calories;
    case "protein": return totals.proteinG;
    case "carbs": return totals.carbsG;
    case "fat": return totals.fatG;
    case "fiber": return totals.fiberG;
    case "sugar": return totals.sugarG;
    case "sugarAlcohol": return totals.sugarAlcoholG;
    case "alcohol": return totals.alcoholG;
    case "sodium": return totals.sodiumMg;
    default: return isExtraNutrientKey(propertyKey) ? (extraNutrition(totals)[propertyKey] ?? null) : null;
  }
};

/** Health owns these display choices; neither goals nor GCM menu fields are required. */
export function availableNutrientConfigs(configs: readonly HealthMetricRenderConfig[]): HealthMetricRenderConfig[] {
  const nutrients: HealthMetricRenderConfig[] = [
    { propertyKey: "fiber", label: "Fiber", unit: "g", kind: "min" },
    { propertyKey: "sugar", label: "Sugar", unit: "g", kind: "min" },
    { propertyKey: "sugarAlcohol", label: "Sugar alcohol", unit: "g", kind: "min" },
    { propertyKey: "alcohol", label: "Alcohol", unit: "g", kind: "min" },
    { propertyKey: "sodium", label: "Sodium", unit: "mg", kind: "min" },
    ...EXTRA_NUTRIENTS.map(n => ({ propertyKey: n.key, label: n.label, unit: n.unit, kind: "min" as const })),
  ];
  return [...configs, ...nutrients.filter(n => !configs.some(config => config.propertyKey === n.propertyKey))];
}

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const targetLabel = (metric: HealthMetricRenderConfig, format: (value: number) => string = String): string => {
  const min = finite(metric.min);
  const max = finite(metric.max);
  if (min == null && max == null && finite(metric.goal) == null) return "";
  if (metric.kind === "range" && min != null && max != null) return `${format(min)}–${format(max)} ${metric.unit}`;
  if (metric.kind === "min" && min != null) return `at least ${format(min)} ${metric.unit}`;
  if (metric.kind === "max" && max != null) return `up to ${format(max)} ${metric.unit}`;
  const goal = finite(metric.goal);
  return goal == null ? "No target" : `${format(goal)} ${metric.unit}`;
};

const metricState = (value: number, metric: HealthMetricRenderConfig): NativeDailyMetricState => {
  const min = finite(metric.min);
  const max = finite(metric.max);
  if (min != null && value < min) return "below";
  if (max != null && value > max) return "above";
  return min != null || max != null ? "within" : "neutral";
};

const metricProgress = (value: number, metric: HealthMetricRenderConfig): number => {
  const min = finite(metric.min);
  const max = finite(metric.max);
  const goal = finite(metric.goal);
  const denominator = metric.kind === "range" ? max ?? min : metric.kind === "max" ? max : min ?? goal;
  if (denominator == null || denominator <= 0) return 0;
  return clamp(value / denominator, 0, 1);
};

export function buildNativeDailyDashboardModel(
  totals: DailyFoodMacroTotals,
  configs: readonly HealthMetricRenderConfig[],
  activityTotals: NativeDailyActivityTotals = {
    dateIso: totals.dateIso,
    entryCount: 0,
    durationMinutes: 0,
    caloriesBurned: 0,
    steps: 0,
  },
): NativeDailyDashboardModel {
  const metrics = configs.flatMap((config) => {
    const value = metricValue(totals, config.propertyKey);
    if (value == null) return [];
    const model: NativeDailyMetricModel = {
      propertyKey: config.propertyKey,
      label: config.label,
      value,
      unit: config.unit,
      targetLabel: targetLabel(config, formatNativeDailyMacroValue),
      progress: metricProgress(value, config),
      state: metricState(value, config),
      color: config.color,
    };
    return [model];
  });
  for (const nutrient of availableNutrientConfigs([])) {
    const value = metricValue(totals, nutrient.propertyKey);
    // Core totals historically use zero for missing data. Do not fill the UI with
    // unknown zeroes; optional extended totals retain explicit known zeroes.
    if (value != null && (value > 0 || isExtraNutrientKey(nutrient.propertyKey))
      && !metrics.some(metric => metric.propertyKey === nutrient.propertyKey)) {
      metrics.push({ propertyKey: nutrient.propertyKey, label: nutrient.label, unit: nutrient.unit, value, targetLabel: "", progress: 0, state: "neutral" });
    }
  }
  return {
    dateIso: totals.dateIso,
    entryCount: totals.entryCount,
    calories: totals.calories,
    metrics,
    activity: buildNativeDailyActivityModel(activityTotals, configs),
  };
}

/** Display only: stored amounts, totals and progress retain their precision. */
export function formatNativeDailyMacroValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10) / 10;
  return String(Number.isFinite(rounded) ? rounded : value);
}

export function formatNativeDailyMetricValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
}

/** Rank logged entries, never add recipe children a second time to daily totals. */
export function nativeDailyNutrientContributors<T extends { title: string; path: string }>(
  propertyKey: string, entries: T[],
): Array<{ entry: T; value: number }> {
  const keys: Record<string, string> = {
    consumedCalories: 'calories', calories: 'calories', protein: 'proteinG', carbs: 'carbsG',
    fat: 'fatG', fiber: 'fiberG', sugar: 'sugarG', sugarAlcohol: 'sugarAlcoholG', alcohol: 'alcoholG', sodium: 'sodiumMg',
  };
  const key = keys[propertyKey] || (isExtraNutrientKey(propertyKey) ? propertyKey : "");
  if (!key) return [];
  return entries.map(entry => ({ entry, value: Number((entry as Record<string, unknown>)[key]) }))
    .filter(({ value }) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b.value - a.value || a.entry.title.localeCompare(b.entry.title) || a.entry.path.localeCompare(b.entry.path));
}

/** UI grouping only; no property names are written to notes. */
export function splitNativeDailyMetrics(metrics: NativeDailyMetricModel[]) {
  const primaryKeys = new Set(["consumedCalories", "cal", "protein", "carbs", "fat"]);
  return {
    primary: metrics.filter(metric => primaryKeys.has(metric.propertyKey)),
    other: metrics.filter(metric => !primaryKeys.has(metric.propertyKey)),
  };
}
