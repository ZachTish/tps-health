import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const result = await build({stdin:{contents:'export * from "./health-mapping"; export * from "./health-mapping-migration"; export { DEFAULT_SETTINGS } from "./types";',resolveDir:fileURLToPath(new URL('../src',import.meta.url)),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export class Modal { constructor(app){this.app=app;} open(){globalThis.confirmMapping(this);} } export class Notice {} export class Setting {} export class TFile {} export function getFrontMatterInfo(content){return {exists:true,frontmatter:content};} export function parseYaml(content){return JSON.parse(content);}`}));}}]});
const {DEFAULT_SETTINGS,migrateHealthFrontmatter,matchesLibraryIdentity,changeHealthMapping}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const defaults=()=>structuredClone(DEFAULT_SETTINGS);
function harness(data, hook=()=>{}) {
  const files=Object.keys(data).map(path=>({path})); let saves=0, writes=0;
  const fm=structuredClone(data);
  const plugin={settings:defaults(),assertHealthMappingWritable:async()=>{},getGcmNativeRecordsApi:()=>({getStorageProfile:()=>({kindPropertyKey:'entityKind'}),inspect:value=>value.id?{kind:value.entityKind}:null}),saveSettings:async()=>{saves++; await hook('save',saves);},nativeRecordService:{refreshConfiguration(){}},app:{vault:{getMarkdownFiles:()=>files,read:async file=>JSON.stringify(fm[file.path])},fileManager:{processFrontMatter:async(file,mutate)=>{await hook('write',++writes);const next=structuredClone(fm[file.path]);mutate(next);fm[file.path]=next;}}}};
  return {plugin,fm,files,get saves(){return saves;},get writes(){return writes;}};
}
test('library mappings replace keys and values without retaining fallback identifiers',()=>{
  const old=defaults(),next=defaults();next.workoutFrontmatterKey='entityKind';next.workoutPlanFrontmatterValue='routine';
  const result=migrateHealthFrontmatter({kind:'workout-plan',title:'Upper'},old,next,null);
  assert.deepEqual(result,{entityKind:'routine',title:'Upper'});
  assert.equal(matchesLibraryIdentity(next,result,'workout-plan'),true);
  assert.equal(matchesLibraryIdentity(next,{kind:'workout-plan'},'workout-plan'),false);
  // A reusable definition with a GCM identity must still migrate.
  assert.deepEqual(migrateHealthFrontmatter({kind:'workout-plan'},old,next,{kind:'workout-plan',kindKey:'kind'}),{entityKind:'routine'});
});
test('food mapping migrates all three types and removes legacy markers',()=>{
  const old=defaults(),next=defaults();next.foodFrontmatterKey='entityKind';next.foodFrontmatterFoodValue='ingredient';
  assert.deepEqual(migrateHealthFrontmatter({kind:'food',tpsType:'health-food',calories:100},old,next,null),{entityKind:'ingredient',calories:100});
  for(const kind of ['recipe','meal'])assert.deepEqual(migrateHealthFrontmatter({kind},old,next,null),{entityKind:kind});
});
test('native mappings use the shared GCM key and consolidate historical aliases only during migration',()=>{
  const old=defaults(),next=defaults(); old.nativeRecordPropertyAliases.calories=['oldEnergy'];old.nativeRecordKindAliases.workoutSession=['session-v1'];
  next.nativeRecordKinds.workoutSession='training';next.nativeRecordProperties.calories='energy';
  assert.deepEqual(migrateHealthFrontmatter({entityKind:'session-v1',oldEnergy:250,title:'Upper'},old,next,{kind:'session-v1',kindKey:'entityKind'}),{entityKind:'training',energy:250,title:'Upper'});
});
test('conflicting properties and ambiguous identities stop migration',()=>{
  const old=defaults(),next=defaults();next.foodFrontmatterKey='entityKind';
  assert.throws(()=>migrateHealthFrontmatter({kind:'food',entityKind:'task'},old,next,null),/different value/);
  assert.throws(()=>migrateHealthFrontmatter({kind:'food',tpsType:'health-recipe'},old,next,null),/conflicting Health identities/);
  old.nativeRecordPropertyAliases.calories=['energy'];
  assert.throws(()=>migrateHealthFrontmatter({kind:'activity-entry',calories:1,energy:2},old,next,{kind:'activity-entry',kindKey:'kind'}),/Conflicting previous/);
});
test('cancel leaves notes and settings unchanged, even with old aliases',async()=>{
  const h=harness({'Inbox/a.md':{kind:'food'}});h.plugin.settings.nativeRecordKindAliases.foodEntry=['old-food'];
  const next=structuredClone(h.plugin.settings);next.foodFrontmatterKey='entityKind';
  globalThis.confirmMapping=modal=>modal.resolve(false);
  assert.equal(await changeHealthMapping(h.plugin,next,'Food key'),false);
  assert.equal(h.writes,0);assert.equal(h.saves,0);assert.deepEqual(h.fm['Inbox/a.md'],{kind:'food'});assert.deepEqual(h.plugin.settings.nativeRecordKindAliases.foodEntry,['old-food']);
});
test('confirmation migrates active and archived notes, clears alias metadata, and persists last',async()=>{
  const h=harness({'Inbox/a.md':{kind:'food'},'_archive/b.md':{kind:'food'},'Inbox/task.md':{kind:'task'}});
  const next=defaults();next.foodFrontmatterKey='entityKind';
  globalThis.confirmMapping=modal=>{assert.equal(h.writes,0);assert.equal(modal.changes.length,2);modal.resolve(true);};
  assert.equal(await changeHealthMapping(h.plugin,next,'Food key'),true);
  assert.deepEqual(h.fm,{'Inbox/a.md':{entityKind:'food'},'_archive/b.md':{entityKind:'food'},'Inbox/task.md':{kind:'task'}});assert.equal(h.saves,1);assert.equal(h.plugin.settings.foodFrontmatterKey,'entityKind');assert.deepEqual(h.plugin.settings.nativeRecordKindAliases,{});
});
test('changed notes and new matches invalidate the preview before any write',async()=>{
  for(const add of [false,true]) {
    const h=harness({'Inbox/a.md':{kind:'food'}});const next=defaults();next.foodFrontmatterKey='entityKind';
    globalThis.confirmMapping=modal=>{if(add){h.files.push({path:'Inbox/new.md'});h.fm['Inbox/new.md']={kind:'food'};}else h.fm['Inbox/a.md'].title='Changed';modal.resolve(true);};
    await assert.rejects(changeHealthMapping(h.plugin,next,'Food key'),/changed while the preview/);assert.equal(h.writes,0);assert.equal(h.saves,0);
  }
});
test('write and settings failures restore already changed notes and keep the old mapping',async()=>{
  for(const fail of ['write','save']) {
    const h=harness({'Inbox/a.md':{kind:'food'},'Inbox/b.md':{kind:'food'}},(type,count)=>{if(type===fail&&count===(fail==='write'?2:1))throw new Error('Injected failure');});
    const next=defaults();next.foodFrontmatterKey='entityKind';globalThis.confirmMapping=modal=>modal.resolve(true);
    await assert.rejects(changeHealthMapping(h.plugin,next,'Food key'),/Injected failure/);
    assert.deepEqual(h.fm,{'Inbox/a.md':{kind:'food'},'Inbox/b.md':{kind:'food'}});assert.equal(h.plugin.settings.foodFrontmatterKey,'kind');
  }
});


test('new matching notes during the batch roll back the old notes before switching readers', async()=>{
  let h;
  h=harness({'Inbox/a.md':{kind:'food'}},(type)=>{if(type==='write'&&!h.fm['Inbox/new.md']){h.files.push({path:'Inbox/new.md'});h.fm['Inbox/new.md']={kind:'food'};}});
  const next=defaults();next.foodFrontmatterKey='entityKind';globalThis.confirmMapping=modal=>modal.resolve(true);
  await assert.rejects(changeHealthMapping(h.plugin,next,'Food key'),/Notes changed during migration/);
  assert.deepEqual(h.fm['Inbox/a.md'],{kind:'food'});assert.equal(h.saves,0);assert.equal(h.plugin.settings.foodFrontmatterKey,'kind');
});

test('workout timing migration moves custom keys and converts the existing interval after confirmation',()=>{
 const before=defaults(),after=defaults();before.workoutStartPropertyKey='began';before.workoutIntervalPropertyKey='minutes';after.workoutStartPropertyKey='starts';after.workoutIntervalPropertyKey='finishes';after.workoutIntervalMode='end';
 const source={kind:'workout-session',began:'2026-09-20T12:00:00.000Z',minutes:45,status:'complete'};
 assert.deepEqual(migrateHealthFrontmatter(source,before,after,{kind:'workout-session',kindKey:'kind'}),{kind:'workout-session',status:'complete',starts:'2026-09-20T12:00:00.000Z',finishes:'2026-09-20T12:45:00.000Z'});
 assert.throws(()=>migrateHealthFrontmatter({...source,finishes:'unrelated'},before,after,{kind:'workout-session',kindKey:'kind'}),/different value/);
 assert.throws(()=>migrateHealthFrontmatter({...source,durationMinutes:60},before,after,{kind:'workout-session',kindKey:'kind'}),/Conflicting workout/);
});
test('timing changes use the same cancel, archived-note migration and settings-last transaction',async()=>{
 const source={'_archive/session.md':{id:'test',entityKind:'workout-session',scheduled:'2026-09-20T12:00:00.000Z',timeEstimate:45}};
 const h=harness(source);const next=defaults();next.workoutStartPropertyKey='starts';next.workoutIntervalPropertyKey='minutes';
 globalThis.confirmMapping=modal=>modal.resolve(false);assert.equal(await changeHealthMapping(h.plugin,next,'Timing'),false);assert.deepEqual(h.fm,source);
 globalThis.confirmMapping=modal=>modal.resolve(true);assert.equal(await changeHealthMapping(h.plugin,next,'Timing'),true);
 assert.equal(h.fm['_archive/session.md'].starts,source['_archive/session.md'].scheduled);assert.equal(h.fm['_archive/session.md'].minutes,45);assert.equal(h.fm['_archive/session.md'].scheduled,undefined);assert.equal(h.plugin.settings.workoutStartPropertyKey,'starts');
});

test('a current timing key can reuse a historical name from another role without fallback reinterpretation',()=>{
 const before=defaults(),after=defaults();before.workoutStartPropertyKey='durationMinutes';before.workoutIntervalPropertyKey='startedAt';after.workoutStartPropertyKey='began';after.workoutIntervalPropertyKey='minutes';
 assert.deepEqual(migrateHealthFrontmatter({kind:'workout-session',durationMinutes:'2026-09-20T12:00:00.000Z',startedAt:45},before,after,{kind:'workout-session',kindKey:'kind'}),{kind:'workout-session',began:'2026-09-20T12:00:00.000Z',minutes:45});
});


test('unrelated malformed YAML is ignored while potentially matching malformed notes block migration',async()=>{
 for (const relevant of [false,true]) {
  const h=harness({'Inbox/a.md':{kind:'food'},'Inbox/broken.md':{}});
  const read=h.plugin.app.vault.read;
  h.plugin.app.vault.read=file=>file.path==='Inbox/broken.md'?Promise.resolve(relevant?'kind: food\n- broken':'test: test1\n- broken'):read(file);
  const next=defaults();next.foodFrontmatterKey='entityKind';globalThis.confirmMapping=modal=>modal.resolve(true);
  if(relevant){await assert.rejects(changeHealthMapping(h.plugin,next,'Food key'),/Repair invalid frontmatter.*Inbox\/broken.md/);assert.equal(h.writes,0);}
  else {assert.equal(await changeHealthMapping(h.plugin,next,'Food key'),true);assert.deepEqual(h.fm['Inbox/a.md'],{entityKind:'food'});}
 }
});


test('separate entry keys survive Health kind-value migrations and save-failure rollback',async()=>{
 for(const fail of [false,true]) {
  const h=harness({'entry.md':{id:'entry-1',entryKind:'activity-entry',caloriesBurned:20},'template.md':{kind:'workout-plan'}} ,(type,count)=>{if(fail&&type==='save'&&count===1)throw Error('Save failed');});
  let keys={'activity-entry':'entryKind'};
  h.plugin.getGcmNativeRecordsApi=()=>({getStorageProfile:kind=>({kindPropertyKey:keys[kind]||'kind'}),getKindPropertyKeys:()=>({...keys}),configureKindPropertyKeys:async(next,expected)=>{assert.deepEqual(keys,expected);keys={...next};},inspect:fm=>fm.id?{kind:fm.entryKind,profile:{kindPropertyKey:'entryKind'}}:null});
  const next=defaults();next.nativeRecordKinds.activityEntry='movement';globalThis.confirmMapping=modal=>modal.resolve(true);
  if(fail){await assert.rejects(changeHealthMapping(h.plugin,next,'Activity value'),/Save failed/);assert.deepEqual(keys,{'activity-entry':'entryKind'});assert.equal(h.fm['entry.md'].entryKind,'activity-entry');}
  else{assert.equal(await changeHealthMapping(h.plugin,next,'Activity value'),true);assert.deepEqual(keys,{movement:'entryKind'});assert.equal(h.fm['entry.md'].entryKind,'movement');}
  assert.deepEqual(h.fm['template.md'],{kind:'workout-plan'});
 }
});

test('entities and records may share a key or use different keys without changing the other group',()=>{
 const before=defaults(),after=defaults();after.workoutFrontmatterKey='entityKind';
 assert.deepEqual(migrateHealthFrontmatter({kind:'workout-plan'},before,after,null),{entityKind:'workout-plan'});
 assert.deepEqual(migrateHealthFrontmatter({entryKind:'activity-entry',steps:4},before,after,{kind:'activity-entry',kindKey:'entryKind'}),{entryKind:'activity-entry',steps:4});
 after.workoutFrontmatterKey='entryKind';assert.deepEqual(migrateHealthFrontmatter({kind:'workout-plan'},before,after,null),{entryKind:'workout-plan'});
});

test('same-key workout repair previews legacy and archived sessions without changing other Health data or settings', async()=>{
  const start='2026-09-21T12:00:00.000Z';
  const data={
    'Health/Workouts/old.md':{runKind:'run',runType:'workout',startedAt:start,status:'active',workoutId:'legacy'},
    '_archive/session.md':{id:'native',entityKind:'workout-session',startedAt:start,endedAt:'2026-09-21T12:30:00.000Z',status:'complete',energy:250},
    'Health/activity.md':{id:'activity',entityKind:'activity-entry',startedAt:start,durationMinutes:20},
    'Health/food.md':{tpsType:'health-food',calories:100},
    'Health/template.md':{kind:'workout-plan',startedAt:start},
  };
  const h=harness(data);h.plugin.settings.nativeRecordPropertyAliases.calories=['energy'];
  const before=structuredClone(h.plugin.settings);
  globalThis.confirmMapping=modal=>{assert.equal(modal.changes.length,2);assert.equal(h.writes,0);modal.resolve(false);};
  assert.equal(await changeHealthMapping(h.plugin,structuredClone(before),'Repair workout timing','workout-timing'),false);
  assert.deepEqual(h.fm,data);
  globalThis.confirmMapping=modal=>{assert.equal(modal.changes.length,2);modal.resolve(true);};
  assert.equal(await changeHealthMapping(h.plugin,structuredClone(before),'Repair workout timing','workout-timing'),true);
  assert.deepEqual(h.fm['Health/Workouts/old.md'],{runKind:'run',runType:'workout',scheduled:start,status:'active',workoutId:'legacy'});
  assert.deepEqual(h.fm['_archive/session.md'],{id:'native',entityKind:'workout-session',scheduled:start,timeEstimate:30,status:'complete',energy:250});
  for(const path of ['Health/activity.md','Health/food.md','Health/template.md'])assert.deepEqual(h.fm[path],data[path]);
  assert.deepEqual(h.plugin.settings,before);assert.equal(h.saves,0);
  globalThis.confirmMapping=modal=>{assert.equal(modal.changes.length,0);modal.resolve(true);};
  await changeHealthMapping(h.plugin,structuredClone(before),'Repair workout timing','workout-timing');
  assert.equal(h.writes,2);assert.equal(h.saves,0);
});

test('workout-only migration changes custom timing keys without clearing unrelated aliases or metadata', async()=>{
  const h=harness({'session.md':{id:'native',entityKind:'workout-session',scheduled:'2026-09-21T12:00:00Z',timeEstimate:45,energy:25}});
  h.plugin.settings.nativeRecordPropertyAliases.calories=['energy'];
  const next=structuredClone(h.plugin.settings);next.workoutStartPropertyKey='starts';next.workoutIntervalPropertyKey='ends';next.workoutIntervalMode='end';
  globalThis.confirmMapping=modal=>modal.resolve(true);
  await changeHealthMapping(h.plugin,next,'Timing','workout-timing');
  assert.deepEqual(h.fm['session.md'],{id:'native',entityKind:'workout-session',starts:'2026-09-21T12:00:00Z',ends:'2026-09-21T12:45:00.000Z',energy:25});
  assert.deepEqual(h.plugin.settings.nativeRecordPropertyAliases.calories,['energy']);assert.equal(h.saves,1);
  const invalid=structuredClone(h.plugin.settings);invalid.foodFrontmatterKey='foodKind';
  await assert.rejects(changeHealthMapping(h.plugin,invalid,'Wrong scope','workout-timing'),/cannot change other Health mappings/);
});

test('workout-only repair ignores malformed unrelated identities but rejects potentially relevant malformed workouts', async()=>{
  for(const relevant of [false,true]) {
    const h=harness({'session.md':{runKind:'run',runType:'workout',startedAt:'2026-09-21T12:00:00Z'},'broken.md':{}});
    const read=h.plugin.app.vault.read;
    h.plugin.app.vault.read=file=>file.path==='broken.md'?Promise.resolve(relevant?'kind: workout-session\n- malformed':'kind: food\n- malformed'):read(file);
    globalThis.confirmMapping=modal=>modal.resolve(true);
    if(relevant){await assert.rejects(changeHealthMapping(h.plugin,defaults(),'Timing','workout-timing'),/Repair invalid frontmatter.*broken.md/);assert.equal(h.writes,0);}
    else {await changeHealthMapping(h.plugin,defaults(),'Timing','workout-timing');assert.equal(h.fm['session.md'].scheduled,'2026-09-21T12:00:00Z');}
  }
});

test('same-key timing repair refuses conflicts and stale previews and rolls back interrupted writes', async()=>{
  const source={runKind:'run',runType:'workout',startedAt:'2026-09-21T12:00:00Z'};
  const conflict=harness({'a.md':{...source,scheduled:'2026-09-21T15:00:00Z'}});
  await assert.rejects(changeHealthMapping(conflict.plugin,defaults(),'Timing','workout-timing'),/Conflicting workout timing/);assert.equal(conflict.writes,0);
  const stale=harness({'a.md':source});
  globalThis.confirmMapping=modal=>{stale.fm['a.md'].startedAt='2026-09-21T15:00:00Z';modal.resolve(true);};
  await assert.rejects(changeHealthMapping(stale.plugin,defaults(),'Timing','workout-timing'),/changed while the preview/);assert.equal(stale.writes,0);
  const partial=harness({'a.md':source,'b.md':source},(type,count)=>{if(type==='write'&&count===2)throw Error('Injected failure');});
  globalThis.confirmMapping=modal=>modal.resolve(true);
  await assert.rejects(changeHealthMapping(partial.plugin,defaults(),'Timing','workout-timing'),/Injected failure/);
  assert.deepEqual(partial.fm,{'a.md':source,'b.md':source});assert.equal(partial.saves,0);
});

test('already-current timing is a no-op regardless of frontmatter key order',async()=>{
 const data={'session.md':{id:'native',entityKind:'workout-session',scheduled:'2026-09-21T12:00:00Z',title:'Current',timeEstimate:30,status:'complete'}};
 const h=harness(data);globalThis.confirmMapping=modal=>{assert.equal(modal.changes.length,0);modal.resolve(true);};
 await changeHealthMapping(h.plugin,defaults(),'Timing','workout-timing');
 assert.deepEqual(h.fm,data);assert.equal(h.writes,0);assert.equal(h.saves,0);
});
