import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

class Element {
  constructor(tag='div',options={}) {this.tag=tag;this.text=options.text||'';this.attrs=options.attr||{};this.children=[];this.events={};this.value='';}
  createEl(tag,options={}){const child=new Element(tag,options);this.children.push(child);return child;}
  createDiv(options={}){return this.createEl('div',options);}
  addClass(){} empty(){this.children=[];} addEventListener(event,callback){this.events[event]=callback;} focus(){this.focused=true;}
  all(){return [this,...this.children.flatMap(c=>c.all())];}
  querySelector(selector){const label=selector.match(/aria-label="([^"]+)"/)?.[1];return this.all().find(e=>e.attrs['aria-label']===label);}
}
globalThis.__healthDashboardElement=Element;
const result=await build({entryPoints:['src/health-dashboard-view.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export class ItemView { constructor(){this.contentEl=new globalThis.__healthDashboardElement();this.children=[];} addChild(c){this.children.push(c);c.load?.();return c;} removeChild(c){this.children=this.children.filter(x=>x!==c);c.unload?.();return c;} } export class Component {}` }));}}]});
const {HealthDashboardView,healthDashboardWeek,healthWeekDates,dashboardDate}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));

test('seven-day dates validate input and cross month/year/leap boundaries in local time',()=>{
 assert.deepEqual(healthWeekDates('2026-01-03'),['2025-12-28','2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03']);
 assert.equal(healthWeekDates('2024-03-01')[5],'2024-02-29');
 for(const invalid of ['2026-02-30','2026-13-01','','x'])assert.equal(dashboardDate(invalid),null);
 assert.throws(()=>healthWeekDates('2026-02-30'));
});
test('week reads only seven indexed days, preserves absent/zero intake, and never adds activity burn',()=>{
 const food=[],activity=[];
 const week=healthDashboardWeek({getDailyFoodTotals(date){food.push(date);return {entryCount:date.endsWith('03')?0:1,calories:date.endsWith('02')?0:2000};},getDailyActivityTotals(date){activity.push(date);return {entryCount:1,durationMinutes:30,steps:1000,caloriesBurned:900};}}, {energyBmrKcal:1600,energyActivityFactor:1.5},'2026-01-03');
 assert.equal(food.length,7);assert.deepEqual(activity,food);
 assert.equal(week[6].consumedKcal,null);assert.equal(week[6].differenceKcal,null);
 assert.equal(week[5].consumedKcal,0);assert.equal(week[5].differenceKcal,-2400);
 assert.equal(week[0].estimatedBurnKcal,2400);assert.equal(week[0].differenceKcal,-400);
});
function harness(enabled=true){
 const mounted=[],actions=[];let unloads=0,weekReads=0;
 const view=new HealthDashboardView({}, {dashboardEnabled:()=>enabled,mountDashboardDay(container,date,rendered){const c={date,load(){rendered();},unload(){unloads++;}};mounted.push(c);return c;},dashboardWeek(date){weekReads++;return healthDashboardWeek({getDailyFoodTotals:()=>({entryCount:0,calories:0}),getDailyActivityTotals:()=>({entryCount:0,steps:0,durationMinutes:0})},{energyBmrKcal:null,energyActivityFactor:1.2},date);},dashboardAction:(...args)=>actions.push(args)});
 return {view,mounted,actions,counts:()=>({unloads,weekReads})};
}
test('date navigation replaces and unloads one day component, restores focus and routes exact action date',async()=>{
 const h=harness();await h.view.onOpen();assert.equal(h.mounted.length,1);
 const date=h.view.contentEl.querySelector('[aria-label="Health date"]');date.value='2026-09-12';date.events.change();
 assert.equal(h.counts().unloads,1);assert.equal(h.mounted.at(-1).date,'2026-09-12');
 assert.equal(h.view.contentEl.querySelector('[aria-label="Health date"]').focused,true);
 for(const label of ['Log food','Log activity','Start workout','Create recipe','Health settings'])h.view.contentEl.querySelector(`[aria-label="${label}"]`).events.click();
 assert.deepEqual(h.actions.map(x=>x[1]),Array(5).fill('2026-09-12'));
 h.view.contentEl.querySelector('[aria-label="Previous day"]').events.click();assert.equal(h.mounted.at(-1).date,'2026-09-11');
 h.view.contentEl.querySelector('[aria-label="Next day"]').events.click();assert.equal(h.mounted.at(-1).date,'2026-09-12');
 const before=h.mounted.length;const invalid=h.view.contentEl.querySelector('[aria-label="Health date"]');invalid.value='';invalid.events.change();assert.equal(h.mounted.length,before);assert.equal(invalid.value,'2026-09-12');
 await h.view.onClose();assert.equal(h.view.children.length,0);assert.equal(h.counts().unloads,h.mounted.length);
});
test('legacy mode explains the record requirement without mounting readers or importing notes',async()=>{
 const h=harness(false);await h.view.onOpen();assert.equal(h.mounted.length,0);assert.equal(h.counts().weekReads,0);
 assert.match(h.view.contentEl.all().map(e=>e.text).join(' '),/Legacy notes are not imported automatically/);
});
test('dashboard integration reuses indexed day blocks, scoped record events and existing logging flows',()=>{
 const main=readFileSync('src/main.ts','utf8');
 assert.match(main,/expandedActivity: Boolean\(this\.dashboard\)/);
 assert.match(main,/rememberDailyDisclosure\(details, "activities", actions\.disclosures, actions\.expandedActivity\)/);
 assert.match(main,/registerView\(HEALTH_DASHBOARD_VIEW/);assert.match(main,/id: "open-health-dashboard"/);
 assert.match(main,/getLeavesOfType\(HEALTH_DASHBOARD_VIEW\)\[0\]/);
 assert.match(main,/this\.dashboard\?\.dates \?\? \[this\.dateContext\.dateIso\]/);
 assert.match(main,/\+\+this\.renderGeneration;\s*if \(this\.refreshTimer/);
 const view=readFileSync('src/health-dashboard-view.ts','utf8');
 assert.doesNotMatch(view,/getMarkdownFiles|cachedRead|vault\.(read|modify|create)|setInterval|setTimeout|file-open|active-leaf-change/);
});
