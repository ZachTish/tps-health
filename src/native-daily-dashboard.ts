import type { DailyFoodMacroTotals, HealthMetricRenderConfig } from "./api";

export type NativeDailyMetricState = "below" | "within" | "above" | "neutral";

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
  };
}

export function formatNativeDailyMetricValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}
