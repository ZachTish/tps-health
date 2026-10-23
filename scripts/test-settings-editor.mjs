import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('settings.ts', source, ts.ScriptTarget.Latest, true);
const wanted = new Set(['renderNativeFrontmatterSettings', 'addNativePropertyKeySetting', 'addMappingSetting',
  'renderNoteLibraryPage', 'addLibraryFolderSetting', 'renderNativeKindSettings', 'renderEarlierLogsSettings', 'renderDailyLoggingPage', 'renderIntegrationsPage', 'createOptionalDisclosure', 'hide', 'display']);
const methods = [];
let settingsGroup;
(function visit(node) {
  if ((ts.isMethodDeclaration(node) && wanted.has(node.name?.getText(ast))) || (ts.isGetAccessor(node) && node.name?.getText(ast) === 'settingsContentEl')) methods.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.name?.getText(ast) === 'createSettingsGroup') settingsGroup = node.getText(ast);
  ts.forEachChild(node, visit);
})(ast);
async function load(entry) {
  const result = await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm'});
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const defaults = await load('src/types.ts');
const schema = await load('src/native-record-schema.ts');
const nutrients = await load('src/nutrients.ts');

class Element {
  constructor(tag='div', options={}, parent=null) {
    Object.assign(this,{tag,parentElement:parent,children:[],attrs:{...options.attr},dataset:{},events:{},style:{},open:false,value:options.value||'',text:options.text||''});
  }
  createEl(tag, options={}) { const child = new Element(tag,options,this); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div',options); }
  createSpan(options) { return this.createEl('span',options); }
  all() { return this.children.flatMap(child => [child,...child.all()]); }
  empty() { this.children=[]; }
  setAttribute(key,value) { this.attrs[key]=value; }
  addEventListener(type,callback) { this.events[type]=callback; }
  after(child) {
    child.parentElement.children=child.parentElement.children.filter(el=>el!==child);
    const siblings=this.parentElement.children; child.parentElement=this.parentElement;
    siblings.splice(siblings.indexOf(this)+1,0,child);
  }
  querySelector(tag) { return this.all().find(el=>el.tag===tag)||null; }
  focus() { this.focused=true; }
}
class Setting {
  constructor(parent) { this.settingEl=parent.createDiv(); this.settingEl.setting=this; this.controls=[]; }
  setName(value) { this.name=value; return this; }
  setDesc(value) { this.description=value; return this; }
  add(tag,callback) {
    const el=this.settingEl.createEl(tag);
    const control={inputEl:el,selectEl:el,toggleEl:el,buttonEl:el,
      setValue(value){el.value=value;return this;},getValue(){return el.value;},
      extraSettingsEl:el,
      setButtonText(text){this.text=text;return this;},setPlaceholder(){return this;},setTooltip(){return this;},setIcon(){return this;},setDisabled(){return this;},setCta(){return this;},
      addOption(value,text){el.createEl('option',{value,text});return this;},
      onChange(callback){this.change=callback;return this;},onClick(callback){this.click=callback;return this;}};
    this.controls.push(control); callback(control); return this;
  }
  addText(callback){return this.add('input',callback);}
  addDropdown(callback){return this.add('select',callback);}
  addButton(callback){return this.add('button',callback);}
  addToggle(callback){return this.add('input',callback);}
  addExtraButton(callback){return this.add('button',callback);}
  addComponent(callback){this.controls.push(callback(this.settingEl.createDiv()));return this;}
}
class SecretComponent {
  constructor(app,parent){this.inputEl=parent.createEl('input');}
  setValue(value){this.inputEl.value=value;return this;}
  onChange(callback){this.change=callback;return this;}
}
const providerBundle=await build({entryPoints:['src/connection-settings.ts'],bundle:true,write:false,format:'cjs',platform:'browser',external:['obsidian']});
const providerModule={exports:{}};
const requests=[];
new Function('module','exports','require','fetch',providerBundle.outputFiles[0].text)(providerModule,providerModule.exports,
  ()=>({Setting,SecretComponent,requestUrl:()=>{requests.push('requestUrl');throw Error('Settings must not request providers');}}),
  ()=>{requests.push('fetch');throw Error('Settings must not request providers');});
const compiled=ts.transpileModule(`const ${settingsGroup}; export class Tab { ${methods.join('\n')} }`,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function harness() {
  const calls={opened:[],saves:0,migrations:[],preview:0,copy:0,review:0,connection:[],focus:[]};
  const dependencies={Setting,DEFAULT_SETTINGS:defaults.DEFAULT_SETTINGS,logger:{flow(){}},HealthConnectionSettings:providerModule.exports.HealthConnectionSettings,EXTRA_NUTRIENTS:nutrients.BUILT_IN_NUTRIENTS,...schema,Notice:class{},
    changeHealthMapping:async(plugin,next,label,scope)=>{calls.migrations.push({next,label,scope});return false;}};
  const exports={};new Function('exports',...Object.keys(dependencies),compiled)(exports,...Object.values(dependencies));
  const settings=structuredClone(defaults.DEFAULT_SETTINGS);
  const plugin={settings,getGcmApi:()=>({frontmatterKinds:{version:2}}),saveSettings:async()=>{calls.saves++;},
    getGcmNativeRecordsApi:()=>({getStorageProfile:()=>({identityPropertyKey:'id',titlePropertyKey:'title',kindPropertyKey:'kind',createdPropertyKey:'createdDate',modifiedPropertyKey:'modifiedDate'})}),
    previewLegacyHealthImport(){calls.preview++;},copyLegacyHealthLogs:async()=>{calls.copy++;},acknowledgeLegacyHealthHistory:async()=>{calls.review++;},
    refreshGcmFoodLogButtonRegistration(){},
  };
  const tab=Object.assign(new exports.Tab(),{plugin,activeNativePropertyKey:'completedDate',disclosureState:new Map(),
    app:{plugins:{plugins:{'tps-controller':{api:{openConnectionSettings(section){calls.connection.push(section);}}}}}},
    redisplayPreservingContext(selector){calls.focus.push(selector);},openPluginSettings(id){calls.opened.push(id);},
  });
  const container=new Element();
  const rows=()=>container.all().filter(el=>el.setting).map(el=>el.setting);
  const row=name=>rows().find(row=>row.name===name);
  return {tab,plugin,container,calls,rows,row};
}

test('Health mounts its own food settings without Controller, saves or provider requests',()=>{
  const h=harness();h.tab.app.plugins.plugins={};h.plugin.app=h.tab.app;
  h.plugin.settings.usdaApiKeySecrets=['synthetic-primary','synthetic-backup'];
  const before=structuredClone(h.plugin.settings);requests.length=0;
  Object.assign(h.tab,{containerEl:h.container,renderSettingsHub(){},renderActiveSettingsPage(page){this.renderIntegrationsPage(page);}});
  h.tab.display();
  assert.ok(h.row('Open Food Facts User-Agent'));
  assert.equal(h.row('USDA API key — Primary').controls[0].inputEl.value,'synthetic-primary');
  assert.equal(h.row('USDA API key — Fallback 1').controls[0].inputEl.value,'synthetic-backup');
  assert.ok(h.row('Add USDA fallback'));
  const old=h.tab.foodConnections;
  h.tab.display();
  assert.equal(old.disposed,true);
  assert.notEqual(h.tab.foodConnections,old);
  const current=h.tab.foodConnections;
  h.tab.hide();
  assert.equal(current.disposed,true);assert.equal(h.tab.foodConnections,null);
  assert.equal(h.calls.saves,0);assert.equal(h.calls.preview,0);assert.equal(h.calls.copy,0);
  assert.deepEqual(h.plugin.settings,before);assert.deepEqual(requests,[]);assert.deepEqual(h.calls.connection,[]);
});

test('optional AI configuration retains its existing explicit owner handoff',()=>{
  const h=harness();h.tab.renderIntegrationsPage(h.container);
  assert.deepEqual(h.calls.connection,[]);
  h.row('AI-assisted Describe').controls[0].click();
  assert.deepEqual(h.calls.connection,['ai']);assert.equal(h.calls.saves,0);
});

test('every Health property remains selectable while only one mapping editor is mounted',()=>{
  const h=harness();const before=structuredClone(h.plugin.settings);
  h.tab.renderNativeFrontmatterSettings(h.container);
  const picker=h.row('Property to configure').controls[0];
  assert.equal(picker.selectEl.attrs['aria-label'],'Health property to configure');
  const options=picker.selectEl.all().filter(el=>el.tag==='option');
  assert.deepEqual(options.map(el=>el.value).sort(),Object.keys(schema.DEFAULT_HEALTH_NATIVE_RECORD_PROPERTIES).sort());
  assert.equal(picker.selectEl.children.filter(el=>el.tag==='optgroup').length,3);
  for(let repeat=0;repeat<5;repeat++)for(const option of options){
    picker.change(option.value);
    assert.equal(h.container.all().filter(el=>el.tag==='input').length,1);
    assert.equal(h.container.all().filter(el=>el.tag==='input')[0].value,h.plugin.settings.nativeRecordProperties[option.value]);
  }
  assert.equal(h.calls.saves,0);assert.deepEqual(h.calls.migrations,[]);assert.deepEqual(h.plugin.settings,before);
});

test('selected property survives a rerender and Apply still requests the existing confirmed migration',async()=>{
  const h=harness();h.tab.renderNativeFrontmatterSettings(h.container);
  h.row('Property to configure').controls[0].change('proteinG');
  h.container.empty();h.tab.renderNativeFrontmatterSettings(h.container);
  assert.equal(h.row('Property to configure').controls[0].selectEl.value,'proteinG');
  const mapping=h.row('Protein');const before=structuredClone(h.plugin.settings);
  mapping.controls[0].setValue('proteinAmount');await mapping.controls[1].click();
  assert.equal(h.calls.migrations.length,1);
  assert.equal(h.calls.migrations[0].next.nativeRecordProperties.proteinG,'proteinAmount');
  assert.equal(h.calls.migrations[0].scope,'all');assert.deepEqual(h.plugin.settings,before);
  assert.equal(h.calls.saves,0);assert.match(h.calls.focus[0],/tps-health-mapping="protein"/);
});

test('Daily logging keeps appearance and daily actions without rendering history import controls',()=>{
  const h=harness();h.tab.renderDailyLoggingPage(h.container);
  assert.deepEqual(h.rows().map(row=>row.name),['Macros block','Nutrient rows','Show food log button in GCM','Daily Notes source']);
  assert.equal(h.calls.saves,0);assert.equal(h.calls.preview,0);assert.equal(h.calls.copy,0);
});

test('Advanced keeps history actions in one closed disclosure and opening it performs no import or save',async()=>{
  const h=harness();h.plugin.settings.storageMode='legacy';h.tab.renderIntegrationsPage(h.container);
  const history=h.container.all().find(el=>el.dataset.tpsHealthSettingsDisclosure==='earlier-logs');
  assert.equal(history.open,false);assert.equal(history.parentElement,h.container);
  for(const name of ['Earlier inline logs need review','Earlier inline logs'])assert.ok(h.row(name));
  const actions=h.row('Earlier inline logs').controls;
  assert.deepEqual(actions.map(control=>control.text),['Preview import','Copy into notes']);
  assert.equal(h.calls.saves,0);assert.equal(h.calls.preview,0);assert.equal(h.calls.copy,0);
  actions[0].click();await actions[1].click();await h.row('Earlier inline logs need review').controls[0].click();
  assert.equal(h.calls.preview,1);assert.equal(h.calls.copy,1);assert.equal(h.calls.review,1);
});


test('current GCM owns note types and inline visibility while Health retains destinations and templates',()=>{
  const h=harness();h.plugin.settings.workoutIdentificationMode='metadata';
  const before=structuredClone(h.plugin.settings);
  h.tab.renderNoteLibraryPage(h.container);
  for(const name of ['Workout plans destination','Exercises destination','Foods destination','Recipes destination',
    'Workout plan template path','Exercise template path','Food template path']) assert.ok(h.row(name),name);
  assert.equal(h.row('Existing workout folder'),undefined);
  for(const name of ['Food note identification','Workout note identification','Food frontmatter key','Entry and session frontmatter key']) assert.equal(h.row(name),undefined,name);
  const handoff=h.row('Configure note types and inline fields');
  assert.match(handoff.description,/Records for note types and Custom fields for inline visibility/);
  assert.match(handoff.description,/Nutrient tracking and targets belong to Health/);
  handoff.controls[0].click();assert.deepEqual(h.calls.opened,['tps-global-context-menu']);
  assert.equal(h.calls.saves,0);assert.deepEqual(h.calls.migrations,[]);assert.deepEqual(h.plugin.settings,before);
});

test('folder and tag controls follow the matching mode, preserving all inactive values',()=>{
  for(const gcm of [true,false]) for(const mode of ['metadata','folder','tag','metadata-folder-tag']) {
    const h=harness();h.plugin.getGcmApi=()=>gcm?{frontmatterKinds:{version:2}}:undefined;
    Object.assign(h.plugin.settings,{foodIdentificationMode:mode,workoutIdentificationMode:mode,
      workoutsFolder:'Synthetic old sessions',workoutTag:'synthetic/workout',customFoodTag:'synthetic/food',recipeTag:'synthetic/recipe'});
    const before=structuredClone(h.plugin.settings);h.tab.renderNoteLibraryPage(h.container);
    const folders=mode==='folder'||mode==='metadata-folder-tag';
    const tags=!gcm&&(mode==='tag'||mode==='metadata-folder-tag');
    assert.equal(!!h.row('Existing workout folder'),folders,`${gcm}: ${mode} folder`);
    for(const name of ['Workout tag','Food tag','Recipe/meal tag']) assert.equal(!!h.row(name),tags,`${gcm}: ${mode} ${name}`);
    if(!gcm) assert.ok(h.row('Exercise tag'),'independent exercise tag remains available');
    assert.equal(h.calls.saves,0);assert.deepEqual(h.calls.migrations,[]);assert.deepEqual(h.plugin.settings,before);
  }
});

test('legacy workout matching changes refresh conditional controls and restore the selector focus',async()=>{
  const h=harness();h.plugin.getGcmApi=()=>undefined;h.plugin.settings.workoutIdentificationMode='metadata';
  h.tab.renderNoteLibraryPage(h.container);
  const control=h.row('Workout note identification').controls[0];
  assert.equal(control.selectEl.dataset.tpsHealthWorkoutIdentification,'true');
  await control.change('folder');
  assert.equal(h.plugin.settings.workoutIdentificationMode,'folder');assert.equal(h.calls.saves,1);
  assert.deepEqual(h.calls.focus,['[data-tps-health-workout-identification]']);
  h.container.empty();h.tab.renderNoteLibraryPage(h.container);
  assert.ok(h.row('Existing workout folder'));assert.equal(h.row('Workout tag'),undefined);
});
