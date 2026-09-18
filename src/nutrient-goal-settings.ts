import { Setting } from 'obsidian';
import type TPSHealthPlugin from './main';
import { canonicalGoalKey, filterGoalNutrients, findNutrientGoal, goalNutrients } from './nutrient-goals';

/** Only search, category and selection are transient. Goals use the existing settings contract. */
export function renderNutrientGoalSettings(container: HTMLElement, plugin: TPSHealthPlugin, onSaved: () => void): () => void {
  container.addClass('tps-health-settings-nutrient-goals');
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
    const catalog = goalNutrients(plugin.settings.healthGoals);
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
      const saved = findNutrientGoal(plugin.settings.healthGoals, selected);
      // The existing scalar fields remain canonical for these two targets.
      let minimum = selected === 'protein' ? String(plugin.settings.proteinGoalG) : saved?.min == null ? '' : String(saved.min);
      let maximum = selected === 'consumedCalories' ? String(plugin.settings.calorieGoal) : saved?.max == null ? '' : String(saved.max);
      const description = selected === 'consumedCalories' ? 'Calories keep a positive maximum target.'
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
      const actions = new Setting(editor);
      const save = async (remove: boolean, button: HTMLButtonElement) => {
        button.disabled = true;
        try {
          await plugin.saveNutrientGoal(nutrient.key, minimum, maximum, remove);
          status.setText(remove ? 'Goal removed. Recorded amounts are retained.' : 'Daily target saved.');
          render(); onSaved(); picker.querySelector<HTMLSelectElement>('select')?.focus();
        } catch (error) { status.setText((error as Error).message); button.disabled = false; }
      };
      actions.addButton(button => button.setButtonText('Save target').setCta().onClick(() => void save(false,button.buttonEl)));
      if (saved && !['consumedCalories','protein'].includes(selected)) actions.addButton(button =>
        button.setButtonText('Remove goal').onClick(() => void save(true,button.buttonEl)));
    }
    configured.createEl('p',{text:'Your nutrient goals'});
    for (const goal of plugin.settings.healthGoals.filter(g => g.propertyKey !== 'activity')) {
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
