import { nutritionNumber } from './nutrients';
import { parseEnergyActivitySettings, type EnergyActivitySettings } from './energy-activity';
import { DEFAULT_SETTINGS, type EnergyEstimateMode, type TPSHealthSettings } from './types';

/** Matches the bounded energy value accepted by the TishOS Daily Fitness widget. */
export const MAX_DAILY_ENERGY_KCAL = 1_000_000_000;

export type EnergySettings = Pick<TPSHealthSettings, 'energyBmrKcal' | 'energyActivityFactor'> &
  Partial<Pick<TPSHealthSettings, 'energyEstimateMode' | 'energyFixedTdeeKcal'>> & Partial<EnergyActivitySettings>;
export interface DailyEnergyActivity {
  dateIso: string;
  caloriesBurned: number;
  entryCount: number;
}
export interface DailyEnergyEstimate {
  dateIso: string;
  mode: EnergyEstimateMode;
  bmrKcal: number | null;
  activityFactor: number;
  fixedTdeeKcal: number | null;
  activityCaloriesBurned: number | null;
  activityEntryCount: number | null;
  estimatedBurnKcal: number | null;
  consumedKcal: number | null;
  differenceKcal: number | null;
  entryCount: number;
}

/** PAL already includes exercise. Activity-note mode adds only its explicit selected-day projection. */
export function dailyEnergyEstimate(settings: EnergySettings,
  totals: {dateIso:string;calories:number;entryCount:number}, activity?: DailyEnergyActivity | null): DailyEnergyEstimate {
  const rawBmr = nutritionNumber(settings.energyBmrKcal);
  const bmr = rawBmr != null && rawBmr > 0 && rawBmr <= MAX_DAILY_ENERGY_KCAL ? rawBmr : null;
  const factor = nutritionNumber(settings.energyActivityFactor);
  const mode = settings.energyEstimateMode === 'fixed' || settings.energyEstimateMode === 'activity-notes'
    ? settings.energyEstimateMode : 'calculated';
  const fixed = nutritionNumber(settings.energyFixedTdeeKcal);
  const fixedTdeeKcal = fixed != null && fixed > 0 && fixed <= MAX_DAILY_ENERGY_KCAL ? fixed : null;
  const activityCalories = mode === 'activity-notes' && activity?.dateIso === totals.dateIso
    && Number.isInteger(activity.entryCount) && activity.entryCount >= 0
    ? nutritionNumber(activity.caloriesBurned) : undefined;
  const activityCaloriesBurned = activityCalories != null && activityCalories <= MAX_DAILY_ENERGY_KCAL ? activityCalories : null;
  const activityEntryCount = activityCaloriesBurned != null ? activity!.entryCount : null;
  const calculated = bmr != null && factor != null && factor >= 1 ? bmr * factor : NaN;
  const burn = mode === 'fixed' ? fixedTdeeKcal : mode === 'activity-notes'
    ? bmr != null && activityCaloriesBurned != null ? bmr + activityCaloriesBurned : null
    : calculated;
  const estimatedBurnKcal = burn != null && Number.isFinite(burn) && burn > 0 && burn <= MAX_DAILY_ENERGY_KCAL ? burn : null;
  const consumedKcal = totals.entryCount > 0 ? nutritionNumber(totals.calories) ?? null : null;
  const difference = consumedKcal != null && estimatedBurnKcal != null ? consumedKcal - estimatedBurnKcal : NaN;
  return {
    dateIso:totals.dateIso, mode, bmrKcal:bmr, activityFactor:settings.energyActivityFactor,
    fixedTdeeKcal, activityCaloriesBurned, activityEntryCount, estimatedBurnKcal, consumedKcal,
    differenceKcal:Number.isFinite(difference) ? difference : null, entryCount:totals.entryCount,
  };
}
export function parseEnergySettings(bmrInput: string, factorInput: string,
  mode: EnergyEstimateMode = 'calculated', fixedInput = '', activitySettings?: EnergyActivitySettings): EnergySettings {
  if (mode !== 'calculated' && mode !== 'fixed' && mode !== 'activity-notes') throw new Error('Choose calculated, fixed, or BMR + activity notes.');
  const parsedBmr = bmrInput.trim() ? nutritionNumber(bmrInput) : null;
  const parsedFactor = nutritionNumber(factorInput);
  const fixed = fixedInput.trim() ? nutritionNumber(fixedInput) : null;
  if (mode !== 'fixed') {
    if (parsedBmr === undefined || (parsedBmr !== null && (parsedBmr <= 0 || parsedBmr > MAX_DAILY_ENERGY_KCAL))) throw new Error('Enter a positive BMR of at most 1,000,000,000 kcal/day, or leave it blank.');
    if (mode === 'calculated') {
      if (parsedFactor == null || parsedFactor < 1) throw new Error('Enter a daily activity factor of at least 1.');
      if (parsedBmr != null && parsedBmr * parsedFactor > MAX_DAILY_ENERGY_KCAL) throw new Error('The calculated TDEE is too large.');
    }
  }
  if (mode === 'fixed' && (fixed == null || fixed <= 0 || fixed > MAX_DAILY_ENERGY_KCAL))
    throw new Error('Enter a positive fixed TDEE of at most 1,000,000,000 kcal/day.');
  if (mode === 'activity-notes' && !activitySettings) throw new Error('Choose how to identify activity notes.');
  const source: EnergyActivitySettings | undefined = activitySettings ? {
    energyActivityIdentificationMode:activitySettings.energyActivityIdentificationMode,
    energyActivityPropertyKey:activitySettings.energyActivityPropertyKey,
    energyActivityPropertyValue:activitySettings.energyActivityPropertyValue,
    energyActivityTag:activitySettings.energyActivityTag,
    energyActivityCaloriesPropertyKey:activitySettings.energyActivityCaloriesPropertyKey,
    energyActivityDatePropertyKey:activitySettings.energyActivityDatePropertyKey,
  } : undefined;
  const selectedSource = source && mode === 'activity-notes' ? parseEnergyActivitySettings(source) : source;
  const bmr = parsedBmr != null && parsedBmr > 0 && parsedBmr <= MAX_DAILY_ENERGY_KCAL
    && (mode === 'activity-notes' || parsedFactor != null && parsedFactor >= 1 && parsedBmr * parsedFactor <= MAX_DAILY_ENERGY_KCAL) ? parsedBmr : null;
  const factor = parsedFactor != null && parsedFactor >= 1 ? parsedFactor : DEFAULT_SETTINGS.energyActivityFactor;
  const fixedTdeeKcal = fixed != null && fixed > 0 && fixed <= MAX_DAILY_ENERGY_KCAL ? fixed : null;
  return {energyBmrKcal:bmr,energyActivityFactor:factor,energyEstimateMode:mode,energyFixedTdeeKcal:fixedTdeeKcal,
    ...(selectedSource ? {...selectedSource} : {})};
}
