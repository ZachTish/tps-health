import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";

const harnessUrl = new URL("./test-health-providers.mjs", import.meta.url);
globalThis.__TPSFoodDataQualityEsbuild = esbuild;
const harnessSource = readFileSync(harnessUrl, "utf8")
  .replace('import test from "node:test";', 'const test = () => {};')
  .replace('import * as esbuild from "esbuild";', 'const esbuild = globalThis.__TPSFoodDataQualityEsbuild;')
  .replaceAll("import.meta.url", JSON.stringify(harnessUrl.href));
const { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals } = await import(`data:text/javascript;base64,${Buffer.from(harnessSource + "\nexport { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals };\n//# sourceURL=food-data-quality-harness.mjs").toString("base64")}`);
delete globalThis.__TPSFoodDataQualityEsbuild;

const qualityBuild = await esbuild.build({ entryPoints: [fileURLToPath(new URL('../src/food-data-quality.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { nutritionNumber, assessFoodData, foodNutritionProvenance, foodDataDetail } = await import(`data:text/javascript;base64,${Buffer.from(qualityBuild.outputFiles[0].text).toString('base64')}`);
installDeterministicBrowserGlobals();
const m = await importPluginWithObsidianStub();
const item = (source, name = 'Favorite oats', extra = {}) => ({ id: source, name, source, servingAmount: 1, servingUnit: 'serving', servingGrams: 40, nutrition: { calories: 150, proteinG: 5, carbsG: 27, fatG: 3 }, ...extra });
const off = product => new m.default(createFakeHealthApp().app).foodFactsProductToItem(product, '123456789012');

test('nutrient parsing distinguishes unknown, invalid and measured zero', () => {
  for (const raw of [undefined, null, '', '  ', false, true, [], {}, -1, '-1', NaN, Infinity, '100 mg', '0x10']) assert.equal(nutritionNumber(raw), undefined, String(raw));
  for (const raw of [0, '0', ' 0.0 ']) assert.equal(nutritionNumber(raw), 0);
  assert.equal(nutritionNumber('.5'), .5); assert.equal(nutritionNumber('1e-4'), .0001);
});
test('all relevant saved notes precede exact, popular online and built-in matches', () => {
  const local = item('custom-note', 'My favorite oats', { sourcePath: 'Inbox/Favorite oats.md' });
  const remote = item('usda', 'Oats');
  const curated = item('curated', 'Oats');
  const unrelated = item('custom-note', 'Chicken breast', { id: 'unrelated' });
  const ranked = m.rankFoodSearchResults('oats', [remote, curated, unrelated, local], new Map([['id:usda', { count: 100, lastLoggedAt: '2026-09-18' }]]));
  assert.equal(ranked[0], local); assert.ok(!ranked.includes(unrelated));
});
test('deduplication never substitutes a provider serving or nutrient into saved notes', () => {
  const local = item('custom-note', 'Oats', { sourcePath: 'Inbox/Oats.md', barcode: '123456789012', servingGrams: undefined, nutrition: { calories: 123 } });
  const remote = item('usda', 'Oats', { barcode: local.barcode, nutritionBasis: 'labeled-serving' });
  for (const foods of [[remote, local], [local, remote]]) assert.deepEqual(m.dedupeFoods(foods), [local]);
  const otherLocal = { ...local, id: 'other', sourcePath: 'Inbox/Oats B.md' };
  assert.equal(m.dedupeFoods([local, otherLocal, remote]).length, 2);
});
test('identified provider nutrition replaces an unsourced duplicate regardless of order', () => {
  const provider = item('usda', 'Oats', { nutritionBasis: 'per-100g', nutritionProvenance: { provider: 'usda', recordId: '17' } });
  const builtIn = item('curated', 'Oats', { nutritionBasis: 'labeled-serving' });
  for (const foods of [[provider, builtIn], [builtIn, provider]]) assert.deepEqual(m.dedupeFoods(foods), [provider]);
});
test('zero-calorie and partial records remain searchable; empty records do not', () => {
  for (const nutrition of [{calories: 0}, {calories: 12}, {proteinG: 0, carbsG: 0, fatG: 0}, {sodiumMg: 0}, {caffeineMg: 80}]) assert.equal(m.hasSearchableMacroData(nutrition), true);
  for (const nutrition of [{}, {calories: null}, {proteinG: ''}, {proteinG: false}]) assert.equal(m.hasSearchableMacroData(nutrition), false);
  assert.deepEqual(m.compactMacroParts({calories: 0, proteinG: 0}), ['0 kcal', 'P 0g']);
});
test('OFF converts kJ and salt units without replacing explicit kcal or sodium zeroes', () => {
  const product = { product_name: 'Soup', serving_size: '250 ml', nutriments: { 'energy-kj_100g': 418.4, salt_100g: 1, proteins_100g: 0 } };
  const food = off(product); assert.ok(Math.abs(food.nutrition.calories - 250) < 1e-8); assert.equal(food.nutrition.sodiumMg, 1000);
  product.nutriments['energy-kcal_serving'] = 0; product.nutriments.sodium_serving = 0;
  const explicit = off(product); assert.equal(explicit.nutrition.calories, 0); assert.equal(explicit.nutrition.sodiumMg, 0);
});
test('OFF ABV becomes grams only with a volume serving, never scaled as mass', () => {
  const product = { product_name: 'Beer', serving_size: '330 ml', nutriments: { alcohol_100g: 5, alcohol_serving: 5, 'energy-kcal_100g': 40 } };
  assert.equal(off(product).nutrition.alcoholG, 13);
  assert.equal(off({...product, serving_size: '330 g'}).nutrition.alcoholG, undefined);
  assert.equal(off({...product, serving_size: ''}).nutrition.alcoholG, undefined);
  assert.equal(off({...product, nutriments: { alcohol_100g: 500 }}).nutrition.alcoholG, undefined);
});
test('ingredient mentions do not manufacture polyol quantities', () => {
  const food = off({ product_name: 'Cookie with erythritol', ingredients_text: 'flour, sugar, erythritol', nutriments: { carbohydrates_100g: 50, 'energy-kcal_100g': 300 } });
  assert.equal(food.nutrition.sugarAlcoholG, undefined); assert.equal(food.nutrition.calories, 300);
});
test('malformed OFF values stay unknown and tiny valid nutrient values retain precision', () => {
  const food = off({product_name: 'Drink', serving_size: '20 g', nutriments: {proteins_serving: '', carbohydrates_serving: false, fat_serving: -2, fiber_100g: 0.001, 'vitamin-b12_100g': 0.000002}});
  assert.equal(food.nutrition.proteinG, undefined); assert.equal(food.nutrition.carbsG, undefined); assert.equal(food.nutrition.fatG, undefined);
  assert.equal(food.nutrition.fiberG, .0002); assert.equal(food.nutrition.vitaminB12Mcg, .4);
  assert.ok(food.nutritionProvenance.warnings.includes('Invalid source nutrient values were omitted'));
});
test('USDA core units and search/detail shapes are normalized without blank coercion', () => {
  const food = m.usdaFoodNutrition({foodNutrients: [
    {nutrient: {id: 1062, unitName: 'kJ'}, amount: 418.4},
    {nutrientId: 1003, value: 5000, unitName: 'mg'},
    {nutrientId: 1093, value: .3, unitName: 'g'},
    {nutrientId: 1005, value: null}, {nutrientId: 1004, value: 0, unitName: 'g'},
    {nutrientName: 'Iron, Fe', unitName: 'mg', value: false},
  ]});
  assert.ok(Math.abs(food.calories - 100) < 1e-8); assert.equal(food.proteinG, 5); assert.equal(food.sodiumMg, 300);
  assert.equal(food.carbsG, undefined); assert.equal(food.fatG, 0); assert.equal(food.ironMg, undefined);
  assert.equal(m.usdaFoodNutrition({foodNutrients: [{nutrientId:1003, value:5, unitName:'IU'}]}).proteinG, undefined);
});
test('quality distinguishes completeness from plausibility without rewriting energy', () => {
  const plausible = item('usda', 'Food'); assert.equal(assessFoodData(plausible).coreKnown, 4);
  const impossible = item('open-food-facts', 'Bad units', { nutrition: {calories: 4000, proteinG: 400, carbsG: 0, fatG: 0} });
  assert.equal(assessFoodData(impossible).coreKnown, 4); assert.ok(assessFoodData(impossible).issues.length >= 2);
  const alcohol = item('usda', 'Spirit', {servingGrams: undefined, servingMl: 44, nutrition:{calories:97, alcoholG:14}});
  assert.equal(assessFoodData(alcohol).coreKnown, 1); assert.equal(alcohol.nutrition.calories, 97);
});
test('source receipt exposes dated provider flags and serving disagreements', () => {
  const food = off({code:'123', product_name:'Soup', last_modified_t:1700000000, serving_size:'50 g', data_quality_errors_tags:['en:nutrition-value-over-100'], nutriments: {'energy-kcal_serving':300,'energy-kcal_100g':100,proteins_serving:0}});
  assert.equal(food.nutrition.calories, 300); assert.equal(food.nutritionProvenance.recordId, '123');
  const details = foodDataDetail(food); assert.match(details, /2023-11-14/); assert.match(details, /Provider flag/); assert.match(details, /disagree/); assert.match(details, /completeness does not certify accuracy/);
  assert.equal(foodNutritionProvenance({provider:'unknown'}), undefined);
  assert.equal(foodNutritionProvenance({provider:'usda',url:'https://evil.test/'}).url, undefined);
});
test('food note writes and reads preserve unknown versus explicit zero and import receipt', async () => {
  const fake = createFakeHealthApp(), plugin = new m.default(fake.app);
  const receipt = {provider:'open-food-facts',recordId:'123',dataset:'Community label data',updatedAt:'2026-09-01',retrievedAt:'2026-09-18'};
  const food = item('open-food-facts','Audit food',{nutrition:{calories:0,proteinG:undefined},nutritionProvenance:receipt});
  const content = plugin.defaultFoodNoteTemplate(food,'food','#food');
  assert.match(content,/calories: 0/); assert.doesNotMatch(content,/proteinG:|carbsG:|fatG:|fiberG:/);
  const fm = m.foodFrontmatter(food,'food',plugin.settings); assert.equal(fm.calories,0); assert.ok(!('proteinG' in fm)); assert.deepEqual(fm.nutritionProvenance,receipt);
  const restored = plugin.foodFromFrontmatter({path:'Inbox/Audit.md',basename:'Audit'}, {...fm,proteinG:null,carbsG:'',fatG:false});
  assert.equal(restored.nutrition.calories,0); assert.equal(restored.nutrition.proteinG,undefined); assert.equal(restored.nutrition.carbsG,undefined); assert.equal(restored.nutrition.fatG,undefined); assert.deepEqual(restored.nutritionProvenance,receipt);
  const custom = plugin.renderFoodTemplate('---\ntitle: "{{name}}"\ncalories: {{calories}}\nproteinG: {{proteinG}}\n---',food,'food','#food');
  assert.match(custom,/calories: 0/); assert.doesNotMatch(custom,/proteinG: 0/); assert.match(custom,/nutritionProvenance:/);
});
test('built-in catalogue inventory remains explicit about unsupported provenance', () => {
  assert.equal(m.CURATED_COMMON_FOODS.length,42);
  for (const food of m.searchCuratedFoods('milk')) {
    assert.match(m.foodResultMeta(food), /Unverified/); assert.match(foodDataDetail(food), /source evidence is not recorded/);
  }
});
test('explicit total polyols and carbohydrate beat conflicting component fields', () => {
  const food = off({product_name:'Food',nutriments:{polyols_100g:0,erythritol_100g:5,carbohydrates_100g:3,'carbohydrates-total_100g':8}});
  assert.equal(food.nutrition.sugarAlcoholG,0); assert.equal(food.nutrition.carbsG,8);
});
test('import receipts preserve reported calories through API review-save conversion', () => {
  const food = m.foodItemFromInput({name:'Label-only food',nutrition:{calories:42,proteinG:0},nutritionProvenance:{provider:'open-food-facts',recordId:'123'}});
  assert.equal(food.nutrition.calories,42); assert.equal(food.nutrition.carbsG,undefined); assert.equal(food.source,'open-food-facts');
});

test('unit conversion overflow cannot introduce infinite nutrient amounts', () => {
  const food = off({product_name:'Invalid scale',serving_size:'1000 ml',nutriments:{proteins_100g:Number.MAX_VALUE,sodium_100g:Number.MAX_VALUE}});
  assert.equal(food.nutrition.proteinG,undefined); assert.equal(food.nutrition.sodiumMg,undefined);
  assert.equal(m.usdaFoodNutrition({foodNutrients:[{nutrientId:1093,value:Number.MAX_VALUE,unitName:'g'}]}).sodiumMg,undefined);
});
