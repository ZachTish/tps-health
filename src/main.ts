import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { App, BasesView, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, EventRef, MarkdownView, Modal, Notice, Plugin, QueryController, editorLivePreviewField, normalizePath, requestUrl, Setting, TFile } from "obsidian";
import { BrowserMultiFormatOneDReader, BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { CreateExerciseInput, CreateFoodInput, CreateWorkoutPlanInput, DailyRollup, FinishWorkoutInput, FoodLabelInput, HealthMetricRenderConfig, LogFoodByNameInput, LogFoodInput, LogSetInput, StartWorkoutInput, TPSHealthApi, UpsertExerciseInput, UpsertFoodInput, UpsertWorkoutPlanInput } from "./api";
import { foodEntryLine, id, isoNow, workoutSessionLine, workoutSetLine, workoutSummaryLine } from "./format";
import { normalizeTPSHealthSettings } from "./settings-normalization";
import { TPSHealthSettingTab } from "./settings";
import {
  DEFAULT_SETTINGS,
  ExerciseItem,
  FoodItem,
  FoodLogEntry,
  Nutrition,
  TPSHealthSettings,
  WorkoutPlanItem,
  WorkoutSet,
} from "./types";

interface FoodLogDateContext {
  dateIso: string;
  label: string;
  isToday: boolean;
}

interface BarcodeScannerAdapters {
  requestCameraStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createLiveReader?: () => any;
  createCanvasReader?: () => any;
  createNativeDetector?: () => any;
  nativeBridgeScan?: () => Promise<unknown>;
  navigatorInfo?: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">;
}

interface BarcodeScannerOptions {
  autoStart?: boolean;
  onClose?: () => void;
  adapters?: BarcodeScannerAdapters;
}

const FOOD_LOG_BASE_VIEW_TYPE = "tps-health-food-log";
const DEFAULT_FOOD_LOG_BASE_PATH = "Food Log.base";
const SHORTCUT_BARCODE_INBOX_PATH = "TPS Health Barcode Scan.md";
const SHORTCUT_BARCODE_NAME = "TPS Health Scan Barcode";

export default class TPSHealthPlugin extends Plugin {
  settings: TPSHealthSettings = DEFAULT_SETTINGS;
  api!: TPSHealthApi;
  private unregisterGcmFoodLogButton: (() => void) | null = null;
  private lastFoodLogOpenAt = 0;
  private workoutFileSnapshots = new Map<string, string>();
  private processingWorkoutFiles = new Set<string>();
  private finishPromptWorkoutFiles = new Set<string>();

  async onload() {
    console.log("Loading TPS Health");
    const storedSettings = await this.loadData();
    this.settings = normalizeTPSHealthSettings(storedSettings as Partial<TPSHealthSettings> || {});
    if (settingsNeedMigration(storedSettings, this.settings)) await this.saveData(this.settings);
    this.api = this.createApi();
    (this.app as any).tpsHealth = this.api;
    this.addSettingTab(new TPSHealthSettingTab(this.app, this));
    this.registerBasesView(FOOD_LOG_BASE_VIEW_TYPE, {
      name: "Food Log",
      icon: "apple",
      factory: (controller: QueryController, containerEl: HTMLElement): BasesView =>
        new FoodLogBaseView(controller, containerEl, this),
    });

    this.addCommand({
      id: "start-workout",
      name: "Start workout",
      callback: async () => new StartWorkoutModal(this.app, this, await this.getActiveDailyNoteDateContext()).open(),
    });
    this.addCommand({
      id: "finish-workout",
      name: "Finish active workout",
      callback: () => this.finishWorkout(),
    });
    this.addCommand({
      id: "finish-and-save-workout-template",
      name: "Finish active workout and save template",
      callback: () => this.openFinishWorkoutTemplateModal(),
    });
    this.addCommand({
      id: "save-active-workout-template",
      name: "Save active workout template",
      callback: () => this.openSaveWorkoutTemplateModal(),
    });
    this.addCommand({
      id: "create-workout-plan",
      name: "Create workout plan",
      callback: () => new WorkoutPlanModal(this.app, this).open(),
    });
    this.addCommand({
      id: "log-workout-set",
      name: "Log workout set",
      callback: () => new SetModal(this.app, this).open(),
    });
    this.addCommand({
      id: "log-food",
      name: "Log food",
      callback: async () => this.openFoodSearchModal(this.getActiveInlineFoodDraft(), await this.getActiveDailyNoteDateContext()),
    });
    this.addCommand({
      id: "open-food-log-base",
      name: "Open Food Log base",
      callback: () => this.openFoodLogBase(),
    });
    this.addCommand({
      id: "complete-inline-food-log",
      name: "Complete inline food log at cursor",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor) {
          new Notice("Open a markdown note before completing a food log");
          return;
        }
        void this.completeInlineFoodLog(view.editor);
      },
    });
    this.addCommand({
      id: "scan-food-barcode",
      name: "Scan food barcode",
      callback: async () => new BarcodeScannerModal(this.app, this, await this.getActiveDailyNoteDateContext()).open(),
    });
    this.addCommand({
      id: "create-custom-food",
      name: "Create custom food",
      callback: () => new CustomFoodModal(this.app, this, "food").open(),
    });
    this.addCommand({
      id: "create-recipe",
      name: "Create recipe",
      callback: () => new CustomFoodModal(this.app, this, "recipe").open(),
    });
    this.registerEditorSuggest(new FoodLogEditorSuggest(this.app, this));
    this.registerEditorExtension(createFoodLogChipExtension(this));
    this.registerEditorExtension(createWorkoutSetChipExtension());
    this.registerMarkdownPostProcessor((root, ctx) => {
      renderFoodLogChips(root, this);
      renderWorkoutSetChips(root, ctx.sourcePath);
    });
    this.registerWorkoutTaskCompletionTracking();
    this.refreshGcmFoodLogButtonRegistration();
    this.registerGcmFoodLogButtonTapFallback();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleGcmMenuRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleGcmMenuRefresh()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleGcmMenuRefresh()));

  }

  async saveSettings() {
    this.settings = normalizeTPSHealthSettings(this.settings);
    await this.saveData(this.settings);
  }

  onunload(): void {
    this.unregisterGcmFoodLogButton?.();
    this.unregisterGcmFoodLogButton = null;
    if ((this.app as any).tpsHealth === this.api) delete (this.app as any).tpsHealth;
  }

  refreshGcmFoodLogButtonRegistration(): void {
    this.unregisterGcmFoodLogButton?.();
    this.unregisterGcmFoodLogButton = null;
    if (!this.settings.showFoodLogButtonInGcm) {
      this.scheduleGcmMenuRefresh();
      return;
    }

    const gcmApi = this.getGcmApi();
    const register = gcmApi?.externalActions?.register;
    if (typeof register !== "function") {
      this.registerEvent(this.app.workspace.on("layout-change", () => {
        if (!this.unregisterGcmFoodLogButton && this.settings.showFoodLogButtonInGcm) this.refreshGcmFoodLogButtonRegistration();
      }));
      return;
    }

    this.unregisterGcmFoodLogButton = register({
      id: "food-log",
      pluginId: this.manifest.id,
      order: 15,
      icon: "apple",
      label: "Log food",
      title: "Log food",
      isVisible: async ({ file }: { file: TFile }) => Boolean(await this.getDailyNoteDateContext(file)),
      onClick: async ({ file }: { file: TFile }) => {
        const dateContext = await this.getDailyNoteDateContext(file);
        if (!dateContext) {
          new Notice("Food logging is only available from daily notes.");
          this.scheduleGcmMenuRefresh();
          return;
        }
        this.openFoodSearchModal(null, dateContext);
      },
    });
    this.scheduleGcmMenuRefresh();
  }

  private openFoodSearchModal(initialDraft: InlineFoodDraft | null, dateContext: FoodLogDateContext | null): void {
    const now = Date.now();
    if (now - this.lastFoodLogOpenAt < 500) return;
    this.lastFoodLogOpenAt = now;
    new FoodSearchModal(this.app, this, initialDraft, dateContext).open();
  }

  async openFoodLogBase(): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(DEFAULT_FOOD_LOG_BASE_PATH);
    if (!file) {
      file = await this.app.vault.create(DEFAULT_FOOD_LOG_BASE_PATH, defaultFoodLogBaseContent(this.settings));
    }
    if (!(file instanceof TFile)) {
      new Notice("Food Log base path is not a file.");
      return;
    }
    const repaired = repairFoodLogBaseContent(await this.app.vault.cachedRead(file), this.settings);
    if (repaired) await this.app.vault.modify(file, repaired);
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  openFoodLogger(dateContext: FoodLogDateContext | null = null): void {
    this.openFoodSearchModal(null, dateContext);
  }

  async getFoodLogDateContextForFile(file: TFile | null | undefined): Promise<FoodLogDateContext | null> {
    return this.getDailyNoteDateContext(file);
  }

  private registerGcmFoodLogButtonTapFallback(): void {
    const handler = async (event: PointerEvent | MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const button = target?.closest<HTMLElement>('[data-tps-gcm-external-action-id="tps-health:food-log"], button[aria-label="Log food"], button[title="Log food"], [role="button"][aria-label="Log food"], [role="button"][title="Log food"]');
      if (!button || button.hasClass("tps-health-gcm-hidden")) return;
      const label = (button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent || "").trim();
      if (button.getAttribute("data-tps-gcm-external-action-id") !== "tps-health:food-log" && label !== "Log food") return;
      const dateContext = await this.getActiveDailyNoteDateContext();
      if (!dateContext) return;
      event.preventDefault();
      event.stopPropagation();
      this.openFoodSearchModal(null, dateContext);
    };
    document.addEventListener("pointerdown", handler, { capture: true });
    this.register(() => document.removeEventListener("pointerdown", handler, { capture: true } as AddEventListenerOptions));
  }

  async startWorkout(input: StartWorkoutInput = {}): Promise<string> {
    const startedAt = input.startedAt || isoNow();
    const dailyNoteDate = input.dailyNoteDate || startedAt;
    const plan = await this.resolveWorkoutPlanForStart(input);
    const title = input.title || `${plan?.name || "Workout"} ${window.moment(startedAt).format("YYYY-MM-DD HH.mm")}`;
    const cooldownDays = input.cooldownDays ?? plan?.cooldownDays ?? this.settings.defaultWorkoutCooldownDays;
    const logTarget = input.logTarget || this.settings.workoutLogTarget;
    const workoutId = id("workout");
    let path = "";
    let dailyNotePath = "";
    if (logTarget === "session-note" || logTarget === "both") {
      path = await this.uniquePath(`${this.settings.workoutsFolder}/${title}.md`);
      await this.ensureFolder(this.settings.workoutsFolder);
      const template = await this.readWorkoutTemplate();
      const body = template
        ? this.renderWorkoutSessionTemplate(template, { title, startedAt, plan, cooldownDays, workoutId })
        : this.defaultWorkoutTemplate(title, startedAt, plan, cooldownDays, workoutId);
      await this.app.vault.create(path, body);
      await this.ensureWorkoutSessionFrontmatter(path, title, startedAt, plan, cooldownDays, workoutId);
      if (plan?.sourcePath) await this.applyWorkoutPlanToSession(path, plan.sourcePath);
    }
    if (logTarget === "daily-note" || logTarget === "both") {
      const dailyFile = await this.insertWorkoutSessionIntoDailyNote(workoutSessionLine({
        id: workoutId,
        title,
        startedAt,
        path: path || undefined,
        plan,
        cooldownDays,
        status: "active",
      }), dailyNoteDate);
      dailyNotePath = dailyFile.path;
    } else if (this.settings.appendWorkoutSummaryToDailyNote && path) {
      await this.appendToDailyHeading(this.settings.workoutLogHeading, workoutSummaryLine(path, startedAt), await this.getOrCreateDailyNoteForDate(dailyNoteDate));
    }
    this.settings.activeWorkoutPath = path;
    this.settings.activeWorkoutId = workoutId;
    this.settings.activeWorkoutTarget = logTarget;
    this.settings.activeWorkoutDailyNotePath = dailyNotePath;
    this.settings.activeWorkoutPlanPath = plan?.sourcePath || "";
    this.settings.activeWorkoutTitle = title;
    this.settings.activeWorkoutStartedAt = startedAt;
    this.settings.activeWorkoutCooldownDays = cooldownDays;
    this.settings.lastSetEndedAt = "";
    this.settings.activeWorkoutSetCount = 0;
    await this.saveSettings();
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (input.openFile !== false && file instanceof TFile) await this.openPinnedWorkoutFile(file);
    if (file instanceof TFile) await this.cacheWorkoutFile(file);
    await this.startGcmWorkoutTimer(file instanceof TFile ? file : dailyNotePath);
    new Notice("Started workout");
    return path || dailyNotePath;
  }

  async finishWorkout(input: FinishWorkoutInput = {}): Promise<void> {
    const path = this.settings.activeWorkoutPath;
    const dailyNotePath = this.settings.activeWorkoutDailyNotePath;
    const workoutId = this.settings.activeWorkoutId;
    if (!path && !dailyNotePath) {
      new Notice("No active workout");
      return;
    }
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (path && !(file instanceof TFile)) {
      new Notice("Active workout file was not found");
      return;
    }
    const endedAt = input.endedAt || isoNow();
    const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter || {} : {};
    const startedAt = typeof fm.startedAt === "string" ? fm.startedAt : this.settings.activeWorkoutStartedAt;
    const durationSeconds = workoutDurationSeconds(startedAt, endedAt);
    const durationMinutes = durationSeconds != null ? Math.max(1, Math.round(durationSeconds / 60)) : undefined;
    const cooldownDays = input.cooldownDays ?? numberOrUndefined(fm.cooldownDays) ?? this.settings.activeWorkoutCooldownDays ?? this.settings.defaultWorkoutCooldownDays;
    const nextEligibleDate = cooldownDays > 0 ? addDaysIsoDate(endedAt, cooldownDays) : undefined;
    if (file instanceof TFile) {
      const normalizedSetCount = await this.normalizeWorkoutNoteSetTasks(file, fm, endedAt);
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.kind = frontmatter.kind || "workout";
        frontmatter.workoutId = frontmatter.workoutId || workoutId;
        frontmatter.status = "complete";
        frontmatter.scheduled = frontmatter.scheduled || startedAt || endedAt;
        frontmatter.cssclasses = withCssClass(frontmatter.cssclasses, "tps-health-workout");
        frontmatter.endedAt = endedAt;
        frontmatter.completedDate = endedAt;
        if (durationSeconds != null) frontmatter.durationSeconds = durationSeconds;
        if (durationMinutes != null) frontmatter.timeEstimate = durationMinutes;
        const setCount = Math.max(this.settings.activeWorkoutSetCount || 0, normalizedSetCount);
        if (setCount > 0) frontmatter.setCount = setCount;
        frontmatter.allDay = false;
        frontmatter.cooldownDays = cooldownDays;
        if (nextEligibleDate) frontmatter.nextEligibleDate = nextEligibleDate;
        else delete frontmatter.nextEligibleDate;
      });
    }
    if (dailyNotePath && workoutId) await this.completeDailyWorkoutLine(dailyNotePath, workoutId, endedAt, nextEligibleDate);
    const planPath = typeof fm.workoutPlanPath === "string" ? fm.workoutPlanPath : this.settings.activeWorkoutPlanPath;
    if (planPath) await this.updateWorkoutPlanCompletion(planPath, endedAt, cooldownDays, path || dailyNotePath, nextEligibleDate);
    await this.stopGcmWorkoutTimer(file instanceof TFile ? file : path || dailyNotePath, endedAt);
    this.settings.activeWorkoutPath = "";
    this.settings.activeWorkoutId = "";
    this.settings.activeWorkoutTarget = "";
    this.settings.activeWorkoutDailyNotePath = "";
    this.settings.activeWorkoutPlanPath = "";
    this.settings.activeWorkoutTitle = "";
    this.settings.activeWorkoutStartedAt = "";
    this.settings.activeWorkoutCooldownDays = 0;
    this.settings.lastSetEndedAt = "";
    this.settings.activeWorkoutSetCount = 0;
    await this.saveSettings();
    new Notice("Finished workout");
  }

  async finishWorkoutAndSaveTemplate(input: { title?: string; cooldownDays?: number; defaultRestSeconds?: number } = {}): Promise<void> {
    const active = this.getActiveWorkoutState();
    if (!active) {
      new Notice("No active workout");
      return;
    }
    await this.createWorkoutTemplateFromState(active, {
      name: input.title || active.title || "Workout Template",
      cooldownDays: input.cooldownDays ?? this.settings.defaultWorkoutCooldownDays,
      defaultRestSeconds: input.defaultRestSeconds ?? this.settings.defaultRestSeconds,
    });
    await this.finishWorkout();
    new Notice("Saved workout template and finished workout");
  }

  async saveActiveWorkoutTemplate(input: { title?: string; cooldownDays?: number; defaultRestSeconds?: number } = {}): Promise<void> {
    const active = this.getActiveWorkoutState();
    if (!active) {
      new Notice("No active workout");
      return;
    }
    await this.createWorkoutTemplateFromState(active, {
      name: input.title || active.title || "Workout Template",
      cooldownDays: input.cooldownDays ?? this.settings.defaultWorkoutCooldownDays,
      defaultRestSeconds: input.defaultRestSeconds ?? this.settings.defaultRestSeconds,
    });
  }

  private openFinishWorkoutTemplateModal(): void {
    if (!this.getActiveWorkoutState()) {
      new Notice("No active workout");
      return;
    }
    new FinishWorkoutTemplateModal(this.app, this).open();
  }

  private openSaveWorkoutTemplateModal(): void {
    if (!this.getActiveWorkoutState()) {
      new Notice("No active workout");
      return;
    }
    new SaveWorkoutTemplateModal(this.app, this).open();
  }

  async logSet(set: LogSetInput): Promise<WorkoutSet> {
    const path = this.settings.activeWorkoutPath;
    const dailyNotePath = this.settings.activeWorkoutDailyNotePath;
    if (!path && !dailyNotePath) {
      new Notice("Start a workout before logging sets");
      throw new Error("Start a workout before logging sets");
    }
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (path && !(file instanceof TFile)) {
      new Notice("Active workout file was not found");
      throw new Error("Active workout file was not found");
    }
    const endedAt = set.completedDate || isoNow();
    const previousEnd = this.settings.lastSetEndedAt ? Date.parse(this.settings.lastSetEndedAt) : NaN;
    const startedAt = set.startedAt || startedAtFromSetEnd(endedAt, set.durationSeconds);
    const startedTimestamp = Date.parse(startedAt);
    const exercise = set.createExerciseNote === false
      ? this.findExercise(set.exercise)
      : await this.findOrCreateExercise({ name: set.exercise });
    const restSeconds = set.restSeconds ?? (this.settings.restTimerMode === "count-up" && Number.isFinite(previousEnd)
      ? Math.max(0, Math.round(((Number.isFinite(startedTimestamp) ? startedTimestamp : Date.parse(endedAt)) - previousEnd) / 1000))
      : exercise?.defaultRestSeconds) ?? this.settings.defaultRestSeconds;
    const timeSincePreviousSetSeconds = Number.isFinite(previousEnd)
      ? Math.max(0, Math.round(((Number.isFinite(startedTimestamp) ? startedTimestamp : Date.parse(endedAt)) - previousEnd) / 1000))
      : undefined;
    const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter || {} : {};
    const savedSet: WorkoutSet = {
      ...set,
      id: id("set"),
      createdDate: set.createdDate || startedAt,
      completedDate: endedAt,
      startedAt,
      endedAt,
      restSeconds,
      exercisePath: exercise?.sourcePath,
      workoutPath: path || dailyNotePath || undefined,
      workoutPlanPath: typeof fm.workoutPlanPath === "string" ? fm.workoutPlanPath : this.settings.activeWorkoutPlanPath || undefined,
      setType: set.setType || exercise?.defaultSetType || "normal",
    };
    const logTarget = this.settings.activeWorkoutTarget || this.settings.workoutLogTarget;
    const sessionSetLine = workoutSetLine(savedSet, {
      asTask: this.settings.workoutSetStorage === "task",
      notation: this.settings.workoutSetNotation,
      includeExercise: this.settings.workoutExerciseLayout === "flat",
    });
    if ((logTarget === "session-note" || logTarget === "both") && file instanceof TFile) {
      await this.appendSetToWorkoutNote(file, savedSet, sessionSetLine);
      await this.updateActiveWorkoutSetFrontmatter(file, savedSet, timeSincePreviousSetSeconds);
    }
    if ((logTarget === "daily-note" || logTarget === "both") && dailyNotePath && this.settings.activeWorkoutId) {
      await this.appendNestedToDailyWorkout(dailyNotePath, this.settings.activeWorkoutId, workoutSetLine(savedSet));
    }
    this.settings.lastSetEndedAt = endedAt;
    this.settings.activeWorkoutSetCount = (this.settings.activeWorkoutSetCount || 0) + 1;
    await this.saveSettings();
    new Notice("Logged set");
    return savedSet;
  }

  async logFood(item: FoodItem, quantity: number, unit: string, section?: string, completedDate?: string, persistFoodNote = true): Promise<FoodLogEntry> {
    const loggedItem = persistFoodNote ? await this.findOrCreateFoodNote(item) : normalizeFoodMetricServing(item);
    const resolvedServing = resolveFoodLogServing(loggedItem, quantity, unit);
    const dailyFile = await this.getOrCreateDailyNoteForDate(completedDate);
    const entry: FoodLogEntry = {
      id: id("food"),
      createdDate: isoNow(),
      completedDate,
      item: loggedItem,
      quantity: resolvedServing.servings,
      unit: "serving",
      servingQuantity: resolvedServing.inputQuantity,
      servingUnit: resolvedServing.inputUnit,
      amount: resolvedServing.amount,
      amountUnit: resolvedServing.amountUnit,
      section,
      dailyNotePath: dailyFile.path,
    };
    if (this.settings.foodLogTarget === "daily-note") {
      await this.insertIntoDailyNote(foodEntryLine(entry), section || this.settings.defaultFoodLogSection, dailyFile);
    } else if (this.settings.foodLogTarget === "single-file") {
      await this.insertIntoFoodLogFile(foodEntryLine(entry), section || this.settings.defaultFoodLogSection);
    } else {
      throw new Error(`Unsupported food log target: ${this.settings.foodLogTarget}`);
    }
    if (this.settings.automaticDailyRollups) await this.updateDailyRollupForFile(dailyFile);
    await this.focusLineBeforeInsertedDailyLog(dailyFile, `[foodId:: ${entry.id}]`);
    new Notice("Logged food");
    return entry;
  }

  async createFoodNote(type: "food" | "recipe", name: string, nutrition: Nutrition, servingAmount = 1, servingUnit = "serving"): Promise<void> {
    await this.createFoodNoteFromItem({
      id: id(type),
      name,
      source: type === "recipe" ? "custom-note" : "manual",
      servingAmount,
      servingUnit,
      nutrition: nutritionWithMacroCalories(nutrition),
    }, type);
    new Notice(`Created ${type}`);
  }

  async createFoodNoteFromItem(item: FoodItem, type: "food" | "recipe" = "food"): Promise<FoodItem> {
    const folder = type === "recipe" ? this.settings.recipesFolder : this.settings.foodsFolder;
    await this.ensureFolder(folder);
    const path = await this.uniquePath(`${folder}/${sanitizeFileName(item.name)}.md`);
    const tag = type === "recipe" ? this.settings.recipeTag : this.settings.customFoodTag;
    const normalizedItem = normalizeFoodMetricServing({
      ...item,
      aliases: foodAliasesForItem(item),
      nutrition: shouldDeriveCaloriesForFood(item) ? nutritionWithMacroCalories(item.nutrition || {}) : item.nutrition,
    });
    const template = type === "food" ? await this.readFoodTemplate() : "";
    const body = template
      ? this.renderFoodTemplate(template, normalizedItem, type, tag)
      : this.defaultFoodNoteTemplate(normalizedItem, type, tag);
    await this.app.vault.create(path, body);
    return { ...normalizedItem, id: path, source: "custom-note", sourcePath: path };
  }

  private defaultFoodNoteTemplate(item: FoodItem, type: "food" | "recipe", tag: string): string {
    const nutrition = item.nutrition || {};
    return [
      "---",
      `kind: ${type}`,
      `name: "${item.name.replace(/"/g, '\\"')}"`,
      item.brand ? `brand: "${item.brand.replace(/"/g, '\\"')}"` : "",
      yamlStringList("aliases", foodAliasesForItem(item)),
      item.barcode ? `barcode: "${item.barcode}"` : "",
      item.imageUrl ? `imageUrl: "${item.imageUrl.replace(/"/g, '\\"')}"` : "",
      item.sourceImagePath ? `sourceImagePath: "${item.sourceImagePath.replace(/"/g, '\\"')}"` : "",
      `servingAmount: ${item.servingAmount || 1}`,
      `servingUnit: "${(item.servingUnit || "serving").replace(/"/g, '\\"')}"`,
      item.servingGrams ? `servingGrams: ${round(item.servingGrams)}` : "",
      item.servingMl ? `servingMl: ${round(item.servingMl)}` : "",
      item.confidence != null ? `confidence: ${item.confidence}` : "",
      `calories: ${nutrition.calories || 0}`,
      `proteinG: ${nutrition.proteinG || 0}`,
      `carbsG: ${nutrition.carbsG || 0}`,
      `fatG: ${nutrition.fatG || 0}`,
      `fiberG: ${nutrition.fiberG || 0}`,
      `sugarG: ${nutrition.sugarG || 0}`,
      `alcoholG: ${nutrition.alcoholG || 0}`,
      `sodiumMg: ${nutrition.sodiumMg || 0}`,
      "---",
      "",
      tag,
      "",
      item.ingredients ? `## Ingredients\n${item.ingredients}\n` : "",
      item.notes ? `## Notes\n${item.notes}\n` : "",
      type === "recipe" ? "## Ingredients\n- \n" : "",
    ].filter((line) => line !== "").join("\n");
  }

  private renderFoodTemplate(template: string, item: FoodItem, type: "food" | "recipe", tag: string): string {
    const nutrition = item.nutrition || {};
    const replacements: Record<string, string> = {
      name: item.name,
      brand: item.brand || "",
      aliases: foodAliasesForItem(item).join(", "),
      barcode: item.barcode || "",
      imageUrl: item.imageUrl || "",
      sourceImagePath: item.sourceImagePath || "",
      ingredients: item.ingredients || "",
      notes: item.notes || "",
      kind: type,
      tag,
      servingAmount: String(item.servingAmount || 1),
      servingUnit: item.servingUnit || "serving",
      servingGrams: item.servingGrams == null ? "" : String(round(item.servingGrams)),
      servingMl: item.servingMl == null ? "" : String(round(item.servingMl)),
      calories: String(nutrition.calories || 0),
      proteinG: String(nutrition.proteinG || 0),
      carbsG: String(nutrition.carbsG || 0),
      fatG: String(nutrition.fatG || 0),
      fiberG: String(nutrition.fiberG || 0),
      sugarG: String(nutrition.sugarG || 0),
      alcoholG: String(nutrition.alcoholG || 0),
      sodiumMg: String(nutrition.sodiumMg || 0),
      confidence: item.confidence == null ? "" : String(item.confidence),
    };
    return Object.entries(replacements).reduce(
      (output, [key, value]) => output.split(`{{${key}}}`).join(value),
      template,
    );
  }

  async findOrCreateFoodNote(item: FoodItem): Promise<FoodItem> {
    const existing = item.barcode ? this.findFoodByBarcode(item.barcode) : null;
    if (existing) return existing;
    const byName = this.findFoodByName(item.name, item.brand);
    if (byName) return byName;
    return this.createFoodNoteFromItem(item, "food");
  }

  private findFoodByName(name: string, brand?: string): FoodItem | null {
    const normalizedName = normalizeLookup(name);
    const normalizedBrand = normalizeLookup(brand || "");
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      if (
        fm.kind !== "food" &&
        fm.kind !== "recipe" &&
        fm.tpsType !== "health-food" &&
        fm.tpsType !== "health-recipe" &&
        !file.path.startsWith(`${this.settings.foodsFolder}/`) &&
        !file.path.startsWith(`${this.settings.recipesFolder}/`)
      ) continue;
      if (normalizeLookup(String(fm.name || file.basename)) !== normalizedName) continue;
      if (normalizedBrand && normalizeLookup(String(fm.brand || "")) !== normalizedBrand) continue;
      return this.foodFromFrontmatter(file, fm);
    }
    return null;
  }

  private resolveExistingFoodFile(path: string | undefined, item: FoodItem): TFile | null {
    if (path) {
      const byPath = this.app.vault.getAbstractFileByPath(path);
      if (byPath instanceof TFile) return byPath;
    }
    const byBarcode = item.barcode ? this.findFoodByBarcode(item.barcode) : null;
    if (byBarcode?.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(byBarcode.sourcePath);
      if (file instanceof TFile) return file;
    }
    const byName = this.findFoodByName(item.name, item.brand);
    if (byName?.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(byName.sourcePath);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  private async updateFoodNote(file: TFile, item: FoodItem, type: "food" | "recipe"): Promise<void> {
    const normalized = normalizeFoodMetricServing(item);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, foodFrontmatter(normalized, type));
    });
  }

  private async openPath(path?: string): Promise<void> {
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
  }

  private async openPinnedWorkoutFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    leaf.setPinned?.(true);
  }

  async searchFoods(query: string): Promise<FoodItem[]> {
    const [custom, curated, usda, openFoodFacts, loggedStats] = await Promise.all([
      this.searchCustomFoods(query),
      Promise.resolve(searchCuratedFoods(query)),
      this.withTimeout(this.searchUsdaFoods(query), 1500, []),
      this.withTimeout(this.searchOpenFoodFacts(query), this.settings.includeBrandedFoodSearch ? 5000 : 3000, []),
      this.getLoggedFoodStats(query),
    ]);
    const baseResults = rankFoodSearchResults(query, dedupeFoods([...custom, ...curated, ...usda, ...openFoodFacts]), loggedStats);
    return baseResults.slice(0, 30);
  }

  async getLoggedFoodStats(query: string): Promise<Map<string, FoodUsageStats>> {
    const tokens = normalizeLookup(query).split(" ").filter((token) => token.length > 1);
    const stats = new Map<string, FoodUsageStats>();
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path === normalizePath(this.settings.foodLogFilePath || "") || file.path.startsWith(`${normalizePath(this.settings.dailyNoteFolder || "")}/`) || /^Dailynotes\//i.test(file.path));
    for (const file of files) {
      let content = "";
      try {
        content = await this.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      for (const line of content.split("\n")) {
        if (!isFoodLogLine(line)) continue;
        const name = readStringField(line, "food") || foodNameFromFoodLogSummary(line);
        if (!name) continue;
        const brand = readStringField(line, "brand");
        const barcode = readStringField(line, "barcode");
        const foodPath = readStringField(line, "foodPath");
        const searchable = normalizeLookup([name, brand, foodPath].filter(Boolean).join(" "));
        if (tokens.length && !tokens.some((token) => searchable.includes(token))) continue;
        const completed = readStringField(line, "completedDate") || readStringField(line, "createdDate") || "";
        for (const key of foodUsageKeys({ name, brand, barcode, sourcePath: foodPath } as FoodItem)) {
          const entry = stats.get(key) || { count: 0, lastLoggedAt: "" };
          entry.count += 1;
          if (completed && completed > entry.lastLoggedAt) entry.lastLoggedAt = completed;
          stats.set(key, entry);
        }
      }
    }
    return stats;
  }

  async logFoodFromInput(input: LogFoodInput): Promise<FoodLogEntry> {
    const item = await this.resolveFoodInput(input);
    return this.logFood(
      item,
      input.servingQuantity ?? input.quantity ?? 1,
      input.servingUnit ?? input.unit ?? "serving",
      input.section,
      input.completedDate,
      input.createFoodNote !== false
    );
  }

  async createFoodFromInput(input: CreateFoodInput): Promise<FoodItem> {
    return this.createFoodNoteFromItem({
      id: id(input.type || "food"),
      name: input.name,
      brand: input.brand,
      aliases: input.aliases,
      barcode: input.barcode,
      imageUrl: input.imageUrl,
      sourceImagePath: input.sourceImagePath,
      ingredients: input.ingredients,
      servingAmount: input.servingAmount || 1,
      servingUnit: input.servingUnit || "serving",
      servingGrams: input.servingGrams,
      servingMl: input.servingMl,
      source: "manual",
      confidence: input.confidence,
      notes: input.notes,
      nutrition: nutritionWithMacroCalories(input.nutrition || {}),
    }, input.type || "food");
  }

  async upsertFoodFromInput(input: UpsertFoodInput): Promise<FoodItem> {
    const item = foodItemFromInput(input);
    const type = input.type || "food";
    const file = this.resolveExistingFoodFile(input.path, item);
    if (!file || input.merge === false) {
      const created = await this.createFoodNoteFromItem(item, type);
      if (input.openFile) await this.openPath(created.sourcePath);
      return created;
    }
    await this.updateFoodNote(file, item, type);
    const updated = this.foodFromFrontmatter(file, {
      ...(this.app.metadataCache.getFileCache(file)?.frontmatter || {}),
      ...foodFrontmatter(item, type),
    });
    if (input.openFile) await this.openPath(file.path);
    return updated;
  }

  async createFoodFromLabel(input: FoodLabelInput): Promise<FoodItem> {
    const serving = input.servingSizeText && !input.servingGrams && !input.servingMl
      ? parseMetricServing(1, input.servingSizeText)
      : null;
    return this.upsertFoodFromInput({
      ...input,
      sourceImagePath: input.sourceImagePath || input.labelImagePath,
      servingUnit: input.servingUnit || input.servingSizeText || "serving",
      servingGrams: input.servingGrams ?? (serving?.unit === "g" ? serving.amount : undefined),
      servingMl: input.servingMl ?? (serving?.unit === "ml" ? serving.amount : undefined),
      merge: input.merge ?? true,
    });
  }

  async logFoodByName(input: LogFoodByNameInput): Promise<FoodLogEntry> {
    const existing = this.findFoodByName(input.name, input.brand);
    if (existing) {
      return this.logFoodFromInput({ ...input, item: existing });
    }
    return this.logFoodFromInput({ ...input, query: [input.brand, input.name].filter(Boolean).join(" ") });
  }

  async searchExercises(query: string): Promise<ExerciseItem[]> {
    const lowered = query.toLowerCase();
    return this.app.vault.getMarkdownFiles()
      .map((file) => ({ file, cache: this.app.metadataCache.getFileCache(file) }))
      .filter(({ file, cache }) => {
        const tags = cache?.tags?.map((tag) => tag.tag) || [];
        const fm = cache?.frontmatter || {};
        return tags.includes(this.settings.exerciseTag) ||
          fm.kind === "exercise" ||
          fm.tpsType === "health-exercise" ||
          file.path.startsWith(`${this.settings.exercisesFolder}/`);
      })
      .filter(({ file, cache }) => `${cache?.frontmatter?.name || file.basename}`.toLowerCase().includes(lowered))
      .map(({ file, cache }) => this.exerciseFromFrontmatter(file, cache?.frontmatter || {}));
  }

  async createExercise(input: CreateExerciseInput): Promise<ExerciseItem> {
    await this.ensureFolder(this.settings.exercisesFolder);
    const path = await this.uniquePath(`${this.settings.exercisesFolder}/${sanitizeFileName(input.name)}.md`);
    const template = await this.readExerciseTemplate();
    const body = template ? this.renderExerciseTemplate(template, input) : this.defaultExerciseTemplate(input);
    await this.app.vault.create(path, body);
    return {
      id: path,
      name: input.name,
      sourcePath: path,
      category: input.category || "strength",
      primaryMuscles: input.primaryMuscles || [],
      secondaryMuscles: input.secondaryMuscles || [],
      equipment: input.equipment || [],
      defaultRestSeconds: input.defaultRestSeconds || this.settings.defaultRestSeconds,
      defaultSetType: input.defaultSetType || "normal",
      recommendedRestDays: input.recommendedRestDays,
      notes: input.notes,
    };
  }

  async findOrCreateExercise(input: CreateExerciseInput): Promise<ExerciseItem> {
    const existing = this.findExercise(input.name);
    if (existing) return existing;
    return this.createExercise(input);
  }

  async upsertExercise(input: UpsertExerciseInput): Promise<ExerciseItem> {
    const file = input.path
      ? this.app.vault.getAbstractFileByPath(input.path)
      : this.findExercise(input.name)?.sourcePath
        ? this.app.vault.getAbstractFileByPath(this.findExercise(input.name)?.sourcePath || "")
        : null;
    if (!(file instanceof TFile) || input.merge === false) return this.createExercise(input);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, exerciseFrontmatter(input, this.settings.defaultRestSeconds));
    });
    return this.exerciseFromFrontmatter(file, {
      ...(this.app.metadataCache.getFileCache(file)?.frontmatter || {}),
      ...exerciseFrontmatter(input, this.settings.defaultRestSeconds),
    });
  }

  async searchWorkoutPlans(query: string): Promise<WorkoutPlanItem[]> {
    const lowered = query.toLowerCase();
    return this.app.vault.getMarkdownFiles()
      .map((file) => ({ file, cache: this.app.metadataCache.getFileCache(file) }))
      .filter(({ file, cache }) => {
        const fm = cache?.frontmatter || {};
        return fm.tpsType === "health-workout-plan" ||
          fm.tpsType === "health-routine" ||
          fm.kind === "workout-plan" ||
          file.path.startsWith(`${this.settings.workoutPlansFolder}/`);
      })
      .filter(({ file, cache }) => `${cache?.frontmatter?.name || cache?.frontmatter?.title || file.basename}`.toLowerCase().includes(lowered))
      .map(({ file, cache }) => this.workoutPlanFromFrontmatter(file, cache?.frontmatter || {}));
  }

  async createWorkoutPlan(input: CreateWorkoutPlanInput): Promise<WorkoutPlanItem> {
    await this.ensureFolder(this.settings.workoutPlansFolder);
    const path = await this.uniquePath(`${this.settings.workoutPlansFolder}/${sanitizeFileName(input.name)}.md`);
    const template = await this.readWorkoutPlanTemplate();
    const body = template ? this.renderWorkoutPlanTemplate(template, input) : this.defaultWorkoutPlanTemplate(input);
    await this.app.vault.create(path, body);
    return {
      id: path,
      name: input.name,
      sourcePath: path,
      cooldownDays: input.cooldownDays ?? this.settings.defaultWorkoutCooldownDays,
      defaultRestSeconds: input.defaultRestSeconds ?? this.settings.defaultRestSeconds,
      notes: input.notes,
    };
  }

  async findOrCreateWorkoutPlan(input: CreateWorkoutPlanInput): Promise<WorkoutPlanItem> {
    const existing = this.findWorkoutPlan(input.name);
    if (existing) return existing;
    return this.createWorkoutPlan(input);
  }

  async upsertWorkoutPlan(input: UpsertWorkoutPlanInput): Promise<WorkoutPlanItem> {
    const file = input.path
      ? this.app.vault.getAbstractFileByPath(input.path)
      : this.findWorkoutPlan(input.name)?.sourcePath
        ? this.app.vault.getAbstractFileByPath(this.findWorkoutPlan(input.name)?.sourcePath || "")
        : null;
    if (!(file instanceof TFile) || input.merge === false) return this.createWorkoutPlan(input);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, workoutPlanFrontmatter(input, this.settings.defaultWorkoutCooldownDays, this.settings.defaultRestSeconds));
    });
    return this.workoutPlanFromFrontmatter(file, {
      ...(this.app.metadataCache.getFileCache(file)?.frontmatter || {}),
      ...workoutPlanFrontmatter(input, this.settings.defaultWorkoutCooldownDays, this.settings.defaultRestSeconds),
    });
  }

  private async searchCustomFoods(query: string): Promise<FoodItem[]> {
    const normalized = normalizeLookup(query);
    return this.app.vault.getMarkdownFiles()
      .map((file) => ({ file, cache: this.app.metadataCache.getFileCache(file) }))
      .filter(({ file, cache }) => {
        const tags = cache?.tags?.map((tag) => tag.tag) || [];
        const fm = cache?.frontmatter || {};
        return tags.includes(this.settings.customFoodTag) ||
          tags.includes(this.settings.recipeTag) ||
          fm.kind === "food" ||
          fm.kind === "recipe" ||
          fm.tpsType === "health-food" ||
          fm.tpsType === "health-recipe" ||
          file.path.startsWith(`${this.settings.foodsFolder}/`) ||
          file.path.startsWith(`${this.settings.recipesFolder}/`);
      })
      .map(({ file, cache }) => {
        const fm = cache?.frontmatter || {};
        return this.foodFromFrontmatter(file, fm);
      })
      .filter((item) => isRelevantFoodResult(normalized, foodSearchFields(item)))
      .sort((a, b) => foodSearchScore(b, normalized) - foodSearchScore(a, normalized));
  }

  foodFromFrontmatter(file: TFile, fm: any): FoodItem {
    return normalizeFoodMetricServing({
      id: file.path,
      name: String(fm.name || file.basename),
      brand: fm.brand ? String(fm.brand) : undefined,
      aliases: aliasesFromFrontmatter(fm.aliases),
      barcode: fm.barcode ? String(fm.barcode) : undefined,
      imageUrl: fm.imageUrl ? String(fm.imageUrl) : undefined,
      sourceImagePath: fm.sourceImagePath ? String(fm.sourceImagePath) : undefined,
      ingredients: fm.ingredients ? String(fm.ingredients) : undefined,
      servingAmount: Number(fm.servingAmount || 1),
      servingUnit: String(fm.servingUnit || "serving"),
      servingGrams: numberOrUndefined(fm.servingGrams),
      servingMl: numberOrUndefined(fm.servingMl),
      source: "custom-note",
      sourcePath: file.path,
      confidence: numberOrUndefined(fm.confidence),
      notes: fm.notes ? String(fm.notes) : undefined,
      nutrition: {
        calories: numberOrUndefined(fm.calories),
        proteinG: numberOrUndefined(fm.proteinG),
        carbsG: numberOrUndefined(fm.carbsG),
        fatG: numberOrUndefined(fm.fatG),
        fiberG: numberOrUndefined(fm.fiberG),
        sugarG: numberOrUndefined(fm.sugarG),
        alcoholG: numberOrUndefined(fm.alcoholG),
        sodiumMg: numberOrUndefined(fm.sodiumMg),
      },
    });
  }

  private async searchOpenFoodFacts(query: string): Promise<FoodItem[]> {
    if (!query.trim()) return [];
    try {
      const results = await Promise.all(foodSearchQueryVariants(query).map((candidate) => this.searchOpenFoodFactsSearch(candidate)));
      return dedupeFoods(results.flat());
    } catch (error) {
      console.warn("TPS Health food search failed", error);
      return [];
    }
  }

  private async searchOpenFoodFactsSearch(query: string): Promise<FoodItem[]> {
    const params = new URLSearchParams({
      q: query,
      page_size: "20",
      fields: "code,product_name,product_name_en,brands,categories,categories_tags,serving_quantity,serving_size,nutriments,image_small_url,image_thumb_url,ingredients_text",
    });
    const response = await requestUrl({
      url: `https://search.openfoodfacts.org/search?${params.toString()}`,
      headers: this.foodFactsHeaders(),
    });
    const hits = Array.isArray(response.json?.hits) ? response.json.hits : [];
    return hits
      .filter((product: any) => product.product_name || product.product_name_en)
      .filter((product: any) => hasMacroData(product.nutriments))
      .filter((product: any) => isRelevantFoodResult(query, [product.product_name, product.product_name_en, product.brands]))
      .map((product: any) => this.foodFactsSearchProductToItem(product));
  }

  private foodFactsSearchProductToItem(product: any): FoodItem {
    const brands = Array.isArray(product.brands) ? product.brands.join(", ") : product.brands;
    const serving = foodFactsServing(product);
    return normalizeFoodMetricServing({
      id: String(product.code || id("off")),
      name: String(product.product_name || product.product_name_en),
      brand: brands ? String(brands) : undefined,
      barcode: product.code ? String(product.code) : undefined,
      imageUrl: product.image_small_url || product.image_thumb_url || undefined,
      ingredients: product.ingredients_text ? String(product.ingredients_text) : undefined,
      servingAmount: 1,
      servingUnit: serving.unit,
      servingGrams: serving.grams,
      servingMl: serving.ml,
      source: "open-food-facts",
      nutrition: foodFactsNutrition(product, serving),
    });
  }

  private async searchUsdaFoods(query: string): Promise<FoodItem[]> {
    if (!query.trim()) return [];
    try {
      const queries = foodSearchQueryVariants(query);
      const foods: any[] = [];
      for (const candidate of queries.slice(0, 3)) {
        if (foods.length < 8) foods.push(...await this.searchUsdaByDataTypes(candidate, ["Foundation"], 8 - foods.length));
        if (foods.length < 8) foods.push(...await this.searchUsdaByDataTypes(candidate, ["SR Legacy", "Survey (FNDDS)"], 8 - foods.length));
        if (foods.length < 12) foods.push(...await this.searchUsdaByDataTypes(candidate, ["Branded"], 12 - foods.length));
      }
      return foods
        .filter((food: any) => food.description)
        .map((food: any) => {
          const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
          return {
            id: `usda-${food.fdcId}`,
            name: titleCase(String(food.description).toLowerCase()),
            brand: food.brandOwner ? String(food.brandOwner) : undefined,
            servingAmount: 1,
            servingUnit: "100 g",
            source: "usda",
            nutrition: {
              calories: nutrientValue(nutrients, [1008, 2047, 2048]),
              proteinG: nutrientValue(nutrients, [1003]),
              carbsG: nutrientValue(nutrients, [1005]),
              fatG: nutrientValue(nutrients, [1004]),
              fiberG: nutrientValue(nutrients, [1079]),
              sugarG: nutrientValue(nutrients, [2000]),
              alcoholG: nutrientValue(nutrients, [1018]),
              sodiumMg: nutrientValue(nutrients, [1093]),
            },
          } as FoodItem;
        });
    } catch (error) {
      console.warn("TPS Health USDA search failed", error);
      return [];
    }
  }

  private async searchUsdaByDataTypes(query: string, dataType: string[], pageSize: number): Promise<any[]> {
    const response = await requestUrl({
      url: `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(this.settings.usdaApiKey)}`,
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.trim(),
        dataType,
        pageSize,
        pageNumber: 1,
        requireAllWords: false,
      }),
    });
    return Array.isArray(response.json?.foods) ? response.json.foods : [];
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> {
    let timeoutId: number | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(timeoutValue), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }

  async lookupOpenFoodFactsBarcode(barcode: string): Promise<FoodItem | null> {
    const candidates = barcodeCandidates(barcode);
    for (const code of candidates) {
      const item = await this.lookupOpenFoodFactsBarcodeCandidate(code);
      if (item) return item;
    }
    return null;
  }

  async enrichFoodSearchItem(item: FoodItem): Promise<FoodItem> {
    if (item.source !== "open-food-facts" || !item.barcode) return item;
    try {
      const full = await this.lookupOpenFoodFactsBarcode(item.barcode);
      return full ? { ...item, ...full, id: item.id || full.id } : item;
    } catch (error) {
      console.warn("TPS Health Open Food Facts enrichment failed", error);
      return item;
    }
  }

  private async lookupOpenFoodFactsBarcodeCandidate(code: string): Promise<FoodItem | null> {
    if (!code) return null;
    const response = await requestUrl({
      url: `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,brands,categories,categories_tags,serving_quantity,serving_size,nutriments,image_url,ingredients_text`,
      headers: this.foodFactsHeaders(),
    });
    if (response.json?.status !== 1 || !response.json?.product) {
      const fallback = await requestUrl({
        url: `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
        headers: this.foodFactsHeaders(),
      });
      if (fallback.json?.status !== 1 || !fallback.json?.product) return null;
      return this.foodFactsProductToItem(fallback.json.product, code);
    }
    return this.foodFactsProductToItem(response.json.product, code);
  }

  private foodFactsProductToItem(product: any, code: string): FoodItem {
    const serving = foodFactsServing(product);
    return normalizeFoodMetricServing({
      id: String(product.code || code),
      name: String(product.product_name || `Barcode ${code}`),
      brand: product.brands ? String(product.brands) : undefined,
      barcode: String(product.code || code),
      imageUrl: product.image_url ? String(product.image_url) : undefined,
      ingredients: product.ingredients_text ? String(product.ingredients_text) : undefined,
      servingAmount: 1,
      servingUnit: serving.unit,
      servingGrams: serving.grams,
      servingMl: serving.ml,
      source: "open-food-facts",
      nutrition: foodFactsNutrition(product, serving),
    });
  }

  private foodFactsHeaders(): Record<string, string> {
    return {
      "Accept": "application/json",
      "User-Agent": this.settings.openFoodFactsUserAgent,
    };
  }

  private findFoodByBarcode(barcode: string): FoodItem | null {
    const normalized = barcode.replace(/\D/g, "");
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      if (String(fm.barcode || "").replace(/\D/g, "") === normalized) {
        return this.foodFromFrontmatter(file, { ...fm, barcode: normalized });
      }
    }
    return null;
  }

  async getDailyRollup(): Promise<DailyRollup> {
    const file = await this.getOrCreateDailyNote();
    const content = await this.readDailyFoodRollupContent(file);
    return this.calculateFoodTotals(content, file.path);
  }

  async countFoodLogsInFile(file: TFile): Promise<number> {
    const content = await this.app.vault.read(file);
    return content.split("\n").filter((line) => isFoodLogLine(line)).length;
  }

  async updateDailyRollup(): Promise<DailyRollup> {
    const file = await this.getOrCreateDailyNote();
    return this.updateDailyRollupForFile(file);
  }

  private async updateDailyRollupForFile(file: TFile): Promise<DailyRollup> {
    const content = await this.app.vault.read(file);
    const totals = await this.calculateFoodTotals(await this.readDailyFoodRollupContent(file), file.path);
    const cleaned = removeLegacyRollupBlock(content, this.settings.rollupHeading);
    if (cleaned !== content) await this.app.vault.modify(file, cleaned);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter.tpsHealthCalories;
      delete frontmatter.tpsHealthProteinG;
      delete frontmatter.tpsHealthCarbsG;
      delete frontmatter.tpsHealthFatG;
      delete frontmatter.tpsHealthFiberG;
      delete frontmatter.tpsHealthSugarG;
      delete frontmatter.tpsHealthAlcoholG;
      delete frontmatter.tpsHealthSodiumMg;
      delete frontmatter.tpsHealthUpdatedAt;
      const goalKeys = new Set(this.settings.healthGoals.map((goal) => goal.propertyKey));
      for (const key of FOOD_ROLLUP_PROPERTY_KEYS) {
        if (!goalKeys.has(key)) delete frontmatter[key];
      }
      for (const goal of this.settings.healthGoals) {
        const value = foodRollupValue(totals, goal.propertyKey);
        if (value != null) frontmatter[goal.propertyKey] = round(value);
      }
      frontmatter.healthUpdatedAt = isoNow();
    });
    return totals;
  }

  private calculateFoodTotals(content: string, dailyNotePath?: string): Required<Nutrition> {
    return calculateFoodTotals(content, (foodPath) => {
      const file = this.app.vault.getAbstractFileByPath(foodPath);
      if (!(file instanceof TFile)) return null;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      return this.foodFromFrontmatter(file, fm);
    }, dailyNotePath);
  }

  private async readDailyFoodRollupContent(dailyFile: TFile): Promise<string> {
    const dailyContent = await this.app.vault.read(dailyFile);
    if (this.settings.foodLogTarget !== "single-file") return dailyContent;
    const logFile = await this.getFoodLogFile(false);
    if (!logFile) return dailyContent;
    return `${dailyContent}\n${await this.app.vault.read(logFile)}`;
  }

  private async insertIntoDailyNote(line: string, section?: string, targetFile?: TFile): Promise<TFile> {
    const file = targetFile || await this.getOrCreateDailyNote();
    if (section?.trim()) return this.appendToDailyHeading(section.trim(), line, file);
    const content = await this.app.vault.read(file);
    const insertAt = frontmatterEndIndex(content);
    const before = content.slice(0, insertAt);
    const after = content.slice(insertAt).replace(/^\n*/, "");
    const prefix = before ? `${before.replace(/\n*$/, "\n")}\n` : "";
    await this.app.vault.modify(file, `${prefix}${line}\n${after ? `\n${after}` : ""}`);
    return file;
  }

  private async appendToDailyHeading(heading: string, line: string, targetFile?: TFile): Promise<TFile> {
    const file = targetFile || await this.getOrCreateDailyNote();
    const content = await this.app.vault.read(file);
    const marker = `## ${heading}`;
    if (!content.includes(marker)) {
      await this.app.vault.modify(file, `${content.trimEnd()}\n\n${marker}\n\n${line}\n`);
      return file;
    }
    const index = content.indexOf(marker) + marker.length;
    const before = content.slice(0, index);
    const after = content.slice(index);
    await this.app.vault.modify(file, `${before}${after.startsWith("\n") ? "" : "\n"}\n${line}${after}`);
    return file;
  }

  private async insertIntoFoodLogFile(line: string, section?: string): Promise<TFile> {
    const file = await this.getFoodLogFile(true);
    if (!file) throw new Error("Food log file is not available");
    if (section?.trim()) return this.appendToHeading(file, section.trim(), line);
    await this.app.vault.append(file, `${line}\n`);
    return file;
  }

  private async getFoodLogFile(create: boolean): Promise<TFile | null> {
    const path = normalizePath((this.settings.foodLogFilePath || DEFAULT_SETTINGS.foodLogFilePath).trim());
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (!create) return null;
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder) await this.ensureFolder(folder);
    return this.app.vault.create(path, "");
  }

  private async appendToHeading(file: TFile, heading: string, line: string): Promise<TFile> {
    const content = await this.app.vault.read(file);
    const marker = `## ${heading}`;
    if (!content.includes(marker)) {
      await this.app.vault.modify(file, `${content.trimEnd()}\n\n${marker}\n\n${line}\n`);
      return file;
    }
    const index = content.indexOf(marker) + marker.length;
    const before = content.slice(0, index);
    const after = content.slice(index);
    await this.app.vault.modify(file, `${before}${after.startsWith("\n") ? "" : "\n"}\n${line}${after}`);
    return file;
  }

  private async focusLineBeforeInsertedDailyLog(file: TFile, marker: string): Promise<void> {
    await sleep(120);
    const content = await this.app.vault.cachedRead(file);
    const lineIndex = content.split(/\r?\n/).findIndex((line) => line.includes(marker));
    if (lineIndex < 0) return;
    const cursorLine = Math.max(0, lineIndex - 1);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true } as any);
    const view = leaf.view as MarkdownView;
    const editor = view?.editor;
    if (!editor) return;
    editor.setCursor({ line: cursorLine, ch: 0 });
    editor.scrollIntoView?.({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
    editor.focus?.();
  }

  private async insertWorkoutSessionIntoDailyNote(line: string, dateValue?: string): Promise<TFile> {
    return this.insertIntoDailyNote(line, this.settings.workoutLogHeading, await this.getOrCreateDailyNoteForDate(dateValue));
  }

  private async appendNestedToDailyWorkout(dailyNotePath: string, workoutId: string, line: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
    if (!(file instanceof TFile)) throw new Error(`Daily note not found: ${dailyNotePath}`);
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const parentIndex = lines.findIndex((candidate) => candidate.includes(`[workoutId:: ${workoutId}]`));
    if (parentIndex < 0) {
      await this.app.vault.append(file, `\n${line}\n`);
      return;
    }
    const parentIndent = leadingSpaces(lines[parentIndex]);
    let insertIndex = parentIndex + 1;
    while (insertIndex < lines.length) {
      const candidate = lines[insertIndex];
      if (candidate.trim() && leadingSpaces(candidate) <= parentIndent && candidate.trimStart().startsWith("- ")) break;
      insertIndex++;
    }
    lines.splice(insertIndex, 0, `  ${line}`);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async appendSetToWorkoutNote(file: TFile, set: WorkoutSet, line: string): Promise<void> {
    if (this.settings.workoutExerciseLayout === "flat") {
      await this.app.vault.append(file, `${line}\n`);
      return;
    }
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    if (this.settings.workoutExerciseLayout === "exercise-headings") {
      const heading = `### ${workoutExerciseLabel(set)}`;
      let headingIndex = lines.findIndex((candidate) => candidate.trim() === heading);
      if (headingIndex < 0) {
        if (lines.length && lines[lines.length - 1].trim()) lines.push("");
        lines.push(heading);
        headingIndex = lines.length - 1;
      }
      let insertIndex = headingIndex + 1;
      while (insertIndex < lines.length && !/^#{1,6}\s+/.test(lines[insertIndex].trim())) insertIndex++;
      lines.splice(insertIndex, 0, line);
      await this.app.vault.modify(file, lines.join("\n"));
      return;
    }

    const parentLine = `- ${workoutExerciseLabel(set)}`;
    let parentIndex = lines.findIndex((candidate) => candidate.trim() === parentLine);
    if (parentIndex < 0) {
      if (lines.length && lines[lines.length - 1].trim()) lines.push("");
      lines.push(parentLine);
      parentIndex = lines.length - 1;
    }
    let insertIndex = parentIndex + 1;
    const parentIndent = leadingSpaces(lines[parentIndex]);
    while (insertIndex < lines.length) {
      const candidate = lines[insertIndex];
      if (candidate.trim() && leadingSpaces(candidate) <= parentIndent && candidate.trimStart().startsWith("- ")) break;
      insertIndex++;
    }
    lines.splice(insertIndex, 0, `  ${line}`);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async completeDailyWorkoutLine(dailyNotePath: string, workoutId: string, endedAt: string, nextEligibleDate?: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const index = lines.findIndex((candidate) => candidate.includes(`[workoutId:: ${workoutId}]`));
    if (index < 0) return;
    let line = lines[index];
    line = replaceDataviewField(line, "status", "complete");
    line = upsertDataviewField(line, "completedDate", endedAt);
    line = upsertDataviewField(line, "endedAt", endedAt);
    if (nextEligibleDate) line = upsertDataviewField(line, "nextEligibleDate", nextEligibleDate);
    lines[index] = line;
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private async ensureWorkoutSessionFrontmatter(path: string, title: string, startedAt: string, plan: WorkoutPlanItem | null, cooldownDays: number, workoutId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.kind = frontmatter.kind || "workout";
      frontmatter.workoutId = frontmatter.workoutId || workoutId;
      frontmatter.title = frontmatter.title || title;
      if (plan?.sourcePath) frontmatter.workoutPlanPath = frontmatter.workoutPlanPath || plan.sourcePath;
      if (plan?.name) frontmatter.workoutPlan = frontmatter.workoutPlan || plan.name;
      frontmatter.startedAt = frontmatter.startedAt || startedAt;
      frontmatter.scheduled = frontmatter.scheduled || startedAt;
      frontmatter.status = frontmatter.status || "active";
      frontmatter.allDay = frontmatter.allDay ?? false;
      frontmatter.cssclasses = withCssClass(frontmatter.cssclasses, "tps-health-workout");
      frontmatter.cooldownDays = frontmatter.cooldownDays ?? cooldownDays;
      frontmatter.setCount = frontmatter.setCount ?? 0;
    });
  }

  private async updateActiveWorkoutSetFrontmatter(file: TFile, set: WorkoutSet, timeSincePreviousSetSeconds?: number): Promise<void> {
    const setCount = (this.settings.activeWorkoutSetCount || 0) + 1;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.kind = frontmatter.kind || "workout";
      frontmatter.status = frontmatter.status || "active";
      frontmatter.scheduled = frontmatter.scheduled || this.settings.activeWorkoutStartedAt || set.startedAt || set.endedAt;
      frontmatter.allDay = false;
      frontmatter.cssclasses = withCssClass(frontmatter.cssclasses, "tps-health-workout");
      frontmatter.lastSetStartedAt = set.startedAt || set.endedAt;
      frontmatter.lastSetEndedAt = set.endedAt;
      if (set.restSeconds != null) frontmatter.lastRestSeconds = set.restSeconds;
      if (timeSincePreviousSetSeconds != null) frontmatter.lastTimeBetweenSetsSeconds = timeSincePreviousSetSeconds;
      frontmatter.setCount = Math.max(numberOrUndefined(frontmatter.setCount) || 0, setCount);
    });
  }

  private registerWorkoutTaskCompletionTracking(): void {
    this.app.workspace.onLayoutReady(() => {
      const file = this.app.workspace.getActiveFile();
      if (file) void this.cacheWorkoutFile(file);
    });
    window.setTimeout(() => {
      const file = this.app.workspace.getActiveFile();
      if (file) void this.cacheWorkoutFile(file);
    }, 750);
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file) void this.cacheWorkoutFile(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      void this.handleWorkoutFileModify(file);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      void this.handleWorkoutFileModify(file);
    }));
  }

  private async cacheWorkoutFile(file: TFile): Promise<void> {
    if (!(await this.isWorkoutFile(file))) return;
    this.workoutFileSnapshots.set(file.path, await this.app.vault.cachedRead(file));
  }

  private async handleWorkoutFileModify(file: TFile): Promise<void> {
    if (this.processingWorkoutFiles.has(file.path)) return;
    if (!(await this.isWorkoutFile(file))) {
      this.workoutFileSnapshots.delete(file.path);
      return;
    }

    const current = await this.app.vault.cachedRead(file);
    const previous = this.workoutFileSnapshots.get(file.path);
    this.workoutFileSnapshots.set(file.path, current);

    const currentLines = current.split("\n");
    const completedIndexes: number[] = [];
    if (!previous) {
      for (let index = 0; index < currentLines.length; index++) {
        if (isCheckedWorkoutTaskLine(currentLines[index]) && !currentLines[index].includes("[setId::")) completedIndexes.push(index);
      }
    } else {
      const previousLines = previous.split("\n");
      for (let index = 0; index < currentLines.length; index++) {
        const previousLine = previousLines[index] || "";
        const currentLine = currentLines[index] || "";
        if (isCheckedWorkoutTaskLine(currentLine) && !isCheckedWorkoutTaskLine(previousLine) && !currentLine.includes("[setId::")) {
          completedIndexes.push(index);
        }
      }
    }
    if (!completedIndexes.length) return;

    const result = await this.annotateCompletedWorkoutTasks(file, currentLines, completedIndexes);
    if (!result.changed) return;

    this.processingWorkoutFiles.add(file.path);
    try {
      await this.app.vault.modify(file, result.lines.join("\n"));
      this.workoutFileSnapshots.set(file.path, result.lines.join("\n"));
      await this.updateWorkoutTaskCompletionFrontmatter(file, result.lastCompletedAt, result.setCount, result.lastRestSeconds);
    } finally {
      this.processingWorkoutFiles.delete(file.path);
    }

    if (result.completedLastPlannedSet) this.promptFinishWorkoutAfterLastSet(file);
  }

  private async annotateCompletedWorkoutTasks(file: TFile, lines: string[], completedIndexes: number[]): Promise<{ changed: boolean; lines: string[]; lastCompletedAt: string; lastRestSeconds?: number; setCount: number; completedLastPlannedSet: boolean }> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const workoutPlanPath = typeof fm.workoutPlanPath === "string" ? fm.workoutPlanPath : this.settings.activeWorkoutPlanPath || "";
    const activeWorkoutId = typeof fm.workoutId === "string" ? fm.workoutId : this.settings.activeWorkoutId;
    let previousEndedAt = latestCompletedSetEndedAt(lines, completedIndexes[0]);
    let changed = false;
    let lastCompletedAt = "";
    let lastRestSeconds: number | undefined;

    for (const index of completedIndexes) {
      const completedAt = isoNow();
      const restSeconds = previousEndedAt ? secondsBetween(previousEndedAt, completedAt) : 0;
      const parsed = parseWorkoutTaskSetLine(lines[index]);
      let nextLine = lines[index];
      nextLine = upsertDataviewField(nextLine, "exercise", parsed.exercise || "Set");
      nextLine = upsertDataviewField(nextLine, "workout", pathLabel(file.path));
      nextLine = upsertDataviewField(nextLine, "workoutPath", file.path);
      if (workoutPlanPath) {
        nextLine = upsertDataviewField(nextLine, "workoutPlan", pathLabel(workoutPlanPath));
        nextLine = upsertDataviewField(nextLine, "workoutPlanPath", workoutPlanPath);
      }
      nextLine = upsertDataviewField(nextLine, "setId", id("set"));
      nextLine = upsertDataviewField(nextLine, "createdDate", completedAt);
      nextLine = upsertDataviewField(nextLine, "completedDate", completedAt);
      nextLine = upsertDataviewField(nextLine, "startedAt", completedAt);
      nextLine = upsertDataviewField(nextLine, "endedAt", completedAt);
      nextLine = upsertDataviewField(nextLine, "rest", restSeconds);
      if (parsed.setType) nextLine = upsertDataviewField(nextLine, "setType", parsed.setType);
      if (parsed.reps != null) nextLine = upsertDataviewField(nextLine, "reps", parsed.reps);
      if (parsed.weight != null) nextLine = upsertDataviewField(nextLine, "weight", parsed.weight);
      if (parsed.weightUnit) nextLine = upsertDataviewField(nextLine, "unit", parsed.weightUnit);
      if (parsed.supersetGroupId) nextLine = upsertDataviewField(nextLine, "superset", parsed.supersetGroupId);
      if (parsed.dropSetGroupId) nextLine = upsertDataviewField(nextLine, "dropSet", parsed.dropSetGroupId);
      lines[index] = nextLine;
      previousEndedAt = completedAt;
      lastCompletedAt = completedAt;
      lastRestSeconds = restSeconds;
      changed = true;
    }

    const setCount = lines.filter((line) => isCheckedWorkoutTaskLine(line) && line.includes("[setId::")).length;
    const completedLastPlannedSet = activeWorkoutId === this.settings.activeWorkoutId
      && this.settings.activeWorkoutPath === file.path
      && !hasUncheckedPlannedWorkoutTask(lines);
    return { changed, lines, lastCompletedAt, lastRestSeconds, setCount, completedLastPlannedSet };
  }

  private async updateWorkoutTaskCompletionFrontmatter(file: TFile, completedAt: string, setCount: number, restSeconds?: number): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.kind = frontmatter.kind || "workout";
      frontmatter.status = frontmatter.status || "active";
      frontmatter.scheduled = frontmatter.scheduled || this.settings.activeWorkoutStartedAt || completedAt;
      frontmatter.allDay = false;
      frontmatter.cssclasses = withCssClass(frontmatter.cssclasses, "tps-health-workout");
      frontmatter.lastSetStartedAt = completedAt;
      frontmatter.lastSetEndedAt = completedAt;
      if (restSeconds != null) frontmatter.lastRestSeconds = restSeconds;
      frontmatter.setCount = Math.max(numberOrUndefined(frontmatter.setCount) || 0, setCount);
    });
    this.settings.lastSetEndedAt = completedAt;
    this.settings.activeWorkoutSetCount = Math.max(this.settings.activeWorkoutSetCount || 0, setCount);
    await this.saveSettings();
  }

  private promptFinishWorkoutAfterLastSet(file: TFile): void {
    if (this.finishPromptWorkoutFiles.has(file.path)) return;
    this.finishPromptWorkoutFiles.add(file.path);
    new FinishWorkoutPromptModal(this.app, async () => {
      this.finishPromptWorkoutFiles.delete(file.path);
      await this.finishWorkout();
    }, () => {
      this.finishPromptWorkoutFiles.delete(file.path);
      new SetModal(this.app, this).open();
    }, () => {
      this.finishPromptWorkoutFiles.delete(file.path);
    }).open();
  }

  private async isWorkoutFile(file: TFile): Promise<boolean> {
    if (file.path === this.settings.activeWorkoutPath) return true;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    if (fm.kind === "workout") return true;
    if (Array.isArray(fm.cssclasses) && fm.cssclasses.includes("tps-health-workout")) return true;
    if (typeof fm.cssclasses === "string" && fm.cssclasses.split(/\s+/).includes("tps-health-workout")) return true;
    return false;
  }

  private async normalizeWorkoutNoteSetTasks(file: TFile, fm: any, endedAt: string): Promise<number> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const setsHeadingIndex = lines.findIndex((line) => /^##\s+Sets\s*$/i.test(line.trim()));
    const startIndex = setsHeadingIndex >= 0 ? setsHeadingIndex + 1 : frontmatterLineEnd(lines);

    const workoutPath = file.path;
    const workoutPlanPath = typeof fm.workoutPlanPath === "string" ? fm.workoutPlanPath : this.settings.activeWorkoutPlanPath || "";
    let changed = false;
    let previousSetEndedAt = "";
    let setCount = 0;
    for (let index = startIndex; index < lines.length; index++) {
      const line = lines[index];
      if (setsHeadingIndex >= 0 && /^##\s+/.test(line.trim())) break;
      const taskMatch = line.match(/^\s*-\s+\[([ xX])\]\s+/);
      if (!taskMatch) continue;
      const isChecked = taskMatch[1].toLowerCase() === "x";
      const hasSetId = line.includes("[setId::");
      if (!isChecked && !hasSetId) continue;
      setCount++;
      const existingEndedAt = readStringField(line, "endedAt") || readStringField(line, "completedDate");
      if (existingEndedAt) previousSetEndedAt = existingEndedAt;
      if (hasSetId) continue;

      const timestamp = endedAt;
      const restSeconds = previousSetEndedAt ? Math.max(0, Math.round((Date.parse(timestamp) - Date.parse(previousSetEndedAt)) / 1000)) : 0;
      let nextLine = line;
      nextLine = upsertDataviewField(nextLine, "setId", id("set"));
      nextLine = upsertDataviewField(nextLine, "workoutPath", workoutPath);
      if (workoutPlanPath) nextLine = upsertDataviewField(nextLine, "workoutPlanPath", workoutPlanPath);
      nextLine = upsertDataviewField(nextLine, "createdDate", timestamp);
      nextLine = upsertDataviewField(nextLine, "completedDate", timestamp);
      nextLine = upsertDataviewField(nextLine, "startedAt", timestamp);
      nextLine = upsertDataviewField(nextLine, "endedAt", timestamp);
      nextLine = upsertDataviewField(nextLine, "rest", restSeconds);
      lines[index] = nextLine;
      previousSetEndedAt = timestamp;
      changed = true;
    }
    if (changed) await this.app.vault.modify(file, lines.join("\n"));
    return setCount;
  }

  private async getOrCreateDailyNote(): Promise<TFile> {
    return this.getOrCreateDailyNoteForDate();
  }

  private async getOrCreateDailyNoteForDate(dateValue?: string): Promise<TFile> {
    const { format, folder } = await this.getDailyNoteSettings();
    const date = dateValue ? window.moment(dateValue) : window.moment();
    const fileName = `${(date?.isValid?.() && date.isValid() ? date : window.moment()).format(format)}.md`;
    const path = normalizePath(folder ? `${folder}/${fileName}` : fileName);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (folder) await this.ensureFolder(folder);
    return this.app.vault.create(path, "");
  }

  private async isTodayDailyNote(file: TFile): Promise<boolean> {
    return file.path === await this.getTodayDailyNotePath();
  }

  private async getActiveDailyNoteDateContext(): Promise<FoodLogDateContext | null> {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile ? this.getDailyNoteDateContext(file) : null;
  }

  private async getDailyNoteDateContext(file: TFile | null | undefined): Promise<FoodLogDateContext | null> {
    if (!(file instanceof TFile)) return null;
    const { format, folder } = await this.getDailyNoteSettings();
    const normalizedFolder = normalizePath(folder).replace(/^\/+|\/+$/g, "");
    if (normalizedFolder) {
      const parent = normalizePath(file.parent?.path || "").replace(/^\/+|\/+$/g, "");
      if (parent !== normalizedFolder) return null;
    }
    const parsed = window.moment(file.basename, format, true);
    if (!parsed.isValid()) return null;
    const today = window.moment();
    return {
      dateIso: parsed.format("YYYY-MM-DD"),
      label: parsed.format(format),
      isToday: parsed.isSame(today, "day"),
    };
  }

  private async getTodayDailyNotePath(): Promise<string> {
    const { format, folder } = await this.getDailyNoteSettings();
    const fileName = `${window.moment().format(format)}.md`;
    return normalizePath(folder ? `${folder}/${fileName}` : fileName);
  }

  private getGcmApi(): any {
    const plugins = (this.app as any).plugins;
    return plugins?.plugins?.["tps-global-context-menu"]?.api
      || plugins?.getPlugin?.("tps-global-context-menu")?.api;
  }

  private async startGcmWorkoutTimer(target: TFile | string | null): Promise<void> {
    const timeTracking = this.getGcmApi()?.timeTracking;
    if (typeof timeTracking?.startTimer !== "function") return;
    const file = target instanceof TFile
      ? target
      : typeof target === "string" && target
        ? this.app.vault.getAbstractFileByPath(target)
        : null;
    if (!(file instanceof TFile)) return;
    try {
      await timeTracking.startTimer({
        file,
        type: "note",
        title: this.settings.activeWorkoutTitle || file.basename,
      });
    } catch (error) {
      console.warn("TPS Health could not start the GCM workout timer", error);
    }
  }

  private async stopGcmWorkoutTimer(target: TFile | string | null, endedAt: string): Promise<void> {
    const timeTracking = this.getGcmApi()?.timeTracking;
    if (!timeTracking) return;
    const file = target instanceof TFile
      ? target
      : typeof target === "string" && target
        ? this.app.vault.getAbstractFileByPath(target)
        : null;
    if (!(file instanceof TFile)) return;
    try {
      if (typeof timeTracking.stopActiveTimerForFile === "function") {
        await timeTracking.stopActiveTimerForFile(file, endedAt);
      } else if (typeof timeTracking.stopActiveTimer === "function") {
        const active = typeof timeTracking.getActiveTimer === "function" ? await timeTracking.getActiveTimer() : null;
        if (!active || active.targetPath === file.path || active.sourcePath === file.path) {
          await timeTracking.stopActiveTimer(endedAt);
        }
      }
    } catch (error) {
      console.warn("TPS Health could not stop the GCM workout timer", error);
    }
  }

  private scheduleGcmMenuRefresh(): void {
    this.getGcmApi()?.overlays?.scheduleMenus?.("tps-health-food-log-button");
    window.setTimeout(() => this.updateGcmFoodLogButtonVisibility(), 50);
  }

  private async updateGcmFoodLogButtonVisibility(): Promise<void> {
    const visible = Boolean(await this.getActiveDailyNoteDateContext());
    const candidates = Array.from(document.querySelectorAll<HTMLElement>([
      '[data-tps-gcm-external-action-id="tps-health:food-log"]',
      'button[aria-label="Log food"]',
      'button[title="Log food"]',
      '[role="button"][aria-label="Log food"]',
      '[role="button"][title="Log food"]',
      'button',
    ].join(","))).filter((el) => {
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
      return label === "Log food";
    });
    for (const el of candidates) {
      el.toggleClass("tps-health-gcm-hidden", !visible);
      el.toggleAttribute("aria-hidden", !visible);
    }
  }

  private async getDailyNoteSettings(): Promise<{ format: string; folder: string }> {
    let format = this.settings.dailyNoteFormat || "YYYY-MM-DD";
    let folder = this.settings.dailyNoteFolder || "";

    try {
      const dailyNotesPlugin = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")
        || (this.app as any).internalPlugins?.plugins?.["daily-notes"];
      const options = dailyNotesPlugin?.instance?.options;
      if (typeof options?.format === "string" && options.format.trim()) format = options.format.trim();
      if (typeof options?.folder === "string" && options.folder.trim()) folder = options.folder.trim();
    } catch {
      // Fall through to persisted config/plugin settings.
    }

    try {
      const configDir = (this.app.vault as any)?.configDir || ".obsidian";
      const raw = await this.app.vault.adapter.read(normalizePath(`${configDir}/daily-notes.json`));
      const parsed = JSON.parse(raw);
      if (typeof parsed?.format === "string" && parsed.format.trim()) format = parsed.format.trim();
      if (typeof parsed?.folder === "string" && parsed.folder.trim()) folder = parsed.folder.trim();
    } catch {
      // Daily Notes may not have a persisted config yet.
    }

    return {
      format,
      folder: normalizePath(folder).replace(/^\/+|\/+$/g, ""),
    };
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = normalizePath(folder).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async uniquePath(path: string): Promise<string> {
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const base = path.replace(/\.md$/, "");
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(`${base} ${counter}.md`)) counter++;
    return `${base} ${counter}.md`;
  }

  private async readWorkoutTemplate(): Promise<string> {
    if (!this.settings.workoutTemplatePath) return "";
    const file = this.app.vault.getAbstractFileByPath(this.settings.workoutTemplatePath);
    return file instanceof TFile ? this.app.vault.read(file) : "";
  }

  private async readWorkoutPlanTemplate(): Promise<string> {
    if (!this.settings.workoutPlanTemplatePath) return "";
    const file = this.app.vault.getAbstractFileByPath(this.settings.workoutPlanTemplatePath);
    return file instanceof TFile ? this.app.vault.read(file) : "";
  }

  private async readExerciseTemplate(): Promise<string> {
    if (!this.settings.exerciseTemplatePath) return "";
    const file = this.app.vault.getAbstractFileByPath(this.settings.exerciseTemplatePath);
    return file instanceof TFile ? this.app.vault.read(file) : "";
  }

  private async readFoodTemplate(): Promise<string> {
    if (!this.settings.foodTemplatePath) return "";
    const file = this.app.vault.getAbstractFileByPath(this.settings.foodTemplatePath);
    return file instanceof TFile ? this.app.vault.read(file) : "";
  }

  private async resolveWorkoutPlanForStart(input: StartWorkoutInput): Promise<WorkoutPlanItem | null> {
    if (input.planPath) {
      const file = this.app.vault.getAbstractFileByPath(input.planPath);
      if (!(file instanceof TFile)) throw new Error(`Workout plan not found: ${input.planPath}`);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      return this.workoutPlanFromFrontmatter(file, fm);
    }
    if (!input.plan) return null;
    const existing = this.findWorkoutPlan(input.plan);
    if (existing) return existing;
    if (input.createPlanNote === false) return { id: input.plan, name: input.plan, cooldownDays: input.cooldownDays ?? this.settings.defaultWorkoutCooldownDays };
    return this.createWorkoutPlan({ name: input.plan, cooldownDays: input.cooldownDays });
  }

  private async updateWorkoutPlanCompletion(planPath: string, endedAt: string, cooldownDays: number, sessionPath: string, nextEligibleDate?: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(planPath);
    if (!(file instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.kind = frontmatter.kind || "workout-plan";
      frontmatter.lastCompletedDate = endedAt;
      frontmatter.cooldownDays = cooldownDays;
      frontmatter.lastSessionPath = sessionPath;
      if (nextEligibleDate) frontmatter.nextEligibleDate = nextEligibleDate;
      else delete frontmatter.nextEligibleDate;
    });
  }

  private findWorkoutPlan(name: string): WorkoutPlanItem | null {
    const normalized = normalizeLookup(name);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const isWorkoutPlan = fm.tpsType === "health-workout-plan" ||
        fm.tpsType === "health-routine" ||
        fm.kind === "workout-plan" ||
        file.path.startsWith(`${this.settings.workoutPlansFolder}/`);
      if (!isWorkoutPlan) continue;
      if (normalizeLookup(String(fm.name || fm.title || file.basename)) === normalized) return this.workoutPlanFromFrontmatter(file, fm);
    }
    return null;
  }

  private async createWorkoutTemplateFromState(
    state: { path: string; dailyNotePath: string; id: string; title: string; cooldownDays: number },
    input: { name: string; cooldownDays?: number; defaultRestSeconds?: number }
  ): Promise<string> {
    const rawExercises = state.path
      ? await this.extractWorkoutTaskExerciseNamesFromSession(state.path)
      : state.dailyNotePath
        ? await this.extractWorkoutTaskExerciseNamesFromDaily(state.dailyNotePath, state.id)
        : [];

    const exercises = [...new Set(rawExercises.map((exercise) => exercise.trim()).filter(Boolean))];

    const workoutPlanName = (input.name || state.title || "Workout Template").trim() || "Workout Template";
    const cooldownDays = Number.isFinite(input.cooldownDays as number)
      ? Math.max(0, Math.round(input.cooldownDays as number))
      : Number.isFinite(state.cooldownDays)
        ? Math.max(0, Math.round(state.cooldownDays))
        : this.settings.defaultWorkoutCooldownDays;
    const defaultRestSeconds = Number.isFinite(input.defaultRestSeconds as number)
      ? Math.max(0, Math.round(input.defaultRestSeconds as number))
      : this.settings.defaultRestSeconds;

    await this.ensureFolder(this.settings.workoutPlansFolder);
    const path = await this.uniquePath(`${this.settings.workoutPlansFolder}/${sanitizeFileName(workoutPlanName)}.md`);
    const body = this.defaultWorkoutPlanTemplateFromSession(workoutPlanName, cooldownDays, defaultRestSeconds, exercises);
    await this.app.vault.create(path, body);
    new Notice(`Saved workout template: ${workoutPlanName}`);
    return path;
  }

  private async extractWorkoutTaskExerciseNamesFromSession(workoutPath: string): Promise<string[]> {
    const file = this.app.vault.getAbstractFileByPath(workoutPath);
    if (!(file instanceof TFile)) return [];
    const content = await this.app.vault.read(file);
    return this.extractTaskExerciseNames(content);
  }

  private async extractWorkoutTaskExerciseNamesFromDaily(dailyNotePath: string, workoutId: string): Promise<string[]> {
    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
    if (!(file instanceof TFile)) return [];
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const parentIndex = lines.findIndex((candidate) => candidate.includes(`[workoutId:: ${workoutId}]`));
    if (parentIndex < 0) return [];

    const parentIndent = leadingSpaces(lines[parentIndex]);
    const nestedLines: string[] = [];
    let index = parentIndex + 1;
    while (index < lines.length) {
      const candidate = lines[index];
      if (candidate.trim() && leadingSpaces(candidate) <= parentIndent && candidate.trimStart().startsWith("- ")) break;
      nestedLines.push(candidate);
      index++;
    }

    return this.extractTaskExerciseNames(nestedLines.join("\n"));
  }

  private extractTaskExerciseNames(content: string): string[] {
    const names: string[] = [];
    for (const line of content.split("\n")) {
      if (!/^\s*-\s+/.test(line)) continue;
      const parsed = parseWorkoutTaskSetLine(line);
      const exercise = parsed.exercise?.trim();
      if (!exercise) continue;
      names.push(exercise);
    }
    return names;
  }

  private defaultWorkoutPlanTemplateFromSession(
    name: string,
    cooldownDays: number,
    defaultRestSeconds: number,
    exercises: string[]
  ): string {
    return [
      "---",
      "kind: workout-plan",
      `name: \"${escapeYamlString(name)}\"`,
      `cooldownDays: ${cooldownDays}`,
      `defaultRestSeconds: ${defaultRestSeconds}`,
      "lastCompletedDate:",
      "nextEligibleDate:",
      "lastSessionPath:",
      "---",
      "",
      `# ${name}`,
      "",
      "## Exercises",
      ...(exercises.length ? exercises.map((exercise) => `- ${exercise}`) : ["- "]),
      "",
      "## Notes",
      "",
    ].join("\n");
  }

  private extractWorkoutExerciseListFromPlan(content: string): string[] {
    const lines = content.split("\n");
    let inExercises = false;
    const output: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!inExercises) {
        if (/^##\s*Exercises\b/i.test(trimmed)) {
          inExercises = true;
        }
        continue;
      }
      if (/^##\s+/.test(trimmed)) break;
      const match = line.match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.*)$/);
      if (!match) continue;
      const entry = stripDataviewFields(match[1]).trim();
      if (!entry) continue;
      output.push(entry.replace(/^\[[ xX]\]\s*/, "").trim());
    }
    return output;
  }

  private async applyWorkoutPlanToSession(sessionPath: string, planPath: string): Promise<void> {
    const planFile = this.app.vault.getAbstractFileByPath(planPath);
    if (!(planFile instanceof TFile)) return;
    const planContent = await this.app.vault.read(planFile);
    const exercises = this.extractWorkoutExerciseListFromPlan(planContent);
    if (!exercises.length) return;

    const sessionFile = this.app.vault.getAbstractFileByPath(sessionPath);
    if (!(sessionFile instanceof TFile)) return;

    const lines = exercises.map((exercise) => {
      const cleaned = exercise.trim();
      return this.settings.workoutSetStorage === "task" ? `- [ ] ${cleaned}` : `- ${cleaned}`;
    });

    const current = await this.app.vault.read(sessionFile);
    const prefix = current.trimEnd().endsWith("## Sets") ? "\n" : "\n\n";
    await this.app.vault.append(sessionFile, `${prefix}${lines.join("\n")}\n`);
  }

  private workoutPlanFromFrontmatter(file: TFile, fm: any): WorkoutPlanItem {
    return {
      id: file.path,
      name: String(fm.name || fm.title || file.basename),
      sourcePath: file.path,
      cooldownDays: numberOrUndefined(fm.cooldownDays),
      defaultRestSeconds: numberOrUndefined(fm.defaultRestSeconds),
      lastCompletedDate: typeof fm.lastCompletedDate === "string" ? fm.lastCompletedDate : undefined,
      nextEligibleDate: typeof fm.nextEligibleDate === "string" ? fm.nextEligibleDate : undefined,
      notes: typeof fm.notes === "string" ? fm.notes : undefined,
    };
  }

  private defaultWorkoutTemplate(title: string, startedAt: string, plan: WorkoutPlanItem | null, cooldownDays: number, workoutId: string): string {
    return [
      "---",
      "kind: workout",
      `workoutId: ${workoutId}`,
      `title: "${escapeYamlString(title)}"`,
      plan?.sourcePath ? `workoutPlanPath: "${escapeYamlString(plan.sourcePath)}"` : "",
      plan?.name ? `workoutPlan: "${escapeYamlString(plan.name)}"` : "",
      `startedAt: ${startedAt}`,
      `scheduled: ${startedAt}`,
      "status: active",
      "allDay: false",
      "cssclasses:",
      "  - tps-health-workout",
      `cooldownDays: ${cooldownDays}`,
      "setCount: 0",
      "---",
      "",
      this.settings.workoutSessionBodyMode === "sets-section" ? "## Sets" : "",
      this.settings.workoutSessionBodyMode === "sets-section" ? "" : "",
    ].filter((line) => line !== "").join("\n");
  }

  private renderWorkoutSessionTemplate(template: string, context: { title: string; startedAt: string; plan: WorkoutPlanItem | null; cooldownDays: number; workoutId: string }): string {
    return replacePlaceholders(template, {
      workoutId: context.workoutId,
      title: context.title,
      startedAt: context.startedAt,
      kind: "workout",
      workoutPlan: context.plan?.name || "",
      workoutPlanPath: context.plan?.sourcePath || "",
      scheduled: context.startedAt,
      status: "active",
      allDay: "false",
      cssclasses: "tps-health-workout",
      setCount: "0",
      cooldownDays: String(context.cooldownDays),
      defaultRestSeconds: String(context.plan?.defaultRestSeconds || this.settings.defaultRestSeconds),
    });
  }

  private defaultWorkoutPlanTemplate(input: CreateWorkoutPlanInput): string {
    const cooldownDays = input.cooldownDays ?? this.settings.defaultWorkoutCooldownDays;
    const defaultRestSeconds = input.defaultRestSeconds ?? this.settings.defaultRestSeconds;
    return [
      "---",
      "kind: workout-plan",
      `name: "${escapeYamlString(input.name)}"`,
      `cooldownDays: ${cooldownDays}`,
      `defaultRestSeconds: ${defaultRestSeconds}`,
      "lastCompletedDate:",
      "nextEligibleDate:",
      "lastSessionPath:",
      "---",
      "",
      "# {{name}}",
      "",
      "## Exercises",
      "- ",
      "",
      "## Notes",
      input.notes || "",
    ].join("\n").split("{{name}}").join(input.name);
  }

  private renderWorkoutPlanTemplate(template: string, input: CreateWorkoutPlanInput): string {
    return replacePlaceholders(template, {
      name: input.name,
      kind: "workout-plan",
      cooldownDays: String(input.cooldownDays ?? this.settings.defaultWorkoutCooldownDays),
      defaultRestSeconds: String(input.defaultRestSeconds ?? this.settings.defaultRestSeconds),
      notes: input.notes || "",
    });
  }

  private defaultExerciseTemplate(input: CreateExerciseInput): string {
    return [
      "---",
      "kind: exercise",
      `name: "${escapeYamlString(input.name)}"`,
      input.category ? `category: ${input.category}` : "category: strength",
      input.primaryMuscles?.length ? `primaryMuscles: [${input.primaryMuscles.map((v) => `"${escapeYamlString(v)}"`).join(", ")}]` : "primaryMuscles: []",
      input.secondaryMuscles?.length ? `secondaryMuscles: [${input.secondaryMuscles.map((v) => `"${escapeYamlString(v)}"`).join(", ")}]` : "secondaryMuscles: []",
      input.equipment?.length ? `equipment: [${input.equipment.map((v) => `"${escapeYamlString(v)}"`).join(", ")}]` : "equipment: []",
      `defaultRestSeconds: ${input.defaultRestSeconds || this.settings.defaultRestSeconds}`,
      input.defaultSetType ? `defaultSetType: ${input.defaultSetType}` : "defaultSetType: normal",
      input.recommendedRestDays != null ? `recommendedRestDays: ${input.recommendedRestDays}` : "",
      "---",
      "",
      this.settings.exerciseTag,
      "",
      "## Notes",
      input.notes || "",
      "",
      "## Cues",
      "- ",
    ].filter((line) => line !== "").join("\n");
  }

  private renderExerciseTemplate(template: string, input: CreateExerciseInput): string {
    return replacePlaceholders(template, {
      name: input.name,
      kind: "exercise",
      tag: this.settings.exerciseTag,
      category: input.category || "strength",
      primaryMuscles: (input.primaryMuscles || []).join(", "),
      secondaryMuscles: (input.secondaryMuscles || []).join(", "),
      equipment: (input.equipment || []).join(", "),
      defaultRestSeconds: String(input.defaultRestSeconds || this.settings.defaultRestSeconds),
      defaultSetType: input.defaultSetType || "normal",
      recommendedRestDays: input.recommendedRestDays == null ? "" : String(input.recommendedRestDays),
      notes: input.notes || "",
    });
  }

  getMetricRenderConfigs(): HealthMetricRenderConfig[] {
    return this.settings.healthGoals.map((goal) => ({
      propertyKey: goal.propertyKey,
      label: goal.label,
      unit: goal.unit,
      kind: goal.kind,
      goal: goal.kind === "max" ? goal.max : goal.min ?? goal.max,
      min: goal.min,
      max: goal.max,
      color: goal.color,
    }));
  }

  getMetricRenderConfig(propertyKey: string): HealthMetricRenderConfig | null {
    const normalizedKey = propertyKey.trim().toLowerCase();
    return this.getMetricRenderConfigs().find((config) => config.propertyKey.toLowerCase() === normalizedKey) || null;
  }

  getApiSchema() {
    return {
      version: 1 as const,
      entities: {
        food: ["name", "brand", "barcode", "servingAmount", "servingUnit", "servingGrams", "servingMl", "calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "alcoholG", "sodiumMg", "ingredients", "sourceImagePath"],
        foodLog: ["foodPath", "servings", "amount", "unit", "createdDate", "completedDate"],
        exercise: ["name", "category", "primaryMuscles", "secondaryMuscles", "equipment", "defaultRestSeconds", "defaultSetType", "recommendedRestDays"],
        workoutPlan: ["name", "cooldownDays", "defaultRestSeconds", "lastCompletedDate", "nextEligibleDate", "lastSessionPath"],
        workoutSession: ["workoutId", "workout", "workoutPlanPath", "scheduled", "startedAt", "endedAt", "timeEstimate", "durationSeconds", "status", "allDay", "setCount", "cooldownDays", "completedDate", "nextEligibleDate"],
        workoutSet: ["exercise", "exercisePath", "workoutPath", "workoutPlanPath", "setId", "createdDate", "completedDate", "startedAt", "endedAt", "setType", "reps", "weight", "unit", "duration", "distance", "rest", "dropSet", "superset"],
      },
      examples: {
        createFoodFromLabel: {
          name: "Example Protein Bar",
          brand: "Example Brand",
          barcode: "012345678905",
          servingSizeText: "55 g",
          nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7, fiberG: 3, sugarG: 1, sodiumMg: 190 },
          ingredients: "Milk protein blend, cocoa, sweetener",
          sourceImagePath: "Attachments/example-label.jpg",
        },
        logFoodByName: { name: "Example Protein Bar", quantity: 0.5, unit: "serving" },
        startWorkout: { plan: "Push Day", logTarget: "daily-note", cooldownDays: 3 },
        logSet: { exercise: "Bench Press", reps: 8, weight: 185, weightUnit: "lb", rpe: 8 },
      },
    };
  }

  getActiveWorkoutState() {
    if (!this.settings.activeWorkoutId && !this.settings.activeWorkoutPath && !this.settings.activeWorkoutDailyNotePath) return null;
    return {
      id: this.settings.activeWorkoutId,
      target: this.settings.activeWorkoutTarget,
      path: this.settings.activeWorkoutPath,
      dailyNotePath: this.settings.activeWorkoutDailyNotePath,
      planPath: this.settings.activeWorkoutPlanPath,
      title: this.settings.activeWorkoutTitle,
      startedAt: this.settings.activeWorkoutStartedAt,
      cooldownDays: this.settings.activeWorkoutCooldownDays,
      lastSetEndedAt: this.settings.lastSetEndedAt,
      setCount: this.settings.activeWorkoutSetCount || 0,
    };
  }

  private createApi(): TPSHealthApi {
    return {
      version: 1,
      getSchema: () => this.getApiSchema(),
      searchFoods: (query) => this.searchFoods(query),
      lookupBarcode: (barcode) => this.lookupOpenFoodFactsBarcode(barcode),
      createFood: (input) => this.createFoodFromInput(input),
      upsertFood: (input) => this.upsertFoodFromInput(input),
      createFoodFromLabel: (input) => this.createFoodFromLabel(input),
      findOrCreateFood: (item) => this.findOrCreateFoodNote(item),
      logFoodByName: (input) => this.logFoodByName(input),
      searchExercises: (query) => this.searchExercises(query),
      createExercise: (input) => this.createExercise(input),
      upsertExercise: (input) => this.upsertExercise(input),
      findOrCreateExercise: (input) => this.findOrCreateExercise(input),
      searchWorkoutPlans: (query) => this.searchWorkoutPlans(query),
      createWorkoutPlan: (input) => this.createWorkoutPlan(input),
      upsertWorkoutPlan: (input) => this.upsertWorkoutPlan(input),
      findOrCreateWorkoutPlan: (input) => this.findOrCreateWorkoutPlan(input),
      logFood: (input) => this.logFoodFromInput(input),
      startWorkout: (input) => this.startWorkout(input),
      finishWorkout: (input) => this.finishWorkout(input),
      logSet: (input) => this.logSet(input),
      getActiveWorkoutPath: () => this.settings.activeWorkoutPath,
      getActiveWorkout: () => this.getActiveWorkoutState(),
      getSettings: () => ({ ...this.settings, healthGoals: this.settings.healthGoals.map((goal) => ({ ...goal })) }),
      getDailyRollup: () => this.getDailyRollup(),
      updateDailyRollup: () => this.updateDailyRollup(),
      getMetricRenderConfigs: () => this.getMetricRenderConfigs(),
      getMetricRenderConfig: (propertyKey) => this.getMetricRenderConfig(propertyKey),
    };
  }

  private async resolveFoodInput(input: LogFoodInput): Promise<FoodItem> {
    if (input.item) return input.item;
    if (input.barcode) {
      const existing = this.findFoodByBarcode(input.barcode);
      if (existing) return existing;
      const remote = await this.lookupOpenFoodFactsBarcode(input.barcode);
      if (remote) return remote;
    }
    if (input.query) {
      const matches = await this.searchFoods(input.query);
      if (matches[0]) return matches[0];
    }
    throw new Error("No food item could be resolved");
  }

  async lookupFoodByBarcode(barcode: string): Promise<FoodItem | null> {
    const normalized = barcode.replace(/\D/g, "");
    if (!normalized) return null;
    return this.findFoodByBarcode(normalized) || await this.lookupOpenFoodFactsBarcode(normalized);
  }

  async completeInlineFoodLog(editor: Editor): Promise<void> {
    const cursor = editor.getCursor();
    const targetLine = cursor.line;
    const lineText = editor.getLine(targetLine);
    const parsed = parseInlineFoodDraft(lineText);
    if (!parsed) {
      new Notice("Place the cursor on a food line like: - ramen [protein: 35]");
      return;
    }
    const completed = await this.createCompletedInlineFoodLine(parsed);
    if (!completed) {
      new Notice(`No food match for "${parsed.query}"`);
      return;
    }
    editor.replaceRange(completed, { line: targetLine, ch: 0 }, { line: targetLine, ch: lineText.length });
    if (this.settings.automaticDailyRollups) await this.updateDailyRollup();
  }

  async createCompletedInlineFoodLine(parsed: InlineFoodDraft, selected?: FoodItem): Promise<string | null> {
    const item = selected || (await this.searchFoods(parsed.query))[0];
    if (!item) return null;
    const saved = await this.findOrCreateFoodNote(item);
    const nutritionOverride = nutritionFromInlineOverrides(parsed.overrides);
    const resolvedServing = resolveFoodLogServing(saved, parsed.quantity, parsed.unit || preferredFoodLogUnit(saved));
    const entry: FoodLogEntry = {
      id: id("food"),
      createdDate: isoNow(),
      item: saved,
      quantity: resolvedServing.servings,
      unit: "serving",
      servingQuantity: resolvedServing.inputQuantity,
      servingUnit: resolvedServing.inputUnit,
      amount: resolvedServing.amount,
      amountUnit: resolvedServing.amountUnit,
      nutritionOverride: hasInlineNutritionOverrides(parsed.overrides) ? nutritionOverride : undefined,
    };
    return foodEntryLine(entry);
  }

  private getActiveInlineFoodDraft(): InlineFoodDraft | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) return null;
    return parseInlineFoodDraft(editor.getLine(editor.getCursor().line));
  }

  private findExercise(name: string): ExerciseItem | null {
    const normalized = normalizeLookup(name);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const tags = this.app.metadataCache.getFileCache(file)?.tags?.map((tag) => tag.tag) || [];
      const isExercise = tags.includes(this.settings.exerciseTag) ||
        fm.tpsType === "health-exercise" ||
        file.path.startsWith(`${this.settings.exercisesFolder}/`);
      if (!isExercise) continue;
      if (normalizeLookup(String(fm.name || file.basename)) === normalized) {
        return this.exerciseFromFrontmatter(file, fm);
      }
    }
    return null;
  }

  private exerciseFromFrontmatter(file: TFile, fm: any): ExerciseItem {
    return {
      id: file.path,
      name: String(fm.name || file.basename),
      sourcePath: file.path,
      category: fm.category || "strength",
      primaryMuscles: Array.isArray(fm.primaryMuscles) ? fm.primaryMuscles.map(String) : [],
      secondaryMuscles: Array.isArray(fm.secondaryMuscles) ? fm.secondaryMuscles.map(String) : [],
      equipment: Array.isArray(fm.equipment) ? fm.equipment.map(String) : [],
      defaultRestSeconds: numberOrUndefined(fm.defaultRestSeconds),
      defaultSetType: fm.defaultSetType || "normal",
      recommendedRestDays: numberOrUndefined(fm.recommendedRestDays),
    };
  }
}

interface FoodLogBaseEntry {
  file: TFile;
  lineNumber: number;
  line: string;
  id: string;
  name: string;
  serving: string;
  source: string;
  dateKey: string;
  dateLabel: string;
  nutrition: Required<Nutrition>;
}

class FoodLogBaseView extends BasesView {
  type = FOOD_LOG_BASE_VIEW_TYPE;
  private containerEl: HTMLElement;
  private refreshTimer: number | null = null;
  private renderGeneration = 0;

  constructor(controller: QueryController, containerEl: HTMLElement, private plugin: TPSHealthPlugin) {
    super(controller);
    this.containerEl = containerEl;
    this.containerEl.addClass("tps-health-food-log-base");
  }

  onload(): void {
    this.registerEvent(this.plugin.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueRender();
    }));
    this.registerEvent(this.plugin.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueRender();
    }));
    this.registerEvent(this.plugin.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueRender();
    }));
    void this.render();
  }

  onDataUpdated(): void {
    this.queueRender();
  }

  onunload(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.containerEl.empty();
  }

  private queueRender(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 150);
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const dateContext = await this.getDateContext();
    const entries = await this.loadEntries(dateContext);
    if (generation !== this.renderGeneration) return;
    this.containerEl.empty();

    const toolbar = this.containerEl.createDiv({ cls: "tps-health-food-log-toolbar" });
    const title = toolbar.createDiv({ cls: "tps-health-food-log-title" });
    title.createDiv({ cls: "tps-health-food-log-heading", text: "Food Log" });
    title.createDiv({
      cls: "tps-health-food-log-subtitle",
      text: dateContext
        ? `${entries.length} entries for ${dateContext.label}`
        : `${entries.length} entries from Markdown food logs`,
    });

    const actions = toolbar.createDiv({ cls: "tps-health-food-log-actions" });
    actions.createEl("button", { text: "Log food", cls: "mod-cta" }).addEventListener("click", () => this.plugin.openFoodLogger(dateContext));
    actions.createEl("button", { text: "Barcode" }).addEventListener("click", () => {
      new BarcodeScannerModal(this.plugin.app, this.plugin, dateContext, async (item) => {
        new FoodLogModal(this.plugin.app, this.plugin, item, null, dateContext).open();
      }, { autoStart: true }).open();
    });
    actions.createEl("button", { text: "Refresh" }).addEventListener("click", () => void this.render());
    actions.createEl("button", { text: "Open source" }).addEventListener("click", () => void this.openFirstSource(entries));

    const totals = sumFoodLogNutrition(entries);
    const summary = this.containerEl.createDiv({ cls: "tps-health-food-log-summary" });
    summary.createDiv({ cls: "tps-health-food-log-summary-count", text: `${entries.length} entries` });
    renderMacroPills(summary.createDiv({ cls: "tps-health-food-log-summary-macros" }), totals);

    if (!entries.length) {
      this.containerEl.createDiv({
        cls: "tps-health-food-log-empty",
        text: "No food log lines found. Use Log food to write daily-note or single-file food entries.",
      });
      return;
    }

    for (const group of groupFoodLogEntries(entries)) {
      const section = this.containerEl.createDiv({ cls: "tps-health-food-log-day" });
      const groupHeader = section.createDiv({ cls: "tps-health-food-log-day-header" });
      groupHeader.createDiv({ cls: "tps-health-food-log-day-title", text: group.label });
      const groupMeta = groupHeader.createDiv({ cls: "tps-health-food-log-day-meta" });
      groupMeta.createSpan({ text: `${group.entries.length} entries` });
      renderMacroPills(groupMeta.createDiv({ cls: "tps-health-food-log-day-macros" }), sumFoodLogNutrition(group.entries));

      const list = section.createDiv({ cls: "tps-health-food-log-list" });
      for (const entry of group.entries) this.renderEntry(list, entry);
    }
  }

  private async loadEntries(dateContext: FoodLogDateContext | null = null): Promise<FoodLogBaseEntry[]> {
    const entries: FoodLogBaseEntry[] = [];
    const files = this.getFoodLogSourceFiles();
    for (const file of files) {
      let content = "";
      try {
        content = await this.plugin.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!isFoodLogLine(line)) continue;
        const entry = createFoodLogBaseEntry(this.plugin, file, index, line);
        if (dateContext && entry.dateKey !== dateContext.dateIso) continue;
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.id.localeCompare(a.id));
  }

  private async getDateContext(): Promise<FoodLogDateContext | null> {
    const contextFile = this.getMarkdownContextFile()
      ?? (this.plugin.app.workspace.getActiveFile?.() instanceof TFile ? this.plugin.app.workspace.getActiveFile() : null);
    return this.plugin.getFoodLogDateContextForFile(contextFile);
  }

  private getMarkdownContextFile(): TFile | null {
    const markdownContextEl = this.containerEl?.closest(".markdown-reading-view, .markdown-source-view, .markdown-preview-view, .markdown-embed, .internal-embed, .cm-embed-block, .sync-embed, .sync-container");
    if (!markdownContextEl) return null;
    const leafEl = this.containerEl?.closest(".workspace-leaf");
    if (!leafEl) return null;
    let found: TFile | null = null;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const leafContainer = (leaf as any).containerEl as HTMLElement | undefined;
      if (!leafContainer || (leafContainer !== leafEl && !leafContainer.contains(leafEl) && !leafEl.contains(leafContainer))) return;
      const file = (leaf.view as any)?.file;
      if (file instanceof TFile && file.extension === "md") {
        found = file;
        return;
      }
      const state = typeof (leaf as any).getViewState === "function" ? (leaf as any).getViewState() : null;
      const path = [
        (leaf.view as any)?.getState?.()?.file,
        state?.state?.file,
        state?.file,
      ].find((value) => typeof value === "string" && value.endsWith(".md"));
      const resolved = typeof path === "string" ? this.plugin.app.vault.getAbstractFileByPath(normalizePath(path)) : null;
      if (resolved instanceof TFile) found = resolved;
    });
    return found;
  }

  private getFoodLogSourceFiles(): TFile[] {
    const baseFiles = this.getBaseFilteredFiles();
    if (baseFiles.length) return baseFiles;
    return this.getHealthFoodLogFiles();
  }

  private getBaseFilteredFiles(): TFile[] {
    const files: TFile[] = [];
    const seen = new Set<string>();
    const addFile = (file: TFile) => {
      if (file.extension !== "md" || seen.has(file.path)) return;
      seen.add(file.path);
      files.push(file);
    };
    const addEntry = (entry: unknown) => {
      if (entry instanceof TFile) {
        addFile(entry);
        return;
      }
      if (!entry || typeof entry !== "object") return;
      const file = (entry as { file?: unknown }).file;
      if (file instanceof TFile) {
        addFile(file);
        return;
      }
      const path = (entry as { path?: unknown }).path;
      if (typeof path === "string") {
        const resolved = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
        if (resolved instanceof TFile) addFile(resolved);
      }
    };

    const queryData = (this as { data?: unknown }).data as { data?: unknown; groupedData?: unknown } | undefined;
    const groups = queryData?.groupedData;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        const entries = (group as { entries?: unknown }).entries;
        if (Array.isArray(entries)) entries.forEach(addEntry);
      }
    }
    const entries = queryData?.data;
    if (!files.length && Array.isArray(entries)) entries.forEach(addEntry);
    return files;
  }

  private getHealthFoodLogFiles(): TFile[] {
    const configured = normalizePath(this.plugin.settings.foodLogFilePath || "");
    const dailyFolder = normalizePath(this.plugin.settings.dailyNoteFolder || "");
    const seen = new Set<string>();
    const files: TFile[] = [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (file.path === configured || isFoodLogBaseDailyNoteFile(file.path, dailyFolder) || /^Dailynotes\//i.test(file.path)) {
        if (!seen.has(file.path)) {
          seen.add(file.path);
          files.push(file);
        }
      }
    }
    return files;
  }

  private renderEntry(container: HTMLElement, entry: FoodLogBaseEntry): void {
    const row = container.createDiv({ cls: "tps-health-food-log-entry" });
    const main = row.createDiv({ cls: "tps-health-food-log-entry-main" });
    const title = main.createDiv({ cls: "tps-health-food-log-entry-title" });
    title.createSpan({ cls: "tps-health-food-log-entry-name", text: entry.name });
    title.createSpan({ cls: "tps-health-food-log-entry-serving", text: entry.serving });
    main.createDiv({ cls: "tps-health-food-log-entry-source", text: entry.source });
    renderMacroPills(row.createDiv({ cls: "tps-health-food-log-entry-macros" }), entry.nutrition);
    row.createEl("button", { text: "Open" }).addEventListener("click", () => void this.openEntry(entry));
  }

  private async openFirstSource(entries: FoodLogBaseEntry[]): Promise<void> {
    if (entries[0]) {
      await this.openEntry(entries[0]);
      return;
    }
    const configured = normalizePath(this.plugin.settings.foodLogFilePath || "");
    const file = configured ? this.plugin.app.vault.getAbstractFileByPath(configured) : null;
    if (file instanceof TFile) await this.plugin.app.workspace.getLeaf(false).openFile(file);
  }

  private async openEntry(entry: FoodLogBaseEntry): Promise<void> {
    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.openFile(entry.file);
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file === entry.file) {
      view.editor.setCursor({ line: entry.lineNumber, ch: 0 });
      view.editor.scrollIntoView({ from: { line: entry.lineNumber, ch: 0 }, to: { line: entry.lineNumber, ch: 0 } }, true);
    }
  }
}

class FoodSearchModal extends Modal {
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private selectionEl!: HTMLElement;
  private selectionItems: BatchFoodSelection[] = [];
  private consumedDateInput = "";
  private recipeNameInput = "";
  private searchInput = "";
  private barcodeInput = "";
  private activeFoodLogTab: "barcode" | "search" | "mine";
  private selectionCollapsed = false;
  private keyboardCleanup: (() => void) | null = null;
  private searchToken = 0;
  private barcodeScannerModal: BarcodeScannerModal | null = null;

  constructor(app: App, plugin: TPSHealthPlugin, private initialDraft: InlineFoodDraft | null = null, private dateContext: FoodLogDateContext | null = null) {
    super(app);
    this.plugin = plugin;
    this.activeFoodLogTab = initialDraft?.query ? "search" : "mine";
  }

  private plugin: TPSHealthPlugin;

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("tps-health-modal-frame");
    this.keyboardCleanup = setupKeyboardAwareHealthModal(this.modalEl, this.contentEl);
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Log food" });
    this.statusEl = this.contentEl.createDiv({ cls: "tps-health-status" });
    const tabsEl = this.contentEl.createDiv({ cls: "tps-health-food-tabs" });
    const panelsEl = this.contentEl.createDiv({ cls: "tps-health-food-tab-panels" });
    const panelByMode = {
      barcode: panelsEl.createDiv({ cls: "tps-health-food-tab-panel" }),
      search: panelsEl.createDiv({ cls: "tps-health-food-tab-panel" }),
      mine: panelsEl.createDiv({ cls: "tps-health-food-tab-panel" }),
    };
    const tabButtons = new Map<"barcode" | "search" | "mine", HTMLButtonElement>();
    const setActiveTab = (mode: "barcode" | "search" | "mine") => {
      this.activeFoodLogTab = mode;
      for (const [candidate, button] of tabButtons) {
        const active = candidate === mode;
        button.toggleClass("is-active", active);
        button.setAttr("aria-selected", active ? "true" : "false");
        panelByMode[candidate].toggleClass("is-active", active);
      }
      if (!this.resultsEl || !this.actionsEl) return;
      this.resultsEl.empty();
      this.actionsEl.empty();
      if (mode === "mine") {
        void this.renderQuickPicks();
      } else if (mode === "search") {
        if (this.searchInput.trim().length >= 2) this.queueSearch(this.searchInput);
        else this.statusEl.setText("Type at least 2 characters.");
      } else {
        this.statusEl.setText("Enter or scan a UPC/EAN barcode.");
        this.openBarcodeScanner();
      }
    };
    for (const [mode, label] of [["barcode", "Barcode"], ["search", "Search"], ["mine", "My foods/recipes"]] as const) {
      const button = tabsEl.createEl("button", { text: label, cls: "tps-health-food-tab" });
      button.setAttr("type", "button");
      button.setAttr("role", "tab");
      button.addEventListener("click", () => setActiveTab(mode));
      tabButtons.set(mode, button);
    }

    panelByMode.mine.createDiv({ cls: "tps-health-selection-empty", text: "Choose from recent foods, saved foods, and recipes." });
    new Setting(panelByMode.search)
      .setName("Search food")
      .addText((text) => {
        text.setPlaceholder("Apple, Greek yogurt, rice...");
        if (this.initialDraft?.query) {
          text.setValue(this.initialDraft.query);
          this.searchInput = this.initialDraft.query;
          this.queueSearch(this.initialDraft.query);
        }
        text.inputEl.addEventListener("input", () => {
          this.searchInput = text.inputEl.value;
          this.queueSearch(text.inputEl.value);
        });
      });
    new Setting(panelByMode.barcode)
      .setName("Barcode")
      .addText((text) => {
        text.setPlaceholder("UPC or EAN");
        text.inputEl.addEventListener("input", () => {
          this.barcodeInput = text.inputEl.value;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          void this.handleBarcodeAdd(text.inputEl.value);
        });
      })
      .addButton((button) => button
        .setButtonText("Lookup")
        .setCta()
        .onClick(() => this.handleBarcodeAdd(this.barcodeInput)))
      .addButton((button) => button
        .setButtonText("Scan")
        .onClick(() => this.openBarcodeScanner()));
    this.actionsEl = this.contentEl.createDiv({ cls: "tps-health-search-actions" });
    this.selectionEl = this.contentEl.createDiv({ cls: "tps-health-selection" });
    this.renderSelection();
    this.resultsEl = this.contentEl.createDiv({ cls: "tps-health-search-results" });
    setActiveTab(this.activeFoodLogTab);
  }

  onClose(): void {
    this.barcodeScannerModal?.close();
    this.barcodeScannerModal = null;
    this.keyboardCleanup?.();
    this.keyboardCleanup = null;
    this.contentEl.empty();
  }

  private openBarcodeScanner(): void {
    if (this.barcodeScannerModal) return;
    let scanner!: BarcodeScannerModal;
    scanner = new BarcodeScannerModal(this.app, this.plugin, this.dateContext, async (item) => {
      await this.addSelection(item);
      this.statusEl.setText(`Added ${item.name}`);
    }, {
      autoStart: true,
      onClose: () => {
        if (this.barcodeScannerModal === scanner) this.barcodeScannerModal = null;
      },
    });
    this.barcodeScannerModal = scanner;
    scanner.open();
  }

  private queueSearch(query: string): void {
    const token = ++this.searchToken;
    window.setTimeout(() => {
      if (token === this.searchToken) this.runSearch(query, token);
    }, 250);
  }

  private async runSearch(query: string, token: number): Promise<void> {
    const trimmed = query.trim();
    this.resultsEl.empty();
    this.actionsEl.empty();
    if (trimmed.length < 2) {
      this.statusEl.setText("Type at least 2 characters.");
      return;
    }
    this.statusEl.setText("Searching food databases...");
    const items = await this.plugin.searchFoods(trimmed);
    if (token !== this.searchToken) return;
    this.resultsEl.empty();
    this.statusEl.setText(items.length ? `${items.length} results` : "No results. Try a brand, a more specific food, or create a custom food.");
    this.renderCreateAction(trimmed);
    if (items.length) this.resultsEl.createDiv({ cls: "tps-health-result-section", text: "Search results" });
    for (const item of items) {
      this.renderFoodResult(item, "Add");
    }
  }

  private async handleBarcodeAdd(input: string): Promise<void> {
    const barcode = barcodeFromInput(input);
    if (!barcode) {
      new Notice("Enter a valid UPC or EAN barcode.");
      return;
    }
    this.statusEl.setText(`Looking up barcode ${barcode}...`);
    const item = await this.plugin.lookupFoodByBarcode(barcode);
    if (!item) {
      new Notice("No barcode match found. Create a local food note manually.");
      new BarcodeFoodReviewModal(this.app, this.plugin, {
        id: barcode,
        name: `Barcode ${barcode}`,
        barcode,
        source: "manual",
        servingAmount: 1,
        servingUnit: "serving",
        nutrition: {},
      }, "No database match found for this barcode. Review and create a local food note.", this.dateContext).open();
      return;
    }
    await this.addSelection(item);
    this.statusEl.setText(`Added ${item.name}`);
  }

  private async renderQuickPicks(): Promise<void> {
    this.resultsEl.empty();
    this.statusEl.setText("Pick recent foods or search.");
    const [localFoods, loggedStats] = await Promise.all([
      this.plugin.searchFoods(""),
      this.plugin.getLoggedFoodStats(""),
    ]);
    const recent = rankFoodSearchResults("", localFoods, loggedStats).filter((item) => foodUsageForItem(item, loggedStats).count > 0).slice(0, 8);
    const local = rankFoodSearchResults("", localFoods, loggedStats).filter((item) => !recent.some((recentItem) => foodSelectionKey(recentItem) === foodSelectionKey(item))).slice(0, 8);
    if (recent.length) {
      this.resultsEl.createDiv({ cls: "tps-health-result-section", text: "Recent and frequent" });
      for (const item of recent) this.renderFoodResult(item, "Add");
    }
    if (local.length) {
      this.resultsEl.createDiv({ cls: "tps-health-result-section", text: "My foods" });
      for (const item of local) this.renderFoodResult(item, "Add");
    }
    if (!recent.length && !local.length) {
      this.resultsEl.createDiv({ cls: "tps-health-selection-empty", text: "No local foods yet. Search to add from USDA/Open Food Facts or create a custom food." });
    }
  }

  private renderFoodResult(item: FoodItem, addLabel: string): void {
    const row = this.resultsEl.createDiv({ cls: "tps-health-result" });
    const copy = row.createDiv({ cls: "tps-health-result-copy" });
    copy.createDiv({ cls: "tps-health-result-title", text: item.name });
    copy.createDiv({ cls: "tps-health-result-meta", text: foodResultMeta(item) });
    renderMacroPills(row.createDiv({ cls: "tps-health-result-macros" }), item.nutrition || {});
    row.addEventListener("click", async () => {
      await this.addSelection(item);
    });
    new Setting(row)
      .addButton((button) => button
        .setButtonText(addLabel)
        .onClick(async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await this.addSelection(item);
        }))
      .addButton((button) => button
        .setButtonText("Review")
        .onClick(async (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.close();
          new FoodLogModal(this.app, this.plugin, await this.plugin.enrichFoodSearchItem(item), this.initialDraft, this.dateContext).open();
        }))
      .addButton((button) => button
        .setButtonText("Create from this")
        .onClick(async (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.close();
          new CustomFoodModal(this.app, this.plugin, "food", item.name, true, await this.plugin.enrichFoodSearchItem(item), this.dateContext).open();
        }));
  }

  private async addSelection(item: FoodItem, draft: InlineFoodDraft | null = null): Promise<void> {
    const enriched = await this.plugin.enrichFoodSearchItem(item);
    const selectedItem = draft && hasInlineNutritionOverrides(draft.overrides)
      ? { ...enriched, nutrition: withNutritionOverrides(enriched.nutrition || {}, draft.overrides) }
      : enriched;
    const existing = this.selectionItems.find((entry) => foodSelectionKey(entry.item) === foodSelectionKey(enriched));
    if (existing) {
      existing.quantity = round(existing.quantity + (draft?.quantity || 1));
      if (draft?.unit) existing.unit = draft.unit;
    } else {
      this.selectionItems.push({
        item: selectedItem,
        quantity: draft?.quantity || this.initialDraft?.quantity || 1,
        unit: draft?.unit || this.initialDraft?.unit || preferredFoodLogUnit(enriched),
      });
    }
    this.selectionCollapsed = false;
    this.renderSelection();
    new Notice(`Added ${enriched.name}`);
  }

  private renderSelection(): void {
    if (!this.selectionEl) return;
    this.selectionEl.empty();
    this.selectionEl.addClass("tps-health-floating-selection");
    if (!this.selectionItems.length) {
      this.selectionEl.addClass("is-empty");
      this.selectionEl.removeClass("is-collapsed");
      return;
    }
    this.selectionEl.removeClass("is-empty");
    this.selectionEl.toggleClass("is-collapsed", this.selectionCollapsed);

    const header = this.selectionEl.createDiv({ cls: "tps-health-selection-header" });
    header.createDiv({ cls: "tps-health-selection-title", text: `${this.selectionItems.length} selected` });
    renderMacroPills(header.createDiv({ cls: "tps-health-selection-macros" }), this.selectedNutrition());
    const headerActions = header.createDiv({ cls: "tps-health-selection-header-actions" });
    if (this.selectionCollapsed) {
      const logButton = headerActions.createEl("button", { text: "Log", cls: "mod-cta" });
      logButton.addEventListener("click", () => this.logSelected());
      const showButton = headerActions.createEl("button", { text: "Show" });
      showButton.addEventListener("click", () => {
        this.selectionCollapsed = false;
        this.renderSelection();
      });
      return;
    }
    const hideButton = headerActions.createEl("button", { text: "Hide", cls: "mod-muted" });
    hideButton.addEventListener("click", () => {
      this.selectionCollapsed = true;
      this.renderSelection();
    });

    for (const entry of this.selectionItems) {
      const row = this.selectionEl.createDiv({ cls: "tps-health-selection-row" });
      row.createDiv({ cls: "tps-health-selection-name", text: entry.item.name });
      const controls = row.createDiv({ cls: "tps-health-selection-controls" });
      const quantityInput = controls.createEl("input", {
        attr: { type: "number", min: "0.01", step: "0.25", value: String(entry.quantity), "aria-label": `Amount for ${entry.item.name}` },
      });
      quantityInput.addEventListener("change", () => {
        entry.quantity = numberOrUndefined(quantityInput.value) || 1;
        this.renderSelection();
      });
      const unitSelect = controls.createEl("select", { attr: { "aria-label": `Unit for ${entry.item.name}` } });
      for (const unit of foodLogUnitOptions(entry.item)) {
        unitSelect.createEl("option", { text: foodLogUnitOptionLabel(entry.item, unit), value: unit });
      }
      unitSelect.value = entry.unit;
      unitSelect.addEventListener("change", () => {
        entry.unit = unitSelect.value;
        this.renderSelection();
      });
      const remove = controls.createEl("button", { text: "Remove", cls: "mod-muted" });
      remove.addEventListener("click", () => {
        this.selectionItems = this.selectionItems.filter((candidate) => candidate !== entry);
        this.renderSelection();
      });
    }

    new Setting(this.selectionEl)
      .setName("Consumed time")
      .setDesc("Optional. Use values like 2 hours ago, today 8am, or leave blank for the open daily note date.")
      .addText((text) => {
        text.setPlaceholder("2 hours ago");
        text.setValue(this.consumedDateInput);
        text.inputEl.addEventListener("input", () => {
          this.consumedDateInput = text.inputEl.value;
        });
      });

    new Setting(this.selectionEl)
      .setName("Recipe name")
      .setDesc("Optional when creating a recipe from the selected foods.")
      .addText((text) => {
        text.setPlaceholder("Protein snack plate");
        text.setValue(this.recipeNameInput);
        text.inputEl.addEventListener("input", () => {
          this.recipeNameInput = text.inputEl.value;
        });
      });

    const buttons = this.selectionEl.createDiv({ cls: "tps-health-selection-actions" });
    const logButton = buttons.createEl("button", { text: "Log selected", cls: "mod-cta" });
    logButton.addEventListener("click", () => this.logSelected());
    const recipeButton = buttons.createEl("button", { text: "Create recipe" });
    recipeButton.addEventListener("click", () => this.createRecipeFromSelection());
  }

  private selectedNutrition(): Nutrition {
    const totals = zeroNutrition();
    for (const entry of this.selectionItems) {
      const resolved = resolveFoodLogServing(entry.item, entry.quantity, entry.unit);
      addNutritionTotals(totals, multiplyNutrition(entry.item.nutrition || {}, resolved.servings));
    }
    return totals;
  }

  private async logSelected(): Promise<void> {
    if (!this.selectionItems.length) return;
    const completedDate = resolveBatchFoodCompletedDate(this.consumedDateInput, this.dateContext);
    for (const entry of this.selectionItems) {
      await this.plugin.logFood(entry.item, entry.quantity, entry.unit, undefined, completedDate);
    }
    new Notice(`Logged ${this.selectionItems.length} foods.`);
    this.close();
  }

  private async createRecipeFromSelection(): Promise<void> {
    if (!this.selectionItems.length) return;
    const name = this.recipeNameInput.trim() || this.selectionItems.map((entry) => entry.item.name).slice(0, 3).join(" + ");
    const nutrition = this.selectedNutrition();
    const notes = this.selectionItems
      .map((entry) => `- ${formatQuantityUnit(entry.quantity, entry.unit)} ${entry.item.name}${entry.item.sourcePath ? ` (${entry.item.sourcePath})` : ""}`)
      .join("\n");
    const saved = await this.plugin.createFoodFromInput({
      type: "recipe",
      name,
      servingAmount: 1,
      servingUnit: "recipe",
      nutrition,
      notes,
    });
    new Notice(`Created recipe ${saved.name}.`);
    this.close();
    new FoodLogModal(this.app, this.plugin, saved, null, this.dateContext).open();
  }

  private renderCreateAction(query: string): void {
    new Setting(this.actionsEl)
      .setName(`Create "${query}"`)
      .setDesc("Create a local food note, then choose serving count and log it.")
      .addButton((button) => button
        .setButtonText("Create food")
        .setCta()
        .onClick(() => {
          this.close();
          new CustomFoodModal(this.app, this.plugin, "food", query, true, undefined, this.dateContext).open();
        }));
  }
}

interface BatchFoodSelection {
  item: FoodItem;
  quantity: number;
  unit: string;
}

function foodSelectionKey(item: FoodItem): string {
  return item.sourcePath || item.barcode || item.id || `${item.name}|${item.brand || ""}`;
}

function addNutritionTotals(totals: Required<Nutrition>, nutrition: Nutrition): void {
  totals.calories += nutrition.calories || 0;
  totals.proteinG += nutrition.proteinG || 0;
  totals.carbsG += nutrition.carbsG || 0;
  totals.fatG += nutrition.fatG || 0;
  totals.fiberG += nutrition.fiberG || 0;
  totals.sugarG += nutrition.sugarG || 0;
  totals.alcoholG += nutrition.alcoholG || 0;
  totals.sodiumMg += nutrition.sodiumMg || 0;
}

function resolveBatchFoodCompletedDate(input: string, dateContext: FoodLogDateContext | null): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return dateContext?.dateIso;
  const relative = trimmed.match(/^(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s+ago$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const momentUnit = unit.startsWith("min") ? "minutes" : unit.startsWith("h") ? "hours" : "days";
    return window.moment().subtract(amount, momentUnit as any).toISOString();
  }
  const parsed = window.moment(trimmed);
  return parsed.isValid() ? parsed.toISOString() : dateContext?.dateIso;
}

function barcodeFromInput(input: string): string | null {
  if (!/^[\d\s-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function timestampForDate(dateIso: string): string {
  const date = window.moment(dateIso, "YYYY-MM-DD", true);
  if (!date.isValid()) return isoNow();
  const now = window.moment();
  date.hour(now.hour()).minute(now.minute()).second(now.second()).millisecond(now.millisecond());
  return date.toISOString();
}

function setupKeyboardAwareHealthModal(modalEl: HTMLElement, contentEl: HTMLElement): () => void {
  const viewport = window.visualViewport;
  let raf = 0;
  const update = () => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      const height = viewport?.height || window.innerHeight;
      const offsetTop = viewport?.offsetTop || 0;
      const keyboardOffset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
      modalEl.style.setProperty("--tps-health-keyboard-offset", `${keyboardOffset}px`);
      modalEl.style.setProperty("--tps-health-visual-height", `${Math.max(220, Math.round(height))}px`);
      modalEl.toggleClass("is-keyboard-raised", keyboardOffset > 80);

      const active = document.activeElement;
      if (keyboardOffset > 80 && active instanceof HTMLElement && contentEl.contains(active)) {
        window.setTimeout(() => active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }), 80);
      }
    });
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  contentEl.addEventListener("focusin", update);
  contentEl.addEventListener("focusout", update);
  return () => {
    if (raf) window.cancelAnimationFrame(raf);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    contentEl.removeEventListener("focusin", update);
    contentEl.removeEventListener("focusout", update);
    modalEl.style.removeProperty("--tps-health-keyboard-offset");
    modalEl.style.removeProperty("--tps-health-visual-height");
    modalEl.removeClass("is-keyboard-raised");
  };
}

interface InlineFoodDraft {
  query: string;
  quantity: number;
  unit?: string;
  sourcePath?: string;
  hasExplicitAmount?: boolean;
  overrides: Partial<Record<"cal" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "alcohol" | "sodium", number>>;
}

interface InlineFoodSuggestion {
  draft: InlineFoodDraft;
  item: FoodItem;
}

interface FoodLogChipData {
  food: string;
  serving: string;
  amount?: string;
  macros: string[];
}

class FoodLogChipWidget extends WidgetType {
  constructor(private data: FoodLogChipData) {
    super();
  }

  eq(other: FoodLogChipWidget): boolean {
    return this.data.food === other.data.food &&
      this.data.serving === other.data.serving &&
      this.data.amount === other.data.amount &&
      this.data.macros.join("|") === other.data.macros.join("|");
  }

  toDOM(): HTMLElement {
    return foodLogChipElement(this.data);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function foodLogChipElement(data: FoodLogChipData): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "tps-health-food-chip";
  chip.setAttribute("title", data.amount ? `${data.food} - ${data.amount}` : data.food);

    const serving = document.createElement("span");
    serving.className = "tps-health-food-chip-serving";
  serving.textContent = data.serving;
    chip.appendChild(serving);

    const food = document.createElement("span");
    food.className = "tps-health-food-chip-food";
  food.textContent = data.food;
    chip.appendChild(food);

  if (data.amount && data.amount !== data.serving) {
      const amount = document.createElement("span");
      amount.className = "tps-health-food-chip-amount";
    amount.textContent = data.amount;
      chip.appendChild(amount);
    }

  if (data.macros.length) {
    const macros = document.createElement("span");
    macros.className = "tps-health-food-chip-macros";
    macros.textContent = data.macros.join(" ");
    chip.appendChild(macros);
  }

  return chip;
}

function createFoodLogChipExtension(plugin: TPSHealthPlugin) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let position = from;
        while (position <= to) {
          const line = view.state.doc.lineAt(position);
          if (line.to > to && position !== from) break;
          position = line.to + 1;
          if (line.from === line.to || this.selectionTouchesLine(view, line.from, line.to)) continue;
          const text = line.text;
          if (!isFoodLogLine(text)) continue;
          const chip = foodLogChipDataFromLine(text);
          if (!chip) continue;
          builder.add(line.from, line.to, Decoration.replace({ widget: new FoodLogChipWidget(chip) }));
        }
      }
      return builder.finish();
    }

    private selectionTouchesLine(view: EditorView, from: number, to: number): boolean {
      return view.state.selection.ranges.some((range) =>
        (range.from >= from && range.from <= to) ||
        (range.to >= from && range.to <= to) ||
        (range.from <= from && range.to >= to));
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });
}

function renderFoodLogChips(root: HTMLElement, plugin: TPSHealthPlugin): void {
  for (const item of Array.from(root.querySelectorAll("li"))) {
    const text = item.textContent || "";
    if (!isFoodLogLine(text)) continue;
    const rawChip = foodLogChipDataFromLine(text, plugin);
    const renderedChip = rawChip?.macros.length ? rawChip : foodLogChipDataFromRenderedItem(item, plugin);
    const chip = renderedChip || rawChip;
    if (!chip) continue;
    item.empty();
    item.addClass("tps-health-food-entry-row");
    item.appendChild(foodLogChipElement(chip));
  }
}

function foodLogChipDataFromLine(line: string, plugin?: TPSHealthPlugin): FoodLogChipData | null {
  const food = readStringField(line, "food") || foodNameFromFoodLogSummary(line);
  if (!food) return null;
  const quantity = readNumber(line, "qty") ?? readNumber(line, "servings");
  const unit = readStringField(line, "unit");
  const amount = readNumber(line, "amount");
  const amountUnit = readStringField(line, "amountUnit");
  const serving = quantity != null ? formatQuantityUnit(quantity, unit || "serving") : amount != null ? formatQuantityUnit(amount, amountUnit || "") : "Food";
  const amountLabel = amount != null && amountUnit ? formatQuantityUnit(amount, amountUnit) : undefined;
  return { food, serving, amount: amountLabel, macros: compactMacroParts(foodLogNutritionForLine(line, plugin)) };
}

function foodLogChipDataFromRenderedItem(item: Element, plugin: TPSHealthPlugin): FoodLogChipData | null {
  const text = (item.textContent || "").replace(/\s+/g, " ").trim();
  const link = item.querySelector("a.internal-link") as HTMLElement | null;
  const food = (link?.textContent || foodNameFromFoodLogSummary(text) || "").trim();
  if (!food) return null;
  const amount = text.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/);
  const quantity = amount ? numberOrUndefined(amount[1]) : undefined;
  const unit = amount?.[2];
  const serving = quantity != null ? formatQuantityUnit(quantity, unit || "serving") : "Food";
  const path = link ? markdownPathFromWikilink(link.getAttribute("data-href") || link.getAttribute("href") || link.textContent || "") : undefined;
  const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
  const macros = file instanceof TFile
    ? compactMacroParts(foodLogNutritionFromFoodFile(plugin, file, quantity || 1, unit || "serving"))
    : [];
  return { food, serving, amount: serving, macros };
}

function foodNameFromFoodLogSummary(line: string): string | null {
  const link = line.match(/\[\[[^\]|]+(?:\|([^\]]+))?\]\]/);
  if (link?.[1]) return link[1].trim();
  const stripped = line
    .replace(/^\s*-\s+/, "")
    .replace(/\[[^\]]+\]/g, "")
    .trim();
  if (!stripped) return null;
  const parts = stripped.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[1] : parts[0];
}

interface WorkoutSetChipData {
  exercise: string;
  details: string;
  status: "complete" | "planned";
  meta: string[];
  title: string;
}

class WorkoutSetChipWidget extends WidgetType {
  constructor(private data: WorkoutSetChipData) {
    super();
  }

  eq(other: WorkoutSetChipWidget): boolean {
    return this.data.exercise === other.data.exercise &&
      this.data.details === other.data.details &&
      this.data.status === other.data.status &&
      this.data.meta.join("|") === other.data.meta.join("|");
  }

  toDOM(): HTMLElement {
    return workoutSetChipElement(this.data);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function createWorkoutSetChipExtension() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let position = from;
        while (position <= to) {
          const line = view.state.doc.lineAt(position);
          if (line.to > to && position !== from) break;
          position = line.to + 1;
          if (line.from === line.to || selectionTouchesLine(view, line.from, line.to)) continue;
          const chip = workoutSetChipDataFromLine(line.text);
          if (!chip) continue;
          builder.add(line.from, line.to, Decoration.replace({ widget: new WorkoutSetChipWidget(chip) }));
        }
      }
      return builder.finish();
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });
}

function renderWorkoutSetChips(root: HTMLElement, sourcePath?: string): void {
  if (sourcePath && !/^Workouts\//i.test(sourcePath) && !/^Health\/Workouts\//i.test(sourcePath)) return;
  for (const item of Array.from(root.querySelectorAll("li"))) {
    const text = item.textContent || "";
    const chip = workoutSetChipDataFromLine(text);
    if (!chip) continue;
    const checkbox = item.querySelector(":scope > input[type='checkbox']");
    item.empty();
    item.addClass("tps-health-workout-set-row");
    if (checkbox) item.appendChild(checkbox);
    item.appendChild(workoutSetChipElement(chip));
  }
}

function workoutSetChipElement(data: WorkoutSetChipData): HTMLElement {
  const chip = document.createElement("span");
  chip.className = `tps-health-workout-set-chip is-${data.status}`;
  chip.setAttribute("title", data.title);

  const status = document.createElement("span");
  status.className = `tps-health-workout-set-status is-${data.status}`;
  status.textContent = data.status === "complete" ? "done" : "plan";
  chip.appendChild(status);

  const exercise = document.createElement("span");
  exercise.className = "tps-health-workout-set-exercise";
  exercise.textContent = data.exercise;
  chip.appendChild(exercise);

  if (data.details) {
    const details = document.createElement("span");
    details.className = "tps-health-workout-set-details";
    details.textContent = data.details;
    chip.appendChild(details);
  }

  for (const entry of data.meta) {
    const meta = document.createElement("span");
    meta.className = "tps-health-workout-set-meta";
    meta.textContent = entry;
    chip.appendChild(meta);
  }

  return chip;
}

function workoutSetChipDataFromLine(line: string): WorkoutSetChipData | null {
  if (!isWorkoutSetLine(line) && !isPlannedWorkoutSetSummaryLine(line)) return null;
  const exercise = wikilinkLabel(readStringField(line, "exercise") || workoutSetExerciseFromSummary(line));
  if (!exercise) return null;
  const summaryDetails = parseWorkoutSetDetailsFromSummary(line);
  const reps = readNumber(line, "reps") ?? summaryDetails.reps;
  const weight = readNumber(line, "weight") ?? summaryDetails.weight;
  const unit = readStringField(line, "unit") || summaryDetails.unit;
  const duration = readNumber(line, "duration");
  const distance = readNumber(line, "distance");
  const distanceUnit = readStringField(line, "distanceUnit");
  const details = workoutSetDetailsLabel({ reps, weight, unit, duration, distance, distanceUnit });
  const meta = [
    readStringField(line, "setType") && readStringField(line, "setType") !== "normal" ? readStringField(line, "setType") : "",
    readStringField(line, "superset") ? `superset ${readStringField(line, "superset")}` : "",
    readStringField(line, "dropSet") ? `drop ${readStringField(line, "dropSet")}` : "",
    readNumber(line, "rpe") != null ? `RPE ${readNumber(line, "rpe")}` : "",
    readNumber(line, "rest") != null ? `rest ${formatRestDuration(readNumber(line, "rest") || 0)}` : "",
  ].filter((entry): entry is string => Boolean(entry));
  return {
    exercise,
    details,
    status: /^\s*-\s+\[x\]/i.test(line) ? "complete" : "planned",
    meta,
    title: line.trim(),
  };
}

function isWorkoutSetLine(line: string): boolean {
  return /\[setId::\s*[^\]]+\]/i.test(line) &&
    (/\[exercise::\s*[^\]]+\]/i.test(line) || /\[exercisePath::\s*[^\]]+\]/i.test(line));
}

function isPlannedWorkoutSetSummaryLine(line: string): boolean {
  return /^\s*-\s+\[[ xX]\]\s+.+\s+-\s+.+\s+x\s+\d+/i.test(line) &&
    !/\[food::/i.test(line);
}

function workoutSetExerciseFromSummary(line: string): string {
  const stripped = line
    .replace(/^\s*-\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/\[[^\]]+::[^\]]+\]/g, "")
    .trim();
  const parts = stripped.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  return parts[0] || "";
}

function workoutSetDetailsLabel(input: { reps?: number; weight?: number; unit?: string; duration?: number; distance?: number; distanceUnit?: string }): string {
  const weight = input.weight == null ? input.unit === "bodyweight" ? "bodyweight" : "" : `${round(input.weight)}${input.unit ? ` ${input.unit}` : ""}`;
  const reps = input.reps == null ? "" : `${round(input.reps)}`;
  if (weight && reps) return `${weight} x ${reps}`;
  if (reps) return `${reps} reps`;
  if (weight) return weight;
  if (input.duration != null) return `${round(input.duration)}s`;
  if (input.distance != null) return `${round(input.distance)}${input.distanceUnit ? ` ${input.distanceUnit}` : ""}`;
  return "";
}

function parseWorkoutSetDetailsFromSummary(line: string): { reps?: number; weight?: number; unit?: string } {
  const stripped = line
    .replace(/^\s*-\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/\[[^\]]+::[^\]]+\]/g, "")
    .trim();
  const match = stripped.match(/\s+-\s+(?:.*?\s+-\s+)?(?:(bodyweight)|(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?)\s+x\s+(\d+(?:\.\d+)?)/i);
  if (!match) return {};
  return {
    weight: match[1] ? undefined : numberOrUndefined(match[2]),
    unit: match[1] ? "bodyweight" : match[3],
    reps: numberOrUndefined(match[4]),
  };
}

function wikilinkLabel(value: string): string {
  const match = value.match(/\[\[[^\]|]+(?:\|([^\]]+))?\]\]/);
  if (match?.[1]) return match[1].trim();
  if (match) return value.replace(/^\[\[/, "").replace(/\]\]$/, "").split("/").pop() || value;
  return value;
}

function formatQuantityUnit(quantity: number, unit: string): string {
  return [round(quantity), unit].filter((part) => part !== "").join(" ");
}

function formatRestDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function selectionTouchesLine(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) =>
    (range.from >= from && range.from <= to) ||
    (range.to >= from && range.to <= to) ||
    (range.from <= from && range.to >= to));
}

class FoodLogEditorSuggest extends EditorSuggest<InlineFoodSuggestion> {
  constructor(app: App, private plugin: TPSHealthPlugin) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const parsed = parseInlineFoodDraft(line);
    if (!parsed || parsed.query.length < 2) return null;
    if (!lineHasFoodDraftProperties(line) && !parsed.hasExplicitAmount && !parsed.sourcePath) return null;
    return {
      start: { line: cursor.line, ch: 0 },
      end: { line: cursor.line, ch: line.length },
      query: parsed.query,
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<InlineFoodSuggestion[]> {
    const line = context.editor.getLine(context.start.line);
    const draft = parseInlineFoodDraft(line);
    if (!draft) return [];
    if (!lineHasFoodDraftProperties(line) && !draft.hasExplicitAmount && !draft.sourcePath) return [];
    if (draft.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(draft.sourcePath);
      if (file instanceof TFile) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        return [{ draft, item: this.plugin.foodFromFrontmatter(file, fm) }];
      }
    }
    const items = await this.plugin.searchFoods(draft.query);
    return items.slice(0, 8).map((item) => ({ draft, item }));
  }

  renderSuggestion(suggestion: InlineFoodSuggestion, el: HTMLElement): void {
    el.addClass("tps-health-inline-suggestion");
    const header = el.createDiv({ cls: "tps-health-inline-suggestion-header" });
    header.createDiv({ cls: "tps-health-inline-suggestion-title", text: suggestion.item.name });
    const nutrition = suggestion.item.nutrition || {};
    el.createDiv({
      cls: "tps-health-inline-suggestion-meta",
      text: [
        suggestion.item.brand,
        suggestion.item.source,
        [suggestion.item.servingAmount ? round(suggestion.item.servingAmount) : "", suggestion.item.servingUnit || "serving"].filter(Boolean).join(" "),
      ].filter(Boolean).join(" • "),
    });
    renderMacroPills(header.createDiv({ cls: "tps-health-inline-suggestion-macros" }), nutrition);
  }

  async selectSuggestion(suggestion: InlineFoodSuggestion): Promise<void> {
    const lineNumber = this.context?.start.line;
    if (lineNumber == null) return;
    const completed = await this.plugin.createCompletedInlineFoodLine(suggestion.draft, suggestion.item);
    if (!completed) return;
    const editor = this.context?.editor;
    if (!editor) return;
    const current = editor.getLine(lineNumber);
    editor.replaceRange(completed, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: current.length });
    if (this.plugin.settings.automaticDailyRollups) await this.plugin.updateDailyRollup();
  }
}

class BarcodeScannerModal extends Modal {
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private scanInterval: number | null = null;
  private fallbackScanTimeout: number | null = null;
  private zxingVideoControls: any = null;
  private cameraSessionId = 0;
  private stopped = false;
  private lookupInProgress = false;
  private cameraStartInProgress = false;
  private desiredFacingMode: "environment" | "user" | "" = "";
  private torchEnabled = false;
  private flashButton: any = null;
  private flipButton: any = null;
  private nativeBarcodeDetector: any = null;
  private nativeBarcodeDetectorChecked = false;
  private shortcutInboxEventRefs: EventRef[] = [];
  private shortcutInboxPollInterval: number | null = null;
  private shortcutInboxBaselineMtime = 0;
  private shortcutInboxLastProcessedMtime = 0;
  private shortcutInboxLastProcessedBarcode = "";
  private manualBarcode = "";
  private fileInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    private plugin: TPSHealthPlugin,
    private dateContext: FoodLogDateContext | null = null,
    private onItem?: (item: FoodItem) => Promise<void> | void,
    private options: BarcodeScannerOptions = {},
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("tps-health-modal-frame");
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Scan food barcode" });
    this.desiredFacingMode = this.desiredFacingMode || this.defaultFacingMode();
    new Setting(this.contentEl)
      .setName("Manual barcode")
      .addText((text) => text
        .setPlaceholder("UPC or EAN")
        .onChange((value) => this.manualBarcode = value.trim()))
      .addButton((button) => button
        .setButtonText("Lookup")
        .setCta()
        .onClick(() => this.lookup(this.manualBarcode)));

    this.videoEl = this.contentEl.createEl("video");
    this.videoEl.addClass("tps-health-scanner-video");
    this.videoEl.setAttr("playsinline", "true");
    this.videoEl.setAttr("autoplay", "true");
    this.videoEl.muted = true;

    const status = this.contentEl.createDiv({ cls: "tps-health-status", text: this.cameraHelpText() });
    const controls = new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Start camera")
        .onClick(() => this.startCamera(status)));
    if (this.shouldShowAppleShortcutButton()) {
      controls.addButton((button) => button
        .setButtonText("Apple Shortcut")
        .onClick(() => this.openAppleShortcut(status)));
    }
    controls
      .addButton((button) => {
        this.flashButton = button;
        return button
          .setButtonText("Flash")
          .onClick(() => this.toggleTorch(status));
      })
      .addButton((button) => {
        this.flipButton = button;
        return button
          .setButtonText("Flip camera")
          .onClick(() => this.flipCamera(status));
      })
      .addButton((button) => button
        .setButtonText("Scan image")
        .onClick(() => this.fileInputEl?.click()));

    this.fileInputEl = this.contentEl.createEl("input");
    this.fileInputEl.type = "file";
    this.fileInputEl.accept = "image/*";
    this.fileInputEl.setAttr("capture", "environment");
    this.fileInputEl.style.display = "none";
    this.fileInputEl.addEventListener("change", async () => {
      const file = this.fileInputEl?.files?.[0];
      if (file) await this.scanImageFile(file, status);
      if (this.fileInputEl) this.fileInputEl.value = "";
    });
    if (this.options.autoStart) window.setTimeout(() => {
      if (!this.stopped) void this.startCamera(status);
    }, 0);
    void this.startShortcutInboxWatcher(status);
    this.updateCameraControlButtons();
  }

  onClose(): void {
    this.stopped = true;
    this.stopScanning();
    this.stopShortcutInboxWatcher();
    this.options.onClose?.();
    this.contentEl.empty();
  }

  private shouldShowAppleShortcutButton(): boolean {
    return this.isIOSLike();
  }

  private openAppleShortcut(statusEl: HTMLElement): void {
    void this.startShortcutInboxWatcher(statusEl);
    statusEl.setText(`Opening Apple Shortcut. TPS Health is watching ${SHORTCUT_BARCODE_INBOX_PATH} for the scanned barcode.`);
    const url = appleShortcutBarcodeUrl();
    const opened = window.open(url, "_blank");
    if (!opened) window.location.href = url;
  }

  private async startShortcutInboxWatcher(statusEl: HTMLElement): Promise<void> {
    if (this.shortcutInboxEventRefs.length || this.shortcutInboxPollInterval != null) return;
    const file = this.shortcutInboxFile();
    this.shortcutInboxBaselineMtime = file?.stat.mtime || 0;
    this.shortcutInboxLastProcessedMtime = this.shortcutInboxBaselineMtime;
    this.shortcutInboxEventRefs = [
      this.app.vault.on("create", (changed) => {
        if (changed instanceof TFile && changed.path === SHORTCUT_BARCODE_INBOX_PATH) void this.processShortcutInbox(statusEl);
      }),
      this.app.vault.on("modify", (changed) => {
        if (changed instanceof TFile && changed.path === SHORTCUT_BARCODE_INBOX_PATH) void this.processShortcutInbox(statusEl);
      }),
    ];
    this.shortcutInboxPollInterval = window.setInterval(() => {
      void this.processShortcutInbox(statusEl);
    }, 1500);
  }

  private stopShortcutInboxWatcher(): void {
    for (const ref of this.shortcutInboxEventRefs) this.app.vault.offref(ref);
    this.shortcutInboxEventRefs = [];
    if (this.shortcutInboxPollInterval != null) {
      window.clearInterval(this.shortcutInboxPollInterval);
      this.shortcutInboxPollInterval = null;
    }
  }

  private async processShortcutInbox(statusEl: HTMLElement): Promise<void> {
    if (this.stopped || this.lookupInProgress) return;
    const file = this.shortcutInboxFile();
    if (!file || file.stat.mtime <= this.shortcutInboxBaselineMtime || file.stat.mtime === this.shortcutInboxLastProcessedMtime) return;
    let content = "";
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.debug("TPS Health Apple Shortcut barcode inbox read failed", error);
      return;
    }
    const barcode = shortcutBarcodeFromContent(content);
    if (!barcode || barcode === this.shortcutInboxLastProcessedBarcode) return;
    this.shortcutInboxLastProcessedMtime = file.stat.mtime;
    this.shortcutInboxLastProcessedBarcode = barcode;
    statusEl.setText(`Apple Shortcut barcode received: ${barcode}`);
    try {
      await this.app.vault.modify(file, `Processed by TPS Health at ${isoNow()}\n`);
    } catch (error) {
      console.debug("TPS Health Apple Shortcut barcode inbox clear failed", error);
    }
    await this.lookup(barcode, statusEl);
  }

  private shortcutInboxFile(): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(SHORTCUT_BARCODE_INBOX_PATH);
    return file instanceof TFile ? file : null;
  }

  private async startCamera(statusEl: HTMLElement): Promise<void> {
    if (!this.videoEl) return;
    if (this.stopped) return;
    if (this.cameraStartInProgress || this.stream || this.scanInterval != null) return;
    this.cameraStartInProgress = true;
    const sessionId = ++this.cameraSessionId;
    try {
      statusEl.setText("Checking native barcode scanner...");
      if (await this.tryNativeBarcodeBridge(statusEl)) return;
      statusEl.setText("Web camera scanner active. Scanning...");
      this.torchEnabled = false;
      this.stream = await this.requestCameraStream();
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      await this.startZxingVideoScan(statusEl);
      this.scheduleCanvasScanFallback(statusEl, sessionId);
      this.updateCameraControlButtons();
    } catch (error) {
      console.warn("TPS Health camera start failed", error);
      statusEl.setText(`Camera/scanner unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.cameraStartInProgress = false;
      this.updateCameraControlButtons();
    }
  }

  private async tryNativeBarcodeBridge(statusEl: HTMLElement): Promise<boolean> {
    if (!this.shouldTryNativeBarcodeBridge()) return false;
    const scan = this.getNativeBarcodeBridge();
    if (!scan) {
      console.debug("TPS Health native barcode bridge unavailable; using web camera scanner");
      statusEl.setText("Native scanner bridge unavailable; using web camera scanner.");
      return false;
    }
    statusEl.setText("Opening native barcode scanner...");
    try {
      const result = await scan();
      const barcode = nativeBarcodeBridgeValue(result);
      if (!barcode) {
        console.debug("TPS Health native barcode bridge returned no barcode; using web camera scanner", result);
        statusEl.setText("Native scanner returned no barcode; using web camera scanner.");
        return false;
      }
      statusEl.setText(`Barcode found: ${barcode}`);
      await this.lookup(barcode, statusEl);
      return true;
    } catch (error) {
      console.debug("TPS Health native barcode bridge unavailable or cancelled; using web camera scanner", error);
      statusEl.setText("Native scanner unavailable or cancelled; using web camera scanner.");
      return false;
    }
  }

  private shouldTryNativeBarcodeBridge(): boolean {
    return /Android/i.test(this.navigatorInfo().userAgent || "") || this.isIOSLike();
  }

  private isIOSLike(): boolean {
    const nav = this.navigatorInfo();
    const userAgent = nav.userAgent || "";
    const platform = nav.platform || "";
    return /iPhone|iPad|iPod/i.test(`${userAgent} ${platform}`)
      || (/Macintosh/i.test(userAgent) && nav.maxTouchPoints > 1);
  }

  private getNativeBarcodeBridge(): (() => Promise<unknown>) | null {
    if (this.options.adapters?.nativeBridgeScan) return this.options.adapters.nativeBridgeScan;
    const win = window as any;
    const plugins = win.Capacitor?.Plugins || win.Capacitor?.plugins || {};
    const scanner = plugins.BarcodeScanner || win.BarcodeScanner || win.CapacitorBarcodeScanner;
    if (!scanner) return null;
    const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
    if (typeof scanner.scanBarcode === "function") {
      return () => scanner.scanBarcode({
        formats,
        hint: win.CapacitorBarcodeScannerTypeHint?.ALL ?? 17,
        scanInstructions: "Center the UPC or EAN barcode.",
      });
    }
    if (typeof scanner.scan === "function") {
      return () => scanner.scan({ formats });
    }
    if (typeof scanner.startScan === "function") {
      return () => scanner.startScan({ targetedFormats: formats });
    }
    return null;
  }

  private async startZxingVideoScan(statusEl: HTMLElement): Promise<void> {
    if (!this.videoEl) return;
    try {
      const reader = this.createLiveBarcodeReader();
      this.zxingVideoControls = await reader.decodeFromVideoElement(this.videoEl, (result: any) => {
        const text = result?.getText?.() || result?.text || result?.code;
        if (!text || this.stopped || this.lookupInProgress) return;
        statusEl.setText(`Barcode found: ${text}`);
        void this.lookup(String(text), statusEl);
      });
    } catch (error) {
      console.warn("TPS Health ZXing video scanner failed", error);
      statusEl.setText("Camera active. Using backup scanner...");
      await this.startCanvasScanLoop(statusEl);
    }
  }

  private scheduleCanvasScanFallback(statusEl: HTMLElement, sessionId: number): void {
    if (this.fallbackScanTimeout != null) window.clearTimeout(this.fallbackScanTimeout);
    this.fallbackScanTimeout = window.setTimeout(() => {
      this.fallbackScanTimeout = null;
      if (this.stopped || this.lookupInProgress || this.cameraSessionId !== sessionId || this.scanInterval != null) return;
      void this.startCanvasScanLoop(statusEl);
    }, 900);
  }

  private async requestCameraStream(): Promise<MediaStream> {
    const getUserMedia = this.options.adapters?.requestCameraStream || navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!getUserMedia) {
      throw new Error("Camera API is not available in this Obsidian view. Use Scan image or manual entry.");
    }
    try {
      return await getUserMedia({
        video: {
          facingMode: { ideal: this.desiredFacingMode || this.defaultFacingMode() },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
      });
    } catch (error: any) {
      try {
        return await getUserMedia({ video: true });
      } catch (fallbackError: any) {
        throw new Error(this.cameraErrorMessage(fallbackError || error));
      }
    }
  }

  private async toggleTorch(statusEl: HTMLElement): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as any;
    if (!track || !capabilities?.torch) {
      statusEl.setText("Flash is not available for this camera. You can still scan, flip camera, scan an image, or enter manually.");
      new Notice("Flash is not available for this camera");
      return;
    }
    const next = !this.torchEnabled;
    try {
      await (track.applyConstraints as any)({ advanced: [{ torch: next }] });
      this.torchEnabled = next;
      this.updateCameraControlButtons();
      statusEl.setText(next ? "Flash on. Scanning..." : "Flash off. Scanning...");
    } catch (error) {
      console.warn("TPS Health torch toggle failed", error);
      statusEl.setText(`Could not change flash: ${error instanceof Error ? error.message : String(error)}.`);
      new Notice("Could not change flash");
    }
  }

  private async flipCamera(statusEl: HTMLElement): Promise<void> {
    if (this.cameraStartInProgress) return;
    this.desiredFacingMode = this.desiredFacingMode === "environment" ? "user" : "environment";
    this.torchEnabled = false;
    this.stopScanning();
    this.updateCameraControlButtons();
    statusEl.setText(`Switching to ${this.desiredFacingMode === "environment" ? "rear" : "front"} camera...`);
    await this.startCamera(statusEl);
  }

  private updateCameraControlButtons(): void {
    const hasCamera = Boolean(this.stream);
    this.flashButton?.setButtonText(this.torchEnabled ? "Flash off" : "Flash");
    this.flashButton?.setDisabled(!hasCamera);
    this.flipButton?.setDisabled(this.cameraStartInProgress);
  }

  private defaultFacingMode(): "environment" | "user" {
    return /Android|iPhone|iPad|iPod/i.test(this.navigatorInfo().userAgent || "") ? "environment" : "user";
  }

  private async startCanvasScanLoop(statusEl: HTMLElement): Promise<void> {
    if (!this.videoEl) return;
    const reader = this.createCanvasBarcodeReader();
    this.canvasEl = document.createElement("canvas");
    this.canvasContext = this.canvasEl.getContext("2d", { willReadFrequently: true });
    if (!this.canvasContext) throw new Error("Could not create scanner canvas");

    let attempts = 0;
    let decodeInProgress = false;
    if (this.scanInterval != null) window.clearInterval(this.scanInterval);
    this.scanInterval = window.setInterval(async () => {
      if (this.stopped || this.lookupInProgress || decodeInProgress || !this.videoEl || !this.canvasEl || !this.canvasContext) return;
      const width = this.videoEl.videoWidth;
      const height = this.videoEl.videoHeight;
      if (!width || !height) return;
      attempts++;
      decodeInProgress = true;
      try {
        this.canvasEl.width = width;
        this.canvasEl.height = height;
        this.canvasContext.drawImage(this.videoEl, 0, 0, width, height);
        const heavy = attempts % 2 === 0;
        const result = await this.tryDecodeCanvases(reader, barcodeScanCanvases(this.canvasEl, heavy));
        if (result) {
          statusEl.setText(`Barcode found: ${result}`);
          await this.lookup(result, statusEl);
        } else if (attempts % 12 === 0) {
          statusEl.setText("Scanning... keep the barcode steady, well lit, and centered.");
        }
      } finally {
        decodeInProgress = false;
      }
    }, 180);
  }

  private async scanImageFile(file: File, statusEl: HTMLElement): Promise<void> {
    if (!file.type.startsWith("image/")) {
      statusEl.setText("Select an image file.");
      return;
    }
    statusEl.setText(`Scanning ${file.name}...`);
    const imageUrl = URL.createObjectURL(file);
    try {
      const img = await loadImage(imageUrl);
      const reader = this.createCanvasBarcodeReader();
      const result = await this.tryDecodeCanvases(reader, barcodeImageCanvases(img));
      if (result) {
        statusEl.setText(`Barcode found: ${result}`);
        await this.lookup(result, statusEl);
        return;
      }
      statusEl.setText("No barcode found in image. Try a clearer image or manual entry.");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  private async tryDecodeCanvases(reader: any, canvases: HTMLCanvasElement[]): Promise<string | null> {
    const nativeResult = await this.tryNativeBarcodeDetector(canvases);
    if (nativeResult) return nativeResult;
    for (const canvas of canvases) {
      const result = await this.tryDecodeCanvas(reader, canvas);
      if (result) return result;
    }
    return null;
  }

  private async tryNativeBarcodeDetector(canvases: HTMLCanvasElement[]): Promise<string | null> {
    const detector = this.getNativeBarcodeDetector();
    if (!detector) return null;
    for (const canvas of canvases) {
      try {
        const detections = await detector.detect(canvas);
        const rawValue = detections?.[0]?.rawValue;
        if (rawValue) return String(rawValue);
      } catch (error) {
        console.debug("TPS Health native barcode detect failed", error);
        return null;
      }
    }
    return null;
  }

  private getNativeBarcodeDetector(): any {
    if (this.nativeBarcodeDetectorChecked) return this.nativeBarcodeDetector;
    this.nativeBarcodeDetectorChecked = true;
    if (this.options.adapters?.createNativeDetector) {
      this.nativeBarcodeDetector = this.options.adapters.createNativeDetector();
      return this.nativeBarcodeDetector;
    }
    const BarcodeDetector = (window as any).BarcodeDetector;
    if (!BarcodeDetector) return null;
    try {
      this.nativeBarcodeDetector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
      });
    } catch (error) {
      console.debug("TPS Health native BarcodeDetector unavailable", error);
      this.nativeBarcodeDetector = null;
    }
    return this.nativeBarcodeDetector;
  }

  private createLiveBarcodeReader(): any {
    return this.options.adapters?.createLiveReader?.() || createLiveBarcodeReader();
  }

  private createCanvasBarcodeReader(): any {
    return this.options.adapters?.createCanvasReader?.() || createBarcodeReader();
  }

  private navigatorInfo(): Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> {
    return this.options.adapters?.navigatorInfo || navigator;
  }

  private async tryDecodeCanvas(reader: any, canvas: HTMLCanvasElement): Promise<string | null> {
    const methods = [
      () => reader.decodeFromCanvas?.(canvas),
      () => {
        const img = new Image();
        img.src = canvas.toDataURL("image/png");
        return reader.decodeFromImageElement?.(img);
      },
      () => reader.decode?.(canvas),
    ];
    for (const method of methods) {
      try {
        const result = await method();
        const text = result?.getText?.() || result?.text || result?.code;
        if (text) return String(text);
      } catch (error: any) {
        if (error?.name && error.name !== "NotFoundException") console.debug("TPS Health barcode decode failed", error);
      }
    }
    return null;
  }

  private async lookup(rawBarcode: string, statusEl?: HTMLElement): Promise<void> {
    const trimmed = rawBarcode.trim();
    if (!trimmed) {
      new Notice("Barcode is required");
      return;
    }
    const barcode = barcodeFromInput(trimmed);
    if (!barcode) {
      new Notice("Enter a valid UPC or EAN barcode.");
      return;
    }
    this.lookupInProgress = true;
    this.stopScanning();
    statusEl?.setText(`Looking up barcode ${barcode}...`);
    try {
      const item = await this.plugin.lookupFoodByBarcode(barcode);
      const reviewItem: FoodItem = item || {
        id: barcode,
        name: `Barcode ${barcode}`,
        barcode,
        source: "manual",
        servingAmount: 1,
        servingUnit: "serving",
        nutrition: {},
      };
      if (!item) {
        new Notice("No database match found. Create a local food note manually.");
      }
      if (item && this.onItem) {
        await this.onItem(item);
      } else {
        new BarcodeFoodReviewModal(this.app, this.plugin, reviewItem, item ? undefined : "No database match found for this barcode. Review and create a local food note.", this.dateContext).open();
      }
      this.close();
    } catch (error) {
      console.warn("TPS Health barcode lookup failed", error);
      this.lookupInProgress = false;
      this.stopped = false;
      statusEl?.setText(`Barcode lookup failed: ${error instanceof Error ? error.message : String(error)}. You can try again, scan an image, or enter manually.`);
      new Notice("Barcode lookup failed");
    }
  }

  private stopScanning(): void {
    this.cameraSessionId++;
    if (this.fallbackScanTimeout != null) {
      window.clearTimeout(this.fallbackScanTimeout);
      this.fallbackScanTimeout = null;
    }
    try {
      this.zxingVideoControls?.stop?.();
    } catch (error) {
      console.debug("TPS Health ZXing video scanner stop failed", error);
    }
    this.zxingVideoControls = null;
    if (this.scanInterval != null) {
      window.clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.videoEl) this.videoEl.srcObject = null;
    this.torchEnabled = false;
    this.updateCameraControlButtons();
  }

  private cameraHelpText(): string {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) return "On iOS, allow camera access when prompted. If scanning fails, use Scan image or manual entry.";
    return "Hold a UPC/EAN barcode flat, well lit, and filling most of the camera frame.";
  }

  private cameraErrorMessage(error: any): string {
    switch (error?.name) {
      case "NotAllowedError":
        return "Camera permission was denied. Enable camera access for Obsidian, or use Scan image/manual entry.";
      case "NotFoundError":
        return "No camera was found. Use Scan image or manual entry.";
      case "NotReadableError":
        return "Camera is already in use by another app. Close the other app or use Scan image/manual entry.";
      case "OverconstrainedError":
        return "The requested camera settings are not supported. Try again or use Scan image/manual entry.";
      default:
        return `Camera access failed: ${error?.message || "unknown error"}. Use Scan image or manual entry.`;
    }
  }
}

class BarcodeFoodReviewModal extends Modal {
  constructor(app: App, private plugin: TPSHealthPlugin, private item: FoodItem, private warning?: string, private dateContext: FoodLogDateContext | null = null) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("tps-health-modal-frame", "tps-health-food-log-frame");
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Create food note" });
    if (this.warning) this.contentEl.createDiv({ cls: "tps-health-status tps-health-status--warning", text: this.warning });
    if (this.item.imageUrl) {
      const image = this.contentEl.createEl("img");
      image.addClass("tps-health-food-image");
      image.src = this.item.imageUrl;
    }
    let name = this.item.name;
    let brand = this.item.brand || "";
    let servingAmount = this.item.servingAmount || 1;
    let servingUnit = this.item.servingUnit || "serving";
    const nutrition: Nutrition = { ...this.item.nutrition };
    const caloriePreview = this.contentEl.createDiv({ cls: "tps-health-status" });
    const updateCaloriePreview = () => caloriePreview.setText(`Calories calculated from macros: ${caloriesFromMacros(nutrition)} kcal per ${servingAmount} ${servingUnit}`);

    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => name = value.trim()));
    new Setting(this.contentEl).setName("Brand").addText((text) => text.setValue(brand).onChange((value) => brand = value.trim()));
    new Setting(this.contentEl).setName("Serving amount").setDesc("The nutrition values below are for this serving amount.").addText((text) => text.setValue(String(servingAmount)).onChange((value) => {
      servingAmount = Number(value) || 1;
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Serving unit").setDesc("Example: serving, bar, cup, 100 g, 12 fl oz.").addText((text) => text.setValue(servingUnit).onChange((value) => {
      servingUnit = value.trim() || "serving";
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Protein g").addText((text) => text.setValue(String(nutrition.proteinG || 0)).onChange((value) => {
      nutrition.proteinG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Carbs g").addText((text) => text.setValue(String(nutrition.carbsG || 0)).onChange((value) => {
      nutrition.carbsG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Fat g").addText((text) => text.setValue(String(nutrition.fatG || 0)).onChange((value) => {
      nutrition.fatG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Fiber g").addText((text) => text.setValue(String(nutrition.fiberG || 0)).onChange((value) => nutrition.fiberG = numberOrUndefined(value)));
    new Setting(this.contentEl).setName("Sugar g").addText((text) => text.setValue(String(nutrition.sugarG || 0)).onChange((value) => nutrition.sugarG = numberOrUndefined(value)));
    new Setting(this.contentEl).setName("Alcohol g").setDesc("Alcohol is calculated at 7 kcal per gram.").addText((text) => text.setValue(String(nutrition.alcoholG || 0)).onChange((value) => {
      nutrition.alcoholG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Sodium mg").addText((text) => text.setValue(String(nutrition.sodiumMg || 0)).onChange((value) => nutrition.sodiumMg = numberOrUndefined(value)));
    updateCaloriePreview();
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Create and log")
        .setCta()
        .onClick(async () => {
          if (!name) {
            new Notice("Name is required");
            return;
          }
          if (!Number.isFinite(servingAmount) || servingAmount <= 0 || !servingUnit.trim()) {
            new Notice("Serving size is required");
            return;
          }
          const saved = await this.plugin.findOrCreateFoodNote({
            ...this.item,
            name,
            brand: brand || undefined,
            servingAmount,
            servingUnit,
            nutrition: nutritionWithMacroCalories(nutrition),
          });
          this.close();
          new FoodLogModal(this.app, this.plugin, saved, null, this.dateContext).open();
        }));
  }
}

class FoodLogModal extends Modal {
  private keyboardCleanup: (() => void) | null = null;

  constructor(app: App, private plugin: TPSHealthPlugin, private item: FoodItem, private initialDraft: InlineFoodDraft | null = null, private dateContext: FoodLogDateContext | null = null) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("tps-health-modal-frame", "tps-health-food-log-frame");
    this.keyboardCleanup = setupKeyboardAwareHealthModal(this.modalEl, this.contentEl);
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: this.item.name });
    let quantity = this.initialDraft?.quantity || 1;
    let unit = this.initialDraft?.unit || preferredFoodLogUnit(this.item);
    let section = this.plugin.settings.defaultFoodLogSection;
    let completedDate = this.dateContext?.dateIso;
    if (this.dateContext && !this.dateContext.isToday) {
      const dateContext = this.dateContext;
      new Notice(`Food log date: ${dateContext.label}`);
      const dateStatus = this.contentEl.createDiv({ cls: "tps-health-status tps-health-date-choice" });
      const updateDateStatus = () => dateStatus.setText(`Consumed date: ${completedDate === dateContext.dateIso ? dateContext.label : "Today"}`);
      updateDateStatus();
      new Setting(this.contentEl)
        .setName("Consumed date")
        .setDesc("Choose whether this food was consumed today or on the open daily note.")
        .addButton((button) => button
          .setButtonText("Today")
          .onClick(() => {
            completedDate = undefined;
            updateDateStatus();
            new Notice("Food will be logged for today");
          }))
        .addButton((button) => button
          .setButtonText(dateContext.label)
          .setCta()
          .onClick(() => {
            completedDate = dateContext.dateIso;
            updateDateStatus();
            new Notice(`Food will be logged for ${dateContext.label}`);
          }));
    }
    const summaryEl = this.contentEl.createDiv({ cls: "tps-health-log-summary" });
    const servingEl = summaryEl.createDiv({ cls: "tps-health-log-serving" });
    const nutritionEl = summaryEl.createDiv({ cls: "tps-health-log-nutrition" });
    const updatePreview = () => {
      const resolved = resolveFoodLogServing(this.item, quantity, unit);
      const parts = [`${quantity} ${unit}`];
      if (resolved.servings !== quantity || normalizeServingUnit(unit) !== "serving") parts.push(`${round(resolved.servings)} serving${resolved.servings === 1 ? "" : "s"}`);
      if (resolved.amount != null && resolved.amountUnit) parts.push(`${resolved.amount} ${resolved.amountUnit}`);
      servingEl.setText(parts.join(" = "));
      renderMacroPills(nutritionEl, multiplyNutrition(this.item.nutrition || {}, resolved.servings));
    };
    updatePreview();
    new Setting(this.contentEl).setName("Amount").addText((text) => text.setValue(String(quantity)).onChange((value) => {
      quantity = Number(value) || 1;
      updatePreview();
    }));
    new Setting(this.contentEl).setName("Unit").addDropdown((dropdown) => {
      const unitOptions = new Set(foodLogUnitOptions(this.item));
      unitOptions.add(unit);
      for (const option of unitOptions) dropdown.addOption(option, foodLogUnitOptionLabel(this.item, option));
      dropdown.setValue(unit).onChange((value) => {
        unit = value;
        updatePreview();
      });
    });
    new Setting(this.contentEl)
      .setName("Daily note section")
      .setDesc("Optional. Blank logs at the top of the daily note body, right after frontmatter.")
      .addText((text) => text
        .setPlaceholder("Food Log, Breakfast, Workout Fuel...")
        .setValue(section)
        .onChange((value) => section = value.trim()));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Log").setCta().onClick(async () => {
      await this.plugin.logFood(this.item, quantity, unit, section || undefined, completedDate);
      this.close();
    }));
  }

  onClose(): void {
    this.keyboardCleanup?.();
    this.keyboardCleanup = null;
    this.contentEl.empty();
  }
}

class StartWorkoutModal extends Modal {
  private selectedWorkoutDate?: string;

  constructor(app: App, private plugin: TPSHealthPlugin, private dateContext: FoodLogDateContext | null = null) {
    super(app);
    this.selectedWorkoutDate = dateContext?.dateIso || "";
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Start workout" });
    this.contentEl.createEl("p", {
      text: "Creates an active workout session, opens the workout note when available, and starts the GCM timer for the whole workout.",
      cls: "tps-health-status",
    });

    let title = "";
    let plan = "";
    let logTarget = this.plugin.settings.workoutLogTarget;
    let cooldownDays = this.plugin.settings.defaultWorkoutCooldownDays;
    let openFile = true;
    let workoutDate = this.selectedWorkoutDate || "";

    if (this.dateContext && !this.dateContext.isToday) {
      new Notice(`Workout date defaults to ${this.dateContext.label}.`);
      new Setting(this.contentEl)
        .setName("Workout date")
        .setDesc("Choose whether this workout belongs to today or the open daily note.")
        .addButton((button) => button
          .setButtonText("Today")
          .onClick(() => {
            this.selectedWorkoutDate = "";
            this.onOpen();
          }))
        .addButton((button) => button
          .setButtonText(this.dateContext?.label || "Open note")
          .onClick(() => {
            this.selectedWorkoutDate = this.dateContext?.dateIso || "";
            this.onOpen();
          }));
    }

    new Setting(this.contentEl)
      .setName("Title")
      .setDesc("Optional. Leave blank to use the workout plan name and timestamp.")
      .addText((text) => text
        .setPlaceholder("Workout")
        .onChange((value) => title = value.trim()));

    new Setting(this.contentEl)
      .setName("Workout plan")
      .setDesc("Optional. Matches an existing workout plan by name or creates one when missing.")
      .addText((text) => text
        .setPlaceholder("Push Day, Chest, Legs...")
        .onChange((value) => plan = value.trim()));

    new Setting(this.contentEl)
      .setName("Store workout")
      .setDesc("Uses the plugin default unless changed here.")
      .addDropdown((dropdown) => dropdown
        .addOption("session-note", "Session note")
        .addOption("daily-note", "Daily note")
        .addOption("both", "Both")
        .setValue(logTarget)
        .onChange((value) => logTarget = value as typeof logTarget));

    new Setting(this.contentEl)
      .setName("Cooldown days")
      .setDesc("Used when this workout is finished.")
      .addText((text) => text
        .setValue(String(cooldownDays))
        .onChange((value) => {
          const parsed = Number(value);
          cooldownDays = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
        }));

    new Setting(this.contentEl)
      .setName("Open workout note")
      .addToggle((toggle) => toggle
        .setValue(openFile)
        .onChange((value) => openFile = value));

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Start")
        .setCta()
        .onClick(async () => {
          await this.plugin.startWorkout({
            title: title || undefined,
            plan: plan || undefined,
            cooldownDays,
            logTarget,
            startedAt: workoutDate ? timestampForDate(workoutDate) : undefined,
            dailyNoteDate: workoutDate || undefined,
            openFile,
          });
          this.close();
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class WorkoutPlanModal extends Modal {
  constructor(app: App, private plugin: TPSHealthPlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Create workout plan" });
    let name = "";
    let cooldownDays = this.plugin.settings.defaultWorkoutCooldownDays;
    let defaultRestSeconds = this.plugin.settings.defaultRestSeconds;
    let notes = "";
    new Setting(this.contentEl).setName("Name").addText((text) => text.onChange((value) => name = value.trim()));
    new Setting(this.contentEl)
      .setName("Cooldown days")
      .setDesc("Days to wait after completing this workout before it is considered ready again.")
      .addText((text) => text
        .setValue(String(cooldownDays))
        .onChange((value) => cooldownDays = Math.max(0, Math.round(Number(value) || 0))));
    new Setting(this.contentEl).setName("Default rest seconds").addText((text) => text
      .setValue(String(defaultRestSeconds))
      .onChange((value) => defaultRestSeconds = Math.max(0, Math.round(Number(value) || this.plugin.settings.defaultRestSeconds))));
    new Setting(this.contentEl).setName("Notes").addTextArea((text) => text.onChange((value) => notes = value.trim()));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Create").setCta().onClick(async () => {
      if (!name) {
        new Notice("Name is required");
        return;
      }
      await this.plugin.createWorkoutPlan({ name, cooldownDays, defaultRestSeconds, notes });
      this.close();
    }));
  }
}

class SetModal extends Modal {
  constructor(app: App, private plugin: TPSHealthPlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Log set" });
    let exercise = "";
    let reps: number | undefined;
    let weight: number | undefined;
    let weightUnit = "lb";
    let rpe: number | undefined;
    let setType: NonNullable<WorkoutSet["setType"]> = "normal";
    let supersetGroupId = "";
    let dropSetGroupId = "";
    new Setting(this.contentEl).setName("Exercise").addText((text) => text.onChange((value) => exercise = value.trim()));
    new Setting(this.contentEl).setName("Reps").addText((text) => text.onChange((value) => reps = numberOrUndefined(value)));
    new Setting(this.contentEl).setName("Weight").addText((text) => text.onChange((value) => weight = numberOrUndefined(value)));
    new Setting(this.contentEl).setName("Weight unit").addText((text) => text.setValue(weightUnit).onChange((value) => weightUnit = value || "lb"));
    new Setting(this.contentEl).setName("RPE").addText((text) => text.onChange((value) => rpe = numberOrUndefined(value)));
    new Setting(this.contentEl)
      .setName("Set type")
      .addDropdown((dropdown) => dropdown
        .addOption("normal", "Normal")
        .addOption("warmup", "Warmup")
        .addOption("drop", "Drop")
        .addOption("failure", "Failure")
        .setValue(setType)
        .onChange((value) => setType = value as NonNullable<WorkoutSet["setType"]>));
    new Setting(this.contentEl).setName("Superset group").setDesc("Use the same id for sets performed together.").addText((text) => text.onChange((value) => supersetGroupId = value.trim()));
    new Setting(this.contentEl).setName("Dropset group").setDesc("Use the same id on linked dropset sets.").addText((text) => text.onChange((value) => dropSetGroupId = value.trim()));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Log").setCta().onClick(async () => {
      if (!exercise) {
        new Notice("Exercise is required");
        return;
      }
      await this.plugin.logSet({
        exercise,
        reps,
        weight,
        weightUnit,
        rpe,
        setType,
        supersetGroupId: supersetGroupId || undefined,
        dropSetGroupId: dropSetGroupId || undefined,
      });
      this.close();
    }));
  }
}

class CustomFoodModal extends Modal {
  private keyboardCleanup: (() => void) | null = null;

  constructor(app: App, private plugin: TPSHealthPlugin, private type: "food" | "recipe", private initialName = "", private logAfterCreate = false, private baseFood?: FoodItem, private dateContext: FoodLogDateContext | null = null) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("tps-health-modal-frame");
    this.keyboardCleanup = setupKeyboardAwareHealthModal(this.modalEl, this.contentEl);
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: this.type === "recipe" ? "Create recipe" : "Create custom food" });
    let name = this.initialName || this.baseFood?.name || "";
    let brand = this.baseFood?.brand || "";
    let servingAmount = this.baseFood?.servingAmount || 1;
    let servingUnit = this.baseFood?.servingUnit || "serving";
    const nutrition: Nutrition = { ...this.baseFood?.nutrition };
    const caloriePreview = this.contentEl.createDiv({ cls: "tps-health-status" });
    const updateCaloriePreview = () => caloriePreview.setText(`Calories calculated from macros: ${caloriesFromMacros(nutrition)} kcal per ${servingAmount} ${servingUnit}`);
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => name = value.trim()));
    new Setting(this.contentEl).setName("Brand").addText((text) => text.setValue(brand).onChange((value) => brand = value.trim()));
    new Setting(this.contentEl).setName("Serving amount").setDesc("The nutrition values below are for this serving amount.").addText((text) => text.setValue(String(servingAmount)).onChange((value) => {
      servingAmount = Number(value) || 1;
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Serving unit").setDesc("Example: serving, bar, cup, 100 g, 12 fl oz.").addText((text) => text.setValue(servingUnit).onChange((value) => {
      servingUnit = value.trim() || "serving";
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Protein g").addText((text) => text.setValue(String(nutrition.proteinG || 0)).onChange((value) => {
      nutrition.proteinG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Carbs g").addText((text) => text.setValue(String(nutrition.carbsG || 0)).onChange((value) => {
      nutrition.carbsG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Fat g").addText((text) => text.setValue(String(nutrition.fatG || 0)).onChange((value) => {
      nutrition.fatG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Fiber g").addText((text) => text.setValue(String(nutrition.fiberG || 0)).onChange((value) => nutrition.fiberG = numberOrUndefined(value)));
    new Setting(this.contentEl).setName("Sugar g").addText((text) => text.setValue(String(nutrition.sugarG || 0)).onChange((value) => nutrition.sugarG = numberOrUndefined(value)));
    new Setting(this.contentEl).setName("Alcohol g").setDesc("Alcohol is calculated at 7 kcal per gram.").addText((text) => text.setValue(String(nutrition.alcoholG || 0)).onChange((value) => {
      nutrition.alcoholG = numberOrUndefined(value);
      updateCaloriePreview();
    }));
    new Setting(this.contentEl).setName("Sodium mg").addText((text) => text.setValue(String(nutrition.sodiumMg || 0)).onChange((value) => nutrition.sodiumMg = numberOrUndefined(value)));
    updateCaloriePreview();
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Create").setCta().onClick(async () => {
      if (!name) {
        new Notice("Name is required");
        return;
      }
      if (!Number.isFinite(servingAmount) || servingAmount <= 0 || !servingUnit.trim()) {
        new Notice("Serving size is required");
        return;
      }
      const saved = await this.plugin.upsertFoodFromInput({
        type: this.type,
        name,
        brand: brand || undefined,
        imageUrl: this.baseFood?.imageUrl,
        barcode: this.baseFood?.barcode,
        ingredients: this.baseFood?.ingredients,
        servingAmount,
        servingUnit,
        servingGrams: this.baseFood?.servingGrams,
        servingMl: this.baseFood?.servingMl,
        sourceImagePath: this.baseFood?.sourceImagePath,
        notes: this.baseFood?.notes,
        nutrition,
      });
      this.close();
      if (this.logAfterCreate) new FoodLogModal(this.app, this.plugin, saved, null, this.dateContext).open();
    }));
  }

  onClose(): void {
    this.keyboardCleanup?.();
    this.keyboardCleanup = null;
    this.contentEl.empty();
  }
}

class FinishWorkoutPromptModal extends Modal {
  constructor(app: App, private onFinish: () => Promise<void>, private onAddSet: () => void, private onDismiss: () => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Finish workout?" });
    this.contentEl.createEl("p", {
      text: "All planned sets are checked. Finish the active workout now?",
      cls: "tps-health-status",
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Keep going")
        .onClick(() => {
          this.close();
          this.onDismiss();
        }))
      .addButton((button) => button
        .setButtonText("Add set")
        .onClick(() => {
          this.close();
          this.onAddSet();
        }))
      .addButton((button) => button
        .setButtonText("Finish workout")
        .setCta()
        .onClick(async () => {
          this.close();
          await this.onFinish();
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SaveWorkoutTemplateModal extends Modal {
  constructor(app: App, private plugin: TPSHealthPlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Save workout template" });
    let templateName = this.plugin.settings.activeWorkoutTitle || "Workout Template";
    let cooldownDays = this.plugin.settings.defaultWorkoutCooldownDays;
    let defaultRestSeconds = this.plugin.settings.defaultRestSeconds;

    new Setting(this.contentEl).setName("Template name").addText((text) => text.setValue(templateName).onChange((value) => {
      templateName = value.trim();
    }));
    new Setting(this.contentEl).setName("Cooldown days").addText((text) => text
      .setValue(String(cooldownDays))
      .onChange((value) => {
        const parsed = Number(value);
        cooldownDays = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : this.plugin.settings.defaultWorkoutCooldownDays;
      }));
    new Setting(this.contentEl).setName("Default rest seconds").addText((text) => text
      .setValue(String(defaultRestSeconds))
      .onChange((value) => {
        const parsed = Number(value);
        defaultRestSeconds = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : this.plugin.settings.defaultRestSeconds;
      }));
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("Save template")
      .setCta()
      .onClick(async () => {
        await this.plugin.saveActiveWorkoutTemplate({
          title: templateName,
          cooldownDays,
          defaultRestSeconds,
        });
        this.close();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class FinishWorkoutTemplateModal extends Modal {
  constructor(app: App, private plugin: TPSHealthPlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("tps-health-modal");
    this.contentEl.createEl("h2", { text: "Finish and save template" });
    let templateName = this.plugin.settings.activeWorkoutTitle || "Workout Template";
    let cooldownDays = this.plugin.settings.defaultWorkoutCooldownDays;
    let defaultRestSeconds = this.plugin.settings.defaultRestSeconds;

    new Setting(this.contentEl).setName("Template name").addText((text) => text.setValue(templateName).onChange((value) => {
      templateName = value.trim();
    }));
    new Setting(this.contentEl).setName("Cooldown days").addText((text) => text
      .setValue(String(cooldownDays))
      .onChange((value) => {
        const parsed = Number(value);
        cooldownDays = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : this.plugin.settings.defaultWorkoutCooldownDays;
      }));
    new Setting(this.contentEl).setName("Default rest seconds").addText((text) => text
      .setValue(String(defaultRestSeconds))
      .onChange((value) => {
        const parsed = Number(value);
        defaultRestSeconds = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : this.plugin.settings.defaultRestSeconds;
      }));
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("Finish and save")
      .setCta()
      .onClick(async () => {
        await this.plugin.finishWorkoutAndSaveTemplate({
          title: templateName,
          cooldownDays,
          defaultRestSeconds,
        });
        this.close();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function caloriesFromMacros(nutrition: Nutrition): number {
  return round(
    (nutrition.proteinG || 0) * 4
    + (nutrition.carbsG || 0) * 4
    + (nutrition.fatG || 0) * 9
    + (nutrition.alcoholG || 0) * 7
  );
}

function nutritionWithMacroCalories(nutrition: Nutrition): Nutrition {
  return {
    ...nutrition,
    calories: caloriesFromMacros(nutrition),
  };
}

function shouldDeriveCaloriesForFood(item: FoodItem): boolean {
  return item.source === "manual" || item.source === "custom-inline";
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function startedAtFromSetEnd(endedAt: string, durationSeconds?: number): string {
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(ended) || !durationSeconds || durationSeconds <= 0) return endedAt;
  return new Date(ended - durationSeconds * 1000).toISOString();
}

function workoutDurationSeconds(startedAt: string | undefined, endedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.round((end - start) / 1000);
}

function secondsBetween(previousIso: string, currentIso: string): number {
  const previous = Date.parse(previousIso);
  const current = Date.parse(currentIso);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous) return 0;
  return Math.round((current - previous) / 1000);
}

function isCheckedWorkoutTaskLine(line: string): boolean {
  return /^\s*-\s+\[[xX]\]\s+/.test(line);
}

function isUncheckedWorkoutTaskLine(line: string): boolean {
  return /^\s*-\s+\[ \]\s+/.test(line);
}

function hasUncheckedPlannedWorkoutTask(lines: string[]): boolean {
  return lines.some((line) => isUncheckedWorkoutTaskLine(line) && !line.includes("[setId::"));
}

function latestCompletedSetEndedAt(lines: string[], beforeIndex: number): string {
  let latest = "";
  for (let index = 0; index < beforeIndex; index++) {
    const line = lines[index];
    if (!isCheckedWorkoutTaskLine(line) || !line.includes("[setId::")) continue;
    const endedAt = readStringField(line, "endedAt") || readStringField(line, "completedDate");
    if (endedAt) latest = endedAt;
  }
  return latest;
}

function parseWorkoutTaskSetLine(line: string): Partial<WorkoutSet> {
  const summary = stripDataviewFields(line)
    .replace(/^\s*-\s+\[[ xX]\]\s+/, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path: string, label: string | undefined) => label || path.split("/").pop()?.replace(/\.md$/i, "") || path)
    .trim();
  const parts = summary.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const detail = parts.pop() || "";
  const exercise = parts.shift() || summary || "Set";
  const parsed: Partial<WorkoutSet> = { exercise };
  for (const marker of parts) {
    const normalized = marker.toLowerCase();
    if (normalized === "warmup" || normalized === "warm-up") parsed.setType = "warmup";
    else if (normalized === "drop") parsed.setType = "drop";
    else if (normalized.startsWith("drop ")) {
      parsed.setType = "drop";
      parsed.dropSetGroupId = marker.slice(5).trim();
    } else if (normalized.startsWith("superset ")) {
      parsed.supersetGroupId = marker.slice(9).trim();
    }
  }
  const detailMatch = detail.match(/^(?:(bodyweight)|(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?)?\s*x\s*(-?\d+(?:\.\d+)?)$/i);
  if (detailMatch) {
    if (detailMatch[2] != null) parsed.weight = numberOrUndefined(detailMatch[2]);
    if (detailMatch[3]) parsed.weightUnit = detailMatch[3];
    parsed.reps = numberOrUndefined(detailMatch[4]);
    return parsed;
  }
  const repsMatch = detail.match(/^(-?\d+(?:\.\d+)?)\s*reps?$/i);
  if (repsMatch) parsed.reps = numberOrUndefined(repsMatch[1]);
  return parsed;
}

function stripDataviewFields(line: string): string {
  return line.replace(/\[[A-Za-z0-9_-]+::\s*[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

function pathLabel(path: string): string {
  const normalized = path.replace(/\.md$/i, "");
  return normalized.split("/").pop() || normalized;
}

function countWorkoutSetTasks(lines: string[]): number {
  const setsHeadingIndex = lines.findIndex((line) => /^##\s+Sets\s*$/i.test(line.trim()));
  const startIndex = setsHeadingIndex >= 0 ? setsHeadingIndex + 1 : frontmatterLineEnd(lines);
  let count = 0;
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (setsHeadingIndex >= 0 && /^##\s+/.test(line.trim())) break;
    if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) count++;
  }
  return count;
}

function frontmatterLineEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return endIndex >= 0 ? endIndex + 1 : 0;
}

function workoutExerciseLabel(set: WorkoutSet): string {
  return set.exercisePath
    ? `[[${set.exercisePath.replace(/\.md$/, "")}|${set.exercise}]]`
    : set.exercise;
}

function withCssClass(value: unknown, cssClass: string): string[] {
  const classes = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string"
      ? value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
      : [];
  if (!classes.includes(cssClass)) classes.push(cssClass);
  return classes;
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (output, [key, value]) => output.split(`{{${key}}}`).join(value),
    template,
  );
}

function leadingSpaces(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function replaceDataviewField(line: string, key: string, value: string | number): string {
  const pattern = new RegExp(`\\[${escapeRegExp(key)}::\\s*[^\\]]*\\]`, "i");
  return pattern.test(line) ? line.replace(pattern, `[${key}:: ${value}]`) : `${line} [${key}:: ${value}]`;
}

function upsertDataviewField(line: string, key: string, value: string | number): string {
  return replaceDataviewField(line, key, value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}

function nutrientValue(nutrients: any[], nutrientIds: number[]): number | undefined {
  for (const id of nutrientIds) {
    const nutrient = nutrients.find((item) => Number(item.nutrientId) === id);
    const value = numberOrUndefined(nutrient?.value);
    if (value != null) return value;
  }
  return undefined;
}

function hasMacroData(nutriments: any): boolean {
  if (!nutriments) return false;
  return [
    nutriments["energy-kcal_serving"],
    nutriments["energy-kcal_100g"],
    nutriments.proteins_serving,
    nutriments.proteins_100g,
    nutriments.fat_serving,
    nutriments.fat_100g,
    nutriments.carbohydrates_serving,
    nutriments.carbohydrates_100g,
  ].some((value) => numberOrUndefined(value) != null && Number(value) > 0);
}

function normalizedQuantity(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function normalizeFoodMetricServing(item: FoodItem): FoodItem {
  const serving = sanitizeFoodServingMetrics(normalizeFoodServingPortion(item));
  if (serving.servingGrams || serving.servingMl) return serving;
  const metric = parseMetricServing(serving.servingAmount || 1, serving.servingUnit || "");
  const inferredDrinkServing = !metric ? inferredDrinkServingForFood(serving) : null;
  const inferredMultiplier = inferredDrinkServing && shouldTreatNutritionAsPer100ml(serving, inferredDrinkServing.ml) ? inferredDrinkServing.ml / 100 : 1;
  return {
    ...serving,
    servingGrams: metric?.unit === "g" ? metric.amount : serving.servingGrams,
    servingMl: metric?.unit === "ml" ? metric.amount : inferredDrinkServing?.ml,
    servingUnit: inferredDrinkServing && normalizeServingUnit(serving.servingUnit || "serving") === "serving" ? inferredDrinkServing.unit : serving.servingUnit,
    nutrition: inferredMultiplier !== 1 ? multiplyNutrition(serving.nutrition || {}, inferredMultiplier) : serving.nutrition,
  };
}

function sanitizeFoodServingMetrics(item: FoodItem): FoodItem {
  return {
    ...item,
    servingGrams: saneMetricServingAmount(item.servingGrams, "g"),
    servingMl: saneMetricServingAmount(item.servingMl, "ml"),
  };
}

function normalizeFoodServingPortion(item: FoodItem): FoodItem {
  const servingUnit = String(item.servingUnit || "serving").trim() || "serving";
  const parsed = parseLeadingServingPortion(servingUnit);
  if (!parsed) return { ...item, servingUnit };
  const existingAmount = Number(item.servingAmount || 1);
  const shouldUseParsedAmount = !Number.isFinite(existingAmount) || existingAmount === 1;
  return {
    ...item,
    servingAmount: shouldUseParsedAmount ? parsed.amount : existingAmount,
    servingUnit: parsed.unit,
  };
}

function foodItemFromInput(input: CreateFoodInput): FoodItem {
  return normalizeFoodMetricServing({
    id: id(input.type || "food"),
    name: input.name,
    brand: input.brand,
    aliases: input.aliases,
    barcode: input.barcode,
    imageUrl: input.imageUrl,
    sourceImagePath: input.sourceImagePath,
    ingredients: input.ingredients,
    servingAmount: input.servingAmount || 1,
    servingUnit: input.servingUnit || "serving",
    servingGrams: input.servingGrams,
    servingMl: input.servingMl,
    source: "manual",
    confidence: input.confidence,
    notes: input.notes,
    nutrition: nutritionWithMacroCalories(input.nutrition || {}),
  });
}

function foodFrontmatter(item: FoodItem, type: "food" | "recipe"): Record<string, unknown> {
  const nutrition = item.nutrition || {};
  return compactObject({
    kind: type,
    name: item.name,
    brand: item.brand,
    aliases: foodAliasesForItem(item).length ? foodAliasesForItem(item) : undefined,
    barcode: item.barcode,
    imageUrl: item.imageUrl,
    sourceImagePath: item.sourceImagePath,
    ingredients: item.ingredients,
    servingAmount: item.servingAmount || 1,
    servingUnit: item.servingUnit || "serving",
    servingGrams: item.servingGrams == null ? undefined : round(item.servingGrams),
    servingMl: item.servingMl == null ? undefined : round(item.servingMl),
    calories: nutrition.calories || 0,
    proteinG: nutrition.proteinG || 0,
    carbsG: nutrition.carbsG || 0,
    fatG: nutrition.fatG || 0,
    fiberG: nutrition.fiberG || 0,
    sugarG: nutrition.sugarG || 0,
    alcoholG: nutrition.alcoholG || 0,
    sodiumMg: nutrition.sodiumMg || 0,
    confidence: item.confidence,
    notes: item.notes,
  });
}

function aliasesFromFrontmatter(value: unknown): string[] | undefined {
  const aliases = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = aliases
    .map((alias) => String(alias).trim())
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : undefined;
}

function foodSearchFields(item: FoodItem): Array<unknown> {
  return [item.name, item.brand, foodAliasesForItem(item).join(" "), item.notes, item.ingredients];
}

function foodAliasesForItem(item: FoodItem): string[] {
  const aliases = new Set<string>();
  for (const alias of item.aliases || []) {
    const trimmed = alias.trim();
    if (trimmed) aliases.add(trimmed);
  }
  for (const alias of inferredFoodAliases(item)) aliases.add(alias);
  return Array.from(aliases);
}

function inferredFoodAliases(item: FoodItem): string[] {
  const name = item.name.trim().replace(/\s+/g, " ");
  const parts = name.split(/\s+-\s+|,\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const aliases = new Set<string>();
  const first = parts[0];
  const rest = parts.slice(1).join(" ");
  aliases.add(parts.join(" "));
  aliases.add(`${first} ${rest}`);
  aliases.add(`${rest} ${first}`);
  if (/\bprotein\b/i.test(first) && /\bcereal\b/i.test(rest)) {
    aliases.add(`${first} cereal`);
  }
  return Array.from(aliases).filter((alias) => normalizeLookup(alias) !== normalizeLookup(name));
}

function yamlStringList(key: string, values: string[]): string {
  if (!values.length) return "";
  return [
    `${key}:`,
    ...values.map((value) => `  - "${value.replace(/"/g, '\\"')}"`),
  ].join("\n");
}

function exerciseFrontmatter(input: CreateExerciseInput, defaultRestSeconds: number): Record<string, unknown> {
  return compactObject({
    kind: "exercise",
    name: input.name,
    category: input.category || "strength",
    primaryMuscles: input.primaryMuscles || [],
    secondaryMuscles: input.secondaryMuscles || [],
    equipment: input.equipment || [],
    defaultRestSeconds: input.defaultRestSeconds || defaultRestSeconds,
    defaultSetType: input.defaultSetType || "normal",
    recommendedRestDays: input.recommendedRestDays,
    notes: input.notes,
  });
}

function workoutPlanFrontmatter(input: CreateWorkoutPlanInput, defaultCooldownDays: number, defaultRestSeconds: number): Record<string, unknown> {
  return compactObject({
    kind: "workout-plan",
    name: input.name,
    cooldownDays: input.cooldownDays ?? defaultCooldownDays,
    defaultRestSeconds: input.defaultRestSeconds ?? defaultRestSeconds,
    notes: input.notes,
  });
}

function metricServingForFood(item: FoodItem): { amount: number; unit: "g" | "ml" } | null {
  const servingGrams = saneMetricServingAmount(item.servingGrams, "g");
  const servingMl = saneMetricServingAmount(item.servingMl, "ml");
  if (servingGrams) return { amount: servingGrams, unit: "g" };
  if (servingMl) return { amount: servingMl, unit: "ml" };
  return parseMetricServing(item.servingAmount || 1, item.servingUnit || "");
}

function resolveFoodLogServing(item: FoodItem, quantity: number, unit: string): { servings: number; inputQuantity: number; inputUnit: string; amount?: number; amountUnit?: "g" | "ml" } {
  const inputQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const inputUnit = normalizeServingUnit(unit || "serving");
  const metricServing = metricServingForFood(item);
  const directMetric = metricAmountFromUnit(inputQuantity, inputUnit);
  if (directMetric) {
    const servings = metricServing && directMetric.unit === metricServing.unit ? directMetric.amount / metricServing.amount : inputQuantity;
    return { servings: round(servings), inputQuantity, inputUnit, amount: round(directMetric.amount), amountUnit: directMetric.unit };
  }

  const foodServingAmount = item.servingAmount || 1;
  const foodServingUnit = normalizeServingUnit(item.servingUnit || "serving");
  const isSameServingUnit = inputUnit === foodServingUnit || inputUnit === singularUnitName(foodServingUnit) || singularUnitName(inputUnit) === singularUnitName(foodServingUnit);
  const servings = isSameServingUnit && foodServingAmount > 0 ? inputQuantity / foodServingAmount : inputQuantity;
  return {
    servings: round(servings),
    inputQuantity,
    inputUnit,
    amount: metricServing ? round(servings * metricServing.amount) : undefined,
    amountUnit: metricServing?.unit,
  };
}

function foodLogUnitOptions(item: FoodItem): string[] {
  const units = new Set<string>();
  const preferred = preferredFoodLogUnit(item);
  const servingUnit = normalizeServingUnit(item.servingUnit || "serving");
  const metricServing = metricServingForFood(item);
  units.add(preferred);
  units.add("serving");
  if (servingUnit && servingUnit !== "serving" && !metricAmountFromUnit(item.servingAmount || 1, servingUnit)) {
    units.add(singularUnitName(servingUnit));
  }
  if (metricServing?.unit === "ml" || isLikelyLiquidFood(item)) {
    for (const unit of ["cup", "ml", "fl oz"]) units.add(unit);
  } else if (metricServing?.unit === "g") {
    for (const unit of ["g", "oz"]) units.add(unit);
  }
  return Array.from(units).filter(Boolean);
}

function foodLogUnitOptionLabel(item: FoodItem, unit: string): string {
  const normalized = normalizeServingUnit(unit || "serving");
  if (normalized !== "serving") return unit;
  const label = foodServingLabel(item);
  return label && label !== "serving" ? `serving (${label})` : "serving";
}

function foodServingLabel(item: FoodItem): string {
  const servingUnit = normalizeServingUnit(item.servingUnit || "serving");
  const servingAmount = item.servingAmount || 1;
  const metric = metricServingForFood(item);
  const serving = servingUnit && servingUnit !== "serving" && !metricAmountFromUnit(servingAmount, servingUnit)
    ? `${round(servingAmount)} ${singularUnitName(servingUnit)}`
    : "";
  const metricLabel = metric ? `${round(metric.amount)} ${metric.unit}` : "";
  return [serving, metricLabel].filter(Boolean).join(" / ");
}

function preferredFoodLogUnit(item: FoodItem): string {
  const servingUnit = normalizeServingUnit(item.servingUnit || "serving");
  if (servingUnit && servingUnit !== "serving" && !metricAmountFromUnit(item.servingAmount || 1, servingUnit)) return singularUnitName(servingUnit);
  return "serving";
}

function metricAmountFromUnit(quantity: number, unit: string): { amount: number; unit: "g" | "ml" } | null {
  const normalized = normalizeServingUnit(unit);
  if (["g", "gram", "grams"].includes(normalized)) return { amount: quantity, unit: "g" };
  if (["ml", "milliliter", "milliliters"].includes(normalized)) return { amount: quantity, unit: "ml" };
  if (["oz", "ounce", "ounces"].includes(normalized)) return { amount: round(quantity * 28.3495), unit: "g" };
  if (normalized === "fl oz" || normalized === "fluid ounce") return { amount: round(quantity * 29.5735), unit: "ml" };
  if (normalized === "cup" || normalized === "cups") return { amount: round(quantity * 240), unit: "ml" };
  return null;
}

function isLikelyLiquidFood(item: FoodItem): boolean {
  const text = normalizeLookup([item.name, item.brand, item.servingUnit, item.ingredients].filter(Boolean).join(" "));
  return /\b(drink|beverage|juice|milk|smoothie|shake|soda|water|tea|coffee|latte|liquid|beer|lager|ale|ipa|cider|seltzer|michelob|budweiser|bud light|coors|miller|corona|heineken)\b/.test(text);
}

function inferredDrinkServingForFood(item: FoodItem): { unit: string; ml: number } | null {
  const text = normalizeLookup([item.name, item.brand, item.servingUnit, item.ingredients].filter(Boolean).join(" "));
  if (!text) return null;
  if (/\b(beer|lager|ale|ipa|cider|seltzer|hard seltzer|michelob|budweiser|bud light|coors|miller|corona|heineken)\b/.test(text)) {
    return { unit: "can", ml: 355 };
  }
  if (isLikelyLiquidFood(item)) return { unit: "serving", ml: 240 };
  return null;
}

function shouldTreatNutritionAsPer100ml(item: FoodItem, servingMl: number): boolean {
  const calories = item.nutrition?.calories;
  return Boolean(servingMl > 100 && calories != null && Number.isFinite(calories) && calories > 0 && calories <= 120);
}

function parseMetricServing(servingAmount: number, servingUnit: string): { amount: number; unit: "g" | "ml" } | null {
  const unit = servingUnit.toLowerCase().trim();
  const embedded = unit.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|ml|milliliter|milliliters|oz|ounce|ounces|fl oz|fluid ounce|cup|cups)/);
  const amount = embedded ? Number(embedded[1]) : servingAmount;
  const rawUnit = embedded ? embedded[2] : unit;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (["g", "gram", "grams"].includes(rawUnit)) return saneMetricServing(amount, "g");
  if (["ml", "milliliter", "milliliters"].includes(rawUnit)) return saneMetricServing(amount, "ml");
  if (["oz", "ounce", "ounces"].includes(rawUnit)) return saneMetricServing(round(amount * 28.3495), "g");
  if (rawUnit === "fl oz" || rawUnit === "fluid ounce") return saneMetricServing(round(amount * 29.5735), "ml");
  if (rawUnit === "cup" || rawUnit === "cups") return saneMetricServing(round(amount * 240), "ml");
  return null;
}

const MAX_REASONABLE_SERVING_GRAMS = 5000;
const MAX_REASONABLE_SERVING_ML = 3000;

function saneMetricServing(amount: number, unit: "g" | "ml"): { amount: number; unit: "g" | "ml" } | null {
  const safeAmount = saneMetricServingAmount(amount, unit);
  return safeAmount == null ? null : { amount: safeAmount, unit };
}

function saneMetricServingAmount(value: unknown, unit: "g" | "ml"): number | undefined {
  const amount = numberOrUndefined(value);
  if (amount == null || amount <= 0) return undefined;
  const max = unit === "g" ? MAX_REASONABLE_SERVING_GRAMS : MAX_REASONABLE_SERVING_ML;
  return amount <= max ? amount : undefined;
}

function hasMetricServingText(servingUnit: string): boolean {
  return /(\d+(?:\.\d+)?)\s*(g|gram|grams|ml|milliliter|milliliters|oz|ounce|ounces|fl oz|fluid ounce|cup|cups)\b/i.test(servingUnit);
}

function parseLeadingServingPortion(servingUnit: string): { amount: number; unit: string } | null {
  const match = String(servingUnit || "").trim().match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+)\s+(.+)$/);
  if (!match) return null;
  const amount = parseFractionNumber(match[1]);
  const unit = match[2].trim();
  if (/^(g|gram|grams|ml|milliliter|milliliters|oz|ounce|ounces|fl\s+oz|fluid\s+ounce)\b/i.test(unit)) return null;
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;
  return { amount, unit };
}

function parseFractionNumber(value: string): number {
  const trimmed = String(value || "").trim();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    return denominator ? whole + numerator / denominator : NaN;
  }
  const fraction = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator ? numerator / denominator : NaN;
  }
  return Number(trimmed);
}

function normalizeServingUnit(unit: string): string {
  return unit.toLowerCase().trim();
}

function singularUnitName(unit: string): string {
  const normalized = normalizeServingUnit(unit);
  if (normalized === "slices") return "slice";
  if (normalized === "pieces") return "piece";
  if (normalized === "servings") return "serving";
  if (normalized === "bars") return "bar";
  if (normalized === "cups") return "cup";
  if (normalized === "grams") return "g";
  if (normalized === "ounces") return "oz";
  if (normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith("s") && normalized.length > 3) return normalized.slice(0, -1);
  return normalized;
}

function isRelevantFoodResult(query: string, fields: Array<unknown>): boolean {
  const tokens = foodSearchTokens(query);
  if (!tokens.length) return true;
  const haystack = normalizeLookup(fields.filter(Boolean).join(" "));
  const haystackTokens = new Set(haystack.split(" ").filter(Boolean).map(singularFoodSearchToken));
  return tokens.every((token) => haystack.includes(token) || haystackTokens.has(token));
}

function foodSearchTokens(query: string): string[] {
  return Array.from(new Set(normalizeLookup(query).split(" ")
    .map(singularFoodSearchToken)
    .filter((token) => token.length > 1)));
}

function singularFoodSearchToken(token: string): string {
  if (token === "doritos") return "dorito";
  return singularUnit(token);
}

function foodSearchQueryVariants(query: string): string[] {
  const normalized = normalizeLookup(query);
  const variants = new Set<string>([query.trim()]);
  if (/\bprotein\b/.test(normalized) && /\b(doritos?|nacho|chips?)\b/.test(normalized)) {
    variants.add("quest protein chips nacho cheese");
    variants.add("quest tortilla style protein chips nacho");
    variants.add("protein chips nacho");
  }
  if (/\bprotein\b/.test(normalized) && /\bchips?\b/.test(normalized)) {
    variants.add("quest protein chips");
    variants.add("wilde protein chips");
  }
  return Array.from(variants).filter(Boolean);
}

function searchCuratedFoods(query: string): FoodItem[] {
  const normalized = normalizeLookup(query);
  if (!normalized) return [];
  return CURATED_COMMON_FOODS
    .filter((item) => isRelevantFoodResult(query, [item.name, item.brand, item.aliases?.join(" ")]))
    .map((item) => ({
      id: `curated-${normalizeLookup(item.name).replace(/\s+/g, "-")}`,
      name: item.name,
      brand: item.brand,
      aliases: item.aliases,
      servingAmount: item.servingAmount ?? 1,
      servingUnit: item.servingUnit || "100 g",
      servingGrams: item.servingGrams,
      servingMl: item.servingMl,
      source: "curated",
      nutrition: item.nutrition,
    }));
}

const CURATED_COMMON_FOODS: Array<{ name: string; brand?: string; aliases?: string[]; servingAmount?: number; servingUnit?: string; servingGrams?: number; servingMl?: number; nutrition: Nutrition }> = [
  { name: "Apple, raw, with skin", aliases: ["apples"], nutrition: { calories: 52, proteinG: 0.3, carbsG: 13.8, fatG: 0.2, fiberG: 2.4, sugarG: 10.4, sodiumMg: 1 } },
  { name: "Banana, raw", aliases: ["bananas"], nutrition: { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6, sugarG: 12.2, sodiumMg: 1 } },
  { name: "Egg, whole, cooked", aliases: ["eggs"], servingUnit: "egg", servingGrams: 50, nutrition: { calories: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3, sodiumMg: 62 } },
  { name: "Chicken breast, cooked, skinless", aliases: ["chicken"], nutrition: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, sodiumMg: 74 } },
  { name: "White rice, cooked", aliases: ["rice"], nutrition: { calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3, fiberG: 0.4, sodiumMg: 1 } },
  { name: "Oats, dry", aliases: ["oatmeal"], nutrition: { calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9, fiberG: 10.6, sugarG: 0.9, sodiumMg: 2 } },
  { name: "Greek yogurt, plain, nonfat", aliases: ["yogurt"], nutrition: { calories: 59, proteinG: 10.3, carbsG: 3.6, fatG: 0.4, sugarG: 3.2, sodiumMg: 36 } },
  { name: "Milk, whole", aliases: ["whole milk"], nutrition: { calories: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, sugarG: 5.1, sodiumMg: 43 } },
  { name: "Sliced deli ham lunchmeat", aliases: ["ham lunchmeat", "ham lunch meat", "deli ham", "sliced ham", "lunchmeat", "lunch meat"], servingUnit: "2 oz", servingGrams: 56, nutrition: { calories: 60, proteinG: 10, carbsG: 2, fatG: 1.5, sugarG: 1, sodiumMg: 560 } },
  { name: "Great Value Black Forest Ham Lunchmeat", brand: "Great Value", aliases: ["walmart ham", "ham lunchmeat", "black forest ham", "deli ham", "lunchmeat"], servingUnit: "2 oz", servingGrams: 56, nutrition: { calories: 60, proteinG: 10, carbsG: 2, fatG: 1.5, sugarG: 1, sodiumMg: 520 } },
  { name: "Sara Lee Delightful White Bread", brand: "Sara Lee", aliases: ["sara lee bread", "sara lee white bread", "delightful bread", "low calorie bread"], servingUnit: "2 slices", servingGrams: 45, nutrition: { calories: 90, proteinG: 5, carbsG: 18, fatG: 1, fiberG: 5, sugarG: 2, sodiumMg: 190 } },
  { name: "Sara Lee Artesano White Bread", brand: "Sara Lee", aliases: ["sara lee bread", "artesano bread", "sara lee artesano", "white bread"], servingUnit: "1 slice", servingGrams: 38, nutrition: { calories: 110, proteinG: 3, carbsG: 21, fatG: 1.5, fiberG: 1, sugarG: 2, sodiumMg: 190 } },
  { name: "Light + Fit Greek Vanilla Yogurt Cup", brand: "Dannon", aliases: ["light and fit", "light fit", "lightfit", "vanilla yogurt", "yogurt cup"], servingUnit: "5.3 oz cup", servingGrams: 150, nutrition: { calories: 80, proteinG: 12, carbsG: 9, fatG: 0, sugarG: 7, sodiumMg: 45 } },
  { name: "Light + Fit Greek Strawberry Yogurt Cup", brand: "Dannon", aliases: ["light and fit strawberry", "light fit strawberry", "strawberry yogurt"], servingUnit: "5.3 oz cup", servingGrams: 150, nutrition: { calories: 80, proteinG: 12, carbsG: 9, fatG: 0, sugarG: 7, sodiumMg: 45 } },
  { name: "Great Value Light Greek Vanilla Yogurt Cup", brand: "Great Value", aliases: ["walmart yogurt", "great value greek yogurt", "gv yogurt"], servingUnit: "5.3 oz cup", servingGrams: 150, nutrition: { calories: 80, proteinG: 12, carbsG: 9, fatG: 0, sugarG: 6, sodiumMg: 45 } },
  { name: "Halo Top Vanilla Bean Ice Cream", brand: "Halo Top", aliases: ["halotop", "halo top", "vanilla ice cream"], servingUnit: "2/3 cup", servingGrams: 85, nutrition: { calories: 100, proteinG: 6, carbsG: 20, fatG: 2, fiberG: 3, sugarG: 8, sodiumMg: 110 } },
  { name: "Fairlife 2% Ultra-Filtered Milk", brand: "Fairlife", aliases: ["fairlife milk", "fair life", "ultra filtered milk"], servingUnit: "1 cup", servingMl: 240, nutrition: { calories: 120, proteinG: 13, carbsG: 6, fatG: 4.5, sugarG: 6, sodiumMg: 120 } },
  { name: "Fairlife Fat Free Ultra-Filtered Milk", brand: "Fairlife", aliases: ["fairlife fat free", "fairlife skim", "fairlife milk"], servingUnit: "1 cup", servingMl: 240, nutrition: { calories: 80, proteinG: 13, carbsG: 6, fatG: 0, sugarG: 6, sodiumMg: 120 } },
  { name: "Quest Tortilla Style Protein Chips, Nacho Cheese", brand: "Quest", aliases: ["quest protein chips", "quest chips", "protein chips", "protein doritos", "doritos protein chips", "nacho protein chips"], servingUnit: "bag", servingGrams: 32, nutrition: { calories: 140, proteinG: 18, carbsG: 5, fatG: 5, fiberG: 1, sodiumMg: 340 } },
  { name: "Quest Tortilla Style Protein Chips, Loaded Taco", brand: "Quest", aliases: ["quest protein chips taco", "quest chips taco", "protein chips taco", "protein doritos", "doritos protein chips"], servingUnit: "bag", servingGrams: 32, nutrition: { calories: 140, proteinG: 19, carbsG: 5, fatG: 4.5, fiberG: 1, sodiumMg: 340 } },
  { name: "Quest Tortilla Style Protein Chips, Chili Lime", brand: "Quest", aliases: ["quest protein chips chili lime", "quest chips chili lime", "protein chips chili lime", "protein doritos", "doritos protein chips"], servingUnit: "bag", servingGrams: 32, nutrition: { calories: 140, proteinG: 19, carbsG: 5, fatG: 4.5, fiberG: 1, sodiumMg: 330 } },
  { name: "Wilde Protein Chips, Buffalo Style", brand: "Wilde", aliases: ["wilde protein chips", "protein chips", "chicken chips"], servingUnit: "bag", servingGrams: 34, nutrition: { calories: 170, proteinG: 10, carbsG: 8, fatG: 10, sodiumMg: 280 } },
  { name: "Barebells Cookies & Cream Protein Bar", brand: "Barebells", aliases: ["barebells", "barebell", "protein bar", "cookies cream"], servingUnit: "bar", servingGrams: 55, nutrition: { calories: 200, proteinG: 20, carbsG: 20, fatG: 7, fiberG: 3, sugarG: 1, sodiumMg: 190 } },
  { name: "Barebells Salty Peanut Protein Bar", brand: "Barebells", aliases: ["barebells peanut", "barebell peanut", "salty peanut", "protein bar"], servingUnit: "bar", servingGrams: 55, nutrition: { calories: 200, proteinG: 20, carbsG: 17, fatG: 7, fiberG: 3, sugarG: 1, sodiumMg: 210 } },
  { name: "Legendary Foods Protein Pastry, Brown Sugar Cinnamon", brand: "Legendary Foods", aliases: ["legendary", "legendary pop tart", "protein poptart", "protein pastry", "brown sugar"], servingUnit: "pastry", servingGrams: 61, nutrition: { calories: 180, proteinG: 20, carbsG: 22, fatG: 9, fiberG: 6, sugarG: 1, sodiumMg: 360 } },
  { name: "Legendary Foods Protein Pastry, S'mores", brand: "Legendary Foods", aliases: ["legendary smores", "legendary s'mores", "protein poptart", "protein pastry"], servingUnit: "pastry", servingGrams: 61, nutrition: { calories: 180, proteinG: 20, carbsG: 22, fatG: 8, fiberG: 6, sugarG: 1, sodiumMg: 360 } },
  { name: "Instant ramen, prepared", aliases: ["ramen", "ramen noodles"], servingUnit: "package", servingGrams: 85, nutrition: { calories: 380, proteinG: 10, carbsG: 52, fatG: 14, fiberG: 2, sugarG: 2, sodiumMg: 1600 } },
];

interface FoodUsageStats {
  count: number;
  lastLoggedAt: string;
}

function rankFoodSearchResults(query: string, items: FoodItem[], usageStats = new Map<string, FoodUsageStats>()): FoodItem[] {
  const normalizedQuery = normalizeLookup(query);
  return items
    .filter((item) => item.name && item.nutrition && hasSearchableMacroData(item.nutrition))
    .filter((item) => isRelevantFoodResult(query, foodSearchFields(item)))
    .sort((a, b) => foodSearchScore(b, normalizedQuery, usageStats) - foodSearchScore(a, normalizedQuery, usageStats));
}

function foodSearchScore(item: FoodItem, normalizedQuery: string, usageStats = new Map<string, FoodUsageStats>()): number {
  let score = 0;
  const normalizedName = normalizeLookup(item.name);
  const normalizedBrand = normalizeLookup(item.brand || "");
  const normalizedAliases = normalizeLookup(foodAliasesForItem(item).join(" "));
  const haystack = [normalizedName, normalizedBrand, normalizedAliases].filter(Boolean).join(" ");
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
  const usage = foodUsageForItem(item, usageStats);
  if (normalizedName === normalizedQuery) score += 80;
  if (normalizedName.includes(normalizedQuery)) score += 40;
  if (normalizedBrand && normalizedQuery.includes(normalizedBrand)) score += 30;
  score += matchedTokens * 12;
  if (tokens.length && matchedTokens === tokens.length) score += 20;
  if (item.brand) score += 4;
  if (item.barcode) score += 2;
  if (item.source === "custom-note") score += 20;
  if (usage.count) score += 60 + Math.min(usage.count, 10) * 8 + (usage.lastLoggedAt ? 10 : 0);
  if (item.source === "open-food-facts") score += 3;
  if (item.source === "usda" && item.brand) score -= 12;
  if (!metricServingForFood(item) && item.source === "open-food-facts") score -= 8;
  const nutrition = item.nutrition || {};
  for (const value of [nutrition.calories, nutrition.proteinG, nutrition.carbsG, nutrition.fatG]) {
    if (Number.isFinite(value)) score += 1;
  }
  return score;
}

function foodUsageForItem(item: FoodItem, usageStats: Map<string, FoodUsageStats>): FoodUsageStats {
  let out: FoodUsageStats = { count: 0, lastLoggedAt: "" };
  for (const key of foodUsageKeys(item)) {
    const usage = usageStats.get(key);
    if (!usage) continue;
    out = {
      count: out.count + usage.count,
      lastLoggedAt: usage.lastLoggedAt > out.lastLoggedAt ? usage.lastLoggedAt : out.lastLoggedAt,
    };
  }
  return out;
}

function foodUsageKeys(item: FoodItem): string[] {
  return [
    item.barcode ? `barcode:${normalizeLookup(item.barcode)}` : "",
    item.sourcePath ? `path:${normalizePath(item.sourcePath)}` : "",
    `name:${normalizeLookup(item.name)}|${normalizeLookup(item.brand || "")}`,
    `name:${normalizeLookup(item.name)}`,
  ].filter(Boolean);
}

function hasSearchableMacroData(nutrition: Nutrition): boolean {
  return [nutrition.calories, nutrition.proteinG, nutrition.carbsG, nutrition.fatG]
    .some((value) => Number.isFinite(value) && Number(value) > 0);
}

function sodiumGramsToMg(value: unknown, multiplier = 1): number | undefined {
  const sodiumG = numberOrUndefined(value);
  return sodiumG == null ? undefined : Math.round(sodiumG * multiplier * 1000 * 10) / 10;
}

function foodFactsServing(product: any): { unit: string; grams?: number; ml?: number } {
  const servingSize = String(product?.serving_size || "").trim();
  const servingQuantity = saneMetricServingAmount(product?.serving_quantity, "g");
  const metric = parseMetricServing(1, servingSize);
  const grams = metric?.unit === "g" ? metric.amount : servingQuantity;
  const inferredDrinkServing = !metric && servingQuantity == null ? inferredFoodFactsDrinkServing(product) : null;
  const ml = metric?.unit === "ml" ? metric.amount : inferredDrinkServing?.ml;
  const unit = servingUnitFromFoodFactsServingSize(servingSize) || inferredDrinkServing?.unit || "serving";
  return { unit, grams, ml };
}

function servingUnitFromFoodFactsServingSize(servingSize: string): string {
  if (!servingSize) return "";
  const lower = servingSize.toLowerCase();
  const unitMatch = lower.match(/\b(bar|bars|bottle|bottles|can|cans|cup|cups|packet|packets|piece|pieces|slice|slices|scoop|scoops|container|containers)\b/);
  if (unitMatch) return normalizeServingUnit(unitMatch[1]);
  if (parseMetricServing(1, servingSize) || hasMetricServingText(servingSize)) return "serving";
  return servingSize;
}

function inferredFoodFactsDrinkServing(product: any): { unit: string; ml: number } | null {
  const text = normalizeLookup([
    product?.product_name,
    product?.product_name_en,
    product?.brands,
    product?.categories,
    Array.isArray(product?.categories_tags) ? product.categories_tags.join(" ") : "",
  ].filter(Boolean).join(" "));
  if (!text) return null;
  if (/\b(beer|lager|ale|ipa|cider|seltzer|hard seltzer|michelob|budweiser|bud light|coors|miller|corona|heineken)\b/.test(text)) {
    return { unit: "can", ml: 355 };
  }
  if (/\b(drink|beverage|juice|milk|smoothie|shake|soda|water|tea|coffee|latte|liquid)\b/.test(text)) {
    return { unit: "serving", ml: 240 };
  }
  return null;
}

function foodFactsNutrition(product: any, serving: { grams?: number; ml?: number }): Nutrition {
  const n = product?.nutriments || {};
  const multiplier = serving.grams ? serving.grams / 100 : serving.ml ? serving.ml / 100 : 1;
  return {
    calories: servingValue(n, "energy-kcal", multiplier),
    proteinG: servingValue(n, "proteins", multiplier),
    carbsG: servingValue(n, "carbohydrates", multiplier),
    fatG: servingValue(n, "fat", multiplier),
    fiberG: servingValue(n, "fiber", multiplier),
    sugarG: servingValue(n, "sugars", multiplier),
    alcoholG: servingValue(n, "alcohol", multiplier),
    sodiumMg: n.sodium_serving != null
      ? sodiumGramsToMg(n.sodium_serving)
      : sodiumGramsToMg(n.sodium_100g, multiplier),
  };
}

function servingValue(nutrients: any, key: string, multiplier: number): number | undefined {
  const serving = numberOrUndefined(nutrients?.[`${key}_serving`]);
  if (serving != null) return serving;
  const per100 = numberOrUndefined(nutrients?.[`${key}_100g`]);
  return per100 == null ? undefined : round(per100 * multiplier);
}

const FOOD_ROLLUP_PROPERTY_KEYS = ["cal", "protein", "carbs", "fat", "fiber", "sugar", "alcohol", "sodium"];

function foodRollupValue(totals: Required<Nutrition>, propertyKey: string): number | null {
  switch (propertyKey) {
    case "cal": return totals.calories;
    case "protein": return totals.proteinG;
    case "carbs": return totals.carbsG;
    case "fat": return totals.fatG;
    case "fiber": return totals.fiberG;
    case "sugar": return totals.sugarG;
    case "alcohol": return totals.alcoholG;
    case "sodium": return totals.sodiumMg;
    default: return null;
  }
}

function dedupeFoods(items: FoodItem[]): FoodItem[] {
  const byKey = new Map<string, FoodItem>();
  for (const item of items) {
    const matchingNutritionKey = Array.from(byKey.entries())
      .find(([, existing]) => sameNamedEquivalentMetricFood(existing, item))?.[0];
    const key = matchingNutritionKey || foodDedupeKey(item);
    const existing = byKey.get(key);
    if (!existing || foodCandidateCompletenessScore(item) > foodCandidateCompletenessScore(existing)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

function foodDedupeKey(item: FoodItem): string {
  if (item.barcode) return `barcode:${normalizeLookup(item.barcode)}`;
  const name = normalizeLookup(item.name);
  const brand = normalizeLookup(item.brand || "");
  return brand ? `name-brand:${name}|${brand}` : `name:${name}`;
}

function sameNamedEquivalentMetricFood(a: FoodItem, b: FoodItem): boolean {
  if (normalizeLookup(a.name) !== normalizeLookup(b.name)) return false;
  const left = perMetricNutrition(a);
  const right = perMetricNutrition(b);
  if (!left || !right || left.unit !== right.unit) return false;
  const keys: Array<keyof Nutrition> = ["calories", "proteinG", "carbsG", "fatG"];
  const comparable = keys.filter((key) => left.nutrition[key] != null && right.nutrition[key] != null);
  return comparable.length >= 3 && comparable.every((key) => valuesClose(left.nutrition[key], right.nutrition[key], key === "calories" ? 2 : 0.5));
}

function perMetricNutrition(item: FoodItem): { unit: "100g" | "100ml"; nutrition: Nutrition } | null {
  const metric = metricServingForFood(item);
  if (!metric || !item.nutrition || metric.amount <= 0) return null;
  const multiplier = 100 / metric.amount;
  return {
    unit: metric.unit === "g" ? "100g" : "100ml",
    nutrition: {
      calories: scaleOptionalNutritionValue(item.nutrition.calories, multiplier),
      proteinG: scaleOptionalNutritionValue(item.nutrition.proteinG, multiplier),
      carbsG: scaleOptionalNutritionValue(item.nutrition.carbsG, multiplier),
      fatG: scaleOptionalNutritionValue(item.nutrition.fatG, multiplier),
      fiberG: scaleOptionalNutritionValue(item.nutrition.fiberG, multiplier),
      sugarG: scaleOptionalNutritionValue(item.nutrition.sugarG, multiplier),
      alcoholG: scaleOptionalNutritionValue(item.nutrition.alcoholG, multiplier),
      sodiumMg: scaleOptionalNutritionValue(item.nutrition.sodiumMg, multiplier),
    },
  };
}

function scaleOptionalNutritionValue(value: number | undefined, multiplier: number): number | undefined {
  return value == null || !Number.isFinite(value) ? undefined : round(value * multiplier);
}

function valuesClose(left: number | undefined, right: number | undefined, tolerance: number): boolean {
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= tolerance;
}

function foodCandidateCompletenessScore(item: FoodItem): number {
  let score = 0;
  if (item.source === "custom-note") score += 100;
  else if (item.source === "curated") score += 70;
  else if (item.source === "open-food-facts") score += 60;
  else if (item.source === "usda") score += 50;
  else score += 20;
  if (item.sourcePath) score += 30;
  if (item.barcode) score += 10;
  if (item.brand) score += 6;
  if (metricServingForFood(item)) score += 12;
  if (item.imageUrl) score += 2;
  if (item.ingredients) score += 2;
  const nutrition = item.nutrition || {};
  for (const value of [nutrition.calories, nutrition.proteinG, nutrition.carbsG, nutrition.fatG, nutrition.fiberG, nutrition.sugarG, nutrition.sodiumMg]) {
    if (Number.isFinite(value)) score += 1;
  }
  return score;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function createBarcodeReader(): any {
  return new BrowserMultiFormatReader(createBarcodeHints()) as any;
}

function createLiveBarcodeReader(): any {
  return new BrowserMultiFormatOneDReader(createBarcodeHints(), {
    delayBetweenScanAttempts: 90,
    delayBetweenScanSuccess: 90,
  }) as any;
}

function createBarcodeHints(): Map<any, any> {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

function appleShortcutBarcodeUrl(): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_BARCODE_NAME)}`;
}

function shortcutBarcodeFromContent(content: string): string | null {
  const match = content.match(/(?:^|\D)(\d{7,14})(?:\D|$)/);
  return match?.[1] || null;
}

function nativeBarcodeBridgeValue(result: unknown): string | null {
  if (typeof result === "string") return result.trim() || null;
  if (Array.isArray(result)) {
    for (const item of result) {
      const value = nativeBarcodeBridgeValue(item);
      if (value) return value;
    }
    return null;
  }
  if (!result || typeof result !== "object") return null;
  const object = result as Record<string, unknown>;
  for (const key of ["rawValue", "displayValue", "text", "code", "content", "result", "ScanResult", "value"]) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const key of ["barcodes", "codes", "results"]) {
    const value = nativeBarcodeBridgeValue(object[key]);
    if (value) return value;
  }
  return null;
}

function barcodeScanCanvases(source: HTMLCanvasElement, heavy: boolean): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const regions = barcodeScanRegions(source.width, source.height, heavy);
  for (const region of regions) {
    out.push(cropCanvas(source, region, region.scale, region.options));
    if (region.rotate) out.push(cropCanvas(source, region, region.scale, region.options, true));
  }
  out.splice(Math.min(2, out.length), 0, source);
  return out.filter((canvas) => canvas.width > 0 && canvas.height > 0);
}

function barcodeImageCanvases(img: HTMLImageElement): HTMLCanvasElement[] {
  const base = imageToCanvas(img, 1, {});
  const out = [
    ...barcodeScanCanvases(base, true),
    imageToCanvas(img, 2, {}),
    imageToCanvas(img, 2, { contrast: 2 }),
    imageToCanvas(img, 2, { threshold: 128 }),
    imageToCanvas(img, 0.5, {}),
  ];
  return out.filter((canvas) => canvas.width > 0 && canvas.height > 0);
}

function barcodeScanRegions(width: number, height: number, heavy: boolean): BarcodeCanvasRegion[] {
  const regions: BarcodeCanvasRegion[] = [
    { x: 0.25, y: 0.48, width: 0.5, height: 0.42, scale: 2.5, rotate: true },
    { x: 0.18, y: 0.25, width: 0.64, height: 0.5, scale: 2, rotate: true },
  ];
  if (heavy) {
    regions.push(
      { x: 0.2, y: 0.45, width: 0.6, height: 0.5, scale: 3, rotate: true, options: { contrast: 2 } },
      { x: 0.2, y: 0.45, width: 0.6, height: 0.5, scale: 3, rotate: true, options: { threshold: 128 } },
      { x: 0.05, y: 0.28, width: 0.45, height: 0.55, scale: 2.25, rotate: true },
      { x: 0.5, y: 0.28, width: 0.45, height: 0.55, scale: 2.25, rotate: true },
    );
  }
  return regions.filter((region) => region.width * width >= 80 && region.height * height >= 80);
}

interface BarcodeCanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotate?: boolean;
  options?: { contrast?: number; brightness?: number; threshold?: number };
}

function cropCanvas(
  source: HTMLCanvasElement,
  region: BarcodeCanvasRegion,
  scale: number,
  options: { contrast?: number; brightness?: number; threshold?: number } = {},
  rotate = false,
): HTMLCanvasElement {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const sx = Math.max(0, Math.floor(sourceWidth * region.x));
  const sy = Math.max(0, Math.floor(sourceHeight * region.y));
  const sw = Math.max(1, Math.min(sourceWidth - sx, Math.floor(sourceWidth * region.width)));
  const sh = Math.max(1, Math.min(sourceHeight - sy, Math.floor(sourceHeight * region.height)));
  const targetWidth = Math.max(1, Math.floor((rotate ? sh : sw) * scale));
  const targetHeight = Math.max(1, Math.floor((rotate ? sw : sh) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = scale !== 1;
  if (rotate) {
    ctx.translate(targetWidth / 2, targetHeight / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, sx, sy, sw, sh, -targetHeight / 2, -targetWidth / 2, targetHeight, targetWidth);
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
  }
  if (options.contrast || options.brightness || options.threshold != null) {
    applyImageProcessing(ctx, targetWidth, targetHeight, options);
  }
  return canvas;
}

function imageToCanvas(
  img: HTMLImageElement,
  scale: number,
  options: { contrast?: number; brightness?: number; threshold?: number }
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const width = Math.max(1, Math.floor((img.naturalWidth || img.width) * scale));
  const height = Math.max(1, Math.floor((img.naturalHeight || img.height) * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = scale !== 1;
  ctx.drawImage(img, 0, 0, width, height);
  if (options.contrast || options.brightness || options.threshold != null) {
    applyImageProcessing(ctx, width, height, options);
  }
  return canvas;
}

function applyImageProcessing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: { contrast?: number; brightness?: number; threshold?: number }
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (options.brightness) {
      r = Math.min(255, r * options.brightness);
      g = Math.min(255, g * options.brightness);
      b = Math.min(255, b * options.brightness);
    }
    if (options.contrast) {
      r = Math.min(255, Math.max(0, (r - 128) * options.contrast + 128));
      g = Math.min(255, Math.max(0, (g - 128) * options.contrast + 128));
      b = Math.min(255, Math.max(0, (b - 128) * options.contrast + 128));
    }
    if (options.threshold != null) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const value = gray > options.threshold ? 255 : 0;
      r = value;
      g = value;
      b = value;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(imageData, 0, 0);
}

function barcodeCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const candidates = new Set<string>();
  if (digits) candidates.add(digits);
  if (digits.length === 7) candidates.add(`0${digits}`);
  if (digits.length === 8) {
    const expanded = expandUpce(digits);
    if (expanded) candidates.add(expanded);
  }
  if (digits.length === 12 && digits.startsWith("0")) candidates.add(digits.slice(1));
  return [...candidates];
}

function expandUpce(upce: string): string | null {
  const digits = upce.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const numberSystem = digits[0];
  const body = digits.slice(1, 7);
  const check = digits[7];
  const last = body[5];
  let upcaBody = "";
  if (last === "0" || last === "1" || last === "2") {
    upcaBody = `${numberSystem}${body.slice(0, 2)}${last}0000${body.slice(2, 5)}`;
  } else if (last === "3") {
    upcaBody = `${numberSystem}${body.slice(0, 3)}00000${body.slice(3, 5)}`;
  } else if (last === "4") {
    upcaBody = `${numberSystem}${body.slice(0, 4)}00000${body[4]}`;
  } else {
    upcaBody = `${numberSystem}${body.slice(0, 5)}0000${last}`;
  }
  return `${upcaBody}${check}`;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function defaultFoodLogBaseContent(settings: TPSHealthSettings): string {
  const filters = foodLogBaseDefaultFilters(settings);
  return [
    "model:",
    "  version: 1",
    "  kind: Table",
    "  columns: []",
    "pluginVersion: 1.0.0",
    "filters:",
    "  or:",
    ...filters.map((filter) => `    - ${filter}`),
    "views:",
    `  - type: ${FOOD_LOG_BASE_VIEW_TYPE}`,
    "    name: Food Log",
    "",
  ].join("\n");
}

function legacyBroadFoodLogBaseContent(): string {
  return [
    "model:",
    "  version: 1",
    "  kind: Table",
    "  columns: []",
    "pluginVersion: 1.0.0",
    "filters:",
    "  and:",
    "    - file.name != \"\"",
    "views:",
    `  - type: ${FOOD_LOG_BASE_VIEW_TYPE}`,
    "    name: Food Log",
    "",
  ].join("\n");
}

function repairFoodLogBaseContent(content: string, settings: TPSHealthSettings): string | null {
  const normalized = content.trimEnd();
  if (normalized === legacyBroadFoodLogBaseContent().trimEnd()) return defaultFoodLogBaseContent(settings);
  if (content.includes(`type: ${FOOD_LOG_BASE_VIEW_TYPE}`)) return null;
  if (!normalized) return defaultFoodLogBaseContent(settings);
  const next = normalized;
  if (/^views:\s*$/m.test(next)) return `${next}\n  - type: ${FOOD_LOG_BASE_VIEW_TYPE}\n    name: Food Log\n`;
  return `${next}\nviews:\n  - type: ${FOOD_LOG_BASE_VIEW_TYPE}\n    name: Food Log\n`;
}

function foodLogBaseDefaultFilters(settings: TPSHealthSettings): string[] {
  const filters = new Set<string>();
  const foodLogPath = normalizePath(settings.foodLogFilePath || DEFAULT_SETTINGS.foodLogFilePath).replace(/^\/+/, "");
  if (foodLogPath) {
    filters.add(`file.path == ${baseString(foodLogPath)}`);
    if (/\.md$/i.test(foodLogPath)) filters.add(`file.path == ${baseString(foodLogPath.replace(/\.md$/i, ""))}`);
  }
  const dailyFolder = normalizePath(settings.dailyNoteFolder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (dailyFolder) filters.add(`file.folder == ${baseString(dailyFolder)}`);
  filters.add(`file.folder == ${baseString("Dailynotes")}`);
  return [...filters];
}

function baseString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function createFoodLogBaseEntry(plugin: TPSHealthPlugin, file: TFile, lineIndex: number, line: string): FoodLogBaseEntry {
  const chip = foodLogChipDataFromLine(line, plugin);
  const nutrition = resolveFoodLogNutrition(line, (foodPath) => {
    const foodFile = plugin.app.vault.getAbstractFileByPath(foodPath);
    return foodFile instanceof TFile ? foodFromFileCache(plugin, foodFile) : null;
  });
  const completedDate = readStringField(line, "completedDate") || "";
  const createdDate = readStringField(line, "createdDate") || "";
  const dailyNotePath = readStringField(line, "dailyNotePath");
  const date = foodLogBaseDate(completedDate, dailyNotePath || file.path, createdDate);
  const name = chip?.food || readStringField(line, "food") || foodNameFromFoodLogSummary(line) || "Food";
  const serving = chip?.serving || foodLogBaseServing(line);
  const source = foodLogBaseSource(line, file, dailyNotePath);
  return {
    file,
    lineNumber: lineIndex,
    line,
    id: `${file.path}:${lineIndex}`,
    name,
    serving,
    source,
    dateKey: date.key,
    dateLabel: date.label,
    nutrition,
  };
}

function foodLogBaseDate(completedDate: string, path: string, createdDate = ""): { key: string; label: string } {
  if (completedDate) {
    const parsed = window.moment(completedDate);
    if (parsed.isValid()) return { key: parsed.format("YYYY-MM-DD"), label: parsed.format("ddd, MMM D YYYY") };
  }
  const basename = path.replace(/\.md$/i, "").split("/").pop() || "Undated";
  const parsed = window.moment(basename, ["ddd, MMM DD YYYY", "YYYY-MM-DD", "YYYY/MM/DD"], true);
  if (parsed.isValid()) return { key: parsed.format("YYYY-MM-DD"), label: parsed.format("ddd, MMM D YYYY") };
  if (createdDate) {
    const created = window.moment(createdDate);
    if (created.isValid()) return { key: created.format("YYYY-MM-DD"), label: created.format("ddd, MMM D YYYY") };
  }
  return { key: `path:${path}`, label: basename };
}

function isFoodLogBaseDailyNoteFile(path: string, dailyFolder: string): boolean {
  if (!dailyFolder) return !path.includes("/");
  return path.startsWith(`${dailyFolder}/`);
}

function foodLogBaseServing(line: string): string {
  const quantity = readNumber(line, "qty") ?? readNumber(line, "servings");
  const unit = readStringField(line, "unit") || "serving";
  return quantity == null ? unit : `${round(quantity)} ${unit}`;
}

function foodLogBaseSource(line: string, file: TFile, dailyNotePath?: string): string {
  const target = dailyNotePath || file.path;
  const foodPath = readStringField(line, "foodPath");
  return [target.replace(/\.md$/i, ""), foodPath ? `food: ${foodPath.replace(/\.md$/i, "")}` : ""]
    .filter(Boolean)
    .join(" • ");
}

function groupFoodLogEntries(entries: FoodLogBaseEntry[]): Array<{ key: string; label: string; entries: FoodLogBaseEntry[] }> {
  const groups = new Map<string, { key: string; label: string; entries: FoodLogBaseEntry[] }>();
  for (const entry of entries) {
    const group = groups.get(entry.dateKey) || { key: entry.dateKey, label: entry.dateLabel, entries: [] };
    group.entries.push(entry);
    groups.set(entry.dateKey, group);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.key.localeCompare(a.key));
}

function sumFoodLogNutrition(entries: FoodLogBaseEntry[]): Required<Nutrition> {
  const totals = zeroNutrition();
  for (const entry of entries) {
    totals.calories += entry.nutrition.calories;
    totals.proteinG += entry.nutrition.proteinG;
    totals.carbsG += entry.nutrition.carbsG;
    totals.fatG += entry.nutrition.fatG;
    totals.fiberG += entry.nutrition.fiberG;
    totals.sugarG += entry.nutrition.sugarG;
    totals.alcoholG += entry.nutrition.alcoholG;
    totals.sodiumMg += entry.nutrition.sodiumMg;
  }
  return totals;
}

function calculateFoodTotals(content: string, resolveFood?: (foodPath: string) => FoodItem | null, dailyNotePath?: string): Required<Nutrition> {
  const totals: Required<Nutrition> = {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0,
    alcoholG: 0,
    sodiumMg: 0,
  };
  for (const line of content.split("\n")) {
    if (!isFoodLogLine(line)) continue;
    if (!isFoodLogForDailyNote(line, dailyNotePath)) continue;
    const resolved = resolveFoodLogNutrition(line, resolveFood);
    totals.calories += resolved.calories;
    totals.proteinG += resolved.proteinG;
    totals.carbsG += resolved.carbsG;
    totals.fatG += resolved.fatG;
    totals.fiberG += resolved.fiberG;
    totals.sugarG += resolved.sugarG;
    totals.alcoholG += resolved.alcoholG;
    totals.sodiumMg += resolved.sodiumMg;
  }
  return totals;
}

function isFoodLogForDailyNote(line: string, dailyNotePath?: string): boolean {
  if (!dailyNotePath) return true;
  const lineDailyNotePath = readStringField(line, "dailyNotePath");
  return !lineDailyNotePath || normalizePath(lineDailyNotePath) === normalizePath(dailyNotePath);
}

function resolveFoodLogNutrition(line: string, resolveFood?: (foodPath: string) => FoodItem | null): Required<Nutrition> {
  const foodPath = readStringField(line, "foodPath");
  const food = foodPath && resolveFood ? resolveFood(foodPath) : null;
  if (hasLineNutritionFields(line)) {
    const lineNutrition = readLineNutrition(line);
    if (food?.nutrition) {
      const baseNutrition = multiplyNutrition(food.nutrition, foodLogMultiplier(line, food));
      if (shouldTreatLineNutritionAsLegacyPerServing(lineNutrition, food.nutrition, foodLogMultiplier(line, food))) {
        return baseNutrition;
      }
      return mergeLineNutritionOverrides(baseNutrition, line);
    }
    return lineNutrition;
  }
  if (food?.nutrition) return multiplyNutrition(food.nutrition, foodLogMultiplier(line, food));
  return readLineNutrition(line);
}

function hasLineNutritionFields(line: string): boolean {
  return ["cal", "protein", "carbs", "fat", "fiber", "sugar", "alcohol", "sodium"].some((key) => readNumber(line, key) != null);
}

function readLineNutrition(line: string): Required<Nutrition> {
  if ((readNumber(line, "servings") ?? readNumber(line, "qty")) === 0) return zeroNutrition();
  return {
    calories: readNumber(line, "cal") || 0,
    proteinG: readNumber(line, "protein") || 0,
    carbsG: readNumber(line, "carbs") || 0,
    fatG: readNumber(line, "fat") || 0,
    fiberG: readNumber(line, "fiber") || 0,
    sugarG: readNumber(line, "sugar") || 0,
    alcoholG: readNumber(line, "alcohol") || 0,
    sodiumMg: readNumber(line, "sodium") || 0,
  };
}

function mergeLineNutritionOverrides(base: Required<Nutrition>, line: string): Required<Nutrition> {
  return {
    calories: readNumber(line, "cal") ?? base.calories,
    proteinG: readNumber(line, "protein") ?? base.proteinG,
    carbsG: readNumber(line, "carbs") ?? base.carbsG,
    fatG: readNumber(line, "fat") ?? base.fatG,
    fiberG: readNumber(line, "fiber") ?? base.fiberG,
    sugarG: readNumber(line, "sugar") ?? base.sugarG,
    alcoholG: readNumber(line, "alcohol") ?? base.alcoholG,
    sodiumMg: readNumber(line, "sodium") ?? base.sodiumMg,
  };
}

function zeroNutrition(): Required<Nutrition> {
  return {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0,
    alcoholG: 0,
    sodiumMg: 0,
  };
}

function shouldTreatLineNutritionAsLegacyPerServing(lineNutrition: Required<Nutrition>, foodNutrition: Nutrition, multiplier: number): boolean {
  if (!Number.isFinite(multiplier) || Math.abs(multiplier - 1) < 0.0001) return false;
  const comparableKeys: Array<[keyof Required<Nutrition>, keyof Nutrition]> = [
    ["calories", "calories"],
    ["proteinG", "proteinG"],
    ["carbsG", "carbsG"],
    ["fatG", "fatG"],
    ["fiberG", "fiberG"],
    ["sugarG", "sugarG"],
    ["alcoholG", "alcoholG"],
    ["sodiumMg", "sodiumMg"],
  ];
  const comparisons = comparableKeys
    .map(([lineKey, foodKey]) => {
      const foodValue = foodNutrition[foodKey];
      if (foodValue == null || !Number.isFinite(Number(foodValue))) return null;
      return valuesApproximatelyEqual(lineNutrition[lineKey], Number(foodValue));
    })
    .filter((value): value is boolean => value != null);
  return comparisons.length > 0 && comparisons.every(Boolean);
}

function valuesApproximatelyEqual(left: number, right: number): boolean {
  return Math.abs((left || 0) - (right || 0)) < 0.05;
}

function foodLogMultiplier(line: string, food: FoodItem): number {
  const amount = readNumber(line, "amount");
  const unit = (readStringField(line, "amountUnit") || readStringField(line, "unit"))?.toLowerCase();
  if (amount != null && unit === "g" && food.servingGrams) return amount / food.servingGrams;
  if (amount != null && unit === "ml" && food.servingMl) return amount / food.servingMl;
  return normalizedQuantity(readNumber(line, "servings") ?? readNumber(line, "qty"));
}

function multiplyNutrition(nutrition: Nutrition, multiplier: number): Required<Nutrition> {
  return {
    calories: (nutrition.calories || 0) * multiplier,
    proteinG: (nutrition.proteinG || 0) * multiplier,
    carbsG: (nutrition.carbsG || 0) * multiplier,
    fatG: (nutrition.fatG || 0) * multiplier,
    fiberG: (nutrition.fiberG || 0) * multiplier,
    sugarG: (nutrition.sugarG || 0) * multiplier,
    alcoholG: (nutrition.alcoholG || 0) * multiplier,
    sodiumMg: (nutrition.sodiumMg || 0) * multiplier,
  };
}

function formatNutritionPreview(nutrition: Nutrition): string {
  const parts = [
    nutrition.calories != null ? `${round(nutrition.calories)} kcal` : "",
    nutrition.proteinG != null ? `${round(nutrition.proteinG)}g protein` : "",
    nutrition.carbsG != null ? `${round(nutrition.carbsG)}g carbs` : "",
    nutrition.fatG != null ? `${round(nutrition.fatG)}g fat` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : "No macro data";
}

function compactMacroParts(nutrition: Nutrition): string[] {
  const hasAnyValue = [nutrition.calories, nutrition.proteinG, nutrition.carbsG, nutrition.fatG]
    .some((value) => value != null && Math.abs(value) > 0.0001);
  if (!hasAnyValue) return [];
  const parts = [
    nutrition.calories != null ? `${round(nutrition.calories)} kcal` : "",
    nutrition.proteinG != null ? `P ${round(nutrition.proteinG)}g` : "",
    nutrition.carbsG != null ? `C ${round(nutrition.carbsG)}g` : "",
    nutrition.fatG != null ? `F ${round(nutrition.fatG)}g` : "",
  ].filter(Boolean);
  return parts;
}

function renderMacroPills(container: HTMLElement, nutrition: Nutrition): void {
  container.empty();
  const parts = compactMacroParts(nutrition);
  if (!parts.length) {
    container.createSpan({ cls: "tps-health-macro-empty", text: "No macro data" });
    return;
  }
  for (const entry of parts) container.createSpan({ cls: "tps-health-macro-pill", text: entry });
}

function foodResultMeta(item: FoodItem): string {
  const serving = [item.servingAmount ? round(item.servingAmount) : "", item.servingUnit || "serving"].filter(Boolean).join(" ");
  const metric = item.servingGrams ? `${round(item.servingGrams)} g` : item.servingMl ? `${round(item.servingMl)} ml` : "";
  return [item.brand, item.source, metric ? `${serving} = ${metric}` : serving].filter(Boolean).join(" • ");
}

function foodLogNutritionForLine(line: string, plugin?: TPSHealthPlugin): Nutrition {
  const foodPath = readStringField(line, "foodPath");
  if (plugin && foodPath) {
    const file = plugin.app.vault.getAbstractFileByPath(foodPath);
    if (file instanceof TFile) {
      const food = foodFromFileCache(plugin, file);
      return resolveFoodLogNutrition(line, () => food);
    }
  }
  return resolveFoodLogNutrition(line);
}

function foodLogNutritionFromFoodFile(plugin: TPSHealthPlugin, file: TFile, quantity: number, unit: string): Nutrition {
  const food = foodFromFileCache(plugin, file);
  const resolved = resolveFoodLogServing(food, quantity, unit);
  return multiplyNutrition(food.nutrition || {}, resolved.servings);
}

function foodFromFileCache(plugin: TPSHealthPlugin, file: TFile): FoodItem {
  const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter || {};
  return plugin.foodFromFrontmatter(file, fm);
}

function isFoodLogLine(line: string): boolean {
  return line.includes("tps-health:food") ||
    (/\[food::\s*[^\]]+\]/i.test(line) && /\[(qty|servings)::\s*-?\d/i.test(line));
}

function readNumber(line: string, key: string): number | undefined {
  const dataviewMatch = line.match(new RegExp(`\\[${key}::\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
  if (dataviewMatch) return numberOrUndefined(dataviewMatch[1]);
  const match = line.match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  return match ? numberOrUndefined(match[1]) : undefined;
}

function readStringField(line: string, key: string): string | undefined {
  const dataviewMatch = line.match(new RegExp(`\\[${key}::\\s*([^\\]]+)\\]`, "i"));
  return dataviewMatch ? dataviewMatch[1].trim() : undefined;
}

function parseInlineFoodDraft(line: string): InlineFoodDraft | null {
  if (!/^\s*-\s+/.test(line)) return null;
  if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) return null;
  if (/\[food::/i.test(line)) return null;
  const overrides: InlineFoodDraft["overrides"] = {};
  const overridePattern = /\[([a-zA-Z]+)\s*::?\s*(-?\d+(?:\.\d+)?)\]/g;
  let match: RegExpExecArray | null;
  while ((match = overridePattern.exec(line))) {
    const key = normalizeNutrientKey(match[1]);
    if (!key) continue;
    const value = numberOrUndefined(match[2]);
    if (value != null) overrides[key] = value;
  }

  let body = line.replace(/^\s*-\s+/, "");
  const linkMatch = body.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  const sourcePath = linkMatch ? markdownPathFromWikilink(linkMatch[1]) : undefined;
  const hasNutritionOverride = Object.keys(overrides).length > 0;
  body = body
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path: string, label: string | undefined) => label || path.split("/").pop()?.replace(/\.md$/i, "") || path)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return null;

  let quantity = 1;
  let hasExplicitAmount = false;
  const leadingUnitMatch = body.match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half)\s*(cup|cups|bar|bars|pastry|pastries|package|packages|serving|servings|pint|pints|oz|g)\s+/i);
  if (leadingUnitMatch) {
    quantity = parseQuantity(leadingUnitMatch[1]);
    const unit = singularUnit(leadingUnitMatch[2]);
    body = body.slice(leadingUnitMatch[0].length).trim();
    return body ? { query: body, quantity, unit, sourcePath, hasExplicitAmount: true, overrides } : null;
  }

  const quantityMatch = body.match(/^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half)\s+/i);
  if (quantityMatch) {
    quantity = parseQuantity(quantityMatch[1]);
    body = body.slice(quantityMatch[0].length).trim();
    hasExplicitAmount = true;
  }

  const trailingAmountMatch = body.match(/(?:\s+-\s+|\s+)(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half)\s*(cup|cups|bar|bars|pastry|pastries|package|packages|serving|servings|pint|pints|oz|g)$/i);
  if (trailingAmountMatch) {
    quantity = parseQuantity(trailingAmountMatch[1]);
    const unit = singularUnit(trailingAmountMatch[2]);
    body = body.slice(0, trailingAmountMatch.index).trim();
    return body ? { query: body, quantity, unit, sourcePath, hasExplicitAmount: true, overrides } : null;
  }

  const unitMatch = body.match(/\s+(cup|cups|bar|bars|pastry|pastries|package|packages|serving|servings|pint|pints|oz|g)$/i);
  const unit = unitMatch ? singularUnit(unitMatch[1]) : undefined;
  if (unitMatch) body = body.slice(0, unitMatch.index).trim();

  if (!sourcePath && !hasNutritionOverride && !hasExplicitAmount && !unit) return null;
  return body ? { query: body, quantity, unit, sourcePath, hasExplicitAmount, overrides } : null;
}

function markdownPathFromWikilink(path: string): string {
  const normalized = normalizePath(path.trim());
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function lineHasFoodDraftProperties(line: string): boolean {
  return /\[(?:food|qty|unit|servings|amount|amountUnit|cal|cals|calorie|calories|protein|carb|carbs|fat|fiber|fibre|sugar|sugars|alcohol|alc|sodium|salt)\s*::?\s*[^\]]*]/i.test(line);
}

function parseQuantity(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === "half") return 0.5;
  const fraction = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator ? numerator / denominator : 1;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function singularUnit(unit: string): string {
  const normalized = unit.toLowerCase();
  if (normalized === "cups") return "cup";
  if (normalized === "bars") return "bar";
  if (normalized === "pastries") return "pastry";
  if (normalized === "packages") return "package";
  if (normalized === "servings") return "serving";
  if (normalized === "pints") return "pint";
  return normalized;
}

function normalizeNutrientKey(key: string): keyof InlineFoodDraft["overrides"] | null {
  const normalized = key.trim().toLowerCase();
  if (normalized === "cal" || normalized === "cals" || normalized === "calorie" || normalized === "calories") return "cal";
  if (normalized === "protein" || normalized === "p") return "protein";
  if (normalized === "carb" || normalized === "carbs" || normalized === "c") return "carbs";
  if (normalized === "fat" || normalized === "f") return "fat";
  if (normalized === "fiber" || normalized === "fibre") return "fiber";
  if (normalized === "sugar" || normalized === "sugars") return "sugar";
  if (normalized === "alcohol" || normalized === "alcoholg" || normalized === "alc") return "alcohol";
  if (normalized === "sodium" || normalized === "salt") return "sodium";
  return null;
}

function withNutritionOverrides(nutrition: Nutrition, overrides: InlineFoodDraft["overrides"]): Nutrition {
  return {
    ...nutrition,
    calories: overrides.cal ?? nutrition.calories,
    proteinG: overrides.protein ?? nutrition.proteinG,
    carbsG: overrides.carbs ?? nutrition.carbsG,
    fatG: overrides.fat ?? nutrition.fatG,
    fiberG: overrides.fiber ?? nutrition.fiberG,
    sugarG: overrides.sugar ?? nutrition.sugarG,
    alcoholG: overrides.alcohol ?? nutrition.alcoholG,
    sodiumMg: overrides.sodium ?? nutrition.sodiumMg,
  };
}

function hasInlineNutritionOverrides(overrides: InlineFoodDraft["overrides"]): boolean {
  return Object.values(overrides).some((value) => value != null && Number.isFinite(Number(value)));
}

function nutritionFromInlineOverrides(overrides: InlineFoodDraft["overrides"]): Nutrition {
  const nutrition = withNutritionOverrides({}, overrides);
  if (nutrition.calories == null) {
    nutrition.calories = caloriesFromMacros(nutrition);
  }
  return nutrition;
}

function removeLegacyRollupBlock(content: string, rollupHeading: string): string {
  const startToken = "<!-- tps-health-rollup:start -->";
  const endToken = "<!-- tps-health-rollup:end -->";
  const start = content.indexOf(startToken);
  const end = content.indexOf(endToken);
  if (start < 0 || end <= start) return content;

  const beforeStart = content.slice(0, start);
  const afterEnd = content.slice(end + endToken.length);
  const headingPatterns = [
    `## ${rollupHeading}`,
    "## DailyHealth",
    "## Health Rollup",
  ];
  let replaceStart = start;
  for (const heading of headingPatterns) {
    const headingStart = beforeStart.lastIndexOf(heading);
    if (headingStart >= 0 && beforeStart.slice(headingStart).trim().startsWith(heading)) {
      replaceStart = headingStart;
      break;
    }
  }

  return `${content.slice(0, replaceStart).trimEnd()}${afterEnd.startsWith("\n") ? afterEnd : `\n${afterEnd}`}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function settingsNeedMigration(stored: unknown, normalized: TPSHealthSettings): boolean {
  if (!stored || typeof stored !== "object") return true;
  return JSON.stringify(stored) !== JSON.stringify(normalized);
}

function frontmatterEndIndex(content: string): number {
  if (!content.startsWith("---\n")) return 0;
  const end = content.indexOf("\n---", 4);
  if (end < 0) return 0;
  const lineEnd = content.indexOf("\n", end + 4);
  return lineEnd < 0 ? content.length : lineEnd + 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() || "Untitled food";
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
