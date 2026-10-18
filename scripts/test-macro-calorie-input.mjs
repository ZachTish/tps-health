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
const m=await importPluginWithObsidianStub();
function element(){const node={children:[],attributes:{},value:'',validity:'',addClass(){},after(){},append(...nodes){this.children.push(...nodes)},empty(){this.children=[]},setText(v){this.text=v},setAttr(k,v){this.attributes[k]=v},setAttribute(k,v){this.attributes[k]=v},setCustomValidity(v){this.validity=v},querySelector(){return null},addEventListener(){},removeEventListener(){},focus(){},reportValidity(){}};node.createEl=(tag,o={})=>{const child=element();child.tag=tag;child.text=o.text;child.attributes={...o.attr};node.children.push(child);return child};node.createDiv=o=>node.createEl('div',o);node.createSpan=o=>node.createEl('span',o);return node;}
function form(baseFood, barcode=false){const fake=createFakeHealthApp(),p=new m.default(fake.app);p.settings=JSON.parse(JSON.stringify(p.settings));p.findPotentialFoodDuplicates=()=>[];const saved=[];p.upsertFoodFromInput=async input=>{saved.push(input);return m.foodItemFromInput(input)};
 p.findOrCreateFoodNote=async item=>{saved.push(item);return item};const modal=barcode?new m.BarcodeFoodReviewModal(p.app,p,baseFood,undefined,null,async()=>{}):new m.CustomFoodModal(p.app,p,'food','Synthetic drink',false,baseFood);const controls=new Map();modal.contentEl=element();modal.modalEl=element();
 globalThis.__TPSHealthTestSettingControl=(type,name,fn)=>{const c={inputEl:element(),buttonEl:element(),setValue(v){this.inputEl.value=v;return this},setPlaceholder(){return this},setButtonText(){return this},setCta(){return this},setDisabled(){return this},addOption(){return this},onChange(fn){this.change=fn;return this},onClick(fn){this.click=fn;return this}};fn(c);controls.set(name,c)};
 try{modal.onOpen()}finally{delete globalThis.__TPSHealthTestSettingControl}
 return {modal,p,saved,controls};
}
test('260 alcohol kcal saves 260/7 grams and exactly260 kcal; toggling never changes canonical nutrition',async()=>{
 const h=form();h.controls.get('Enter macros in').change('kcal');const alcohol=h.controls.get('Alcohol g');alcohol.inputEl.value='260';alcohol.change('260');assert.equal(alcohol.inputEl.attributes['aria-label'],'Alcohol (kcal) per serving');
 for(let i=0;i<50;i++){h.controls.get('Enter macros in').change('g');assert.ok(Math.abs(Number(alcohol.inputEl.value)-260/7)<1e-8);h.controls.get('Enter macros in').change('kcal');assert.equal(Number(alcohol.inputEl.value),260)}
 await h.controls.get('').click();assert.equal(h.saved.length,1);assert.equal(h.saved[0].nutrition.alcoholG,260/7);const final=m.foodItemFromInput(h.saved[0]);assert.equal(final.nutrition.calories,260);assert.equal(final.nutrition.alcoholG,260/7);
});
test('all four macro factors agree between entry and calorie calculation and blank stays unknown',async()=>{
 const h=form();h.controls.get('Enter macros in').change('kcal');for(const [name,value]of [['Protein g','40'],['Carbs g','80'],['Fat g','90'],['Alcohol g','70']])h.controls.get(name).change(value);
 await h.controls.get('').click();const n=m.foodItemFromInput(h.saved[0]).nutrition;assert.equal(n.proteinG,10);assert.equal(n.carbsG,20);assert.equal(n.fatG,10);assert.equal(n.alcoholG,10);assert.equal(n.calories,280);
 const empty=form();empty.controls.get('Alcohol g').change('');empty.controls.get('Protein g').change('0');await empty.controls.get('').click();assert.equal(empty.saved[0].nutrition.alcoholG,undefined);assert.equal(empty.saved[0].nutrition.proteinG,0);
});
test('invalid macro input is marked invalid; reported provider energy survives a unit-only toggle',async()=>{
 const base={id:'label',source:'usda',name:'Label',servingAmount:1,servingUnit:'can',servingMl:355,nutrition:{calories:95,carbsG:2.6},nutritionProvenance:{provider:'usda',recordId:'label'}};const h=form(base);h.controls.get('Enter macros in').change('kcal');h.controls.get('Enter macros in').change('g');await h.controls.get('').click();assert.equal(m.foodItemFromInput(h.saved[0]).nutrition.calories,95);assert.equal(h.saved[0].nutrition.proteinG,undefined);
 const invalid=form();invalid.controls.get('Alcohol g').change('-7');assert.ok(invalid.controls.get('Alcohol g').inputEl.validity);invalid.controls.get('Alcohol g').change('7');assert.equal(invalid.controls.get('Alcohol g').inputEl.validity,'');
});

test('food amount preview scales only known nutrients instead of displaying untracked macros as zero',()=>{
 const p=new m.default(createFakeHealthApp().app),food={id:'partial',name:'Partial label',source:'custom-note',servingAmount:1,servingUnit:'serving',nutrition:{calories:260,alcoholG:260/7}};
 const modal=new m.FoodLogModal(p.app,p,food);modal.contentEl=element();modal.modalEl=element();globalThis.__TPSHealthTestSettingControl=(_type,_name,fn)=>{const c={inputEl:element(),buttonEl:element(),setValue(){return this},setPlaceholder(){return this},setButtonText(){return this},setCta(){return this},setDisabled(){return this},addOption(){return this},onChange(){return this},onClick(){return this}};fn(c)};
 try{modal.onOpen()}finally{delete globalThis.__TPSHealthTestSettingControl}
 const texts=node=>[node.text||'',...node.children.flatMap(texts)];const values=texts(modal.contentEl).join(' ');assert.match(values,/260 kcal/);assert.match(values,/Alc 37.1g/);assert.doesNotMatch(values,/P 0g|C 0g|F 0g|SA 0g/);
});

test('tiny positive macro amounts stay visible through both entry units',async()=>{
 const h=form();h.controls.get('Alcohol g').change('0.0000000001');h.controls.get('Enter macros in').change('kcal');assert.equal(Number(h.controls.get('Alcohol g').inputEl.value),7e-10);h.controls.get('Enter macros in').change('g');assert.equal(Number(h.controls.get('Alcohol g').inputEl.value),1e-10);await h.controls.get('').click();assert.equal(h.saved[0].nutrition.alcoholG,1e-10);
 const invalid=form();invalid.controls.get('Fat g').change('1e308');assert.ok(invalid.controls.get('Fat g').inputEl.validity);
});

test('manual barcode food review uses the same calorie conversion without overwriting label energy',async()=>{
 const manual=form({id:'barcode',name:'Synthetic barcode drink',source:'manual',nutrition:{},servingAmount:1,servingUnit:'can'},true);manual.controls.get('Enter macros in').change('kcal');manual.controls.get('Alcohol g').change('260');await manual.controls.get('').click();assert.equal(manual.saved[0].nutrition.calories,260);assert.equal(manual.saved[0].nutrition.alcoholG,260/7);
 const label=form({id:'label',name:'Label fixture',source:'nutrition-label',nutrition:{calories:95,carbsG:2.6},servingAmount:1,servingUnit:'can'},true);label.controls.get('Enter macros in').change('kcal');label.controls.get('Enter macros in').change('g');await label.controls.get('').click();assert.equal(label.saved[0].nutrition.calories,95);
});

test('changing units cannot clear an invalid typed amount or leave a hidden invalid field',()=>{
 const h=form(),alcohol=h.controls.get('Alcohol g');alcohol.inputEl.value='-7';alcohol.change('-7');alcohol.inputEl.validity={valid:false};h.controls.get('Enter macros in').change('kcal');assert.equal(alcohol.inputEl.value,'-7');assert.equal(alcohol.inputEl.attributes['aria-label'],'Alcohol (g) per serving');
});
