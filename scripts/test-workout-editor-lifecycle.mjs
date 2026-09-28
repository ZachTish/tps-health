import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transform} from 'esbuild';
import {EditorState, StateField, StateEffect, RangeSetBuilder} from '@codemirror/state';
import {Decoration, EditorView, WidgetType} from '@codemirror/view';

const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=['NativeWorkoutSurfaceWidget','createWorkoutSetChipExtension','buildWorkoutSetChipDecorations','refreshNativeWorkoutEditor'];
const declarations=names.map(name=>ast.statements.find(n=>n.name?.text===name)).filter(Boolean).map(n=>n.getText(ast));
const code=await transform(declarations.join('\n')+'\nglobalThis.api={createWorkoutSetChipExtension,refresh:typeof refreshNativeWorkoutEditor===\"function\"?refreshNativeWorkoutEditor:()=>{},NativeWorkoutSurfaceWidget};',{loader:'ts'});
function fixture({indexed=false,active='Inbox/Other.md',source=false,metadata=true}={}) {
 const file={path:'Inbox/Workout.md'}, live=StateField.define({create:()=>!source,update:v=>v}),info=StateField.define({create:()=>({file}),update:v=>v});
 const counts={dispatch:0,globalFile:0,reads:0,scans:0,writes:0};
 const plugin={nativeRecordService:{isEnabled:()=>true,isWorkoutSession:path=>indexed&&path===file.path},app:{workspace:{getActiveFile(){counts.globalFile++;return {path:active};}}}};
 const context=vm.createContext({EditorState,StateField,StateEffect,RangeSetBuilder,Decoration,EditorView,WidgetType,editorLivePreviewField:live,editorInfoField:info,
 nativeWorkoutRefresh:StateEffect.define(),
 isWorkoutLikeMarkdownPath:(_p,path)=>metadata&&path===file.path,
 isWorkoutDailyMarkerLine:()=>false,docHasWorkoutSetLine:()=>false,selectionTouchesLineInState:()=>false,workoutSetChipDataFromLine:()=>null});
 vm.runInContext(code.code,context);
 plugin.workoutSetChipField=context.api.createWorkoutSetChipExtension(plugin);
 const cm={state:EditorState.create({doc:'Workout',extensions:[live,info,plugin.workoutSetChipField]}),dispatch(spec){counts.dispatch++;this.state=this.state.update(spec).state;}};
 const widgets=()=>{const result=[];cm.state.field(plugin.workoutSetChipField).between(0,cm.state.doc.length,(_a,_b,value)=>{if(value.spec.widget instanceof context.api.NativeWorkoutSurfaceWidget)result.push(value.spec.widget.filePath);});return result;};
 return {cm,plugin,counts,widgets,setIndexed:v=>{indexed=v;},refresh:()=>context.api.refresh(plugin,cm,plugin.workoutSetChipField)};
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
