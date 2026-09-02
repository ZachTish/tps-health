import { App, FuzzySuggestModal, PluginSettingTab, SecretComponent, Setting, TFolder, TextComponent } from "obsidian";
import * as logger from "./logger";
import TPSHealthPlugin from "./main";
import { applyBuiltInHealthGoalTargets, normalizeHealthGoalDefinition, normalizeUsdaApiKeySecrets } from "./settings-normalization";
import { DEFAULT_SETTINGS, FoodLogTarget, HealthEntityIdentificationMode, RestTimerMode, USDA_API_KEY_SECRET_MAX, WorkoutIntervalMode, WorkoutSetNotation } from "./types";
import { isValidWorkoutPropertyKey } from "./workout-properties";

type HealthSettingsPage = "daily" | "food-goals" | "workouts" | "library" | "integrations";
type OptionalDisclosureId = "custom-goals" | "templates" | "provider-credentials";
type LibraryFolderSettingKey = "workoutsFolder" | "workoutPlansFolder" | "exercisesFolder" | "foodsFolder" | "recipesFolder";

interface HealthSettingsDestination {
  id: HealthSettingsPage;
  label: string;
  description: string;
}

const HEALTH_SETTINGS_DESTINATIONS: HealthSettingsDestination[] = [
  {
    id: "daily",
    label: "Daily logging",
    description: "Daily notes and food-log storage",
  },
  {
    id: "food-goals",
    label: "Food & goals",
    description: "Nutrition search and daily targets",
  },
  {
    id: "workouts",
    label: "Workouts",
    description: "Workout storage and session defaults",
  },
  {
    id: "library",
    label: "Note library",
    description: "Folders, identification, tags, and templates",
  },
  {
    id: "integrations",
    label: "Integrations & advanced",
    description: "GCM, providers, credentials, and diagnostics",
  },
];

const createSettingsGroup = (
  parent: HTMLElement,
  title: string,
  description?: string,
): HTMLElement => {
  const section = parent.createEl("section", { cls: "tps-health-settings-group" });
  section.createEl("h4", { cls: "tps-health-settings-group-title", text: title });
  if (description) {
    section.createEl("p", {
      cls: "tps-health-settings-group-description",
      text: description,
    });
  }
  return section.createDiv({ cls: "tps-health-settings-group-content" });
};

class HealthFolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly onChooseFolder: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder("Choose a vault folder");
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles()
      .filter((entry): entry is TFolder => entry instanceof TFolder && Boolean(entry.path.replace(/^\/+|\/+$/g, "")))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChooseFolder(folder);
  }
}

export class TPSHealthSettingTab extends PluginSettingTab {
  plugin: TPSHealthPlugin;
  private activeSettingsPage: HealthSettingsPage = "daily";
  private readonly disclosureState = new Map<OptionalDisclosureId, boolean>();

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
      text: "Choose one area below. Only that settings page is shown, while reusable foods, exercises, and workout plans remain ordinary notes.",
    });

    this.renderSettingsHub(containerEl);
    this.renderActiveSettingsPage(containerEl);
  }

  private renderSettingsHub(container: HTMLElement): void {
    const hub = container.createDiv({ cls: "tps-health-settings-hub" });
    hub.createEl("h3", {
      cls: "tps-health-settings-hub-heading",
      text: "Choose what to configure",
    });
    const buttons = hub.createDiv({ cls: "tps-health-settings-route-grid" });
    buttons.setAttr("role", "group");
    buttons.setAttr("aria-label", "TPS Health settings pages");

    for (const destination of HEALTH_SETTINGS_DESTINATIONS) {
      const active = destination.id === this.activeSettingsPage;
      const button = buttons.createEl("button", {
        cls: "tps-health-settings-route-button",
        attr: {
          type: "button",
          "aria-pressed": active ? "true" : "false",
        },
      });
      button.dataset.tpsHealthSettingsRoute = destination.id;
      button.createSpan({
        cls: "tps-health-settings-route-title",
        text: destination.label,
      });
      button.createSpan({
        cls: "tps-health-settings-route-summary",
        text: this.settingsPageSummary(destination.id),
      });
      button.createSpan({
        cls: "tps-health-settings-route-description",
        text: destination.description,
      });
      button.addEventListener("click", () => {
        if (this.activeSettingsPage === destination.id) return;
        this.navigateToSettingsPage(destination.id);
      });
    }
  }

  private settingsPageSummary(page: HealthSettingsPage): string {
    switch (page) {
      case "daily":
        return "Daily note · food log";
      case "food-goals":
        return "Search · nutrition targets";
      case "workouts":
        return "Sessions · rest · sets";
      case "library":
        return "Folders · identification · templates";
      case "integrations":
        return "GCM · AI · providers";
    }
  }

  private renderActiveSettingsPage(container: HTMLElement): void {
    const destination = HEALTH_SETTINGS_DESTINATIONS.find(({ id }) => id === this.activeSettingsPage)
      ?? HEALTH_SETTINGS_DESTINATIONS[0];
    const page = container.createEl("section", {
      cls: "tps-health-settings-page",
      attr: {
        id: `tps-health-settings-page-${destination.id}`,
        "data-tps-health-settings-page": destination.id,
        "aria-labelledby": `tps-health-settings-page-${destination.id}-title`,
      },
    });
    page.createEl("h3", {
      cls: "tps-health-settings-page-title",
      text: destination.label,
      attr: {
        id: `tps-health-settings-page-${destination.id}-title`,
        tabindex: "-1",
      },
    });
    page.createEl("p", {
      cls: "tps-health-settings-page-description",
      text: destination.description,
    });

    switch (destination.id) {
      case "daily":
        this.renderDailyLoggingPage(page);
        break;
      case "food-goals":
        this.renderFoodGoalsPage(page);
        break;
      case "workouts":
        this.renderWorkoutsPage(page);
        break;
      case "library":
        this.renderNoteLibraryPage(page);
        break;
      case "integrations":
        this.renderIntegrationsPage(page);
        break;
    }
  }

  private navigateToSettingsPage(page: HealthSettingsPage): void {
    this.activeSettingsPage = page;
    this.display();
    this.containerEl.scrollTop = 0;
    window.requestAnimationFrame(() => {
      this.containerEl
        .querySelector<HTMLElement>('button.tps-health-settings-route-button[aria-pressed="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const pageTitle = this.containerEl.querySelector<HTMLElement>(".tps-health-settings-page-title");
      pageTitle?.focus({ preventScroll: true });
      pageTitle?.scrollIntoView({ block: "start" });
    });
  }

  private redisplayPreservingContext(focusSelector?: string): void {
    const scrollTop = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = scrollTop;
    const fallbackSelector = `.tps-health-settings-route-button[data-tps-health-settings-route="${this.activeSettingsPage}"]`;
    const focusTarget = focusSelector
      ? this.containerEl.querySelector<HTMLElement>(focusSelector)
      : null;
    (focusTarget ?? this.containerEl.querySelector<HTMLElement>(fallbackSelector))
      ?.focus({ preventScroll: true });
    this.containerEl.scrollTop = scrollTop;
  }

  private createOptionalDisclosure(
    parent: HTMLElement,
    id: OptionalDisclosureId,
    title: string,
    description: string,
  ): HTMLElement {
    const details = parent.createEl("details", { cls: "tps-health-settings-disclosure" });
    details.dataset.tpsHealthSettingsDisclosure = id;
    details.open = this.disclosureState.get(id) ?? false;
    details.addEventListener("toggle", () => {
      this.disclosureState.set(id, details.open);
    });

    const summary = details.createEl("summary", { cls: "tps-health-settings-disclosure-summary" });
    summary.createSpan({ cls: "tps-health-settings-disclosure-title", text: title });
    details.createEl("p", {
      cls: "tps-health-settings-disclosure-description",
      text: description,
    });
    return details.createDiv({ cls: "tps-health-settings-disclosure-content" });
  }

  private renderDailyLoggingPage(page: HTMLElement): void {
    const architecture = createSettingsGroup(
      page,
      "Data architecture",
      "Choose where completed Health logs are stored. Existing content is never migrated or deleted automatically.",
    );
    new Setting(architecture)
      .setName("Health storage")
      .setDesc("Native records writes one atomic Markdown note per food, activity, or workout. TPS Global Context Menu nativeRecords API v6 owns the note's single tpsId and readable filename. Reload after changing this setting.")
      .addDropdown((dropdown) => dropdown
        .addOption("legacy", "Legacy Daily Note/body logs")
        .addOption("native-records", "Native TPS records")
        .setValue(this.plugin.settings.storageMode)
        .onChange(async (value) => {
          this.plugin.settings.storageMode = value === "native-records" ? "native-records" : "legacy";
          await this.plugin.saveSettings();
        }));

    const dailyNotes = createSettingsGroup(
      page,
      "Daily notes",
      "TPS Health follows Obsidian's Core Daily Notes location and filename format.",
    );
    new Setting(dailyNotes)
      .setName("Daily Notes source")
      .setDesc("Folder and date format come from Obsidian → Core plugins → Daily notes. Change them there and TPS Health will use the new values automatically.")
      .addButton((button) => button
        .setButtonText("Open Daily Notes settings")
        .onClick(() => {
          const setting = (this.app as any).setting;
          setting?.open?.();
          setting?.openTabById?.("daily-notes");
        }));

    const foodLogging = createSettingsGroup(
      page,
      "Food log storage",
      "Where consumed-food rows are written and how daily totals are maintained.",
    );
    const foodLogTarget = new Setting(foodLogging)
      .setName("Food log target")
      .setDesc("Where consumed-food instance lines are written. Single file keeps all food logs together and links each entry to its scheduled daily note.")
      .addDropdown((dropdown) => dropdown
        .addOption("daily-note", "Daily note")
        .addOption("single-file", "Single file")
        .setValue(this.plugin.settings.foodLogTarget)
        .onChange(async (value) => {
          this.plugin.settings.foodLogTarget = value as FoodLogTarget;
          await this.plugin.saveSettings();
          this.redisplayPreservingContext("[data-tps-health-food-log-target] select");
        }));
    foodLogTarget.settingEl.dataset.tpsHealthFoodLogTarget = "true";

    if (this.plugin.settings.foodLogTarget === "single-file") {
      new Setting(foodLogging)
        .setName("Food log file")
        .setDesc("Canonical file used for all consumed-food instance lines.")
        .addText((text) => text
          .setPlaceholder("Health/Food Log.md")
          .setValue(this.plugin.settings.foodLogFilePath)
          .onChange(async (value) => {
            this.plugin.settings.foodLogFilePath = value.trim() || DEFAULT_SETTINGS.foodLogFilePath;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(foodLogging)
      .setName("Default food log section")
      .setDesc("Optional. Blank inserts food logs immediately after daily-note frontmatter.")
      .addText((text) => text
        .setPlaceholder("Food Log")
        .setValue(this.plugin.settings.defaultFoodLogSection)
        .onChange(async (value) => {
          this.plugin.settings.defaultFoodLogSection = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(foodLogging)
      .setName("Automatic daily rollups")
      .setDesc("Recalculate calories and macros into daily note frontmatter after food is logged.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.automaticDailyRollups)
        .onChange(async (value) => {
          this.plugin.settings.automaticDailyRollups = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderFoodGoalsPage(page: HTMLElement): void {
    const nutrition = createSettingsGroup(
      page,
      "Nutrition search",
      "Live database behavior for food search and barcode lookup.",
    );
    new Setting(nutrition)
      .setName("Include branded search results")
      .setDesc("Searches branded provider databases for packaged grocery foods. Ranking and broad-query filters control noisy matches.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeBrandedFoodSearch)
        .onChange(async (value) => {
          this.plugin.settings.includeBrandedFoodSearch = value;
          await this.plugin.saveSettings();
        }));

    const goals = createSettingsGroup(
      page,
      "Daily goals",
      "Canonical targets used by GCM metric rendering and daily frontmatter rollups.",
    );
    new Setting(goals)
      .setName("Calorie goal")
      .setDesc("Canonical maximum used by GCM for the built-in consumed-calories metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.calorieGoal))
        .onChange(async (value) => {
          await this.plugin.updateBuiltInHealthGoalTarget("calorieGoal", positiveNumber(value, DEFAULT_SETTINGS.calorieGoal));
        }));

    new Setting(goals)
      .setName("Protein goal g")
      .setDesc("Canonical minimum used by GCM for the built-in protein metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.proteinGoalG))
        .onChange(async (value) => {
          await this.plugin.updateBuiltInHealthGoalTarget("proteinGoalG", positiveNumber(value, DEFAULT_SETTINGS.proteinGoalG));
        }));

    new Setting(goals)
      .setName("Activity goal minutes")
      .setDesc("Canonical minimum used by GCM for the built-in activity metric.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.activityGoalMinutes))
        .onChange(async (value) => {
          await this.plugin.updateBuiltInHealthGoalTarget("activityGoalMinutes", positiveNumber(value, DEFAULT_SETTINGS.activityGoalMinutes));
        }));

    const customGoals = this.createOptionalDisclosure(
      page,
      "custom-goals",
      "Custom goal JSON",
      "Optional labels, colors, ranges, and additional metrics. The scalar goals above remain canonical for calories, protein, and activity.",
    );
    new Setting(customGoals)
      .setName("Health goals")
      .setDesc("One JSON goal per metric. Built-in calorie, protein, and activity target bounds come from the canonical fields above; use this JSON for labels, colors, ranges, and additional metrics.")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.addClass("tps-health-settings-json");
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
  }

  private renderWorkoutsPage(page: HTMLElement): void {
    const storage = createSettingsGroup(
      page,
      "Workout placement",
      "Every workout gets a live section in its Core Daily Note. A dedicated workout note is optional.",
    );
    new Setting(storage)
      .setName("Also create a dedicated workout note")
      .setDesc("Keeps a separate workout file in addition to the live Daily Note section.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.workoutLogTarget !== "daily-note")
        .onChange(async (value) => {
          this.plugin.settings.workoutLogTarget = value ? "both" : "daily-note";
          await this.plugin.saveSettings();
        }));

    new Setting(storage)
      .setName("Workout position in Daily Note")
      .setDesc("Choose where a new workout heading and its live controls are inserted.")
      .addDropdown((dropdown) => dropdown
        .addOption("after-frontmatter", "Top, after properties")
        .addOption("before-first-h2", "Above the first level-2 heading")
        .addOption("bottom", "Bottom of note")
        .setValue(this.plugin.settings.workoutDailyNotePlacement)
        .onChange(async (value) => {
          this.plugin.settings.workoutDailyNotePlacement = value as typeof this.plugin.settings.workoutDailyNotePlacement;
          await this.plugin.saveSettings();
        }));

    const calendarProperties = createSettingsGroup(
      page,
      "Calendar properties",
      "Choose the two frontmatter properties that represent a workout on a calendar. New sessions use this mapping; the next edit to a session with standard legacy timing aliases migrates them without keeping duplicate temporal fields.",
    );
    const addWorkoutPropertyKey = (
      name: string,
      description: string,
      settingKey: "workoutStartPropertyKey" | "workoutIntervalPropertyKey",
    ) => {
      const setting = new Setting(calendarProperties).setName(name).setDesc(description);
      setting.addText((text) => {
        const commit = async () => {
          const value = text.getValue().trim();
          const other = settingKey === "workoutStartPropertyKey"
            ? this.plugin.settings.workoutIntervalPropertyKey
            : this.plugin.settings.workoutStartPropertyKey;
          if (!isValidWorkoutPropertyKey(value) || value.toLocaleLowerCase() === other.toLocaleLowerCase()) {
            text.setValue(this.plugin.settings[settingKey]);
            return;
          }
          this.plugin.settings[settingKey] = value;
          await this.plugin.saveSettings();
          logger.flow("Settings", "workout-calendar-property:changed", { settingKey, propertyKey: value });
        };
        text.setValue(this.plugin.settings[settingKey]);
        text.inputEl.dataset.tpsHealthWorkoutProperty = settingKey;
        text.inputEl.addEventListener("change", () => void commit());
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          text.inputEl.blur();
        });
      });
    };
    addWorkoutPropertyKey(
      "Workout start property",
      "Datetime key used to place the workout on a calendar. The default is scheduled.",
      "workoutStartPropertyKey",
    );
    new Setting(calendarProperties)
      .setName("Workout interval style")
      .setDesc("Store either one numeric duration in minutes or one ending datetime. Only the selected interval property is written.")
      .addDropdown((dropdown) => dropdown
        .addOption("duration", "Duration in minutes")
        .addOption("end", "Ending datetime")
        .setValue(this.plugin.settings.workoutIntervalMode)
        .onChange(async (value) => {
          this.plugin.settings.workoutIntervalMode = value as WorkoutIntervalMode;
          await this.plugin.saveSettings();
          logger.flow("Settings", "workout-calendar-interval:changed", { mode: value });
        }));
    addWorkoutPropertyKey(
      "Workout interval property",
      "Numeric minutes in duration mode or a datetime in ending-time mode. The default is timeEstimate.",
      "workoutIntervalPropertyKey",
    );

    const sessionDefaults = createSettingsGroup(
      page,
      "Session defaults",
      "Rest timing, notation, and cooldown defaults used by new sessions and workout plans.",
    );
    new Setting(sessionDefaults)
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

    new Setting(sessionDefaults)
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

    new Setting(sessionDefaults)
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

    new Setting(sessionDefaults)
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
  }

  private renderNoteLibraryPage(page: HTMLElement): void {
    const folders = createSettingsGroup(
      page,
      "Reusable note folders",
      "Stable health entities live in these destinations and can be linked from daily logs. Enter / to write directly to the vault root.",
    );
    this.addLibraryFolderSetting(folders, "workoutsFolder", "Workouts destination", "Canonical workout notes created by Start workout. Existing notes are not moved.");
    this.addLibraryFolderSetting(folders, "workoutPlansFolder", "Workout plans destination", "Reusable workout/routine notes. Session logs stay in the workouts destination. Existing notes are not moved.");
    this.addLibraryFolderSetting(folders, "exercisesFolder", "Exercises destination", "New exercise notes are created here. Existing exercise notes remain where they are.");
    this.addLibraryFolderSetting(folders, "foodsFolder", "Foods destination", "New food notes are created here. Recipes and meals use their separate destination. Existing food notes remain where they are.");
    this.addLibraryFolderSetting(folders, "recipesFolder", "Recipes destination", "New recipe and meal notes are created here. Existing notes are not moved.");

    const identification = createSettingsGroup(
      page,
      "Identification & tags",
      "Choose how reusable notes are recognized and which tags TPS Health writes to new notes.",
    );
    new Setting(identification)
      .setName("Food note identification")
      .setDesc("Controls both how foods, meals, and recipes are recognized and which identity fields TPS Health writes.")
      .addDropdown((dropdown) => {
        dropdown.selectEl.dataset.tpsHealthFoodIdentification = "true";
        return dropdown
          .addOption("metadata-folder-tag", "Frontmatter, folder, or tag")
          .addOption("folder", "Folders only")
          .addOption("tag", "Tags only")
          .addOption("metadata", "Frontmatter only")
          .setValue(this.plugin.settings.foodIdentificationMode)
          .onChange(async (value) => {
            this.plugin.settings.foodIdentificationMode = value as HealthEntityIdentificationMode;
            await this.plugin.saveSettings();
            this.redisplayPreservingContext("[data-tps-health-food-identification]");
          });
      });

    if (this.plugin.settings.foodIdentificationMode === "metadata" || this.plugin.settings.foodIdentificationMode === "metadata-folder-tag") {
      new Setting(identification)
        .setName("Food frontmatter key")
        .setDesc("Property used to identify foods, recipes, and meals. Letters, numbers, underscores, and hyphens are supported.")
        .addText((text) => text
          .setPlaceholder(DEFAULT_SETTINGS.foodFrontmatterKey)
          .setValue(this.plugin.settings.foodFrontmatterKey)
          .onChange(async (value) => {
            const key = value.trim();
            if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return;
            this.plugin.settings.foodFrontmatterKey = key;
            await this.plugin.saveSettings();
          }));

      const addIdentifierValue = (
        label: string,
        currentValue: string,
        fallback: string,
        save: (value: string) => Promise<void>,
      ) => {
        new Setting(identification)
          .setName(label)
          .setDesc(`Value written to ${this.plugin.settings.foodFrontmatterKey} for ${label.replace(" value", "").toLowerCase()} notes.`)
          .addText((text) => text
            .setPlaceholder(fallback)
            .setValue(currentValue)
            .onChange((value) => save(value.trim() || fallback)));
      };
      addIdentifierValue("Food value", this.plugin.settings.foodFrontmatterFoodValue, DEFAULT_SETTINGS.foodFrontmatterFoodValue, async (value) => {
        this.plugin.settings.foodFrontmatterFoodValue = value;
        await this.plugin.saveSettings();
      });
      addIdentifierValue("Recipe value", this.plugin.settings.foodFrontmatterRecipeValue, DEFAULT_SETTINGS.foodFrontmatterRecipeValue, async (value) => {
        this.plugin.settings.foodFrontmatterRecipeValue = value;
        await this.plugin.saveSettings();
      });
      addIdentifierValue("Meal value", this.plugin.settings.foodFrontmatterMealValue, DEFAULT_SETTINGS.foodFrontmatterMealValue, async (value) => {
        this.plugin.settings.foodFrontmatterMealValue = value;
        await this.plugin.saveSettings();
      });
    }

    new Setting(identification)
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

    new Setting(identification)
      .setName("Workout tag")
      .setDesc("Used when workout identification includes tags. Blank disables this identity signal.")
      .addText((text) => text
      .setValue(this.plugin.settings.workoutTag)
        .onChange(async (value) => {
          this.plugin.settings.workoutTag = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(identification)
      .setName("Exercise tag")
      .setDesc("Used to recognize reusable exercise notes. Blank disables this identity signal.")
      .addText((text) => text
      .setValue(this.plugin.settings.exerciseTag)
        .onChange(async (value) => {
          this.plugin.settings.exerciseTag = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(identification)
      .setName("Food tag")
      .setDesc("Used when food identification includes tags. Blank disables this identity signal.")
      .addText((text) => text
      .setValue(this.plugin.settings.customFoodTag)
        .onChange(async (value) => {
          this.plugin.settings.customFoodTag = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(identification)
      .setName("Recipe/meal tag")
      .setDesc("Used when food identification includes tags. Blank disables this identity signal.")
      .addText((text) => text
      .setValue(this.plugin.settings.recipeTag)
        .onChange(async (value) => {
          this.plugin.settings.recipeTag = value.trim();
          await this.plugin.saveSettings();
        }));

    const templates = this.createOptionalDisclosure(
      page,
      "templates",
      "Templates",
      "Optional note templates used when TPS Health creates reusable notes or workout sessions.",
    );
    new Setting(templates)
      .setName("Workout template path")
      .setDesc("Optional note used when creating a workout session file. Supports {{title}}, {{startedAt}}, {{workoutPlanPath}}, and {{cooldownDays}}.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.workoutTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(templates)
      .setName("Workout plan template path")
      .setDesc("Optional note used when creating a reusable workout plan. Supports {{name}}, {{cooldownDays}}, {{defaultRestSeconds}}, and {{notes}}.")
      .addText((text) => text
        .setValue(this.plugin.settings.workoutPlanTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.workoutPlanTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(templates)
      .setName("Exercise template path")
      .setDesc("Optional note used when creating exercises from logged sets. Supports {{name}}, {{category}}, {{defaultRestSeconds}}, and muscle/equipment placeholders.")
      .addText((text) => text
        .setValue(this.plugin.settings.exerciseTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.exerciseTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(templates)
      .setName("Food template path")
      .setDesc("Optional note used when creating a food file. Supports {{name}}, {{brand}}, {{servingGrams}}, {{servingMl}}, and nutrient placeholders.")
      .addText((text) => text
        .setValue(this.plugin.settings.foodTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.foodTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));
  }

  private addLibraryFolderSetting(
    parent: HTMLElement,
    key: LibraryFolderSettingKey,
    name: string,
    description: string,
  ): void {
    let input!: TextComponent;
    let committedValue = this.plugin.settings[key];
    const fallback = DEFAULT_SETTINGS[key];
    const commit = async (rawValue: string): Promise<void> => {
      const candidate = rawValue.trim() || fallback;
      if (candidate === committedValue) {
        input.setValue(committedValue);
        return;
      }
      committedValue = candidate;
      this.plugin.settings[key] = candidate;
      await this.plugin.saveSettings();
      committedValue = this.plugin.settings[key];
      input.setValue(committedValue);
      logger.flow("Settings", "library-folder:changed", { key, path: committedValue });
    };

    const setting = new Setting(parent)
      .setName(name)
      .setDesc(`${description} Type a new vault-relative path or choose an existing folder.`)
      .addText((text) => {
        input = text;
        text.inputEl.dataset.tpsHealthLibraryFolder = key;
        text.setValue(committedValue);
        text.inputEl.addEventListener("change", () => void commit(text.getValue()));
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void commit(text.getValue());
          text.inputEl.blur();
        });
      });
    setting.addExtraButton((button) => button
      .setIcon("folder-search")
      .setTooltip(`Choose ${name.toLowerCase()}`)
      .onClick(() => {
        new HealthFolderSuggestModal(this.app, (folder) => void commit(folder.path)).open();
      }));
  }

  private renderIntegrationsPage(page: HTMLElement): void {
    const gcm = createSettingsGroup(
      page,
      "TPS Global Context Menu",
      "Optional health controls shown on the shared note-action surface.",
    );
    new Setting(gcm)
      .setName("Show food log button in GCM")
      .setDesc("Adds the Log food action to TPS Global Context Menu only when the active note exactly matches the Core Daily Notes folder and filename format.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showFoodLogButtonInGcm)
        .onChange(async (value) => {
          this.plugin.settings.showFoodLogButtonInGcm = value;
          await this.plugin.saveSettings();
          this.plugin.refreshGcmFoodLogButtonRegistration();
        }));

    const aiGateway = createSettingsGroup(
      page,
      "TPS AI Gateway",
      "Central ownership for AI providers, models, fallback order, and AI diagnostics.",
    );
    new Setting(aiGateway)
      .setName("AI-assisted Describe")
      .setDesc("Open AI Gateway settings to configure providers. Describe falls back to deterministic local matching when the gateway is unavailable.")
      .addButton((button) => button
        .setButtonText("Open AI Gateway settings")
        .onClick(() => this.openPluginSettings("tps-ai-gateway")));

    const providerCredentials = this.createOptionalDisclosure(
      page,
      "provider-credentials",
      "Provider credentials",
      "Optional Open Food Facts client identification and ordered USDA SecretStorage references.",
    );
    this.renderProviderCredentials(providerCredentials);

    const diagnostics = createSettingsGroup(
      page,
      "Diagnostics",
      "Concise development logs for tracing health flows in the developer console.",
    );
    new Setting(diagnostics)
      .setName("Enable debug logging")
      .setDesc("Logs health API, food, workout, barcode, base, and rollup flow checkpoints. Errors are always logged.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableLogging)
        .onChange(async (value) => {
          this.plugin.settings.enableLogging = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderProviderCredentials(section: HTMLElement): void {
    new Setting(section)
      .setName("Open Food Facts User-Agent")
      .setDesc("Open Food Facts asks API clients to identify themselves.")
      .addText((text) => text
        .setValue(this.plugin.settings.openFoodFactsUserAgent)
        .onChange(async (value) => {
          this.plugin.settings.openFoodFactsUserAgent = value.trim() || DEFAULT_SETTINGS.openFoodFactsUserAgent;
          await this.plugin.saveSettings();
        }));

    section.createEl("p", {
      cls: "setting-item-description",
      text: "USDA credentials are tried in order only when a device secret is empty or USDA returns API_KEY_MISSING/API_KEY_INVALID. Disabled, unverified, unauthorized, generic 403, and HTTP 429 responses do not rotate; TPS Health surfaces the error or waits for Retry-After.",
    });

    for (const [index, reference] of this.plugin.settings.usdaApiKeySecrets.entries()) {
      const label = index === 0 ? "USDA API key — Primary" : `USDA API key — Fallback ${index}`;
      const setting = new Setting(section)
        .setName(label)
        .setDesc(index === 0
          ? "First populated device-local Obsidian secret used for FoodData Central."
          : "Used only after an earlier device secret is empty or receives API_KEY_MISSING/API_KEY_INVALID.")
        .addComponent((element) => {
          element.dataset.tpsHealthUsdaSecretIndex = String(index);
          return new SecretComponent(this.plugin.app, element)
            .setValue(reference)
            .onChange(async (value) => {
              const references = [...this.plugin.settings.usdaApiKeySecrets];
              references[index] = value;
              this.plugin.settings.usdaApiKeySecrets = normalizeUsdaApiKeySecrets(references);
              await this.plugin.saveSettings();
              this.disclosureState.set("provider-credentials", true);
              const nextIndex = Math.min(index, Math.max(0, this.plugin.settings.usdaApiKeySecrets.length - 1));
              this.redisplayPreservingContext(
                this.plugin.settings.usdaApiKeySecrets.length
                  ? this.usdaSecretFocusSelector(nextIndex)
                  : "[data-tps-health-usda-add] button",
              );
            });
        });

      if (index > 0) {
        setting.addExtraButton((button) => {
          button.extraSettingsEl.dataset.tpsHealthUsdaAction = "move-up";
          button
            .setIcon("arrow-up")
            .setTooltip("Move USDA key earlier")
            .onClick(async () => {
              const references = [...this.plugin.settings.usdaApiKeySecrets];
              [references[index - 1], references[index]] = [references[index], references[index - 1]];
              this.plugin.settings.usdaApiKeySecrets = references;
              await this.plugin.saveSettings();
              this.disclosureState.set("provider-credentials", true);
              this.redisplayPreservingContext(this.usdaSecretFocusSelector(index - 1));
            });
        });
      }

      if (index < this.plugin.settings.usdaApiKeySecrets.length - 1) {
        setting.addExtraButton((button) => {
          button.extraSettingsEl.dataset.tpsHealthUsdaAction = "move-down";
          button
            .setIcon("arrow-down")
            .setTooltip("Move USDA key later")
            .onClick(async () => {
              const references = [...this.plugin.settings.usdaApiKeySecrets];
              [references[index], references[index + 1]] = [references[index + 1], references[index]];
              this.plugin.settings.usdaApiKeySecrets = references;
              await this.plugin.saveSettings();
              this.disclosureState.set("provider-credentials", true);
              this.redisplayPreservingContext(this.usdaSecretFocusSelector(index + 1));
            });
        });
      }

      setting.addExtraButton((button) => {
        button.extraSettingsEl.dataset.tpsHealthUsdaAction = "remove";
        button
          .setIcon("trash")
          .setTooltip("Remove USDA key reference")
          .onClick(async () => {
            this.plugin.settings.usdaApiKeySecrets = this.plugin.settings.usdaApiKeySecrets.filter((_entry, entryIndex) => entryIndex !== index);
            await this.plugin.saveSettings();
            this.disclosureState.set("provider-credentials", true);
            const remaining = this.plugin.settings.usdaApiKeySecrets.length;
            this.redisplayPreservingContext(
              remaining
                ? this.usdaSecretFocusSelector(Math.min(index, remaining - 1))
                : "[data-tps-health-usda-add] button",
            );
          });
      });
    }

    if (this.plugin.settings.usdaApiKeySecrets.length < USDA_API_KEY_SECRET_MAX) {
      const addSetting = new Setting(section)
        .setName(this.plugin.settings.usdaApiKeySecrets.length ? "Add USDA fallback" : "Add USDA API key")
        .setDesc(`Up to ${USDA_API_KEY_SECRET_MAX} ordered SecretStorage references. If none contain a value, TPS Health uses DEMO_KEY.`)
        .addButton((button) => {
          button.buttonEl.dataset.tpsHealthUsdaAction = "add";
          button
            .setButtonText("Add secret")
            .onClick(() => {
              const index = this.plugin.settings.usdaApiKeySecrets.length;
              this.plugin.settings.usdaApiKeySecrets = [...this.plugin.settings.usdaApiKeySecrets, ""];
              this.disclosureState.set("provider-credentials", true);
              this.redisplayPreservingContext(this.usdaSecretFocusSelector(index));
            });
        });
      addSetting.settingEl.dataset.tpsHealthUsdaAdd = "true";
    }

  }

  private usdaSecretFocusSelector(index: number): string {
    return `[data-tps-health-usda-secret-index="${index}"] input`;
  }

  private openPluginSettings(pluginId: string): void {
    const settings = (this.app as any).setting;
    settings?.open?.();
    settings?.openTabById?.(pluginId);
  }
}

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
