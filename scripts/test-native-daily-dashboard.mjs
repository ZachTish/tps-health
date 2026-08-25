import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/native-daily-dashboard.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { buildNativeDailyDashboardModel, formatNativeDailyMetricValue } = await loadModule();
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const totals = {
  dateIso: '2026-08-24', entryCount: 1, calories: 126, proteinG: 0.7, carbsG: 33.4,
  fatG: 0.5, fiberG: 5.8, sugarG: 25.2, sugarAlcoholG: 0,
  sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 2,
};

test('daily dashboard maps indexed nutrition to configured goal metrics', () => {
  const model = buildNativeDailyDashboardModel(totals, [
    { propertyKey: 'consumedCalories', label: 'Consumed calories', unit: 'kcal', kind: 'max', max: 2100 },
    { propertyKey: 'protein', label: 'Protein', unit: 'g', kind: 'min', min: 125 },
    { propertyKey: 'carbs', label: 'Carbs', unit: 'g', kind: 'range', min: 120, max: 260 },
    { propertyKey: 'activity', label: 'Activity', unit: 'min', kind: 'min', min: 45 },
  ]);
  assert.equal(model.entryCount, 1);
  assert.equal(model.calories, 126);
  assert.deepEqual(model.metrics.map((metric) => [metric.propertyKey, metric.value]), [
    ['consumedCalories', 126], ['protein', 0.7], ['carbs', 33.4],
  ]);
  assert.equal(model.metrics[0].targetLabel, 'up to 2100 kcal');
  assert.equal(model.metrics[1].state, 'below');
  assert.equal(model.metrics[2].targetLabel, '120–260 g');
});

test('daily dashboard marks values beyond a maximum and clamps the progress bar', () => {
  const model = buildNativeDailyDashboardModel({ ...totals, calories: 2400 }, [
    { propertyKey: 'consumedCalories', label: 'Calories', unit: 'kcal', kind: 'max', max: 2100 },
  ]);
  assert.equal(model.metrics[0].state, 'above');
  assert.equal(model.metrics[0].progress, 1);
});

test('daily dashboard formats whole and fractional values without noisy precision', () => {
  assert.equal(formatNativeDailyMetricValue(126), '126');
  assert.equal(formatNativeDailyMetricValue(0.70000001), '0.7');
  assert.equal(formatNativeDailyMetricValue(Number.NaN), '0');
});

test('Health registers the Daily Note renderer and keeps all styling plugin-namespaced', () => {
  assert.match(mainSource, /registerMarkdownCodeBlockProcessor\("tps-health-daily"/u);
  assert.match(mainSource, /getDailyFoodMacroTotals\(this\.dateContext\.dateIso\)/u);
  assert.match(stylesSource, /\.tps-health-native-daily/u);
  assert.doesNotMatch(stylesSource, /(?:^|\n)\s*\.native-daily/u);
});

test('Daily Note actions use the exact resolved date context for every Health workflow', () => {
  assert.match(mainSource, /new TPSHealthNativeDailyDashboardChild\(el, this, dateContext\)/u);
  assert.match(mainSource, /addFood:\s*\(\) => this\.plugin\.openFoodLogger\(\{ \.\.\.this\.dateContext \}\)/u);
  assert.match(mainSource, /logActivity:\s*\(\) => this\.plugin\.openActivityLogger\(\{ \.\.\.this\.dateContext \}\)/u);
  assert.match(mainSource, /startWorkout:\s*\(\) => this\.plugin\.openWorkoutStarter\(\{ \.\.\.this\.dateContext \}\)/u);
  assert.match(mainSource, /addAction\("Add food", "utensils", actions\.addFood\)/u);
  assert.match(mainSource, /addAction\("Log activity", "activity", actions\.logActivity\)/u);
  assert.match(mainSource, /addAction\("Start workout", "dumbbell", actions\.startWorkout\)/u);
  assert.match(stylesSource, /\.tps-health-native-daily-actions\s*\{[^}]*flex-wrap:\s*wrap/u);
  assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.tps-health-native-daily-action\s*\{[^}]*min-height:\s*44px/u);
});
