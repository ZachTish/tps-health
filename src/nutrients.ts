/** Absolute label amounts per labeled serving. Unknown is absent, never a fabricated zero. */
export const EXTRA_NUTRIENTS = [
  {"key": "vitaminAMcg", "label": "Vitamin A (RAE)", "unit": "mcg", "group": "Vitamins", "off": ""},
  {"key": "vitaminCMg", "label": "Vitamin C", "unit": "mg", "group": "Vitamins", "off": "vitamin-c"},
  {"key": "vitaminDMcg", "label": "Vitamin D", "unit": "mcg", "group": "Vitamins", "off": "vitamin-d"},
  {"key": "vitaminEMg", "label": "Vitamin E (alpha-tocopherol)", "unit": "mg", "group": "Vitamins", "off": ""},
  {"key": "vitaminKMcg", "label": "Vitamin K", "unit": "mcg", "group": "Vitamins", "off": "vitamin-k"},
  {"key": "thiaminMg", "label": "B1 · Thiamin", "unit": "mg", "group": "Vitamins", "off": "vitamin-b1"},
  {"key": "riboflavinMg", "label": "B2 · Riboflavin", "unit": "mg", "group": "Vitamins", "off": "vitamin-b2"},
  {"key": "niacinMg", "label": "B3 · Niacin", "unit": "mg", "group": "Vitamins", "off": "vitamin-pp"},
  {"key": "pantothenicAcidMg", "label": "B5 · Pantothenic acid", "unit": "mg", "group": "Vitamins", "off": "pantothenic-acid"},
  {"key": "vitaminB6Mg", "label": "Vitamin B6", "unit": "mg", "group": "Vitamins", "off": "vitamin-b6"},
  {"key": "biotinMcg", "label": "B7 · Biotin", "unit": "mcg", "group": "Vitamins", "off": "biotin"},
  {"key": "folateMcg", "label": "Folate (DFE)", "unit": "mcg", "group": "Vitamins", "off": ""},
  {"key": "vitaminB12Mcg", "label": "Vitamin B12", "unit": "mcg", "group": "Vitamins", "off": "vitamin-b12"},
  {"key": "cholineMg", "label": "Choline", "unit": "mg", "group": "Vitamins", "off": "choline"},
  {"key": "calciumMg", "label": "Calcium", "unit": "mg", "group": "Minerals", "off": "calcium"},
  {"key": "ironMg", "label": "Iron", "unit": "mg", "group": "Minerals", "off": "iron"},
  {"key": "magnesiumMg", "label": "Magnesium", "unit": "mg", "group": "Minerals", "off": "magnesium"},
  {"key": "phosphorusMg", "label": "Phosphorus", "unit": "mg", "group": "Minerals", "off": "phosphorus"},
  {"key": "potassiumMg", "label": "Potassium", "unit": "mg", "group": "Minerals", "off": "potassium"},
  {"key": "zincMg", "label": "Zinc", "unit": "mg", "group": "Minerals", "off": "zinc"},
  {"key": "copperMg", "label": "Copper", "unit": "mg", "group": "Minerals", "off": "copper"},
  {"key": "manganeseMg", "label": "Manganese", "unit": "mg", "group": "Minerals", "off": "manganese"},
  {"key": "seleniumMcg", "label": "Selenium", "unit": "mcg", "group": "Minerals", "off": "selenium"},
  {"key": "iodineMcg", "label": "Iodine", "unit": "mcg", "group": "Minerals", "off": "iodine"},
  {"key": "chromiumMcg", "label": "Chromium", "unit": "mcg", "group": "Minerals", "off": "chromium"},
  {"key": "molybdenumMcg", "label": "Molybdenum", "unit": "mcg", "group": "Minerals", "off": "molybdenum"},
  {"key": "chlorideMg", "label": "Chloride", "unit": "mg", "group": "Minerals", "off": "chloride"},
  {"key": "creatineG", "label": "Creatine", "unit": "g", "group": "Supplements", "off": ""},
  {"key": "caffeineMg", "label": "Caffeine", "unit": "mg", "group": "Supplements", "off": "caffeine"},
  {"key": "betaAlanineG", "label": "Beta-alanine", "unit": "g", "group": "Supplements", "off": ""},
  {"key": "citrullineG", "label": "L-citrulline", "unit": "g", "group": "Supplements", "off": ""},
  {"key": "taurineG", "label": "Taurine", "unit": "g", "group": "Supplements", "off": "taurine"},
  {"key": "betaineG", "label": "Betaine", "unit": "g", "group": "Supplements", "off": ""},
  {"key": "carnitineG", "label": "L-carnitine", "unit": "g", "group": "Supplements", "off": ""},
  {"key": "theanineMg", "label": "L-theanine", "unit": "mg", "group": "Supplements", "off": ""},
  {"key": "omega3G", "label": "Omega-3", "unit": "g", "group": "Other nutrients", "off": "omega-3-fat"},
  {"key": "cholesterolMg", "label": "Cholesterol", "unit": "mg", "group": "Other nutrients", "off": "cholesterol"},
] as const;
export type ExtraNutrientKey = typeof EXTRA_NUTRIENTS[number]['key'];
export type ExtraNutrition = Partial<Record<ExtraNutrientKey, number>>;
export const EXTRA_NUTRIENT_KEYS = EXTRA_NUTRIENTS.map(n => n.key);
export const CORE_NUTRIENT_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sugarAlcoholG', 'alcoholG', 'sodiumMg'] as const;
export const NUTRIENT_KEYS = [...CORE_NUTRIENT_KEYS, ...EXTRA_NUTRIENT_KEYS];
export function extraNutrition(values: object, multiplier = 1): ExtraNutrition {
  const source = values as Record<string, unknown>;
  const result: ExtraNutrition = {};
  for (const {key} of EXTRA_NUTRIENTS) {
    const raw = source[key];
    if (raw == null || raw === '' || typeof raw === 'boolean') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && Number.isFinite(multiplier) && multiplier >= 0)
      result[key] = Math.round(value * multiplier * 1e9) / 1e9;
  }
  return result;
}
export function addExtraNutrition(target: ExtraNutrition, source: object): void {
  const values = extraNutrition(source);
  for (const key of EXTRA_NUTRIENT_KEYS) if (values[key] != null)
    target[key] = Math.round(((target[key] ?? 0) + values[key]!) * 1e9) / 1e9;
}

export const EXTRA_NUTRIENT_PROPERTIES = Object.fromEntries(EXTRA_NUTRIENT_KEYS.map(key => [key, key])) as Record<ExtraNutrientKey, string>;
/** USDA supplies a unit on both search and detail nutrient records. No IU/DFE equivalence is guessed. */
const USDA_NAMES: Partial<Record<ExtraNutrientKey, string>> = {
 vitaminAMcg: 'Vitamin A, RAE', vitaminCMg: 'Vitamin C, total ascorbic acid', vitaminDMcg: 'Vitamin D (D2 + D3)',
 vitaminEMg: 'Vitamin E (alpha-tocopherol)', vitaminKMcg: 'Vitamin K (phylloquinone)', thiaminMg: 'Thiamin', riboflavinMg: 'Riboflavin',
 niacinMg: 'Niacin', pantothenicAcidMg: 'Pantothenic acid', vitaminB6Mg: 'Vitamin B-6', biotinMcg: 'Biotin', folateMcg: 'Folate, DFE',
 vitaminB12Mcg: 'Vitamin B-12', cholineMg: 'Choline, total', calciumMg: 'Calcium, Ca', ironMg: 'Iron, Fe', magnesiumMg: 'Magnesium, Mg',
 phosphorusMg: 'Phosphorus, P', potassiumMg: 'Potassium, K', zincMg: 'Zinc, Zn', copperMg: 'Copper, Cu', manganeseMg: 'Manganese, Mn',
 seleniumMcg: 'Selenium, Se', iodineMcg: 'Iodine, I', chromiumMcg: 'Chromium, Cr', molybdenumMcg: 'Molybdenum, Mo',
 caffeineMg: 'Caffeine', betaineG: 'Betaine', cholesterolMg: 'Cholesterol',
};
export function usdaExtraNutrition(nutrients: any[]): ExtraNutrition {
 const result: ExtraNutrition = {};
 const factors: Record<string, number> = { g: 1, mg: .001, mcg: .000001, ug: .000001, 'µg': .000001, 'μg': .000001 };
 for (const spec of EXTRA_NUTRIENTS) {
   const name = USDA_NAMES[spec.key]?.toLowerCase();
   if (!name) continue;
   const row = nutrients.find(row => String(row.nutrient?.name ?? row.nutrientName ?? row.name ?? '').toLowerCase() === name);
   if (!row) continue;
   const raw = row.amount ?? row.value;
   const unit = String(row.nutrient?.unitName ?? row.unitName ?? '').toLowerCase();
   if (raw == null || raw === '' || !factors[unit] || !Number.isFinite(Number(raw)) || Number(raw) < 0) continue;
   result[spec.key] = Number(raw) * factors[unit] / factors[spec.unit];
 }
 return extraNutrition(result);
}

export function isExtraNutrientKey(key: string): key is ExtraNutrientKey {
  return EXTRA_NUTRIENTS.some(nutrient => nutrient.key === key);
}
