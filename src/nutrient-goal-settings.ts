import { Setting } from 'obsidian';
import type TPSHealthPlugin from './main';
import { canonicalGoalKey, nutrientDisplayDefaults, filterGoalNutrients, findNutrientGoal, goalNutrients } from './nutrient-goals';

/** Only search, category and selection are transient. Targets are edited in their canonical goal notes. */
export function renderNutrientGoalSettings(container: HTMLElement, plugin: TPSHealthPlugin, onSaved: () => void): () => void {
  container.addClass('tps-health-settings-nutrient-goals');
  container.createEl('p',{text:'Foods, recipes, meals and food logs save only the nutrients in Your nutrient goals, including Track only entries. Newly tracked nutrients apply to future logs; existing logs are not backfilled. Removing a goal stops future writes for it; existing notes are not automatically rewritten.',cls:'setting-item-description'});
  let query = '', group = '', selected = 'consumedCalories';
  const status = container.createDiv({attr:{role:'status','aria-live':'polite'}});
  new Setting(container).setName('Find a nutrient').addSearch(search => {
    search.inputEl.setAttribute('aria-label', 'Find a nutrient');
    search.setPlaceholder('Name, unit or category').onChange(value => { query = value; render(); });
  });
  const categories = new Setting(container).setName('Category');
  const picker = container.createDiv();
  const editor = container.createDiv();
  const configured = container.createDiv({cls:'tps-health-settings-nutrient-summary'});
  let categorySelect: HTMLSelectElement;
  categories.addDropdown(dropdown => {
    categorySelect = dropdown.selectEl;
    categorySelect.setAttribute('aria-label', 'Nutrient category');
    dropdown.onChange(value => { group = value; render(); });
  });
  const render = () => {
    const catalog = goalNutrients((plugin.getHealthGoals?.() ?? plugin.settings.healthGoals));
    categorySelect.empty();
    categorySelect.createEl('option', {value:'',text:'All categories'});
    for (const name of [...new Set(catalog.map(n => n.group))]) categorySelect.createEl('option',{value:name,text:name});
    categorySelect.value = group;
    const matches = filterGoalNutrients(catalog, query, group);
    if (!matches.some(n => n.key === selected)) selected = matches[0]?.key || '';
    picker.empty(); editor.empty(); configured.empty();
    new Setting(picker).setName('Nutrient').setDesc(matches.length+' available'+(query || group ? ' in this filter' : '')).addDropdown(dropdown => {
      dropdown.selectEl.setAttribute('aria-label','Select nutrient goal');
      for (const n of matches) dropdown.addOption(n.key, n.label+' ('+n.unit+')'+(n.archived ? ' · Archived' : ''));
      dropdown.setValue(selected).setDisabled(!matches.length).onChange(value => {
        selected = value; render(); picker.querySelector<HTMLSelectElement>('select')?.focus();
      });
    });
    const nutrient = catalog.find(n => n.key === selected);
    if (!nutrient) editor.createDiv({text:'No matching nutrients. Try another name or category.'});
    else {
      const saved = findNutrientGoal((plugin.getHealthGoals?.() ?? plugin.settings.healthGoals), selected);
      let minimum = saved?.min == null ? '' : String(saved.min);
      let maximum = saved?.max == null ? '' : String(saved.max);
      const description = plugin.settings.goalStorage === 'notes' ? 'Leave either bound blank, or both blank to track without a target.' : selected === 'consumedCalories' ? 'Calories keep a positive maximum target.'
        : selected === 'protein' ? 'Protein keeps a positive minimum target.'
        : 'Leave either bound blank, or both blank to track without a target.';
      editor.createEl('p',{text:nutrient.label+' · per day · '+nutrient.unit});
      editor.createEl('p',{text:description,cls:'setting-item-description'});
      for (const field of ['Minimum','Maximum'] as const) new Setting(editor).setName(field+' ('+nutrient.unit+')').addText(text => {
        text.inputEl.setAttribute('aria-label',field+' daily '+nutrient.label+' ('+nutrient.unit+')');
        text.inputEl.setAttribute('inputmode','decimal');
        text.setPlaceholder('No '+field.toLowerCase()).setValue(field === 'Minimum' ? minimum : maximum).onChange(value => {
          if (field === 'Minimum') minimum = value; else maximum = value;
        });
      });
      const defaults = nutrientDisplayDefaults(nutrient.key);
      const display = {
        showInPrimary: saved?.showInPrimary ?? defaults.showInPrimary,
        showInSecondary: saved?.showInSecondary ?? defaults.showInSecondary,
      };
      new Setting(editor).setName('Show in primary totals')
        .setDesc('Shown as a ring, or a primary row when Macros block is set to Rows.')
        .addToggle(toggle => {
          toggle.toggleEl.setAttribute('aria-label', 'Show '+nutrient.label+' in primary totals');
          toggle.setValue(display.showInPrimary).onChange(value => { display.showInPrimary = value; });
        });
      new Setting(editor).setName('Show in nutrient bars')
        .setDesc('Shown in the lower Nutrients section. A nutrient can appear in both places. Save target to apply.')
        .addToggle(toggle => {
          toggle.toggleEl.setAttribute('aria-label', 'Show '+nutrient.label+' in nutrient bars');
          toggle.setValue(display.showInSecondary).onChange(value => { display.showInSecondary = value; });
        });
      const actions = new Setting(editor);
      const save = async (remove: boolean, button: HTMLButtonElement) => {
        button.disabled = true;
        try {
          await plugin.saveNutrientGoal(nutrient.key, minimum, maximum, remove, display);
          status.setText(remove ? 'Goal note disabled. Existing amounts are retained.' : 'Goal note saved. Open Bases update from this note.');
          render(); onSaved(); picker.querySelector<HTMLSelectElement>('select')?.focus();
        } catch (error) { status.setText((error as Error).message); button.disabled = false; }
      };
      actions.addButton(button => button.setButtonText('Save target').setCta().onClick(() => void save(false,button.buttonEl)));
      if (saved && (plugin.settings.goalStorage === 'notes' || !['consumedCalories','protein'].includes(selected))) actions.addButton(button =>
        button.setButtonText('Remove goal').onClick(() => void save(true,button.buttonEl)));
    }
    configured.createEl('p',{text:'Your nutrient goals'});
    for (const goal of (plugin.getHealthGoals?.() ?? plugin.settings.healthGoals).filter(g => g.propertyKey !== 'activity')) {
      const key = canonicalGoalKey(goal.propertyKey);
      const label = catalog.find(n => n.key === key)?.label || goal.label;
      const bounds = goal.kind === 'counter' ? 'Track only' : [goal.min == null ? '' : '≥ '+goal.min, goal.max == null ? '' : '≤ '+goal.max].filter(Boolean).join(' · ')+' '+goal.unit;
      const button = configured.createEl('button',{text:label+' · '+bounds,attr:{type:'button','aria-pressed':String(key===selected)}});
      button.addEventListener('click',() => { query=''; group=''; selected=key; const search=container.querySelector<HTMLInputElement>('input[type="search"]'); if(search) search.value=''; render(); picker.querySelector<HTMLSelectElement>('select')?.focus(); });
    }
  };
  render();
  return render;
}
