import type {
  HealthPropertyCatalog,
  HealthPropertyCatalogEntry,
  HealthPropertyCatalogScope,
} from "./api";
import type { HealthGoal, TPSHealthSettings } from "./types";
import { workoutIntervalMode, workoutIntervalPropertyKey, workoutStartPropertyKey } from "./workout-properties";
import { configuredNativePropertyKey, readableNativeKinds } from "./native-record-schema";
import type { CanonicalHealthNativeKind } from "./native-record-schema";

const FOOD_PROPERTIES: Array<Omit<HealthPropertyCatalogEntry, "scope">> = [
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

function nativeRecordProperties(settings: TPSHealthSettings): HealthPropertyCatalogEntry[] {
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
    ...NATIVE_RECORD_PROPERTIES.map((property) => ({
      ...property,
      key: Object.prototype.hasOwnProperty.call(settings.nativeRecordProperties, property.key)
        ? configuredNativePropertyKey(settings, property.key as keyof TPSHealthSettings['nativeRecordProperties'])
        : property.key,
      scope: {
        ...property.scope,
        kinds: configuredKinds(property.scope.kinds || []),
      },
    })),
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

export function buildHealthPropertyCatalog(settings: TPSHealthSettings): HealthPropertyCatalog {
  const scope = foodScope(settings);
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
    food: FOOD_PROPERTIES.map((property) => ({
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
    nativeRecords: nativeRecordProperties(settings).map((property) => ({
      ...property,
      options: property.options ? [...property.options] : undefined,
      scope: {
        ...property.scope,
        kinds: property.scope.kinds ? [...property.scope.kinds] : undefined,
      },
    })),
  };
}
