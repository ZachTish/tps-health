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
  for (const key of ['name', 'brand', 'aliases', 'barcode', 'servingAmount', 'servingUnit', 'nutritionBasis', 'calories', 'proteinG', 'ingredientStatement']) {
    assert.equal(keys.has(key), true, `missing ${key}`);
  }
});
