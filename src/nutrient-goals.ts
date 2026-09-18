import { EXTRA_NUTRIENTS, nutritionNumber } from './nutrients';
import type { HealthGoal, TPSHealthSettings } from './types';

export interface GoalNutrient { key: string; label: string; unit: string; group: string; archived?: boolean }
const CORE: GoalNutrient[] = [
  {key:'consumedCalories',label:'Calories',unit:'kcal',group:'Energy & macros'},
  {key:'protein',label:'Protein',unit:'g',group:'Energy & macros'},
  {key:'carbs',label:'Carbohydrates',unit:'g',group:'Energy & macros'},
  {key:'fat',label:'Fat',unit:'g',group:'Energy & macros'},
  {key:'fiber',label:'Fiber',unit:'g',group:'Carbohydrates'},
  {key:'sugar',label:'Sugar',unit:'g',group:'Carbohydrates'},
  {key:'sugarAlcohol',label:'Sugar alcohol',unit:'g',group:'Carbohydrates'},
  {key:'alcohol',label:'Alcohol',unit:'g',group:'Other nutrients'},
  {key:'sodium',label:'Sodium',unit:'mg',group:'Minerals'},
];
export const canonicalGoalKey = (key: string): string => key === 'cal' ? 'consumedCalories' : key;

/** Include saved legacy metrics so the editor never strands an existing goal. */
export function goalNutrients(goals: readonly HealthGoal[] = []): GoalNutrient[] {
  const catalog = [...CORE, ...EXTRA_NUTRIENTS.map(({key,label,unit,group,archived}) => ({key,label,unit,group,archived}))];
  for (const goal of goals) if (goal.propertyKey !== 'activity' && !catalog.some(n => n.key === canonicalGoalKey(goal.propertyKey)))
    catalog.push({key:goal.propertyKey,label:goal.label,unit:goal.unit,group:'Other saved goals'});
  return catalog;
}
export function filterGoalNutrients(catalog: GoalNutrient[], query: string, group: string): GoalNutrient[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.filter(n => (!group || n.group === group) && words.every(word =>
    (n.label+' '+n.unit+' '+n.group).toLocaleLowerCase().includes(word)));
}
export function findNutrientGoal(goals: readonly HealthGoal[], key: string): HealthGoal | undefined {
  return goals.find(g => canonicalGoalKey(g.propertyKey) === canonicalGoalKey(key));
}
function bound(raw: string, label: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = nutritionNumber(raw);
  if (value == null) throw new Error(label+' must be a finite number of zero or more.');
  return value;
}
export function nutrientGoalChange(settings: TPSHealthSettings, key: string, minimum: string, maximum: string, remove = false): Pick<TPSHealthSettings,'healthGoals'|'calorieGoal'|'proteinGoalG'> {
  const nutrient = goalNutrients(settings.healthGoals).find(n => n.key === canonicalGoalKey(key));
  if (!nutrient) throw new Error('Select an available nutrient.');
  const previous = findNutrientGoal(settings.healthGoals, key);
  const canonical = nutrient.key;
  const min = remove ? undefined : bound(minimum, 'Minimum');
  const max = remove ? undefined : bound(maximum, 'Maximum');
  if (min != null && max != null && min > max) throw new Error('Minimum cannot exceed maximum.');
  if (canonical === 'consumedCalories' && (max == null || max <= 0)) throw new Error('Calories need a positive maximum target.');
  if (canonical === 'protein' && (min == null || min <= 0)) throw new Error('Protein needs a positive minimum target.');
  const next: HealthGoal = {
    ...previous, propertyKey: previous?.propertyKey || canonical, label: previous?.label || nutrient.label,
    unit: nutrient.unit, kind: min != null && max != null ? 'range' : min != null ? 'min' : max != null ? 'max' : 'counter',
    min, max,
  };
  const goals = settings.healthGoals.filter(g => canonicalGoalKey(g.propertyKey) !== canonical);
  const index = previous ? settings.healthGoals.indexOf(previous) : goals.length;
  if (!remove) goals.splice(Math.min(index, goals.length), 0, next);
  return {
    healthGoals: goals,
    calorieGoal: canonical === 'consumedCalories' ? max! : settings.calorieGoal,
    proteinGoalG: canonical === 'protein' ? min! : settings.proteinGoalG,
  };
}
