import type {
  HealthPropertyCatalog,
  HealthPropertyCatalogEntry,
  HealthPropertyCatalogScope,
} from "./api";
import type { HealthGoal, TPSHealthSettings } from "./types";

const FOOD_PROPERTIES: Array<Omit<HealthPropertyCatalogEntry, "scope">> = [
  { id: "name", key: "name", label: "Food name", type: "text", icon: "utensils" },
  { id: "brand", key: "brand", label: "Brand", type: "text", icon: "badge" },
  { id: "aliases", key: "aliases", label: "Search aliases", type: "list", listItemType: "text", icon: "search" },
  { id: "barcode", key: "barcode", label: "Barcode", type: "text", icon: "scan-barcode" },
  { id: "serving-amount", key: "servingAmount", label: "Serving amount", type: "number", icon: "scale" },
  { id: "serving-unit", key: "servingUnit", label: "Serving unit", type: "text", icon: "ruler" },
  { id: "serving-grams", key: "servingGrams", label: "Serving grams", type: "number", icon: "weight" },
  { id: "serving-ml", key: "servingMl", label: "Serving milliliters", type: "number", icon: "cup-soda" },
  {
    id: "nutrition-basis",
    key: "nutritionBasis",
    label: "Nutrition basis",
    type: "selector",
    options: ["labeled-serving", "per-100g", "per-100ml", "estimated-serving"],
    icon: "list-filter",
  },
  { id: "calories", key: "calories", label: "Serving calories", type: "number", icon: "flame" },
  { id: "protein", key: "proteinG", label: "Protein", type: "number", icon: "dumbbell" },
  { id: "carbs", key: "carbsG", label: "Carbs", type: "number", icon: "wheat" },
  { id: "fat", key: "fatG", label: "Fat", type: "number", icon: "droplet" },
  { id: "fiber", key: "fiberG", label: "Fiber", type: "number", icon: "sprout" },
  { id: "sugar", key: "sugarG", label: "Sugar", type: "number", icon: "candy" },
  { id: "sugar-alcohol", key: "sugarAlcoholG", label: "Sugar alcohol", type: "number", icon: "candy-off" },
  { id: "alcohol", key: "alcoholG", label: "Alcohol", type: "number", icon: "wine" },
  { id: "sodium", key: "sodiumMg", label: "Sodium", type: "number", icon: "shaker" },
  { id: "ingredients", key: "ingredientStatement", label: "Ingredients", type: "text", icon: "notebook-tabs" },
  { id: "image-url", key: "imageUrl", label: "Image URL", type: "text", icon: "image" },
  { id: "source-image", key: "sourceImagePath", label: "Source image", type: "text", icon: "file-image" },
  { id: "confidence", key: "confidence", label: "Confidence", type: "number", icon: "gauge" },
  { id: "notes", key: "notes", label: "Food notes", type: "text", icon: "notebook-pen" },
];

const FOOD_ROLLUP_KEYS = new Set([
  "consumedcalories",
  "cal",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sugar",
  "sugaralcohol",
  "alcohol",
  "sodium",
]);

function normalizedTag(value: unknown): string {
  return String(value || "").trim().replace(/^#/, "");
}

function foodFrontmatterScope(settings: TPSHealthSettings): { key: string; value: string } {
  const rawKey = String(settings.foodFrontmatterKey || "").trim();
  const key = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(rawKey) ? rawKey : "kind";
  return {
    key,
    value: String(settings.foodFrontmatterFoodValue || "").trim() || "food",
  };
}

function foodScope(settings: TPSHealthSettings): HealthPropertyCatalogScope {
  const mode = settings.foodIdentificationMode;
  const scope: HealthPropertyCatalogScope = { mode: mode === "metadata-folder-tag" ? "any" : "all" };
  if (mode === "metadata-folder-tag" || mode === "tag") {
    const tag = normalizedTag(settings.customFoodTag);
    if (tag) scope.tags = [tag];
  }
  if (mode === "metadata-folder-tag" || mode === "folder") {
    const path = String(settings.foodsFolder || "").trim();
    if (path) scope.paths = [path];
  }
  if (mode === "metadata-folder-tag" || mode === "metadata") {
    const identifier = foodFrontmatterScope(settings);
    scope.properties = [{ key: identifier.key, value: identifier.value, operator: "equals" }];
  }
  return scope;
}

function rollupIcon(propertyKey: string): string {
  const key = propertyKey.trim().toLowerCase();
  if (key === "consumedcalories" || key === "cal") return "flame";
  if (key === "protein") return "dumbbell";
  if (key === "carbs") return "wheat";
  if (key === "fat") return "droplet";
  if (key === "fiber") return "sprout";
  if (key === "sodium") return "shaker";
  if (key === "activity") return "activity";
  return "gauge";
}

function rollupProperty(goal: HealthGoal): HealthPropertyCatalogEntry {
  return {
    id: `rollup-${goal.propertyKey.trim().toLowerCase()}`,
    key: goal.propertyKey,
    label: goal.label,
    type: "number",
    icon: rollupIcon(goal.propertyKey),
    scope: {
      mode: "all",
      properties: [
        { key: "healthUpdatedAt", value: "", operator: "exists" },
        { key: goal.propertyKey, value: "", operator: "exists" },
      ],
    },
  };
}

export function buildHealthPropertyCatalog(settings: TPSHealthSettings): HealthPropertyCatalog {
  const scope = foodScope(settings);
  const rollups = (settings.healthGoals || [])
    .filter((goal) => String(goal?.propertyKey || "").trim())
    .filter((goal) => FOOD_ROLLUP_KEYS.has(goal.propertyKey.trim().toLowerCase()))
    .map(rollupProperty);
  rollups.push({
    id: "rollup-updated-at",
    key: "healthUpdatedAt",
    label: "Health rollup updated",
    type: "datetime",
    icon: "refresh-cw",
    scope: {
      mode: "all",
      properties: [{ key: "healthUpdatedAt", value: "", operator: "exists" }],
    },
  });
  return {
    version: 1,
    food: FOOD_PROPERTIES.map((property) => ({
      ...property,
      options: property.options ? [...property.options] : undefined,
      scope: {
        ...scope,
        tags: scope.tags ? [...scope.tags] : undefined,
        paths: scope.paths ? [...scope.paths] : undefined,
        properties: scope.properties?.map((condition) => ({ ...condition })),
      },
    })),
    dailyRollups: rollups,
  };
}
