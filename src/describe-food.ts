export interface DescribedFoodPart {
  original: string;
  query: string;
  quantity: number;
  unit?: string;
}

export interface DescribeNutritionEstimate {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sugarAlcoholG: number;
  alcoholG: number;
  sodiumMg: number;
}

export interface DescribeExtractedFood {
  itemId: string;
  label: string;
  quantity: number;
  unit: string;
  estimatedWeightG: number;
}

export interface DescribeFoodExtraction {
  mealName: string;
  foods: DescribeExtractedFood[];
}

export interface DescribePlannedFood {
  itemId: string;
  label: string;
  quantity: number;
  unit: string;
  estimatedWeightG: number;
  confidence: number;
  estimatedNutritionForAmount: DescribeNutritionEstimate;
}

export interface DescribeFoodPlan {
  mealName: string;
  foods: DescribePlannedFood[];
}

export interface DescribeReviewedFood extends DescribeExtractedFood, DescribeNutritionEstimate {
  confidence: number;
}

export interface DescribeFoodReview {
  mealName: string;
  foods: DescribeReviewedFood[];
}

export function describePortionGramsPerUnit(food: Pick<DescribePlannedFood, "quantity" | "estimatedWeightG">): number {
  const quantity = Number(food.quantity);
  const totalWeightG = Number(food.estimatedWeightG);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(totalWeightG) || totalWeightG <= 0) return 0;
  return Math.round((totalWeightG / quantity) * 1000) / 1000;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return isFiniteNonNegative(value) && value > 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isUsableDescribeNutrition(value: unknown): value is DescribeNutritionEstimate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nutrition = value as Record<string, unknown>;
  return ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "sugarAlcoholG", "alcoholG", "sodiumMg"]
    .every((key) => isFiniteNonNegative(nutrition[key]));
}

export function isUsableDescribeFoodExtraction(value: unknown): value is DescribeFoodExtraction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const extraction = value as Record<string, unknown>;
  if (typeof extraction.mealName !== "string" || !Array.isArray(extraction.foods) || !extraction.foods.length || extraction.foods.length > 24) return false;
  const itemIds = new Set<string>();
  return extraction.foods.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const food = value as Record<string, unknown>;
    if (!isNonBlankString(food.itemId) || itemIds.has(food.itemId.trim())) return false;
    itemIds.add(food.itemId.trim());
    return isNonBlankString(food.label) &&
      isFinitePositive(food.quantity) &&
      isNonBlankString(food.unit) &&
      isFinitePositive(food.estimatedWeightG);
  });
}

export function isUsableDescribeFoodReview(value: unknown): value is DescribeFoodReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const review = value as Record<string, unknown>;
  if (typeof review.mealName !== "string" || !Array.isArray(review.foods) || !review.foods.length || review.foods.length > 24) return false;
  const itemIds = new Set<string>();
  return review.foods.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const food = value as Record<string, unknown>;
    if (!isNonBlankString(food.itemId) || itemIds.has(food.itemId.trim())) return false;
    itemIds.add(food.itemId.trim());
    return isNonBlankString(food.label) &&
      isFinitePositive(food.quantity) &&
      isNonBlankString(food.unit) &&
      isFinitePositive(food.estimatedWeightG) &&
      isFiniteNonNegative(food.confidence) && Number(food.confidence) <= 1 &&
      isUsableDescribeNutrition(food);
  });
}

export function describeFoodPlanFromReview(extraction: DescribeFoodExtraction, review: DescribeFoodReview): DescribeFoodPlan | null {
  if (!isUsableDescribeFoodExtraction(extraction) || !isUsableDescribeFoodReview(review)) return null;
  const reviewedById = new Map(review.foods.map((food) => [food.itemId.trim(), food]));
  if (reviewedById.size !== extraction.foods.length || extraction.foods.some((food) => !reviewedById.has(food.itemId.trim()))) return null;
  return {
    mealName: review.mealName.trim() || extraction.mealName.trim(),
    foods: extraction.foods.map((extracted) => {
      const reviewed = reviewedById.get(extracted.itemId.trim())!;
      return {
        itemId: extracted.itemId.trim(),
        label: reviewed.label.trim(),
        quantity: reviewed.quantity,
        unit: reviewed.unit.trim(),
        estimatedWeightG: reviewed.estimatedWeightG,
        confidence: reviewed.confidence,
        estimatedNutritionForAmount: {
          calories: reviewed.calories,
          proteinG: reviewed.proteinG,
          carbsG: reviewed.carbsG,
          fatG: reviewed.fatG,
          fiberG: reviewed.fiberG,
          sugarG: reviewed.sugarG,
          sugarAlcoholG: reviewed.sugarAlcoholG,
          alcoholG: reviewed.alcoholG,
          sodiumMg: reviewed.sodiumMg,
        },
      };
    }),
  };
}

export function describeFoodEstimateIssues(food: DescribePlannedFood): string[] {
  const issues: string[] = [];
  if (food.confidence < 0.55) issues.push("low-confidence");
  const nutrition = food.estimatedNutritionForAmount;
  const nutritionTotal = nutrition.calories
    + nutrition.proteinG
    + nutrition.carbsG
    + nutrition.fatG
    + nutrition.fiberG
    + nutrition.sugarG
    + nutrition.sugarAlcoholG
    + nutrition.alcoholG
    + nutrition.sodiumMg;
  const normalizedLabel = food.label.trim().toLowerCase();
  const zeroDrinkLabel = /\b(?:diet|zero(?:[- ]?(?:sugar|calorie|cal))?)\b/.test(normalizedLabel)
    && /\b(?:soda|cola|pepsi|coke|drink|beverage|seltzer|sparkling water)\b/.test(normalizedLabel);
  const explicitlyZeroFood = food.confidence >= 0.75 && (
    /^(?:plain\s+)?(?:water|ice(?: cubes?)?)$/.test(normalizedLabel)
    || /^(?:plain\s+)?black coffee$/.test(normalizedLabel)
    || /^unsweetened (?:iced )?tea$/.test(normalizedLabel)
    || zeroDrinkLabel
  );
  if (nutritionTotal === 0 && !explicitlyZeroFood) issues.push("nutrition-empty");
  const macroEnergy = nutrition.proteinG * 4 + nutrition.carbsG * 4 + nutrition.fatG * 9 + nutrition.sugarAlcoholG * 2.4 + nutrition.alcoholG * 7;
  if (nutrition.calories > 40 && Math.abs(macroEnergy - nutrition.calories) > Math.max(40, nutrition.calories * 0.45)) issues.push("calorie-macro-mismatch");
  const macroMass = nutrition.proteinG + nutrition.carbsG + nutrition.fatG + nutrition.alcoholG;
  if (food.estimatedWeightG > 0 && macroMass > food.estimatedWeightG * 1.2) issues.push("macro-mass-high");
  if (food.estimatedWeightG > 0 && nutrition.calories / food.estimatedWeightG * 100 > 950) issues.push("calorie-density-impossible");
  return issues;
}

export function isUsableDescribeFoodPlan(value: unknown): value is DescribeFoodPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (typeof plan.mealName !== "string" || !Array.isArray(plan.foods) || !plan.foods.length || plan.foods.length > 24) return false;
  return plan.foods.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const food = value as Record<string, unknown>;
    return isNonBlankString(food.itemId) &&
      isNonBlankString(food.label) &&
      isFinitePositive(food.quantity) &&
      isNonBlankString(food.unit) &&
      isFinitePositive(food.estimatedWeightG) &&
      isFiniteNonNegative(food.confidence) && Number(food.confidence) <= 1 &&
      isUsableDescribeNutrition(food.estimatedNutritionForAmount);
  });
}

export function describeFoodPlanSignature(plan: DescribeFoodPlan): string {
  return JSON.stringify({
    mealName: plan.mealName.trim().toLowerCase(),
    foods: plan.foods.map((food) => ({
      itemId: food.itemId.trim(),
      label: food.label.trim().toLowerCase(),
      quantity: food.quantity,
      unit: food.unit.trim().toLowerCase(),
      estimatedWeightG: food.estimatedWeightG,
      confidence: food.confidence,
      estimatedNutritionForAmount: {
        calories: food.estimatedNutritionForAmount.calories,
        proteinG: food.estimatedNutritionForAmount.proteinG,
        carbsG: food.estimatedNutritionForAmount.carbsG,
        fatG: food.estimatedNutritionForAmount.fatG,
        fiberG: food.estimatedNutritionForAmount.fiberG,
        sugarG: food.estimatedNutritionForAmount.sugarG,
        sugarAlcoholG: food.estimatedNutritionForAmount.sugarAlcoholG,
        alcoholG: food.estimatedNutritionForAmount.alcoholG,
        sodiumMg: food.estimatedNutritionForAmount.sodiumMg,
      },
    })),
  });
}

export interface FoodPlausibilityInput {
  expectedWeightG: number;
  actualWeightG?: number;
  caloriesPer100G: number;
  proteinPer100G?: number;
  carbsPer100G?: number;
  fatPer100G?: number;
  expectedCaloriesPer100GMin: number;
  expectedCaloriesPer100GMax: number;
}

export interface FoodPlausibilityResult {
  plausible: boolean;
  weightAssessment: "ok" | "low" | "high" | "unknown";
  calorieAssessment: "ok" | "low" | "high";
  reasons: string[];
}

export function assessFoodPlausibility(input: FoodPlausibilityInput): FoodPlausibilityResult {
  const reasons: string[] = [];
  const expectedWeight = Math.max(0, Number(input.expectedWeightG) || 0);
  const actualWeight = Math.max(0, Number(input.actualWeightG) || 0);
  const density = Math.max(0, Number(input.caloriesPer100G) || 0);
  const minDensity = Math.max(0, Number(input.expectedCaloriesPer100GMin) || 0);
  const maxDensity = Math.max(minDensity, Number(input.expectedCaloriesPer100GMax) || minDensity);
  const weightRatio = expectedWeight > 0 && actualWeight > 0 ? actualWeight / expectedWeight : 0;
  const weightAssessment = !weightRatio ? "unknown" : weightRatio < 0.4 ? "low" : weightRatio > 2.5 ? "high" : "ok";
  const calorieAssessment = density < minDensity * 0.65 ? "low" : density > maxDensity * 1.35 ? "high" : "ok";
  if (weightAssessment !== "ok" && weightAssessment !== "unknown") reasons.push(`weight-${weightAssessment}`);
  if (calorieAssessment !== "ok") reasons.push(`calories-${calorieAssessment}`);
  const macroMass = Math.max(0, Number(input.proteinPer100G) || 0)
    + Math.max(0, Number(input.carbsPer100G) || 0)
    + Math.max(0, Number(input.fatPer100G) || 0);
  if (macroMass > 130) reasons.push("macro-mass-high");
  if (density > 950) reasons.push("calorie-density-impossible");
  return { plausible: reasons.length === 0, weightAssessment, calorieAssessment, reasons };
}

const UNIT_ALIASES: Record<string, string> = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml",
  cup: "cup", cups: "cup",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  serving: "serving", servings: "serving",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
};

const COMPOSITE_DISH_PATTERN = /\b(?:sandwich|burger|wrap|burrito|taco|pizza|salad|bowl|omelet|smoothie|casserole|soup|stew)\b/i;

function splitTopLevelFoodParts(value: string): string[] {
  const primaryParts = value
    .split(/\s*(?:[,;\n]+|\s+plus\s+)\s*/i)
    .map((part) => part.trim().replace(/^(?:and|plus)\s+/i, ""))
    .filter(Boolean);
  const parts = primaryParts.flatMap((part) => {
    // Ingredient quantities after a named dish describe that dish; they are
    // not additional top-level foods. This keeps "a ham sandwich with 56 g
    // ham and 1 slice cheese" as one editable tray row.
    if (COMPOSITE_DISH_PATTERN.test(part) && /\bwith\b/i.test(part)) return [part];
    return part
      .split(/\s+and\s+(?=(?:\d|an?\s|some\s))/i)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  });
  return parts.length ? parts : [value.trim() || "Food estimate"];
}

function numberFromToken(value: string): number {
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parseFoodDescription(value: string): DescribedFoodPart[] {
  const cleaned = String(value || "")
    .trim()
    .replace(/^(?:i\s+)?(?:ate|had|drank|consumed)\s+/i, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return [];

  return splitTopLevelFoodParts(cleaned)
    .map((original) => {
      const amountMatch = original.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.+)$/);
      const amount = amountMatch ? numberFromToken(amountMatch[1]) : 1;
      const remainder = (amountMatch?.[2] || original).trim();
      const unitMatch = remainder.match(/^([a-zA-Z]+)\s+(?:of\s+)?(.+)$/);
      const candidateUnit = String(unitMatch?.[1] || "").toLowerCase();
      const unit = UNIT_ALIASES[candidateUnit];
      const query = (unit ? unitMatch?.[2] || remainder : remainder)
        .replace(/^(?:a|an|some)\s+/i, "")
        .trim();
      return { original, query: query || original, quantity: amount, ...(unit ? { unit } : {}) };
    });
}

function roundedNutrition(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

export function localDescribeFoodEstimate(food: DescribeExtractedFood): DescribePlannedFood {
  const label = food.label.trim() || "Food estimate";
  const normalized = label.toLowerCase();
  const weight = Math.max(0.1, Number(food.estimatedWeightG) || 100);
  const zeroNutrition = /\b(?:diet|zero(?:[- ]?(?:sugar|calorie|cal))?)\b/.test(normalized)
    && /\b(?:soda|cola|coke|pepsi|drink|beverage|seltzer|sparkling water)\b/.test(normalized);
  const water = /^(?:plain\s+)?(?:water|ice(?: cubes?)?)$/.test(normalized);
  let per100 = { calories: 200, proteinG: 8, carbsG: 25, fatG: 8, fiberG: 2, sugarG: 5, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 300 };
  let confidence = 0.25;
  if (zeroNutrition || water) {
    per100 = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 5 };
    confidence = 0.78;
  } else if (/\bapples?\b/.test(normalized)) {
    per100 = { calories: 52, proteinG: 0.3, carbsG: 13.8, fatG: 0.2, fiberG: 2.4, sugarG: 10.4, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 1 };
    confidence = 0.58;
  } else if (/\b(?:sandwich|burger|wrap|burrito)\b/.test(normalized)) {
    per100 = { calories: 220, proteinG: 13, carbsG: 24, fatG: 8, fiberG: 1.5, sugarG: 3, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 700 };
    confidence = 0.38;
  } else if (/\byogurts?\b/.test(normalized)) {
    per100 = { calories: 80, proteinG: 6, carbsG: 9, fatG: 2.2, fiberG: 0, sugarG: 7, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 60 };
    confidence = 0.42;
  } else if (/\beggs?\b/.test(normalized)) {
    per100 = { calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5, fiberG: 0, sugarG: 0.4, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 142 };
    confidence = 0.5;
  }
  const scale = weight / 100;
  return {
    itemId: food.itemId,
    label,
    quantity: food.quantity,
    unit: food.unit,
    estimatedWeightG: weight,
    confidence,
    estimatedNutritionForAmount: {
      calories: roundedNutrition(per100.calories * scale),
      proteinG: roundedNutrition(per100.proteinG * scale),
      carbsG: roundedNutrition(per100.carbsG * scale),
      fatG: roundedNutrition(per100.fatG * scale),
      fiberG: roundedNutrition(per100.fiberG * scale),
      sugarG: roundedNutrition(per100.sugarG * scale),
      sugarAlcoholG: roundedNutrition(per100.sugarAlcoholG * scale),
      alcoholG: roundedNutrition(per100.alcoholG * scale),
      sodiumMg: roundedNutrition(per100.sodiumMg * scale),
    },
  };
}
