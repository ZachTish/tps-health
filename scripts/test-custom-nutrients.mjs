import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result = await build({stdin:{contents:['nutrient-goals','nutrients','format','native-daily-dashboard','food-data-quality','settings-normalization','health-property-catalog','types'].map(name=>`export * from './${name}';`).join('\n'),resolveDir:fileURLToPath(new URL('../src',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false});
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
  const totals={dateIso:'2026-09-18',entryCount:2};
  m.addExtraNutrition(totals,m.extraNutrition(nutrition,.5));
  m.addExtraNutrition(totals,m.extraNutrition(nutrition,.5));
  const model=m.buildNativeDailyDashboardModel(totals,[]);
  assert.deepEqual(model.metrics.map(n=>[n.propertyKey,n.label,n.value,n.unit,n.targetLabel]),definitions.map(n=>[n.key,n.label,nutrition[n.key],n.unit,'']));
  assert.deepEqual(m.nativeDailyNutrientContributors(definitions[0].key,[{title:'Food',path:'a',...nutrition}]).map(n=>n.value),[121.25]);
  assert.match(m.foodDataDetail({nutrition}),/Polyphenols: 121.3 mg/);
  assert.match(m.foodDataDetail({nutrition}),/Live cultures: 2 billion CFU/);
  assert.equal(m.availableNutrientConfigs([]).find(n=>n.propertyKey==='healthNutrient_cultures').label,'Live cultures');
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

test('detailed catalog searches categories and maps exact USDA units without inferred totals',()=>{
 const catalog=m.goalNutrients();
 assert.equal(catalog.length,98);
 assert.equal(new Set(catalog.map(n=>n.key)).size,98);
 for(const group of ['Vitamins','Minerals','Amino acids','Fats','Carbohydrates','Vitamin forms','Supplements']) assert.ok(catalog.some(n=>n.group===group));
 assert.deepEqual(m.filterGoalNutrients(catalog,'leucine','Amino acids').map(n=>n.label),['Isoleucine','Leucine']);
 assert.equal(m.filterGoalNutrients(catalog,'epa','Fats')[0].key,'epaG');
 assert.deepEqual(m.usdaExtraNutrition([
  {nutrient:{name:'Leucine',unitName:'g'},amount:1.25},
  {nutrientName:'Fatty acids, total saturated',unitName:'G',value:2.5},
  {nutrientName:'Carotene, beta',unitName:'µg',value:42},
  {nutrientName:'Folic acid',unitName:'mg',value:.2},
  {nutrientName:'Glutamic acid',unitName:'g',value:0},
  {nutrientName:'Vitamin A',unitName:'IU',value:300},
 ]),{leucineG:1.25,saturatedFatG:2.5,betaCaroteneMcg:42,folicAcidMcg:200,glutamicAcidG:0});
 assert.equal(m.usdaExtraNutrition([{nutrientName:'Leucine',unitName:'g',value:null}]).leucineG,undefined);
 const food={leucineG:1.25,epaG:.12,starchG:10,folicAcidMcg:200};
 assert.deepEqual(m.extraNutrition(food,.5),{leucineG:.625,epaG:.06,starchG:5,folicAcidMcg:100});
 assert.match(m.foodDataDetail({nutrition:food}),/Leucine: 1.3 g/);
});

test('structured targets persist ranges, zero and no-target goals while keeping labels and colors',()=>{
 const settings=m.normalizeTPSHealthSettings({});
 settings.healthGoals.push({propertyKey:'magnesiumMg',label:'My magnesium',unit:'mg',kind:'min',min:80,color:'#abcd12'});
 Object.assign(settings,m.nutrientGoalChange(settings,'magnesiumMg','100.5','400'));
 let goal=m.findNutrientGoal(m.normalizeTPSHealthSettings(JSON.parse(JSON.stringify(settings))).healthGoals,'magnesiumMg');
 assert.deepEqual(goal,{propertyKey:'magnesiumMg',label:'My magnesium',unit:'mg',kind:'range',min:100.5,max:400,color:'#abcd12'});
 Object.assign(settings,m.nutrientGoalChange(settings,'magnesiumMg','','0'));
 assert.equal(m.findNutrientGoal(settings.healthGoals,'magnesiumMg').max,0);
 assert.equal(m.findNutrientGoal(settings.healthGoals,'magnesiumMg').min,undefined);
 Object.assign(settings,m.nutrientGoalChange(settings,'magnesiumMg','',''));
 goal=m.findNutrientGoal(settings.healthGoals,'magnesiumMg'); assert.equal(goal.kind,'counter'); assert.equal(goal.max,undefined);
 const model=m.buildNativeDailyDashboardModel({dateIso:'2026-09-18',entryCount:1,magnesiumMg:20},[goal]);
 assert.equal(model.metrics.find(n=>n.propertyKey==='magnesiumMg').targetLabel,'');
 Object.assign(settings,m.nutrientGoalChange(settings,'magnesiumMg','','',true));
 assert.equal(m.findNutrientGoal(settings.healthGoals,'magnesiumMg'),undefined);
 assert.ok(m.buildNativeDailyDashboardModel({dateIso:'2026-09-18',entryCount:1,magnesiumMg:20},[]).metrics.some(n=>n.propertyKey==='magnesiumMg'));
 for(const [min,max] of [['-1',''],['NaN',''],['1','0'],['','Infinity'],['false',''],['1,200','']]) assert.throws(()=>m.nutrientGoalChange(settings,'leucineG',min,max));
 assert.throws(()=>m.nutrientGoalChange(settings,'notRegistered','',''));
});

test('structured targets keep canonical scalar contracts, legacy aliases and other saved metrics',()=>{
 const settings=m.normalizeTPSHealthSettings({});
 settings.healthGoals[0]={propertyKey:'cal',label:'Energy',unit:'kcal',kind:'max',max:2400,color:'blue'};
 Object.assign(settings,m.nutrientGoalChange(settings,'consumedCalories','1800','2200'));
 Object.assign(settings,m.nutrientGoalChange(settings,'protein','150','200'));
 const reloaded=m.normalizeTPSHealthSettings(JSON.parse(JSON.stringify(settings)));
 assert.equal(reloaded.calorieGoal,2200);assert.equal(reloaded.proteinGoalG,150);
 assert.equal(reloaded.healthGoals.filter(n=>['cal','consumedCalories'].includes(n.propertyKey)).length,1);
 assert.equal(reloaded.healthGoals[0].propertyKey,'cal');assert.equal(reloaded.healthGoals[0].color,'blue');
 assert.equal(reloaded.healthGoals[0].min,1800);assert.equal(reloaded.healthGoals[0].max,2200);
 assert.throws(()=>m.nutrientGoalChange(settings,'consumedCalories','',''));
 assert.throws(()=>m.nutrientGoalChange(settings,'protein','0',''));
 assert.throws(()=>m.nutrientGoalChange(settings,'protein','','',true));
 assert.deepEqual(m.goalNutrients([{propertyKey:'otherLegacyMetric',label:'Other legacy',unit:'times',kind:'counter'}]).at(-1),{key:'otherLegacyMetric',label:'Other legacy',unit:'times',group:'Other saved goals'});
});

test('arbitrary and archived nutrients share the same goal picker',()=>{
 try {
  m.configureCustomNutrients([{...definitions[0],archived:true},definitions[1]]);
  const settings=m.normalizeTPSHealthSettings({customNutrients:definitions});
  assert.equal(m.goalNutrients().find(n=>n.key===definitions[0].key).archived,true);
  Object.assign(settings,m.nutrientGoalChange(settings,definitions[1].key,'2.5',''));
  const goal=m.findNutrientGoal(settings.healthGoals,definitions[1].key);
  assert.equal(goal.unit,'billion CFU');assert.equal(goal.min,2.5);
  assert.equal(m.buildNativeDailyDashboardModel({entryCount:1,healthNutrient_cultures:3},[goal]).metrics[0].state,'within');
 } finally {m.configureCustomNutrients([]);}
});
