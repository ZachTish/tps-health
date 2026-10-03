import { Component, ItemView, WorkspaceLeaf } from "obsidian";
import { dailyEnergyEstimate, type EnergySettings } from "./energy-estimate";
import { formatNativeDailyMacroValue as format } from "./native-daily-dashboard";

export const HEALTH_DASHBOARD_VIEW = "tps-health-dashboard";

export function dashboardDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localHealthDate(date) === value ? date : null;
}
export function localHealthDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function healthWeekDates(end: string): string[] {
  const date = dashboardDate(end);
  if (!date) throw new Error("Choose a valid date.");
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(date); day.setDate(day.getDate() - 6 + i);
    return localHealthDate(day);
  });
}
export interface HealthDashboardIndex {
  getDailyFoodTotals(date: string): { calories: number; entryCount: number };
  getDailyActivityTotals(date: string): { durationMinutes: number; steps: number; entryCount: number };
}
export function healthDashboardWeek(index: HealthDashboardIndex, settings: EnergySettings, end: string) {
  return healthWeekDates(end).map(dateIso => ({
    ...dailyEnergyEstimate(settings, { dateIso, ...index.getDailyFoodTotals(dateIso) }),
    activity: index.getDailyActivityTotals(dateIso),
  }));
}
export interface HealthDashboardHost {
  dashboardEnabled(): boolean;
  mountDashboardDay(container: HTMLElement, date: string, onRendered: (indexing: boolean) => void): Component;
  dashboardWeek(date: string): ReturnType<typeof healthDashboardWeek>;
  dashboardAction(action: "food" | "activity" | "workout" | "recipe" | "settings", date: string): void;
}

/** A dedicated view over the same day component/index used by Health blocks. */
export class HealthDashboardView extends ItemView {
  private dateIso = localHealthDate();
  private day: Component | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: HealthDashboardHost) { super(leaf); }
  getViewType(): string { return HEALTH_DASHBOARD_VIEW; }
  getDisplayText(): string { return "Health"; }
  getIcon(): string { return "heart-pulse"; }
  async onOpen(): Promise<void> { this.contentEl.addClass("tps-health-dashboard-view"); this.showDay(); }
  async onClose(): Promise<void> { this.clearDay(); }
  private clearDay(): void { if (this.day) this.removeChild(this.day); this.day = null; }

  private showDay(focusLabel?: string): void {
    this.clearDay();
    const root = this.contentEl; root.empty();
    const header = root.createDiv({ cls: "tps-health-dashboard-header" });
    header.createEl("h1", { text: "Health" });
    const nav = header.createDiv({ cls: "tps-health-dashboard-dates", attr: { role: "group", "aria-label": "Choose health day" } });
    const button = (parent: HTMLElement, label: string, action: () => void, text = label) => {
      const el = parent.createEl("button", { text, attr: { type: "button", "aria-label": label } });
      el.addEventListener("click", action); return el;
    };
    const shift = (offset: number, label: string) => {
      const date = dashboardDate(this.dateIso)!; date.setDate(date.getDate() + offset);
      this.dateIso = localHealthDate(date); this.showDay(label);
    };
    button(nav, "Previous day", () => shift(-1, "Previous day"), "‹");
    const input = nav.createEl("input", { attr: { type: "date", "aria-label": "Health date" } });
    input.value = this.dateIso;
    input.addEventListener("change", () => {
      if (!dashboardDate(input.value)) { input.value = this.dateIso; return; }
      this.dateIso = input.value; this.showDay("Health date");
    });
    button(nav, "Next day", () => shift(1, "Next day"), "›");
    button(nav, "Today", () => { this.dateIso = localHealthDate(); this.showDay("Today"); });
    button(nav, "Refresh health dashboard", () => this.showDay("Refresh health dashboard"), "Refresh");
    const date = dashboardDate(this.dateIso)!;
    const relation = this.dateIso === localHealthDate() ? "Today" : this.dateIso < localHealthDate() ? "Past day" : "Future day";
    root.createEl("p", { cls: "tps-health-dashboard-day-label", text: `${relation} · ${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`, attr: { "aria-live": "polite" } });
    const actions = root.createDiv({ cls: "tps-health-dashboard-actions", attr: { role: "group", "aria-label": "Health actions" } });
    for (const [action, label] of [["food", "Log food"], ["activity", "Log activity"], ["workout", "Start workout"], ["recipe", "Create recipe"], ["settings", "Health settings"]] as const) {
      button(actions, label, () => this.host.dashboardAction(action, this.dateIso));
    }
    if (!this.host.dashboardEnabled()) {
      root.createEl("p", { text: "This dashboard uses Health's native food, activity and workout records. Choose Atomic notes in Health settings → Daily logging → Health storage to use it. Legacy notes are not imported automatically." });
    } else {
      const glance = root.createEl("section", { cls: "tps-health-dashboard-glance", attr: { "aria-label": "Seven-day glance" } });
      glance.createEl("p", { cls: "tps-health-dashboard-glance-loading", text: "Loading recent Health records…", attr: { role: "status" } });
      const daily = root.createDiv({ cls: "tps-health-dashboard-day" });
      const week = root.createEl("section", { cls: "tps-health-dashboard-week", attr: { "aria-label": "Seven-day comparison" } });
      this.day = this.host.mountDashboardDay(daily, this.dateIso, indexing => this.renderWeek(glance, week, indexing));
      this.addChild(this.day);
    }
    if (focusLabel) root.querySelector<HTMLElement>(`[aria-label="${focusLabel}"]`)?.focus();
  }

  private renderWeek(glance: HTMLElement, container: HTMLElement, indexing: boolean): void {
    glance.empty();
    container.empty();
    const days = this.host.dashboardWeek(this.dateIso);
    const selectDate = (dateIso: string) => { this.dateIso = dateIso; this.showDay("Health date"); };
    glance.createEl("h2", { text: "Last seven days" });
    const glanceDays = glance.createDiv({ cls: "tps-health-dashboard-glance-days", attr: { role: "group", "aria-label": "Choose a health day" } });
    for (const day of [...days].reverse()) {
      const intake = day.consumedKcal == null
        ? indexing ? "Food pending" : "No food log"
        : `${format(day.consumedKcal)} kcal`;
      const activity = day.activity.entryCount
        ? `${format(day.activity.durationMinutes)} min activity`
        : indexing ? "Activity pending" : "No activity";
      const choice = glanceDays.createEl("button", { cls: "tps-health-dashboard-glance-day", attr: {
        type: "button", "aria-label": `View ${day.dateIso}: ${intake}, ${activity}`,
        "aria-current": day.dateIso === this.dateIso ? "date" : "false",
      } });
      choice.createSpan({ cls: "tps-health-dashboard-glance-date", text: dashboardDate(day.dateIso)!.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }) });
      choice.createSpan({ cls: "tps-health-dashboard-glance-facts", text: `${intake} · ${activity}` });
      choice.addEventListener("click", () => selectDate(day.dateIso));
    }
    container.createEl("h2", { text: "Seven days ending " + this.dateIso });
    if (indexing) container.createEl("p", { cls: "tps-health-dashboard-index-status", text: "Indexing remaining notes; seven-day totals may change.", attr: { role: "status" } });
    const logged = days.filter(day => day.consumedKcal != null);
    container.createEl("p", { text: indexing
      ? `${logged.length ? `${logged.length} of 7 days with known food logs` : "Checking seven days for food logs"} · Activity totals may change.`
      : `${logged.length} of 7 days with food logs · ${format(days.reduce((sum, day) => sum + day.activity.durationMinutes, 0))} logged activity minutes · ${format(days.reduce((sum, day) => sum + day.activity.steps, 0))} steps` });
    const wrap = container.createDiv({ cls: "tps-health-dashboard-table" });
    const table = wrap.createEl("table");
    table.createEl("caption", { text: "Logged intake and full-day burn estimates (kcal)" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Day", "Intake", "Est. burn", "Difference", "Activity"]) head.createEl("th", { text: label, attr: { scope: "col" } });
    const body = table.createEl("tbody");
    for (const day of days) {
      const row = body.createEl("tr");
      const cell = row.createEl("th", { attr: { scope: "row" } });
      const select = cell.createEl("button", { text: dashboardDate(day.dateIso)!.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }), attr: { type: "button", "aria-label": `View ${day.dateIso}`, "aria-current": day.dateIso === this.dateIso ? "date" : "false" } });
      select.addEventListener("click", () => selectDate(day.dateIso));
      for (const [label, value] of [
        ["Intake", day.consumedKcal == null ? "—" : format(day.consumedKcal)],
        ["Est. burn", day.estimatedBurnKcal == null ? "—" : format(day.estimatedBurnKcal)],
        ["Difference", day.differenceKcal == null ? "—" : `${day.differenceKcal > 0 ? "+" : ""}${format(day.differenceKcal)}`],
        ["Activity", day.activity.entryCount ? `${format(day.activity.durationMinutes)} min` : "—"],
      ]) row.createEl("td", { text: value, attr: { "data-label": label } });
    }
    container.createEl("p", { cls: "tps-health-dashboard-note", text: `${indexing ? "— means no known logged data yet or no configured estimate while indexing continues. " : "— means no logged data or no configured estimate. "}Difference is logged intake minus estimated burn. Estimates use your current BMR and activity factor, including typical exercise; activity calories are not added again.` });
  }
}
