import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const {load:parseYaml} = require('js-yaml');
const getFrontMatterInfo = source => {
 const match=source.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/);
 return match?{exists:true,frontmatter:match[1]||'',contentStart:match[0].length}:{exists:false,frontmatter:'',contentStart:0};
};
const bundle=await build({stdin:{contents:'export * from "./src/daily-nutrition-rollup";export * from "./src/daily-nutrition-source";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian']});
const module={exports:{}};
new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,id=>id==='obsidian'?{getFrontMatterInfo,parseYaml}:require(id));
const {dailyNutritionValues,needsDailyNutritionUpdate,dailyNutritionSource,normalizeDailyNutritionRollup}=module.exports;

test('selected indexed nutrients sum accurately; missing, blank days and overflow are unknown',()=>{
 assert.deepEqual(dailyNutritionValues([{calories:95,proteinG:.6},{calories:190,proteinG:1.2}],['consumedCalories','protein']),{consumedCalories:285,protein:1.8});
 assert.deepEqual(dailyNutritionValues([{calories:95},{calories:0,proteinG:0}],['consumedCalories','protein']),{consumedCalories:95,protein:null});
 assert.deepEqual(dailyNutritionValues([],['protein']),{protein:null});
 assert.deepEqual(dailyNutritionValues([{sodiumMg:0}],['sodium']),{sodium:0});
 assert.equal(dailyNutritionValues([{proteinG:1e308},{proteinG:1e308}],['protein']).protein,null);
 assert.throws(()=>dailyNutritionValues([],['id']),/unavailable/);
 assert.equal(needsDailyNutritionUpdate({}, {protein:null}),false);
});
test('opt-in preferences preserve unknown custom selections and reject invalid modes/keys',()=>{
 assert.equal(normalizeDailyNutritionRollup(null).mode,'off');
 assert.deepEqual(normalizeDailyNutritionRollup({mode:'automatic',nutrients:['cal','consumedCalories','protein','x.y',null]}),{mode:'automatic',nutrients:['consumedCalories','protein']});
 assert.deepEqual(normalizeDailyNutritionRollup({mode:'unsafe',nutrients:[]}),{mode:'off',nutrients:[]});
});
for(const newline of ['\n','\r\n']) test(`source patch preserves comments, identity, unrelated YAML and body (${JSON.stringify(newline)})`,()=>{
 const source=['---','# keep comment',"id: 'unchanged'",'protein: 3 # keep unit comment','tags:','  - personal','---','User body','```base','views: []','```',''].join(newline);
 const expected=source.replace('protein: 3 #','protein: 12.5 #').replace('---'+newline+'User body','consumedCalories: 95'+newline+'---'+newline+'User body');
 assert.equal(dailyNutritionSource(source,{protein:12.5,consumedCalories:95}),expected);
 assert.equal(dailyNutritionSource(expected,{protein:12.5,consumedCalories:95}),expected);
 assert.equal(dailyNutritionSource(expected,{protein:null}),expected.replace('protein: 12.5 #','protein: null #'));
 assert.equal(dailyNutritionSource('Body'+newline,{protein:0}),['---','protein: 0','---','Body',''].join(newline));
});
test('empty, quoted, BOM, malformed and complex daily properties are handled without silent destruction',()=>{
 assert.equal(dailyNutritionSource('---\n---\nBody',{protein:1}),'---\nprotein: 1\n---\nBody');
 assert.equal(dailyNutritionSource('\uFEFF---\n"protein": 1\n---\nBody',{protein:2}),'\uFEFF---\nprotein: 2\n---\nBody');
 for(const source of ['---\nprotein: [1,2]\n---\nBody','---\nprotein: 1\nprotein: 2\n---\nBody','---\nprotein: |\n  user\n---\nBody','---\nunfinished','---\nProtein: 1\n---\nBody']) assert.throws(()=>dailyNutritionSource(source,{protein:4}));
});

const main=readFileSync('src/main.ts','utf8'), ast=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
const methods=[];
(function visit(node){if(ts.isMethodDeclaration(node)&&['updateDailyNutritionTotals','queueDailyNutritionTotals'].includes(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);})(ast);
class TFile {constructor(path){this.path=path;this.extension='md';}}
class MarkdownView {}
const deps={...module.exports,getFrontMatterInfo,parseYaml,TFile,MarkdownView,configuredNativePropertyKey:(_s,key)=>key,logger:{flowWarn() {},errorSummary:()=>''},Notice:class {}};
const compiled=ts.transpileModule('export class Commands {'+methods.join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};new Function('exports',...Object.keys(deps),compiled)(exports,...Object.values(deps));
function harness(){
 const plugin=new exports.Commands(), file=new TFile('Daily/2026-10-26.md');
 const h={plugin,file,source:'---\nid: keep\n---\nBody\n',rows:[{calories:95,proteinG:.6}],writes:0,reads:0,processes:0,lookups:0,leaves:[],eligible:true,archived:false,hook:null,ready:true};
 plugin.dailyNutritionStopped=false;plugin.pendingDailyNutritionDates=new Set();plugin.dailyNutritionDrain=null;
 plugin.settings={dailyNutritionRollup:{mode:'automatic',nutrients:['consumedCalories','protein']}};
 const fields=()=>parseYaml(getFrontMatterInfo(h.source).frontmatter);
 const api={dailyNotes:{findForIsoDate:date=>{h.lookups++;return date==='2026-10-26'?file:null;}},templates:{canAutomaticallyMutate:async()=>h.eligible,canAutomaticallyMutateSource:()=>h.eligible,canAutomaticallyMutateFrontmatter:fm=>fm.template!==true},frontmatterKinds:{snapshot:()=>({})}};
 plugin.getGcmApi=()=>api;plugin.getGcmNativeRecordsApi=()=>({getStorageProfile:()=>({identityPropertyKey:'id'})});
 plugin.nativeRecordService={getDailyFoodNutrition:()=>{if(!h.ready)throw Error('loading');return h.rows;}};
 plugin.app={plugins:{plugins:{'tps-global-context-menu':{settings:{frontmatterAutoWriteExclusions:''}}}},vault:{getAbstractFileByPath:path=>path===file.path?file:null,read:async()=>{h.reads++;return h.source;},process:async(_file,fn)=>{h.processes++;h.hook?.();const next=fn(h.source);if(next!==h.source){h.writes++;h.source=next;}}},metadataCache:{getFileCache:()=>({frontmatter:{...fields(),archived:h.archived}})},workspace:{iterateAllLeaves:callback=>h.leaves.forEach(view=>callback({view}))}};
 return h;
}
test('real writer updates only current existing date, avoids no-op queues, and refreshes changes/deletions',async()=>{
 const h=harness();assert.equal(await h.plugin.updateDailyNutritionTotals('2026-10-26'),'updated');
 assert.equal(h.writes,1);assert.ok(h.source.endsWith('Body\n'));assert.match(h.source,/protein: 0.6/);
 const before=[h.reads,h.processes];for(let i=0;i<100;i++) assert.equal(await h.plugin.updateDailyNutritionTotals('2026-10-26'),'unchanged');
 assert.deepEqual([h.reads,h.processes],before);
 h.rows=[{calories:190,proteinG:1.2}];await h.plugin.updateDailyNutritionTotals('2026-10-26');assert.match(h.source,/protein: 1.2/);
 h.rows=[];await h.plugin.updateDailyNutritionTotals('2026-10-26');assert.match(h.source,/protein: null/);
 assert.equal(await h.plugin.updateDailyNutritionTotals('2020-01-01'),'skipped');assert.equal(h.writes,3);
});
test('automatic bursts coalesce dates and stop when disabled/unloaded; commands still work in manual mode',async()=>{
 const h=harness();for(let i=0;i<100;i++)h.plugin.queueDailyNutritionTotals(['2026-10-26']);await h.plugin.dailyNutritionDrain;assert.equal(h.writes,1);assert.equal(h.processes,1);
 h.rows=[{calories:200,proteinG:2}];h.plugin.settings.dailyNutritionRollup.mode='manual';h.plugin.queueDailyNutritionTotals(['2026-10-26']);await h.plugin.dailyNutritionDrain;assert.equal(h.writes,1);
 await h.plugin.updateDailyNutritionTotals('2026-10-26');assert.equal(h.writes,2);
 h.plugin.settings.dailyNutritionRollup.mode='off';assert.equal(await h.plugin.updateDailyNutritionTotals('2026-10-26'),'skipped');
});
test('exclusions, wrong daily identity, pending index, dirty editors and concurrent sources refuse writes',async()=>{
 for(const condition of ['excluded','archived','wrong','loading','dirty','source','editor','settings','template','exclusions','new-values']){
  const h=harness();
  if(condition==='excluded')h.eligible=false;
  if(condition==='archived')h.archived=true;
  if(condition==='loading')h.ready=false;
  if(condition==='dirty')h.leaves=[Object.assign(new MarkdownView(),{file:h.file,getMode:()=> 'source',editor:{getValue:()=>h.source+'draft'}})];
  if(condition==='source')h.hook=()=>{h.source+='User edit\n';};
  if(condition==='editor')h.hook=()=>{h.leaves=[Object.assign(new MarkdownView(),{file:h.file,getMode:()=> 'source',editor:{getValue:()=>h.source+'draft'}})];};
  if(condition==='settings')h.hook=()=>{h.plugin.settings.dailyNutritionRollup.mode='off';};
  if(condition==='template')h.hook=()=>{h.eligible=false;};
  if(condition==='exclusions')h.hook=()=>{h.plugin.app.plugins.plugins['tps-global-context-menu'].settings.frontmatterAutoWriteExclusions='Inbox/**';};
  if(condition==='new-values')h.hook=()=>{h.rows=[{calories:220,proteinG:3}];};
  try{await h.plugin.updateDailyNutritionTotals('2026-10-26',condition==='wrong'?new TFile('Wrong.md'):undefined);}catch{}
  if(condition==='new-values'){assert.match(h.source,/protein: 3/);assert.equal(h.writes,1);}else assert.equal(h.writes,0,condition);
 }
});
test('automatic source owns only indexed nutrition changes, never navigation or startup backfill',()=>{
 assert.match(main,/onRecordsChanged\(change => \{\s*if \(this.settings.dailyNutritionRollup.mode !== 'automatic' \|\| !change.nutritionChanged/);
 assert.doesNotMatch(methods.join('\n'),/getMarkdownFiles|getFiles\(|setTimeout|setInterval|create\(|cachedRead/);
});
