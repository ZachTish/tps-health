import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:'export * from "./src/food-log-presentation"; export * from "./src/food-base-formulas"; export * from "./src/food-log-upgrade";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm'});
const {foodLogBody,prepareFoodLogCreation,calculatedFoodLogKeys,foodNutrientBaseFormula,foodLogUpgrade,upgradeFoodBaseFormulas,commitFoodUpgrade}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settings={nativeRecordProperties:{food:'meal',quantity:'consumed',unit:'portionUnit',calories:'energy'},nativeRecordPropertyAliases:{calories:['legacyEnergy']}};
test('creation stores consumption with one native Base body and no nutrient copies',()=>{
 const properties={title:'Lunch',meal:'[[Food]]',consumed:2,portionUnit:'can',energy:190,proteinG:3,legacyEnergy:190,user:'keep'};
 const before=structuredClone(properties),result=prepareFoodLogCreation(settings,[],properties);
 assert.deepEqual(properties,before);assert.deepEqual(result.properties,{title:'Lunch',meal:'[[Food]]',consumed:2,portionUnit:'can',user:'keep'});
 const base=JSON.parse(result.body.match(/```base\n([\s\S]+)\n```/)[1]);
 assert.match(base.filters.and[1],/this\["meal"\]/);assert.equal(base.formulas.healthFood,'file');
 assert.match(base.formulas.healthServings,/this\["consumed"\]/);
 assert.match(base.formulas.healthUnit,/this\["portionUnit"\]/);
 assert.ok(base.views[0].order.every(key=>key.startsWith('formula.')),'all displayed columns are read-only calculations');
 assert.ok(base.views[0].order.includes('formula.alcoholG'));
 assert.doesNotMatch(base.formulas.calories,/note\["energy"\]/);
 assert.doesNotMatch(base.formulas.calories,/stored/);
});
test('ordinary log Base calculations no longer require a stored nutrient membership marker',()=>{
 const formula=foodNutrientBaseFormula(settings,'calories');
 assert.doesNotMatch(formula,/note\["energy"\] != null/);
 assert.match(formula,/note\["meal"\].isEmpty\(\)/,'only old unlinked estimates can use saved values');
 assert.match(formula,/formula.healthFood.properties\["calories"\]/);
});
test('calculations are deterministic and do not enumerate notes or mutate inputs',()=>{
 const original=structuredClone(settings),body=foodLogBody(settings,[]);
 for(let i=0;i<1000;i++)assert.equal(foodLogBody(settings,[]),body);
 assert.deepEqual(settings,original);assert.ok(calculatedFoodLogKeys(settings).includes('legacyEnergy'));
});


test('explicit conversion preserves body and unrelated fields; repeat conversion is a no-op',()=>{
 const body='My meal notes.\n\n- [ ] Keep this\n';
 const fm={id:'log-1',kind:'food-entry',energy:100,user:'Keep',meal:'[[Food]]',consumed:2,portionUnit:'can'};
 const result=foodLogUpgrade(fm,body,settings,foodLogBody(settings,[]));
 assert.ok(result.body.startsWith(body));assert.deepEqual(result.removed,['energy']);
 assert.equal(result.frontmatter.id,'log-1');assert.equal(result.frontmatter.user,'Keep');
 assert.equal(foodLogUpgrade(result.frontmatter,result.body,settings,foodLogBody(settings,[])).changed,false);
 assert.equal(fm.energy,100);
});
test('Base upgrade changes only exact earlier Health expressions, including summary wrappers',()=>{
 const current=foodNutrientBaseFormula(settings,'calories');
 const old=current.replace('note["meal"].isEmpty() && ','').replace('if(formula.healthServings != null','if(note["energy"] != null && formula.healthServings != null');
 const base={filters:'user filter',formulas:{calories:`if(healthGoal, goalMaximum, ${old})`,custom:'energy*2'},views:[{type:'table',name:'Mine',groupBy:{property:'tags'}}]};
 const original=structuredClone(base),result=upgradeFoodBaseFormulas(base,settings);
 assert.equal(result.formulas.calories,`if(healthGoal, goalMaximum, ${current})`);
 assert.equal(result.formulas.custom,'energy*2');assert.deepEqual(result.views,base.views);assert.deepEqual(base,original);
 assert.equal(upgradeFoodBaseFormulas(result,settings),null);
});
test('conversion backs up first and refuses fresh source, editor or configuration conflicts',async()=>{
 for(const conflict of ['source','guard','backup','none']) {
  let allowed=true,source='old';const events=[];
  const options={source:'old',next:'new',allowed:()=>allowed,backup:async()=>{events.push('backup');if(conflict==='backup')throw Error('backup failed');if(conflict==='guard')allowed=false;if(conflict==='source')source='user edit';},process:async callback=>{events.push('process');source=callback(source);}};
  if(conflict==='none'){assert.equal(await commitFoodUpgrade(options),true);assert.equal(source,'new');}
  else {await assert.rejects(commitFoodUpgrade(options));assert.equal(source,conflict==='source'?'user edit':'old');}
  assert.equal(events[0],'backup');
 }
 let calls=0;
 assert.equal(await commitFoodUpgrade({source:'same',next:'same',allowed:()=>{calls++;return true;},backup:async()=>{calls++;},process:async()=>{calls++;}}),false);
 assert.equal(calls,0);
 await assert.rejects(commitFoodUpgrade({source:'a',next:'b',allowed:()=>false,backup:async()=>{calls++;},process:async()=>{calls++;}}));assert.equal(calls,0);
});
