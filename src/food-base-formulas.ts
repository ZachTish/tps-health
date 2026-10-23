import type { TPSHealthSettings } from './types';
import { configuredNativePropertyKey } from './native-record-schema';

const quote = JSON.stringify;
const field = (key: string) => `note[${quote(key)}]`;
// Older food notes may quote numeric labels. Validate before conversion so a
// valid quoted serving is not mistaken for the default one-unit serving.
const numeric = (value: string) => `(${value}.isType("number") || (${value}.isType("string") && /^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?$/i.matches(${value}.trim())))`;
const valid = (value: string) => `${numeric(value)} && number(${value}) >= 0`;
const positive = (value: string) => `${numeric(value)} && number(${value}) > 0`;
const unit = (value: string) => `if(${value}, ${value}.toString().trim().lower().replace(/\\s+/g, " "), "serving")`;
const singular = (value: string) => `if(${value}.length > 1, ${value}.replace(/s$/, ""), ${value})`;
const grams = (value: string) => `["g", "gram", "grams", "oz", "ounce", "ounces"].contains(${value})`;
const milliliters = (value: string) => `["ml", "milliliter", "milliliters", "fl oz", "fluid ounce", "fluid ounces", "cup", "cups"].contains(${value})`;
const factor = (value: string) => `if(["oz", "ounce", "ounces"].contains(${value}), 28.3495, if(["fl oz", "fluid ounce", "fluid ounces"].contains(${value}), 29.5735, if(["cup", "cups"].contains(${value}), 240, 1)))`;

/** Ordinary Bases formulas; no callbacks, writes, cached rollups or event owners.
 * Keep conversions aligned with native-records foodEntryPortion. An explicit
 * g/ml label overrides stale auxiliary serving weights; never infer density.
 */
export function foodPortionBaseFormulas(settings: TPSHealthSettings, embedded = false): Record<string, string> {
  const field = (key: string) => `${embedded ? 'this' : 'note'}[${quote(key)}]`;
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
    healthFood: embedded ? "file" : `if(${food}.isEmpty(), null, if(${food}.isType("link"), ${food}.asFile(), if(${food}.isType("string"), link(${food}).asFile(), null)))`,
    healthUnit: unit(consumedUnit),
    healthServingUnit: unit(`${source}.servingUnit`),
    healthServingSize: `if(${positive(amount)}, number(${amount}), 1)`,
    healthMetricUnit: `if(${directMetric}, if(${grams(s)}, "g", "ml"), if(${positive(`${source}.servingGrams`)}, "g", if(${positive(`${source}.servingMl`)}, "ml", if(${grams(s)}, "g", if(${milliliters(s)}, "ml", null)))))`,
    healthMetricSize: `if(${directMetric}, number(${amount}), if(${positive(`${source}.servingGrams`)}, number(${source}.servingGrams), if(${positive(`${source}.servingMl`)}, number(${source}.servingMl), formula.healthServingSize * ${factor(s)})))`,
    healthServings: `if(formula.healthFood == null || !(${valid(quantity)}), null, if(${sameUnit}, number(${quantity}) / formula.healthServingSize, if(${u} == "serving", number(${quantity}), if((${grams(u)} && ${metricUnit} == "g") || (${milliliters(u)} && ${metricUnit} == "ml"), number(${quantity}) * ${factor(u)} / ${metricSize}, null))))`,
    healthPortionStatus: `if(!healthGoal.isEmpty(), "", if(${food}.isEmpty(), "Link a food", if(formula.healthFood == null, "Missing food", if(formula.healthServings == null, "Check amount or unit", "Calculated"))))`,
  };
}

/** Saved amounts are used only for legacy unlinked logs, and the status
 * column makes that exception visible. Invalid portions and unknown nutrients
 * stay unknown. No nutrient is stored on a new log. Legacy unlinked estimates remain readable.
 */
export function foodNutrientBaseFormula(settings: TPSHealthSettings, nutrient: string, embedded = false): string {
  const stored = field(configuredNativePropertyKey(settings, nutrient as any));
  const linked = field(configuredNativePropertyKey(settings, 'food'));
  const source = `formula.healthFood.properties[${quote(nutrient)}]`;
  return `if(formula.healthFood == null, ${embedded ? '"Unknown"' : `if(${linked}.isEmpty() && ${valid(stored)}, number(${stored}), "Unknown")`}, if(formula.healthServings != null && ${valid(source)}, (number(${source}) * formula.healthServings).round(6), "Unknown"))`;
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
