import type { HealthGoal, TPSHealthSettings } from './types';
import { canonicalGoalKey, trackedFoodNutrientKeys } from './nutrient-goals';
import { configuredNativePropertyKey } from './native-record-schema';

export const HEALTH_GOALS_BASE = 'Health Goals.base';
export const FOOD_GOALS_BASE = 'Food & Goals.base';
const quoted = JSON.stringify;
const property = (key: string) => `note[${quoted(key)}]`;

/** Native summaries receive actual numbers and the goal row's link in the SAME query.
 * The link label depends on the goal bounds, so editing them invalidates the value
 * and its summary. No linked-file-only refresh assumption or copied target fields.
 */
export function goalComparisonSummary(expectedUnit = ""): string {
  const goals = 'values.filter(value.isType("link"))';
  const fields = `${goals}[0].asFile().properties`;
  const low = `${fields}.goalMinimum`, high = `${fields}.goalMaximum`;
  const sum = 'values.filter(value.isType("number")).reduce(acc + value, 0)';
  const known = 'if(values.contains("Unknown"), "known ", "")';
  const actual = `${known} + (${sum}).round(2)`;
  const target = `if(${low}.isType("number") && ${high}.isType("number"), ${low} + "–" + ${high}, if(${low}.isType("number"), "≥ " + ${low}, if(${high}.isType("number"), "≤ " + ${high}, "track only")))`;
  const remaining = `if(values.contains("Unknown"), " · incomplete", if(${low}.isType("number") && ${sum} < ${low}, " · " + (${low} - ${sum}).round(2) + " below minimum", if(${high}.isType("number") && ${sum} > ${high}, " · " + (${sum} - ${high}).round(2) + " over maximum", if(${high}.isType("number"), " · " + (${high} - ${sum}).round(2) + " remaining", if(${low}.isType("number"), " · goal met", "")))))`;
  const validBound = (bound: string) => `(${bound} == null || (${bound}.isType("number") && ${bound} >= 0))`;
  const valid = `${expectedUnit ? `${fields}.goalUnit == ${quoted(expectedUnit)} && ` : ""}${validBound(low)} && ${validBound(high)} && (${low} == null || ${high} == null || ${low} <= ${high})`;
  return `if(${goals}.length > 1, "Duplicate goals — disable one", if(${goals}.length == 0, ${actual} + " · no goal", if(!(${valid}), "Invalid goal", ${actual} + " / " + ${target} + " " + ${fields}.goalUnit + ${remaining})))`;
}

export function healthGoalsBaseDefinition(): Record<string, unknown> {
  return {
    filters: {and: ['file.ext == "md"', '!healthGoal.isEmpty()']},
    properties: {'note.healthGoal': {displayName: 'Metric'}, 'note.goalMinimum': {displayName: 'Daily minimum'}, 'note.goalMaximum': {displayName: 'Daily maximum'}, 'note.goalUnit': {displayName: 'Unit'}, 'note.goalEnabled': {displayName: 'Enabled (blank = yes)'}},
    views: [{type: 'table', name: 'Goals', order: ['file.name', 'note.goalLabel', 'note.healthGoal', 'note.goalMinimum', 'note.goalMaximum', 'note.goalUnit', 'note.goalEnabled']}],
  };
}

export function foodGoalsBaseDefinition(settings: TPSHealthSettings, goals: HealthGoal[], foodFilter: string): Record<string, unknown> {
  const formulas: Record<string, string> = {};
  const properties: Record<string, unknown> = {};
  const summaries: Record<string, string> = {};
  const summaryDefinitions: Record<string, string> = {};
  const core: string[] = [], all: string[] = [];
  for (const goal of goals) {
    const metric = canonicalGoalKey(goal.propertyKey);
    const nutrient = [...trackedFoodNutrientKeys([goal])][0];
    if (!nutrient) continue; // Activity/other saved metrics remain editable in Health Goals.
    const name = metric;
    const physical = configuredNativePropertyKey(settings, nutrient as any);
    const field = property(physical);
    const label = 'goalLabel + " · " + if(goalMinimum != null, "≥ " + goalMinimum + " ", "") + if(goalMaximum != null, "≤ " + goalMaximum + " ", "") + goalUnit';
    formulas[name] = `if(!healthGoal.isEmpty(), if(healthGoal == ${quoted(metric)}, link(file.path, ${label}), null), if(${field}.isType("number") && ${field} >= 0, ${field}, "Unknown"))`;
    const key = 'formula.' + name;
    properties[key] = {displayName: goal.label + ' (' + goal.unit + ')'};
    const summaryName = 'Goal comparison (' + goal.unit + ')';
    summaries[key] = summaryName;
    summaryDefinitions[summaryName] = goalComparisonSummary(goal.unit);
    all.push(key);
    if (['consumedCalories', 'protein', 'carbs', 'fat'].includes(metric)) core.push(key);
  }
  const date = property(configuredNativePropertyKey(settings, 'completedDate'));
  return {
    filters: {and: ['file.ext == "md"', 'goalEnabled != false', `${property(configuredNativePropertyKey(settings, 'archived'))} != true`, {or: [`${quoted(Object.keys(formulas))}.contains(healthGoal)`, {and: [foodFilter, `${date} != null`, `date(${date}.toString()).date() == today()`]}]}]},
    formulas, properties, summaries: summaryDefinitions,
    views: [
      {type: 'table', name: 'Today', order: ['file.name', ...(core.length ? core : all)], summaries},
      {type: 'table', name: 'All tracked nutrients today', order: ['file.name', ...all], summaries},
    ],
  };
}
