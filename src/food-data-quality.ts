import type { FoodItem, FoodNutritionProvenance } from "./types";
import { NUTRIENT_KEYS, nutritionNumber } from "./nutrients";

export { nutritionNumber } from "./nutrients";

/** An import receipt, not a certification of the food or subsequent note edits. */
export function foodNutritionProvenance(value: unknown): FoodNutritionProvenance | undefined {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return undefined; } }
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (!["usda", "open-food-facts", "curated"].includes(String(input.provider))) return undefined;
  const result: FoodNutritionProvenance = { provider: input.provider as FoodNutritionProvenance["provider"] };
  for (const key of ["recordId", "dataset", "updatedAt", "retrievedAt"] as const) {
    const field = input[key];
    if (typeof field === "string") result[key] = field.slice(0, 160);
  }
  if (typeof input.url === "string" && /^https:\/\/(?:fdc\.nal\.usda\.gov|world\.openfoodfacts\.org)\//.test(input.url)) result.url = input.url;
  if (Array.isArray(input.warnings)) result.warnings = input.warnings.filter((v): v is string => typeof v === "string").slice(0, 20).map(v => v.slice(0, 200));
  return result;
}

export function assessFoodData(item: FoodItem): { coreKnown: number; nutrientsKnown: number; issues: string[] } {
  const n = item.nutrition || {};
  const coreKnown = [n.calories, n.proteinG, n.carbsG, n.fatG].filter(v => nutritionNumber(v) != null).length;
  const nutrientsKnown = NUTRIENT_KEYS.filter(key => nutritionNumber(n[key]) != null).length;
  const issues: string[] = [];
  if (item.source === "curated" || item.nutritionProvenance?.provider === "curated") issues.push("Built-in estimate; source evidence is not recorded");
  if (coreKnown < 4) issues.push(`${4 - coreKnown} of 4 calorie/macro fields missing`);
  if (item.nutritionProvenance?.warnings?.length) issues.push(...item.nutritionProvenance.warnings);
  // Broad plausibility checks, not a 4/4/9 calorie rewrite: fiber, polyols,
  // alcohol, Atwater factors and label rounding legitimately change energy.
  const grams = nutritionNumber(item.servingGrams);
  if (grams && [n.proteinG, n.carbsG, n.fatG, n.alcoholG].some(v => v != null && v > grams * 1.1 + 1)) issues.push("Nutrient exceeds the serving weight; check units");
  if (grams && n.calories != null && n.calories > grams * 10 + 10) issues.push("Energy exceeds the serving weight's plausible range");
  if (n.carbsG != null && [n.sugarG, n.sugarAlcoholG].some(v => v != null && v > n.carbsG! * 1.15 + 2)) issues.push("Sugar or polyols exceed reported carbohydrate");
  if (NUTRIENT_KEYS.some(key => n[key] != null && nutritionNumber(n[key]) == null)) issues.push("Invalid nutrient value; review the source");
  return { coreKnown, nutrientsKnown, issues: Array.from(new Set(issues)) };
}

export function foodDataDetail(item: FoodItem): string {
  const quality = assessFoodData(item), receipt = item.nutritionProvenance;
  return [
    `${quality.nutrientsKnown}/${NUTRIENT_KEYS.length} tracked nutrients reported. Missing values are unknown; completeness does not certify accuracy.`,
    `Calories: ${item.nutrition?.calories ?? "unknown"} kcal; protein: ${item.nutrition?.proteinG ?? "unknown"} g; carbs: ${item.nutrition?.carbsG ?? "unknown"} g; fat: ${item.nutrition?.fatG ?? "unknown"} g.`,
    ...quality.issues,
    receipt ? `Imported from ${receipt.provider}${receipt.dataset ? ` (${receipt.dataset})` : ""}${receipt.recordId ? `, record ${receipt.recordId}` : ""}.` : "",
    receipt?.updatedAt ? `Source updated: ${receipt.updatedAt}` : "",
    receipt?.retrievedAt ? `Retrieved: ${receipt.retrievedAt}` : "",
    receipt?.url || "",
  ].filter(Boolean).join("\n");
}
