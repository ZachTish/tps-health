import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/describe-food.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "esm", target: "es2020" }).code;
const { assessFoodPlausibility, describeFoodEstimateIssues, describeFoodPlanFromReview, describeFoodPlanSignature, describePortionGramsPerUnit, isUsableDescribeFoodExtraction, isUsableDescribeFoodPlan, isUsableDescribeFoodReview, parseFoodDescription } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("Describe food splits a natural meal into reviewable foods", () => {
  assert.deepEqual(parseFoodDescription("I had 2 eggs, 1 slice toast with butter, and 12 oz coffee with milk"), [
    { original: "2 eggs", query: "eggs", quantity: 2 },
    { original: "1 slice toast with butter", query: "toast with butter", quantity: 1, unit: "slice" },
    { original: "12 oz coffee with milk", query: "coffee with milk", quantity: 12, unit: "oz" },
  ]);
});

test("Describe food keeps conjunctions that belong to one food", () => {
  assert.deepEqual(parseFoodDescription("chicken and rice"), [
    { original: "chicken and rice", query: "chicken and rice", quantity: 1 },
  ]);
});

test("Describe food keeps four yogurts and a large Honeycrisp apple as two explicit items", () => {
  assert.deepEqual(parseFoodDescription("4 yogurts and a large honeycrisp apple"), [
    { original: "4 yogurts", query: "yogurts", quantity: 4 },
    { original: "a large honeycrisp apple", query: "large honeycrisp apple", quantity: 1 },
  ]);
});

test("Describe food plausibility accepts weight and calorie density near the expected food range", () => {
  assert.deepEqual(assessFoodPlausibility({ expectedWeightG: 100, actualWeightG: 105, caloriesPer100G: 165, proteinPer100G: 31, carbsPer100G: 0, fatPer100G: 3.6, expectedCaloriesPer100GMin: 130, expectedCaloriesPer100GMax: 220 }), {
    plausible: true,
    weightAssessment: "ok",
    calorieAssessment: "ok",
    reasons: [],
  });
});

test("Describe food plausibility flags candidate portions and densities that are materially high or low", () => {
  const high = assessFoodPlausibility({ expectedWeightG: 30, actualWeightG: 150, caloriesPer100G: 700, proteinPer100G: 5, carbsPer100G: 10, fatPer100G: 70, expectedCaloriesPer100GMin: 100, expectedCaloriesPer100GMax: 250 });
  assert.equal(high.plausible, false);
  assert.equal(high.weightAssessment, "high");
  assert.equal(high.calorieAssessment, "high");
  assert.deepEqual(high.reasons, ["weight-high", "calories-high"]);
});

test("Describe converts total contextual portion weight into a per-unit gram estimate", () => {
  assert.equal(describePortionGramsPerUnit({ quantity: 1, estimatedWeightG: 20 }), 20);
  assert.equal(describePortionGramsPerUnit({ quantity: 3, estimatedWeightG: 60 }), 20);
  assert.equal(describePortionGramsPerUnit({ quantity: 0, estimatedWeightG: 60 }), 0);
});

test("Describe plan validation accepts reviewed portion estimates and rejects malformed output", () => {
  const plan = {
    mealName: "Chicken salad",
    foods: [{
      itemId: "item-1",
      label: "Chicken breast",
      quantity: 150,
      unit: "g",
      estimatedWeightG: 150,
      confidence: 0.82,
      estimatedNutritionForAmount: { calories: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 113 },
    }],
  };
  assert.equal(isUsableDescribeFoodPlan(plan), true);
  assert.equal(describeFoodPlanSignature({ ...plan, mealName: " chicken salad " }), describeFoodPlanSignature(plan));
  assert.notEqual(describeFoodPlanSignature({ ...plan, foods: [{ ...plan.foods[0], estimatedWeightG: 200 }] }), describeFoodPlanSignature(plan));
  assert.equal(isUsableDescribeFoodPlan({ ...plan, foods: [{ ...plan.foods[0], confidence: 1.1 }] }), false);
  assert.equal(isUsableDescribeFoodPlan({ ...plan, foods: [{ ...plan.foods[0], estimatedNutritionForAmount: { calories: -1 } }] }), false);
});

test("Describe extraction and review require stable unique IDs and cannot silently omit the apple", () => {
  const extraction = {
    mealName: "Yogurt and apple",
    foods: [
      { itemId: "item-1", label: "yogurts", quantity: 4, unit: "cup", estimatedWeightG: 600 },
      { itemId: "item-2", label: "large Honeycrisp apple", quantity: 1, unit: "apple", estimatedWeightG: 242 },
    ],
  };
  const review = {
    mealName: "Yogurt and apple",
    foods: [
      { ...extraction.foods[0], confidence: 0.8, calories: 320, proteinG: 48, carbsG: 36, fatG: 0, fiberG: 0, sugarG: 28, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 180 },
      { ...extraction.foods[1], confidence: 0.9, calories: 126, proteinG: 0.7, carbsG: 33.4, fatG: 0.5, fiberG: 5.8, sugarG: 25.2, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 2 },
    ],
  };
  assert.equal(isUsableDescribeFoodExtraction(extraction), true);
  assert.equal(isUsableDescribeFoodReview(review), true);
  assert.equal(describeFoodPlanFromReview(extraction, review)?.foods.length, 2);
  assert.equal(describeFoodPlanFromReview(extraction, { ...review, foods: review.foods.slice(0, 1) }), null);
  assert.equal(isUsableDescribeFoodExtraction({ ...extraction, foods: [extraction.foods[0], { ...extraction.foods[1], itemId: "item-1" }] }), false);
});

test("Describe audit flags uncertain and physically inconsistent estimates for retry", () => {
  const base = {
    itemId: "item-2",
    label: "large Honeycrisp apple",
    quantity: 1,
    unit: "apple",
    estimatedWeightG: 242,
    confidence: 0.9,
    estimatedNutritionForAmount: { calories: 126, proteinG: 0.7, carbsG: 33.4, fatG: 0.5, fiberG: 5.8, sugarG: 25.2, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 2 },
  };
  assert.deepEqual(describeFoodEstimateIssues(base), []);
  assert.deepEqual(describeFoodEstimateIssues({ ...base, confidence: 0.3, estimatedWeightG: 10, estimatedNutritionForAmount: { ...base.estimatedNutritionForAmount, calories: 1500, proteinG: 100 } }), [
    "low-confidence",
    "calorie-macro-mismatch",
    "macro-mass-high",
    "calorie-density-impossible",
  ]);
});

test("Describe audit retries empty nutrition unless the food is credibly zero nutrition", () => {
  const emptyEstimate = {
    itemId: "item-1",
    label: "mystery saffron dumpling",
    quantity: 1,
    unit: "serving",
    estimatedWeightG: 180,
    confidence: 0.82,
    estimatedNutritionForAmount: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sugarAlcoholG: 0, alcoholG: 0, sodiumMg: 0 },
  };
  assert.deepEqual(describeFoodEstimateIssues(emptyEstimate), ["nutrition-empty"]);
  assert.deepEqual(describeFoodEstimateIssues({ ...emptyEstimate, label: "plain water", confidence: 0.95 }), []);
  assert.deepEqual(describeFoodEstimateIssues({ ...emptyEstimate, label: "vanilla ice cream", confidence: 0.95 }), ["nutrition-empty"]);
});

test("Describe delegates its review pipeline to TPS AI Gateway and retains the local parser", () => {
  assert.match(mainSource, /getAiGatewayApi/);
  assert.match(mainSource, /gateway\.completeStructured<T>/);
  assert.match(mainSource, /taskId: \"health\.describe-food\.extract\"/);
  assert.match(mainSource, /taskId: \"health\.describe-food\.review\"/);
  assert.match(mainSource, /taskId: \"health\.describe-food\.repair\"/);
  assert.match(mainSource, /taskId: \"health\.describe-food\.estimate\"/);
  assert.match(mainSource, /preferredProviders: \[\"gemini\"\]/);
  assert.doesNotMatch(mainSource, /api\.openai\.com/);
  assert.doesNotMatch(mainSource, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(mainSource, /\/api\/chat/);
  assert.match(mainSource, /return this\.legacyOpenFoodDescriber\(description, dateContext, onProgress\)/);
  assert.match(settingsSource, /setButtonText\("Open AI Gateway settings"\)/);
  assert.match(settingsSource, /openPluginSettings\("tps-ai-gateway"\)/);
});

test("Describe reviews and repairs every extracted item before preparing editable inline tray items", () => {
  const describeMethod = mainSource.slice(
    mainSource.indexOf("private async openFoodDescriberWithAi"),
    mainSource.indexOf("private async describeFoodAi"),
  );
  assert.match(describeMethod, /Assign stable IDs item-1, item-2/);
  assert.match(describeMethod, /Return every extracted itemId exactly once/);
  assert.match(describeMethod, /Rechecking item/);
  assert.match(describeMethod, /Estimating item/);
  assert.match(describeMethod, /unresolvedDescribeFood/);
  assert.match(describeMethod, /source: \"custom-inline\"/);
  assert.match(describeMethod, /nutritionBasis: \"estimated-serving\"/);
  assert.match(describeMethod, /noteCreation: false/);
  assert.doesNotMatch(describeMethod, /createFoodFromInput|findOrCreateFoodNote/);
  assert.match(mainSource, /captured\.selection\.item\.source !== \"custom-inline\"/);
  assert.match(mainSource, /freshItem\.source === \"custom-inline\" && !freshItem\.sourcePath/);
  assert.match(mainSource, /submit:inline-estimate/);
  assert.match(mainSource, /resolveFoodLogServingWithGramAmount\(loggedItem, quantity, unit, options\.amountGrams\)/);
});

test("Describe keeps mobile users in a visible, retryable flow and opens the completed tray", () => {
  assert.match(mainSource, /describeAction\.setText\("Estimating…"\)/);
  assert.match(mainSource, /describeInput\.blur\(\)/);
  assert.match(mainSource, /if \(!this\.describeDismissed\) this\.statusEl\.setText\(message\)/);
  assert.match(mainSource, /new FoodSearchModal\(this\.app, this\.plugin, initialDraft, this\.dateContext\)\.open\(\)/);
  assert.match(mainSource, /describeAction\.setText\("Try again"\)/);
  assert.match(mainSource, /Your description is still here\./);
  assert.match(mainSource, /job:dismissed-while-running/);
  assert.match(mainSource, /openTray\.addEventListener\("click", \(\) => new FoodSearchModal\(this\.app, this\.plugin, initialDraft, this\.dateContext\)\.open\(\)\)/);
});

test("Describe persists a resumable workflow and uses stable durable jobs for each stage", () => {
  assert.match(mainSource, /durableJobId: workflow \? `\$\{workflow\.id\}-extract-v3` : undefined/);
  assert.match(mainSource, /durableJobId: workflow \? `\$\{workflow\.id\}-review-v3` : undefined/);
  assert.match(mainSource, /durableJobId: workflow \? `\$\{workflow\.id\}-repair-v3-\$\{index \+ 1\}` : undefined/);
  assert.match(mainSource, /durableJobId: workflow \? `\$\{workflow\.id\}-estimate-v1-\$\{index \+ 1\}` : undefined/);
  assert.match(mainSource, /workflow\.extraction = extraction/);
  assert.match(mainSource, /tps-health-pending-food-describe-/);
  assert.match(mainSource, /window\.localStorage\.setItem\(this\.pendingFoodDescribeStorageKey\(\), JSON\.stringify\(workflow\)\)/);
  assert.match(mainSource, /resumePendingFoodDescribeWorkflow\("layout-ready"\)/);
  assert.match(mainSource, /isPendingAiJobError\(error\)/);
  assert.match(mainSource, /id: workflow\?\.id \|\| id\("describe-food"\)/);
  assert.match(mainSource, /workflow\.preparedSelectionItems = selectionItems\.map\(cloneBatchFoodSelection\)/);
  assert.match(mainSource, /workflow:prepared-tray-restored/);
  assert.match(mainSource, /this\.settings\.pendingFoodLogDraft\?\.id === workflow\.id/);
  assert.match(mainSource, /tps:health-food-describe-ready/);
});
