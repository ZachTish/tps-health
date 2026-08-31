import type { DailyFoodMacroTotals, HealthMetricRenderConfig } from "./api";

export type NativeDailyMetricState = "below" | "within" | "above" | "neutral";
export type NativeDailyMacroStyle = "table" | "rings";
export type NativeDailyFoodListMode = "hidden" | "collapsed" | "expanded";

export interface NativeDailyDisplayOptions {
  macroStyle: NativeDailyMacroStyle;
  foodList: NativeDailyFoodListMode;
}

export type NativeDailyDisplayParseResult =
  | { kind: "valid"; options: NativeDailyDisplayOptions; filterSource: string }
  | { kind: "invalid"; message: string };

const unquotedOptionValue = (value: string): string => {
  const withoutComment = value.replace(/\s+#.*$/u, "").trim();
  const quoted = withoutComment.match(/^(["'])([\s\S]*)\1$/u);
  return String(quoted?.[2] ?? withoutComment).trim().toLowerCase();
};

export function parseNativeDailyDisplayOptions(source: string): NativeDailyDisplayParseResult {
  let macroStyle: NativeDailyMacroStyle = "table";
  let foodList: NativeDailyFoodListMode = "hidden";
  let sawStyle = false;
  let sawFoods = false;
  const filterLines: string[] = [];
  for (const line of String(source || "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const option = trimmed.match(/^(style|foods)\s*:\s*(.*?)\s*$/iu);
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
    if (sawFoods) return { kind: "invalid", message: "Add at most one foods option." };
    sawFoods = true;
    if (value === "true") foodList = "collapsed";
    else if (value === "false") foodList = "hidden";
    else if (value === "hidden" || value === "collapsed" || value === "expanded") foodList = value;
    else return { kind: "invalid", message: "Foods must be hidden, collapsed, or expanded." };
  }
  return {
    kind: "valid",
    options: { macroStyle, foodList },
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
    default: return null;
  }
};

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const targetLabel = (metric: HealthMetricRenderConfig): string => {
  const min = finite(metric.min);
  const max = finite(metric.max);
  if (metric.kind === "range" && min != null && max != null) return `${min}–${max} ${metric.unit}`;
  if (metric.kind === "min" && min != null) return `at least ${min} ${metric.unit}`;
  if (metric.kind === "max" && max != null) return `up to ${max} ${metric.unit}`;
  const goal = finite(metric.goal);
  return goal == null ? "No target" : `${goal} ${metric.unit}`;
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
      targetLabel: targetLabel(config),
      progress: metricProgress(value, config),
      state: metricState(value, config),
      color: config.color,
    };
    return [model];
  });
  return {
    dateIso: totals.dateIso,
    entryCount: totals.entryCount,
    calories: totals.calories,
    metrics,
    activity: buildNativeDailyActivityModel(activityTotals, configs),
  };
}

export function formatNativeDailyMetricValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}
