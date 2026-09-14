import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';

class Element {
  constructor(document, tag = 'div') { this.ownerDocument = document; this.tag = tag; this.listeners = new Map(); this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100; this.classList = { contains: value => value === this.className }; }
  setAttribute(name,value) { this[name]=value; }
  querySelector() { return this.closeButton || null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  contains(element) { return element?.parentElement === this; }
  matches() { return this.tag === 'input'; }
  blur() { this.ownerDocument.activeElement = null; this.parentElement?.listeners.get('focusout')?.({target:this}); }
}
class Scope { constructor(parent) { this.parent = parent; } register(_mods, _key, callback) { this.callback = callback; } }
class Modal {
  constructor(app) { this.scope = new Scope(); this.contentEl = new Element(app.document); this.containerEl = new Element(app.document); this.containerEl.closeButton = new Element(app.document, "button"); this.closed = 0; }
  open() {}
  close() { this.closed++; }
}
const bundle = await esbuild.build({entryPoints:[fileURLToPath(new URL('../src/food-modal-interaction.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
const module = {exports:{}};
new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,()=>({Modal}));
const {FoodInputModal,preserveFoodModalScroll} = module.exports;
function setup() { const document = {activeElement:null}; const modal = new FoodInputModal({document}); modal.open(); const input = new Element(document,'input'); input.parentElement=modal.contentEl;document.activeElement=input; return {modal,input,document}; }

test('Escape and native dismiss requests never close; explicit action still closes',()=>{
 const {modal,document}=setup();modal.scope.callback();assert.equal(document.activeElement,null);assert.equal(modal.closed,0);
 modal.scope.callback();assert.equal(modal.closed,0);modal.close();assert.equal(modal.closed,0);
 const other=setup();other.modal.closeFromAction();assert.equal(other.modal.closed,1);assert.equal(other.modal.containerEl.listeners.size,0);
});
test('one backdrop gesture cannot blur and close the food logger',()=>{
 const {modal,document}=setup();const backdrop=new Element(document);backdrop.className='modal-bg';
 const event=()=>({target:backdrop,cancelable:true,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
 const down=event();modal.containerEl.listeners.get('pointerdown')(down);assert.equal(down.stopped,true);assert.equal(document.activeElement,null);
 const click=event();modal.containerEl.listeners.get('click')(click);assert.equal(click.stopped,true);assert.equal(modal.closed,0);
 const oldNow=Date.now;Date.now=()=>oldNow()+1000;try { const next=event();modal.containerEl.listeners.get('click')(next);assert.equal(next.stopped,true); } finally {Date.now=oldNow;}
});
test('ordinary controls are not swallowed and cleanup removes the keyboard guard',()=>{
 const {modal,input}=setup(); const event={target:input,cancelable:true,stopImmediatePropagation(){throw Error('input blocked');}};
 modal.containerEl.listeners.get('click')(event);modal.closeFromAction();assert.equal(modal.contentEl.listeners.size,0);assert.equal(modal.containerEl.listeners.size,0);
});
test('rerender restores modal and nested scrolling positions synchronously',()=>{
 const content=new Element({}),parent=new Element({});content.parentElement=parent;content.scrollTop=120;parent.scrollTop=75;parent.scrollHeight=500;
 preserveFoodModalScroll(content,()=>{content.scrollTop=0;parent.scrollTop=0;});assert.equal(content.scrollTop,120);assert.equal(parent.scrollTop,75);
});

test('the visible X closes and has a keyboard-accessible label',()=>{
 const {modal}=setup();const button=modal.containerEl.closeButton;
 assert.equal(button.role,'button');assert.equal(button['aria-label'],'Close food logger');
 modal.containerEl.listeners.get('click')({type:'click',target:button,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(modal.closed,1);
 const other=setup();other.modal.containerEl.closeButton.listeners.get('keydown')({key:'Enter',preventDefault(){}});
 assert.equal(other.modal.closed,1);
});
