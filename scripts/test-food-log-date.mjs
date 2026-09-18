import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadDateModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/food-log-date.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('daily-note ownership wins over cross-midnight consumed timestamps', async () => {
  const { resolveFoodLogDateKey } = await loadDateModule();
  assert.equal(resolveFoodLogDateKey({
    dailyNotePath: '2026-07-07.md',
    sourcePath: '2026-07-07.md',
    completedDate: '2026-07-08T00:46:00.000Z',
    createdDate: '2026-07-08T19:38:25.533Z',
  }), '2026-07-07');
});

test('source daily-note path and legacy timestamps remain valid fallbacks', async () => {
  const { resolveFoodLogDateKey } = await loadDateModule();
  assert.equal(resolveFoodLogDateKey({ sourcePath: 'Daily Notes/2026-07-08.md' }), '2026-07-08');
  assert.equal(resolveFoodLogDateKey({ sourcePath: 'Food Log.md', completedDate: '2026-07-09T01:34:00.000Z' }), '2026-07-09');
  assert.equal(resolveFoodLogDateKey({ sourcePath: 'Food Log.md', createdDate: '2026/07/06 12:00' }), '2026-07-06');
});

test('logging-day indicator uses sun today, moon in the past and calendar in the future', async () => {
  const { foodLogDateIndicator } = await loadDateModule();
  const now = new Date(2026, 8, 18, 12);
  for (const [date, state, icon, weekday] of [[17,'past','moon','Thursday'],[18,'today','sun','Friday'],[19,'future','calendar','Saturday']]) {
    const result = foodLogDateIndicator(new Date(2026,8,date,23).toISOString(),now,'en-US');
    assert.equal(result.state,state); assert.equal(result.icon,icon); assert.match(result.dateLabel,new RegExp(weekday));
    assert.match(result.dateLabel,/2026/); assert.match(result.label,state === 'today' ? /today/ : new RegExp(state));
  }
  assert.equal(foodLogDateIndicator(undefined,now).state,'today');
  assert.equal(foodLogDateIndicator('invalid',now).state,'today');
});

test('logging-day indicator follows local midnight, year boundaries and daylight saving days', async () => {
  const { foodLogDateIndicator } = await loadDateModule();
  const previousTZ = process.env.TZ; process.env.TZ = 'America/Chicago';
  try {
    assert.equal(foodLogDateIndicator('2026-09-19T02:00:00Z',new Date('2026-09-18T18:00:00Z')).state,'today');
    assert.equal(foodLogDateIndicator('2026-01-01T05:59:00Z',new Date('2026-01-01T06:01:00Z')).state,'past');
    assert.equal(foodLogDateIndicator('2026-03-09T00:30:00-05:00',new Date('2026-03-08T01:30:00-06:00')).state,'future');
  } finally { if(previousTZ === undefined) delete process.env.TZ; else process.env.TZ=previousTZ; }
});
