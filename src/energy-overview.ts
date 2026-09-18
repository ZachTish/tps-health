import type { DailyEnergyEstimate } from './energy-estimate';
import { formatNativeDailyMacroValue } from './native-daily-dashboard';

export function energyComparisonText(model: DailyEnergyEstimate): string {
  if (model.estimatedBurnKcal == null) return 'Set your BMR';
  if (model.differenceKcal == null) return 'No food logged';
  const rounded = Math.round(model.differenceKcal * 10) / 10;
  if (rounded === 0) return 'Matches estimate';
  return formatNativeDailyMacroValue(Math.abs(rounded))+' kcal '+(rounded < 0 ? 'below estimate' : 'above estimate');
}

export function renderEnergyOverview(container: HTMLElement, model: DailyEnergyEstimate): void {
  const root=container.createDiv({cls:'tps-health-energy-overview'});
  root.createEl('h3',{text:'Daily energy · '+model.dateIso});
  const cards=root.createEl('dl',{cls:'tps-health-energy-cards'});
  const rows=[
    ['Estimated full-day burn',model.estimatedBurnKcal == null ? 'Not configured' : formatNativeDailyMacroValue(model.estimatedBurnKcal)+' kcal'],
    ['Logged food',model.consumedKcal == null ? 'No food logged' : formatNativeDailyMacroValue(model.consumedKcal)+' kcal'],
    ['Intake compared with burn',energyComparisonText(model)],
  ];
  for(const [label,value] of rows) {
    const card=cards.createDiv({cls:'tps-health-energy-card'});
    card.createEl('dt',{text:label});card.createEl('dd',{text:value});
  }
  if(model.estimatedBurnKcal == null) root.createEl('p',{text:'Set your BMR in Health → Food & goals → Energy estimate to compare intake and burn.'});
  else root.createEl('p',{text:'BMR '+formatNativeDailyMacroValue(model.bmrKcal!)+' × activity factor '+model.activityFactor+' = '+formatNativeDailyMacroValue(model.estimatedBurnKcal)+' kcal/day.'});
  root.createEl('p',{cls:'tps-health-energy-note',text:'Full-day estimate using your current settings, not burn so far. Compares only logged food; incomplete logging changes the comparison. Typical exercise is included in the activity factor, so logged activity below is not added again.'});
}
