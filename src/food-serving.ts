/** Explicit grams/milliliters are the authored nutrition denominator.
 * Household servings may still need a separate weight; do not infer density.
 */
export function authoredMetricServing(food: { servingAmount?: unknown; servingUnit?: unknown }): { amount: number; unit: "g" | "ml" } | null {
  const amount = Number(food.servingAmount);
  const text = String(food.servingUnit || "").trim().toLowerCase();
  const unit = ["g", "gram", "grams"].includes(text) ? "g"
    : ["ml", "milliliter", "milliliters"].includes(text) ? "ml" : null;
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit };
}

const positiveNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizedUnit = (value: unknown): string => String(value || 'serving')
  .trim()
  .toLocaleLowerCase()
  .replace(/\s+/gu, ' ') || 'serving';

const singularUnit = (value: string): string => value.length > 1 && value.endsWith('s') ? value.slice(0, -1) : value;

function metricAmount(quantity: number, unit: string): { amount: number; unit: 'g' | 'ml' } | null {
  if (['g', 'gram', 'grams'].includes(unit)) return { amount: quantity, unit: 'g' };
  if (['ml', 'milliliter', 'milliliters'].includes(unit)) return { amount: quantity, unit: 'ml' };
  if (['oz', 'ounce', 'ounces'].includes(unit)) return { amount: quantity * 28.3495, unit: 'g' };
  if (['fl oz', 'fluid ounce', 'fluid ounces'].includes(unit)) return { amount: quantity * 29.5735, unit: 'ml' };
  if (['cup', 'cups'].includes(unit)) return { amount: quantity * 240, unit: 'ml' };
  return null;
}

export function foodMetricServing(food: Record<string, unknown>): { amount: number; unit: 'g' | 'ml' } | null {
  const authored = authoredMetricServing(food);
  if (authored) return authored;
  const grams = positiveNumber(food.servingGrams);
  if (grams) return { amount: grams, unit: 'g' };
  const ml = positiveNumber(food.servingMl);
  if (ml) return { amount: ml, unit: 'ml' };
  const amount = positiveNumber(food.servingAmount, 1);
  return metricAmount(amount, normalizedUnit(food.servingUnit));
}

export function foodEntryPortion(
  entry: Record<string, unknown>,
  food: Record<string, unknown>,
): {servings: number; amount?: number; amountUnit?: 'g' | 'ml'} | null {
  if (entry.quantity == null || String(entry.quantity).trim() === '') return null;
  const quantity = Number(entry.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  const unit = normalizedUnit(entry.unit);
  const metricServing = foodMetricServing(food);
  const directMetric = metricAmount(quantity, unit);
  const servingAmount = positiveNumber(food.servingAmount, 1);
  const servingUnit = normalizedUnit(food.servingUnit);
  const sameServingUnit = unit === servingUnit || singularUnit(unit) === singularUnit(servingUnit);
  let servings = 0;
  let amount: number | undefined;
  let amountUnit: 'g' | 'ml' | undefined;
  if (unit === 'serving' || sameServingUnit) {
    servings = sameServingUnit ? quantity / servingAmount : quantity;
    if (metricServing) {
      amount = servings * metricServing.amount;
      amountUnit = metricServing.unit;
    }
  } else if (directMetric) {
    if (!metricServing || directMetric.unit !== metricServing.unit) return null;
    servings = directMetric.amount / metricServing.amount;
    amount = directMetric.amount;
    amountUnit = directMetric.unit;
  } else {
    return null;
  }
  if (!Number.isFinite(servings) || servings < 0) return null;
  return { servings, amount, amountUnit };
}
