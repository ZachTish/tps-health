import { nativeSettingsSearch, focusSettingsSearchResult, type SettingsSearchEntry } from "./native-settings-search";
import { SETTINGS_SEARCH_ENTRIES, SETTINGS_SEARCH_ROUTES } from "./settings-search-catalog";
import type { HealthMappingScope } from "./health-mapping";
import { changeHealthMapping } from "./health-mapping-migration";
import { renderEnergySettings } from "./energy-settings";
import { renderNutrientGoalSettings } from "./nutrient-goal-settings";
import { renderCustomNutrientSettings } from "./custom-nutrient-settings";
import { HealthConnectionSettings } from "./connection-settings";
import { BUILT_IN_NUTRIENTS as EXTRA_NUTRIENTS } from "./nutrients";
import { App, Notice, FuzzySuggestModal, PluginSettingTab, Setting, TFolder, TextComponent } from "obsidian";
import * as logger from "./logger";
import TPSHealthPlugin from "./main";
import { DEFAULT_SETTINGS, HealthEntityIdentificationMode, HealthNativeRecordKindKey, HealthNativeRecordPropertyKey, TPSHealthSettings, RestTimerMode, WorkoutControlPlacement, WorkoutIntervalMode } from "./types";
import { isValidWorkoutPropertyKey } from "./workout-properties";
import {
  DEFAULT_HEALTH_NATIVE_RECORD_KINDS,
  DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES,
  isValidFrontmatterPropertyKey,
  isValidNativeRecordKindValue,
} from "./native-record-schema";

type HealthSettingsPage = "daily" | "food-goals" | "workouts" | "library" | "integrations";
type OptionalDisclosureId = "custom-goals" | "templates" | "native-frontmatter" | "earlier-logs";
type LibraryFolderSettingKey = "workoutsFolder" | "workoutPlansFolder" | "exercisesFolder" | "foodsFolder" | "recipesFolder";

interface HealthSettingsDestination {
  id: HealthSettingsPage;
  label: string;
}

const HEALTH_SETTINGS_DESTINATIONS: HealthSettingsDestination[] = [
  {
    id: "daily",
    label: "Daily logging",
  },
  {
    id: "food-goals",
    label: "Food & goals",
  },
  {
    id: "workouts",
    label: "Workouts",
  },
  {
    id: "library",
    label: "Note library",
  },
  {
    id: "integrations",
    label: "Integrations & advanced",
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
  private searchContentEl: HTMLElement | null = null;
  private get settingsContentEl(): HTMLElement {
    return this.searchContentEl?.isConnected ? this.searchContentEl : this.containerEl;
  }

  getSettingDefinitions() {
    const nutrientFields: SettingsSearchEntry[] = EXTRA_NUTRIENTS.map(nutrient => ({
      name: `${nutrient.label} (${nutrient.unit})`, desc: 'Health property name mapping.',
      aliases: [nutrient.key], key: nutrient.key, route: 'integrations',
    }));
    return nativeSettingsSearch([...SETTINGS_SEARCH_ENTRIES, ...nutrientFields], SETTINGS_SEARCH_ROUTES,
      container => {
        this.searchContentEl = container;
        this.display();
        return () => { this.hide(); if (this.searchContentEl === container) this.searchContentEl = null; };
      }, entry => this.openSearchResult(entry));
  }

  private openSearchResult(entry: SettingsSearchEntry): void {
    this.activeSettingsPage = entry.route as HealthSettingsPage;
    if (entry.key && entry.key in DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES) {
      this.activeNativePropertyKey = entry.key as HealthNativeRecordPropertyKey;
      this.disclosureState.set('native-frontmatter', true);
    }
    const manager = (this.app as App & { setting?: { openTabById?: (id: string) => void } }).setting;
    manager?.openTabById?.(this.plugin.manifest.id);
    this.display();
    if (!focusSettingsSearchResult(this.settingsContentEl, entry.name)) {
      const message = this.settingsContentEl.createDiv({
        text: `“${entry.name}” is in this area. Its control appears when the relevant feature or saved item is selected.`,
        attr: { role: 'status', tabindex: '-1' },
      });
      this.settingsContentEl.prepend(message);
      message.focus();
      message.scrollIntoView({ block: 'start' });
    }
  }

  plugin: TPSHealthPlugin;
  private activeSettingsPage: HealthSettingsPage = "daily";
  private activeNativePropertyKey: HealthNativeRecordPropertyKey = "completedDate";
  private readonly disclosureState = new Map<OptionalDisclosureId, boolean>();
  private foodConnections: HealthConnectionSettings | null = null;

  constructor(app: App, plugin: TPSHealthPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.hide();
    const containerEl = this.settingsContentEl;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TPS Health" });

    this.renderSettingsHub(containerEl);
    this.renderActiveSettingsPage(containerEl);
  }

  hide(): void {
    this.foodConnections?.dispose();
    this.foodConnections = null;
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
      button.addEventListener("click", () => {
        if (this.activeSettingsPage === destination.id) return;
        this.navigateToSettingsPage(destination.id);
      });
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
      this.settingsContentEl
        .querySelector<HTMLElement>('button.tps-health-settings-route-button[aria-pressed="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const pageTitle = this.settingsContentEl.querySelector<HTMLElement>(".tps-health-settings-page-title");
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
      ? this.settingsContentEl.querySelector<HTMLElement>(focusSelector)
      : null;
    (focusTarget ?? this.settingsContentEl.querySelector<HTMLElement>(fallbackSelector))
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
    const appearance = createSettingsGroup(page, "Optional Health blocks", "Appearance of embedded Health blocks. Your Bases and Canvas control their own layout and columns.");
    new Setting(appearance).setName("Macros block").addDropdown(dropdown => dropdown
      .addOption("rings", "Rings").addOption("table", "Rows")
      .setValue(this.plugin.settings.macroBlockStyle)
      .onChange(async value => {
        this.plugin.settings.macroBlockStyle = value === "table" ? "table" : "rings";
        await this.plugin.saveSettings();
        this.plugin.app.workspace.trigger("tps-health:appearance-changed");
      }));
    new Setting(appearance).setName("Nutrient rows").setDesc("Choose which nutrients appear in primary totals and lower bars under Food & goals → Nutrient targets.").addDropdown(dropdown => dropdown
      .addOption("collapsed", "Collapsed").addOption("expanded", "Expanded").addOption("hidden", "Hidden")
      .setValue(this.plugin.settings.macroNutrientRows)
      .onChange(async value => {
        this.plugin.settings.macroNutrientRows = value as "collapsed" | "expanded" | "hidden";
        await this.plugin.saveSettings();
        this.plugin.app.workspace.trigger("tps-health:appearance-changed");
      }));
    const dailyNotes = createSettingsGroup(page, "Daily notes");
    new Setting(dailyNotes)
      .setName("Show food log button in GCM")
      .setDesc("Adds Log food to the menu on notes matching your Daily notes folder and filename format.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showFoodLogButtonInGcm)
        .onChange(async (value) => {
          this.plugin.settings.showFoodLogButtonInGcm = value;
          await this.plugin.saveSettings();
          this.plugin.refreshGcmFoodLogButtonRegistration();
        }));
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
  }

  private renderEarlierLogsSettings(records: HTMLElement): void {
    if (this.plugin.settings.storageMode === "legacy") {
      new Setting(records)
        .setName("Earlier inline logs need review")
        .setDesc("Your previous storage setting used lines inside notes. Those lines remain in their original notes, but whole-note totals count only copied records. Preview and copy them explicitly below; nothing is imported on startup.")
        .addButton((button) => button
          .setButtonText("Mark reviewed")
          .onClick(async () => {
            await this.plugin.acknowledgeLegacyHealthHistory();
            this.redisplayPreservingContext();
          }));
    }
    new Setting(records)
      .setName("Earlier inline logs")
      .setDesc("Preview food, activity, and workout lines before copying them into whole-note records. Original notes are preserved; unresolved lines need manual review.")
      .addButton((button) => button
        .setButtonText("Preview import")
        .onClick(() => void this.plugin.previewLegacyHealthImport()))
      .addButton((button) => button
        .setButtonText("Copy into notes")
        .onClick(async () => {
          await this.plugin.copyLegacyHealthLogs();
          this.redisplayPreservingContext();
        }));

  }

  private renderFoodGoalsPage(page: HTMLElement): void {
    const nutrition = createSettingsGroup(
      page,
      "Nutrition search",
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

    const energy = createSettingsGroup(page, "Energy estimate", "Choose a fixed TDEE, BMR × activity factor, or BMR plus calories from activity notes.");
    renderEnergySettings(energy, this.plugin);

    const goalActions = createSettingsGroup(page, "Goals in Bases", "Each metric has one editable goal note. Changing its bounds updates Health and the open Food & Goals Base. Rename or move goal notes freely. No targets are copied into food logs.");
    const status = goalActions.createDiv({attr: {role: "status", "aria-live": "polite"}});
    const run = async (action: () => Promise<void>) => {
      try { await action(); this.redisplayPreservingContext("button[data-health-goals-open]"); } catch (error) { status.setText((error as Error).message); }
    };
    new Setting(goalActions).setName("Daily goals and food totals")
      .setDesc("Health Goals edits the canonical notes. Food & Goals compares today’s logged totals with those notes, including remaining amounts. Existing Bases are opened unchanged.")
      .addButton(button => {button.buttonEl.setAttribute("data-health-goals-open", "true"); button.setButtonText("Open goals Base").onClick(() => void run(() => this.plugin.openHealthGoalsBase()));})
      .addButton(button => button.setButtonText("Open food comparison").onClick(() => void run(() => this.plugin.openFoodLogBase())));
    if (this.plugin.settings.goalStorage !== "notes") new Setting(goalActions)
      .setName("Move saved targets to goal notes")
      .setDesc("Preserves current targets, labels, units and display choices. After adoption, goal notes become the only target source; the old goal settings are removed.")
      .addButton(button => button.setButtonText("Move goals to notes").setCta().onClick(() => void run(() => this.plugin.adoptGoalNotes())));

    const nutrientGoals = createSettingsGroup(page, "Nutrient targets", "These controls edit the same goal notes shown in Bases. Goals also select nutrients kept on food definitions. Logs calculate from their food and portion. Targets are your own, not dietary recommendations.");
    let refreshGoals = () => {};
    try { refreshGoals = renderNutrientGoalSettings(nutrientGoals, this.plugin, () => {}); }
    catch (error) { nutrientGoals.createEl("p", {text: (error as Error).message}); }
    const customNutrients = createSettingsGroup(page, "Custom nutrients", "Add a nutrient name and unit for Health’s food editor and target picker. This does not add an inline property control in GCM.");
    renderCustomNutrientSettings(customNutrients, this.plugin, refreshGoals);
    try {
      const activity = this.plugin.getHealthGoals().find(goal => goal.propertyKey === "activity");
      if (activity) {
        const goals = createSettingsGroup(page, "Activity goal");
        let value = String(activity.min ?? "");
        new Setting(goals).setName("Activity goal minutes").setDesc("Edits the Activity goal note. Food & Goals compares nutrients; activity remains a separate metric.")
          .addText(text => text.setValue(value).onChange(next => {value = next;}))
          .addButton(button => button.setButtonText("Save activity goal").onClick(() => void run(() => this.plugin.updateBuiltInHealthGoalTarget("activityGoalMinutes", Number(value)))));
      }
    } catch (error) { status.setText((error as Error).message); }
  }

  private renderWorkoutsPage(page: HTMLElement): void {
    const storage = createSettingsGroup(page, "Workout controls", "Each workout is stored in one session note.");
    new Setting(storage)
      .setName("Workout controls")
      .setDesc("Choose where workout actions appear. Each workout still saves as one note.")
      .addDropdown((dropdown) => dropdown
        .addOption("inline", "In workout card")
        .addOption("floating", "In floating note bar")
        .setValue(this.plugin.settings.workoutControlPlacement)
        .onChange(async (value) => {
          this.plugin.settings.workoutControlPlacement = value as WorkoutControlPlacement;
          await this.plugin.saveSettings();
          this.plugin.scheduleWorkoutActionBars();
          logger.flow("Settings", "workout-controls:changed", { placement: value });
        }));

    const calendarProperties = createSettingsGroup(
      page,
      "Calendar properties",
      "Choose the two frontmatter properties that represent a workout on a calendar. Apply previews existing sessions and asks for confirmation before updating their properties. Apply the current key again to repair older workout notes.",
    );
    const addWorkoutPropertyKey = (name: string, description: string, settingKey: "workoutStartPropertyKey" | "workoutIntervalPropertyKey") => {
      this.addMappingSetting(calendarProperties, name, description,
        settings => settings[settingKey], (settings, value) => { settings[settingKey] = value; }, true,
        value => isValidWorkoutPropertyKey(value) && value.toLowerCase() !== this.plugin.settings[settingKey === "workoutStartPropertyKey" ? "workoutIntervalPropertyKey" : "workoutStartPropertyKey"].toLowerCase(), "workout-timing");
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
          const next = structuredClone(this.plugin.settings);
          next.workoutIntervalMode = value as WorkoutIntervalMode;
          dropdown.setValue(this.plugin.settings.workoutIntervalMode);
          try { await changeHealthMapping(this.plugin, next, `Workout interval style: ${value}`, "workout-timing"); }
          catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
          this.redisplayPreservingContext();
        }));
    addWorkoutPropertyKey(
      "Workout interval property",
      "Numeric minutes in duration mode or a datetime in ending-time mode. The default is timeEstimate.",
      "workoutIntervalPropertyKey",
    );

    new Setting(calendarProperties)
      .setName("Default workout estimate (minutes)")
      .setDesc("Schedules a timed slot as soon as a workout starts. Finishing replaces the estimate with the actual duration. TishOS uses your selected Calendar view and Live Activity settings.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.defaultWorkoutEstimateMinutes))
        .onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.settings.defaultWorkoutEstimateMinutes = Number.isFinite(parsed) && parsed >= 1
            ? Math.round(parsed) : DEFAULT_SETTINGS.defaultWorkoutEstimateMinutes;
          await this.plugin.saveSettings();
        }));

    const sessionDefaults = createSettingsGroup(
      page,
      "Session defaults",
    );
    new Setting(sessionDefaults)
      .setName("Rest timer mode")
      .setDesc("The timer appears on the completed set and stops when another set is completed. Count up measures elapsed time; count down uses the set’s rest target.")
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

  }

  private renderNoteLibraryPage(page: HTMLElement): void {
    const folders = createSettingsGroup(
      page,
      "Library folders",
      "Choose where new foods, recipes, exercises and plans are saved. New log notes use GCM’s record destination. Enter / for the vault root; existing notes are not moved.",
    );
    this.addLibraryFolderSetting(folders, "workoutPlansFolder", "Workout plans destination", "Reusable workout/routine notes. New session logs use GCM’s record destination. Existing notes are not moved.");
    this.addLibraryFolderSetting(folders, "exercisesFolder", "Exercises destination", "New exercise notes are created here. Existing exercise notes remain where they are.");
    this.addLibraryFolderSetting(folders, "foodsFolder", "Foods destination", "New food notes are created here. Recipes and meals use their separate destination. Existing food notes remain where they are.");
    this.addLibraryFolderSetting(folders, "recipesFolder", "Recipes destination", "New recipe and meal notes are created here. Existing notes are not moved.");
    if (this.plugin.settings.workoutIdentificationMode === "folder" || this.plugin.settings.workoutIdentificationMode === "metadata-folder-tag") {
      this.addLibraryFolderSetting(folders, "workoutsFolder", "Existing workout folder", "Used to recognize workout notes with your current folder matching mode. It does not set the destination for new workout sessions.");
    }

    if (this.plugin.getGcmApi()?.frontmatterKinds?.version === 2) {
      const classification = createSettingsGroup(page, "Note types & inline properties", "GCM identifies foods, recipes, meals, exercises, plans and logs. Health uses those note types when reading and creating records.");
      new Setting(classification)
        .setName("Configure note types and inline fields")
        .setDesc("In GCM → Properties, use Records for note types and Custom fields for inline visibility. Nutrient tracking and targets belong to Health → Food & goals.")
        .addButton(button => button.setButtonText("Open GCM settings").onClick(() => this.openPluginSettings("tps-global-context-menu")));
    } else {
    const identification = createSettingsGroup(
      page,
      "Identification & tags",
    );
    new Setting(identification)
      .setName("Food note identification")
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
      this.addMappingSetting(identification, "Food frontmatter key", "Property used to identify foods, recipes, and meals.",
        settings => settings.foodFrontmatterKey, (settings, value) => { settings.foodFrontmatterKey = value; }, true);
      for (const [label, key] of [["Food value", "foodFrontmatterFoodValue"], ["Recipe value", "foodFrontmatterRecipeValue"], ["Meal value", "foodFrontmatterMealValue"]] as const) {
        this.addMappingSetting(identification, label, `Value written to ${this.plugin.settings.foodFrontmatterKey}.`,
          settings => settings[key], (settings, value) => { settings[key] = value; });
      }
    }

    const workoutIdentity = createSettingsGroup(page, "Workout plans and exercises", "Identify reusable workout templates and exercise definitions. Apply previews and updates existing notes before saving a mapping.");
    this.addMappingSetting(workoutIdentity, "Workout frontmatter key", "Property used for reusable workout plans and exercises.",
      settings => settings.workoutFrontmatterKey, (settings, value) => { settings.workoutFrontmatterKey = value; }, true);
    this.addMappingSetting(workoutIdentity, "Workout plan value", `Value written to ${this.plugin.settings.workoutFrontmatterKey} for reusable workout templates.`,
      settings => settings.workoutPlanFrontmatterValue, (settings, value) => { settings.workoutPlanFrontmatterValue = value; });
    this.addMappingSetting(workoutIdentity, "Exercise value", `Value written to ${this.plugin.settings.workoutFrontmatterKey} for exercise definitions.`,
      settings => settings.exerciseFrontmatterValue, (settings, value) => { settings.exerciseFrontmatterValue = value; });

    const records = createSettingsGroup(page, "Logged entries and workout sessions", "Choose the same key as your food and workout templates, or a different key. Only logged Health records move when you change this key.");
    const api = this.plugin.getGcmNativeRecordsApi();
    const profile = api?.getStorageProfile?.(this.plugin.settings.nativeRecordKinds.foodEntry);
    let entryKey: TextComponent;
    const applyEntryKey = async () => {
      try {
        const mappings = (this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.api?.propertyMappings;
        if (!api?.capabilities?.kindPropertyKeys || !mappings?.changeHealthKindKey) throw new Error("Update and enable TPS GCM to configure a separate Health entry key.");
        await mappings.changeHealthKindKey(entryKey.getValue());
      } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 15000); }
      this.redisplayPreservingContext('[data-tps-health-entry-key]');
    };
    new Setting(records).setName("Entry and session frontmatter key")
      .setDesc("Used for food entries, activity entries and workout sessions. GCM stores this Health-specific mapping; Apply previews existing records before confirmation.")
      .addText(text => {
        entryKey = text.setValue(profile?.kindPropertyKey || "kind");
        text.inputEl.dataset.tpsHealthEntryKey = "true";
        text.inputEl.setAttribute("aria-label", "Entry and session frontmatter key");
        text.inputEl.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void applyEntryKey(); } });
      })
      .addButton(button => button.setButtonText("Apply").onClick(applyEntryKey));
    this.renderNativeKindSettings(records);
    new Setting(records).setName("Migrate previous mappings")
      .setDesc("Review notes using old default identifiers or previously saved aliases, then update them to your current mappings. Aliases are removed after confirmation.")
      .addButton(button => button.setButtonText("Review existing notes").onClick(async () => {
        try { await changeHealthMapping(this.plugin, structuredClone(this.plugin.settings), "Update previous mappings to the current Health configuration."); }
        catch (error) { new Notice(String(error), 15000); }
      }));

    new Setting(identification)
      .setName("Workout note identification")
      .addDropdown((dropdown) => {
        dropdown.selectEl.dataset.tpsHealthWorkoutIdentification = "true";
        return dropdown
        .addOption("metadata-folder-tag", "Frontmatter, folder, or tag")
        .addOption("folder", "Folder only")
        .addOption("tag", "Tag only")
        .addOption("metadata", "Frontmatter only")
        .setValue(this.plugin.settings.workoutIdentificationMode)
        .onChange(async (value) => {
          this.plugin.settings.workoutIdentificationMode = value as HealthEntityIdentificationMode;
          await this.plugin.saveSettings();
          this.redisplayPreservingContext("[data-tps-health-workout-identification]");
        });
      });

    if (this.plugin.settings.workoutIdentificationMode === "tag" || this.plugin.settings.workoutIdentificationMode === "metadata-folder-tag") {
    new Setting(identification)
      .setName("Workout tag")
      .setDesc("Used when workout identification includes tags. Blank disables this identity signal.")
      .addText((text) => text
      .setValue(this.plugin.settings.workoutTag)
        .onChange(async (value) => {
          this.plugin.settings.workoutTag = value.trim();
          await this.plugin.saveSettings();
        }));

    }

    new Setting(identification)
      .setName("Exercise tag")
      .setDesc("Used to recognize reusable exercise notes. Blank disables this identity signal.")
      .addText((text) => text
      .setValue(this.plugin.settings.exerciseTag)
        .onChange(async (value) => {
          this.plugin.settings.exerciseTag = value.trim();
          await this.plugin.saveSettings();
        }));

    if (this.plugin.settings.foodIdentificationMode === "tag" || this.plugin.settings.foodIdentificationMode === "metadata-folder-tag") {
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
    }
    }

    const templates = this.createOptionalDisclosure(
      page,
      "templates",
      "Templates",
      "Optional note templates used when TPS Health creates reusable foods, exercises and workout plans.",
    );

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
      .setDesc(`${description}`)
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
    const food = createSettingsGroup(page, "Food databases");
    this.foodConnections = new HealthConnectionSettings(this.plugin, food);
    this.foodConnections.render();

    const gcm = createSettingsGroup(
      page,
      "TPS Global Context Menu",
    );
    new Setting(gcm)
      .setName("Record IDs, dates and log destination")
      .setDesc("GCM → Advanced owns shared ID, title, created and modified properties and the destination for new logs. Record types are under GCM → Properties → Records; Health-specific property names are below.")
      .addButton((button) => button
        .setButtonText("Open GCM settings")
        .onClick(() => this.openPluginSettings("tps-global-context-menu")));

    const nativeFrontmatter = this.createOptionalDisclosure(
      page,
      "native-frontmatter",
      "Property names",
      "Choose one Health property to rename. Apply previews existing records and asks for confirmation before changing notes and saving the mapping. Nutrient tracking is configured under Food & goals.",
    );
    this.renderNativeFrontmatterSettings(nativeFrontmatter);

    const connections = createSettingsGroup(page, "Connections");
    new Setting(connections).setName("AI-assisted Describe").setDesc("AI Gateway connection settings are available through TPS Controller.")
      .addButton(button => button.setButtonText("Open connections").onClick(() => {
        const controller = (this.app as any).plugins?.plugins?.["tps-controller"]?.api;
        if (typeof controller?.openConnectionSettings === "function") controller.openConnectionSettings("ai");
        else new Notice("Enable TPS Controller to open AI Gateway connection settings.");
      }));

    const earlierLogs = this.createOptionalDisclosure(
      page,
      "earlier-logs",
      "Earlier inline logs",
      "Optional one-time import of older food, activity and workout lines. Current logging saves individual notes; nothing is imported automatically.",
    );
    this.renderEarlierLogsSettings(earlierLogs);

    const diagnostics = createSettingsGroup(
      page,
      "Diagnostics",
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

  private renderNativeKindSettings(section: HTMLElement): void {
    const kindFields: Array<[HealthNativeRecordKindKey, string]> = [
      ["foodEntry", "Food entry kind value"],
      ["activityEntry", "Activity entry kind value"],
      ["workoutSession", "Workout session kind value"],
      ["workoutExercise", "Legacy workout exercise kind value"],
    ];
    for (const [key, label] of kindFields) {
      this.addMappingSetting(section, label, "Apply previews and migrates existing records. Lowercase words separated by hyphens.",
        settings => settings.nativeRecordKinds[key], (settings, value) => { settings.nativeRecordKinds[key] = value; }, false, isValidNativeRecordKindValue);
    }
  }

  private renderNativeFrontmatterSettings(section: HTMLElement): void {

    const propertyGroups: Array<[string, Array<[HealthNativeRecordPropertyKey, string]>]> = [
      ["Food and nutrition fields", [
        ["completedDate", "Logged/completed time"], ["food", "Food link"], ["quantity", "Quantity"], ["unit", "Unit"],
        ["calories", "Calories"], ["proteinG", "Protein"], ["carbsG", "Carbohydrates"], ["fatG", "Fat"],
        ["fiberG", "Fiber"], ["sugarG", "Sugar"], ["sugarAlcoholG", "Sugar alcohol"], ["alcoholG", "Alcohol"], ["sodiumMg", "Sodium"],
        ...EXTRA_NUTRIENTS.map(nutrient => [nutrient.key, `${nutrient.label} (${nutrient.unit})`] as [HealthNativeRecordPropertyKey, string]),
      ]],
      ["Activity fields", [
        ["activity", "Activity name"], ["activityType", "Activity type"], ["startedAt", "Activity start"],
        ["durationMinutes", "Activity duration"], ["distance", "Distance"], ["distanceUnit", "Distance unit"],
        ["steps", "Steps"], ["flightsClimbed", "Flights climbed"], ["caloriesBurned", "Calories burned"],
        ["source", "Source"], ["sourceId", "Source record ID"], ["device", "Device"],
      ]],
      ["Workout and shared Health fields", [
        ["status", "Workout status"], ["workoutPlan", "Workout plan"], ["session", "Workout session data"],
        ["note", "Note"], ["archived", "Archived"], ["archivedDate", "Archived time"],
      ]],
    ];
    const fields = propertyGroups.flatMap(([, entries]) => entries);
    const fieldEditor = section.createDiv();
    const renderField = () => {
      fieldEditor.empty();
      const field = fields.find(([key]) => key === this.activeNativePropertyKey)!;
      this.addNativePropertyKeySetting(fieldEditor, field[0], field[1]);
    };
    const selector = new Setting(section)
      .setName("Property to configure")
      .setDesc("Browsing names does not enable tracking or add properties to notes.")
      .addDropdown(dropdown => {
        dropdown.selectEl.setAttribute("aria-label", "Health property to configure");
        for (const [groupLabel, entries] of propertyGroups) {
          const group = dropdown.selectEl.createEl("optgroup", { attr: { label: groupLabel } });
          for (const [key, label] of entries) group.createEl("option", {
            value: key, text: `${label} · ${this.plugin.settings.nativeRecordProperties[key]}`,
          });
        }
        dropdown.setValue(this.activeNativePropertyKey).onChange(value => {
          this.activeNativePropertyKey = value as HealthNativeRecordPropertyKey;
          renderField();
          fieldEditor.querySelector<HTMLInputElement>("input")?.focus();
        });
      });
    selector.settingEl.after(fieldEditor);
    renderField();
  }

  private addNativePropertyKeySetting(
    section: HTMLElement,
    key: HealthNativeRecordPropertyKey,
    label: string,
  ): void {
    this.addMappingSetting(section, label, `Default: ${DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES[key]}. Apply previews and migrates existing records. Shared TPS envelope keys are reserved.`,
      settings => settings.nativeRecordProperties[key], (settings, value) => { settings.nativeRecordProperties[key] = value; }, true, isValidFrontmatterPropertyKey);
  }

  private addMappingSetting(
    section: HTMLElement, label: string, description: string,
    read: (settings: TPSHealthSettings) => string,
    write: (settings: TPSHealthSettings, value: string) => void,
    propertyKey = false, validate: (value: string) => boolean = value => Boolean(value),
    scope: HealthMappingScope = "all",
  ): void {
    let input: TextComponent;
    const setting = new Setting(section).setName(label).setDesc(description);
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    setting.settingEl.dataset.tpsHealthMapping = id;
    const apply = async () => {
      const value = input.getValue().trim();
      if (value === read(this.plugin.settings) && scope !== "workout-timing") return;
      if (!validate(value) || (propertyKey && !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value))) {
        new Notice("Enter a valid mapping before applying it."); return;
      }
      const next = structuredClone(this.plugin.settings);
      write(next, value);
      const groups = [Object.values(next.nativeRecordKinds), Object.values(next.nativeRecordProperties),
        [next.foodFrontmatterFoodValue, next.foodFrontmatterRecipeValue, next.foodFrontmatterMealValue],
        [next.workoutPlanFrontmatterValue, next.exerciseFrontmatterValue]];
      const profile = this.plugin.getGcmNativeRecordsApi()?.getStorageProfile?.();
      const reserved = ["id", "tpsId", "tpsSchemaVersion", "title", "createdDate", "modifiedDate", "tags", "cssclasses",
        ...Object.values(DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES), "brand", "aliases", "barcode", "servingAmount", "servingUnit", "servingGrams", "servingMl", "ingredients", "ingredientStatement", "name", "notes", "cooldownDays", "defaultRestSeconds", "category", "primaryMuscles", "secondaryMuscles", "equipment",
        ...[profile?.identityPropertyKey, profile?.schemaPropertyKey, profile?.titlePropertyKey, profile?.createdPropertyKey, profile?.modifiedPropertyKey].filter(Boolean)].map(key => String(key).toLowerCase());
      const sharedKindKey = this.plugin.getGcmNativeRecordsApi()?.getStorageProfile?.(this.plugin.settings.nativeRecordKinds.foodEntry)?.kindPropertyKey || profile?.kindPropertyKey || "kind";
      const nativeValues = Object.values(next.nativeRecordKinds);
      const envelopeKeys = [sharedKindKey, profile?.identityPropertyKey, profile?.schemaPropertyKey, profile?.titlePropertyKey, profile?.createdPropertyKey, profile?.modifiedPropertyKey].filter(Boolean).map(key => String(key).toLowerCase());
      const reusesAnotherDefault = Object.entries(next.nativeRecordProperties).some(([key, value]) => Object.entries(DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES).some(([otherKey, otherValue]) => otherKey !== key && otherValue.toLowerCase() === String(value).toLowerCase()))
        || Object.entries(next.nativeRecordKinds).some(([key, value]) => Object.entries(DEFAULT_HEALTH_NATIVE_RECORD_KINDS).some(([otherKey, otherValue]) => otherKey !== key && otherValue === value));
      if (reusesAnotherDefault || Object.values(next.nativeRecordProperties).some(key => envelopeKeys.includes(String(key).toLowerCase()))
        || (next.foodFrontmatterKey === sharedKindKey && [next.foodFrontmatterFoodValue, next.foodFrontmatterRecipeValue, next.foodFrontmatterMealValue].some(value => nativeValues.includes(value)))
        || (next.workoutFrontmatterKey === sharedKindKey && [next.workoutPlanFrontmatterValue, next.exerciseFrontmatterValue].some(value => nativeValues.includes(value)))
        || groups.some(group => new Set(group.map(item => String(item).toLowerCase())).size !== group.length)
        || [next.foodFrontmatterKey, next.workoutFrontmatterKey].some(key => reserved.includes(key.toLowerCase()))
        || (next.foodFrontmatterKey === next.workoutFrontmatterKey && [next.workoutPlanFrontmatterValue, next.exerciseFrontmatterValue].some(value => [next.foodFrontmatterFoodValue, next.foodFrontmatterRecipeValue, next.foodFrontmatterMealValue].includes(value)))) {
        new Notice("Mappings must be distinct and cannot overwrite shared record fields."); return;
      }
      try {
        await changeHealthMapping(this.plugin, next, `${label}: “${read(this.plugin.settings)}” → “${value}”`, scope);
      } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 15000); }
      this.redisplayPreservingContext(`[data-tps-health-mapping="${id}"] input`);
    };
    setting.addText(text => {
      input = text.setValue(read(this.plugin.settings));
      text.inputEl.setAttribute("aria-label", label);
      text.inputEl.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void apply(); } });
    }).addButton(button => button.setButtonText("Apply").setTooltip(`Review ${label.toLowerCase()} change`).onClick(apply));
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
