import { BUILT_IN_NUTRIENTS as EXTRA_NUTRIENTS, EXTRA_NUTRIENT_KEYS, isExtraNutrientKey } from "./nutrients";
import type {
  HealthPropertyCatalog,
  HealthPropertyCatalogEntry,
  HealthPropertyCatalogScope,
} from "./api";
import type { HealthGoal, TPSHealthSettings } from "./types";
import type { HealthKindCodec } from "./health-mapping";
import { workoutIntervalMode, workoutIntervalPropertyKey, workoutStartPropertyKey } from "./workout-properties";
import { configuredNativePropertyKey, readableNativeKinds } from "./native-record-schema";
import type { CanonicalHealthNativeKind } from "./native-record-schema";

const FOOD_PROPERTIES: Array<Omit<HealthPropertyCatalogEntry, "scope">> = [
  ...EXTRA_NUTRIENTS.map(n => ({ id: n.key, key: n.key, label: `${n.label} (${n.unit})`, type: "number" as const, icon: "pill" })),
  { id: "brand", key: "brand", label: "Brand", type: "text", icon: "badge" },
  { id: "aliases", key: "aliases", label: "Search aliases", type: "list", listItemType: "text", icon: "search" },
  { id: "barcode", key: "barcode", label: "Barcode", type: "text", icon: "scan-barcode" },
  { id: "serving-amount", key: "servingAmount", label: "Serving amount", type: "number", icon: "scale" },
  { id: "serving-unit", key: "servingUnit", label: "Serving unit", type: "text", icon: "ruler" },
  { id: "serving-grams", key: "servingGrams", label: "Serving grams", type: "number", icon: "weight" },
  { id: "serving-ml", key: "servingMl", label: "Serving milliliters", type: "number", icon: "cup-soda" },
  { id: "calories", key: "calories", label: "Serving calories", type: "number", icon: "flame" },
  { id: "protein", key: "proteinG", label: "Protein", type: "number", icon: "dumbbell" },
  { id: "carbs", key: "carbsG", label: "Carbs", type: "number", icon: "wheat" },
  { id: "fat", key: "fatG", label: "Fat", type: "number", icon: "droplet" },
  { id: "fiber", key: "fiberG", label: "Fiber", type: "number", icon: "sprout" },
  { id: "sugar", key: "sugarG", label: "Sugar", type: "number", icon: "candy" },
  { id: "sugar-alcohol", key: "sugarAlcoholG", label: "Sugar alcohol", type: "number", icon: "candy-off" },
  { id: "alcohol", key: "alcoholG", label: "Alcohol", type: "number", icon: "wine" },
  { id: "sodium", key: "sodiumMg", label: "Sodium", type: "number", icon: "shaker" },
  { id: "ingredients", key: "ingredientStatement", label: "Ingredients", type: "text", icon: "notebook-tabs" },
];

const scoped = (
  id: string,
  key: string,
  label: string,
  type: HealthPropertyCatalogEntry['type'],
  kinds: string[],
  options: Partial<HealthPropertyCatalogEntry> = {},
): HealthPropertyCatalogEntry => ({
  id,
  key,
  label,
  type,
  ...options,
  scope: { mode: 'any', kinds },
});

const NATIVE_RECORD_PROPERTIES: HealthPropertyCatalogEntry[] = [
  ...EXTRA_NUTRIENTS.map(n => scoped(`record-${n.key}`, n.key, `${n.label} (${n.unit})`, "number", ["food-entry"], { icon: "pill" })),
  scoped('record-status', 'status', 'Status', 'selector', ['workout-session'], {
    icon: 'circle-check', options: ['active', 'complete', 'discarded'],
  }),
  scoped('record-completed', 'completedDate', 'Completed', 'datetime', ['food-entry', 'activity-entry'], { icon: 'check-check' }),
  scoped('food-link', 'food', 'Food', 'list', ['food-entry'], { icon: 'utensils', listItemType: 'link' }),
  scoped('food-quantity', 'quantity', 'Consumed quantity', 'number', ['food-entry'], { icon: 'scale' }),
  scoped('food-unit', 'unit', 'Consumed unit', 'text', ['food-entry'], { icon: 'ruler' }),
  scoped('record-calories', 'calories', 'Calculated calories', 'number', ['food-entry'], { icon: 'flame' }),
  scoped('record-protein', 'proteinG', 'Calculated protein', 'number', ['food-entry'], { icon: 'dumbbell' }),
  scoped('record-carbs', 'carbsG', 'Calculated carbs', 'number', ['food-entry'], { icon: 'wheat' }),
  scoped('record-fat', 'fatG', 'Calculated fat', 'number', ['food-entry'], { icon: 'droplet' }),
  scoped('record-fiber', 'fiberG', 'Calculated fiber', 'number', ['food-entry'], { icon: 'sprout' }),
  scoped('record-sugar', 'sugarG', 'Calculated sugar', 'number', ['food-entry'], { icon: 'candy' }),
  scoped('record-sugar-alcohol', 'sugarAlcoholG', 'Calculated sugar alcohol', 'number', ['food-entry'], { icon: 'candy-off' }),
  scoped('record-alcohol', 'alcoholG', 'Calculated alcohol', 'number', ['food-entry'], { icon: 'wine' }),
  scoped('record-sodium', 'sodiumMg', 'Calculated sodium', 'number', ['food-entry'], { icon: 'shaker' }),
  scoped('activity-type', 'activityType', 'Activity type', 'text', ['activity-entry'], { icon: 'list-filter' }),
  scoped('activity-started', 'startedAt', 'Started', 'datetime', ['activity-entry'], { icon: 'play' }),
  scoped('activity-duration', 'durationMinutes', 'Duration', 'number', ['activity-entry'], { icon: 'timer' }),
  scoped('activity-distance', 'distance', 'Distance', 'number', ['activity-entry'], { icon: 'route' }),
  scoped('activity-distance-unit', 'distanceUnit', 'Distance unit', 'text', ['activity-entry'], { icon: 'ruler' }),
  scoped('activity-steps', 'steps', 'Steps', 'number', ['activity-entry'], { icon: 'footprints' }),
  scoped('activity-calories', 'caloriesBurned', 'Calories burned', 'number', ['activity-entry', 'workout-session'], { icon: 'flame' }),
  scoped('workout-plan', 'workoutPlan', 'Workout plan', 'list', ['workout-session'], { icon: 'clipboard-list', listItemType: 'link' }),
  scoped('exercise-primary-muscles', 'primaryMuscles', 'Primary muscles', 'list', ['exercise'], { icon: 'accessibility', listItemType: 'text' }),
  scoped('exercise-equipment', 'equipment', 'Equipment', 'list', ['exercise'], { icon: 'dumbbell', listItemType: 'text' }),
  scoped('exercise-rest', 'defaultRestSeconds', 'Default rest', 'number', ['exercise', 'workout-plan'], { icon: 'timer-reset' }),
  scoped('plan-cooldown', 'cooldownDays', 'Cooldown days', 'number', ['workout-plan'], { icon: 'calendar-clock' }),
];

function nativeRecordProperties(settings: TPSHealthSettings, codec?: HealthKindCodec | null): HealthPropertyCatalogEntry[] {
  const intervalMode = workoutIntervalMode(settings);
  const configurableKinds = new Set<CanonicalHealthNativeKind>([
    'food-entry', 'activity-entry', 'workout-session', 'workout-exercise',
  ]);
  const configuredKinds = (kinds: string[]): string[] => kinds.flatMap((kind) => (
    configurableKinds.has(kind as CanonicalHealthNativeKind)
      ? readableNativeKinds(settings, kind as CanonicalHealthNativeKind)
      : [kind]
  ));
  return [
    ...NATIVE_RECORD_PROPERTIES.filter(property => !isExtraNutrientKey(property.key) || settings.healthGoals.some(goal => goal.propertyKey === property.key)).map((property) => {
      const kinds = property.scope.kinds || [];
      const reusableKinds = kinds.filter(kind => kind === 'exercise' || kind === 'workout-plan');
      return {
        ...property,
        key: Object.prototype.hasOwnProperty.call(settings.nativeRecordProperties, property.key)
          ? configuredNativePropertyKey(settings, property.key as keyof TPSHealthSettings['nativeRecordProperties'])
          : property.key,
        scope: reusableKinds.length && codec?.version === 2
          ? configuredKindScope(codec, reusableKinds)
          : { ...property.scope, kinds: configuredKinds(kinds) },
      };
    }),
    scoped('workout-start', workoutStartPropertyKey(settings), 'Workout start', 'datetime', configuredKinds(['workout-session']), { icon: 'calendar-clock' }),
    scoped(
      'workout-interval',
      workoutIntervalPropertyKey(settings),
      intervalMode === 'end' ? 'Workout end' : 'Workout duration',
      intervalMode === 'end' ? 'datetime' : 'number',
      configuredKinds(['workout-session']),
      { icon: intervalMode === 'end' ? 'square' : 'timer' },
    ),
  ];
}

const FOOD_ROLLUP_KEYS = new Set([
  ...EXTRA_NUTRIENT_KEYS.map(key => key.toLowerCase()),
  "consumedcalories",
  "cal",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sugar",
  "sugaralcohol",
  "alcohol",
  "sodium",
]);

function normalizedTag(value: unknown): string {
  return String(value || "").trim().replace(/^#/, "");
}

function foodFrontmatterScope(settings: TPSHealthSettings): { key: string; value: string } {
  const rawKey = String(settings.foodFrontmatterKey || "").trim();
  const key = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(rawKey) ? rawKey : "kind";
  return {
    key,
    value: String(settings.foodFrontmatterFoodValue || "").trim() || "food",
  };
}

function foodScope(settings: TPSHealthSettings): HealthPropertyCatalogScope {
  const mode = settings.foodIdentificationMode;
  const scope: HealthPropertyCatalogScope = { mode: mode === "metadata-folder-tag" ? "any" : "all" };
  if (mode === "metadata-folder-tag" || mode === "tag") {
    const tag = normalizedTag(settings.customFoodTag);
    if (tag) scope.tags = [tag];
  }
  if (mode === "metadata-folder-tag" || mode === "folder") {
    const path = String(settings.foodsFolder || "").trim();
    if (path && path !== "/" && path !== ".") scope.paths = [path];
  }
  if (mode === "metadata-folder-tag" || mode === "metadata") {
    const identifier = foodFrontmatterScope(settings);
    scope.properties = [{ key: identifier.key, value: identifier.value, operator: "equals" }];
  }
  return scope;
}

/** GCM owns reusable-note identity when its kind API is active. */
function configuredKindScope(codec: HealthKindCodec, kinds: string[]): HealthPropertyCatalogScope {
  const kindKey = codec.propertyKey?.('kind') || 'kind';
  const paths = new Set<string>();
  const tags = new Set<string>();
  const propertyGroups = new Map<string, HealthPropertyCatalogScope['properties']>();
  for (const kind of kinds) {
    const definition = codec.definition(kind) as Record<string, any> | null;
    if (!definition) continue;
    if (definition.kindList) {
      if (String(definition.kindList.key).toLowerCase() !== kindKey.toLowerCase()) {
        throw new Error(`The ${kind} kind list must use GCM's configured Kind property to scope Health fields.`);
      }
      paths.add(String(definition.kindList.value));
    } else if (definition.tag) {
      tags.add(normalizedTag(definition.tag));
    } else {
      const conditions = definition.scalar
        ? [{ key: String(definition.scalar.key), value: String(definition.scalar.value), operator: 'equals' as const }]
        : [
            { key: kindKey, value: String(definition.parentKind), operator: 'equals' as const },
            { key: String(definition.key), value: String(definition.value), operator: 'equals' as const },
          ];
      if (conditions.length === 1 && conditions[0].key.toLowerCase() === kindKey.toLowerCase()) {
        paths.add(conditions[0].value);
      } else {
        propertyGroups.set(JSON.stringify(conditions), conditions);
      }
    }
  }
  // GCM's catalog scope can OR kinds and tags, but each property group is an
  // AND. Do not silently publish a scope that can never match.
  if (propertyGroups.size > 1) {
    throw new Error('The configured Health kinds need a shared GCM Kind path, tag, or property scope.');
  }
  const properties = propertyGroups.values().next().value;
  const sourceCount = Number(paths.size > 0) + Number(tags.size > 0) + Number(!!properties);
  if (!sourceCount) throw new Error('Configure the reusable Health kind mappings in TPS GCM first.');
  return {
    mode: sourceCount > 1 || tags.size > 1 ? 'any' : 'all',
    ...(paths.size ? { kinds: [...paths] } : {}),
    ...(tags.size ? { tags: [...tags] } : {}),
    ...(properties ? { properties } : {}),
  };
}

function rollupIcon(propertyKey: string): string {
  const key = propertyKey.trim().toLowerCase();
  if (key === "consumedcalories" || key === "cal") return "flame";
  if (key === "protein") return "dumbbell";
  if (key === "carbs") return "wheat";
  if (key === "fat") return "droplet";
  if (key === "fiber") return "sprout";
  if (key === "sodium") return "shaker";
  if (key === "activity") return "activity";
  return "gauge";
}

function rollupProperty(goal: HealthGoal): HealthPropertyCatalogEntry {
  return {
    id: `rollup-${goal.propertyKey.trim().toLowerCase()}`,
    key: goal.propertyKey,
    label: goal.label,
    type: "number",
    icon: rollupIcon(goal.propertyKey),
    scope: {
      mode: "all",
      properties: [
        { key: "healthUpdatedAt", value: "", operator: "exists" },
        { key: goal.propertyKey, value: "", operator: "exists" },
      ],
    },
  };
}

export function buildHealthPropertyCatalog(settings: TPSHealthSettings, codec?: HealthKindCodec | null): HealthPropertyCatalog {
  const scope = codec?.version === 2
    ? configuredKindScope(codec, ['food', 'recipe', 'meal'])
    : foodScope(settings);
  const rollups = (settings.healthGoals || [])
    .filter((goal) => String(goal?.propertyKey || "").trim())
    .filter((goal) => FOOD_ROLLUP_KEYS.has(goal.propertyKey.trim().toLowerCase()))
    .map(rollupProperty);
  rollups.push({
    id: "rollup-updated-at",
    key: "healthUpdatedAt",
    label: "Health rollup updated",
    type: "datetime",
    icon: "refresh-cw",
    scope: {
      mode: "all",
      properties: [{ key: "healthUpdatedAt", value: "", operator: "exists" }],
    },
  });
  return {
    version: 2,
    food: FOOD_PROPERTIES.filter(property => !isExtraNutrientKey(property.key) || settings.healthGoals.some(goal => goal.propertyKey === property.key)).map((property) => ({
      ...property,
      options: property.options ? [...property.options] : undefined,
      scope: {
        ...scope,
        tags: scope.tags ? [...scope.tags] : undefined,
        paths: scope.paths ? [...scope.paths] : undefined,
        properties: scope.properties?.map((condition) => ({ ...condition })),
      },
    })),
    dailyRollups: rollups,
    nativeRecords: nativeRecordProperties(settings, codec).map((property) => ({
      ...property,
      options: property.options ? [...property.options] : undefined,
      scope: {
        ...property.scope,
        kinds: property.scope.kinds ? [...property.scope.kinds] : undefined,
      },
    })),
  };
}
