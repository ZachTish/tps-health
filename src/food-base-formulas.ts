import type { TPSHealthSettings } from './types';
import { configuredNativePropertyKey } from './native-record-schema';

const quote = JSON.stringify;
const field = (key: string) => `note[${quote(key)}]`;
const valid = (value: string) => `${value}.isType("number") && ${value} >= 0`;
const positive = (value: string) => `${value}.isType("number") && ${value} > 0`;
const unit = (value: string) => `if(${value}, ${value}.toString().trim().lower().replace(/\\s+/g, " "), "serving")`;
const singular = (value: string) => `if(${value}.length > 1, ${value}.replace(/s$/, ""), ${value})`;
const grams = (value: string) => `["g", "gram", "grams", "oz", "ounce", "ounces"].contains(${value})`;
const milliliters = (value: string) => `["ml", "milliliter", "milliliters", "fl oz", "fluid ounce", "fluid ounces", "cup", "cups"].contains(${value})`;
const factor = (value: string) => `if(["oz", "ounce", "ounces"].contains(${value}), 28.3495, if(["fl oz", "fluid ounce", "fluid ounces"].contains(${value}), 29.5735, if(["cup", "cups"].contains(${value}), 240, 1)))`;

/** Ordinary Bases formulas; no callbacks, writes, cached rollups or event owners.
 * Keep conversions aligned with native-records foodEntryPortion. An explicit
 * g/ml label overrides stale auxiliary serving weights; never infer density.
 */
export function foodPortionBaseFormulas(settings: TPSHealthSettings): Record<string, string> {
  const food = field(configuredNativePropertyKey(settings, 'food'));
  const quantity = field(configuredNativePropertyKey(settings, 'quantity'));
  const consumedUnit = field(configuredNativePropertyKey(settings, 'unit'));
  const source = 'formula.healthFood.properties';
  const amount = `${source}.servingAmount`;
  const u = 'formula.healthUnit', s = 'formula.healthServingUnit';
  const metricUnit = 'formula.healthMetricUnit', metricSize = 'formula.healthMetricSize';
  const directMetric = `(["g", "gram", "grams", "ml", "milliliter", "milliliters"].contains(${s}) && ${positive(amount)})`;
  const sameUnit = `(${u} == ${s} || ${singular(u)} == ${singular(s)})`;
  return {
    healthFood: `if(${food}.isEmpty(), null, if(${food}.isType("link"), ${food}.asFile(), if(${food}.isType("string"), link(${food}).asFile(), null)))`,
    healthUnit: unit(consumedUnit),
    healthServingUnit: unit(`${source}.servingUnit`),
    healthServingSize: `if(${positive(amount)}, ${amount}, 1)`,
    healthMetricUnit: `if(${directMetric}, if(${grams(s)}, "g", "ml"), if(${positive(`${source}.servingGrams`)}, "g", if(${positive(`${source}.servingMl`)}, "ml", if(${grams(s)}, "g", if(${milliliters(s)}, "ml", null)))))`,
    healthMetricSize: `if(${directMetric}, ${amount}, if(${positive(`${source}.servingGrams`)}, ${source}.servingGrams, if(${positive(`${source}.servingMl`)}, ${source}.servingMl, formula.healthServingSize * ${factor(s)})))`,
    healthServings: `if(formula.healthFood == null || !(${valid(quantity)}), null, if(${sameUnit}, ${quantity} / formula.healthServingSize, if(${u} == "serving", ${quantity}, if((${grams(u)} && ${metricUnit} == "g") || (${milliliters(u)} && ${metricUnit} == "ml"), ${quantity} * ${factor(u)} / ${metricSize}, null))))`,
    healthPortionStatus: `if(!healthGoal.isEmpty(), "", if(${food}.isEmpty(), "Saved totals — link a food to scale", if(formula.healthFood == null, "Missing food — saved totals", if(formula.healthServings == null, "Check amount or unit", "Calculated"))))`,
  };
}

/** Saved amounts are used only when there is no usable source, and the status
 * column makes that exception visible. Invalid portions and unknown nutrients
 * stay unknown. Existing logs never acquire newly tracked nutrient fields.
 */
export function foodNutrientBaseFormula(settings: TPSHealthSettings, nutrient: string): string {
  const stored = field(configuredNativePropertyKey(settings, nutrient as any));
  const source = `formula.healthFood.properties[${quote(nutrient)}]`;
  return `if(formula.healthFood == null, if(${valid(stored)}, ${stored}, "Unknown"), if(${stored} != null && formula.healthServings != null && ${valid(source)}, (${source} * formula.healthServings).round(6), "Unknown"))`;
}

export function foodPortionBaseProperties(settings: TPSHealthSettings): Record<string, {displayName: string}> {
  return {
    ['note.' + configuredNativePropertyKey(settings, 'quantity')]: {displayName: 'Amount consumed'},
    ['note.' + configuredNativePropertyKey(settings, 'unit')]: {displayName: 'Unit'},
    ['note.' + configuredNativePropertyKey(settings, 'food')]: {displayName: 'Food'},
    'formula.healthPortionStatus': {displayName: 'Calculation'},
  };
}

export function foodPortionBaseColumns(settings: TPSHealthSettings): string[] {
  return ['quantity', 'unit'].map(key => 'note.' + configuredNativePropertyKey(settings, key as 'quantity' | 'unit'));
}
