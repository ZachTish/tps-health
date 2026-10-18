import { requestUrl } from "obsidian";
import type { FoodItem, Nutrition } from "./types";
import { nutritionNumber } from "./food-data-quality";

export type AdditionalFoodProvider = "edamam" | "nutritionix";
export interface FoodProviderCredentials { appId: string; apiKey: string }

// Search only on explicit user requests. Nutritionix discovery is deliberately
// not hydrated row-by-row: the existing selection boundary loads one food.
async function request(provider: AdditionalFoodProvider, url: string, credentials: FoodProviderCredentials, body?: object): Promise<any> {
  let response;
  try {
    response = await requestUrl({ url, throw: false,
      headers: provider === "nutritionix" ? { "x-app-id": credentials.appId, "x-app-key": credentials.apiKey, "Content-Type": "application/json" } : {},
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
  } catch { throw new Error(`${provider} is unavailable. Check the connection and provider credentials.`); }
  if (response.status !== 200) throw new Error(`${provider} returned HTTP ${response.status}. Check the API plan, credentials and request limit.`);
  return response.json;
}

export async function searchAdditionalFoodProvider(provider: AdditionalFoodProvider, query: string, credentials: FoodProviderCredentials, branded: boolean): Promise<FoodItem[]> {
  if (provider === "edamam") {
    const params = new URLSearchParams({ app_id: credentials.appId, app_key: credentials.apiKey, ingr: query });
    if (!branded) params.append("category", "generic-foods");
    const data = await request(provider, `https://api.edamam.com/api/food-database/v2/parser?${params}`, credentials);
    if (!Array.isArray(data?.hints)) throw new Error("edamam returned an invalid search response.");
    const foods = [...(Array.isArray(data.parsed) ? data.parsed : []), ...data.hints].map(row => row?.food);
    return Array.from(new Map(foods.filter(food => food?.foodId && food?.label).map(food => [food.foodId, food])).values())
      .slice(0, 30).map(edamamFood);
  }
  const params = new URLSearchParams({ query, branded: String(branded), common: "true" });
  const data = await request(provider, `https://trackapi.nutritionix.com/v2/search/instant?${params}`, credentials);
  if (!Array.isArray(data?.common) || !Array.isArray(data?.branded)) throw new Error("nutritionix returned an invalid search response.");
  return [...(branded ? data.branded : []), ...data.common].filter(food => food?.food_name && (food.nix_item_id || food.tag_id))
    .slice(0, 30).map(food => nutritionixFood(food, true));
}

export function nutritionixSearchPreview(item: FoodItem): boolean {
  return item.source === "nutritionix" && item.nutritionProvenance?.dataset === "Search preview";
}

export async function loadNutritionixFood(item: FoodItem, credentials: FoodProviderCredentials): Promise<FoodItem> {
  const record = item.nutritionProvenance?.recordId || "";
  const common = record.startsWith("common:");
  const data = common
    ? await request("nutritionix", "https://trackapi.nutritionix.com/v2/natural/nutrients", credentials, { query: `${item.servingAmount || 1} ${item.servingUnit || "serving"} ${item.name}` })
    : await request("nutritionix", `https://trackapi.nutritionix.com/v2/search/item?nix_item_id=${encodeURIComponent(record)}`, credentials);
  if (!Array.isArray(data?.foods) || data.foods.length !== 1) throw new Error("Nutritionix did not return one matching food. Nothing was added.");
  const food = data.foods[0];
  if (!common && food.nix_item_id !== record) throw new Error("Nutritionix returned a different product. Nothing was added.");
  const full = nutritionixFood(food, false);
  if (full.nutrition?.calories == null) throw new Error("Nutritionix has no energy value for this food. Nothing was added.");
  return { ...full, id: item.id };
}

function edamamFood(food: any): FoodItem {
  const n = food.nutrients || {};
  return { id: `edamam-${food.foodId}`, name: String(food.label), brand: food.brand || undefined,
    source: "edamam", servingAmount: 100, servingUnit: "g", servingGrams: 100, nutritionBasis: "per-100g",
    nutrition: { calories: nutritionNumber(n.ENERC_KCAL), proteinG: nutritionNumber(n.PROCNT), carbsG: nutritionNumber(n.CHOCDF), fatG: nutritionNumber(n.FAT), fiberG: nutritionNumber(n.FIBTG) },
    nutritionProvenance: { provider: "edamam", recordId: String(food.foodId), dataset: "Food Database · per 100 g", retrievedAt: new Date().toISOString() },
  };
}

function nutritionixFood(food: any, preview: boolean): FoodItem {
  const n = (Array.isArray(food.full_nutrients) ? food.full_nutrients : []) as Array<{attr_id: number; value: number}>;
  const value = (field: string, attr: number) => nutritionNumber(food[field]) ?? nutritionNumber(n.find(row => row.attr_id === attr)?.value);
  const nutrition: Nutrition = { calories: value("nf_calories", 208), proteinG: value("nf_protein", 203), carbsG: value("nf_total_carbohydrate", 205), fatG: value("nf_total_fat", 204),
    fiberG: value("nf_dietary_fiber", 291), sugarG: value("nf_sugars", 269), sodiumMg: value("nf_sodium", 307), alcoholG: value("nf_alcohol", 221) };
  const record = String(food.nix_item_id || `common:${food.tag_id || food.food_name}`);
  const metric = nutritionNumber(food.nf_metric_qty);
  const ml = String(food.nf_metric_uom || "").toLowerCase() === "ml" && metric && metric > 0 ? metric : undefined;
  const grams = nutritionNumber(food.serving_weight_grams) ?? (String(food.nf_metric_uom || "").toLowerCase() === "g" ? metric : undefined);
  return { id: `nutritionix-${record}`, name: String(food.food_name), brand: food.brand_name || food.nix_brand_name || undefined,
    source: "nutritionix", servingAmount: nutritionNumber(food.serving_qty) || 1, servingUnit: String(food.serving_unit || "serving"),
    servingMl: ml, servingGrams: grams && grams > 0 ? grams : undefined, nutritionBasis: "labeled-serving", nutrition,
    nutritionProvenance: { provider: "nutritionix", recordId: record, dataset: preview ? "Search preview" : "Food nutrition", retrievedAt: new Date().toISOString(), warnings: preview ? ["Nutrition loads when this result is selected"] : undefined },
  };
}
