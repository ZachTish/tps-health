import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

class Element {
  constructor(tag='div',options={}) {this.tag=tag;this.text=options.text||'';this.cls=options.cls||'';this.attrs=options.attr||{};this.children=[];this.events={};this.value='';}
  createEl(tag,options={}){const child=new Element(tag,options);this.children.push(child);return child;}
  createDiv(options={}){return this.createEl('div',options);}
  createSpan(options={}){return this.createEl('span',options);}
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
test('activity-notes week uses the same selected-date energy index without adding native workout totals twice',()=>{
 const reads=[];
 const index={getDailyFoodTotals:()=>({entryCount:1,calories:2100}),
   getDailyActivityTotals:()=>({entryCount:1,durationMinutes:30,steps:1000,caloriesBurned:900}),
   getDailyEnergyActivityTotals(dateIso){reads.push(dateIso);return {dateIso,entryCount:1,caloriesBurned:dateIso.endsWith('03')?500:200};}};
 const week=healthDashboardWeek(index,{energyBmrKcal:1600,energyActivityFactor:1.5,energyEstimateMode:'activity-notes'},'2026-01-03');
 assert.equal(reads.length,7);assert.equal(week[6].estimatedBurnKcal,2100);assert.equal(week[6].differenceKcal,0);
 assert.equal(week[0].estimatedBurnKcal,1800);assert.equal(week[0].differenceKcal,300);
 reads.length=0;
 healthDashboardWeek(index,{energyBmrKcal:1600,energyActivityFactor:1.5},'2026-01-03');
 assert.equal(reads.length,0,'other methods do not request the activity-energy index');
});
test('one seven-day read renders a compact glance before daily detail and full mobile cards after it',async()=>{
 const h=harness();await h.view.onOpen();
 const sections=h.view.contentEl.children.map(e=>e.cls);
 assert.ok(sections.indexOf('tps-health-dashboard-glance')<sections.indexOf('tps-health-dashboard-day'));
 assert.ok(sections.indexOf('tps-health-dashboard-day')<sections.indexOf('tps-health-dashboard-week'));
 assert.deepEqual(h.counts(),{unloads:0,weekReads:1,foodReads:7,activityReads:7});
 const glance=h.view.contentEl.children.find(e=>e.cls==='tps-health-dashboard-glance');
 const glanceButtons=glance.all().filter(e=>e.cls==='tps-health-dashboard-glance-day');
 assert.equal(glanceButtons.length,7);
 assert.equal(glanceButtons[0].attrs['aria-current'],'date','the selected, newest day is visible first in the mobile strip');
 assert.match(glanceButtons[0].attrs['aria-label'],/^View \d{4}-\d{2}-\d{2}: No food log, No activity$/u);
 const table=h.view.contentEl.all().find(e=>e.tag==='table');
 assert.deepEqual(table.all().filter(e=>e.tag==='thead').flatMap(e=>e.all()).filter(e=>e.tag==='th').map(e=>e.text),['Day','Intake','Est. burn','Difference','Activity']);
 const rows=table.all().filter(e=>e.tag==='tbody').flatMap(e=>e.children).filter(e=>e.tag==='tr');
 assert.equal(rows.length,7);
 for(const row of rows)assert.deepEqual(row.children.filter(e=>e.tag==='td').map(e=>e.attrs['data-label']),['Intake','Est. burn','Difference','Activity']);
 const css=readFileSync('styles.css','utf8');
 assert.match(css,/\.tps-health-dashboard-actions \{ flex-wrap: nowrap; overflow-x: auto;/);
 assert.match(css,/\.tps-health-dashboard-glance-days \{ display: flex; flex-wrap: nowrap;[^}]*overflow-x: auto;/);
 assert.match(css,/\.tps-health-dashboard-glance-day \{[^}]*flex: 1 0 160px;/);
 assert.match(css,/\.tps-health-dashboard-glance-day \{ flex: 0 0 min\(42vw, 160px\); scroll-snap-align: start;/);
 assert.match(css,/\.tps-health-dashboard-view :is\(button, input\) \{ min-height: 44px;/);
 assert.match(css,/\.tps-health-dashboard-table tbody tr \{ display: grid;/);
 assert.match(css,/\.tps-health-dashboard-table tbody td::before \{ content: attr\(data-label\)/);
 await h.view.onClose();
});
function harness(enabled=true,indexing=false,knownFood=false,deferWeek=false){
 const mounted=[],actions=[];let unloads=0,weekReads=0,foodReads=0,activityReads=0;
 const view=new HealthDashboardView({}, {dashboardEnabled:()=>enabled,mountDashboardDay(container,date,rendered){const c={date,load(){if(!deferWeek)rendered(indexing);},unload(){unloads++;}};mounted.push(c);return c;},dashboardWeek(date){weekReads++;return healthDashboardWeek({getDailyFoodTotals:day=>{foodReads++;return {entryCount:knownFood&&day===date?1:0,calories:210};},getDailyActivityTotals:()=>{activityReads++;return {entryCount:0,steps:0,durationMinutes:0};}},{energyBmrKcal:null,energyActivityFactor:1.2},date);},dashboardAction:(...args)=>actions.push(args)});
 return {view,mounted,actions,counts:()=>({unloads,weekReads,foodReads,activityReads})};
}
test('partial seven-day comparison displays known intake and never claims a definitive empty week',async()=>{
 const known=harness(true,true,true);await known.view.onOpen();
 const knownText=known.view.contentEl.all().map(e=>e.text).join(' ');
 assert.match(knownText,/Indexing remaining notes; seven-day totals may change/u);
 assert.match(knownText,/1 of 7 days with known food logs/u);
 assert.ok(known.view.contentEl.all().some(e=>e.tag==='td'&&e.attrs['data-label']==='Intake'&&e.text==='210'));
 assert.equal(known.counts().weekReads,1,'partial status mounts the week instead of leaving it blank');
 await known.view.onClose();
 const empty=harness(true,true);await empty.view.onOpen();
 const emptyText=empty.view.contentEl.all().map(e=>e.text).join(' ');
 assert.match(emptyText,/Checking seven days for food logs/u);
 assert.match(emptyText,/Food pending/u);
 assert.doesNotMatch(emptyText,/0 of 7 days with food logs/u);
 await empty.view.onClose();
});
test('glance shows an honest loading state before the native day index renders',async()=>{
 const h=harness(true,false,false,true);await h.view.onOpen();
 assert.equal(h.counts().weekReads,0);
 const glance=h.view.contentEl.children.find(e=>e.cls==='tps-health-dashboard-glance');
 assert.match(glance.all().map(e=>e.text).join(' '),/Loading recent Health records/u);
 assert.equal(h.view.contentEl.all().some(e=>e.cls==='tps-health-dashboard-glance-day'),false);
 await h.view.onClose();
});
test('date navigation replaces and unloads one day component, restores focus and routes exact action date',async()=>{
 const h=harness();await h.view.onOpen();assert.equal(h.mounted.length,1);
 const date=h.view.contentEl.querySelector('[aria-label="Health date"]');date.value='2026-09-12';date.events.change();
 assert.equal(h.counts().unloads,1);assert.equal(h.mounted.at(-1).date,'2026-09-12');
 const sections=h.view.contentEl.children.map(e=>e.cls);
 assert.ok(sections.indexOf('tps-health-dashboard-glance')<sections.indexOf('tps-health-dashboard-day'));
 assert.ok(sections.indexOf('tps-health-dashboard-day')<sections.indexOf('tps-health-dashboard-week'));
 assert.equal(h.view.contentEl.querySelector('[aria-label="Health date"]').focused,true);
 const glance=h.view.contentEl.children.find(e=>e.cls==='tps-health-dashboard-glance');
 const previous=glance.all().filter(e=>e.cls==='tps-health-dashboard-glance-day')[1];
 assert.match(previous.attrs['aria-label'],/^View 2026-09-11:/u);
 previous.events.click();
 assert.equal(h.mounted.at(-1).date,'2026-09-11');
 assert.equal(h.view.contentEl.querySelector('[aria-label="Health date"]').focused,true);
 assert.equal(h.view.contentEl.all().find(e=>e.cls==='tps-health-dashboard-glance-day').attrs['aria-current'],'date');
 assert.deepEqual(h.counts(),{unloads:2,weekReads:3,foodReads:21,activityReads:21});
 for(const label of ['Log food','Log activity','Start workout','Create recipe','Health settings'])h.view.contentEl.querySelector(`[aria-label="${label}"]`).events.click();
 assert.deepEqual(h.actions.map(x=>x[1]),Array(5).fill('2026-09-11'));
 h.view.contentEl.querySelector('[aria-label="Previous day"]').events.click();assert.equal(h.mounted.at(-1).date,'2026-09-10');
 h.view.contentEl.querySelector('[aria-label="Next day"]').events.click();assert.equal(h.mounted.at(-1).date,'2026-09-11');
 const before=h.mounted.length;const invalid=h.view.contentEl.querySelector('[aria-label="Health date"]');invalid.value='';invalid.events.change();assert.equal(h.mounted.length,before);assert.equal(invalid.value,'2026-09-11');
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
 assert.match(main,/\+\+this\.renderGeneration;\s*this\.renderPending = null;\s*this\.refreshRequested = false;\s*if \(this\.refreshTimer/);
 const view=readFileSync('src/health-dashboard-view.ts','utf8');
 assert.doesNotMatch(view,/getMarkdownFiles|cachedRead|vault\.(read|modify|create)|setInterval|setTimeout|file-open|active-leaf-change/);
});
