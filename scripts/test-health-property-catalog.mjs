import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/health-property-catalog.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleRecord = { exports: {} };
new Function('module', 'exports', compiled)(moduleRecord, moduleRecord.exports);
const { buildHealthPropertyCatalog } = moduleRecord.exports;

const settings = (mode) => ({
  foodIdentificationMode: mode,
  foodFrontmatterKey: 'healthEntity',
  foodFrontmatterFoodValue: 'pantry-item',
  customFoodTag: '#my/food',
  foodsFolder: 'Health/My Foods',
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
  assert.deepEqual(byKey('foodPath')[0].scope.kinds, ['food-entry']);
  assert.deepEqual(byKey('activityType')[0].scope.kinds, ['activity-entry']);
  assert.deepEqual(byKey('primaryMuscles')[0].scope.kinds, ['exercise']);
  assert.deepEqual(byKey('status')[0].scope.kinds, ['workout-session']);
  assert.deepEqual(byKey('startedAt')[0].scope.kinds, ['activity-entry', 'workout-session']);
  assert.equal(catalog.food.find((property) => property.key === 'name').label, 'Name');
  assert.ok(byKey('name').every((property) => property.label === 'Name'));
  for (const redundant of ['foodName', 'brand', 'date', 'amount', 'amountUnit', 'durationSeconds', 'setCount', 'exerciseCount', 'totalReps', 'totalVolume', 'workout', 'exercisePath', 'exerciseOrder', 'lastCompletedDate', 'nextEligibleDate']) {
    assert.equal(byKey(redundant).length, 0, `${redundant} is derived, duplicated, legacy-only, or internal`);
  }
  assert.ok(new Set(catalog.nativeRecords.map((property) => property.key)).size <= 28, 'the imported native catalog stays intentionally small');
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
  for (const key of ['name', 'brand', 'aliases', 'barcode', 'servingAmount', 'servingUnit', 'calories', 'proteinG', 'ingredientStatement']) {
    assert.equal(keys.has(key), true, `missing ${key}`);
  }
  for (const internal of ['nutritionBasis', 'imageUrl', 'sourceImagePath', 'confidence', 'notes']) {
    assert.equal(keys.has(internal), false, `${internal} should not clutter imported GCM properties`);
  }
  assert.ok(keys.size <= 18, 'the reusable food catalog stays intentionally small');
});
