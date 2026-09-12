import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const surfaceBuild=await build({entryPoints:[fileURLToPath(new URL("../src/native-workout-surface.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"node",logLevel:"silent"});
const {renderNativeWorkoutSurface}=await import("data:text/javascript;base64,"+Buffer.from(surfaceBuild.outputFiles[0].text).toString("base64"));

// A small structural DOM double: no browser/Obsidian process, timers or writes.
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
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
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
