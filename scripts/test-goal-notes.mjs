import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result=await build({stdin:{contents:['goal-notes','goal-bases','types','settings-normalization','nutrient-goals'].map(n=>`export * from './${n}';`).join('\n'),resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const goal={propertyKey:'protein',label:'Protein',unit:'g',kind:'range',min:125,max:180,color:'green',showInPrimary:true,showInSecondary:true};
test('goal notes preserve all target/display choices, zero bounds, counters and stable metric identity',()=>{
 assert.deepEqual(m.readGoalNote(m.goalNoteFields(goal)),goal);
 assert.deepEqual(m.readGoalNote(m.goalNoteFields({...goal,min:0,max:0})),{...goal,min:0,max:0});
 const counter={propertyKey:'healthNutrient_custom',label:'Custom',unit:'mg',kind:'counter'};
 assert.deepEqual(m.readGoalNote(m.goalNoteFields(counter)),counter);
 assert.equal(m.readGoalNote({...m.goalNoteFields(goal),goalEnabled:false}),null);
 assert.equal(m.readGoalNote({unrelated:3}),null);
 assert.equal(m.goalNoteFields({...goal,propertyKey:'cal'}).healthGoal,'consumedCalories');
});
test('invalid target fields never silently become a zero/default goal',()=>{
 for(const change of [{goalMinimum:-1},{goalMinimum:'125'},{goalMaximum:Infinity},{goalMaximum:1},{goalLabel:''},{goalUnit:''},{goalUnit:'mg'},{goalPrimary:'true'},{healthGoal:['protein']},{goalEnabled:'false'}]) assert.throws(()=>m.readGoalNote({...m.goalNoteFields(goal),...change}));
});
test('metadata projection follows rename/move, edit, deletion and disabled duplicates without extra scans',()=>{
 const index=new m.HealthGoalNotes(),fields=m.goalNoteFields(goal);
 assert.equal(index.project('A.md',fields),true);
 assert.equal(index.project('A.md',{...fields,unrelated:'edit'}),false);
 index.rename('A.md','Moved/Renamed.md');
 assert.equal(index.entries()[0].path,'Moved/Renamed.md');
 index.project('Moved/Renamed.md',{...fields,goalMinimum:150});
 assert.equal(index.entries()[0].goal.min,150);
 index.project('Duplicate.md',fields);assert.throws(()=>index.entries(),/More than one/);
 index.project('Duplicate.md',{...fields,goalEnabled:false});assert.equal(index.entries().length,1);
 index.project('Moved/Renamed.md',null);assert.deepEqual(index.entries(),[]);
});
test('adopted settings remove every legacy goal authority and never resurrect defaults',()=>{
 const legacy=m.normalizeTPSHealthSettings({...m.DEFAULT_SETTINGS,calorieGoal:1650,proteinGoalG:125});
 assert.equal(legacy.healthGoals.find(g=>g.propertyKey==='protein').min,125);
 const payload=m.settingsPersistencePayload({...legacy,goalStorage:'notes'});
 for(const key of m.GOAL_SETTINGS_KEYS) assert.equal(Object.hasOwn(payload,key),false,key);
 const reloaded=m.normalizeTPSHealthSettings(payload);
 assert.equal(reloaded.goalStorage,'notes');assert.deepEqual(reloaded.healthGoals,[]);
 const saved=m.mergeTPSHealthSettingsChanges(payload,{...reloaded,includeBrandedFoodSearch:false},['includeBrandedFoodSearch']);
 assert.equal(saved.includeBrandedFoodSearch,false);
 for(const key of m.GOAL_SETTINGS_KEYS) assert.equal(Object.hasOwn(saved,key),false,key);
 assert.equal(m.isFutureTPSHealthSettings({settingsVersion:11}),true);
});
test('native comparison includes live target rows, exact configured fields and local-day filtering',()=>{
 const settings=m.normalizeTPSHealthSettings({nativeRecordProperties:{proteinG:'myProtein',completedDate:'eatenAt'}});
 const base=m.foodGoalsBaseDefinition(settings,[goal], 'list(note.kind).contains("transaction") && note.transactionKind == "food-entry"');
 assert.equal(base.views[0].type,'table');
 assert.match(base.formulas.protein,/note\["myProtein"\]/);
 assert.match(base.formulas.protein,/link\(file.path/);
 assert.match(base.formulas.protein,/goalMinimum/);
 assert.match(JSON.stringify(base.filters),/eatenAt/);
 assert.match(JSON.stringify(base.filters),/today/);
 assert.doesNotMatch(JSON.stringify(base),/inFolder|backlinks|tps-table|125/);
 const summary=base.summaries['Goal comparison (g)'];
 for(const message of ['Duplicate goals','Invalid goal','incomplete','remaining','below minimum','goal met','no goal'])assert.ok(summary.includes(message));
 assert.ok(summary.length<8192);
});

// Execute the real command/write methods against controlled vault and persistence boundaries.
const {readFileSync}=await import('node:fs');
const ts=(await import('typescript')).default;
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['getHealthGoals','getGoalAwareSettings','adoptGoalNotes','performGoalAdoption','writeGoalNote','saveNutrientGoal','updateBuiltInHealthGoalTarget']);
const methods=[];
(function visit(node){if(ts.isMethodDeclaration(node)&&names.has(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);})(ast);
class File {constructor(path,text=''){this.path=path;this.text=text;this.extension='md';this.basename=path.split('/').at(-1).replace(/\.md$/,'');}}
class MarkdownView {}
const deps={...m,TFile:File,MarkdownView,normalizePath:p=>p,stringifyYaml:fm=>JSON.stringify(fm)+'\n'};
const compiled=ts.transpileModule('export class Commands {'+methods.join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};new Function('exports',...Object.keys(deps),compiled)(exports,...Object.values(deps));
const parse=file=>JSON.parse(file.text.slice(4,file.text.lastIndexOf('---')));
function harness(){
 let stored=m.normalizeTPSHealthSettings({...m.DEFAULT_SETTINGS,calorieGoal:1650,proteinGoalG:125});
 const files=new Map(),events=[],writes=[];
 const plugin=new exports.Commands();plugin.settings=structuredClone(stored);
 const index=new m.HealthGoalNotes();
 plugin.nativeRecordService={goalNotes:index,getDailyIndexStatus:()=> 'ready',refreshGoalNote:async file=>index.project(file.path,parse(file))};
 plugin.loadData=async()=>structuredClone(stored);
 plugin.saveSettings=async()=>{stored=m.settingsPersistencePayload(plugin.settings);plugin.settings=m.normalizeTPSHealthSettings(stored);};
 plugin.getGcmAtomicHealthIdentityApi=()=>({ensureInternalIdInFrontmatter:fm=>{fm.id='id-'+files.size;}});
 plugin.app={workspace:{trigger:event=>events.push(event),iterateAllLeaves:()=>{}},vault:{
  getAbstractFileByPath:path=>files.get(path),
  createFolder:async path=>files.set(path,{path}),
  create:async(path,text)=>{if(files.has(path))throw Error('exists');const file=new File(path,text);files.set(path,file);writes.push(path);return file;},
  read:async file=>file.text,
 }};
 plugin.processHealthFrontmatter=async(file,callback)=>{const fm=parse(file);callback(fm);file.text='---\n'+JSON.stringify(fm)+'\n---\n'+(file.body||'');writes.push(file.path);};
 return {plugin,files,index,writes,events,get stored(){return stored;},set stored(value){stored=value;}};
}
test('explicit adoption preserves all effective targets and unrelated settings, then future saves retain note ownership',async()=>{
 const h=harness(),expected=JSON.parse(JSON.stringify(h.plugin.getHealthGoals()));
 h.stored={...h.stored,unrelatedPrivateValue:'preserve'};h.plugin.settings.unrelatedPrivateValue='preserve';
 await h.plugin.adoptGoalNotes('Inbox/Goals');
 assert.deepEqual(h.plugin.getHealthGoals(),expected);
 assert.equal(h.stored.goalStorage,'notes');assert.equal(h.stored.unrelatedPrivateValue,'preserve');
 for(const key of m.GOAL_SETTINGS_KEYS)assert.equal(Object.hasOwn(h.stored,key),false);
 const count=h.writes.length;await h.plugin.adoptGoalNotes();assert.equal(h.writes.length,count);
 await h.plugin.saveSettings();assert.deepEqual(h.plugin.getHealthGoals(),expected);
});
test('partial adoption can resume identical goal notes without duplicate creates or silent overwrite',async()=>{
 const h=harness(),create=h.plugin.app.vault.create;let attempts=0;
 h.plugin.app.vault.create=async(...args)=>{if(++attempts===3)throw Error('create failed');return create(...args);};
 await assert.rejects(h.plugin.adoptGoalNotes('Inbox/Goals'),/create failed/);
 assert.equal(h.stored.goalStorage,'settings');const before=h.writes.slice();
 h.plugin.app.vault.create=create;await h.plugin.adoptGoalNotes('Inbox/Goals');
 assert.equal(new Set(h.writes).size,h.writes.length);assert.deepEqual(h.writes.slice(0,2),before);
 assert.equal(h.stored.goalStorage,'notes');
});
test('concurrent settings changes block adoption authority switch',async()=>{
 const h=harness(),create=h.plugin.app.vault.create;
 h.plugin.app.vault.create=async(...args)=>{const file=await create(...args);h.stored={...h.stored,proteinGoalG:160};return file;};
 await assert.rejects(h.plugin.adoptGoalNotes('Inbox/Goals'),/changed during adoption/);
 assert.equal(h.stored.goalStorage,'settings');assert.equal(h.stored.proteinGoalG,160);
});
test('target edits use the moved note, preserve identity/body/user fields, and fail on a fresh target conflict',async()=>{
 const h=harness();await h.plugin.adoptGoalNotes('Inbox/Goals');
 let entry=h.index.entries().find(e=>e.goal.propertyKey==='protein');const file=h.files.get(entry.path);
 const old=file.path;file.path='Inbox/Renamed protein.md';h.files.delete(old);h.files.set(file.path,file);h.index.rename(old,file.path);
 const fm={...parse(file),userProperty:'keep'};file.body='User body\n';file.text='---\n'+JSON.stringify(fm)+'\n---\n'+file.body;h.index.project(file.path,fm);
 await h.plugin.saveNutrientGoal('protein','150','');
 assert.equal(parse(file).goalMinimum,150);assert.equal(parse(file).id,fm.id);assert.equal(parse(file).userProperty,'keep');assert.ok(file.text.endsWith(file.body));
 const boundary=h.plugin.processHealthFrontmatter;
 h.plugin.processHealthFrontmatter=async(file,callback)=>boundary(file,fields=>{fields.goalMinimum=175;callback(fields);});
 await assert.rejects(h.plugin.saveNutrientGoal('protein','160',''),/changed while editing/);
 assert.equal(parse(file).goalMinimum,150);
});
test('an unsaved goal editor blocks writes and a loading index blocks nutrition writes',async()=>{
 const h=harness();await h.plugin.adoptGoalNotes('Inbox/Goals');
 const entry=h.index.entries().find(e=>e.goal.propertyKey==='protein'),file=h.files.get(entry.path);
 const view=Object.assign(new MarkdownView(),{file,getMode:()=> 'source',editor:{getValue:()=>file.text+'draft'}});
 h.plugin.app.workspace.iterateAllLeaves=callback=>callback({view});
 await assert.rejects(h.plugin.saveNutrientGoal('protein','160',''),/unsaved editor/);
 assert.equal(parse(file).goalMinimum,125);
 h.plugin.nativeRecordService.getDailyIndexStatus=()=> 'loading';
 assert.throws(()=>h.plugin.getHealthGoals(true),/still loading/);
});
