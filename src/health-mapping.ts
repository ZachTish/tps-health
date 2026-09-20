import { migrateWorkoutTiming } from './workout-timing-migration';
import type { TPSHealthSettings } from './types';
import { DEFAULT_HEALTH_NATIVE_RECORD_KINDS, DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES, configuredNativePropertyKey, HEALTH_NATIVE_RECORD_KIND_KEYS, HEALTH_NATIVE_RECORD_PROPERTY_KEYS } from './native-record-schema';

export type LibraryKind = 'workout-plan' | 'exercise';
export function libraryIdentity(settings: TPSHealthSettings, kind: LibraryKind): { key: string; value: string } {
  return { key: settings.workoutFrontmatterKey || 'kind', value: (kind === 'exercise' ? settings.exerciseFrontmatterValue : settings.workoutPlanFrontmatterValue) || kind };
}
export function matchesLibraryIdentity(settings: TPSHealthSettings, fm: Record<string, unknown>, kind: LibraryKind): boolean {
  const identity = libraryIdentity(settings, kind);
  return fm[identity.key] === identity.value;
}
export function applyLibraryIdentity(settings: TPSHealthSettings, fm: Record<string, unknown>, kind: LibraryKind): void {
  const identity = libraryIdentity(settings, kind);
  // Template-owned default identifiers are replaced, never retained as alternate identities.
  if (identity.key !== 'kind' && (fm.kind === kind || fm.kind === identity.value)) delete fm.kind;
  if (fm.tpsType === `health-${kind}` || (kind === 'workout-plan' && fm.tpsType === 'health-routine')) delete fm.tpsType;
  fm[identity.key] = identity.value;
}

export const HEALTH_MAPPING_KEYS = ['workoutStartPropertyKey', 'workoutIntervalPropertyKey', 'workoutIntervalMode', 'foodFrontmatterKey', 'foodFrontmatterFoodValue', 'foodFrontmatterRecipeValue', 'foodFrontmatterMealValue', 'workoutFrontmatterKey', 'workoutPlanFrontmatterValue', 'exerciseFrontmatterValue', 'nativeRecordKinds', 'nativeRecordProperties', 'nativeRecordKindAliases', 'nativeRecordPropertyAliases'] as const;
export function mappingSnapshot(settings: TPSHealthSettings): string {
  return JSON.stringify(HEALTH_MAPPING_KEYS.map(key => settings[key]));
}

function move(fm: Record<string, unknown>, source: string, target: string, value: unknown): void {
  if (source !== target && Object.prototype.hasOwnProperty.call(fm, target) && JSON.stringify(fm[target]) !== JSON.stringify(value)) {
    throw new Error(`Property “${target}” already contains a different value.`);
  }
  if (source !== target) delete fm[source];
  fm[target] = value;
}

/** Historical identifiers are consulted only while building an explicitly confirmed migration. */
export function migrateHealthFrontmatter(
  frontmatter: Record<string, unknown>, before: TPSHealthSettings, after: TPSHealthSettings,
  native: { kind: string; kindKey: string } | null,
): Record<string, unknown> {
  const fm = structuredClone(frontmatter);
  if (native) {
    const kinds = HEALTH_NATIVE_RECORD_KIND_KEYS.filter(key => [before.nativeRecordKinds[key], DEFAULT_HEALTH_NATIVE_RECORD_KINDS[key], ...(before.nativeRecordKindAliases[key] || [])].includes(native.kind));
    if (kinds.length > 1) throw new Error('The record matches more than one previous Health kind.');
    if (kinds.length) {
      const kind = kinds[0];
      const physicalKindKey = Object.keys(fm).find(key => key.toLowerCase() === native.kindKey.toLowerCase());
      if (!physicalKindKey) throw new Error('Migrate the shared record key in GCM before changing Health mappings.');
      move(fm, physicalKindKey, native.kindKey, after.nativeRecordKinds[kind]);
      if (kind === 'workoutSession') {
        const timed = migrateWorkoutTiming(fm, before, after);
        for (const key of Object.keys(fm)) delete fm[key];
        Object.assign(fm, timed);
      }
      // Read all sources from the original so remaps cannot cascade into another field.
      for (const key of HEALTH_NATIVE_RECORD_PROPERTY_KEYS) {
        if (kind === 'workoutSession' && ['startedAt', 'durationMinutes', 'completedDate'].includes(key)) continue;
        const sources = [...new Set([configuredNativePropertyKey(before, key), DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES[key], ...(before.nativeRecordPropertyAliases[key] || [])])].filter(source => Object.prototype.hasOwnProperty.call(frontmatter, source));
        if (!sources.length) continue;
        const value = frontmatter[sources[0]];
        if (sources.some(source => JSON.stringify(frontmatter[source]) !== JSON.stringify(value))) throw new Error(`Conflicting previous values for “${key}”.`);
        const target = configuredNativePropertyKey(after, key);
        for (const source of sources) move(fm, source, target, value);
      }
      return fm;
    }
  }
  if (!native && frontmatter.runKind === 'run' && frontmatter.runType === 'workout') return migrateWorkoutTiming(fm, before, after);
  const identities: Array<{ sources: Array<[string, string]>; target: { key: string; value: string } }> = [];
  for (const [kind, setting] of [['food', 'foodFrontmatterFoodValue'], ['recipe', 'foodFrontmatterRecipeValue'], ['meal', 'foodFrontmatterMealValue']] as const) {
    identities.push({ sources: [[before.foodFrontmatterKey, before[setting]], ['kind', kind], ['tpsType', `health-${kind}`]], target: { key: after.foodFrontmatterKey, value: after[setting] } });
  }
  for (const kind of ['workout-plan', 'exercise'] as const) {
    const old = libraryIdentity(before, kind);
    identities.push({ sources: [[old.key, old.value], ['kind', kind], ['tpsType', `health-${kind}`], ...(kind === 'workout-plan' ? [['tpsType', 'health-routine'] as [string,string]] : [])], target: libraryIdentity(after, kind) });
  }
  const matches = identities.filter(identity => identity.sources.some(([key, value]) => frontmatter[key] === value));
  if (matches.length > 1) throw new Error('This note has conflicting Health identities.');
  if (matches.length) {
    const { sources, target } = matches[0];
    for (const [key, value] of sources) if (fm[key] === value) move(fm, key, target.key, target.value);
  }
  return fm;
}
