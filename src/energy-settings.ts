import { Setting } from 'obsidian';
import type TPSHealthPlugin from './main';
import { dailyEnergyEstimate } from './energy-estimate';
import { formatNativeDailyMacroValue } from './native-daily-dashboard';

export function renderEnergySettings(container: HTMLElement, plugin: TPSHealthPlugin): void {
  let bmr = plugin.settings.energyBmrKcal == null ? '' : String(plugin.settings.energyBmrKcal);
  let factor = String(plugin.settings.energyActivityFactor);
  new Setting(container).setName('BMR (kcal/day)').setDesc('Your basal metabolic rate. Leave blank to turn off the burn estimate.').addText(text => {
    text.inputEl.setAttribute('aria-label','BMR in kcal per day');
    text.inputEl.setAttribute('inputmode','decimal');
    text.setPlaceholder('Enter your BMR').setValue(bmr).onChange(value => bmr = value);
  });
  new Setting(container).setName('Daily activity factor').setDesc('Includes everyday movement and typical exercise. Common values range from 1.4 (sedentary) to 2.5 (very active). Logged workout calories are shown separately and are not added again.').addText(text => {
    text.inputEl.setAttribute('aria-label','Daily activity factor');
    text.inputEl.setAttribute('inputmode','decimal');
    text.setValue(factor).onChange(value => factor = value);
  });
  const preview = container.createDiv({cls:'tps-health-settings-energy-preview',attr:{role:'status','aria-live':'polite'}});
  const updatePreview = () => {
    const model = dailyEnergyEstimate(plugin.settings,{dateIso:'',calories:0,entryCount:0});
    preview.setText(model.estimatedBurnKcal == null ? 'Enter a BMR to enable your estimate.' :
      'Estimated full-day burn: '+formatNativeDailyMacroValue(model.estimatedBurnKcal)+' kcal/day.');
  };
  new Setting(container).addButton(button => button.setButtonText('Save energy settings').setCta().onClick(async () => {
    button.setDisabled(true);
    try { await plugin.saveEnergySettings(bmr,factor); updatePreview(); }
    catch (error) { preview.setText((error as Error).message); }
    finally { button.setDisabled(false); button.buttonEl.focus(); }
  }));
  container.createEl('p',{text:'Use a tps-health-overview block to compare this estimate with logged food, macros and activity. The current BMR and activity factor apply to every displayed date.',cls:'setting-item-description'});
  updatePreview();
}
