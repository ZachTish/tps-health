import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
const build = await esbuild.build({entryPoints:[fileURLToPath(new URL('../src/food-log-timings.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false});
const {FoodLogTimings} = await import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
const context = {route:'food',platform:'ios',healthVersion:'3.2.0',gcmVersion:'3.1.7',storage:'native-records',markdownFiles:8800,selected:1};

test('an in-flight slow save is visible and preserves the operation result',async()=>{
  let now=0,finish;
  const timings=new FoodLogTimings(()=>now);
  const value={nutrition:'private'};
  const operation=timings.capture(context,timing=>timing.measure('native-entry',()=>new Promise(resolve=>{finish=resolve;})));
  now=30000;
  const pending=JSON.parse(timings.report()).attempts[0];
  assert.equal(pending.durationMs,30000);
  assert.deepEqual(pending.stages,[{stage:'native-entry',status:'running',offsetMs:0,durationMs:30000}]);
  finish(value);
  assert.equal(await operation,value);
  const report=JSON.parse(timings.report());
  assert.equal(report.attempts[0].status,'finished');
  assert.equal(report.attempts[0].stages[0].durationMs,30000);
  assert.ok(!timings.report().includes('private'));
});

test('failures retain timings without recording private error messages or swallowing the error',async()=>{
  let now=0;const timings=new FoodLogTimings(()=>now);
  const error=new Error('Secret food /Private/note.md token=abc');
  await assert.rejects(timings.capture(context,timing=>timing.measure('food-note',async()=>{now=12000;throw error;})),error);
  const attempt=JSON.parse(timings.report()).attempts[0];
  assert.equal(attempt.status,'failed');assert.equal(attempt.stages[0].status,'failed');
  assert.equal(attempt.durationMs,12000);
  assert.doesNotMatch(timings.report(),/Secret|Private|token=abc/);
});

test('reports are bounded and keep the batch summary after many individual food saves',async()=>{
  const timings=new FoodLogTimings(()=>1);
  assert.equal(timings.report(),null);
  await timings.capture({...context,route:'tray',selected:100},async timing=>{
    for(let i=0;i<100;i++) await timing.measure('log-food',()=>timings.capture(context,async()=>{}));
  });
  const attempts=JSON.parse(timings.report()).attempts;
  assert.equal(attempts.length,8);
  assert.equal(attempts.at(-1).route,'tray');
  assert.equal(attempts.at(-1).stages.length,80);
  assert.equal(attempts.at(-1).omittedStages,20);
});
