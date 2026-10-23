import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";

const harnessUrl = new URL("./test-health-providers.mjs", import.meta.url);
globalThis.__TPSFreeFoodEsbuild = esbuild;
const harnessSource = readFileSync(harnessUrl, "utf8")
  .replace('import test from "node:test";', 'const test = () => {};')
  .replace('import * as esbuild from "esbuild";', 'const esbuild = globalThis.__TPSFreeFoodEsbuild;')
  .replaceAll("import.meta.url", JSON.stringify(harnessUrl.href));
const { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals, parseFrontmatter, importSettingsNormalizationUtility } = await import(`data:text/javascript;base64,${Buffer.from(harnessSource + "\nexport { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals, parseFrontmatter, importSettingsNormalizationUtility };\n//# sourceURL=free-food-harness.mjs").toString("base64")}`);
delete globalThis.__TPSFreeFoodEsbuild;


installDeterministicBrowserGlobals();
const m = await importPluginWithObsidianStub();
const plugin = () => {const p=new m.default(createFakeHealthApp().app);p.settings=JSON.parse(JSON.stringify(p.settings));p.settings.openFoodFactsUserAgent="TPSHealth/test";return p;};
window.setTimeout=(callback,ms)=>setTimeout(callback,ms);window.clearTimeout=handle=>clearTimeout(handle);

test('retired providers cannot execute even when old enabled settings and secrets remain',async()=>{
 const p=plugin(), calls=[];let secrets=0;
 p.settings.edamamEnabled=true;p.settings.nutritionixEnabled=true;
 p.app.secretStorage={getSecret:()=>{secrets++;return 'old-provider-secret'}};
 p.searchCustomFoods=async()=>[];p.searchUsdaFoods=async()=>[];p.searchOpenFoodFacts=async()=>[];p.getLoggedFoodStats=async()=>new Map();
 globalThis.__TPSHealthTestRequestUrl=async o=>{calls.push(o.url);throw Error('Unexpected provider request')};
 try {await p.searchFoods('synthetic product');assert.deepEqual(calls,[]);assert.equal(secrets,0);assert.equal(p.searchAdditionalFoods,undefined);}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});

test('OFF discovery makes one request with no stale nutrition; selection reads one current product',async()=>{
 const p=plugin(),calls=[];
 globalThis.__TPSHealthTestRequestUrl=async o=>{
  const url=new URL(o.url);calls.push(url);
  if(url.hostname==='search.openfoodfacts.org')return {status:200,json:{hits:[{code:'0012345678905',product_name:'Michelob Ultra',nutriments:{'energy-kcal_100g':999}}]}};
  assert.ok(url.pathname.startsWith('/api/v2/product/'),'no bulk search query');
  return {status:200,json:{status:1,product:{code:'0012345678905',product_name:'Michelob Ultra',brands:'Michelob',serving_size:'12 fl oz (355 ml)',nutriments:{'energy-kcal_serving':95,proteins_serving:.6,carbohydrates_serving:2.6,fat_serving:0}}}};
 };
 try{
  const rows=await p.searchOpenFoodFacts('michelob ultra');assert.equal(rows.length,1);assert.deepEqual(rows[0].nutrition,{});assert.equal(calls.length,1);
  assert.throws(()=>p.prepareFoodNoteItem(rows[0],'food'),/current product label/);assert.match(m.foodResultMeta(rows[0]),/loads when selected/);
  const full=await p.enrichFoodSearchItem(rows[0]);assert.equal(full.nutrition.calories,95);assert.equal(full.servingMl,355);assert.equal(calls.length,2);
  await p.enrichFoodSearchItem(rows[0]);for(let i=0;i<20;i++)await p.searchOpenFoodFacts('michelob ultra');assert.equal(calls.length,2,'repeated selection and query use existing caches');
 }finally{delete globalThis.__TPSHealthTestRequestUrl;}
});

test('USDA known-brand queries reserve their result page for Branded and omit connector words',async()=>{
 const p=plugin(),calls=[];
 globalThis.__TPSHealthTestRequestUrl=async o=>{
  const b=JSON.parse(o.body);calls.push(b);
  const foods=b.dataType.length===1&&b.dataType[0]==='Branded'&&b.query==='kraft macaroni cheese' ? [{fdcId:123,description:'MACARONI & CHEESE',brandName:'KRAFT',publishedDate:'2026-01-01',foodNutrients:[{nutrientId:1008,value:200}]}] : [];
  return {status:200,json:{foods}};
 };
 try{
  const rows=await p.searchUsdaFoods('kraft macaroni and cheese');assert.equal(rows.length,1);assert.equal(rows[0].nutrition.calories,200);assert.deepEqual(calls[0].dataType,['Branded']);assert.equal(calls.length,1);assert.equal(rows[0].nutritionProvenance.updatedAt,'2026-01-01');
  await p.searchUsdaFoods('kraft macaroni and cheese');assert.equal(calls.length,1);
  await p.searchUsdaFoods('apple',false);assert.deepEqual(calls[1].dataType,['Foundation','SR Legacy','Survey (FNDDS)']);
 }finally{delete globalThis.__TPSHealthTestRequestUrl;}
});

test('manufacturer Michelob beer is distinct from seltzer, keeps reported energy, and scales through logging',async()=>{
 const p=plugin();p.searchCustomFoods=async()=>[];p.getLoggedFoodStats=async()=>new Map();
 const rows=await p.searchLocalFoods('michelob ultra');const beer=rows.find(x=>x.nutritionProvenance?.url?.includes('tapintoyourbeer'));
 assert.ok(beer,'manufacturer entry missing');assert.equal(rows[0],beer);assert.notEqual(beer.name,rows.find(x=>x.name.includes('Seltzer'))?.name);
 assert.deepEqual({...beer.nutrition,alcoholG:undefined},{calories:95,proteinG:.6,carbsG:2.6,fatG:0,alcoholG:undefined});
 assert.match(beer.nutritionProvenance.warnings.join(' '),/ABV/);assert.equal(beer.nutritionBasis,'labeled-serving');
 p.findOrCreateFoodNote=async food=>({...food,sourcePath:"Inbox/Michelob.md"});
 const entries=[];p.nativeRecordService={isEnabled:()=>true,requireApi:()=>({}),createFoodEntry:async entry=>{entries.push(entry);return {id:entry.id,path:'Inbox/synthetic-log.md'}}};
 await p.logFood(beer,m.defaultFoodLogQuantity(beer),'serving',undefined,'2026-10-18T12:00:00',false);
 await p.logFood(beer,24,'fl oz',undefined,'2026-10-18T12:00:00',false);
 assert.equal(entries[0].nutritionOverride.calories,95);assert.equal(entries[0].nutritionOverride.carbsG,2.6);assert.equal(entries[0].nutritionOverride.fatG,0);assert.equal(entries[0].nutritionOverride.sodiumMg,undefined);assert.equal(entries[0].nutritionOverride.fiberG,undefined);
 assert.equal(entries[1].nutritionOverride.calories,190);assert.equal(entries[1].nutritionOverride.carbsG,5.2);
 const prepared=p.prepareFoodNoteItem(beer,'food');assert.equal(prepared.nutrition.calories,95);assert.equal(prepared.nutrition.sodiumMg,undefined);
 assert.doesNotMatch(m.foodResultMeta(beer),/Unverified estimate/);
});

test('matching saved beer and recipes retain priority and unrelated saved foods stay out',()=>{
 const beer=m.searchCuratedFoods('michelob ultra').find(x=>x.nutritionProvenance?.url);
 assert.ok(beer);
 const saved={...beer,id:'mine',source:'custom-note',sourcePath:'Inbox/mine.md'};
 const unrelated={...saved,id:'soup',name:'Soup',aliases:[],brand:undefined,sourcePath:'Inbox/soup.md'};
 const rows=m.rankFoodSearchResults('michelob ultra',[beer,unrelated,saved]);assert.equal(rows[0],saved);assert.ok(!rows.includes(unrelated));
});

test('recipe picker ignores a label response after it has closed',async()=>{
 const p=plugin();let finish;p.enrichFoodSearchItem=()=>new Promise(resolve=>finish=resolve);
 const modal=new m.RecipeIngredientModal(p.app,p,null);modal.contentEl={empty(){}};modal.statusEl={setText(){},setAttr(){}};
 const pending=modal.selectFood({name:'Selected food'});modal.onClose();finish({id:'late',name:'Selected food',source:'open-food-facts',nutrition:{calories:95}});
 await assert.doesNotReject(pending);assert.equal(modal.selectedFood,null);
});

test('retired flags disappear from settings payload while pending drafts and secrets remain untouched',async()=>{
 const p=plugin();const draft={selectionItems:[{item:{id:'legacy',name:'Old label',source:'nutritionix',nutrition:{calories:95}},quantity:1,unit:'serving'}]};
 p.__pluginData={...p.settings,edamamEnabled:true,nutritionixEnabled:true,edamamApiKeySecret:'retained-secret',pendingFoodLogDraft:draft};
 const utility=await importSettingsNormalizationUtility();p.settings=utility.normalizeTPSHealthSettings(p.__pluginData);const payload=utility.settingsPersistencePayload(p.settings);assert.ok(!("edamamEnabled" in payload));assert.ok(!('edamamEnabled' in p.settings));assert.ok(!('nutritionixEnabled' in p.settings));assert.ok(!('edamamApiKeySecret' in p.settings));
 assert.equal(p.settings.pendingFoodLogDraft.selectionItems[0].item.nutrition.calories,95);
});

test('a preserved retired preview cannot log partial nutrition or request its former API',async()=>{
 const p=plugin(),preview={id:'old',name:'Old preview',source:'nutritionix',nutrition:{calories:95},nutritionProvenance:{provider:'nutritionix',dataset:'Search preview'}};
 let writes=0;p.nativeRecordService={createFoodEntry:async()=>{writes++;}};
 await assert.rejects(p.enrichFoodSearchItem(preview),/retired food provider/);
 await assert.rejects(p.logFood(preview,1,'serving',undefined,undefined,false),/retired food provider/);
 assert.equal(writes,0);
 const complete={...preview,nutritionProvenance:{provider:'nutritionix',dataset:'Food nutrition'}};assert.equal(await p.enrichFoodSearchItem(complete),complete,'complete historical labels remain usable');
});

test('a complete manufacturer serving ranks above an incomplete exact community match',()=>{
 const beer=m.searchCuratedFoods('michelob ultra').find(x=>x.nutritionProvenance?.url);
 const remote={id:'off-incomplete',name:'Michelob Ultra',source:'open-food-facts',brand:'Michelob',barcode:'0018200967153',servingAmount:100,servingUnit:'ml',servingMl:100,nutritionBasis:'per-100ml',nutrition:{alcoholG:3.3}};
 assert.equal(m.rankFoodSearchResults('michelob ultra',[remote,beer])[0],beer);
});

test('a missing or mismatched current OFF label cannot log a discovery preview',async()=>{
 const p=plugin();let writes=0;p.nativeRecordService={createFoodEntry:async()=>writes++};
 const preview={id:'0012345678905',name:'Synthetic food',barcode:'0012345678905',source:'open-food-facts',nutrition:{},nutritionProvenance:{provider:'open-food-facts',dataset:'Search preview'}};
 globalThis.__TPSHealthTestRequestUrl=async()=>({status:503,json:{}});
 try{
  await assert.rejects(p.logFood(preview,1,'serving',undefined,undefined,false),/HTTP 503/);assert.equal(writes,0);
  globalThis.__TPSHealthTestRequestUrl=async()=>({status:200,json:{status:1,product:{code:'0012345678912',product_name:'Different food',nutriments:{'energy-kcal_100g':500}}}});
  await assert.rejects(p.enrichFoodSearchItem(preview),/different barcode/);assert.equal(writes,0);
 }finally{delete globalThis.__TPSHealthTestRequestUrl;}
});

test('a recipe with an authored yield never guesses a beer-can volume or rescales its calories',()=>{
 const p=plugin(),food={id:'recipe',name:'Synthetic beer recipe',source:'manual',recipeServings:1,servingAmount:1,servingUnit:'serving',nutrition:{calories:95,proteinG:.6,carbsG:2.6,fatG:0,alcoholG:11.8}};
 const prepared=p.prepareFoodNoteItem(food,'recipe');assert.equal(prepared.nutrition.calories,95);assert.equal(prepared.servingUnit,'serving');assert.equal(prepared.servingMl,undefined);assert.equal(prepared.nutrition.fiberG,undefined);
});
test('recipe ingredient preview retains unknown nutrients instead of printing false zeroes',()=>{
 const p=plugin(),modal=new m.RecipeIngredientModal(p.app,p,null);let text='';
 modal.selectedFood={id:'label',name:'Synthetic partial label',source:'usda',servingAmount:1,servingUnit:'serving',nutrition:{calories:95,fatG:0}};
 modal.quantityEl={value:'2'};modal.unitEl={value:'serving'};modal.macrosEl={setText:value=>text=value};modal.updateSelectedMacros();
 assert.match(text,/190 kcal/);assert.match(text,/F 0g/);assert.doesNotMatch(text,/P |C |SA |Alc /);
});

 test('linked recipes retain reported zeroes but never fill missing ingredient nutrients',async()=>{
 const fake=createFakeHealthApp(),p=new m.default(fake.app);p.settings=structuredClone(p.settings);p.settings.foodTemplatePath='';
 const label=m.searchCuratedFoods('michelob ultra').find(x=>x.nutritionProvenance?.url);
 const food=await p.findOrCreateFoodNote(label);
 const recipe=await p.createFoodFromInput({type:'recipe',name:'Synthetic linked beer recipe',recipeServings:1,ingredients:`- 354.9 ml - [[${food.sourcePath}|Beer]]`});
 assert.equal(recipe.nutrition.calories,95);assert.equal(recipe.nutrition.fatG,0);assert.equal(recipe.nutrition.fiberG,undefined);assert.equal(recipe.nutrition.sodiumMg,undefined);assert.equal(recipe.servingUnit,'serving');assert.equal(recipe.servingMl,undefined);
 const fm=parseFrontmatter(fake.files.get(recipe.sourcePath));assert.equal(Number(fm.calories),95);assert.equal(fm.fiberG,undefined);assert.equal(fm.sodiumMg,undefined);
 });
