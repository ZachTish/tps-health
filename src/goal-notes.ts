import type { HealthGoal, TPSHealthSettings } from './types';
import { canonicalGoalKey, goalNutrients } from './nutrient-goals';

/** A metric is identity; filenames, folders and display labels are freely editable. */
export const GOAL_FIELDS = ['healthGoal', 'goalLabel', 'goalUnit', 'goalMinimum', 'goalMaximum', 'goalColor', 'goalPrimary', 'goalSecondary', 'goalEnabled'] as const;
export const GOAL_SETTINGS_KEYS = ['healthGoals', 'calorieGoal', 'proteinGoalG', 'activityGoalMinutes'] as const;

export function goalNoteFields(goal: HealthGoal): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    healthGoal: canonicalGoalKey(goal.propertyKey), goalLabel: goal.label, goalUnit: goal.unit,
    goalMinimum: goal.min, goalMaximum: goal.max, goalColor: goal.color,
    goalPrimary: goal.showInPrimary, goalSecondary: goal.showInSecondary,
  }).filter(([, value]) => value !== undefined));
}

export function goalNoteSignature(fields: Record<string, unknown>): string {
  return JSON.stringify(GOAL_FIELDS.map(key => fields[key] ?? null));
}

export function readGoalNote(fields: Record<string, unknown>): HealthGoal | null {
  if (!Object.prototype.hasOwnProperty.call(fields, 'healthGoal')) return null;
  const key = typeof fields.healthGoal === 'string' ? canonicalGoalKey(fields.healthGoal.trim()) : '';
  if (!key || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid healthGoal metric.');
  if (fields.goalEnabled === false) return null;
  if (fields.goalEnabled != null && fields.goalEnabled !== true) throw new Error('goalEnabled must be true or false.');
  const label = typeof fields.goalLabel === 'string' ? fields.goalLabel.trim() : '';
  const unit = typeof fields.goalUnit === 'string' ? fields.goalUnit.trim() : '';
  if (!label || typeof fields.goalUnit !== 'string') throw new Error('Goal notes need goalLabel and goalUnit.');
  const nutrient = goalNutrients().find(nutrient => nutrient.key === key);
  if (nutrient && unit !== nutrient.unit) throw new Error('Use ' + nutrient.unit + ' for ' + nutrient.label + '; changing a unit does not convert existing logged amounts.');
  const bound = (name: 'goalMinimum' | 'goalMaximum') => {
    const value = fields[name];
    if (value == null || value === '') return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(name + ' must be a finite number of zero or more.');
    return value;
  };
  const min = bound('goalMinimum'), max = bound('goalMaximum');
  if (min != null && max != null && min > max) throw new Error('Goal minimum cannot exceed maximum.');
  for (const key of ['goalPrimary', 'goalSecondary']) if (fields[key] != null && typeof fields[key] !== 'boolean') throw new Error(key + ' must be true or false.');
  return {
    propertyKey: key, label, unit, kind: min != null && max != null ? 'range' : min != null ? 'min' : max != null ? 'max' : 'counter',
    ...(min != null ? {min} : {}), ...(max != null ? {max} : {}),
    ...(typeof fields.goalColor === 'string' ? {color: fields.goalColor} : {}),
    ...(typeof fields.goalPrimary === 'boolean' ? {showInPrimary: fields.goalPrimary} : {}),
    ...(typeof fields.goalSecondary === 'boolean' ? {showInSecondary: fields.goalSecondary} : {}),
  };
}

export function legacyGoalSignature(settings: Partial<TPSHealthSettings>): string {
  return JSON.stringify(GOAL_SETTINGS_KEYS.map(key => settings[key]));
}

/** Existing native-record discovery supplies these projections; no additional scan/listener. */
export class HealthGoalNotes {
  private readonly sources = new Map<string, Record<string, unknown>>();
  project(path: string, fields: Record<string, unknown> | null): boolean {
    const previous = this.sources.get(path);
    const next = fields && Object.prototype.hasOwnProperty.call(fields, 'healthGoal') ? {...fields} : null;
    if (!previous && !next) return false;
    if (previous && next && goalNoteSignature(previous) === goalNoteSignature(next)) return false;
    if (next) this.sources.set(path, next); else this.sources.delete(path);
    return true;
  }
  rename(oldPath: string, newPath: string): void {
    const fields = this.sources.get(oldPath);
    this.sources.delete(oldPath);
    if (fields) this.sources.set(newPath, fields);
  }
  entries(): {path: string; fields: Record<string, unknown>; goal: HealthGoal}[] {
    const seen = new Set<string>();
    const result: {path: string; fields: Record<string, unknown>; goal: HealthGoal}[] = [];
    for (const [path, fields] of this.sources) {
      let goal: HealthGoal | null;
      try { goal = readGoalNote(fields); } catch (error) { throw new Error(path + ': ' + (error as Error).message); }
      if (!goal) continue;
      if (seen.has(goal.propertyKey)) throw new Error('More than one enabled goal note for ' + goal.propertyKey + '. Disable the duplicate with goalEnabled: false.');
      seen.add(goal.propertyKey);
      result.push({path, fields: {...fields}, goal});
    }
    return result;
  }
}
