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

export interface DescribePlannedFood {
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

export function isUsableDescribeFoodPlan(value: unknown): value is DescribeFoodPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (typeof plan.mealName !== "string" || !Array.isArray(plan.foods) || !plan.foods.length || plan.foods.length > 24) return false;
  return plan.foods.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const food = value as Record<string, unknown>;
    return isNonBlankString(food.label) &&
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

  return cleaned
    .split(/\s*(?:,|;|\n|\s+and\s+(?=(?:\d|an?\s|some\s))|\s+plus\s+)\s*/i)
    .map((original) => original.trim().replace(/^(?:and|plus)\s+/i, ""))
    .filter(Boolean)
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
