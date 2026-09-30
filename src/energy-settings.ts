import { Setting } from 'obsidian';
import type TPSHealthPlugin from './main';
import { dailyEnergyEstimate, parseEnergySettings } from './energy-estimate';
import { formatNativeDailyMacroValue } from './native-daily-dashboard';

export function renderEnergySettings(container: HTMLElement, plugin: TPSHealthPlugin): void {
  let mode = plugin.settings.energyEstimateMode;
  let bmr = plugin.settings.energyBmrKcal == null ? '' : String(plugin.settings.energyBmrKcal);
  let factor = String(plugin.settings.energyActivityFactor);
  let fixed = plugin.settings.energyFixedTdeeKcal == null ? '' : String(plugin.settings.energyFixedTdeeKcal);
  let updatePreview = () => {};
  new Setting(container).setName('TDEE method').setDesc('Choose a fixed daily target or calculate one from BMR and activity factor. Workout calories are not added again.').addDropdown(dropdown => {
    dropdown.addOption('calculated','Calculated').addOption('fixed','Fixed');
    dropdown.setValue(mode).onChange(value => {
      mode = value === 'fixed' ? 'fixed' : 'calculated';
      updateVisibility();
      updatePreview();
    });
  });
  const bmrSetting = new Setting(container).setName('BMR (kcal/day)').setDesc('Your basal metabolic rate. Leave blank to turn off the calculated estimate.').addText(text => {
    text.inputEl.setAttribute('aria-label','BMR in kcal per day');
    text.inputEl.setAttribute('inputmode','decimal');
    text.setPlaceholder('Enter your BMR').setValue(bmr).onChange(value => {
      bmr = value;
      updatePreview();
    });
  });
  const factorSetting = new Setting(container).setName('Daily activity factor').setDesc('Includes everyday movement and typical exercise. Common values range from 1.4 (sedentary) to 2.5 (very active). Logged workout calories are shown separately and are not added again.').addText(text => {
    text.inputEl.setAttribute('aria-label','Daily activity factor');
    text.inputEl.setAttribute('inputmode','decimal');
    text.setValue(factor).onChange(value => {
      factor = value;
      updatePreview();
    });
  });
  const fixedSetting = new Setting(container).setName('Fixed TDEE (kcal/day)').setDesc('Your chosen full-day energy target. It stays the same until you change it.').addText(text => {
    text.inputEl.setAttribute('aria-label','Fixed TDEE in kcal per day');
    text.inputEl.setAttribute('inputmode','decimal');
    text.setPlaceholder('Enter your daily target').setValue(fixed).onChange(value => {
      fixed = value;
      updatePreview();
    });
  });
  const updateVisibility = () => {
    bmrSetting.settingEl.hidden = mode === 'fixed';
    factorSetting.settingEl.hidden = mode === 'fixed';
    fixedSetting.settingEl.hidden = mode !== 'fixed';
  };
  updateVisibility();
  const preview = container.createDiv({cls:'tps-health-settings-energy-preview',attr:{role:'status','aria-live':'polite'}});
  updatePreview = () => {
    try {
      const draft = parseEnergySettings(bmr, factor, mode, fixed);
      const model = dailyEnergyEstimate(draft,{dateIso:'',calories:0,entryCount:0});
      preview.setText(model.estimatedBurnKcal == null ? 'Enter a BMR to enable your estimate.' :
        (mode === 'fixed' ? 'Fixed full-day target: ' : 'Estimated full-day burn: ')+formatNativeDailyMacroValue(model.estimatedBurnKcal)+' kcal/day.');
    } catch (error) {
      preview.setText((error as Error).message);
    }
  };
  new Setting(container).addButton(button => button.setButtonText('Save energy settings').setCta().onClick(async () => {
    button.setDisabled(true);
    try { await plugin.saveEnergySettings(bmr,factor,mode,fixed); updatePreview(); }
    catch (error) { preview.setText((error as Error).message); }
    finally { button.setDisabled(false); button.buttonEl.focus(); }
  }));
  container.createEl('p',{text:'Use a tps-health-overview block to compare this full-day target with logged food, macros and activity. Your chosen method applies to every displayed date.',cls:'setting-item-description'});
  updatePreview();
}
