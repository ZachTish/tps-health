import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import * as logger from "./logger";
import TPSHealthPlugin from "./main";
import { applyBuiltInHealthGoalTargets, normalizeHealthGoalDefinition, normalizeUsdaApiKeySecrets } from "./settings-normalization";
import { DEFAULT_SETTINGS, FoodLogTarget, HealthEntityIdentificationMode, RestTimerMode, USDA_API_KEY_SECRET_MAX, WorkoutLogTarget, WorkoutSetNotation } from "./types";

const createCollapsibleSection = (
  parent: HTMLElement,
  title: string,
  description?: string,
  defaultOpen = false
): HTMLElement => {
  const details = parent.createEl("details", { cls: "tps-collapsible-section" });
  if (defaultOpen) details.setAttr("open", "true");

  const summary = details.createEl("summary", { cls: "tps-collapsible-section-summary" });
  summary.createSpan({ cls: "tps-collapsible-section-title", text: title });

  if (description) {
    details.createEl("p", {
      cls: "tps-collapsible-section-description",
      text: description,
    });
  }

  return details.createDiv({ cls: "tps-collapsible-section-content" });
};

export class TPSHealthSettingTab extends PluginSettingTab {
  plugin: TPSHealthPlugin;

  constructor(app: App, plugin: TPSHealthPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TPS Health" });
    containerEl.createEl("p", {
      cls: "tps-health-settings-intro",
      text: "Reusable foods, exercises, and workout plans live as notes. Daily consumption, workouts, and sets are ephemeral logs.",
    });

    const coreSettings = containerEl.createDiv({ cls: "tps-settings-core" });
    new Setting(coreSettings).setName("Core settings").setHeading();

    const diagnosticsSection = createCollapsibleSection(
      containerEl,
      "Diagnostics",
      "Concise development logs for tracing health flows in the developer console.",
      false
    );
    new Setting(diagnosticsSection)
      .setName("Enable debug logging")
      .setDesc("Logs health API, food, workout, barcode, base, and rollup flow checkpoints. Errors are always logged.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableLogging)
        .onChange(async (value) => {
          this.plugin.settings.enableLogging = value;
          await this.plugin.saveSettings();
        }));

    const dailyNotesSection = coreSettings;
    new Setting(dailyNotesSection)
      .setName("Daily note format")
      .setDesc("Moment format used to find or create the daily note.")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.dailyNoteFormat)
        .setValue(this.plugin.settings.dailyNoteFormat)
        .onChange(async (value) => {
          this.plugin.settings.dailyNoteFormat = value.trim() || DEFAULT_SETTINGS.dailyNoteFormat;
          await this.plugin.saveSettings();
        }));

    new Setting(dailyNotesSection)
      .setName("Daily note folder")
      .setDesc("Leave blank when daily notes live at the vault root.")
      .addText((text) => text
        .setValue(this.plugin.settings.dailyNoteFolder)
        .onChange(async (value) => {
          this.plugin.settings.dailyNoteFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    const foldersSection = createCollapsibleSection(
      containerEl,
      "Reusable Health Note Folders",
      "Folders for stable health entities that can be linked from logs.",
      false
    );
    new Setting(foldersSection)
      .setName("Workouts folder")
      .setDesc("Canonical workout note files created by Start workout.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutsFolder)
        .onChange(async (value) => {
          this.plugin.settings.workoutsFolder = value.trim() || DEFAULT_SETTINGS.workoutsFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(foldersSection)
      .setName("Workout plans folder")
      .setDesc("Reusable workout/routine notes live here. Session logs stay in the workouts folder.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutPlansFolder)
        .onChange(async (value) => {
          this.plugin.settings.workoutPlansFolder = value.trim() || DEFAULT_SETTINGS.workoutPlansFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(foldersSection)
      .setName("Exercises folder")
      .addText((text) => text
        .setValue(this.plugin.settings.exercisesFolder)
        .onChange(async (value) => {
          this.plugin.settings.exercisesFolder = value.trim() || DEFAULT_SETTINGS.exercisesFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(foldersSection)
      .setName("Foods folder")
      .addText((text) => text
        .setValue(this.plugin.settings.foodsFolder)
        .onChange(async (value) => {
          this.plugin.settings.foodsFolder = value.trim() || DEFAULT_SETTINGS.foodsFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(foldersSection)
      .setName("Recipes folder")
      .addText((text) => text
        .setValue(this.plugin.settings.recipesFolder)
        .onChange(async (value) => {
          this.plugin.settings.recipesFolder = value.trim() || DEFAULT_SETTINGS.recipesFolder;
          await this.plugin.saveSettings();
        }));

    const identificationSection = createCollapsibleSection(
      containerEl,
      "Reusable Note Identification",
      "Choose whether TPS Health discovers foods and workouts by frontmatter metadata, folders, tags, or any known signal.",
      false
    );
    new Setting(identificationSection)
      .setName("Food note identification")
      .setDesc("Controls which notes are treated as foods, meals, or recipes in search/rendering.")
      .addDropdown((dropdown) => dropdown
        .addOption("metadata-folder-tag", "Frontmatter, folder, or tag")
        .addOption("folder", "Folders only")
        .addOption("tag", "Tags only")
        .addOption("metadata", "Frontmatter only")
        .setValue(this.plugin.settings.foodIdentificationMode)
        .onChange(async (value) => {
          this.plugin.settings.foodIdentificationMode = value as HealthEntityIdentificationMode;
          await this.plugin.saveSettings();
        }));

    new Setting(identificationSection)
      .setName("Workout note identification")
      .setDesc("Controls which notes are treated as workout session notes.")
      .addDropdown((dropdown) => dropdown
        .addOption("metadata-folder-tag", "Frontmatter, folder, or tag")
        .addOption("folder", "Folder only")
        .addOption("tag", "Tag only")
        .addOption("metadata", "Frontmatter only")
        .setValue(this.plugin.settings.workoutIdentificationMode)
        .onChange(async (value) => {
          this.plugin.settings.workoutIdentificationMode = value as HealthEntityIdentificationMode;
          await this.plugin.saveSettings();
        }));

    new Setting(identificationSection)
      .setName("Workout tag")
      .setDesc("Used when workout identification includes tags. New workout notes include this tag.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutTag)
        .onChange(async (value) => {
          this.plugin.settings.workoutTag = value.trim() || DEFAULT_SETTINGS.workoutTag;
          await this.plugin.saveSettings();
        }));

    new Setting(identificationSection)
      .setName("Food tag")
      .setDesc("Used when food identification includes tags. New food notes include this tag.")
      .addText((text) => text
        .setValue(this.plugin.settings.customFoodTag)
        .onChange(async (value) => {
          this.plugin.settings.customFoodTag = value.trim() || DEFAULT_SETTINGS.customFoodTag;
          await this.plugin.saveSettings();
        }));

    new Setting(identificationSection)
      .setName("Recipe/meal tag")
      .setDesc("Used when food identification includes tags. New recipe and meal notes include this tag.")
      .addText((text) => text
        .setValue(this.plugin.settings.recipeTag)
        .onChange(async (value) => {
          this.plugin.settings.recipeTag = value.trim() || DEFAULT_SETTINGS.recipeTag;
          await this.plugin.saveSettings();
        }));

    const templatesSection = createCollapsibleSection(
      containerEl,
      "Food, Exercise, and Workout Templates",
      "Optional note templates used when TPS Health creates reusable notes or session files.",
      false
    );
    new Setting(templatesSection)
      .setName("Workout template path")
      .setDesc("Optional note used when creating a workout session file. Supports {{title}}, {{startedAt}}, {{workoutPlanPath}}, and {{cooldownDays}}.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.workoutTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(templatesSection)
      .setName("Workout plan template path")
      .setDesc("Optional note used when creating a reusable workout plan. Supports {{name}}, {{cooldownDays}}, {{defaultRestSeconds}}, and {{notes}}.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutPlanTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.workoutPlanTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(templatesSection)
      .setName("Exercise template path")
      .setDesc("Optional note used when creating exercises from logged sets. Supports {{name}}, {{category}}, {{defaultRestSeconds}}, and muscle/equipment placeholders.")
      .addText((text) => text
        .setValue(this.plugin.settings.exerciseTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.exerciseTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(templatesSection)
      .setName("Food template path")
      .setDesc("Optional note used when creating a food file. Supports {{name}}, {{brand}}, {{servingGrams}}, {{servingMl}}, and nutrient placeholders.")
      .addText((text) => text
        .setValue(this.plugin.settings.foodTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.foodTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    const gcmSection = createCollapsibleSection(
      containerEl,
      "GCM Food Log Button Integration",
      "Optional controls shown in the TPS Global Context Menu.",
      false
    );
    new Setting(gcmSection)
      .setName("Show food log button in GCM")
      .setDesc("Adds a Food button to the GCM note controls. The button shows today's logged food count and opens quick food logging.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showFoodLogButtonInGcm)
        .onChange(async (value) => {
          this.plugin.settings.showFoodLogButtonInGcm = value;
          await this.plugin.saveSettings();
          this.plugin.refreshGcmFoodLogButtonRegistration();
        }));

    const workoutLoggingSection = createCollapsibleSection(
      containerEl,
      "Workout Session Logging",
      "Controls rest timing, cooldown defaults, and where workout instances are stored.",
      false
    );
    new Setting(workoutLoggingSection)
      .setName("Rest timer mode")
      .setDesc("Count up measures rest until the next set starts. Count down uses the default rest target after each set.")
      .addDropdown((dropdown) => dropdown
        .addOption("count-up", "Count up")
        .addOption("count-down", "Count down")
        .setValue(this.plugin.settings.restTimerMode)
        .onChange(async (value) => {
          this.plugin.settings.restTimerMode = value as RestTimerMode;
          await this.plugin.saveSettings();
        }));

    new Setting(workoutLoggingSection)
      .setName("Default rest seconds")
      .addText((text) => text
        .setValue(String(this.plugin.settings.defaultRestSeconds))
        .onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.settings.defaultRestSeconds = Number.isFinite(parsed) && parsed > 0
            ? Math.round(parsed)
            : DEFAULT_SETTINGS.defaultRestSeconds;
          await this.plugin.saveSettings();
        }));

    new Setting(workoutLoggingSection)
      .setName("Default workout cooldown days")
      .setDesc("Used by new workout plans and ad hoc workouts when no plan-specific cooldown is set.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.defaultWorkoutCooldownDays))
        .onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.settings.defaultWorkoutCooldownDays = Number.isFinite(parsed) && parsed >= 0
            ? Math.round(parsed)
            : DEFAULT_SETTINGS.defaultWorkoutCooldownDays;
          await this.plugin.saveSettings();
        }));

    new Setting(workoutLoggingSection)
      .setName("Set notation")
      .setDesc("Compact uses gym-log style text like 225 lb x 15. Verbose uses separate reps/weight phrases.")
      .addDropdown((dropdown) => dropdown
        .addOption("compact", "Compact")
        .addOption("verbose", "Verbose")
        .setValue(this.plugin.settings.workoutSetNotation)
        .onChange(async (value) => {
          this.plugin.settings.workoutSetNotation = value as WorkoutSetNotation;
          await this.plugin.saveSettings();
        }));

    new Setting(workoutLoggingSection)
      .setName("Append workout summary to daily note")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.appendWorkoutSummaryToDailyNote)
        .onChange(async (value) => {
          this.plugin.settings.appendWorkoutSummaryToDailyNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(workoutLoggingSection)
      .setName("Workout log target")
      .setDesc("Choose whether the workout note is canonical, the daily note is canonical, or both are written.")
      .addDropdown((dropdown) => dropdown
        .addOption("session-note", "Workout note")
        .addOption("daily-note", "Daily note only")
        .addOption("both", "Workout note + daily receipt")
        .setValue(this.plugin.settings.workoutLogTarget)
        .onChange(async (value) => {
          this.plugin.settings.workoutLogTarget = value as WorkoutLogTarget;
          await this.plugin.saveSettings();
        }));

    const foodLoggingSection = createCollapsibleSection(
      containerEl,
      "Food Instance Logging",
      "Controls consumed-food instance logs and daily macro rollups.",
      false
    );
    new Setting(foodLoggingSection)
      .setName("Default food log section")
      .setDesc("Optional. Blank inserts food logs immediately after daily-note frontmatter.")
      .addText((text) => text
        .setPlaceholder("Food Log")
        .setValue(this.plugin.settings.defaultFoodLogSection)
        .onChange(async (value) => {
          this.plugin.settings.defaultFoodLogSection = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(foodLoggingSection)
      .setName("Food log target")
      .setDesc("Where consumed-food instance lines are written. Single file keeps all food logs together and links each entry to its scheduled daily note.")
      .addDropdown((dropdown) => dropdown
        .addOption("daily-note", "Daily note")
        .addOption("single-file", "Single file")
        .setValue(this.plugin.settings.foodLogTarget)
        .onChange(async (value) => {
          this.plugin.settings.foodLogTarget = value as FoodLogTarget;
          await this.plugin.saveSettings();
        }));

    new Setting(foodLoggingSection)
      .setName("Food log file")
      .setDesc("Used when food log target is Single file.")
      .addText((text) => text
        .setPlaceholder("Health/Food Log.md")
        .setValue(this.plugin.settings.foodLogFilePath)
        .onChange(async (value) => {
          this.plugin.settings.foodLogFilePath = value.trim() || DEFAULT_SETTINGS.foodLogFilePath;
          await this.plugin.saveSettings();
        }));

    new Setting(foodLoggingSection)
      .setName("Automatic daily rollups")
      .setDesc("Recalculate calories and macros into daily note frontmatter after food is logged.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.automaticDailyRollups)
        .onChange(async (value) => {
          this.plugin.settings.automaticDailyRollups = value;
          await this.plugin.saveSettings();
        }));

    const dataSourcesSection = createCollapsibleSection(
      containerEl,
      "Nutrition Search Data Sources",
      "Live database behavior for food search and barcode lookup.",
      false
    );
    new Setting(dataSourcesSection)
      .setName("Include branded search results")
      .setDesc("Searches branded provider databases for packaged grocery foods. Ranking and broad-query filters control noisy matches.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeBrandedFoodSearch)
        .onChange(async (value) => {
          this.plugin.settings.includeBrandedFoodSearch = value;
          await this.plugin.saveSettings();
        }));

    const goalsSection = createCollapsibleSection(
      containerEl,
      "Calorie, Protein, Activity, and Custom Goals",
      "Goal definitions used by GCM metric rendering and daily frontmatter rollups.",
      false
    );
    new Setting(goalsSection)
      .setName("Calorie goal")
      .setDesc("Canonical maximum used by GCM for the built-in consumed-calories metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.calorieGoal))
        .onChange(async (value) => {
          await this.plugin.updateBuiltInHealthGoalTarget("calorieGoal", positiveNumber(value, DEFAULT_SETTINGS.calorieGoal));
        }));

    new Setting(goalsSection)
      .setName("Protein goal g")
      .setDesc("Canonical minimum used by GCM for the built-in protein metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.proteinGoalG))
        .onChange(async (value) => {
          await this.plugin.updateBuiltInHealthGoalTarget("proteinGoalG", positiveNumber(value, DEFAULT_SETTINGS.proteinGoalG));
        }));

    new Setting(goalsSection)
      .setName("Activity goal minutes")
      .setDesc("Canonical minimum used by GCM for the built-in activity metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.activityGoalMinutes))
        .onChange(async (value) => {
          await this.plugin.updateBuiltInHealthGoalTarget("activityGoalMinutes", positiveNumber(value, DEFAULT_SETTINGS.activityGoalMinutes));
        }));

    new Setting(goalsSection)
      .setName("Health goals")
      .setDesc("One JSON goal per metric. Built-in calorie, protein, and activity target bounds come from the canonical fields above; use this JSON for labels, colors, ranges, and additional metrics.")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.cols = 48;
        text
          .setValue(JSON.stringify(this.plugin.settings.healthGoals, null, 2))
          .onChange(async (value) => {
            try {
              const parsed = JSON.parse(value);
              if (!Array.isArray(parsed)) {
                logger.flowWarn("Settings", "health-goals:invalid-shape", { parsedType: typeof parsed });
                return;
              }
              this.plugin.settings.healthGoals = applyBuiltInHealthGoalTargets(parsed
                .map((goal) => normalizeHealthGoalDefinition(goal))
                .filter((goal): goal is NonNullable<typeof goal> => Boolean(goal)), this.plugin.settings);
              logger.flow("Settings", "health-goals:parsed", { count: this.plugin.settings.healthGoals.length });
              await this.plugin.saveSettings();
            } catch (error) {
              logger.flowWarn("Settings", "health-goals:invalid-json", { error: logger.errorSummary(error) });
              // Leave the last valid goal config in place while the user edits JSON.
            }
          });
      });

    const apiKeysSection = createCollapsibleSection(
      containerEl,
      "Open Food Facts and USDA API Settings",
      "Optional credentials and client identification for remote nutrition databases.",
      false
    );
    new Setting(apiKeysSection)
      .setName("Open Food Facts User-Agent")
      .setDesc("Open Food Facts asks API clients to identify themselves.")
      .addText((text) => text
        .setValue(this.plugin.settings.openFoodFactsUserAgent)
        .onChange(async (value) => {
          this.plugin.settings.openFoodFactsUserAgent = value.trim() || DEFAULT_SETTINGS.openFoodFactsUserAgent;
          await this.plugin.saveSettings();
        }));

    apiKeysSection.createEl("p", {
      cls: "setting-item-description",
      text: "USDA credentials are tried in order only when a device secret is empty or USDA returns API_KEY_MISSING/API_KEY_INVALID. Disabled, unverified, unauthorized, generic 403, and HTTP 429 responses do not rotate; TPS Health surfaces the error or waits for Retry-After.",
    });
    for (const [index, reference] of this.plugin.settings.usdaApiKeySecrets.entries()) {
      const label = index === 0 ? "USDA API key — Primary" : `USDA API key — Fallback ${index}`;
      const setting = new Setting(apiKeysSection)
        .setName(label)
        .setDesc(index === 0
          ? "First populated device-local Obsidian secret used for FoodData Central."
          : "Used only after an earlier device secret is empty or receives API_KEY_MISSING/API_KEY_INVALID.")
        .addComponent((element) => new SecretComponent(this.plugin.app, element)
          .setValue(reference)
          .onChange(async (value) => {
            const references = [...this.plugin.settings.usdaApiKeySecrets];
            references[index] = value;
            this.plugin.settings.usdaApiKeySecrets = normalizeUsdaApiKeySecrets(references);
            await this.plugin.saveSettings();
            this.display();
          }));
      if (index > 0) setting.addExtraButton((button) => button
        .setIcon("arrow-up")
        .setTooltip("Move USDA key earlier")
        .onClick(async () => {
          const references = [...this.plugin.settings.usdaApiKeySecrets];
          [references[index - 1], references[index]] = [references[index], references[index - 1]];
          this.plugin.settings.usdaApiKeySecrets = references;
          await this.plugin.saveSettings();
          this.display();
        }));
      if (index < this.plugin.settings.usdaApiKeySecrets.length - 1) setting.addExtraButton((button) => button
        .setIcon("arrow-down")
        .setTooltip("Move USDA key later")
        .onClick(async () => {
          const references = [...this.plugin.settings.usdaApiKeySecrets];
          [references[index], references[index + 1]] = [references[index + 1], references[index]];
          this.plugin.settings.usdaApiKeySecrets = references;
          await this.plugin.saveSettings();
          this.display();
        }));
      setting.addExtraButton((button) => button
        .setIcon("trash")
        .setTooltip("Remove USDA key reference")
        .onClick(async () => {
          this.plugin.settings.usdaApiKeySecrets = this.plugin.settings.usdaApiKeySecrets.filter((_entry, entryIndex) => entryIndex !== index);
          await this.plugin.saveSettings();
          this.display();
        }));
    }
    if (this.plugin.settings.usdaApiKeySecrets.length < USDA_API_KEY_SECRET_MAX) {
      new Setting(apiKeysSection)
        .setName(this.plugin.settings.usdaApiKeySecrets.length ? "Add USDA fallback" : "Add USDA API key")
        .setDesc(`Up to ${USDA_API_KEY_SECRET_MAX} ordered SecretStorage references. If none contain a value, TPS Health uses DEMO_KEY.`)
        .addButton((button) => button
          .setButtonText("Add secret")
          .onClick(() => {
            this.plugin.settings.usdaApiKeySecrets = [...this.plugin.settings.usdaApiKeySecrets, ""];
            this.display();
          }));
    }

    new Setting(apiKeysSection)
      .setName("AI-assisted Describe")
      .setDesc("Provider credentials, models, fallback order, and AI diagnostics are managed centrally in TPS AI Gateway. Describe falls back to deterministic local matching when the gateway is unavailable.");
  }
}

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
