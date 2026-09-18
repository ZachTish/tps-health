import { nutritionNumber } from './nutrients';
import type { TPSHealthSettings } from './types';

export type EnergySettings = Pick<TPSHealthSettings, 'energyBmrKcal' | 'energyActivityFactor'>;
export interface DailyEnergyEstimate {
  dateIso: string;
  bmrKcal: number | null;
  activityFactor: number;
  estimatedBurnKcal: number | null;
  consumedKcal: number | null;
  differenceKcal: number | null;
  entryCount: number;
}

/** PAL represents total daily expenditure, including typical exercise. Never add exercise again. */
export function dailyEnergyEstimate(settings: EnergySettings, totals: {dateIso:string;calories:number;entryCount:number}): DailyEnergyEstimate {
  const bmr = nutritionNumber(settings.energyBmrKcal);
  const factor = nutritionNumber(settings.energyActivityFactor);
  const burn = bmr != null && bmr > 0 && factor != null && factor >= 1 ? bmr * factor : NaN;
  const estimatedBurnKcal = Number.isFinite(burn) ? burn : null;
  const consumedKcal = totals.entryCount > 0 ? nutritionNumber(totals.calories) ?? null : null;
  const difference = consumedKcal != null && estimatedBurnKcal != null ? consumedKcal - estimatedBurnKcal : NaN;
  return {
    dateIso:totals.dateIso, bmrKcal:bmr != null && bmr > 0 ? bmr : null,
    activityFactor:settings.energyActivityFactor, estimatedBurnKcal, consumedKcal,
    differenceKcal:Number.isFinite(difference) ? difference : null, entryCount:totals.entryCount,
  };
}
export function parseEnergySettings(bmrInput: string, factorInput: string): EnergySettings {
  const bmr = bmrInput.trim() ? nutritionNumber(bmrInput) : null;
  const factor = nutritionNumber(factorInput);
  if (bmr === undefined || (bmr !== null && bmr <= 0)) throw new Error('Enter a positive BMR in kcal/day, or leave it blank.');
  if (factor == null || factor < 1) throw new Error('Enter a daily activity factor of at least 1.');
  if (bmr != null && !Number.isFinite(bmr * factor)) throw new Error('The resulting estimate must be a finite number.');
  return {energyBmrKcal:bmr,energyActivityFactor:factor};
}
