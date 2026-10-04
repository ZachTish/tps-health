import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/health-property-catalog.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { buildHealthPropertyCatalog } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const settings = (mode) => ({
  foodIdentificationMode: mode,
  foodFrontmatterKey: 'healthEntity',
  foodFrontmatterFoodValue: 'pantry-item',
  customFoodTag: '#my/food',
  foodsFolder: 'Health/My Foods',
  workoutStartPropertyKey: 'scheduled',
  workoutIntervalMode: 'duration',
  workoutIntervalPropertyKey: 'timeEstimate',
  nativeRecordKinds: {
    foodEntry: 'food-entry', activityEntry: 'activity-entry', workoutSession: 'workout-session', workoutExercise: 'workout-exercise',
  },
  nativeRecordKindAliases: {},
  nativeRecordProperties: {},
  healthGoals: [
    { propertyKey: 'consumedCalories', label: 'Consumed calories', unit: 'kcal', kind: 'max' },
    { propertyKey: 'protein', label: 'Protein', unit: 'g', kind: 'min' },
    { propertyKey: 'activity', label: 'Activity', unit: 'min', kind: 'min' },
  ],
});

test('food property catalog follows the configured Health identification mode', () => {
  const combined = buildHealthPropertyCatalog(settings('metadata-folder-tag'));
  assert.equal(combined.version, 2);
  const calories = combined.food.find((property) => property.key === 'calories');
  assert.deepEqual(calories.scope, {
    mode: 'any',
    tags: ['my/food'],
    paths: ['Health/My Foods'],
    properties: [{ key: 'healthEntity', value: 'pantry-item', operator: 'equals' }],
  });

  assert.deepEqual(buildHealthPropertyCatalog(settings('tag')).food[0].scope, {
    mode: 'all',
    tags: ['my/food'],
    paths: undefined,
    properties: undefined,
  });
  assert.deepEqual(buildHealthPropertyCatalog(settings('folder')).food[0].scope, {
    mode: 'all',
    tags: undefined,
    paths: ['Health/My Foods'],
    properties: undefined,
  });
  assert.deepEqual(buildHealthPropertyCatalog(settings('metadata')).food[0].scope, {
    mode: 'all',
    tags: undefined,
    paths: undefined,
    properties: [{ key: 'healthEntity', value: 'pantry-item', operator: 'equals' }],
  });
});

test('GCM v2 kind paths replace stale Health identifiers in reusable-note scopes', () => {
  const paths = { food: 'entity/food', recipe: 'entity/food', meal: 'entity/food', exercise: 'entity/exercise', 'workout-plan': 'entity/workout-plan' };
  const codec = {
    version: 2,
    propertyKey: id => id === 'kind' ? 'classification' : null,
    definition: kind => paths[kind] ? { kindList: { key: 'classification', value: paths[kind] } } : null,
  };
  const configured = { ...settings('metadata'), foodFrontmatterKey: 'entityKind', workoutFrontmatterKey: 'entityKind' };
  let catalog = buildHealthPropertyCatalog(configured, codec);
  assert.deepEqual(catalog.food[0].scope, {
    mode: 'all', kinds: ['entity/food'], tags: undefined, paths: undefined, properties: undefined,
  });
  assert.deepEqual(catalog.nativeRecords.find(property => property.id === 'exercise-primary-muscles').scope,
    { mode: 'all', kinds: ['entity/exercise'] });
  assert.deepEqual(catalog.nativeRecords.find(property => property.id === 'plan-cooldown').scope,
    { mode: 'all', kinds: ['entity/workout-plan'] });
  assert.deepEqual(catalog.nativeRecords.find(property => property.id === 'exercise-rest').scope,
    { mode: 'all', kinds: ['entity/exercise', 'entity/workout-plan'] });

  for (const kind of ['food', 'recipe', 'meal']) paths[kind] = 'entity/nutrition';
  catalog = buildHealthPropertyCatalog(configured, codec);
  assert.deepEqual(catalog.food[0].scope.kinds, ['entity/nutrition'], 'catalog follows GCM changes without a Health settings migration');
  assert.equal(configured.foodFrontmatterKey, 'entityKind', 'legacy fallback settings remain untouched');
});

test('GCM tag and scalar kind mappings remain configurable; older APIs keep Health scopes', () => {
  const configured = settings('metadata');
  const codec = {
    version: 2,
    propertyKey: () => 'classification',
    definition: kind => ({ food: { tag: 'groceries/library' }, recipe: { tag: 'recipes/library' },
      meal: { tag: 'meals/library' }, exercise: { scalar: { key: 'classification', value: 'exercise' } },
      'workout-plan': { scalar: { key: 'classification', value: 'routine' } } })[kind] || null,
  };
  const catalog = buildHealthPropertyCatalog(configured, codec);
  assert.equal(catalog.food[0].scope.mode, 'any', 'any of the configured food tags identifies a reusable food note');
  assert.deepEqual(catalog.food[0].scope.tags, ['groceries/library', 'recipes/library', 'meals/library']);
  assert.equal(catalog.food[0].scope.properties, undefined);
  assert.deepEqual(catalog.nativeRecords.find(property => property.id === 'exercise-rest').scope.kinds,
    ['exercise', 'routine']);
  assert.deepEqual(buildHealthPropertyCatalog(configured, { ...codec, version: 1 }).food[0].scope.properties,
    [{ key: 'healthEntity', value: 'pantry-item', operator: 'equals' }]);
});

test('catalog exposes only the compact user-facing native and reusable fields', () => {
  const catalog = buildHealthPropertyCatalog(settings('tag'));
  const byKey = (key) => catalog.nativeRecords.filter((property) => property.key === key);
  assert.deepEqual(byKey('food')[0].scope.kinds, ['food-entry']);
  assert.deepEqual(byKey('activityType')[0].scope.kinds, ['activity-entry']);
  assert.deepEqual(byKey('primaryMuscles')[0].scope.kinds, ['exercise']);
  assert.deepEqual(byKey('status')[0].scope.kinds, ['workout-session']);
  assert.deepEqual(byKey('startedAt')[0].scope.kinds, ['activity-entry']);
  assert.deepEqual(byKey('scheduled')[0].scope.kinds, ['workout-session']);
  assert.equal(byKey('scheduled')[0].type, 'datetime');
  assert.deepEqual(byKey('timeEstimate')[0].scope.kinds, ['workout-session']);
  assert.equal(byKey('timeEstimate')[0].type, 'number');
  assert.equal(catalog.food.some((property) => property.key === 'name'), false, 'the shared title is the only display-name property');
  assert.equal(byKey('name').length, 0);
  for (const redundant of ['foodName', 'brand', 'date', 'amount', 'amountUnit', 'durationSeconds', 'setCount', 'exerciseCount', 'totalReps', 'totalVolume', 'workout', 'exercisePath', 'exerciseOrder', 'lastCompletedDate', 'nextEligibleDate']) {
    assert.equal(byKey(redundant).length, 0, `${redundant} is derived, duplicated, legacy-only, or internal`);
  }
  assert.ok(new Set(catalog.nativeRecords.map((property) => property.key)).size <= 29, 'the imported native catalog stays intentionally small');
});

test('catalog follows custom workout calendar property names and interval type', () => {
  const catalog = buildHealthPropertyCatalog({
    ...settings('tag'),
    workoutStartPropertyKey: 'calendarStart',
    workoutIntervalMode: 'end',
    workoutIntervalPropertyKey: 'calendarEnd',
  });
  const byKey = (key) => catalog.nativeRecords.filter((property) => property.key === key);
  assert.equal(byKey('calendarStart')[0].type, 'datetime');
  assert.equal(byKey('calendarEnd')[0].type, 'datetime');
  assert.equal(byKey('scheduled').length, 0);
  assert.equal(byKey('timeEstimate').length, 0);
});

test('catalog scopes configurable Health fields to configurable native kind values', () => {
  const catalog = buildHealthPropertyCatalog({
    ...settings('tag'),
    nativeRecordKinds: {
      foodEntry: 'nutrition-log', activityEntry: 'movement-log', workoutSession: 'training-session', workoutExercise: 'training-exercise',
    },
    nativeRecordKindAliases: { foodEntry: ['meal-log'] },
    nativeRecordProperties: { food: 'foodRef', calories: 'energyKcal', status: 'trainingStatus' },
  });
  const food = catalog.nativeRecords.find((property) => property.id === 'food-link');
  const calories = catalog.nativeRecords.find((property) => property.id === 'record-calories');
  const status = catalog.nativeRecords.find((property) => property.id === 'record-status');
  assert.equal(food.key, 'foodRef');
  assert.deepEqual(food.scope.kinds, ['nutrition-log']);
  assert.equal(calories.key, 'energyKcal');
  assert.deepEqual(calories.scope.kinds, ['nutrition-log']);
  assert.equal(status.key, 'trainingStatus');
  assert.deepEqual(status.scope.kinds, ['training-session']);
});

test('daily rollup properties are generated from configured goals and require their own rollup key', () => {
  const catalog = buildHealthPropertyCatalog(settings('tag'));
  assert.deepEqual(catalog.dailyRollups.map((property) => property.key), [
    'consumedCalories',
    'protein',
    'healthUpdatedAt',
  ]);
  for (const property of catalog.dailyRollups) {
    assert.deepEqual(property.scope, {
      mode: 'all',
      properties: property.key === 'healthUpdatedAt'
        ? [{ key: 'healthUpdatedAt', value: '', operator: 'exists' }]
        : [
          { key: 'healthUpdatedAt', value: '', operator: 'exists' },
          { key: property.key, value: '', operator: 'exists' },
        ],
    });
  }
});

test('catalog exposes the reusable food fields Health actually writes', () => {
  const keys = new Set(buildHealthPropertyCatalog(settings('tag')).food.map((property) => property.key));
  for (const key of ['brand', 'aliases', 'barcode', 'servingAmount', 'servingUnit', 'calories', 'proteinG', 'ingredientStatement']) {
    assert.equal(keys.has(key), true, `missing ${key}`);
  }
  for (const internal of ['nutritionBasis', 'imageUrl', 'sourceImagePath', 'confidence', 'notes']) {
    assert.equal(keys.has(internal), false, `${internal} should not clutter imported GCM properties`);
  }
  assert.ok(keys.size <= 18, 'the reusable food catalog stays intentionally small');
});
