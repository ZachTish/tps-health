import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as esbuild from 'esbuild';
const url=new URL('./test-health-providers.mjs',import.meta.url);
globalThis.__TPSWorkoutRoundtripEsbuild=esbuild;
const source=readFileSync(url,'utf8').replace('import test from "node:test";','const test=()=>{};').replace('import * as esbuild from "esbuild";','const esbuild=globalThis.__TPSWorkoutRoundtripEsbuild;').replaceAll('import.meta.url',JSON.stringify(url.href));
const harness=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {importPluginWithObsidianStub,createFakeHealthApp,installDeterministicBrowserGlobals};').toString('base64'));
harness.installDeterministicBrowserGlobals();
const {default:Plugin}=await harness.importPluginWithObsidianStub();
delete globalThis.__TPSWorkoutRoundtripEsbuild;

test('native layout round trip retains exercises, set values, rest, RPE, per-arm and groups but clears completion',async()=>{
 const fake=harness.createFakeHealthApp(), plugin=new Plugin(fake.app);
 const path='Inbox/Workout.md', plan='Inbox/Layout.md';fake.files.set(path,'---\nsession:\n  exercises:\n    - id: private-exercise-id\n---\n');
 const snapshot={id:'session',path,exercises:[{id:'press',name:'Press',exercisePath:'Inbox/Press.md',supersetGroupId:'A',sets:[
 {id:'old1',reps:10,weight:25,weightUnit:'lb',perArm:true,rpe:8,restSeconds:90,setType:'normal',dropSetGroupId:'D',completedDate:'2026-09-11T12:00:00Z'},
 {id:'old2',reps:8,weight:15,weightUnit:'lb',setType:'drop',dropSetGroupId:'D'}]},
 {id:'row',name:'Row',exercisePath:'Inbox/Row.md',supersetGroupId:'A',sets:[{id:'old3',reps:12,weight:30,weightUnit:'kg',setType:'normal'}]}]};
 const sets=[],links=[],names=[];
 plugin.nativeRecordService={isEnabled:()=>true,isWorkoutIndexSettled:()=>true,getWorkoutSnapshot:()=>snapshot,
 ensureWorkoutExercise:async(_file,name)=>({id:name}),appendWorkoutSet:async(_file,set)=>sets.push(set),setWorkoutSupersetLinks:async(...args)=>links.push(args)};
 plugin.findOrCreateExercise=async({name})=>{names.push(name);return {name,sourcePath:'Inbox/'+name+'.md'};};
 await assert.rejects(plugin.extractWorkoutLayoutEntriesFromSession(path,'replaced-session'),/could not be read safely/);
 const entries=await plugin.extractWorkoutLayoutEntriesFromSession(path,'session');
 assert.equal(entries.length,3);assert.ok(entries.every(x=>!x.includes('private-exercise-id')));
 fake.files.set(plan,plugin.defaultWorkoutPlanTemplateFromSession('Layout',0,90,entries));
 await plugin.applyWorkoutPlanToNativeSession(fake.app.vault.getAbstractFileByPath(path),plan);
 assert.deepEqual(names,['Press','Press','Row']);assert.equal(sets.length,3);
 assert.deepEqual(sets.map(s=>[s.reps,s.weight,s.weightUnit]),[[10,25,'lb'],[8,15,'lb'],[12,30,'kg']]);
 assert.equal(sets[0].perArm,true);assert.equal(sets[0].rpe,8);assert.equal(sets[0].restSeconds,90);
 assert.equal(sets[0].dropSetGroupId,sets[1].dropSetGroupId);assert.equal(sets[1].setType,'drop');assert.equal(sets[0].setType,'normal');
 assert.deepEqual(links.map(x=>x.slice(1)),[['Press',['Row']]]);
 assert.ok(sets.every(s=>!s.completedDate&&!s.endedAt&&!s.restStartedAt&&!s.id.startsWith('old')));
});

test('legacy fallback ignores YAML arrays and native missing snapshots fail closed',async()=>{
 const fake=harness.createFakeHealthApp(),plugin=new Plugin(fake.app),path='Inbox/Workout.md';
 const content='---\nsession:\n  exercises:\n    - id: private\n---\n- [ ] Pushup - 10 reps\n';fake.files.set(path,content);
 assert.deepEqual(plugin.extractTaskExerciseNames(content),['Pushup']);
 plugin.nativeRecordService={isEnabled:()=>true,isWorkoutIndexSettled:()=>true,getWorkoutSnapshot:()=>null};
 await assert.rejects(plugin.extractWorkoutLayoutEntriesFromSession(path),/could not be read safely/);
});
