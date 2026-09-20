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
