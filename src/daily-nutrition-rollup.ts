import { canonicalGoalKey, goalNutrients, trackedFoodNutrientKeys } from './nutrient-goals';
import { nutritionNumber } from './nutrients';
import type { HealthGoal } from './types';

export interface DailyNutritionRollupSettings {
  mode: 'off' | 'manual' | 'automatic';
  nutrients: string[];
}
export const DEFAULT_DAILY_NUTRITION_ROLLUP: DailyNutritionRollupSettings = {
  mode: 'off', nutrients: ['consumedCalories', 'protein', 'carbs', 'fat'],
};

export function normalizeDailyNutritionRollup(value: unknown): DailyNutritionRollupSettings {
  const raw = value && typeof value === 'object' ? value as Partial<DailyNutritionRollupSettings> : {};
  return {
    mode: raw.mode === 'automatic' || raw.mode === 'manual' ? raw.mode : 'off',
    // Preserve unknown selections while a custom nutrient is temporarily unavailable.
    nutrients: Array.isArray(raw.nutrients) ? [...new Set(raw.nutrients
      .filter((key): key is string => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(key))
      .map(canonicalGoalKey))] : [...DEFAULT_DAILY_NUTRITION_ROLLUP.nutrients],
  };
}

/** Inputs are the existing index's projected consumption, including missing values. */
export function dailyNutritionValues(rows: Record<string, unknown>[], selected: string[]): Record<string, number | null> {
  const available = new Set(goalNutrients().map(nutrient => nutrient.key));
  return Object.fromEntries([...new Set(selected)].map(key => {
    if (!available.has(key)) throw new Error(`Daily total nutrient is unavailable: ${key}`);
    const nutrient = [...trackedFoodNutrientKeys([{propertyKey: key} as HealthGoal])][0];
    if (!nutrient) throw new Error(`Daily total nutrient is unavailable: ${key}`);
    const values = rows.map(row => nutritionNumber(row[nutrient]));
    const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
    // A blank day or incomplete label is unknown, not a claimed zero intake.
    const complete = values.length > 0 && values.every(value => value != null) && Number.isFinite(sum);
    const rounded = Math.round(sum * 10000) / 10000;
    return [key, complete && Number.isFinite(rounded) ? rounded : null];
  }));
}

export function needsDailyNutritionUpdate(fields: Record<string, unknown>, values: Record<string, number | null>): boolean {
  return Object.entries(values).some(([key, value]) => value == null
    ? fields[key] != null && fields[key] !== '' : fields[key] !== value);
}
