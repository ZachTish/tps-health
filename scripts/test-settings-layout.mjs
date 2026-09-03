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

test("Health settings keep only the four intentional optional disclosures", () => {
  const disclosureIds = [...settingsSource.matchAll(
    /this\.createOptionalDisclosure\(\s*page,\s*"([^"]+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(disclosureIds, ["custom-goals", "templates", "native-frontmatter", "provider-credentials"]);
  assert.equal((settingsSource.match(/createEl\("details"/g) || []).length, 1);
  assert.doesNotMatch(settingsSource, /createCollapsibleSection|tps-collapsible-section/);
  assert.match(settingsSource, /"Custom goal JSON"/);
  assert.match(settingsSource, /"Templates"/);
  assert.match(settingsSource, /"Provider credentials"/);
  assert.match(settingsSource, /"Health record frontmatter"/);
});

test("Every active user preference remains bound and exerciseTag is editable", () => {
  const preferenceKeys = [
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
    "workoutDailyNotePlacement",
    "workoutStartPropertyKey",
    "workoutIntervalMode",
    "workoutIntervalPropertyKey",
    "restTimerMode",
    "defaultRestSeconds",
    "defaultWorkoutCooldownDays",
    "workoutSetNotation",
    "workoutControlPlacement",
    "workoutsFolder",
    "workoutPlansFolder",
    "exercisesFolder",
    "foodsFolder",
    "recipesFolder",
    "foodIdentificationMode",
    "foodFrontmatterKey",
    "foodFrontmatterFoodValue",
    "foodFrontmatterRecipeValue",
    "foodFrontmatterMealValue",
    "nativeRecordKinds",
    "nativeRecordProperties",
    "nativeRecordKindAliases",
    "nativeRecordPropertyAliases",
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
    const folderHelperBinding = ["workoutsFolder", "workoutPlansFolder", "exercisesFolder", "foodsFolder", "recipesFolder"].includes(key)
      ? new RegExp(`addLibraryFolderSetting\\(folders, "${key}"`)
      : null;
    assert.match(
      settingsSource,
      folderHelperBinding ?? new RegExp(`this\\.plugin\\.settings\\.${key}\\b`),
      `${key} must remain connected to the settings UI`,
    );
  }
  assert.match(settingsSource, /\.setName\("Exercise tag"\)[\s\S]+?this\.plugin\.settings\.exerciseTag = value\.trim\(\)/);
  assert.match(settingsSource, /\.setName\("Food tag"\)[\s\S]+?Blank disables this identity signal/);
  assert.match(settingsSource, /\.setName\("Food frontmatter key"\)/);
  assert.match(settingsSource, /addIdentifierValue\("Food value"/);
  assert.match(settingsSource, /addIdentifierValue\("Recipe value"/);
  assert.match(settingsSource, /addIdentifierValue\("Meal value"/);
  assert.match(settingsSource, /"Food entry kind value"/);
  assert.match(settingsSource, /"Activity entry kind value"/);
  assert.match(settingsSource, /renderNativeFrontmatterSettings/);
  assert.match(settingsSource, /addNativePropertyKeySetting/);
  assert.match(settingsSource, /setButtonText\("Open GCM settings"\)/);
  assert.match(settingsSource, /foodIdentificationMode === "metadata" \|\| this\.plugin\.settings\.foodIdentificationMode === "metadata-folder-tag"/);
  assert.doesNotMatch(settingsSource, /this\.plugin\.settings\.(dailyNoteFormat|dailyNoteFolder)/);
  assert.match(settingsSource, /\.setName\("Daily Notes source"\)/);
  assert.match(settingsSource, /Obsidian → Core plugins → Daily notes/);
  assert.match(settingsSource, /setButtonText\("Open Daily Notes settings"\)/);
  assert.match(settingsSource, /openTabById\?\.\("daily-notes"\)/);
  assert.match(settingsSource, /setButtonText\("Open AI Gateway settings"\)/);
  assert.match(settingsSource, /\.setName\("Also create a dedicated workout note"\)/);
  assert.match(settingsSource, /\.setName\("Workout position in Daily Note"\)/);
  assert.match(settingsSource, /\.addOption\("after-frontmatter", "Top, after properties"\)/);
  assert.match(settingsSource, /\.addOption\("before-first-h2", "Above the first level-2 heading"\)/);
  assert.match(settingsSource, /\.addOption\("bottom", "Bottom of note"\)/);
  assert.match(settingsSource, /addWorkoutPropertyKey\(\s*"Workout start property"/);
  assert.match(settingsSource, /\.setName\("Workout interval style"\)/);
  assert.match(settingsSource, /\.addOption\("duration", "Duration in minutes"\)/);
  assert.match(settingsSource, /\.addOption\("end", "Ending datetime"\)/);
  assert.match(settingsSource, /addWorkoutPropertyKey\(\s*"Workout interval property"/);
  assert.match(settingsSource, /\.setName\("Workout controls"\)/);
  assert.match(settingsSource, /\.addOption\("inline", "Inline with workout"\)/);
  assert.match(settingsSource, /\.addOption\("floating", "Floating over note"\)/);
  assert.match(settingsSource, /workout-controls:changed/);
  assert.match(settingsSource, /dataset\.tpsHealthWorkoutProperty = settingKey/);
  assert.match(settingsSource, /openPluginSettings\("tps-ai-gateway"\)/);
  assert.match(settingsSource, /openTabById\?\.\(pluginId\)/);
  assert.doesNotMatch(settingsSource, /this\.plugin\.settings\.(activeSettingsPage|disclosureState|settingsPage)/);
  assert.doesNotMatch(settingsSource, /this\.plugin\.settings\.(activeWorkoutPath|activeWorkoutId|pendingFoodLogDraft|rollupHeading)/);
});

test("Reusable entity destinations can be typed atomically or selected from existing vault folders", () => {
  assert.match(settingsSource, /class HealthFolderSuggestModal extends FuzzySuggestModal<TFolder>/);
  assert.match(settingsSource, /getAllLoadedFiles\(\)[\s\S]+entry instanceof TFolder/);
  assert.ok(settingsSource.includes('entry.path.replace(/^\\/+|\\/+$/g, "")'), "the vault root must not appear as a selectable entity folder");
  assert.match(settingsSource, /\.setPlaceholder\("Choose a vault folder"\)/);
  for (const [key, label] of [
    ["workoutsFolder", "Workouts destination"],
    ["workoutPlansFolder", "Workout plans destination"],
    ["exercisesFolder", "Exercises destination"],
    ["foodsFolder", "Foods destination"],
    ["recipesFolder", "Recipes destination"],
  ]) {
    assert.match(settingsSource, new RegExp(`addLibraryFolderSetting\\(folders, "${key}", "${label}"`));
  }
  const helperSource = settingsSource.slice(
    settingsSource.indexOf("private addLibraryFolderSetting"),
    settingsSource.indexOf("private renderIntegrationsPage"),
  );
  assert.match(helperSource, /dataset\.tpsHealthLibraryFolder = key/);
  assert.match(helperSource, /addEventListener\("change", \(\) => void commit\(text\.getValue\(\)\)\)/);
  assert.match(helperSource, /event\.key !== "Enter"/);
  assert.match(helperSource, /setIcon\("folder-search"\)/);
  assert.match(helperSource, /new HealthFolderSuggestModal\(this\.app/);
  assert.match(settingsSource, /Existing exercise notes remain where they are/);
  assert.match(settingsSource, /Existing food notes remain where they are/);
  assert.doesNotMatch(helperSource, /\.onChange\(async \(value\)/, "folder paths must not persist partial values on every keystroke");
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

test("Workout set controls stay in one compact table row in Reading and Live Preview", () => {
  assert.match(stylesSource, /\.tps-health-workout-set-row\s*\{[\s\S]+container-type: inline-size;/);
  assert.match(stylesSource, /\.tps-health-workout-set-editor\s*\{[\s\S]+container-type: inline-size;/);
  assert.match(stylesSource, /\.tps-health-workout-set-row\s*\{[\s\S]+overflow: visible;/);
  const finalLayoutStart = stylesSource.lastIndexOf("/* Authoritative compact workout table.");
  assert.ok(finalLayoutStart > stylesSource.indexOf("/* Workout rows are compact"), "authoritative layout must follow compact defaults");
  const finalLayout = stylesSource.slice(finalLayoutStart);
  assert.match(finalLayout, /grid-template-columns: minmax\(30px, \.42fr\) minmax\(66px, 1\.15fr\) minmax\(46px, \.78fr\) minmax\(54px, \.9fr\) minmax\(34px, \.5fr\)/);
  assert.match(finalLayout, /\.tps-health-workout-set-grid-header,[\s\S]+\.tps-health-workout-set-metrics[\s\S]+display: grid/);
  assert.match(finalLayout, /\.tps-health-workout-set-previous,[\s\S]+\.tps-health-workout-set-field-label,[\s\S]+display: none/);
  assert.match(finalLayout, /\.tps-health-workout-set-stepper \.tps-health-workout-set-step\s*\{\s*display: none;/);
  assert.match(finalLayout, /@container tps-health-workout-set-row \(max-width: 330px\)[\s\S]+grid-template-columns: 28px minmax\(56px, 1fr\) minmax\(40px, \.7fr\) minmax\(46px, \.78fr\) 34px/);
  assert.match(finalLayout, /\.markdown-source-view\.mod-cm6 \.cm-content \.tps-health-workout-set-editor\s*\{[\s\S]+background: transparent;[\s\S]+border-block: 0;[\s\S]+border-inline: 1px solid var\(--background-modifier-border\);[\s\S]+margin: 0;[\s\S]+padding: 0 7px;[\s\S]+width: 100%;/);
  assert.match(finalLayout, /\.markdown-source-view\.mod-cm6 \.cm-content \.tps-health-workout-set-editor\.is-exercise-start\s*\{[\s\S]+border-block-start: 1px solid var\(--background-modifier-border\);[\s\S]+border-radius: 8px 8px 0 0;/);
  assert.match(finalLayout, /\.markdown-source-view\.mod-cm6 \.cm-content \.tps-health-workout-set-editor\.is-exercise-end\s*\{[\s\S]+border-block-end: 1px solid var\(--background-modifier-border\);[\s\S]+border-radius: 0 0 8px 8px;/);
  assert.match(finalLayout, /\.tps-health-workout-set-editor\.is-exercise-end \.tps-health-workout-set-metrics\s*\{\s*border-bottom: 0;/);
  assert.doesNotMatch(finalLayout, /repeat\([123], minmax\(0, 1fr\)\)/, "set metrics must never reflow into stacked cards");
  assert.doesNotMatch(finalLayout, /border-left: 3px solid/, "the compact table does not add a colored left rail");
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
