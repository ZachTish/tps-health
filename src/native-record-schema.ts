import type {
  HealthNativeRecordKindKey,
  HealthNativeRecordPropertyKey,
  TPSHealthSettings,
} from "./types";

export const DEFAULT_HEALTH_NATIVE_RECORD_KINDS: Record<HealthNativeRecordKindKey, string> = {
  foodEntry: "food-entry",
  activityEntry: "activity-entry",
  workoutSession: "workout-session",
  workoutExercise: "workout-exercise",
};

export const DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES: Record<HealthNativeRecordPropertyKey, string> = {
  completedDate: "completedDate",
  food: "food",
  quantity: "quantity",
  unit: "unit",
  calories: "calories",
  proteinG: "proteinG",
  carbsG: "carbsG",
  fatG: "fatG",
  fiberG: "fiberG",
  sugarG: "sugarG",
  sugarAlcoholG: "sugarAlcoholG",
  alcoholG: "alcoholG",
  sodiumMg: "sodiumMg",
  note: "note",
  activityType: "activityType",
  startedAt: "startedAt",
  durationMinutes: "durationMinutes",
  distance: "distance",
  distanceUnit: "distanceUnit",
  steps: "steps",
  caloriesBurned: "caloriesBurned",
  source: "source",
  device: "device",
  status: "status",
  workoutPlan: "workoutPlan",
  session: "session",
  archived: "archived",
  archivedDate: "archivedDate",
};

export const HEALTH_NATIVE_RECORD_KIND_KEYS = Object.freeze(
  Object.keys(DEFAULT_HEALTH_NATIVE_RECORD_KINDS) as HealthNativeRecordKindKey[],
);

export const HEALTH_NATIVE_RECORD_PROPERTY_KEYS = Object.freeze(
  Object.keys(DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES) as HealthNativeRecordPropertyKey[],
);

const RESERVED_NATIVE_ENVELOPE_KEYS = new Set([
  "tpsid", "tpsschemaversion", "kind", "title", "createddate", "modifieddate", "tags", "cssclasses",
]);

export type CanonicalHealthNativeKind = "food-entry" | "activity-entry" | "workout-session" | "workout-exercise";

const CANONICAL_KIND_BY_SETTING: Record<HealthNativeRecordKindKey, CanonicalHealthNativeKind> = {
  foodEntry: "food-entry",
  activityEntry: "activity-entry",
  workoutSession: "workout-session",
  workoutExercise: "workout-exercise",
};

export function isValidFrontmatterPropertyKey(value: unknown): boolean {
  const key = String(value || "").trim();
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(key)
    && !RESERVED_NATIVE_ENVELOPE_KEYS.has(key.toLocaleLowerCase());
}

export function isValidNativeRecordKindValue(value: unknown): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(String(value || "").trim());
}

export function configuredNativeKind(
  settings: Pick<TPSHealthSettings, "nativeRecordKinds">,
  canonical: CanonicalHealthNativeKind,
): string {
  const settingKey = HEALTH_NATIVE_RECORD_KIND_KEYS.find((key) => CANONICAL_KIND_BY_SETTING[key] === canonical)!;
  const configured = String(settings.nativeRecordKinds?.[settingKey] || "").trim();
  return isValidNativeRecordKindValue(configured) ? configured : DEFAULT_HEALTH_NATIVE_RECORD_KINDS[settingKey];
}

export function readableNativeKinds(
  settings: Pick<TPSHealthSettings, "nativeRecordKinds" | "nativeRecordKindAliases">,
  canonical: CanonicalHealthNativeKind,
): string[] {
  const settingKey = HEALTH_NATIVE_RECORD_KIND_KEYS.find((key) => CANONICAL_KIND_BY_SETTING[key] === canonical)!;
  return Array.from(new Set([
    configuredNativeKind(settings, canonical),
    DEFAULT_HEALTH_NATIVE_RECORD_KINDS[settingKey],
    ...(settings.nativeRecordKindAliases?.[settingKey] || []),
  ].map((value) => String(value || "").trim()).filter(isValidNativeRecordKindValue)));
}

export function canonicalNativeKind(
  settings: Pick<TPSHealthSettings, "nativeRecordKinds" | "nativeRecordKindAliases">,
  value: unknown,
): CanonicalHealthNativeKind | null {
  const raw = String(value || "").trim().toLocaleLowerCase();
  if (!raw) return null;
  for (const key of HEALTH_NATIVE_RECORD_KIND_KEYS) {
    const candidates = [
      settings.nativeRecordKinds?.[key],
      DEFAULT_HEALTH_NATIVE_RECORD_KINDS[key],
      ...(settings.nativeRecordKindAliases?.[key] || []),
    ].map((candidate) => String(candidate || "").trim().toLocaleLowerCase()).filter(Boolean);
    if (candidates.includes(raw)) return CANONICAL_KIND_BY_SETTING[key];
  }
  return null;
}

export function configuredNativePropertyKey(
  settings: Pick<TPSHealthSettings, "nativeRecordProperties">,
  canonicalKey: HealthNativeRecordPropertyKey,
): string {
  const configured = String(settings.nativeRecordProperties?.[canonicalKey] || "").trim();
  return isValidFrontmatterPropertyKey(configured)
    ? configured
    : DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES[canonicalKey];
}

export function encodeNativeRecordProperties(
  settings: Pick<TPSHealthSettings, "nativeRecordProperties" | "nativeRecordPropertyAliases">,
  properties: Record<string, unknown>,
  clearAliases = false,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const canonicalKey = key as HealthNativeRecordPropertyKey;
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES, canonicalKey)) {
      mapped[key] = value;
      continue;
    }
    const configuredKey = configuredNativePropertyKey(settings, canonicalKey);
    mapped[configuredKey] = value;
    if (!clearAliases) continue;
    for (const alias of [
      DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES[canonicalKey],
      ...(settings.nativeRecordPropertyAliases?.[canonicalKey] || []),
    ]) {
      if (alias.toLocaleLowerCase() !== configuredKey.toLocaleLowerCase()) mapped[alias] = null;
    }
  }
  return mapped;
}

export function decodeNativeRecordFrontmatter(
  settings: Pick<TPSHealthSettings, "nativeRecordProperties" | "nativeRecordPropertyAliases">,
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const decoded = { ...frontmatter };
  for (const canonicalKey of HEALTH_NATIVE_RECORD_PROPERTY_KEYS) {
    const candidates = [
      configuredNativePropertyKey(settings, canonicalKey),
      DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES[canonicalKey],
      ...(settings.nativeRecordPropertyAliases?.[canonicalKey] || []),
    ];
    const sourceKey = candidates.find((key) => Object.prototype.hasOwnProperty.call(frontmatter, key));
    if (sourceKey) decoded[canonicalKey] = frontmatter[sourceKey];
  }
  return decoded;
}

export function hasCustomNativeKindValues(settings: Pick<TPSHealthSettings, "nativeRecordKinds">): boolean {
  return HEALTH_NATIVE_RECORD_KIND_KEYS.some((key) => (
    configuredNativeKind(settings, CANONICAL_KIND_BY_SETTING[key]) !== DEFAULT_HEALTH_NATIVE_RECORD_KINDS[key]
  ));
}
