import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const result=await build({stdin:{contents:"export * from './energy-estimate'; export * from './energy-overview'; export * from './settings-normalization'; export {DEFAULT_SETTINGS} from './types';",resolveDir:fileURLToPath(new URL('../src',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const totals={dateIso:'2026-09-18',entryCount:2,calories:2000};
test('full-day burn uses BMR times PAL and compares logged consumption with the correct sign',()=>{
 const profile={energyBmrKcal:1600,energyActivityFactor:1.5};
 const below=m.dailyEnergyEstimate(profile,totals);
 assert.equal(below.estimatedBurnKcal,2400);
 assert.equal(below.differenceKcal,-400);
 assert.equal(m.energyComparisonText(below),'400 kcal below estimate');
 const above=m.dailyEnergyEstimate(profile,{...totals,calories:2700});
 assert.equal(above.differenceKcal,300);
 assert.equal(m.energyComparisonText(above),'300 kcal above estimate');
 assert.equal(m.energyComparisonText(m.dailyEnergyEstimate(profile,{...totals,calories:2400})),'Matches estimate');
 assert.deepEqual(m.dailyEnergyEstimate(profile,{...totals,caloriesBurned:900}),below,'logged exercise must never inflate a PAL estimate');
});
test('missing BMR and unlogged days do not invent a burn or an apparent deficit',()=>{
 assert.equal(m.dailyEnergyEstimate(m.DEFAULT_SETTINGS,totals).estimatedBurnKcal,null);
 const noFood=m.dailyEnergyEstimate({energyBmrKcal:1600,energyActivityFactor:1.4},{...totals,entryCount:0,calories:0});
 assert.equal(noFood.estimatedBurnKcal,2240);
 assert.equal(noFood.consumedKcal,null);
 assert.equal(noFood.differenceKcal,null);
 assert.equal(m.energyComparisonText(noFood),'No food logged');
 const zero=m.dailyEnergyEstimate({energyBmrKcal:1600,energyActivityFactor:1.4},{...totals,entryCount:1,calories:0});
 assert.equal(zero.consumedKcal,0,'known logged zero is distinct from an unlogged day');
});
test('profile validation preserves decimals and disabling while rejecting invalid inputs',()=>{
 assert.deepEqual(m.parseEnergySettings('1600.25','1.45'),{energyBmrKcal:1600.25,energyActivityFactor:1.45,energyEstimateMode:'calculated',energyFixedTdeeKcal:null});
 assert.deepEqual(m.parseEnergySettings('','1.4'),{energyBmrKcal:null,energyActivityFactor:1.4,energyEstimateMode:'calculated',energyFixedTdeeKcal:null});
 for(const [bmr,factor] of [['0','1.4'],['-2','1.4'],['Infinity','1.4'],['1800',''],['1800','0.9'],['1,800','1.4'],['1e308','2']]) assert.throws(()=>m.parseEnergySettings(bmr,factor));
 const saved=m.normalizeTPSHealthSettings({...m.DEFAULT_SETTINGS,...m.parseEnergySettings('1600.25','1.45')});
 const reloaded=m.normalizeTPSHealthSettings(JSON.parse(JSON.stringify(saved)));
 assert.equal(reloaded.energyBmrKcal,1600.25);assert.equal(reloaded.energyActivityFactor,1.45);
 assert.equal(reloaded.calorieGoal,m.DEFAULT_SETTINGS.calorieGoal,'burn estimate never changes consumption goals');
 const model=m.dailyEnergyEstimate(reloaded,totals);
 assert.equal(model.estimatedBurnKcal,1600.25*1.45,'round only when displaying');
 assert.equal(m.normalizeTPSHealthSettings({energyBmrKcal:true,energyActivityFactor:-1}).energyBmrKcal,null);
 assert.equal(m.normalizeTPSHealthSettings({energyBmrKcal:1e308,energyActivityFactor:3}).energyBmrKcal,null);
});
test('fixed TDEE is an explicit full-day target and never includes workout calories twice',()=>{
 const saved=m.normalizeTPSHealthSettings({...m.DEFAULT_SETTINGS,
   ...m.parseEnergySettings('1600','1.5','fixed','2350.5')});
 const fixed=m.dailyEnergyEstimate(saved,{...totals,caloriesBurned:500});
 assert.equal(fixed.mode,'fixed');
 assert.equal(fixed.estimatedBurnKcal,2350.5);
 assert.equal(fixed.differenceKcal,-350.5);
 assert.equal(m.dailyEnergyEstimate({...saved,energyEstimateMode:'calculated'},totals).estimatedBurnKcal,2400);
 assert.equal(m.normalizeTPSHealthSettings(JSON.parse(JSON.stringify(saved))).energyFixedTdeeKcal,2350.5);
 assert.throws(()=>m.parseEnergySettings('1600','1.5','fixed',''));
 assert.throws(()=>m.parseEnergySettings('1600','1.5','fixed','-2'));
 assert.throws(()=>m.parseEnergySettings('1600','1.5','fixed','1000000001'));
 assert.equal(m.dailyEnergyEstimate({...saved,energyFixedTdeeKcal:null},totals).estimatedBurnKcal,null,
   'missing fixed target must not silently fall back to calculated');
 assert.equal(m.dailyEnergyEstimate({...saved,energyFixedTdeeKcal:1000000001},totals).estimatedBurnKcal,null);
 assert.equal(m.normalizeTPSHealthSettings({...saved,energyEstimateMode:'unknown'}).energyEstimateMode,'calculated');
});
test('fixed mode can be saved without valid hidden calculated inputs',()=>{
 const fixed=m.parseEnergySettings('not a BMR','not a factor','fixed','2200');
 assert.equal(fixed.energyEstimateMode,'fixed');
 assert.equal(fixed.energyBmrKcal,null);
 assert.equal(fixed.energyActivityFactor,m.DEFAULT_SETTINGS.energyActivityFactor);
 assert.equal(m.dailyEnergyEstimate(fixed,totals).estimatedBurnKcal,2200);
 assert.throws(()=>m.parseEnergySettings('not a BMR','not a factor','calculated','2200'));
 const calculated=m.parseEnergySettings('1600','1.5','calculated','not a fixed value');
 assert.equal(calculated.energyEstimateMode,'calculated');
 assert.equal(calculated.energyFixedTdeeKcal,null);
 assert.equal(m.dailyEnergyEstimate(calculated,totals).estimatedBurnKcal,2400);
});
test('overview uses existing date, nutrition and activity rendering with separate responsive energy cards',()=>{
 const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.ok(main.includes('registerNativeDailySection("tps-health-overview", "overview")'));
 assert.ok(main.includes('dailyEnergyEstimate(this.plugin.settings, totals'));
 assert.ok(main.includes('if (energy) renderEnergyOverview(stack, energy)'));
 const settings=readFileSync(new URL('../src/energy-settings.ts',import.meta.url),'utf8');
 assert.ok(settings.includes('aria-live'));
 assert.ok(settings.includes('button.buttonEl.focus()'));
 const styles=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.ok(styles.includes('.tps-health-energy-cards { grid-template-columns: 1fr; }'));
});

const activitySource = {
 energyActivityIdentificationMode:'property',energyActivityPropertyKey:'kind',energyActivityPropertyValue:'transaction/activity',
 energyActivityTag:'health/activity',energyActivityCaloriesPropertyKey:'activeEnergy',energyActivityDatePropertyKey:'completedDate',
};
test('BMR plus selected-day activity is explicit and does not add an activity multiplier or existing total',()=>{
 const saved=m.parseEnergySettings('1600','8','activity-notes','9999',activitySource);
 const activity={dateIso:totals.dateIso,caloriesBurned:475.5,entryCount:2};
 const model=m.dailyEnergyEstimate(saved,{...totals,caloriesBurned:9000},activity);
 assert.equal(model.mode,'activity-notes');assert.equal(model.estimatedBurnKcal,2075.5);
 assert.equal(model.activityCaloriesBurned,475.5);assert.equal(model.activityEntryCount,2);
 assert.equal(model.differenceKcal,-75.5);
 assert.equal(m.dailyEnergyEstimate(saved,totals,{...activity,caloriesBurned:0,entryCount:0}).estimatedBurnKcal,1600);
 assert.equal(m.dailyEnergyEstimate({...saved,energyBmrKcal:null},totals,activity).estimatedBurnKcal,null);
 assert.equal(m.dailyEnergyEstimate({...saved,energyBmrKcal:1e9},totals,activity).estimatedBurnKcal,null,'oversized sum is unknown');
 for(const mode of ['fixed','calculated']) {
  const settings=m.parseEnergySettings('1600','1.5',mode,'2300');
  assert.deepEqual(m.dailyEnergyEstimate(settings,totals,activity),m.dailyEnergyEstimate(settings,totals));
 }
});
test('missing, stale-date, and malformed activity snapshots remain unknown instead of fabricating BMR-only burn',()=>{
 const saved=m.parseEnergySettings('1600','1.4','activity-notes','',activitySource);
 const activity={dateIso:totals.dateIso,caloriesBurned:500,entryCount:2};
 for(const snapshot of [undefined,null,{...activity,dateIso:'2026-09-19'},{...activity,caloriesBurned:NaN},
  {...activity,caloriesBurned:-1},{...activity,caloriesBurned:1e9+1},{...activity,entryCount:-1},{...activity,entryCount:0.5}]) {
  const model=m.dailyEnergyEstimate(saved,totals,snapshot);
  assert.equal(model.estimatedBurnKcal,null);assert.equal(model.activityCaloriesBurned,null);
  assert.equal(model.activityEntryCount,null);assert.equal(model.differenceKcal,null);
  assert.equal(m.energyComparisonText(model),'Activity estimate unavailable');
 }
});
test('activity settings persist without hidden-factor requirements and reject incomplete active sources',()=>{
 const property=m.parseEnergySettings('1600.25','not a factor','activity-notes','not a target',activitySource);
 assert.equal(property.energyBmrKcal,1600.25);
 assert.equal(property.energyActivityFactor,m.DEFAULT_SETTINGS.energyActivityFactor);
 assert.equal(property.energyActivityPropertyValue,'transaction/activity');
 const restored=m.normalizeTPSHealthSettings(JSON.parse(JSON.stringify({...m.DEFAULT_SETTINGS,...property})));
 assert.equal(restored.energyEstimateMode,'activity-notes');
 assert.equal(restored.energyActivityCaloriesPropertyKey,'activeEnergy');
 assert.equal(restored.energyActivityDatePropertyKey,'completedDate');
 assert.equal(restored.energyActivityPropertyValue,'transaction/activity');
 const disabled=m.parseEnergySettings('','not a factor','activity-notes','',activitySource);
 assert.equal(disabled.energyBmrKcal,null);
 const tagged=m.parseEnergySettings('1600','','activity-notes','',{...activitySource,energyActivityIdentificationMode:'tag',energyActivityTag:'#health/activity',energyActivityPropertyKey:'',energyActivityPropertyValue:''});
 assert.equal(tagged.energyActivityTag,'health/activity');
 for(const source of [undefined,{...activitySource,energyActivityPropertyValue:''},
  {...activitySource,energyActivityCaloriesPropertyKey:''},{...activitySource,energyActivityDatePropertyKey:''},
  {...activitySource,energyActivityIdentificationMode:'tag',energyActivityTag:''}])
  assert.throws(()=>m.parseEnergySettings('1600','1.4','activity-notes','',source));
 assert.throws(()=>m.parseEnergySettings('1000000001','1','activity-notes','',activitySource));
 const invalidHidden={...activitySource,energyActivityPropertyValue:'',energyActivityDatePropertyKey:''};
 assert.doesNotThrow(()=>m.parseEnergySettings('1600','1.4','fixed','2300',invalidHidden));
 assert.doesNotThrow(()=>m.parseEnergySettings('1600','1.4','calculated','',invalidHidden));
 assert.equal(m.normalizeTPSHealthSettings({...property,energyActivityFactor:1e9}).energyBmrKcal,1600.25,'hidden PAL must not erase activity-mode BMR');
 assert.equal(m.normalizeTPSHealthSettings({...property,energyActivityDatePropertyKey:'bad\nkey'}).energyActivityDatePropertyKey,'bad\nkey','loading never silently selects a different source');
});
test('passing the full saved settings as source cannot overwrite new energy inputs or return unrelated preferences',()=>{
 for(const mode of ['calculated','fixed','activity-notes']) {
  const previous={...m.DEFAULT_SETTINGS,...activitySource,energyBmrKcal:1200,energyActivityFactor:9,energyFixedTdeeKcal:1900};
  const next=m.parseEnergySettings('1600','1.5',mode,'2300',previous);
  assert.equal(next.energyBmrKcal,1600);assert.equal(next.energyActivityFactor,1.5);
  assert.equal(next.energyEstimateMode,mode);assert.equal(next.energyFixedTdeeKcal,2300);
  assert.deepEqual(Object.keys(next).sort(),['energyBmrKcal','energyActivityFactor','energyEstimateMode','energyFixedTdeeKcal',...Object.keys(activitySource)].sort());
 }
});
class EnergyElement {
 constructor(options={}){this.children=[];this.attrs={...options.attr};this.text=options.text;this.hidden=false;this.focused=false;this.classes=new Set();}
 createDiv(options={}){const child=new EnergyElement(options);this.children.push(child);return child;}
 createEl(tag,options={}){const child=this.createDiv(options);child.tag=tag;return child;}
 setText(text){this.text=text;}setAttribute(key,value){this.attrs[key]=value;}focus(){this.focused=true;}
 addClass(value){this.classes.add(value);}
 all(){return [this,...this.children.flatMap(child=>child.all())];}
}
class EnergyControl {
 constructor(){this.inputEl=new EnergyElement();this.buttonEl=new EnergyElement();this.options={};}
 addOption(key,label){this.options[key]=label;return this;}setValue(value){this.value=value;return this;}
 setPlaceholder(value){this.placeholder=value;return this;}onChange(fn){this.change=fn;return this;}onClick(fn){this.click=fn;return this;}
 setDisabled(value){this.disabled=value;return this;}setButtonText(value){this.label=value;return this;}setCta(){return this;}
}
class EnergySetting {
 constructor(container){this.settingEl=container.createDiv();this.settingEl.setting=this;}
 setName(name){this.name=name;return this;}setDesc(desc){this.desc=desc;return this;}
 addDropdown(fn){this.dropdown=new EnergyControl();fn(this.dropdown);return this;}
 addText(fn){this.input=new EnergyControl();fn(this.input);return this;}
 addButton(fn){this.button=new EnergyControl();fn(this.button);return this;}
}
const uiResult=await build({entryPoints:['src/energy-settings.ts'],bundle:true,write:false,format:'cjs',platform:'browser',external:['obsidian']});
const uiModule={exports:{}};
new Function('module','exports','require',uiResult.outputFiles[0].text)(uiModule,uiModule.exports,()=>({Setting:EnergySetting}));
const uiFixture=(settings={})=>{
 const container=new EnergyElement();const saved=[];
 const plugin={settings:{...m.DEFAULT_SETTINGS,...settings},saveEnergySettings:async(...args)=>{
  const parsed=m.parseEnergySettings(...args);Object.assign(plugin.settings,parsed);saved.push(parsed);
 }};
 uiModule.exports.renderEnergySettings(container,plugin);
 const row=name=>container.all().find(el=>el.setting?.name===name)?.setting;
 const save=container.all().find(el=>el.setting?.button)?.setting.button;
 const preview=container.all().find(el=>el.attrs['aria-live']==='polite');
 return {container,plugin,saved,row,save,preview};
};
test('energy settings progressively show only the active method and source controls without saving on input',async()=>{
 const f=uiFixture({energyBmrKcal:1600,...activitySource});
 assert.equal(f.container.classes.has('tps-health-settings-energy-controls'),true);
 assert.deepEqual(f.row('TDEE method').dropdown.options,{calculated:'Calculated',fixed:'Fixed','activity-notes':'BMR + activity notes'});
 assert.equal(f.row('Daily activity factor').settingEl.hidden,false);
 assert.equal(f.row('Identify activity notes by').settingEl.hidden,true);
 f.row('TDEE method').dropdown.change('activity-notes');
 assert.equal(f.row('Daily activity factor').settingEl.hidden,true);assert.equal(f.row('Fixed TDEE (kcal/day)').settingEl.hidden,true);
 assert.equal(f.row('Activity property').settingEl.hidden,false);assert.equal(f.row('Activity property value').settingEl.hidden,false);
 assert.equal(f.row('Activity tag').settingEl.hidden,true);assert.match(f.preview.text,/BMR baseline: 1600 kcal/);
 f.row('Identify activity notes by').dropdown.change('tag');
 assert.equal(f.row('Activity property').settingEl.hidden,true);assert.equal(f.row('Activity property value').settingEl.hidden,true);
 assert.equal(f.row('Activity tag').settingEl.hidden,false);
 f.row('Activity tag').input.change('#health/activity');f.row('Activity calories property').input.change('activeKcal');
 f.row('Activity date property').input.change('finishedOn');
 assert.equal(f.saved.length,0);assert.equal(f.plugin.settings.energyEstimateMode,'calculated','draft method stays transient');
 await f.save.click();assert.equal(f.saved.length,1);
 assert.equal(f.plugin.settings.energyEstimateMode,'activity-notes');assert.equal(f.plugin.settings.energyActivityTag,'health/activity');
 assert.equal(f.plugin.settings.energyActivityCaloriesPropertyKey,'activeKcal');assert.equal(f.plugin.settings.energyActivityDatePropertyKey,'finishedOn');
 assert.equal(f.plugin.settings.energyActivityPropertyValue,'transaction/activity','inactive source choice is preserved');
 assert.equal(f.save.buttonEl.focused,true);assert.equal(f.save.disabled,false);
 for(const name of ['BMR (kcal/day)','Activity property','Activity property value','Activity tag','Activity calories property','Activity date property'])
  assert.ok(f.row(name).input.inputEl.attrs['aria-label'],name+' has an accessible label');
});
test('energy controls scope an explicit hidden rule so native setting flex styles cannot reveal inactive fields',()=>{
 const styles=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(styles,/\.tps-health-settings-energy-controls\s+\.setting-item\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
 const f=uiFixture({energyBmrKcal:1600,...activitySource});
 const allConditional=['BMR (kcal/day)','Daily activity factor','Fixed TDEE (kcal/day)','Identify activity notes by',
  'Activity property','Activity property value','Activity tag','Activity calories property','Activity date property'];
 for(const mode of ['fixed','calculated','activity-notes']) {
  f.row('TDEE method').dropdown.change(mode);
  assert.ok(allConditional.some(name=>f.row(name).settingEl.hidden),'there are hidden fields for '+mode);
  for(const name of allConditional) assert.ok(f.container.all().includes(f.row(name).settingEl),'all conditional controls remain inside the scoped container');
 }
});
test('energy settings reject incomplete active sources but fixed/calculated saves ignore those hidden fields',async()=>{
 const f=uiFixture({energyBmrKcal:1600});f.row('TDEE method').dropdown.change('activity-notes');
 await f.save.click();assert.equal(f.saved.length,0);assert.match(f.preview.text,/property key and value/);
 assert.equal(f.save.buttonEl.focused,true);
 f.row('TDEE method').dropdown.change('fixed');f.row('Fixed TDEE (kcal/day)').input.change('2300');
 assert.equal(f.row('BMR (kcal/day)').settingEl.hidden,true);assert.equal(f.row('Activity calories property').settingEl.hidden,true);
 await f.save.click();assert.equal(f.saved.length,1);assert.equal(f.plugin.settings.energyFixedTdeeKcal,2300);
 f.row('TDEE method').dropdown.change('calculated');await f.save.click();assert.equal(f.saved.length,2);
});
test('overview explains the selected-day activity sum and unknown activity without claiming a PAL estimate',()=>{
 const profile=m.parseEnergySettings('1600','9','activity-notes','',activitySource);
 const container=new EnergyElement();m.renderEnergyOverview(container,m.dailyEnergyEstimate(profile,totals,{dateIso:totals.dateIso,caloriesBurned:500,entryCount:2}));
 const text=container.all().map(el=>el.text||'').join(' ');
 assert.match(text,/BMR 1600 \+ logged activity 500 = 2100 kcal · 2 matching notes/);
 assert.match(text,/Other movement and unlogged activity are not estimated/);
 assert.doesNotMatch(text,/activity factor 9|Estimated full-day burn/);
 const pending=new EnergyElement();m.renderEnergyOverview(pending,m.dailyEnergyEstimate(profile,totals));
 assert.match(pending.all().map(el=>el.text||'').join(' '),/Activity data is not ready or/);
});
