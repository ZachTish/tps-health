import type { DailyFoodMacroTotals, HealthMetricRenderConfig } from './api';
import type { NativeDailyFoodEntrySnapshot } from './native-records';
import type { TPSHealthSettings, HealthNativeRecordPropertyKey } from './types';
import { configuredNativePropertyKey, readableNativeKinds } from './native-record-schema';

export const MACROS_BASE_TYPE = 'tps-health-macros';
export type DatedFoodEntry = NativeDailyFoodEntrySnapshot & { dateIso: string };
export const MACRO_PROPERTY_KEYS: Record<string, HealthNativeRecordPropertyKey> = {
  consumedCalories: 'calories', cal: 'calories', protein: 'proteinG', carbs: 'carbsG', fat: 'fatG',
  fiber: 'fiberG', sugar: 'sugarG', sugarAlcohol: 'sugarAlcoholG', alcohol: 'alcoholG', sodium: 'sodiumMg',
};
export function groupMacroDays(entries: DatedFoodEntry[]): Map<string, DatedFoodEntry[]> {
  const days = new Map<string, DatedFoodEntry[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path) || !validMacroDate(entry.dateIso)) continue;
    seen.add(entry.path);
    const day = days.get(entry.dateIso) || [];
    day.push(entry); days.set(entry.dateIso, day);
  }
  return days;
}
export function validMacroDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function sumMacroEntries(dateIso: string, entries: NativeDailyFoodEntrySnapshot[]): DailyFoodMacroTotals {
  const totals: DailyFoodMacroTotals = { dateIso, entryCount: entries.length, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 0 };
  for (const entry of entries) for (const key of ['calories','proteinG','carbsG','fatG','fiberG','sugarG','sugarAlcoholG','alcoholG','sodiumMg'] as const) {
    if (Number.isFinite(entry[key])) totals[key] += entry[key];
  }
  return totals;
}
export function visibleMacroGoals(goals: HealthMetricRenderConfig[], order: string[], settings: TPSHealthSettings): HealthMetricRenderConfig[] {
  return order.flatMap(property => goals.filter(goal => {
    const key = MACRO_PROPERTY_KEYS[goal.propertyKey];
    return key && property === `note.${configuredNativePropertyKey(settings, key)}`;
  }));
}
export function defaultMacrosBaseContent(settings: TPSHealthSettings): string {
  const key = (name: HealthNativeRecordPropertyKey) => configuredNativePropertyKey(settings, name);
  const kinds = readableNativeKinds(settings, 'food-entry').map(kind => `note.kind == ${JSON.stringify(kind)}`);
  return JSON.stringify({
    properties: Object.fromEntries(settings.healthGoals.flatMap(goal => {
      const property = MACRO_PROPERTY_KEYS[goal.propertyKey];
      return property ? [[`note.${key(property)}`, { displayName: goal.label }]] : [];
    })),
    formulas: { Day: `date(note.${key('completedDate')}).date()` },
    filters: { and: [{ or: kinds }, `note.${key('archived')} != true`] },
    views: [{ type: MACROS_BASE_TYPE, name: 'Macros', filters: { and: [] },
      order: ['calories','proteinG','carbsG','fatG','fiberG','sodiumMg'].map(k => `note.${key(k as HealthNativeRecordPropertyKey)}`),
      sort: [{ property: `note.${key('completedDate')}`, direction: 'DESC' }] }],
  }, null, 2) + '\n';
}

// Obsidian currently exposes property typing through this capability-detected API.
// Only initialize an unassigned consumed-time property; never replace a user's type.
export function initializeMacrosDateType(app: unknown, settings: TPSHealthSettings): void {
  const manager = (app as { metadataTypeManager?: {
    getAssignedWidget?: (key: string) => unknown;
    setType?: (key: string, type: string) => void;
  } }).metadataTypeManager;
  const key = configuredNativePropertyKey(settings, 'completedDate');
  if (typeof manager?.getAssignedWidget === 'function' && typeof manager.setType === 'function' && !manager.getAssignedWidget(key)) {
    manager.setType(key, 'datetime');
  }
}
