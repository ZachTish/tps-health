import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result = await build({stdin:{contents:['nutrients','format','native-daily-dashboard','macros-base-model','food-data-quality','settings-normalization','health-property-catalog','types'].map(name=>`export * from './${name}';`).join('\n'),resolveDir:fileURLToPath(new URL('../src',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const definitions=[{key:'healthNutrient_polyphenols',label:'Polyphenols',unit:'mg'},{key:'healthNutrient_cultures',label:'Live cultures',unit:'billion CFU'}];

test('arbitrary names and units flow through servings, atomic lines, totals and macro rows after modules load',()=>{
 const catalogBefore=m.buildHealthPropertyCatalog(m.DEFAULT_SETTINGS);
 try {
  m.configureCustomNutrients(definitions);
  const nutrition={healthNutrient_polyphenols:121.25,healthNutrient_cultures:2,unrelatedNumber:99};
  assert.deepEqual(m.extraNutrition(nutrition,.5),{healthNutrient_polyphenols:60.625,healthNutrient_cultures:1});
  const line=m.foodEntryLine({id:'custom',item:{id:'f',name:'Custom food',source:'manual',nutrition},quantity:.5,unit:'serving',createdDate:'2026-09-18T12:00:00Z'});
  assert.match(line,/\[healthNutrient_polyphenols:: 60.625\]/);
  assert.match(line,/\[healthNutrient_cultures:: 1\]/);
  const totals=m.sumMacroEntries('2026-09-18',[{path:'a',...m.extraNutrition(nutrition,.5)},{path:'b',...m.extraNutrition(nutrition,.5)}]);
  const model=m.buildNativeDailyDashboardModel(totals,[]);
  assert.deepEqual(model.metrics.map(n=>[n.propertyKey,n.label,n.value,n.unit,n.targetLabel]),definitions.map(n=>[n.key,n.label,nutrition[n.key],n.unit,'']));
  assert.deepEqual(m.nativeDailyNutrientContributors(definitions[0].key,[{title:'Food',path:'a',...nutrition}]).map(n=>n.value),[121.25]);
  assert.match(m.foodDataDetail({nutrition}),/Polyphenols: 121.3 mg/);
  assert.match(m.foodDataDetail({nutrition}),/Live cultures: 2 billion CFU/);
  const visible=m.visibleMacroGoals(m.availableNutrientConfigs([]),['note.healthNutrient_cultures'],m.DEFAULT_SETTINGS);
  assert.equal(visible[0].label,'Live cultures');
  assert.deepEqual(m.buildHealthPropertyCatalog(m.DEFAULT_SETTINGS),catalogBefore,'no automatic GCM catalog/menu fields');
 } finally {m.configureCustomNutrients([]);}
});

test('custom definitions survive settings reload and archive while invalid keys/amounts stay excluded',()=>{
 const saved=m.normalizeTPSHealthSettings({customNutrients:[...definitions,{key:'quantity',label:'Collision',unit:'g'},{key:'__proto__',label:'Bad',unit:'g'},definitions[0],{key:'healthNutrient_bad',label:'',unit:'g'}]});
 assert.deepEqual(saved.customNutrients,definitions);
 try {
  m.configureCustomNutrients(JSON.parse(JSON.stringify(saved)).customNutrients);
  assert.deepEqual(m.extraNutrition({healthNutrient_polyphenols:0,healthNutrient_cultures:null}),{healthNutrient_polyphenols:0});
  assert.deepEqual(m.extraNutrition({healthNutrient_polyphenols:-1,healthNutrient_cultures:Infinity}),{});
  m.configureCustomNutrients([{...definitions[0],label:'Renamed amount',archived:true}]);
  assert.equal(m.availableNutrientConfigs([]).find(n=>n.propertyKey===definitions[0].key).label,'Renamed amount');
  assert.equal(m.extraNutrition({healthNutrient_polyphenols:8})[definitions[0].key],8,'archive preserves tracking');
 } finally {m.configureCustomNutrients([]);}
});
