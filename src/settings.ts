import { App, PluginSettingTab, Setting } from "obsidian";
import TPSHealthPlugin from "./main";
import { DEFAULT_SETTINGS, FoodLogTarget, RestTimerMode, WorkoutExerciseLayout, WorkoutLogTarget, WorkoutSessionBodyMode, WorkoutSetNotation, WorkoutSetStorage } from "./types";

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

    this.addSection(containerEl, "Daily Notes", "Where daily food/workout logs and automatic rollups are written.");
    new Setting(containerEl)
      .setName("Daily note format")
      .setDesc("Moment format used to find or create the daily note.")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.dailyNoteFormat)
        .setValue(this.plugin.settings.dailyNoteFormat)
        .onChange(async (value) => {
          this.plugin.settings.dailyNoteFormat = value.trim() || DEFAULT_SETTINGS.dailyNoteFormat;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Daily note folder")
      .setDesc("Leave blank when daily notes live at the vault root.")
      .addText((text) => text
        .setValue(this.plugin.settings.dailyNoteFolder)
        .onChange(async (value) => {
          this.plugin.settings.dailyNoteFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    this.addSection(containerEl, "Reusable Notes", "Folders for stable health entities that can be linked from logs.");
    new Setting(containerEl)
      .setName("Workouts folder")
      .setDesc("Standalone workout session files, used when workout log target is Session note or Both.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutsFolder)
        .onChange(async (value) => {
          this.plugin.settings.workoutsFolder = value.trim() || DEFAULT_SETTINGS.workoutsFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Workout plans folder")
      .setDesc("Reusable workout/routine notes live here. Session logs stay in the workouts folder.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutPlansFolder)
        .onChange(async (value) => {
          this.plugin.settings.workoutPlansFolder = value.trim() || DEFAULT_SETTINGS.workoutPlansFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Exercises folder")
      .addText((text) => text
        .setValue(this.plugin.settings.exercisesFolder)
        .onChange(async (value) => {
          this.plugin.settings.exercisesFolder = value.trim() || DEFAULT_SETTINGS.exercisesFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Foods folder")
      .addText((text) => text
        .setValue(this.plugin.settings.foodsFolder)
        .onChange(async (value) => {
          this.plugin.settings.foodsFolder = value.trim() || DEFAULT_SETTINGS.foodsFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Recipes folder")
      .addText((text) => text
        .setValue(this.plugin.settings.recipesFolder)
        .onChange(async (value) => {
          this.plugin.settings.recipesFolder = value.trim() || DEFAULT_SETTINGS.recipesFolder;
          await this.plugin.saveSettings();
        }));

    this.addSection(containerEl, "Templates", "Optional note templates used when TPS Health creates reusable notes or session files.");
    new Setting(containerEl)
      .setName("Workout template path")
      .setDesc("Optional note used when creating a workout session file. Supports {{title}}, {{startedAt}}, {{workoutPlanPath}}, and {{cooldownDays}}.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.workoutTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Workout plan template path")
      .setDesc("Optional note used when creating a reusable workout plan. Supports {{name}}, {{cooldownDays}}, {{defaultRestSeconds}}, and {{notes}}.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutPlanTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.workoutPlanTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Exercise template path")
      .setDesc("Optional note used when creating exercises from logged sets. Supports {{name}}, {{category}}, {{defaultRestSeconds}}, and muscle/equipment placeholders.")
      .addText((text) => text
        .setValue(this.plugin.settings.exerciseTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.exerciseTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Food template path")
      .setDesc("Optional note used when creating a food file. Supports {{name}}, {{brand}}, {{servingGrams}}, {{servingMl}}, and nutrient placeholders.")
      .addText((text) => text
        .setValue(this.plugin.settings.foodTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.foodTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    this.addSection(containerEl, "GCM Integration", "Optional controls shown in the TPS Global Context Menu.");
    new Setting(containerEl)
      .setName("Show food log button in GCM")
      .setDesc("Adds a Food button to the GCM note controls. The button shows today's logged food count and opens quick food logging.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showFoodLogButtonInGcm)
        .onChange(async (value) => {
          this.plugin.settings.showFoodLogButtonInGcm = value;
          await this.plugin.saveSettings();
          this.plugin.refreshGcmFoodLogButtonRegistration();
        }));

    this.addSection(containerEl, "Workout Logging", "Controls rest timing, cooldown defaults, and where workout instances are stored.");
    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Workout note body")
      .setDesc("What TPS Health writes into a new session note when no workout template is configured.")
      .addDropdown((dropdown) => dropdown
        .addOption("blank", "Blank")
        .addOption("sets-section", "Sets section")
        .setValue(this.plugin.settings.workoutSessionBodyMode)
        .onChange(async (value) => {
          this.plugin.settings.workoutSessionBodyMode = value as WorkoutSessionBodyMode;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Exercise layout in workout notes")
      .setDesc("How logged sets are organized inside standalone workout notes.")
      .addDropdown((dropdown) => dropdown
        .addOption("flat", "Flat set tasks")
        .addOption("exercise-bullets", "Exercise parent bullets")
        .addOption("exercise-headings", "Exercise headings")
        .setValue(this.plugin.settings.workoutExerciseLayout)
        .onChange(async (value) => {
          this.plugin.settings.workoutExerciseLayout = value as WorkoutExerciseLayout;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Set line type")
      .setDesc("Whether logged sets in standalone workout notes are stored as completed tasks or plain bullets.")
      .addDropdown((dropdown) => dropdown
        .addOption("task", "Task")
        .addOption("bullet", "Bullet")
        .setValue(this.plugin.settings.workoutSetStorage)
        .onChange(async (value) => {
          this.plugin.settings.workoutSetStorage = value as WorkoutSetStorage;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Append workout summary to daily note")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.appendWorkoutSummaryToDailyNote)
        .onChange(async (value) => {
          this.plugin.settings.appendWorkoutSummaryToDailyNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Workout log heading")
      .setDesc("Daily note section where workout sessions, summaries, and nested sets are written.")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.workoutLogHeading)
        .setValue(this.plugin.settings.workoutLogHeading)
        .onChange(async (value) => {
          this.plugin.settings.workoutLogHeading = value.trim() || DEFAULT_SETTINGS.workoutLogHeading;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Workout log target")
      .setDesc("Where ephemeral workout sessions and sets are stored. Daily note creates a parent workout bullet with nested set bullets; session note creates a standalone workout file; both writes both.")
      .addDropdown((dropdown) => dropdown
        .addOption("session-note", "Session note")
        .addOption("daily-note", "Daily note")
        .addOption("both", "Both")
        .setValue(this.plugin.settings.workoutLogTarget)
        .onChange(async (value) => {
          this.plugin.settings.workoutLogTarget = value as WorkoutLogTarget;
          await this.plugin.saveSettings();
        }));

    this.addSection(containerEl, "Food Logging", "Controls consumed-food instance logs and daily macro rollups.");
    new Setting(containerEl)
      .setName("Default food log section")
      .setDesc("Optional. Blank inserts food logs immediately after daily-note frontmatter.")
      .addText((text) => text
        .setPlaceholder("Food Log")
        .setValue(this.plugin.settings.defaultFoodLogSection)
        .onChange(async (value) => {
          this.plugin.settings.defaultFoodLogSection = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Food log file")
      .setDesc("Used when food log target is Single file.")
      .addText((text) => text
        .setPlaceholder("Health/Food Log.md")
        .setValue(this.plugin.settings.foodLogFilePath)
        .onChange(async (value) => {
          this.plugin.settings.foodLogFilePath = value.trim() || DEFAULT_SETTINGS.foodLogFilePath;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Automatic daily rollups")
      .setDesc("Recalculate calories and macros into daily note frontmatter after food is logged.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.automaticDailyRollups)
        .onChange(async (value) => {
          this.plugin.settings.automaticDailyRollups = value;
          await this.plugin.saveSettings();
        }));

    this.addSection(containerEl, "Data Sources", "Live database behavior for food search and barcode lookup.");
    new Setting(containerEl)
      .setName("Include branded search results")
      .setDesc("Off by default to reduce noisy database matches. Barcode lookup still checks Open Food Facts.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeBrandedFoodSearch)
        .onChange(async (value) => {
          this.plugin.settings.includeBrandedFoodSearch = value;
          await this.plugin.saveSettings();
        }));

    this.addSection(containerEl, "Goals & Overlays", "Goal definitions used by GCM metric rendering and daily frontmatter rollups.");
    new Setting(containerEl)
      .setName("Calorie goal")
      .setDesc("Used by GCM to render cal as a progress metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.calorieGoal))
        .onChange(async (value) => {
          this.plugin.settings.calorieGoal = positiveNumber(value, DEFAULT_SETTINGS.calorieGoal);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Protein goal g")
      .setDesc("Used by GCM to render protein as a progress metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.proteinGoalG))
        .onChange(async (value) => {
          this.plugin.settings.proteinGoalG = positiveNumber(value, DEFAULT_SETTINGS.proteinGoalG);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Activity goal minutes")
      .setDesc("Used by GCM to render activity as a progress metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.activityGoalMinutes))
        .onChange(async (value) => {
          this.plugin.settings.activityGoalMinutes = positiveNumber(value, DEFAULT_SETTINGS.activityGoalMinutes);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Health goals")
      .setDesc("One JSON goal per metric. kind can be min, max, range, or counter.")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.cols = 48;
        text
          .setValue(JSON.stringify(this.plugin.settings.healthGoals, null, 2))
          .onChange(async (value) => {
            try {
              const parsed = JSON.parse(value);
              if (!Array.isArray(parsed)) return;
              this.plugin.settings.healthGoals = parsed
                .map((goal) => ({
                  propertyKey: String(goal.propertyKey || "").trim(),
                  label: String(goal.label || goal.propertyKey || "").trim(),
                  unit: String(goal.unit || "").trim(),
                  kind: ["min", "max", "range", "counter"].includes(goal.kind) ? goal.kind : "counter",
                  min: numberOrUndefined(goal.min),
                  max: numberOrUndefined(goal.max),
                  color: typeof goal.color === "string" ? goal.color : undefined,
                }))
                .filter((goal) => goal.propertyKey && goal.label);
              await this.plugin.saveSettings();
            } catch {
              // Leave the last valid goal config in place while the user edits JSON.
            }
          });
      });

    this.addSection(containerEl, "External API Keys", "Optional credentials and client identification for remote nutrition databases.");
    new Setting(containerEl)
      .setName("Open Food Facts User-Agent")
      .setDesc("Open Food Facts asks API clients to identify themselves.")
      .addText((text) => text
        .setValue(this.plugin.settings.openFoodFactsUserAgent)
        .onChange(async (value) => {
          this.plugin.settings.openFoodFactsUserAgent = value.trim() || DEFAULT_SETTINGS.openFoodFactsUserAgent;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("USDA FoodData Central API key")
      .setDesc("Used for generic foods like apple, rice, eggs, and chicken. DEMO_KEY works for light testing.")
      .addText((text) => text
        .setValue(this.plugin.settings.usdaApiKey)
        .onChange(async (value) => {
          this.plugin.settings.usdaApiKey = value.trim() || DEFAULT_SETTINGS.usdaApiKey;
          await this.plugin.saveSettings();
        }));
  }

  private addSection(containerEl: HTMLElement, title: string, description: string): void {
    const section = containerEl.createDiv({ cls: "tps-health-settings-section" });
    section.createEl("h3", { text: title });
    section.createEl("p", { text: description });
  }
}

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
