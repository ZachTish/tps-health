import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/native-record-schema.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const schema = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('every Health-owned native property can be remapped and decoded without duplicate aliases', () => {
  const nativeRecordProperties = Object.fromEntries(
    schema.HEALTH_NATIVE_RECORD_PROPERTY_KEYS.map((key) => [key, `health_${key}`]),
  );
  const settings = {
    nativeRecordProperties,
    nativeRecordPropertyAliases: { calories: ['oldEnergy'] },
  };
  const canonical = Object.fromEntries(
    schema.HEALTH_NATIVE_RECORD_PROPERTY_KEYS.map((key, index) => [key, index + 1]),
  );
  const encoded = schema.encodeNativeRecordProperties(settings, canonical, true);
  for (const key of schema.HEALTH_NATIVE_RECORD_PROPERTY_KEYS) {
    assert.equal(encoded[`health_${key}`], canonical[key]);
    assert.equal(encoded[schema.DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES[key]], null);
  }
  assert.equal(encoded.oldEnergy, null);
  const stored = Object.fromEntries(
    schema.HEALTH_NATIVE_RECORD_PROPERTY_KEYS.map((key) => [`health_${key}`, encoded[`health_${key}`]]),
  );
  assert.deepEqual(
    Object.fromEntries(schema.HEALTH_NATIVE_RECORD_PROPERTY_KEYS.map((key) => [key, schema.decodeNativeRecordFrontmatter(settings, stored)[key]])),
    canonical,
  );
});

test('custom kind values stay canonical internally and invalid or reserved fields fail closed', () => {
  const settings = {
    nativeRecordKinds: {
      foodEntry: 'nutrition-log',
      activityEntry: 'movement-log',
      workoutSession: 'training-session',
      workoutExercise: 'training-exercise',
    },
    nativeRecordKindAliases: { foodEntry: ['meal-consumption'] },
  };
  assert.equal(schema.configuredNativeKind(settings, 'food-entry'), 'nutrition-log');
  assert.equal(schema.canonicalNativeKind(settings, 'nutrition-log'), 'food-entry');
  assert.equal(schema.canonicalNativeKind(settings, 'meal-consumption'), 'food-entry');
  assert.equal(schema.canonicalNativeKind(settings, 'food-entry'), 'food-entry');
  assert.equal(schema.isValidNativeRecordKindValue('Food Entry'), false);
  assert.equal(schema.isValidFrontmatterPropertyKey('energy_kcal'), true);
  for (const reserved of ['tpsId', 'kind', 'title', 'createdDate', 'modifiedDate', 'tags']) {
    assert.equal(schema.isValidFrontmatterPropertyKey(reserved), false);
  }
});
