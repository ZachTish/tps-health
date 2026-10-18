import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";

const harnessUrl = new URL("./test-health-providers.mjs", import.meta.url);
globalThis.__TPSAdditionalFoodEsbuild = esbuild;
const harnessSource = readFileSync(harnessUrl, "utf8")
  .replace('import test from "node:test";', 'const test = () => {};')
  .replace('import * as esbuild from "esbuild";', 'const esbuild = globalThis.__TPSAdditionalFoodEsbuild;')
  .replaceAll("import.meta.url", JSON.stringify(harnessUrl.href));
const { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals, parseFrontmatter } = await import(`data:text/javascript;base64,${Buffer.from(harnessSource + "\nexport { importPluginWithObsidianStub, createFakeHealthApp, installDeterministicBrowserGlobals, parseFrontmatter };\n//# sourceURL=additional-food-harness.mjs").toString("base64")}`);
delete globalThis.__TPSAdditionalFoodEsbuild;


installDeterministicBrowserGlobals();
const m = await importPluginWithObsidianStub();
const plugin = () => {const p=new m.default(createFakeHealthApp().app);p.settings=JSON.parse(JSON.stringify(p.settings));return p;};
window.setTimeout=(callback,ms)=>setTimeout(callback,ms);window.clearTimeout=handle=>clearTimeout(handle);
const credentials = p => {p.app.secretStorage={getSecret:key=>key.includes('app-id')?'synthetic-id':'synthetic-key'};};
const enabled = provider => {const p=plugin();p.settings[`${provider}Enabled`]=true;credentials(p);return p;};

test('optional providers are opt-in: opening settings/default search performs zero provider work',async()=>{
 const p=plugin();let secrets=0,requests=0;p.app.secretStorage={getSecret:()=>{secrets++;return 'not-used'}};
 globalThis.__TPSHealthTestRequestUrl=async()=>{requests++;throw Error('Unexpected request')};
 try {assert.deepEqual(await p.searchAdditionalFoods('edamam','Michelob Ultra',true),[]);assert.deepEqual(await p.searchAdditionalFoods('nutritionix','Michelob Ultra',true),[]);assert.deepEqual({secrets,requests},{secrets:0,requests:0});}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});
test('Edamam keeps per-100g basis, known zero and unknown nutrients without assuming a can',async()=>{
 const p=enabled('edamam');const calls=[];
 globalThis.__TPSHealthTestRequestUrl=async o=>{calls.push(o);return {status:200,json:{hints:[{food:{foodId:'test-beer',label:'Michelob Ultra',brand:'Michelob',nutrients:{ENERC_KCAL:27,CHOCDF:.7,FAT:0}}}],parsed:[]}}};
 try {const [f]=await p.searchAdditionalFoods('edamam','Michelob Ultra',true);assert.equal(f.nutrition.calories,27);assert.equal(f.nutrition.fatG,0);assert.equal(f.nutrition.proteinG,undefined);assert.equal(f.servingGrams,100);assert.equal(f.servingMl,undefined);assert.equal(f.nutritionBasis,'per-100g');assert.equal(f.nutritionProvenance.provider,'edamam');assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).searchParams.get('ingr'),'Michelob Ultra');
 await p.searchAdditionalFoods('edamam','apple',false);assert.equal(new URL(calls[1].url).searchParams.get('category'),'generic-foods');}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});
test('Nutritionix search loads no result details; one selection fetches one matching label',async()=>{
 const p=enabled('nutritionix'),calls=[];p.searchCustomFoods=async()=>[];p.searchUsdaFoods=async()=>[];p.searchOpenFoodFacts=async()=>[];p.getLoggedFoodStats=async()=>new Map();
 globalThis.__TPSHealthTestRequestUrl=async o=>{calls.push(o);return o.url.includes('/instant?')?{status:200,json:{common:[],branded:[{nix_item_id:'beer-1',food_name:'Michelob Ultra',brand_name:'Michelob',nf_calories:95,serving_qty:1,serving_unit:'can'}]}}:{status:200,json:{foods:[{nix_item_id:'beer-1',food_name:'Michelob Ultra',brand_name:'Michelob',nf_calories:95,nf_protein:.6,nf_total_carbohydrate:2.6,nf_total_fat:0,nf_metric_qty:355,nf_metric_uom:'ml',serving_qty:1,serving_unit:'can',full_nutrients:[{attr_id:221,value:11.8}]}]}}};
 try {const foods=await p.searchFoods('Michelob Ultra');const preview=foods.find(f=>f.source==='nutritionix');assert.ok(preview,JSON.stringify({foods,calls:calls.map(c=>c.url),settings:p.settings.nutritionixEnabled}));assert.equal(calls.length,1);assert.equal(preview.nutrition.proteinG,undefined);assert.throws(()=>p.prepareFoodNoteItem(preview,'food'),/Load the Nutritionix/);
 const full=await p.enrichFoodSearchItem(preview);assert.equal(calls.length,2);assert.equal(full.nutrition.calories,95);assert.equal(full.nutrition.carbsG,2.6);assert.equal(full.nutrition.alcoholG,11.8);assert.equal(full.servingMl,355);assert.equal(full.servingGrams,undefined);assert.equal(full.nutritionProvenance.dataset,'Food nutrition');assert.equal(calls[1].headers['x-app-key'],'synthetic-key');await p.enrichFoodSearchItem(full);assert.equal(calls.length,2,'already hydrated selection needs no additional request');}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});
test('Nutritionix rejects mismatched or missing details before a food can be saved',async()=>{
 const p=enabled('nutritionix');const preview={source:'nutritionix',id:'nutritionix-one',name:'Beer',nutrition:{calories:95},nutritionProvenance:{provider:'nutritionix',recordId:'one',dataset:'Search preview'}};
 globalThis.__TPSHealthTestRequestUrl=async()=>({status:200,json:{foods:[{nix_item_id:'two',nf_calories:95}]}});
 try {await assert.rejects(p.enrichFoodSearchItem(preview),/different product/);globalThis.__TPSHealthTestRequestUrl=async()=>({status:200,json:{foods:[{nix_item_id:'one',food_name:'Beer'}]}});await assert.rejects(p.enrichFoodSearchItem(preview),/no energy value/);}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});
test('Nutritionix common discovery without calories stays searchable and hydrates only its selection',async()=>{
 const p=enabled('nutritionix'),calls=[];globalThis.__TPSHealthTestRequestUrl=async o=>{calls.push(o);return o.url.includes('/instant?')?{status:200,json:{branded:[],common:[{food_name:'banana',tag_id:'fruit-1',serving_qty:1,serving_unit:'medium'}]}}:{status:200,json:{foods:[{food_name:'banana',nf_calories:105,nf_total_carbohydrate:27,serving_qty:1,serving_unit:'medium',serving_weight_grams:118}]}}};
 try {const rows=await p.searchAdditionalFoods('nutritionix','banana',true);assert.equal(m.rankFoodSearchResults('banana',rows).length,1);const full=await p.enrichFoodSearchItem(rows[0]);assert.equal(full.nutrition.calories,105);assert.equal(full.servingGrams,118);assert.equal(calls.length,2);assert.equal(calls[1].method,'POST');assert.equal(JSON.parse(calls[1].body).query,'1 medium banana');}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});
test('provider errors redact credential URLs and never create substitute food data',async()=>{
 const p=enabled('edamam');const notices=[];globalThis.__TPSHealthTestNotices=notices;globalThis.__TPSHealthTestRequestUrl=async()=>{throw Error('https://example.invalid/?app_key=synthetic-secret')};
 try {assert.deepEqual(await p.searchAdditionalFoods('edamam','anything',true),[]);assert.ok(notices.some(n=>n.includes('edamam')));assert.ok(notices.every(n=>!n.includes('synthetic-secret')));}
 finally{delete globalThis.__TPSHealthTestRequestUrl;delete globalThis.__TPSHealthTestNotices;}
});
test('saved matching foods still lead additional providers; mismatched saved foods do not',()=>{
 const make=(source,name,id)=>({source,name,id,nutrition:{calories:95},nutritionProvenance:{provider:source},servingAmount:1,servingUnit:'can'});
 const saved=make('custom-note','Michelob Ultra','mine'),remote=make('nutritionix','Michelob Ultra','remote'),wrong=make('custom-note','Unrelated soup','wrong');
 const ranked=m.rankFoodSearchResults('Michelob Ultra',[remote,wrong,saved]);assert.equal(ranked[0].id,'mine');assert.ok(!ranked.some(x=>x.id==='wrong'));
});

test('late provider failures cannot surface notices after a picker closes',async()=>{
 const p=enabled('edamam');let fail,active=true;const notices=[];globalThis.__TPSHealthTestNotices=notices;globalThis.__TPSHealthTestRequestUrl=()=>new Promise((_,reject)=>fail=reject);
 try{const pending=p.searchAdditionalFoods('edamam','food',true,()=>active);active=false;fail(Error('network'));assert.deepEqual(await pending,[]);assert.equal(notices.length,0);}
 finally{delete globalThis.__TPSHealthTestRequestUrl;delete globalThis.__TPSHealthTestNotices;}
});

test('disabled integrations add no requests, credential reads or timeout timers to normal search',async()=>{
 const p=plugin();p.searchCustomFoods=async()=>[];p.searchUsdaFoods=async()=>[];p.searchOpenFoodFacts=async()=>[];p.getLoggedFoodStats=async()=>new Map();let timers=0,secrets=0,requests=0;
 p.withTimeout=promise=>{timers++;return promise};p.app.secretStorage={getSecret:()=>{secrets++;return 'unused'}};globalThis.__TPSHealthTestRequestUrl=async()=>{requests++;throw Error('Unexpected')};
 try{await p.searchFoods('banana');assert.deepEqual({timers,secrets,requests},{timers:2,secrets:0,requests:0});}
 finally{delete globalThis.__TPSHealthTestRequestUrl;}
});

test('recipe picker ignores a label response after it has closed',async()=>{
 const p=plugin();let finish;p.enrichFoodSearchItem=()=>new Promise(resolve=>finish=resolve);
 const modal=new m.RecipeIngredientModal(p.app,p,null);modal.contentEl={empty(){}};modal.statusEl={setText(){}};
 const pending=modal.selectFood({name:'Selected food'});modal.onClose();finish({id:'late',name:'Selected food',source:'nutritionix',nutrition:{calories:95}});
 await assert.doesNotReject(pending);assert.equal(modal.selectedFood,null);
});
