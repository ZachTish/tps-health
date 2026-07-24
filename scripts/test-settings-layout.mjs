import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("Health settings expose five shallow routed destinations", () => {
  const destinationSource = settingsSource.slice(
    settingsSource.indexOf("const HEALTH_SETTINGS_DESTINATIONS"),
    settingsSource.indexOf("const createSettingsGroup"),
  );
  const destinations = [
    ["daily", "Daily logging"],
    ["food-goals", "Food & goals"],
    ["workouts", "Workouts"],
    ["library", "Note library"],
    ["integrations", "Integrations & advanced"],
  ];
  for (const [id, label] of destinations) {
    assert.match(destinationSource, new RegExp(`id: "${id}"[\\s\\S]+?label: "${label.replace(/[&]/g, "\\&")}"`));
  }
  assert.equal((destinationSource.match(/\bid: "/g) || []).length, 5);
  assert.match(settingsSource, /private activeSettingsPage: HealthSettingsPage = "daily"/);
  assert.match(settingsSource, /buttons\.setAttr\("role", "group"\)/);
  assert.match(settingsSource, /buttons\.setAttr\("aria-label", "TPS Health settings pages"\)/);
  assert.match(settingsSource, /"aria-pressed": active \? "true" : "false"/);
  assert.match(settingsSource, /"aria-labelledby": `tps-health-settings-page-\$\{destination\.id\}-title`/);
  assert.doesNotMatch(settingsSource, /"aria-controls":/);
  assert.match(settingsSource, /tabindex: "-1"/);
  assert.match(settingsSource, /pageTitle\?\.focus\(\{ preventScroll: true \}\)/);
  const summarySource = settingsSource.slice(
    settingsSource.indexOf("private settingsPageSummary"),
    settingsSource.indexOf("private renderActiveSettingsPage"),
  );
  assert.doesNotMatch(summarySource, /this\.plugin\.settings/);
});

test("Health settings keep only the three intentional optional disclosures", () => {
  const disclosureIds = [...settingsSource.matchAll(
    /this\.createOptionalDisclosure\(\s*page,\s*"([^"]+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(disclosureIds, ["custom-goals", "templates", "provider-credentials"]);
  assert.equal((settingsSource.match(/createEl\("details"/g) || []).length, 1);
  assert.doesNotMatch(settingsSource, /createCollapsibleSection|tps-collapsible-section/);
  assert.match(settingsSource, /"Custom goal JSON"/);
  assert.match(settingsSource, /"Templates"/);
  assert.match(settingsSource, /"Provider credentials"/);
});

test("Every user preference remains bound and exerciseTag is now editable", () => {
  const preferenceKeys = [
    "dailyNoteFormat",
    "dailyNoteFolder",
    "foodLogTarget",
    "foodLogFilePath",
    "defaultFoodLogSection",
    "automaticDailyRollups",
    "includeBrandedFoodSearch",
    "calorieGoal",
    "proteinGoalG",
    "activityGoalMinutes",
    "healthGoals",
    "workoutLogTarget",
    "appendWorkoutSummaryToDailyNote",
    "restTimerMode",
    "defaultRestSeconds",
    "defaultWorkoutCooldownDays",
    "workoutSetNotation",
    "workoutsFolder",
    "workoutPlansFolder",
    "exercisesFolder",
    "foodsFolder",
    "recipesFolder",
    "foodIdentificationMode",
    "workoutIdentificationMode",
    "workoutTag",
    "exerciseTag",
    "customFoodTag",
    "recipeTag",
    "workoutTemplatePath",
    "workoutPlanTemplatePath",
    "exerciseTemplatePath",
    "foodTemplatePath",
    "showFoodLogButtonInGcm",
    "openFoodFactsUserAgent",
    "usdaApiKeySecrets",
    "enableLogging",
  ];
  for (const key of preferenceKeys) {
    assert.match(settingsSource, new RegExp(`this\\.plugin\\.settings\\.${key}\\b`), `${key} must remain connected to the settings UI`);
  }
  assert.match(settingsSource, /\.setName\("Exercise tag"\)[\s\S]+?this\.plugin\.settings\.exerciseTag[\s\S]+?DEFAULT_SETTINGS\.exerciseTag/);
  assert.match(settingsSource, /setButtonText\("Open AI Gateway settings"\)/);
  assert.match(settingsSource, /openPluginSettings\("tps-ai-gateway"\)/);
  assert.match(settingsSource, /openTabById\?\.\(pluginId\)/);
  assert.doesNotMatch(settingsSource, /this\.plugin\.settings\.(activeSettingsPage|disclosureState|settingsPage)/);
  assert.doesNotMatch(settingsSource, /this\.plugin\.settings\.(activeWorkoutPath|activeWorkoutId|pendingFoodLogDraft|rollupHeading)/);
});

test("USDA rerenders retain disclosure, scroll, and reachable focus", () => {
  const providerSource = settingsSource.slice(
    settingsSource.indexOf("private renderProviderCredentials"),
    settingsSource.indexOf("private usdaSecretFocusSelector"),
  );
  assert.match(settingsSource, /private redisplayPreservingContext\(focusSelector\?: string\): void/);
  assert.match(settingsSource, /const scrollTop = this\.containerEl\.scrollTop/);
  assert.match(settingsSource, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(settingsSource, /this\.containerEl\.scrollTop = scrollTop/);
  assert.match(providerSource, /this\.disclosureState\.set\("provider-credentials", true\)/);
  assert.ok(
    (providerSource.match(/this\.redisplayPreservingContext\(/g) || []).length >= 5,
    "secret edit, move, remove, and add routes must use the preserving rerender helper",
  );
  assert.doesNotMatch(providerSource, /this\.display\(\)/);
  assert.match(providerSource, /dataset\.tpsHealthUsdaSecretIndex/);
  assert.match(providerSource, /dataset\.tpsHealthUsdaAdd/);
  assert.match(settingsSource, /\[data-tps-health-usda-secret-index="\$\{index\}"\] input/);
});

test("Food log file is shown only for the single-file owner and the selector keeps focus", () => {
  const dailySource = settingsSource.slice(
    settingsSource.indexOf("private renderDailyLoggingPage"),
    settingsSource.indexOf("private renderFoodGoalsPage"),
  );
  assert.match(dailySource, /this\.plugin\.settings\.foodLogTarget === "single-file"/);
  assert.match(dailySource, /this\.redisplayPreservingContext\("\[data-tps-health-food-log-target\] select"\)/);
  assert.match(dailySource, /dataset\.tpsHealthFoodLogTarget = "true"/);
});

test("Health settings mobile CSS is namespaced and keeps controls usable", () => {
  assert.match(stylesSource, /\.tps-health-settings-hub\s*\{[\s\S]+position: sticky/);
  assert.match(stylesSource, /\.tps-health-settings-route-grid\s*\{[\s\S]+grid-template-columns: repeat\(5/);
  assert.match(stylesSource, /button\.tps-health-settings-route-button\[aria-pressed="true"\]/);
  assert.match(settingsSource, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
  assert.match(settingsSource, /pageTitle\?\.scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(stylesSource, /\.tps-health-settings-page-title:focus-visible/);
  assert.match(stylesSource, /@media \(max-width: 700px\)[\s\S]+\.tps-health-settings-route-grid\s*\{[\s\S]+display: flex/);
  assert.match(stylesSource, /@media \(max-width: 700px\)[\s\S]+button\.tps-health-settings-route-button\s*\{[\s\S]+min-width: 148px/);
  assert.match(stylesSource, /\.tps-health-settings-route-description\s*\{\s*display: none;/);
  assert.match(stylesSource, /\.tps-health-settings-page \.setting-item\s*\{[\s\S]+align-items: stretch;[\s\S]+flex-direction: column;/);
  assert.match(stylesSource, /\.tps-health-settings-page \.setting-item-control\s*\{[\s\S]+width: 100%/);
  assert.match(stylesSource, /\.tps-health-settings-json\s*\{[\s\S]+width: 100%/);
  assert.match(stylesSource, /\.tps-health-settings-page \[data-tps-health-usda-secret-index\]\s*\{[\s\S]+min-width: 0/);
});

test("README documents the routed settings contract", () => {
  for (const label of ["Daily logging", "Food & goals", "Workouts", "Note library", "Integrations & advanced"]) {
    assert.match(readmeSource, new RegExp(`\\*\\*${label.replace(/[&]/g, "\\&")}\\*\\*`));
  }
  assert.match(readmeSource, /Exercise tag/);
  assert.match(readmeSource, /Custom goal JSON/);
  assert.match(readmeSource, /Provider credentials/);
  assert.match(readmeSource, /route and scroll position/);
});
