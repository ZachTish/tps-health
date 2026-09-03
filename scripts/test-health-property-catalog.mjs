import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 };
const workoutSource = readFileSync(new URL('../src/workout-properties.ts', import.meta.url), 'utf8');
const workoutCompiled = ts.transpileModule(workoutSource, {
  compilerOptions,
}).outputText;
const workoutModule = { exports: {} };
new Function('module', 'exports', workoutCompiled)(workoutModule, workoutModule.exports);
const nativeSchemaSource = readFileSync(new URL('../src/native-record-schema.ts', import.meta.url), 'utf8');
const nativeSchemaCompiled = ts.transpileModule(nativeSchemaSource, { compilerOptions }).outputText;
const nativeSchemaModule = { exports: {} };
new Function('module', 'exports', nativeSchemaCompiled)(nativeSchemaModule, nativeSchemaModule.exports);

const source = readFileSync(new URL('../src/health-property-catalog.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions,
}).outputText;
const moduleRecord = { exports: {} };
new Function('module', 'exports', 'require', compiled)(
  moduleRecord,
  moduleRecord.exports,
  (specifier) => {
    if (specifier === './workout-properties') return workoutModule.exports;
    if (specifier === './native-record-schema') return nativeSchemaModule.exports;
    throw new Error(`Unexpected test import: ${specifier}`);
  },
);
const { buildHealthPropertyCatalog } = moduleRecord.exports;

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
  assert.deepEqual(food.scope.kinds, ['nutrition-log', 'food-entry', 'meal-log']);
  assert.equal(calories.key, 'energyKcal');
  assert.deepEqual(calories.scope.kinds, ['nutrition-log', 'food-entry', 'meal-log']);
  assert.equal(status.key, 'trainingStatus');
  assert.deepEqual(status.scope.kinds, ['training-session', 'workout-session']);
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
