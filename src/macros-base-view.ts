import { claimMacrosBaseNew } from './macros-base-toolbar';
import { BasesView, Notice, type BasesViewConfig, type BasesAllOptions, type QueryController } from 'obsidian';
import type TPSHealthPlugin from './main';
import { configuredNativePropertyKey } from './native-record-schema';
import { availableNutrientConfigs } from './native-daily-dashboard';
import { MACRO_PROPERTY_KEYS, groupMacroDays, validMacroDate, visibleMacroGoals, MACROS_BASE_TYPE } from './macros-base-model';

export class MacrosBaseView extends BasesView {
  type = MACROS_BASE_TYPE;
  private dateInput: HTMLInputElement;
  private body: HTMLElement;
  private chosenDate = false;
  private timer: number | null = null;
  private disclosures = new Map<string, Map<string, boolean>>();
  private alive = true;

  constructor(controller: QueryController, private container: HTMLElement, private plugin: TPSHealthPlugin) {
    super(controller);
    container.addClass('tps-health-macros-base');
    const toolbar = container.createDiv({ cls: 'tps-health-macros-base-add' });
    this.dateInput = toolbar.createEl('input', { attr: { type: 'date', required: '', 'aria-label': 'Date for new food logs' } });
    this.dateInput.value = this.today();
    this.dateInput.addEventListener('change', () => { this.chosenDate = true; });
    const add = toolbar.createEl('button', { text: 'Add food', attr: { type: 'button' } });
    add.addEventListener('click', () => void this.createFileForView());
    this.body = container.createDiv({ cls: 'tps-health-macros-base-days' });
  }
  onload(): void {
    this.alive = true;
    this.container.addClass('tps-health-macros-base');
    const claimNew = (event: MouseEvent | KeyboardEvent) => {
      if (this.alive) claimMacrosBaseNew(event, this.container, () => void this.createFileForView());
    };
    this.registerDomEvent(this.container.ownerDocument, 'click', claimNew, { capture: true });
    this.registerDomEvent(this.container.ownerDocument, 'keydown', claimNew, { capture: true });
    this.registerEvent(this.app.workspace.on('tps-health:unloading' as any, () => this.unload()));
    this.registerEvent(this.app.workspace.on('tps-health:appearance-changed' as any, () => this.scheduleRender()));
    const unsubscribe = this.plugin.nativeRecordService.onRecordsChanged(() => this.scheduleRender());
    this.register(unsubscribe);
    this.register(() => { this.alive = false; if (this.timer !== null) window.clearTimeout(this.timer); this.timer = null; this.container.removeClass('tps-health-macros-base'); });
  }
  onDataUpdated(): void { this.scheduleRender(); }
  private scheduleRender(): void {
    if (!this.alive || this.timer !== null) return;
    this.timer = window.setTimeout(() => { this.timer = null; this.render(); }, 40);
  }
  private today(): string { return (window as any).moment().format('YYYY-MM-DD'); }
  async createFileForView(): Promise<void> {
    if (!this.alive) return;
    if (!this.plugin.nativeRecordService.isEnabled()) { new Notice('Use Atomic notes in Health settings to log food from this Base.'); return; }
    const day = this.dateInput.value;
    if (!validMacroDate(day)) { this.dateInput.focus(); this.dateInput.reportValidity(); return; }
    this.plugin.openFoodLogger({ dateIso: day, label: day, isToday: day === this.today(), focusAfterLog: false });
  }
  private render(): void {
    if (!this.data || !this.alive) return;
    const scroll = this.container.scrollTop;
    this.body.empty();
    if (!this.plugin.nativeRecordService.isEnabled()) {
      this.body.createDiv({ text: 'Use Atomic notes in Health settings to show food logs here.' }); return;
    }
    const order = this.config.getOrder();
    const includeRecordedNutrients = this.config.get('nutrientSelection') !== 'properties';
    const goals = visibleMacroGoals(availableNutrientConfigs(this.plugin.getMetricRenderConfigs()), order, this.plugin.settings).map(goal => {
      const key = configuredNativePropertyKey(this.plugin.settings, MACRO_PROPERTY_KEYS[goal.propertyKey]);
      const name = this.config.getDisplayName(`note.${key}`);
      return { ...goal, label: name && name !== key ? name : goal.label };
    });
    const style = this.config.get('macroStyle');
    const nutrients = this.config.get('nutrients');
    const foodList = this.config.get('foods');
    const allDays = new Set<string>();
    const activeKeys = new Set<string>();
    let count = 0;
    for (const [index, group] of this.data.groupedData.entries()) {
      const entries = this.plugin.nativeRecordService.getFoodEntriesForPaths(group.entries.map(entry => entry.file.path));
      const days = groupMacroDays(entries);
      if (!days.size) continue;
      const label = group.hasKey() ? String(group.key) : '';
      if (label) this.body.createEl('h3', { text: label, cls: 'tps-health-macros-base-group' });
      for (const [day, foods] of days) {
        allDays.add(day); count += foods.length;
        const stateKey = `${index}:${label}:${day}`;
        activeKeys.add(stateKey);
        const state = this.disclosures.get(stateKey) || new Map<string, boolean>();
        this.disclosures.set(stateKey, state);
        const section = this.body.createDiv({ cls: 'tps-health-macros-base-day' });
        section.createEl('h3', { text: (window as any).moment(day,'YYYY-MM-DD').format('ddd, MMM D, YYYY') });
        this.plugin.renderMacrosBaseDay(section, day, foods, goals, {
          macroStyle: style === 'table' || style === 'rings' ? style : this.plugin.settings.macroBlockStyle,
          nutrientRows: nutrients === 'hidden' || nutrients === 'expanded' || nutrients === 'collapsed' ? nutrients : this.plugin.settings.macroNutrientRows,
          foodList: foodList === 'expanded' ? 'expanded' : 'collapsed',
          showCalories: goals.some(goal => goal.propertyKey === 'consumedCalories' || goal.propertyKey === 'cal'),
        }, state, includeRecordedNutrients);
      }
    }
    for (const key of this.disclosures.keys()) if (!activeKeys.has(key)) this.disclosures.delete(key);
    if (!this.chosenDate) this.dateInput.value = allDays.size === 1 ? [...allDays][0] : this.today();
    if (!count) this.body.createDiv({ cls: 'tps-health-macros-base-empty', text: 'No food logs match these filters.' });
    else if (!goals.length && !includeRecordedNutrients) this.body.createDiv({ text: 'Choose nutrient properties from the Properties menu, or show recorded nutrients in view options.' });
    this.container.scrollTop = scroll;
  }
  static options(_config: BasesViewConfig): BasesAllOptions[] {
    return [
      { type: 'dropdown', key: 'macroStyle', displayName: 'Macros', default: 'default', options: { default: 'Health default', rings: 'Rings', table: 'Rows' } },
      { type: 'dropdown', key: 'nutrients', displayName: 'Nutrient rows', default: 'default', options: { default: 'Health default', collapsed: 'Collapsed', expanded: 'Expanded', hidden: 'Hidden' } },
      { type: 'dropdown', key: 'nutrientSelection', displayName: 'Show nutrients', default: 'recorded', options: { recorded: 'Recorded nutrients', properties: 'Selected properties only' } },
      { type: 'dropdown', key: 'foods', displayName: 'Food logs', default: 'collapsed', options: { collapsed: 'Collapsed', expanded: 'Expanded' } },
    ];
  }
}
