/** Missing, malformed and negative values are unknown, never measured zeroes. */
export function nutritionNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** Absolute label amounts per labeled serving. Unknown is absent, never a fabricated zero. */
export const BUILT_IN_NUTRIENTS = [
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
  {"key": "omega3G", "label": "Omega-3", "unit": "g", "group": "Fats", "off": "omega-3-fat"},
  {"key": "cholesterolMg", "label": "Cholesterol", "unit": "mg", "group": "Fats", "off": "cholesterol"},
  {"key": "alanineG", "label": "Alanine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "arginineG", "label": "Arginine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "asparagineG", "label": "Asparagine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "asparticAcidG", "label": "Aspartic acid", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "cysteineG", "label": "Cysteine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "cystineG", "label": "Cystine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "glutamineG", "label": "Glutamine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "glutamicAcidG", "label": "Glutamic acid", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "glycineG", "label": "Glycine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "histidineG", "label": "Histidine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "isoleucineG", "label": "Isoleucine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "leucineG", "label": "Leucine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "lysineG", "label": "Lysine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "methionineG", "label": "Methionine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "phenylalanineG", "label": "Phenylalanine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "prolineG", "label": "Proline", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "serineG", "label": "Serine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "threonineG", "label": "Threonine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "tryptophanG", "label": "Tryptophan", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "tyrosineG", "label": "Tyrosine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "valineG", "label": "Valine", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "hydroxyprolineG", "label": "Hydroxyproline", "unit": "g", "group": "Amino acids", "off": ""},
  {"key": "saturatedFatG", "label": "Saturated fat", "unit": "g", "group": "Fats", "off": ""},
  {"key": "transFatG", "label": "Trans fat", "unit": "g", "group": "Fats", "off": ""},
  {"key": "monounsaturatedFatG", "label": "Monounsaturated fat", "unit": "g", "group": "Fats", "off": ""},
  {"key": "polyunsaturatedFatG", "label": "Polyunsaturated fat", "unit": "g", "group": "Fats", "off": ""},
  {"key": "omega6G", "label": "Omega-6", "unit": "g", "group": "Fats", "off": ""},
  {"key": "alaG", "label": "Alpha-linolenic acid (ALA)", "unit": "g", "group": "Fats", "off": ""},
  {"key": "epaG", "label": "Eicosapentaenoic acid (EPA)", "unit": "g", "group": "Fats", "off": ""},
  {"key": "dhaG", "label": "Docosahexaenoic acid (DHA)", "unit": "g", "group": "Fats", "off": ""},
  {"key": "addedSugarG", "label": "Added sugars", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "starchG", "label": "Starch", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "solubleFiberG", "label": "Soluble fiber", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "insolubleFiberG", "label": "Insoluble fiber", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "fructoseG", "label": "Fructose", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "glucoseG", "label": "Glucose", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "lactoseG", "label": "Lactose", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "sucroseG", "label": "Sucrose", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "galactoseG", "label": "Galactose", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "maltoseG", "label": "Maltose", "unit": "g", "group": "Carbohydrates", "off": ""},
  {"key": "retinolMcg", "label": "Retinol", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "alphaCaroteneMcg", "label": "Alpha-carotene", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "betaCaroteneMcg", "label": "Beta-carotene", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "betaCryptoxanthinMcg", "label": "Beta-cryptoxanthin", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "lycopeneMcg", "label": "Lycopene", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "luteinZeaxanthinMcg", "label": "Lutein + zeaxanthin", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "folicAcidMcg", "label": "Folic acid", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "foodFolateMcg", "label": "Food folate", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "vitaminD2Mcg", "label": "Vitamin D2", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "vitaminD3Mcg", "label": "Vitamin D3", "unit": "mcg", "group": "Vitamin forms", "off": ""},
  {"key": "waterG", "label": "Water", "unit": "g", "group": "Other nutrients", "off": ""},
  {"key": "fluorideMcg", "label": "Fluoride", "unit": "mcg", "group": "Minerals", "off": ""},
] as const;
export type CustomNutrientKey = `healthNutrient_${string}`;
export interface CustomNutrientDefinition { key: CustomNutrientKey; label: string; unit: string; archived?: boolean }
export type ExtraNutrientKey = typeof BUILT_IN_NUTRIENTS[number]['key'] | CustomNutrientKey;
export interface NutrientDefinition { key: ExtraNutrientKey; label: string; unit: string; group: string; off: string; archived?: boolean }
/** One registry per loaded Health plugin. Configure before indexing or processing food. */
export const EXTRA_NUTRIENTS: NutrientDefinition[] = [...BUILT_IN_NUTRIENTS];

export function normalizeCustomNutrients(raw: unknown): CustomNutrientDefinition[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set<string>();
  return raw.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const {key, label, unit} = value;
    if (typeof key !== 'string' || !/^healthNutrient_[a-z0-9_]+$/.test(key) || keys.has(key)) return [];
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80 || /[\r\n]/.test(label)) return [];
    if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 24 || /[\r\n]/.test(unit)) return [];
    keys.add(key);
    return [{key: key as CustomNutrientKey, label: label.trim(), unit: unit.trim(), ...(value.archived === true ? {archived:true} : {})}];
  });
}

export function configureCustomNutrients(raw: unknown): boolean {
  const definitions = normalizeCustomNutrients(raw).map(n => ({...n,group:'Custom nutrients',off:''}));
  const next = [...BUILT_IN_NUTRIENTS, ...definitions];
  if (JSON.stringify(next) === JSON.stringify(EXTRA_NUTRIENTS)) return false;
  EXTRA_NUTRIENTS.splice(0, EXTRA_NUTRIENTS.length, ...next);
  EXTRA_NUTRIENT_KEYS.splice(0, EXTRA_NUTRIENT_KEYS.length, ...next.map(n => n.key));
  NUTRIENT_KEYS.splice(0, NUTRIENT_KEYS.length, ...CORE_NUTRIENT_KEYS, ...EXTRA_NUTRIENT_KEYS);
  return true;
}
export type ExtraNutrition = Partial<Record<ExtraNutrientKey, number>>;
export const EXTRA_NUTRIENT_KEYS = EXTRA_NUTRIENTS.map(n => n.key);
export const CORE_NUTRIENT_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sugarAlcoholG', 'alcoholG', 'sodiumMg'] as const;
export const NUTRIENT_KEYS = [...CORE_NUTRIENT_KEYS, ...EXTRA_NUTRIENT_KEYS];
export function extraNutrition(values: object, multiplier = 1): ExtraNutrition {
  const source = values as Record<string, unknown>;
  const result: ExtraNutrition = {};
  for (const {key} of EXTRA_NUTRIENTS) {
    const raw = source[key];
    const value = nutritionNumber(raw);
    if (value != null && Number.isFinite(multiplier) && multiplier >= 0)
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
 alanineG: "Alanine",
 arginineG: "Arginine",
 asparticAcidG: "Aspartic acid",
 cystineG: "Cystine",
 glutamicAcidG: "Glutamic acid",
 glycineG: "Glycine",
 histidineG: "Histidine",
 isoleucineG: "Isoleucine",
 leucineG: "Leucine",
 lysineG: "Lysine",
 methionineG: "Methionine",
 phenylalanineG: "Phenylalanine",
 prolineG: "Proline",
 serineG: "Serine",
 threonineG: "Threonine",
 tryptophanG: "Tryptophan",
 tyrosineG: "Tyrosine",
 valineG: "Valine",
 hydroxyprolineG: "Hydroxyproline",
 saturatedFatG: "Fatty acids, total saturated",
 transFatG: "Fatty acids, total trans",
 monounsaturatedFatG: "Fatty acids, total monounsaturated",
 polyunsaturatedFatG: "Fatty acids, total polyunsaturated",
 addedSugarG: "Sugars, added",
 starchG: "Starch",
 solubleFiberG: "Fiber, soluble",
 insolubleFiberG: "Fiber, insoluble",
 fructoseG: "Fructose",
 glucoseG: "Glucose (dextrose)",
 lactoseG: "Lactose",
 sucroseG: "Sucrose",
 galactoseG: "Galactose",
 maltoseG: "Maltose",
 retinolMcg: "Retinol",
 alphaCaroteneMcg: "Carotene, alpha",
 betaCaroteneMcg: "Carotene, beta",
 betaCryptoxanthinMcg: "Cryptoxanthin, beta",
 lycopeneMcg: "Lycopene",
 luteinZeaxanthinMcg: "Lutein + zeaxanthin",
 folicAcidMcg: "Folic acid",
 foodFolateMcg: "Folate, food",
 vitaminD2Mcg: "Vitamin D2 (ergocalciferol)",
 vitaminD3Mcg: "Vitamin D3 (cholecalciferol)",
 waterG: "Water",
 fluorideMcg: "Fluoride, F",
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
   const value = nutritionNumber(raw);
   if (value == null || !factors[unit]) continue;
   result[spec.key] = value * factors[unit] / factors[spec.unit];
 }
 return extraNutrition(result);
}

export function isExtraNutrientKey(key: string): key is ExtraNutrientKey {
  return EXTRA_NUTRIENTS.some(nutrient => nutrient.key === key);
}
