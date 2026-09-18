import { Setting } from 'obsidian';
import type TPSHealthPlugin from './main';

/** Definitions live in Health; archiving never removes recorded nutrition. */
export function renderCustomNutrientSettings(container: HTMLElement, plugin: TPSHealthPlugin): void {
  let name = '', unit = '';
  const message = container.createDiv({attr:{role:'status','aria-live':'polite'}});
  let nameInput: HTMLInputElement;
  new Setting(container).setName('Nutrient name').addText(text => {
    nameInput = text.inputEl;
    text.inputEl.setAttribute('aria-label', 'Custom nutrient name');
    text.onChange(value => name = value);
  });
  new Setting(container).setName('Unit').setDesc('Use the unit on your label. Amounts are added in this unit; units are never guessed or converted.').addText(text => {
    text.inputEl.setAttribute('aria-label', 'Custom nutrient unit');
    text.onChange(value => unit = value);
  });
  const list = container.createDiv();
  let selected = plugin.settings.customNutrients?.[0]?.key;
  const renderList = () => {
    list.empty();
    const definitions = plugin.settings.customNutrients || [];
    if (!definitions.length) { list.createDiv({text:'No custom nutrients yet. Built-in nutrients remain available.'}); return; }
    selected = definitions.find(n => n.key === selected)?.key || definitions[0].key;
    new Setting(list).setName('Your nutrients').addDropdown(dropdown => {
      dropdown.selectEl.setAttribute('aria-label', 'Select custom nutrient');
      for (const n of definitions) dropdown.addOption(n.key, `${n.label} (${n.unit})${n.archived ? ' · Archived' : ''}`);
      dropdown.setValue(selected!).onChange(value => { selected = value as typeof selected; renderList(); list.querySelector<HTMLSelectElement>('select')?.focus(); });
    });
    const definition = definitions.find(n => n.key === selected)!;
    let label = definition.label;
    const save = async (patch: {label?:string;archived?:boolean}) => {
      try {
        await plugin.updateCustomNutrients(definitions.map(n => n.key === definition.key ? {...n,...patch} : n));
        message.setText('Nutrient updated.'); renderList();
        list.querySelector<HTMLSelectElement>('select')?.focus();
      } catch (error) { message.setText(String((error as Error).message)); }
    };
    new Setting(list).setName('Display name').addText(text => text.setValue(label).onChange(value => label = value))
      .addButton(button => button.setButtonText('Save name').onClick(() => void save({label})));
    new Setting(list).setName(`Unit: ${definition.unit}`).setDesc('Create a separate nutrient for a different unit so earlier amounts keep their meaning.');
    new Setting(list).setName('Available for new foods').setDesc('Turn off to archive. Recorded values remain visible and editable.')
      .addToggle(toggle => toggle.setValue(!definition.archived).onChange(value => void save({archived:!value})));
  };
  // Keep the add action before the collection it changes.
  const action = new Setting(container).addButton(button => button.setButtonText('Add nutrient').onClick(async () => {
    button.setDisabled(true);
    try {
      const definition = await plugin.addCustomNutrient(name, unit);
      selected = definition.key; message.setText('Nutrient added. Enter its amount when creating or editing a food.');
      renderList(); nameInput.focus();
    } catch (error) { message.setText(String((error as Error).message)); }
    finally { button.setDisabled(false); }
  }));
  container.insertBefore(action.settingEl, list);
  renderList();
}
