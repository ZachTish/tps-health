import { Setting } from 'obsidian';
import type TPSHealthPlugin from './main';
import { dailyEnergyEstimate, parseEnergySettings } from './energy-estimate';
import type { EnergyActivitySettings } from './energy-activity';
import { formatNativeDailyMacroValue } from './native-daily-dashboard';

export function renderEnergySettings(container: HTMLElement, plugin: TPSHealthPlugin): void {
  container.addClass('tps-health-settings-energy-controls');
  let mode = plugin.settings.energyEstimateMode;
  let bmr = plugin.settings.energyBmrKcal == null ? '' : String(plugin.settings.energyBmrKcal);
  let factor = String(plugin.settings.energyActivityFactor);
  let fixed = plugin.settings.energyFixedTdeeKcal == null ? '' : String(plugin.settings.energyFixedTdeeKcal);
  const activitySettings: EnergyActivitySettings = {
    energyActivityIdentificationMode:plugin.settings.energyActivityIdentificationMode,
    energyActivityPropertyKey:plugin.settings.energyActivityPropertyKey,
    energyActivityPropertyValue:plugin.settings.energyActivityPropertyValue,
    energyActivityTag:plugin.settings.energyActivityTag,
    energyActivityCaloriesPropertyKey:plugin.settings.energyActivityCaloriesPropertyKey,
    energyActivityDatePropertyKey:plugin.settings.energyActivityDatePropertyKey,
  };
  let updatePreview = () => {};
  new Setting(container).setName('TDEE method').setDesc('Use a fixed daily target, a BMR activity multiplier, or BMR plus the activity calories recorded for each day.').addDropdown(dropdown => {
    dropdown.addOption('calculated','Calculated').addOption('fixed','Fixed').addOption('activity-notes','BMR + activity notes');
    dropdown.setValue(mode).onChange(value => {
      mode = value === 'fixed' || value === 'activity-notes' ? value : 'calculated';
      updateVisibility();
      updatePreview();
    });
  });
  const bmrSetting = new Setting(container).setName('BMR (kcal/day)').setDesc('Your basal metabolic rate. Leave blank to turn off the estimate.').addText(text => {
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
  const sourceSetting = new Setting(container).setName('Identify activity notes by').setDesc('Read matching notes without changing them. Select individual activities or daily summaries; matching both can count the same activity twice.').addDropdown(dropdown => {
    dropdown.addOption('property','Property value').addOption('tag','Tag').setValue(activitySettings.energyActivityIdentificationMode).onChange(value => {
      activitySettings.energyActivityIdentificationMode = value === 'tag' ? 'tag' : 'property';
      updateVisibility();
      updatePreview();
    });
  });
  const propertySetting = new Setting(container).setName('Activity property').setDesc('The frontmatter key used to identify activity notes.').addText(text => {
    text.inputEl.setAttribute('aria-label','Activity identification property');
    text.setPlaceholder('kind').setValue(activitySettings.energyActivityPropertyKey).onChange(value => {
      activitySettings.energyActivityPropertyKey = value;
      updatePreview();
    });
  });
  const valueSetting = new Setting(container).setName('Activity property value').setDesc('Matches this exact value in a scalar or list property.').addText(text => {
    text.inputEl.setAttribute('aria-label','Activity identification property value');
    text.setPlaceholder('Enter the matching value').setValue(activitySettings.energyActivityPropertyValue).onChange(value => {
      activitySettings.energyActivityPropertyValue = value;
      updatePreview();
    });
  });
  const tagSetting = new Setting(container).setName('Activity tag').setDesc('Matches this tag and its nested tags. A leading # is optional.').addText(text => {
    text.inputEl.setAttribute('aria-label','Activity identification tag');
    text.setPlaceholder('Enter the matching tag').setValue(activitySettings.energyActivityTag).onChange(value => {
      activitySettings.energyActivityTag = value;
      updatePreview();
    });
  });
  const caloriesSetting = new Setting(container).setName('Activity calories property').setDesc('Numeric activity calories in kcal. Use active calories rather than total daily burn, because BMR is added separately.').addText(text => {
    text.inputEl.setAttribute('aria-label','Activity calories burned property');
    text.setPlaceholder('caloriesBurned').setValue(activitySettings.energyActivityCaloriesPropertyKey).onChange(value => {
      activitySettings.energyActivityCaloriesPropertyKey = value;
      updatePreview();
    });
  });
  const dateSetting = new Setting(container).setName('Activity date property').setDesc('Date or datetime that assigns activity to a day. Datetimes use your local timezone.').addText(text => {
    text.inputEl.setAttribute('aria-label','Activity date property');
    text.setPlaceholder('completedDate').setValue(activitySettings.energyActivityDatePropertyKey).onChange(value => {
      activitySettings.energyActivityDatePropertyKey = value;
      updatePreview();
    });
  });
  const updateVisibility = () => {
    bmrSetting.settingEl.hidden = mode === 'fixed';
    factorSetting.settingEl.hidden = mode !== 'calculated';
    fixedSetting.settingEl.hidden = mode !== 'fixed';
    const activityMode = mode === 'activity-notes';
    sourceSetting.settingEl.hidden = !activityMode;
    propertySetting.settingEl.hidden = !activityMode || activitySettings.energyActivityIdentificationMode !== 'property';
    valueSetting.settingEl.hidden = propertySetting.settingEl.hidden;
    tagSetting.settingEl.hidden = !activityMode || activitySettings.energyActivityIdentificationMode !== 'tag';
    caloriesSetting.settingEl.hidden = !activityMode;
    dateSetting.settingEl.hidden = !activityMode;
  };
  updateVisibility();
  const preview = container.createDiv({cls:'tps-health-settings-energy-preview',attr:{role:'status','aria-live':'polite'}});
  updatePreview = () => {
    try {
      const draft = parseEnergySettings(bmr, factor, mode, fixed, activitySettings);
      const model = dailyEnergyEstimate(draft,{dateIso:'',calories:0,entryCount:0},{dateIso:'',caloriesBurned:0,entryCount:0});
      preview.setText(model.estimatedBurnKcal == null ? 'Enter a BMR to enable your estimate.' : mode === 'activity-notes'
        ? 'BMR baseline: '+formatNativeDailyMacroValue(model.bmrKcal!)+' kcal/day. Logged activity calories are added for each displayed day.'
        : (mode === 'fixed' ? 'Fixed full-day target: ' : 'Estimated full-day burn: ')+formatNativeDailyMacroValue(model.estimatedBurnKcal)+' kcal/day.');
    } catch (error) {
      preview.setText((error as Error).message);
    }
  };
  new Setting(container).addButton(button => button.setButtonText('Save energy settings').setCta().onClick(async () => {
    button.setDisabled(true);
    try { await plugin.saveEnergySettings(bmr,factor,mode,fixed,activitySettings); updatePreview(); }
    catch (error) { preview.setText((error as Error).message); }
    finally { button.setDisabled(false); button.buttonEl.focus(); }
  }));
  container.createEl('p',{text:'Use a tps-health-overview block to compare the estimate with logged food, macros and activity. Your chosen method applies to every displayed date.',cls:'setting-item-description'});
  updatePreview();
}
