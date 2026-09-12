import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as esbuild from 'esbuild';
const url=new URL('./test-health-providers.mjs',import.meta.url);
globalThis.__TPSWorkoutRoundtripEsbuild=esbuild;
const source=readFileSync(url,'utf8').replace('import test from "node:test";','const test=()=>{};').replace('import * as esbuild from "esbuild";','const esbuild=globalThis.__TPSWorkoutRoundtripEsbuild;').replaceAll('import.meta.url',JSON.stringify(url.href));
const harness=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {importPluginWithObsidianStub,createFakeHealthApp,installDeterministicBrowserGlobals,primeHealthSettingsPersistence};').toString('base64'));
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

test('add-exercise waits for transient indexing and rejects an owner changed during the wait', async()=>{
 const fake=harness.createFakeHealthApp(),plugin=new Plugin(fake.app),path='Inbox/Mobile workout.md';
 fake.files.set(path,'---\nkind: workout-session\n---\n');
 plugin.settings={...plugin.settings,activeWorkoutId:'mobile',activeWorkoutPath:path,activeWorkoutTarget:'both'};
 let settled=false;
 plugin.nativeRecordService={isEnabled:()=>true,isWorkoutIndexSettled:()=>settled,
   waitForWorkoutIndexSettled:async()=>{await Promise.resolve();settled=true;},
   resolveWorkoutSession:()=>({state:'active',id:'mobile',path})};
 plugin.reconcileResolvedNativeWorkout=async(captured,resolved)=>plugin.getActiveWorkoutState().id===captured.id?resolved:null;
 const target=await plugin.resolveActiveNativeWorkoutMutationTarget('add-exercise');
 assert.equal(target.file.path,path);
 plugin.nativeRecordService.waitForWorkoutIndexSettled=async()=>{plugin.settings.activeWorkoutId='another';};
 await assert.rejects(plugin.resolveActiveNativeWorkoutMutationTarget('add-exercise'),/changed/);
});


test('explicit resume restores a missing active pointer without changing workout bytes or timestamps', async()=>{
 const fake=harness.createFakeHealthApp(),plugin=new Plugin(fake.app),path='Inbox/Resume.md';
 const content='---\nstatus: active\n---\n';fake.files.set(path,content);
 plugin.settings={...plugin.settings,storageMode:'native-records'};
 harness.primeHealthSettingsPersistence(plugin);
 const snapshot={id:'resume',path,title:'Resume QA',status:'active',startedAt:'2026-09-12T10:00:00Z',setCount:3};
 const resolution={state:'active',id:snapshot.id,path};
 plugin.nativeRecordService={isEnabled:()=>true,isWorkoutIndexSettled:()=>true,refreshConfiguration(){},waitForWorkoutIndexSettled:async()=>true,getWorkoutSnapshot:()=>snapshot,resolveWorkoutSession:()=>resolution};
 assert.equal(plugin.nativeWorkoutRecoveryState(snapshot).canResume,true);
 await plugin.resumeNativeWorkout(path,'resume');
 assert.equal(plugin.getActiveWorkoutState().startedAt,snapshot.startedAt);
 assert.equal(plugin.getActiveWorkoutState().setCount,3);
 assert.equal(plugin.nativeWorkoutRecoveryState(snapshot),null);
 assert.equal(fake.files.get(path),content);
 await assert.rejects(plugin.resumeNativeWorkout(path,'resume'),/already active/);
});

test('resume rejects ended sessions and a concurrent persisted active workout', async()=>{
 for(const race of [false,true]){
  const fake=harness.createFakeHealthApp(),plugin=new Plugin(fake.app),path='Inbox/Resume.md';
  plugin.settings={...plugin.settings,storageMode:'native-records'};harness.primeHealthSettingsPersistence(plugin);
  const snapshot={id:'resume',path,title:'Resume',status:race?'active':'complete',startedAt:'2026-09-12T10:00:00Z',setCount:0};
  plugin.nativeRecordService={isEnabled:()=>true,isWorkoutIndexSettled:()=>true,refreshConfiguration(){},waitForWorkoutIndexSettled:async()=>true,getWorkoutSnapshot:()=>snapshot,resolveWorkoutSession:()=>({state:race?'active':'terminal',id:'resume',path})};
  if(race){const load=plugin.loadData.bind(plugin);plugin.loadData=async()=>({...await load(),activeWorkoutId:'other',activeWorkoutPath:'Inbox/Other.md',activeWorkoutTarget:'both'});}
  await assert.rejects(plugin.resumeNativeWorkout(path,'resume'),race?/changed before/:/not resumed/);
  assert.equal(plugin.getActiveWorkoutState()?.id||'',race?'other':'');
 }
});


test('recheck repairs only the timer replacement with the same path and exact start time', async()=>{
 for(const failure of ['', 'old-exists', 'duplicate', 'ended', 'time', 'race']) {
  const fake=harness.createFakeHealthApp(),plugin=new Plugin(fake.app),path='Inbox/Identity QA.md';
  const startedAt='2026-09-01T10:00:00.123Z';
  plugin.settings={...plugin.settings,storageMode:'native-records',activeWorkoutId:'workout-original',activeWorkoutPath:path,activeWorkoutTarget:'both',activeWorkoutStartedAt:startedAt,activeWorkoutSetCount:2};
  harness.primeHealthSettingsPersistence(plugin);
  const original=plugin.getActiveWorkoutState();
  const candidate={state:failure==='ended'?'terminal':'active',id:'item_replacement',path,startedAt:failure==='time'?'2026-09-01T10:01:00Z':startedAt};
  plugin.nativeRecordService={isEnabled:()=>true,isWorkoutIndexSettled:()=>true,resolveWorkoutSession:ref=>
   ref.id==='workout-original'?{state:failure==='old-exists'?'active':'missing'}:
   ref.id && failure==='duplicate'?{state:'ambiguous'}:candidate};
  if(failure==='race') {const load=plugin.loadData.bind(plugin);plugin.loadData=async()=>({...await load(),activeWorkoutId:'another-workout'});}
  assert.equal(await plugin.repairTimerReplacedWorkoutIdentity(),!failure);
  assert.equal(plugin.getActiveWorkoutState().id,!failure?'item_replacement':failure==='race'?'another-workout':'workout-original');
  assert.equal(plugin.getActiveWorkoutState().startedAt,original.startedAt);
  assert.equal(plugin.getActiveWorkoutState().setCount,original.setCount);
 }
});
