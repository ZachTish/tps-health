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
