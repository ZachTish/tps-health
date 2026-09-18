import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
async function load(path) {
 const result=await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {groupMacroDays,sumMacroEntries,validMacroDate,visibleMacroGoals,defaultMacrosBaseContent,initializeMacrosDateType}=await load('../src/macros-base-model.ts');
const {DEFAULT_SETTINGS}=await load('../src/types.ts');
const entry=(path,day,calories)=>({path,dateIso:day,calories,proteinG:5,carbsG:10,fatG:2,fiberG:1,sugarG:2,sugarAlcoholG:0,alcoholG:0,sodiumMg:20});
test('filtered results remain separated by consumed day and retain Base sorting',()=>{
 const days=groupMacroDays([entry('b','2026-09-14',200),entry('a','2026-09-13',100),entry('c','2026-09-14',300)]);
 assert.deepEqual([...days.keys()],['2026-09-14','2026-09-13']);
 assert.equal(sumMacroEntries('2026-09-14',days.get('2026-09-14')).calories,500);
 assert.equal(sumMacroEntries('2026-09-13',days.get('2026-09-13')).calories,100);
});
test('duplicates and invalid dates do not inflate day totals',()=>{
 const days=groupMacroDays([entry('a','2026-09-14',100),entry('a','2026-09-14',100),entry('b','2026-02-30',200)]);
 assert.equal(days.size,1);assert.equal(days.get('2026-09-14').length,1);
 assert.equal(validMacroDate('2026-02-30'),false);assert.equal(validMacroDate('2024-02-29'),true);
 assert.equal(validMacroDate(''),false);
});
test('only filtered foods contribute; no absent days or daily goal multiplication',()=>{
 const totals=sumMacroEntries('2026-09-14',[entry('selected','2026-09-14',123)]);
 assert.equal(totals.entryCount,1);assert.equal(totals.calories,123);assert.equal(totals.proteinG,5);
});
test('Properties ordering and hiding use configured nutrient keys',()=>{
 const settings={...DEFAULT_SETTINGS,nativeRecordProperties:{...DEFAULT_SETTINGS.nativeRecordProperties,proteinG:'myProtein'}};
 const goals=[{propertyKey:'consumedCalories'},{propertyKey:'protein'},{propertyKey:'sodium'}];
 assert.deepEqual(visibleMacroGoals(goals,['note.sodiumMg','note.myProtein'],settings),[goals[2],goals[1]]);
 assert.deepEqual(visibleMacroGoals(goals,[],settings),[]);
 assert.deepEqual(visibleMacroGoals(goals,['note.proteinG'],settings),[]);
});
test('new Base uses native filter syntax and mapped dates/kinds without overwriting files',()=>{
 const config=JSON.parse(defaultMacrosBaseContent({...DEFAULT_SETTINGS,nativeRecordKinds:{...DEFAULT_SETTINGS.nativeRecordKinds,foodEntry:'eaten-food'},nativeRecordProperties:{...DEFAULT_SETTINGS.nativeRecordProperties,completedDate:'consumedAt'}}));
 assert.ok(config.filters.and[0].or.includes('note.kind == "eaten-food"'));
 assert.deepEqual(config.views[0].filters.and,[]);
 assert.equal(config.formulas.Day,'date(note.consumedAt).date()');
 assert.equal(config.views[0].sort[0].property,'note.consumedAt');
 assert.equal(config.views[0].type,'tps-health-macros');
 assert.ok(config.views[0].order.includes('note.calories'));
});

const {claimMacrosBaseNew}=await load('../src/macros-base-toolbar.ts');
test('native New click and keyboard activation are owned by the exact Base only',()=>{
 const owner={},other={};let created=0,prevented=0;
 const container={parentElement:owner,isConnected:true,getClientRects:()=>[{}]};
 const event=(scope,type='click',key='',button=0)=>({type,key,button,target:{closest:()=>({closest:()=>({parentElement:scope})})},preventDefault(){prevented++},stopPropagation(){},stopImmediatePropagation(){}});
 assert.equal(claimMacrosBaseNew(event(other),container,()=>created++),false);
 assert.equal(claimMacrosBaseNew(event(owner),container,()=>created++),true);
 assert.equal(claimMacrosBaseNew(event(owner,'keydown','Enter'),container,()=>created++),true);
 assert.equal(claimMacrosBaseNew(event(owner,'keydown',' '),container,()=>created++),true);
 assert.equal(claimMacrosBaseNew(event(owner,'keydown','Escape'),container,()=>created++),false);
 assert.equal(claimMacrosBaseNew(event(owner,'click','',2),container,()=>created++),false);
 assert.equal(created,3);assert.equal(prevented,3);
 container.isConnected=false;
 assert.equal(claimMacrosBaseNew(event(owner),container,()=>created++),false);
});

test('date typing initializes only the configured unassigned property',()=>{
 const calls=[];
 const settings={...DEFAULT_SETTINGS,nativeRecordProperties:{...DEFAULT_SETTINGS.nativeRecordProperties,completedDate:'consumedAt'}};
 initializeMacrosDateType({metadataTypeManager:{getAssignedWidget:()=>null,setType:(...args)=>calls.push(args)}},settings);
 assert.deepEqual(calls,[['consumedAt','datetime']]);
 initializeMacrosDateType({metadataTypeManager:{getAssignedWidget:()=> 'text',setType:()=>assert.fail('must preserve chosen type')}},settings);
 initializeMacrosDateType({},settings);
});

const viewBundle = await build({entryPoints:[fileURLToPath(new URL('../src/macros-base-view.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'obsidian-stub',setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));build.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class BasesView {} export class Notice {}',loader:'js'}));}}]});
const {MacrosBaseView} = await import('data:text/javascript;base64,'+Buffer.from(viewBundle.outputFiles[0].text).toString('base64'));
test('Macros Base automatically includes recorded nutrients without visible properties; opt-out stays explicit',()=>{
  const node=()=>({scrollTop:0,addClass(){},empty(){},createDiv:()=>node(),createEl:()=>node(),addEventListener(){}});
  const calls=[];
  const plugin={settings:DEFAULT_SETTINGS,getMetricRenderConfigs:()=>[],nativeRecordService:{isEnabled:()=>true,getFoodEntriesForPaths:()=>[{...entry('a','2026-09-14',100),alcoholG:14,creatineG:5}]},renderMacrosBaseDay:(...args)=>calls.push(args)};
  const oldWindow=globalThis.window;
  globalThis.window={moment:()=>({format:()=> '2026-09-14'})};
  try {
    const view=new MacrosBaseView({},node(),plugin);
    let selection;
    view.config={getOrder:()=>[],getDisplayName:key=>key,get:key=>key==='nutrientSelection'?selection:undefined};
    view.data={groupedData:[{entries:[{file:{path:'a'}}],hasKey:()=>false}]};
    view.render();
    assert.equal(calls[0][6],true);
    assert.deepEqual(calls[0][3],[]);
    assert.equal(calls[0][2][0].creatineG,5);
    selection='properties';view.render();
    assert.equal(calls[1][6],false);
    view.config.getOrder=()=>['note.alcoholG','note.creatineG'];view.render();
    assert.deepEqual(calls[2][3].map(g=>g.propertyKey),['alcohol','creatineG']);
    assert.equal(MacrosBaseView.options({}).find(o=>o.key==='nutrientSelection').default,'recorded');
  } finally {globalThis.window=oldWindow;}
});
