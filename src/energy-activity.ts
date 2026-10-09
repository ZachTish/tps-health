import { isoDateKey } from './format';
import { normalizeFoodLogTags } from './food-log-tags';
import { nutritionNumber } from './nutrients';
import type { TPSHealthSettings } from './types';

export type EnergyActivitySettings = Pick<TPSHealthSettings,
  'energyActivityIdentificationMode' | 'energyActivityPropertyKey' | 'energyActivityPropertyValue'
  | 'energyActivityTag' | 'energyActivityCaloriesPropertyKey' | 'energyActivityDatePropertyKey'>;

export interface EnergyActivityProjection {
  dateIso: string;
  caloriesBurned: number;
}

export function energyActivitySourceSignature(settings: EnergyActivitySettings & Pick<TPSHealthSettings, 'energyEstimateMode'>): string {
  return settings.energyEstimateMode !== 'activity-notes' ? '' : JSON.stringify([
    settings.energyActivityIdentificationMode, settings.energyActivityPropertyKey, settings.energyActivityPropertyValue,
    settings.energyActivityTag, settings.energyActivityCaloriesPropertyKey, settings.energyActivityDatePropertyKey,
  ]);
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validKey = (value: string): boolean => !!value && !/[\r\n\0]/u.test(value);

/** Read-only selectors may use shared fields such as kind; they never migrate notes. */
export function parseEnergyActivitySettings(input: EnergyActivitySettings): EnergyActivitySettings {
  const settings: EnergyActivitySettings = {
    energyActivityIdentificationMode: input.energyActivityIdentificationMode,
    energyActivityPropertyKey: text(input.energyActivityPropertyKey),
    energyActivityPropertyValue: text(input.energyActivityPropertyValue),
    energyActivityTag: text(input.energyActivityTag).replace(/^#/, ''),
    energyActivityCaloriesPropertyKey: text(input.energyActivityCaloriesPropertyKey),
    energyActivityDatePropertyKey: text(input.energyActivityDatePropertyKey),
  };
  if (settings.energyActivityIdentificationMode === 'property') {
    if (!validKey(settings.energyActivityPropertyKey) || !settings.energyActivityPropertyValue)
      throw new Error('Enter the property key and value that identify activity notes.');
  } else if (settings.energyActivityIdentificationMode === 'tag') {
    const tags = normalizeFoodLogTags(settings.energyActivityTag);
    if (tags.length !== 1 || tags[0] !== settings.energyActivityTag)
      throw new Error('Enter one activity tag. Its nested tags are included.');
  } else throw new Error('Choose property or tag identification for activity notes.');
  if (!validKey(settings.energyActivityCaloriesPropertyKey)) throw new Error('Enter the activity calories property.');
  if (!validKey(settings.energyActivityDatePropertyKey)) throw new Error('Enter the activity date property.');
  return settings;
}

function property(frontmatter: Record<string, unknown>, key: string): unknown {
  if (!validKey(key)) return undefined;
  const matches = Object.keys(frontmatter).filter(name => name.toLowerCase() === key.toLowerCase());
  return matches.length === 1 ? frontmatter[matches[0]] : undefined;
}

function energyDate(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim()
    : value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : '';
  const calendarDate = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/u.test(raw)) return null;
  const day = new Date(calendarDate + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendarDate) return null;
  if (!Number.isFinite(new Date(raw).getTime())) return null;
  return isoDateKey(raw);
}

/** One projection per file, independent of TPS identities and native activity/workout totals. */
export function projectEnergyActivity(
  settings: EnergyActivitySettings & Partial<Pick<TPSHealthSettings, 'nativeRecordProperties'>>,
  frontmatter: Record<string, unknown> | null | undefined,
  inlineTags: string[] = [],
): EnergyActivityProjection | null {
  if (!frontmatter) return null;
  const archivedKey = settings.nativeRecordProperties?.archived;
  if (archivedKey && property(frontmatter, archivedKey) === true) return null;
  if (settings.energyActivityIdentificationMode === 'tag') {
    const wanted = normalizeFoodLogTags(settings.energyActivityTag);
    if (wanted.length !== 1) return null;
    const target = wanted[0].toLowerCase();
    const tags = [...normalizeFoodLogTags(frontmatter.tags), ...normalizeFoodLogTags(inlineTags)];
    if (!tags.some(tag => tag.toLowerCase() === target || tag.toLowerCase().startsWith(target + '/'))) return null;
  } else if (settings.energyActivityIdentificationMode === 'property') {
    const wanted = text(settings.energyActivityPropertyValue);
    if (!wanted) return null;
    const value = property(frontmatter, text(settings.energyActivityPropertyKey));
    const values = Array.isArray(value) ? value : [value];
    if (!values.some(item => ['string', 'number', 'boolean'].includes(typeof item) && String(item).trim() === wanted)) return null;
  } else return null;
  const caloriesBurned = nutritionNumber(property(frontmatter, text(settings.energyActivityCaloriesPropertyKey)));
  const dateIso = energyDate(property(frontmatter, text(settings.energyActivityDatePropertyKey)));
  return caloriesBurned != null && dateIso ? { dateIso, caloriesBurned } : null;
}
