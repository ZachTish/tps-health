import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import ts from "typescript";

const sourcePath=fileURLToPath(new URL("../src/main.ts",import.meta.url));
const main=readFileSync(sourcePath,"utf8");
const ast=ts.createSourceFile(sourcePath,main,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="nativeWorkoutReadingMountTarget");
assert.ok(declaration,"the tested mount helper must be the actual main.ts function");
const mountBuild=await transform(declaration.getText(ast)+"\nexport {nativeWorkoutReadingMountTarget};",{loader:"ts",format:"esm"});
const {nativeWorkoutReadingMountTarget}=await import("data:text/javascript;base64,"+Buffer.from(mountBuild.code).toString("base64"));
const surfacePath=fileURLToPath(new URL("../src/native-workout-surface.ts",import.meta.url));
const surfaceInput=process.env.TPS_WORKOUT_SURFACE_BASELINE==='4.2.7'
 ? {stdin:{contents:execFileSync('git',['show','4.2.7:src/native-workout-surface.ts'],{encoding:'utf8'}),resolveDir:dirname(surfacePath),sourcefile:surfacePath,loader:'ts'}}
 : {entryPoints:[surfacePath]};
const surfaceBuild=await build({...surfaceInput,bundle:true,write:false,format:"esm",platform:"node",logLevel:"silent"});
const {renderNativeWorkoutSurface}=await import("data:text/javascript;base64,"+Buffer.from(surfaceBuild.outputFiles[0].text).toString("base64"));

// A small structural DOM double: no browser/Obsidian process, real timers or writes.
// Removing a focused descendant clears focus, as replacing the real controls
// would; elapsed-only regression asserts element identity as well as text.
class Element {
 constructor(tag="div"){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.className="";this.dataset={};this.attributes={};this.listeners={};this.value="";this.disabled=false;this.validity={badInput:false};this.rootConnected=false;this.emptyCount=0;
  this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(" ");},toggle:(name,force)=>{const has=this.matches("."+name),next=force===undefined?!has:force;this.className=this.className.split(/\s+/).filter(x=>x!==name).join(" ");if(next)this.classList.add(name);return next;}};
 }
 get isConnected(){return this.rootConnected||Boolean(this.parentElement?.isConnected);}
 get lastElementChild(){return this.children.at(-1)||null;}
 set textContent(value){this._text=String(value);this.emptyChildren();}
 get textContent(){return (this._text||"")+this.children.map(x=>x.textContent).join("");}
 emptyChildren(){if(globalThis.document?.activeElement&&this.children.some(x=>x.contains(document.activeElement)))document.activeElement=null;for(const child of this.children)child.parentElement=null;this.children=[];}
 empty(){this.emptyCount++;this._text="";this.emptyChildren();}
 append(...nodes){for(const node of nodes)this.appendChild(node);}
 appendChild(node){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(x=>x!==node);node.parentElement=this;this.children.push(node);return node;}
 remove(){if(this.parentElement){if(this.contains(document.activeElement))document.activeElement=null;this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 matches(selector){return selector.startsWith(".")&&this.className.split(/\s+/).includes(selector.slice(1));}
 closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 toggleAttribute(name,force){const next=force===undefined?!(name in this.attributes):force;if(next)this.attributes[name]="";else delete this.attributes[name];return next;}
 addEventListener(name,callback){(this.listeners[name]??=[]).push(callback);}
 focus(){document.activeElement=this;}
}
globalThis.HTMLElement=Element;
globalThis.document={activeElement:null,createElement:tag=>new Element(tag)};
globalThis.window={setInterval:()=>1,clearInterval:()=>{}};
const el=(classes="")=>{const node=new Element();node.className=classes;return node;};
const connected=classes=>{const node=el(classes);node.rootConnected=true;return node;};

test("frontmatter-only Reading preview mounts on the sizer that is itself the managed section",()=>{
 const sizer=connected("markdown-preview-sizer markdown-preview-section");
 sizer.append(el("markdown-preview-pusher"),el("mod-header"),el("metadata-container"),el("mod-footer"));
 assert.equal(nativeWorkoutReadingMountTarget(sizer),sizer.lastElementChild);
 assert.equal(nativeWorkoutReadingMountTarget(sizer,sizer.children[2]),sizer.lastElementChild);
});
test("Reading mounting retains the nearest owned section and the last direct managed-section fallback",()=>{
 const sizer=connected("markdown-preview-sizer"),first=el("markdown-preview-section"),last=el("markdown-preview-section"),body=el("el-p");
 sizer.append(first,last);first.append(body);
 assert.equal(nativeWorkoutReadingMountTarget(sizer,body),first);
 assert.equal(nativeWorkoutReadingMountTarget(sizer),last);
 const foreign=connected("markdown-preview-section"),foreignBody=el("el-p");foreign.append(foreignBody);
 assert.equal(nativeWorkoutReadingMountTarget(sizer,foreignBody),last,"foreign rendering root cannot redirect the mount");
});
test("Reading mounting supports a sizer with no managed section",()=>{
 const sizer=connected("markdown-preview-sizer");sizer.append(el("mod-header"),el("el-p"));
 assert.equal(nativeWorkoutReadingMountTarget(sizer),sizer);
});
const snapshot=()=>({id:"workout-qa",path:"QA/workout.md",title:"QA workout",status:"active",startedAt:"2026-09-09T12:00:00Z",endedAt:"",setCount:1,exerciseCount:1,
 exercises:[{id:"exercise-qa",path:"QA/workout.md#exercise-qa",name:"QA press",totalReps:8,totalVolume:160,sets:[
 {id:"set-qa",ordinal:1,reps:8,weight:20,weightUnit:"kg",perArm:false,rpe:7.5,restSeconds:90,setType:"normal",restStartedAt:"",completedDate:""}
 ]}]});
const options=elapsed=>({active:true,elapsedLabel:elapsed,instanceKey:"qa",defaultRestSeconds:90,showSessionActions:true,
 actions:{addExercise(){},addSet(){},updateSet(){},openExerciseMenu(){},openSetMenu(){},finish(){}}});
test("elapsed-only refresh preserves focused input identity and unsaved draft while updating the visible clock",()=>{
 const root=connected(""),data=snapshot();
 renderNativeWorkoutSurface(root,data,options("1:00"));
 const reps=root.querySelectorAll(".tps-health-native-workout-input").find(input=>input.attributes["aria-label"].endsWith("reps"));
 assert.ok(reps);reps.focus();reps.value="18";
 const emptyCount=root.emptyCount;
 renderNativeWorkoutSurface(root,data,options("1:01"));
 assert.equal(root.emptyCount,emptyCount);
 assert.equal(document.activeElement,reps);
 assert.equal(root.querySelectorAll(".tps-health-native-workout-input").find(input=>input.attributes["aria-label"].endsWith("reps")),reps);
 assert.equal(reps.value,"18");
 assert.match(root.querySelector(".tps-health-native-workout-summary").textContent,/^1:01/);
});
test("a real saved-set change still updates the rendered record rather than keeping stale inputs",()=>{
 const root=connected(""),data=snapshot();
 renderNativeWorkoutSurface(root,data,options("1:00"));
 const before=root.emptyCount;
 const changed=snapshot();changed.exercises[0].sets[0].reps=9;
 renderNativeWorkoutSurface(root,changed,options("1:01"));
 assert.equal(root.emptyCount,before+1);
 const reps=root.querySelectorAll(".tps-health-native-workout-input").find(input=>input.attributes["aria-label"].endsWith("reps"));
 assert.equal(reps.value,"9");
});
const edit=(root,field)=>root.querySelectorAll('.tps-health-native-workout-edit-control').find(control=>control.dataset.field===field);
const event=(control,name)=>{for(const listener of control.listeners[name]||[])listener({});};
const settled=async()=>{for(let turn=0;turn<5;turn++)await Promise.resolve();};
test('per-arm, exercise identity and displayed totals participate in the saved refresh signature',()=>{
 const root=connected(''),data=snapshot();renderNativeWorkoutSurface(root,data,options('1:00'));
 const changed=snapshot();changed.exercises[0].sets[0].perArm=true;changed.exercises[0].totalVolume=320;
 renderNativeWorkoutSurface(root,changed,options('1:01'));
 assert.equal(edit(root,'perArm').checked,true);assert.match(root.querySelector('.tps-health-native-workout-exercise-total').textContent,/320 volume/);
 changed.exercises[0].name='Updated press';changed.exercises[0].sets[0].ordinal=2;
 renderNativeWorkoutSurface(root,changed,options('1:02'));
 assert.match(root.querySelector('.tps-health-native-workout-exercise-name').textContent,/Updated press/);
 assert.match(edit(root,'reps').attributes['aria-label'],/set 2 reps/);
});
test('an unfinished sibling-field edit survives saved changes, two pending snapshots, focus and blur',()=>{
 const root=connected('');renderNativeWorkoutSurface(root,snapshot(),options('1:00'));
 const weight=edit(root,'weight');weight.focus();weight.value='33';
 const first=snapshot();first.exercises[0].sets[0].reps=9;renderNativeWorkoutSurface(root,first,options('1:01'));
 const latest=snapshot();latest.exercises[0].sets[0].reps=10;renderNativeWorkoutSurface(root,latest,options('1:02'));
 assert.equal(edit(root,'weight'),weight);assert.equal(weight.value,'33');assert.equal(document.activeElement,weight);
 event(weight,'blur');event(weight,'focusout');assert.equal(weight.value,'33');assert.equal(edit(root,'reps').value,'8');
 weight.value='20';event(weight,'input');
 assert.equal(edit(root,'reps').value,'10','revert applies latest pending data, never the earlier snapshot');
 assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);
});
test('badInput remains the same browser element until explicitly corrected or reverted',()=>{
 const root=connected('');renderNativeWorkoutSurface(root,snapshot(),options('1:00'));
 const weight=edit(root,'weight');weight.focus();weight.value='';weight.validity.badInput=true;
 const changed=snapshot();changed.exercises[0].sets[0].reps=9;renderNativeWorkoutSurface(root,changed,options('1:01'));
 event(weight,'input');event(weight,'blur');assert.equal(edit(root,'weight'),weight);assert.equal(weight.validity.badInput,true);
 weight.value='20';weight.validity.badInput=false;event(weight,'input');assert.equal(edit(root,'reps').value,'9');
});
test('latest clock-only signature supersedes an older pending snapshot without replacing a draft',()=>{
 const root=connected(''),original=snapshot();renderNativeWorkoutSurface(root,original,options('1:00'));
 const weight=edit(root,'weight');weight.focus();weight.value='33';
 const pending=snapshot();pending.exercises[0].sets[0].reps=9;renderNativeWorkoutSurface(root,pending,options('1:01'));
 assert.ok(root.querySelector('.tps-health-native-workout-pending-refresh'));
 renderNativeWorkoutSurface(root,snapshot(),options('1:02'));
 assert.equal(edit(root,'weight'),weight);assert.equal(weight.value,'33');assert.equal(document.activeElement,weight);
 assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);
 assert.match(root.querySelector('.tps-health-native-workout-summary').textContent,/^1:02/);
 weight.value='20';event(weight,'input');assert.equal(edit(root,'reps').value,'8','older deferred reps9 must not replay after latest authoritative reps8');
});
test('successful own save reveals its new snapshot without replaying pre-save pending values',async()=>{
 const root=connected(''),opts=options('1:00');let release;
 opts.actions.updateSet=async()=>{await new Promise(resolve=>release=resolve);const committed=snapshot();committed.exercises[0].sets[0].weight=33;committed.exercises[0].sets[0].reps=11;renderNativeWorkoutSurface(root,committed,opts);};
 renderNativeWorkoutSurface(root,snapshot(),opts);const weight=edit(root,'weight');weight.focus();weight.value='33.0';
 const beforeSave=snapshot();beforeSave.exercises[0].sets[0].reps=9;renderNativeWorkoutSurface(root,beforeSave,opts);
 event(weight,'change');assert.equal(weight.disabled,false);assert.equal(weight.attributes['aria-busy'],'true');release();await settled();
 assert.equal(edit(root,'weight').value,'33');assert.equal(edit(root,'reps').value,'11');
 assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);
});
test('failed save retains draft and never flushes an obsolete pre-save pending snapshot',async()=>{
 const root=connected(''),opts=options('1:00');opts.actions.updateSet=async()=>{throw Error('Conflict');};
 renderNativeWorkoutSurface(root,snapshot(),opts);const weight=edit(root,'weight');weight.value='33';
 const pending=snapshot();pending.exercises[0].sets[0].reps=9;renderNativeWorkoutSurface(root,pending,opts);
 event(weight,'change');await settled();assert.equal(edit(root,'weight'),weight);assert.equal(weight.value,'33');assert.equal(weight.disabled,false);
 assert.match(root.querySelector('.tps-health-native-workout-save-state').textContent,/Retry/);
});
test('terminal, session and renderer replacement clear deferred state without replaying prior drafts',()=>{
 for(const replacement of ['terminal','session','instance']){
  const root=connected(''),opts=options('1:00');renderNativeWorkoutSurface(root,snapshot(),opts);
  const weight=edit(root,'weight');weight.value='33';const pending=snapshot();pending.exercises[0].sets[0].reps=9;renderNativeWorkoutSurface(root,pending,opts);
  const next=snapshot();next.exercises[0].sets[0].reps=12;const nextOpts={...opts};
  if(replacement==='terminal'){next.status='complete';nextOpts.active=false;}else if(replacement==='session')next.id='workout-new';else nextOpts.instanceKey='new-instance';
  renderNativeWorkoutSurface(root,next,nextOpts);weight.value='20';event(weight,'input');
  assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);assert.equal(root.dataset.workoutId,next.id);
  assert.equal(replacement==='terminal'?root.querySelectorAll('.tps-health-native-workout-edit-control').length:edit(root,'reps').value,replacement==='terminal'?0:'12');
 }
});
test("a new empty native workout still shows its user actions after mounting in Reading mode",()=>{
 const root=connected(""),data={...snapshot(),exercises:[],exerciseCount:0,setCount:0};
 renderNativeWorkoutSurface(root,data,options("0:00"));
 assert.match(root.textContent,/No exercises yet/);
 assert.match(root.textContent,/Finish/);
 assert.match(root.textContent,/\+ Exercise/);
});

test('saved updates preserve the next pristine keyboard field without disabling the edited input', async()=>{
 const root=connected(''), data=snapshot(), opts=options('1:00');
 let resolveSave; opts.actions.updateSet=()=>new Promise(resolve=>{resolveSave=resolve;});
 renderNativeWorkoutSurface(root,data,opts);
 const reps=edit(root,'reps'); reps.focus(); reps.value='9'; event(reps,'change');
 assert.equal(reps.disabled,false,'change must not disable and blur native keyboard navigation');
 const weight=edit(root,'weight'); weight.focus();
 const changed=snapshot(); changed.exercises[0].sets[0].reps=9;
 renderNativeWorkoutSurface(root,changed,opts);
 assert.equal(document.activeElement,edit(root,'weight'));
 assert.equal(edit(root,'reps').value,'9');
 resolveSave(); await settled();
 assert.equal(document.activeElement,edit(root,'weight'));
});

test('saved refresh does not steal focus from outside the workout',()=>{
 const root=connected(''), data=snapshot(); renderNativeWorkoutSurface(root,data,options('1:00'));
 const outside=connected(''); outside.focus(); data.exercises[0].sets[0].reps=10;
 renderNativeWorkoutSurface(root,data,options('1:01')); assert.equal(document.activeElement,outside);
});

test('native workout inputs own their events instead of moving the note editor selection', async()=>{
 const widget=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='NativeWorkoutSurfaceWidget');
 const method=widget.members.find(node=>node.name?.getText(ast)==='ignoreEvent');
 const compiled=await transform('class Surface {'+method.getText(ast)+'} export default new Surface();',{loader:'ts',format:'esm'});
 const {default:surface}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
 assert.equal(surface.ignoreEvent(),true);
});

test('adjacent drop chains have separate boundaries and readable group labels',()=>{
 const root=connected(''), data=snapshot();
 const original=data.exercises[0].sets[0];
 data.exercises[0].sets=[0,1,2,3].map(i=>({...original,id:`s${i}`,ordinal:i+1,dropSetGroupId:i<2?'first':'second'}));
 renderNativeWorkoutSurface(root,data,options('1:00'));
 const rows=root.querySelectorAll('.is-drop-set');
 assert.equal(rows.length,4);
 assert.equal(rows[0].classList.contains('is-drop-start'),true);
 assert.equal(rows[1].classList.contains('is-drop-end'),true);
 assert.equal(rows[2].classList.contains('is-drop-start'),true);
 assert.equal(rows[3].classList.contains('is-drop-end'),true);
 assert.equal(rows[2].classList.contains('is-drop-alternate'),true);
 assert.equal(rows[0].querySelector('.tps-health-native-drop-label').textContent,'D1');
 assert.equal(rows[2].querySelector('.tps-health-native-drop-label').textContent,'D2');
});

// The actual renderer registers/ticks its existing intervals. This bounded host
// owns fake time and DOM only; counts are not installed/mobile latency claims.
function workoutIntervals(t) {
 const originalWindow=globalThis.window, originalNow=Date.now;
 let now=Date.parse('2026-09-09T12:00:00Z'),nextId=0;
 const timers=new Map(),counts={registered:0,cleared:0,callbacks:0};
 Date.now=()=>now;
 globalThis.window={
  setInterval(callback,delay){assert.equal(delay,1000);const id=++nextId;counts.registered++;timers.set(id,callback);return id;},
  clearInterval(id){if(timers.delete(id))counts.cleared++;},
 };
 t.after(()=>{globalThis.window=originalWindow;Date.now=originalNow;});
 return {counts,timers,stamp:()=>new Date(now).toISOString(),tick(){now+=1000;for(const [id,callback] of [...timers])if(timers.has(id)){counts.callbacks++;callback();}}};
}
function workoutWithSets(sets) {
 const data=snapshot(),base=data.exercises[0].sets[0];
 data.exercises[0].sets=sets.map((fields,index)=>({...base,id:`set-${index}`,ordinal:index+1,...fields}));
 data.setCount=sets.length;
 return data;
}
test('25 completed active rows register zero rest timers and keep blank hidden countdowns',(t)=>{
 const intervals=workoutIntervals(t),root=connected('');
 const data=workoutWithSets(Array.from({length:25},()=>({completedDate:intervals.stamp(),restStartedAt:intervals.stamp()})));
 renderNativeWorkoutSurface(root,data,options('1:00'));
 assert.equal(intervals.counts.registered,0);
 for(let tick=0;tick<20;tick++)intervals.tick();
 assert.equal(intervals.counts.callbacks,0);
 assert.equal(root.querySelectorAll('.tps-health-native-workout-edit-control').length,25*7,'Completed rows remain editable');
 const countdowns=root.querySelectorAll('.tps-health-native-workout-rest-countdown');
 assert.equal(countdowns.length,25);
 for(const countdown of countdowns){assert.equal(countdown.textContent,'');assert.ok('hidden' in countdown.attributes);}
});
test('pending rows with absent or invalid rest timestamps register zero countdown timers',(t)=>{
 const intervals=workoutIntervals(t),root=connected('');
 const data=workoutWithSets(['','not-a-date','2026-99-99'].map(restStartedAt=>({restStartedAt})));
 renderNativeWorkoutSurface(root,data,options('1:00'));
 assert.equal(intervals.counts.registered,0);
 intervals.tick();assert.equal(intervals.counts.callbacks,0);
 for(const countdown of root.querySelectorAll('.tps-health-native-workout-rest-countdown'))assert.equal(countdown.textContent,'');
});
test('only a pending valid rest stamp registers a timer and it still follows edited duration',(t)=>{
 const intervals=workoutIntervals(t),root=connected('');
 const data=workoutWithSets([
  {completedDate:intervals.stamp(),restStartedAt:intervals.stamp()},
  {restStartedAt:''},{restStartedAt:'not-a-date'},{restStartedAt:intervals.stamp()},
 ]);
 renderNativeWorkoutSurface(root,data,options('1:00'));
 assert.equal(intervals.counts.registered,1);assert.equal(intervals.timers.size,1);
 const countdowns=root.querySelectorAll('.tps-health-native-workout-rest-countdown');
 assert.equal(countdowns[3].textContent,'1:30');
 intervals.tick();assert.equal(countdowns[3].textContent,'1:29');
 const rest=root.querySelectorAll('.tps-health-native-workout-edit-control').find(control=>control.dataset.setId==='set-3'&&control.dataset.field==='restSeconds');
 rest.focus();rest.value='120';intervals.tick();assert.equal(countdowns[3].textContent,'1:58');
 assert.equal(document.activeElement,rest);assert.equal(rest.value,'120');
});
test('completion and uncompletion use the saved signature to retire and restore eligible timers',(t)=>{
 const intervals=workoutIntervals(t),root=connected('');
 const completed=workoutWithSets([{completedDate:intervals.stamp(),restStartedAt:intervals.stamp()}]);
 renderNativeWorkoutSurface(root,completed,options('1:00'));assert.equal(intervals.timers.size,0);
 const pending=structuredClone(completed);pending.exercises[0].sets[0].completedDate='';
 renderNativeWorkoutSurface(root,pending,options('1:01'));assert.equal(intervals.timers.size,1);
 renderNativeWorkoutSurface(root,completed,options('1:02'));intervals.tick();
 assert.equal(intervals.timers.size,0);assert.equal(intervals.counts.registered,1);assert.equal(intervals.counts.cleared,1);
 assert.equal(root.querySelector('.tps-health-native-workout-rest-countdown').textContent,'');
});
test('a new or removed rest stamp changes timer eligibility through the existing saved render signature',(t)=>{
 const intervals=workoutIntervals(t),root=connected(''),data=snapshot();
 renderNativeWorkoutSurface(root,data,options('1:00'));assert.equal(intervals.timers.size,0);
 const started=structuredClone(data);started.exercises[0].sets[0].restStartedAt=intervals.stamp();
 renderNativeWorkoutSurface(root,started,options('1:01'));assert.equal(intervals.timers.size,1);
 renderNativeWorkoutSurface(root,data,options('1:02'));intervals.tick();
 assert.equal(intervals.timers.size,0);assert.equal(intervals.counts.cleared,1);
});
test('100 unchanged elapsed refreshes keep one eligible timer, focused control identity and its draft',(t)=>{
 const intervals=workoutIntervals(t),root=connected(''),data=snapshot();
 data.exercises[0].sets[0].restStartedAt=intervals.stamp();
 renderNativeWorkoutSurface(root,data,options('1:00'));
 const weight=edit(root,'weight');weight.focus();weight.value='33';const emptied=root.emptyCount;
 let exerciseQueries=0;const query=root.querySelectorAll.bind(root);
 root.querySelectorAll=selector=>{if(selector==='.tps-health-native-workout-exercise')exerciseQueries++;return query(selector);};
 for(let refresh=0;refresh<100;refresh++)renderNativeWorkoutSurface(root,data,options(`1:${refresh}`));
 assert.equal(intervals.counts.registered,1);assert.equal(root.emptyCount,emptied);
 assert.equal(exerciseQueries,0,'Clock-only refreshes do not enter obsolete-exercise pruning');
 assert.equal(edit(root,'weight'),weight);assert.equal(document.activeElement,weight);assert.equal(weight.value,'33');
 assert.equal(intervals.counts.callbacks,0,'Rendering does not execute a periodic callback');
});
test('25 detached eligible rows clear their existing intervals on the next tick and stay idle',(t)=>{
 const intervals=workoutIntervals(t),root=connected('');
 const data=workoutWithSets(Array.from({length:25},()=>({restStartedAt:intervals.stamp()})));
 renderNativeWorkoutSurface(root,data,options('1:00'));assert.equal(intervals.timers.size,25);
 root.rootConnected=false;intervals.tick();
 assert.deepEqual(intervals.counts,{registered:25,cleared:25,callbacks:25});assert.equal(intervals.timers.size,0);
 for(let tick=0;tick<20;tick++)intervals.tick();assert.equal(intervals.counts.callbacks,25);
});
test('inactive rows never register rest timers even with a valid pending rest stamp',(t)=>{
 const intervals=workoutIntervals(t),root=connected(''),data=snapshot();
 data.exercises[0].sets[0].restStartedAt=intervals.stamp();
 renderNativeWorkoutSurface(root,data,{...options('1:00'),active:false});
 assert.equal(intervals.counts.registered,0);assert.equal(root.querySelectorAll('.tps-health-native-workout-edit-control').length,0);
});
for(const draft of ['focused','badInput'])test(`a removed exercise's ${draft} draft cannot defer its authoritative removal`,()=>{
 const root=connected('');renderNativeWorkoutSurface(root,snapshot(),options('1:00'));
 const weight=edit(root,'weight');weight.focus();weight.value=draft==='badInput'?'':'33';weight.validity.badInput=draft==='badInput';
 const removed={...snapshot(),exercises:[],exerciseCount:0,setCount:0};
 renderNativeWorkoutSurface(root,removed,options('1:01'));
 assert.equal(root.querySelectorAll('.tps-health-native-workout-exercise').length,0);
 assert.equal(root.querySelectorAll('.tps-health-native-workout-edit-control').length,0);
 assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);
 assert.match(root.textContent,/No exercises yet/);assert.notEqual(document.activeElement,weight);
});
test('a removed set draft also cannot defer a saved empty-set state of its retained exercise',()=>{
 const root=connected('');renderNativeWorkoutSurface(root,snapshot(),options('1:00'));
 const reps=edit(root,'reps');reps.focus();reps.value='';reps.validity.badInput=true;
 const next=snapshot();next.exercises[0].sets=[];next.setCount=0;
 renderNativeWorkoutSurface(root,next,options('1:01'));
 assert.deepEqual(root.querySelectorAll('.tps-health-native-workout-exercise').map(card=>card.dataset.exerciseId),['exercise-qa']);
 assert.equal(root.querySelectorAll('.tps-health-native-workout-edit-control').length,0);
 assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);
});
test('removal prunes only its obsolete exercise while a retained draft defers the latest remaining values',()=>{
 const root=connected(''),original=snapshot();
 const retained=structuredClone(original.exercises[0]);
 retained.id='exercise-retained';retained.name='Retained exercise';retained.path='QA/workout.md#exercise-retained';retained.sets[0].id='set-retained';
 original.exercises.push(retained);original.exerciseCount=2;original.setCount=2;
 renderNativeWorkoutSurface(root,original,options('1:00'));
 const weight=root.querySelectorAll('.tps-health-native-workout-edit-control').find(control=>control.dataset.setId==='set-retained'&&control.dataset.field==='weight');
 weight.focus();weight.value='45';
 const removedWeight=root.querySelectorAll('.tps-health-native-workout-edit-control').find(control=>control.dataset.setId==='set-qa'&&control.dataset.field==='weight');
 removedWeight.value='';removedWeight.validity.badInput=true;
 const first=structuredClone(original);first.exercises.shift();first.exerciseCount=1;first.setCount=1;first.exercises[0].sets[0].reps=11;
 renderNativeWorkoutSurface(root,first,options('1:01'));
 assert.deepEqual(root.querySelectorAll('.tps-health-native-workout-exercise').map(card=>card.dataset.exerciseId),['exercise-retained']);
 assert.equal(removedWeight.isConnected,false);
 assert.equal(root.querySelectorAll('.tps-health-native-workout-edit-control').find(control=>control.dataset.setId==='set-retained'&&control.dataset.field==='weight'),weight);
 assert.equal(weight.value,'45');assert.equal(document.activeElement,weight);
 assert.ok(root.querySelector('.tps-health-native-workout-pending-refresh'));
 const latest=structuredClone(first);latest.exercises[0].sets[0].reps=12;
 renderNativeWorkoutSurface(root,latest,options('1:02'));
 assert.equal(weight.value,'45');assert.equal(document.activeElement,weight);
 weight.value='20';event(weight,'input');
 assert.equal(edit(root,'reps').value,'12','Reverting the retained draft applies the latest pending snapshot');
 assert.equal(root.querySelector('.tps-health-native-workout-pending-refresh'),null);
 assert.deepEqual(root.querySelectorAll('.tps-health-native-workout-exercise').map(card=>card.dataset.exerciseId),['exercise-retained']);
});
