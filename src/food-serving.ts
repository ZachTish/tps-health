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
