import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import {transform} from 'esbuild';
import {EditorState, StateField, StateEffect, RangeSetBuilder} from '@codemirror/state';
import {Decoration, EditorView, WidgetType} from '@codemirror/view';

const baseline=process.env.TPS_WORKOUT_EDITOR_BASELINE;
assert.ok(!baseline||baseline==='4.4.0','Use the released 4.4.0 workout-editor baseline');
const source=baseline?execFileSync('git',['show',`${baseline}:src/main.ts`],{encoding:'utf8',maxBuffer:4*1024*1024}):readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=['NativeWorkoutSurfaceWidget','nativeWorkoutEditorPath','createWorkoutSetChipExtension','buildWorkoutSetChipDecorations','refreshNativeWorkoutEditor'];
const declarations=names.map(name=>ast.statements.find(n=>n.name?.text===name)).filter(Boolean).map(n=>n.getText(ast));
const code=await transform(declarations.join('\n')+'\nglobalThis.api={createWorkoutSetChipExtension,refresh:typeof refreshNativeWorkoutEditor===\"function\"?refreshNativeWorkoutEditor:()=>{},NativeWorkoutSurfaceWidget};',{loader:'ts'});
function fixture({indexed=false,active='Inbox/Other.md',source=false,metadata=true,fileInitialized=true}={}) {
 const file={path:'Inbox/Workout.md'},editorInfo={file:fileInitialized?file:null};
 const live=StateField.define({create:()=>!source,update:v=>v}),info=StateField.define({create:()=>editorInfo,update:v=>v});
 const unrelatedEffect=StateEffect.define(),additionalWorkoutPaths=new Set();
 const counts={dispatch:0,globalFile:0,reads:0,scans:0,writes:0,snapshots:0,renders:0};
 const snapshot={id:'workout-qa',path:file.path,status:'active',exercises:[]};
 class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.className='';this.dataset={};this.parentElement=null;this.classList={contains:name=>this.className.split(/\s+/).includes(name)};}
  closest(selector){return this.classList.contains(selector.slice(1))?this:this.parentElement?.closest(selector)||null;}
 }
 const plugin={nativeRecordService:{isEnabled:()=>true,isWorkoutSession:path=>(indexed&&path===file.path)||additionalWorkoutPaths.has(path),
  getWorkoutSnapshot(path){counts.snapshots++;assert.equal(path,file.path);return indexed?snapshot:null;}},
  renderNativeWorkoutSurfaceElement(root,value){counts.renders++;assert.equal(value,snapshot);root.rendered=value;},
  app:{workspace:{getActiveFile(){counts.globalFile++;return {path:active};}}}};
 const context=vm.createContext({EditorState,StateField,StateEffect,RangeSetBuilder,Decoration,EditorView,WidgetType,editorLivePreviewField:live,editorInfoField:info,
 HTMLElement:Element,document:{createElement:tag=>new Element(tag)},
 nativeWorkoutRefresh:StateEffect.define(),
 isWorkoutLikeMarkdownPath:(_p,path)=>metadata&&path===file.path,
 isWorkoutDailyMarkerLine:()=>false,docHasWorkoutSetLine:()=>false,selectionTouchesLineInState:()=>false,workoutSetChipDataFromLine:()=>null});
 vm.runInContext(code.code,context);
 plugin.workoutSetChipField=context.api.createWorkoutSetChipExtension(plugin);
 const cm={state:EditorState.create({doc:'Workout',extensions:[live,info,plugin.workoutSetChipField]}),dispatch(spec){counts.dispatch++;this.state=this.state.update(spec).state;}};
 const widgets=()=>{const result=[];cm.state.field(plugin.workoutSetChipField).between(0,cm.state.doc.length,(_a,_b,value)=>{if(value.spec.widget instanceof context.api.NativeWorkoutSurfaceWidget)result.push(value.spec.widget.filePath);});return result;};
 const mount=({hostLivePreview=false,attached=true}={})=>{
  const host=new Element();host.className=`markdown-source-view${hostLivePreview?' is-live-preview':''}`;
  const dom=new Element();if(attached)dom.parentElement=host;
  let widget;cm.state.field(plugin.workoutSetChipField).between(0,cm.state.doc.length,(_a,_b,value)=>{if(value.spec.widget instanceof context.api.NativeWorkoutSurfaceWidget)widget=value.spec.widget;});
  // Literal Source has no decoration; invoke the actual widget directly to
  // exercise its defensive mode guard at the rendering boundary as well.
  widget??=new context.api.NativeWorkoutSurfaceWidget(plugin,file.path);
  return {root:widget.toDOM({...cm,dom}),host,widget};
 };
 return {cm,plugin,counts,widgets,mount,editorInfo,liveField:live,infoField:info,
  setIndexed:v=>{indexed=v;},setEditorFile:path=>{editorInfo.file=path?{path}:null;},addIndexedWorkout:path=>additionalWorkoutPaths.add(path),
  unrelatedTransaction:()=>cm.dispatch({effects:unrelatedEffect.of(null)}),
  refresh:()=>context.api.refresh(plugin,cm,plugin.workoutSetChipField)};
}
test('workout editor uses its own file when another leaf is active',()=>{
 const f=fixture({indexed:true});assert.deepEqual(f.widgets(),['Inbox/Workout.md']);assert.equal(f.counts.globalFile,0);
});
test('late workout discovery creates the missing decoration without a note edit or cursor movement',()=>{
 const f=fixture({active:'Inbox/Workout.md'});assert.deepEqual(f.widgets(),[]);const before=f.cm.state.doc.toString();f.setIndexed(true);f.refresh();assert.deepEqual(f.widgets(),['Inbox/Workout.md']);assert.equal(f.cm.state.doc.toString(),before);assert.equal(f.counts.dispatch,1);
 for(let i=0;i<100;i++)f.refresh();assert.equal(f.counts.dispatch,1,'unchanged index bursts do not dispatch again');
});
test('loss of workout classification removes the decoration through the editor transaction',()=>{
 const f=fixture({indexed:true,active:'Inbox/Workout.md'});f.setIndexed(false);f.refresh();assert.deepEqual(f.widgets(),[]);assert.equal(f.counts.dispatch,1);f.refresh();assert.equal(f.counts.dispatch,1);
});
test('ordinary files and literal Source mode do not create controls or refresh transactions',()=>{
 for(const options of [{},{indexed:true,source:true}]){const f=fixture(options);for(let i=0;i<100;i++)f.refresh();assert.deepEqual(f.widgets(),[]);assert.equal(f.counts.dispatch,0);}
});

test('the indexed workout creates its surface before the separate metadata cache catches up',()=>{
 const f=fixture({indexed:true,metadata:false});assert.deepEqual(f.widgets(),['Inbox/Workout.md']);f.refresh();assert.equal(f.counts.dispatch,0);
});

for(const attached of [true,false])test(`Live Preview renders the actual workout widget before ${attached?'its host class is initialized':'its source root is attached'}`,()=>{
 const f=fixture({indexed:true}),before=f.cm.state.doc.toString();
 const {root,host,widget}=f.mount({attached});
 assert.equal(root.tagName,'SECTION','A live decoration must not become a permanently empty span during host initialization');
 assert.equal(root.className,'tps-health-native-workout-surface');
 assert.equal(root.dataset.workoutPath,'Inbox/Workout.md');assert.equal(root.dataset.renderContext,'live-preview');
 assert.equal(root.rendered.status,'active');assert.equal(f.counts.snapshots,1);assert.equal(f.counts.renders,1);
 host.className='markdown-source-view is-live-preview';
 for(let n=0;n<100;n++)f.refresh();
 assert.equal(f.counts.dispatch,0,'An already mounted decoration needs no forced editor replay after host initialization');
 assert.equal(f.cm.state.doc.toString(),before);assert.deepEqual(f.widgets(),['Inbox/Workout.md']);
 assert.equal(widget.eq(new widget.constructor(f.plugin,'Inbox/Workout.md')),true,'Widget equality remains based on its owning file');
 assert.equal(f.counts.snapshots,1);assert.equal(f.counts.renders,1,'Unchanged refreshes retain the existing rendered surface');
 assert.equal(f.counts.reads,0);assert.equal(f.counts.scans,0);assert.equal(f.counts.writes,0);assert.equal(f.counts.globalFile,0);
});

test('literal Source refuses workout UI even when its DOM still has the Live Preview class',()=>{
 const f=fixture({indexed:true,source:true});
 const {root}=f.mount({hostLivePreview:true});
 assert.equal(root.tagName,'SPAN');assert.equal(f.counts.snapshots,0);assert.equal(f.counts.renders,0);
 assert.deepEqual(f.widgets(),[]);for(let n=0;n<100;n++)f.refresh();assert.equal(f.counts.dispatch,0);
 assert.equal(f.counts.reads,0);assert.equal(f.counts.scans,0);assert.equal(f.counts.writes,0);
});

test('a late file on the same public editor-info object mounts the workout on the next unrelated transaction',()=>{
 const f=fixture({indexed:true,fileInitialized:false}),before=f.cm.state.doc.toString();
 assert.equal(f.cm.state.field(f.liveField),true);assert.deepEqual(f.widgets(),[]);
 const initialInfo=f.cm.state.field(f.infoField);assert.equal(initialInfo.file,null);
 f.setEditorFile('Inbox/Workout.md');
 assert.equal(f.cm.state.field(f.infoField),initialInfo,'Obsidian can initialize the existing public info object in place');
 f.unrelatedTransaction();
 assert.deepEqual(f.widgets(),['Inbox/Workout.md'],'The field must not require a note edit, selection, mode transition or external replay');
 assert.equal(f.cm.state.field(f.infoField),initialInfo);assert.equal(f.cm.state.doc.toString(),before);
 for(let n=0;n<100;n++)f.unrelatedTransaction();
 assert.equal(f.counts.dispatch,101,'Only the explicitly supplied editor transactions are dispatched');
 assert.deepEqual(f.widgets(),['Inbox/Workout.md']);assert.equal(f.counts.snapshots,0);assert.equal(f.counts.renders,0);
 assert.equal(f.counts.reads,0);assert.equal(f.counts.scans,0);assert.equal(f.counts.writes,0);assert.equal(f.counts.globalFile,0);
});

test('an identical-document file transition replaces the captured workout widget path on an unrelated transaction',()=>{
 const f=fixture({indexed:true}),before=f.cm.state.doc.toString(),initialInfo=f.cm.state.field(f.infoField);
 assert.deepEqual(f.widgets(),['Inbox/Workout.md']);
 f.addIndexedWorkout('Inbox/Another workout.md');f.setEditorFile('Inbox/Another workout.md');
 assert.equal(f.cm.state.field(f.infoField),initialInfo);
 f.unrelatedTransaction();
 assert.deepEqual(f.widgets(),['Inbox/Another workout.md'],'The existing decoration is evidence of its preceding file owner');
 assert.equal(f.cm.state.doc.toString(),before);assert.equal(f.counts.dispatch,1);assert.equal(f.counts.globalFile,0);
 f.setEditorFile('Inbox/Ordinary note.md');f.unrelatedTransaction();
 assert.deepEqual(f.widgets(),[],'Switching to an ordinary note with identical text retires the preceding workout decoration');
 assert.equal(f.cm.state.doc.toString(),before);assert.equal(f.counts.dispatch,2);
 assert.equal(f.counts.snapshots,0);assert.equal(f.counts.renders,0);assert.equal(f.counts.reads,0);assert.equal(f.counts.scans,0);assert.equal(f.counts.writes,0);
});

test('unrelated editor-effect bursts retain ordinary and Source documents without extra dispatch or vault work',()=>{
 for(const options of [{indexed:false},{indexed:true,source:true},{indexed:true,fileInitialized:false}]){
  const f=fixture(options),before=f.cm.state.doc.toString(),decorations=f.cm.state.field(f.plugin.workoutSetChipField);
  for(let n=0;n<500;n++)f.unrelatedTransaction();
  assert.deepEqual(f.widgets(),[]);assert.equal(f.cm.state.field(f.plugin.workoutSetChipField),decorations,'Unchanged non-workout transactions reuse their decoration set');
  assert.equal(f.cm.state.doc.toString(),before);assert.equal(f.counts.dispatch,500);
  assert.equal(f.counts.snapshots,0);assert.equal(f.counts.renders,0);assert.equal(f.counts.reads,0);assert.equal(f.counts.scans,0);assert.equal(f.counts.writes,0);assert.equal(f.counts.globalFile,0);
 }
});
