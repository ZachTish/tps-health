import { nutritionNumber } from './nutrients';
import { DEFAULT_SETTINGS, type TPSHealthSettings } from './types';

/** Matches the bounded energy value accepted by the TishOS Daily Fitness widget. */
export const MAX_DAILY_ENERGY_KCAL = 1_000_000_000;

export type EnergySettings = Pick<TPSHealthSettings, 'energyBmrKcal' | 'energyActivityFactor'> &
  Partial<Pick<TPSHealthSettings, 'energyEstimateMode' | 'energyFixedTdeeKcal'>>;
export interface DailyEnergyEstimate {
  dateIso: string;
  mode: 'calculated' | 'fixed';
  bmrKcal: number | null;
  activityFactor: number;
  fixedTdeeKcal: number | null;
  estimatedBurnKcal: number | null;
  consumedKcal: number | null;
  differenceKcal: number | null;
  entryCount: number;
}

/** PAL represents total daily expenditure, including typical exercise. Never add exercise again. */
export function dailyEnergyEstimate(settings: EnergySettings, totals: {dateIso:string;calories:number;entryCount:number}): DailyEnergyEstimate {
  const bmr = nutritionNumber(settings.energyBmrKcal);
  const factor = nutritionNumber(settings.energyActivityFactor);
  const mode = settings.energyEstimateMode === 'fixed' ? 'fixed' : 'calculated';
  const fixed = nutritionNumber(settings.energyFixedTdeeKcal);
  const fixedTdeeKcal = fixed != null && fixed > 0 && fixed <= MAX_DAILY_ENERGY_KCAL ? fixed : null;
  const calculated = bmr != null && bmr > 0 && factor != null && factor >= 1 ? bmr * factor : NaN;
  const burn = mode === 'fixed' ? fixedTdeeKcal : calculated;
  const estimatedBurnKcal = burn != null && Number.isFinite(burn) && burn > 0 && burn <= MAX_DAILY_ENERGY_KCAL ? burn : null;
  const consumedKcal = totals.entryCount > 0 ? nutritionNumber(totals.calories) ?? null : null;
  const difference = consumedKcal != null && estimatedBurnKcal != null ? consumedKcal - estimatedBurnKcal : NaN;
  return {
    dateIso:totals.dateIso, mode, bmrKcal:bmr != null && bmr > 0 ? bmr : null,
    activityFactor:settings.energyActivityFactor, fixedTdeeKcal, estimatedBurnKcal, consumedKcal,
    differenceKcal:Number.isFinite(difference) ? difference : null, entryCount:totals.entryCount,
  };
}
export function parseEnergySettings(bmrInput: string, factorInput: string,
  mode: 'calculated' | 'fixed' = 'calculated', fixedInput = ''): EnergySettings {
  if (mode !== 'calculated' && mode !== 'fixed') throw new Error('Choose calculated or fixed TDEE.');
  const parsedBmr = bmrInput.trim() ? nutritionNumber(bmrInput) : null;
  const parsedFactor = nutritionNumber(factorInput);
  const fixed = fixedInput.trim() ? nutritionNumber(fixedInput) : null;
  if (mode === 'calculated') {
    if (parsedBmr === undefined || (parsedBmr !== null && parsedBmr <= 0)) throw new Error('Enter a positive BMR in kcal/day, or leave it blank.');
    if (parsedFactor == null || parsedFactor < 1) throw new Error('Enter a daily activity factor of at least 1.');
    if (parsedBmr != null && parsedBmr * parsedFactor > MAX_DAILY_ENERGY_KCAL) throw new Error('The calculated TDEE is too large.');
  }
  if (mode === 'fixed' && (fixed == null || fixed <= 0 || fixed > MAX_DAILY_ENERGY_KCAL))
    throw new Error('Enter a positive fixed TDEE of at most 1,000,000,000 kcal/day.');
  const bmr = parsedBmr != null && parsedBmr > 0 && parsedFactor != null && parsedFactor >= 1 && parsedBmr * parsedFactor <= MAX_DAILY_ENERGY_KCAL ? parsedBmr : null;
  const factor = parsedFactor != null && parsedFactor >= 1 ? parsedFactor : DEFAULT_SETTINGS.energyActivityFactor;
  const fixedTdeeKcal = fixed != null && fixed > 0 && fixed <= MAX_DAILY_ENERGY_KCAL ? fixed : null;
  return {energyBmrKcal:bmr,energyActivityFactor:factor,energyEstimateMode:mode,energyFixedTdeeKcal:fixedTdeeKcal};
}
