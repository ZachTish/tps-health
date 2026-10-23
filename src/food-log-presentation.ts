import type { HealthGoal, TPSHealthSettings } from './types';
import { CORE_NUTRIENT_KEYS, EXTRA_NUTRIENT_KEYS } from './nutrients';
import { configuredNativePropertyKey } from './native-record-schema';
import { foodNutrientBaseFormula, foodPortionBaseFormulas } from './food-base-formulas';
import { goalNutrients, trackedFoodNutrientKeys } from './nutrient-goals';

/** Physical fields that belong to the food definition, never a new log. */
export function calculatedFoodLogKeys(settings: TPSHealthSettings): string[] {
  return [...new Set([...CORE_NUTRIENT_KEYS, ...EXTRA_NUTRIENT_KEYS, 'sugarAlcoholCaloriesPerG'].flatMap(key => [
    configuredNativePropertyKey(settings, key as any),
    ...(settings.nativeRecordPropertyAliases?.[key as keyof TPSHealthSettings['nativeRecordPropertyAliases']] || []),
  ]))];
}

/** The food itself is the query row, so changing its label invalidates the Base.
 * `this` is the embedding log. Neither side needs a copied nutrient or writer.
 */
export function foodLogBaseDefinition(settings: TPSHealthSettings, goals: HealthGoal[]): Record<string, unknown> {
  const foodKey = JSON.stringify(configuredNativePropertyKey(settings, 'food'));
  const link = `this[${foodKey}]`;
  const source = `if(${link}.isType("link"), ${link}.asFile(), if(${link}.isType("string"), link(${link}).asFile(), null))`;
  const formulas = foodPortionBaseFormulas(settings, true);
  formulas.healthAmount = `this[${JSON.stringify(configuredNativePropertyKey(settings, 'quantity'))}]`;
  formulas.healthConsumedUnit = `this[${JSON.stringify(configuredNativePropertyKey(settings, 'unit'))}]`;
  const properties: Record<string, { displayName: string }> = {
    'formula.healthAmount': {displayName: 'Amount consumed'},
    'formula.healthConsumedUnit': {displayName: 'Unit'},
    'formula.healthPortionStatus': {displayName: 'Calculation'},
  };
  const columns: string[] = [];
  const selected = new Set([...CORE_NUTRIENT_KEYS, ...trackedFoodNutrientKeys(goals)]);
  for (const nutrient of goalNutrients(goals)) {
    const key = [...trackedFoodNutrientKeys([{propertyKey: nutrient.key} as HealthGoal])][0];
    if (!key || !selected.has(key)) continue;
    formulas[key] = foodNutrientBaseFormula(settings, key, true);
    properties['formula.' + key] = {displayName: `${nutrient.label} (${nutrient.unit})`};
    columns.push('formula.' + key);
  }
  return {
    filters: {and: ['file.ext == "md"', `file == ${source}`]}, formulas, properties,
    views: [{type: 'table', name: 'Consumed nutrients', order: ['formula.healthAmount', 'formula.healthConsumedUnit', ...columns, 'formula.healthPortionStatus']}],
  };
}

export function foodLogBody(settings: TPSHealthSettings, goals: HealthGoal[]): string {
  return '\n```base\n' + JSON.stringify(foodLogBaseDefinition(settings, goals), null, 2) + '\n```\n';
}

/** Used only by the existing creation owner before its single initial write. */
export function prepareFoodLogCreation(settings: TPSHealthSettings, goals: HealthGoal[], properties: Record<string, unknown>): { properties: Record<string, unknown>; body: string } {
  const calculated = new Set(calculatedFoodLogKeys(settings).map(key => key.toLowerCase()));
  return {
    properties: Object.fromEntries(Object.entries(properties).filter(([key]) => !calculated.has(key.toLowerCase()))),
    body: foodLogBody(settings, goals),
  };
}
