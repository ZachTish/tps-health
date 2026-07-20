import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadHomeActions() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/home-actions.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const context = {
  source: 'tps-home',
  dateIso: '2099-04-05',
  dailyNotePath: 'Daily Notes/2099-04-05.md',
  componentId: 'food-tracker',
  basePath: 'Food Log.base',
};

test('TPS Health Home provider routes food and workout with exact selected-day context', async () => {
  const {
    createTPSHealthHomeActionProvider,
    TPS_HEALTH_LOG_ACTIVITY_HOME_ACTION,
    TPS_HEALTH_LOG_FOOD_HOME_ACTION,
    TPS_HEALTH_START_WORKOUT_HOME_ACTION,
  } = await loadHomeActions();
  const food = [];
  const activity = [];
  const workout = [];
  const provider = createTPSHealthHomeActionProvider({
    openFoodLogger: (dateContext) => food.push(dateContext),
    openActivityLogger: (dateContext) => activity.push(dateContext),
    openWorkoutStarter: (dateContext) => workout.push(dateContext),
  });

  assert.equal(provider.canHandle(TPS_HEALTH_LOG_FOOD_HOME_ACTION), true);
  assert.equal(provider.canHandle(TPS_HEALTH_LOG_ACTIVITY_HOME_ACTION), true);
  assert.equal(provider.canHandle(TPS_HEALTH_START_WORKOUT_HOME_ACTION), true);
  assert.equal(provider.canHandle('other:command'), false);
  assert.equal(provider.execute(TPS_HEALTH_LOG_FOOD_HOME_ACTION, context), true);
  assert.equal(provider.execute(TPS_HEALTH_LOG_ACTIVITY_HOME_ACTION, { ...context, componentId: 'workout-tracker' }), true);
  assert.equal(provider.execute(TPS_HEALTH_START_WORKOUT_HOME_ACTION, { ...context, componentId: 'workout-tracker' }), true);
  assert.equal(food.length, 1);
  assert.equal(activity.length, 1);
  assert.equal(workout.length, 1);
  assert.deepEqual({
    dateIso: food[0].dateIso,
    dailyNotePath: food[0].dailyNotePath,
    foodLogTarget: food[0].foodLogTarget,
    focusAfterLog: food[0].focusAfterLog,
    isToday: food[0].isToday,
  }, {
    dateIso: '2099-04-05',
    dailyNotePath: 'Daily Notes/2099-04-05.md',
    foodLogTarget: 'daily-note',
    focusAfterLog: false,
    isToday: false,
  });
  assert.equal(workout[0].dateIso, '2099-04-05');
  assert.equal(workout[0].dailyNotePath, 'Daily Notes/2099-04-05.md');
});

test('TPS Health Home provider rejects unknown commands and incomplete context without side effects', async () => {
  const { createTPSHealthHomeActionProvider, TPS_HEALTH_LOG_FOOD_HOME_ACTION } = await loadHomeActions();
  let opens = 0;
  const provider = createTPSHealthHomeActionProvider({
    openFoodLogger: () => { opens += 1; },
    openActivityLogger: () => { opens += 1; },
    openWorkoutStarter: () => { opens += 1; },
  });
  assert.equal(provider.execute('other:command', context), false);
  assert.equal(provider.execute(TPS_HEALTH_LOG_FOOD_HOME_ACTION, { ...context, dailyNotePath: '' }), false);
  assert.equal(provider.execute(TPS_HEALTH_LOG_FOOD_HOME_ACTION, { ...context, dateIso: 'tomorrow' }), false);
  assert.equal(provider.execute(TPS_HEALTH_LOG_FOOD_HOME_ACTION, { ...context, dateIso: '2026-02-31' }), false);
  assert.equal(opens, 0);
});

test('TPS Health exposes a lifecycle-fenced provider after API creation without active-file inference', () => {
  const source = readFileSync(new URL('../src/home-actions.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getActiveFile|activeLeaf|workspace/);
  assert.match(mainSource, /const assertHomeActionCurrent = \(\) => this\.assertLegacyApiCurrent\(lifecycleEpoch\)/);
  assert.match(mainSource, /const homeActions = createTPSHealthHomeActionProvider\(\{[\s\S]*?openFoodLogger: \(dateContext\) => this\.openFoodLogger\(dateContext, assertHomeActionCurrent\)[\s\S]*?openActivityLogger: \(dateContext\) => this\.openActivityLogger\(dateContext, assertHomeActionCurrent\)[\s\S]*?openWorkoutStarter: \(dateContext\) => this\.openWorkoutStarter\(dateContext, assertHomeActionCurrent\)/);
  assert.match(mainSource, /this\.api\.homeActions = \{[\s\S]*runLegacyApiSync\(lifecycleEpoch/);
  assert.match(mainSource, /home-actions:ready/);
  assert.match(apiSource, /homeActions\?: TPSHealthHomeActionProvider/);
});

test('public Food modal descendants retain the originating lifecycle guard', () => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(mainSource, /new BarcodeScannerModal\(this\.app, this\.plugin, this\.dateContext,[\s\S]*?\}, this\.assertCurrent\);/);
  assert.match(mainSource, /new BarcodeFoodReviewModal\(this\.app, this\.plugin, reviewItem,[\s\S]*?this\.dateContext, this\.assertCurrent\)\.open\(\)/);
  assert.match(mainSource, /new FoodLogModal\(this\.app, this\.plugin, saved, null, this\.dateContext, this\.assertCurrent\)\.open\(\)/);
});
