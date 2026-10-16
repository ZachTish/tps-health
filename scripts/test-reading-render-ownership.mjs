import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { transform } from 'esbuild';

const sourcePath = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['renderNativeWorkoutSurfaceInReadingView', 'TPSHealthRenderedControlsChild'];
const declarations = names.map(name => {
  const declaration = ast.statements.find(node => node.name?.text === name);
  assert.ok(declaration, `Run the actual ${name} declaration`);
  return declaration.getText(ast);
});
const compiled = await transform(`${declarations.join('\n')}\nglobalThis.api = { ${names.join(', ')} };`, { loader: 'ts', target: 'es2020' });

function item(text = '', lineStart = 0) {
  return {
    textContent: text, lineStart, children: [], classes: new Set(), listeners: {}, nextElementSibling: null,
    empty() { this.children = []; },
    appendChild(child) { this.children.push(child); },
    addClass(name) { this.classes.add(name); },
    toggleClass(name, enabled) { if (enabled) this.classes.add(name); else this.classes.delete(name); },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    insertAdjacentElement(position, element) {
      assert.equal(position, 'afterend');
      this.nextElementSibling = { classList: { contains: name => name === 'tps-health-daily-workout-header' }, element };
    },
  };
}
function fixture({ items = [], headings = [], recipe = false, missingFile = false, content = '', read = null, workout = false, rootItem = null } = {}) {
  const counts = { cachedReads: 0, fileLookups: 0, recipeChecks: 0, recipeRenders: 0, sourceLookups: 0, headerRenders: 0, errors: 0, workoutOwners: 0, workoutChecks: 0, setRenders: 0, nativeMembership: 0, nativeSnapshots: 0, nativeRenders: 0 };
  class TFile { constructor(path) { this.path = path; } }
  const file = new TFile('Inbox/QA render.md');
  const root = Object.assign(rootItem || {}, { matches: selector => selector === 'li' && Boolean(rootItem), querySelectorAll: selector => selector === 'li' ? items : selector === 'h2' ? headings : [] });
  const menus = [], chips = [], sourceLookups = [], frames = [], timeouts = [];
  const ctx = { sourcePath: file.path, getSectionInfo: node => node.sectionInfo === null ? null : { lineStart: node.lineStart, ...node.sectionInfo } };
  const native = { enabled: true, indexed: false, snapshot: null, ownerPath: file.path };
  const target = { isConnected: true, querySelectorAll: () => [], appendChild(element) { element.parentElement = target; } };
  root.closest = () => target;
  const plugin = {
    app: { vault: {
      getAbstractFileByPath(path) { counts.fileLookups++; assert.equal(path, file.path); return missingFile ? null : file; },
      cachedRead(actual) { counts.cachedReads++; assert.equal(actual, file); return read ? read() : Promise.resolve(content); },
    } },
    openFoodLogEntryMenuFromLine(...args) { menus.push(args); },
    nativeRecordService: {
      isEnabled: () => native.enabled,
      isWorkoutSession(path) { counts.nativeMembership++; assert.equal(path, file.path); return native.indexed; },
      getWorkoutSnapshot(path) { counts.nativeSnapshots++; assert.equal(path, file.path); return native.snapshot; },
    },
    renderNativeWorkoutSurfaceElement(element, snapshot) { counts.nativeRenders++; assert.equal(snapshot, native.snapshot); assert.equal(element.dataset.workoutPath, file.path); },
  };
  const context = vm.createContext({
    window: { requestAnimationFrame: callback => frames.push(callback), setTimeout: callback => timeouts.push(callback) },
    TFile,
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    document: { createElement: () => ({ dataset: {} }) },
    markdownFilePathForRenderedElement: () => native.ownerPath,
    nativeWorkoutReadingMountTarget: () => target,
    workoutFilePathForRenderedRoot(actualPlugin, actualRoot, path) {
      counts.workoutOwners++; assert.equal(actualPlugin, plugin); assert.equal(actualRoot, root); return path;
    },
    isWorkoutLikeMarkdownPath(actualPlugin, path) { counts.workoutChecks++; assert.equal(actualPlugin, plugin); assert.equal(path, file.path); return workout; },
    isWorkoutSetLine: text => text.startsWith('SET:'),
    workoutSetChipDataFromLine: text => text.includes('Squat') ? { exercise: 'Squat' } : null,
    safeWorkoutSetEditorElement(actualPlugin, chip, source) { counts.setRenders++; assert.equal(actualPlugin, plugin); return { chip, source }; },
    logger: { flowError() { counts.errors++; } },
    isRecipeLikeMarkdownFile(actual, path) { counts.recipeChecks++; assert.equal(actual, plugin); assert.equal(path, file.path); return recipe; },
    renderRecipeIngredientChips(actualRoot, actualPlugin, actualCtx) { counts.recipeRenders++; assert.equal(actualRoot, root); assert.equal(actualPlugin, plugin); assert.equal(actualCtx, ctx); },
    foodLogVisibleText: text => text,
    findFoodLogSourceLineIndex(lines, visible, preferred, after) {
      counts.sourceLookups++; sourceLookups.push({ lines, visible, preferred, after });
      return lines.findIndex((line, index) => index >= after && line.startsWith(`FOOD:${visible}|`));
    },
    isFoodLogLine: line => typeof line === 'string' && (line.startsWith('FOOD:') || line.includes('tps-health:food')),
    foodLogChipDataFromLine: line => ({ food: line, macros: ['protein'] }),
    looksLikeFoodLogVisibleLine: text => text.startsWith('1 serving '),
    foodLogChipDataFromRenderedItem: node => ({ food: node.textContent, macros: [] }),
    foodLogChipElement(data, actions) { const chip = { data, actions }; chips.push(chip); return chip; },
    isWorkoutDailyMarkerLine: line => typeof line === 'string' && (line.startsWith('WORKOUT:') || /^\s*<!--\s*tps-health:workout(?=\s|-->)/i.test(line)),
    workoutDailyHeaderDataFromLines: (lines, index) => ({ marker: lines[index], index }),
    workoutDailyHeaderElement(actualPlugin, data, path) { counts.headerRenders++; assert.equal(actualPlugin, plugin); return { data, path }; },
  });
  vm.runInContext(compiled.code, context);
  const { TPSHealthRenderedControlsChild } = context.api;
  return { root, plugin, ctx, counts, menus, chips, sourceLookups, target, frames, timeouts,
    food: () => new TPSHealthRenderedControlsChild(root, plugin, ctx).onload(),
    child: () => new TPSHealthRenderedControlsChild(root, plugin, ctx),
  };
}
const settle = async () => { for (let n = 0; n < 5; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('700 ordinary paragraph postprocessor mounts perform no food/header source reads', async () => {
  const f = fixture({ content: 'Ordinary paragraph.\n'.repeat(700) });
  for (let index = 0; index < 700; index++) f.child().onload();
  await settle();
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.fileLookups, 0);
  assert.equal(f.counts.recipeChecks, 700, 'Recipe classification still owns the empty-recipe add control');
  assert.equal(f.counts.workoutOwners, 0, 'Paragraphs cannot contain workout set rows');
  assert.equal(f.counts.workoutChecks, 0);
  assert.equal(f.counts.nativeSnapshots, 0, 'Ordinary source paths cannot own a native workout surface');
  assert.equal(f.counts.errors, 0);
});

test('native workout membership uses the live index and retains eligible Reading mounts', async () => {
  const f = fixture();
  f.plugin.nativeRecordService.isEnabled = () => false;
  f.child().onload();
  await settle();
  assert.equal(f.counts.nativeMembership, 0);
  assert.equal(f.counts.nativeSnapshots, 0);
  f.plugin.nativeRecordService.isEnabled = () => true;
  f.child().onload();
  assert.equal(f.counts.nativeSnapshots, 0);
  f.plugin.nativeRecordService.isWorkoutSession = () => true;
  f.plugin.nativeRecordService.getWorkoutSnapshot = () => null;
  f.child().onload();
  assert.equal(f.counts.nativeRenders, 0, 'An archived, ambiguous or unavailable snapshot still renders nothing');
  const snapshot = { path: f.ctx.sourcePath };
  f.plugin.nativeRecordService.getWorkoutSnapshot = () => snapshot;
  let rendered = null;
  f.plugin.renderNativeWorkoutSurfaceElement = (element, actual) => { rendered = { element, actual }; };
  f.child().onload();
  await settle();
  assert.equal(rendered.actual, snapshot);
  assert.equal(rendered.element.dataset.workoutPath, f.ctx.sourcePath);
  assert.equal(rendered.element.dataset.renderContext, 'reading');
  assert.equal(f.counts.errors, 0);
});

test('empty recipes retain their ingredient control route without reading source', async () => {
  const f = fixture({ recipe: true });
  await f.food();
  assert.equal(f.counts.recipeRenders, 1);
  assert.equal(f.counts.cachedReads, 0);
});

test('populated recipes keep their existing ingredient rendering owner', async () => {
  const f = fixture({ recipe: true, items: [item('1 cup oats')] });
  await f.food();
  assert.equal(f.counts.recipeRenders, 1);
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.sourceLookups, 0);
});

// Run the navigation sweep and index projection themselves, not a replacement
// eligibility predicate. Minimal host/DOM doubles isolate their operation count.
function classMethods(tree, className, methodNames) {
  const declaration = tree.statements.find(node => node.name?.text === className);
  assert.ok(declaration, `Run the actual ${className} class`);
  return methodNames.map(name => {
    const method = declaration.members.find(node => node.name?.text === name);
    assert.ok(method, `Run the actual ${className}.${name} method`);
    return method.getText(tree);
  }).join('\n');
}
const nativeSource = readFileSync(new URL('../src/native-records.ts', import.meta.url), 'utf8');
const nativeAst = ts.createSourceFile('native-records.ts', nativeSource, ts.ScriptTarget.Latest, true);
const mountTarget = ast.statements.find(node => node.name?.text === 'nativeWorkoutReadingMountTarget');
assert.ok(mountTarget);
let readingObserverCallback;
const findReadingObserver = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'workoutReadingObserver') {
    readingObserverCallback = node.initializer.arguments[0];
  }
  ts.forEachChild(node, findReadingObserver);
};
findReadingObserver(ast);
assert.ok(readingObserverCallback, 'Run the actual Reading lifecycle observer callback');
const sweepCode = await transform(`
  class Sweep { ${classMethods(ast, 'TPSHealthPlugin', ['ensureNativeWorkoutReadingSurfaces', 'updateNativeWorkoutSurfaces', 'scheduleWorkoutActionBars'])} }
  class Records { ${classMethods(nativeAst, 'HealthNativeRecordService', ['isWorkoutSession', 'getWorkoutSnapshot', 'getKindRecords'])} }
  ${mountTarget.getText(ast)}
  function createReadingObserverCallback() { return ${readingObserverCallback.getText(ast)}; }
  globalThis.sweepApi = { Sweep, Records, createReadingObserverCallback };
`, { loader: 'ts', target: 'es2020' });

function navigationFixture({ history = 0 } = {}) {
  const counts = { snapshots: 0, enumerations: 0, visits: 0, membership: 0, renders: 0 };
  const lifecycle = { schedules: 0, timers: 0, cancels: 0, actionBars: 0 };
  const pending = new Map();
  let nextTimer = 0;
  class Element {
    constructor(className = '') { this.className = className; this.children = []; this.dataset = {}; this.parentElement = null; this.connected = true; }
    get isConnected() { return this.connected && (!this.parentElement || this.parentElement.isConnected); }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
      const [classSelector] = selector.split('[');
      return this.className.split(' ').includes(classSelector.slice(1))
        && (!selector.includes('[data-workout-path]') || this.dataset.workoutPath !== undefined);
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  }
  class TFile { constructor(path) { this.path = path; this.basename = path.split('/').at(-1).replace(/\.md$/, ''); } }
  class MarkdownView { constructor(file) { this.file = file; } getMode() { return 'preview'; } }
  const leaves = [];
  const context = vm.createContext({
    HTMLElement: Element, TFile, MarkdownView,
    document: {
      createElement: () => new Element(),
      querySelectorAll: selector => leaves.flatMap(leaf => leaf.preview?.isConnected ? leaf.preview.querySelectorAll(selector) : []),
    },
    window: {
      setTimeout(callback, delay) { assert.equal(delay, 80); const timer = ++nextTimer; lifecycle.timers++; pending.set(timer, callback); return timer; },
      clearTimeout(timer) { if (pending.delete(timer)) lifecycle.cancels++; },
    },
    logger: { flow() {} },
    numberValue: value => Number(value) || 0,
    workoutStartedAt: fm => fm.scheduled || '', workoutEndedAt: fm => fm.endedAt || '',
    refreshNativeWorkoutEditor: () => assert.fail('Reading leaves must not refresh editors'),
  });
  vm.runInContext(sweepCode.code, context);
  const plugin = new context.sweepApi.Sweep();
  const records = new context.sweepApi.Records();
  records.recordsByPath = new Map();
  records.pathsByKind = new Map([['workout-session', new Set()]]);
  records.plugin = { settings: {} };
  records.isEnabled = () => true;
  records.workoutExercisesForRead = record => record.frontmatter.exercises || [];
  for (const [name, counter] of [['getWorkoutSnapshot', 'snapshots'], ['getKindRecords', 'enumerations'], ['isWorkoutSession', 'membership']]) {
    const actual = records[name];
    records[name] = function(...args) { counts[counter]++; return actual.apply(this, args); };
  }
  plugin.app = { workspace: { iterateAllLeaves: callback => leaves.forEach(callback) } };
  plugin.nativeRecordService = records;
  plugin.getActiveWorkoutState = () => null;
  plugin.renderNativeWorkoutSurfaceElement = (surface, snapshot) => { counts.renders++; surface.rendered = snapshot; };
  plugin.updateWorkoutActionBars = () => { lifecycle.actionBars++; };
  const schedule = plugin.scheduleWorkoutActionBars;
  plugin.scheduleWorkoutActionBars = function() { lifecycle.schedules++; return schedule.call(this); };
  const observe = context.sweepApi.createReadingObserverCallback.call(plugin);
  function addWorkout(path, fields = {}) {
    const frontmatter = { status: 'active', scheduled: '2026-10-06T09:00:00', ...fields };
    const archived = frontmatter.archived;
    Object.defineProperty(frontmatter, 'archived', { configurable: true, get() { counts.visits++; return archived; } });
    const record = { kind: 'workout-session', id: `id:${path}`, file: new TFile(path), frontmatter };
    records.recordsByPath.set(path, record);
    records.pathsByKind.get('workout-session').add(path);
    return record;
  }
  function addLeaf(path, { missingTarget = false, connected = true, withFooter = true, withSection = false } = {}) {
    const preview = new Element('markdown-preview-view');
    preview.connected = connected;
    const target = preview.appendChild(new Element('markdown-preview-sizer'));
    const section = withSection ? target.appendChild(new Element('markdown-preview-section')) : null;
    const footer = withFooter ? target.appendChild(new Element('mod-footer')) : null;
    const leaf = { view: new MarkdownView(new TFile(path)), preview, target, footer, section,
      containerEl: { querySelector: selector => { assert.equal(selector, '.markdown-preview-view .markdown-preview-sizer'); return missingTarget ? null : target; } } };
    leaves.push(leaf);
    return leaf;
  }
  function addSurface(leaf, path) {
    const surface = new Element('tps-health-native-workout-surface');
    surface.dataset.workoutPath = path;
    surface.dataset.renderContext = 'reading';
    leaf.footer.appendChild(surface);
    return surface;
  }
  for (let index = 0; index < history; index++) addWorkout(`History/${index}.md`);
  return { plugin, records, counts, lifecycle, pending, Element, observe, addLeaf, addWorkout, addSurface,
    sweep: () => plugin.updateNativeWorkoutSurfaces(),
    flush() { for (const [timer, callback] of [...pending]) { if (!pending.delete(timer)) continue; callback(); } },
  };
}

test('ordinary preview leaves do not enumerate workout history during repeated navigation/layout sweeps', () => {
  const f = navigationFixture({ history: 10_000 });
  for (let leaf = 0; leaf < 20; leaf++) f.addLeaf(`Ordinary/${leaf}.md`);
  for (let sweep = 0; sweep < 20; sweep++) f.sweep();
  assert.equal(f.counts.visits, 0, 'Ordinary navigation must not inspect any workout record');
  assert.equal(f.counts.enumerations, 0);
  assert.equal(f.counts.snapshots, 0);
  assert.equal(f.counts.membership, 400, 'Use current indexed membership once per mounted preview leaf');
  assert.equal(f.counts.renders, 0);
});

test('unmounted and disconnected preview targets do no workout membership or projection work', () => {
  const f = navigationFixture({ history: 100 });
  f.addLeaf('History/0.md', { missingTarget: true });
  f.addLeaf('History/1.md', { connected: false });
  for (let sweep = 0; sweep < 20; sweep++) f.sweep();
  assert.equal(f.counts.snapshots, 0);
  assert.equal(f.counts.enumerations, 0);
  assert.equal(f.counts.membership, 0);
  assert.equal(f.counts.renders, 0);
});

test('Reading sweeps recognize live membership, render updated sets, and clean stale and duplicate surfaces', () => {
  const f = navigationFixture();
  const path = 'Inbox/Late workout.md', leaf = f.addLeaf(path);
  const stale = f.addSurface(leaf, 'Inbox/Previous workout.md');
  f.sweep();
  assert.equal(leaf.footer.children.length, 0, 'Nonmembers still remove the preceding note surface');
  assert.equal(stale.parentElement, null);
  assert.equal(f.counts.snapshots, 0);
  const record = f.addWorkout(path, { exercises: [{ id: 'exercise', name: 'Squat', sets: [{ id: 'first', reps: 5, weight: 100 }] }] });
  f.sweep();
  const surface = leaf.footer.children[0];
  assert.equal(surface.dataset.workoutPath, path);
  assert.equal(surface.dataset.renderContext, 'reading');
  assert.equal(surface.rendered.setCount, 1);
  assert.equal(surface.rendered.exercises[0].totalVolume, 500);
  f.addSurface(leaf, path);
  record.frontmatter.exercises[0].sets.push({ id: 'second', reps: 8, weight: 100 });
  f.sweep();
  assert.equal(leaf.footer.children.length, 1);
  assert.equal(leaf.footer.children[0], surface, 'Reuse the mounted surface after an index update');
  assert.equal(surface.rendered.setCount, 2);
  assert.equal(surface.rendered.exercises[0].totalVolume, 1300);
  assert.equal(f.counts.renders, 2);
  record.kind = 'food-entry';
  f.records.pathsByKind.get('workout-session').delete(path);
  f.sweep();
  assert.equal(leaf.footer.children.length, 0, 'Loss of workout membership removes the obsolete surface');
  f.addWorkout(path);
  f.sweep();
  assert.equal(leaf.footer.children.length, 1, 'Restoring membership is recognized without a cached negative');
});

test('indexed archived or ambiguous workouts still fail closed and remove stale Reading surfaces', () => {
  for (const archived of [true, false]) {
    const f = navigationFixture(), path = 'Inbox/Workout.md', leaf = f.addLeaf(path);
    f.addWorkout(path, { archived });
    if (!archived) f.addWorkout('Inbox/Conflicting alias.md', { workoutId: path });
    f.addSurface(leaf, path);
    f.sweep();
    assert.equal(leaf.footer.children.length, 0);
    assert.equal(f.counts.renders, 0);
    assert.equal(f.counts.snapshots, 1, 'Membership does not bypass the snapshot validity check');
  }
});

test('Reading lifecycle remounts the indexed workout after its managed fallback section is removed', () => {
  const f = navigationFixture({ history: 100 });
  const path = 'Inbox/Virtualized workout.md';
  const leaf = f.addLeaf(path, { withFooter: false, withSection: true });
  const record = f.addWorkout(path, { exercises: [{ id: 'exercise', name: 'Squat', sets: [{ id: 'first', reps: 5, weight: 100 }] }] });
  f.sweep();
  const oldSurface = leaf.section.children[0];
  assert.equal(oldSurface.rendered.setCount, 1);
  const sourceBefore = JSON.stringify(record.frontmatter);
  leaf.section.remove();
  assert.equal(leaf.target.querySelectorAll('.tps-health-native-workout-surface').length, 0);
  f.observe([{ addedNodes: [], removedNodes: [leaf.section] }]);
  assert.equal(f.lifecycle.schedules, 1, 'Removing the section containing the workout must wake the existing mount owner');
  assert.equal(f.pending.size, 1);
  f.flush();
  const surface = leaf.target.querySelector('.tps-health-native-workout-surface');
  assert.ok(surface, 'The next existing refresh restores the controls without an edit or navigation');
  assert.notEqual(surface, oldSurface);
  assert.equal(surface.rendered.path, path);
  assert.equal(surface.rendered.setCount, 1);
  assert.equal(surface.parentElement, leaf.target, 'A footer-free preview uses its surviving sizer');
  assert.equal(JSON.stringify(record.frontmatter), sourceBefore);
  assert.equal(f.counts.renders, 2);
});

test('Reading lifecycle recognizes surface removal inside an otherwise ordinary wrapper', () => {
  const f = navigationFixture();
  const path = 'Inbox/Wrapped workout.md';
  const leaf = f.addLeaf(path, { withFooter: false });
  f.addWorkout(path);
  f.sweep();
  const surface = leaf.target.querySelector('.tps-health-native-workout-surface');
  const wrapper = new f.Element('render-wrapper');
  leaf.target.appendChild(wrapper);
  wrapper.appendChild(surface);
  wrapper.remove();
  f.observe([{ addedNodes: [], removedNodes: [wrapper] }]);
  assert.equal(f.lifecycle.schedules, 1, 'Surface removal remains relevant through an otherwise ordinary wrapper');
  f.flush();
  const remounted = leaf.target.querySelector('.tps-health-native-workout-surface');
  assert.ok(remounted);
  assert.equal(remounted.rendered.path, path);
  assert.equal(f.lifecycle.actionBars, 1);
  assert.equal(f.counts.renders, 2);
});

test('Reading lifecycle mounts a frontmatter-only workout after a wrapped footer arrives', () => {
  const f = navigationFixture();
  const path = 'Inbox/Late footer workout.md';
  const leaf = f.addLeaf(path, { withFooter: false });
  f.addWorkout(path);
  assert.equal(leaf.target.querySelector('.tps-health-native-workout-surface'), null);
  const footerWrapper = new f.Element('render-wrapper');
  const footer = footerWrapper.appendChild(new f.Element('mod-footer'));
  leaf.target.appendChild(footerWrapper);
  f.observe([{ addedNodes: [footerWrapper], removedNodes: [] }]);
  assert.equal(f.lifecycle.schedules, 1, 'A footer arriving inside a wrapper must wake the existing owner');
  assert.equal(f.pending.size, 1);
  f.flush();
  const surface = leaf.target.querySelector('.tps-health-native-workout-surface');
  assert.ok(surface, 'Late preview structure mounts the existing indexed note without a body postprocessor');
  assert.equal(surface.rendered.path, path);
  assert.equal(f.lifecycle.actionBars, 1);
  assert.equal(f.counts.renders, 1);
  assert.equal(surface.parentElement, leaf.target, 'A nested footer is not a direct managed footer and cannot redirect the fallback mount');
  assert.equal(footer.children.length, 0);
});

test('Reading observer ignores ordinary mutation bursts and its own surface additions', () => {
  const f = navigationFixture({ history: 10_000 });
  f.addLeaf('Inbox/Ordinary note.md');
  const paragraph = new f.Element('el-p');
  const ordinarySection = new f.Element('markdown-preview-section');
  ordinarySection.appendChild(paragraph);
  const ownSurface = new f.Element('tps-health-native-workout-surface');
  for (let index = 0; index < 500; index++) {
    f.observe([{ addedNodes: [ordinarySection, ownSurface], removedNodes: [paragraph] }]);
  }
  assert.equal(f.lifecycle.schedules, 0);
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.counts, { snapshots: 0, enumerations: 0, visits: 0, membership: 0, renders: 0 }, 'Unrelated DOM activity never starts the workout sweep');
});

test('a Reading structural burst keeps one pending refresh and cannot remount a disposed native-record owner', () => {
  const f = navigationFixture();
  const path = 'Inbox/Closing workout.md';
  f.addLeaf(path);
  f.addWorkout(path);
  for (let index = 0; index < 20; index++) {
    f.observe([{ addedNodes: [new f.Element('mod-footer')], removedNodes: [] }]);
  }
  assert.equal(f.lifecycle.schedules, 20);
  assert.equal(f.pending.size, 1, 'The existing scheduler coalesces a burst');
  assert.equal(f.lifecycle.cancels, 19);
  f.records.isEnabled = () => false;
  f.plugin.app.workspace.iterateAllLeaves = () => assert.fail('A disposed owner cannot revisit current leaves');
  f.flush();
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.counts, { snapshots: 0, enumerations: 0, visits: 0, membership: 0, renders: 0 });
});


// Actual lifecycle owner: the disposer boundary is tested separately against
// the real renderer/timer host. These connected roots include a popout leaf
// unavailable to the main document's selector.
const unloadCode = await transform(`class Owner { ${classMethods(ast, 'TPSHealthPlugin', ['onunload'])} };globalThis.UnloadOwner=Owner;`,{loader:'ts',target:'es2020'});
test('Health unload disposes only owned surfaces in the document and popout leaves without vault work',()=>{
 const own='unloading-instance',foreign='another-instance',calls={disposals:[],events:[],records:0,bars:0,registration:0};
 const root=instanceKey=>({dataset:{instanceKey},removed:false});
 const mainRoot=root(own),popoutRoot=root(own),foreignRoot=root(foreign);
 const context=vm.createContext({document:{querySelectorAll:selector=>{assert.equal(selector,'.tps-health-native-workout-surface');return [mainRoot,foreignRoot];}},
  logger:{flow(){}},disposeNativeWorkoutSurface:surface=>{calls.disposals.push(surface);surface.removed=true;}});
 vm.runInContext(unloadCode.code,context);const plugin=new context.UnloadOwner();
 plugin.workoutSurfaceInstanceKey=own;plugin.api={};plugin.activeWorkoutStateListeners=new Set([()=>{}]);plugin.workoutActionBarRefreshTimer=null;
 plugin.app={tpsHealth:plugin.api,workspace:{trigger:event=>calls.events.push(event),iterateAllLeaves:callback=>{
  for(const roots of [[mainRoot,foreignRoot],[popoutRoot]])callback({view:{containerEl:{querySelectorAll:selector=>{assert.equal(selector,'.tps-health-native-workout-surface');return roots;}}}});
 }}};
 plugin.nativeRecordService={dispose:()=>calls.records++};plugin.removeWorkoutActionBars=()=>calls.bars++;plugin.clearGcmFoodLogButtonRegistration=()=>calls.registration++;
 plugin.onunload();assert.deepEqual(calls.disposals,[mainRoot,popoutRoot],'Shared document/leaf roots are disposed once; popout roots are included');
 assert.equal(mainRoot.removed,true);assert.equal(popoutRoot.removed,true);assert.equal(foreignRoot.removed,false);
 assert.deepEqual(calls.events,['tps-health:unloading']);assert.equal(calls.records,1);assert.equal(calls.bars,1);assert.equal(calls.registration,1);
 assert.equal(plugin.activeWorkoutStateListeners.size,0);assert.equal('tpsHealth' in plugin.app,false);
 // No vault, metadata or scan API exists in the host: accidental IO fails.
});


test('late workout refreshes after service disposal do no editor or Reading work',()=>{
 const f=navigationFixture({history:1000});f.addLeaf('Inbox/Late completion.md');f.addWorkout('Inbox/Late completion.md');
 f.records.isEnabled=()=>false;
 f.plugin.app.workspace.iterateAllLeaves=()=>assert.fail('A disposed owner cannot revisit current leaves');
 f.plugin.ensureNativeWorkoutReadingSurfaces=()=>assert.fail('A disposed owner cannot remount Reading content');
 for(let i=0;i<100;i++)f.sweep();
 assert.deepEqual(f.counts,{snapshots:0,enumerations:0,visits:0,membership:0,renders:0});
});

test('queued Reading mounts cannot reappear after the owning service is disposed',()=>{
 const f=fixture();f.plugin.nativeRecordService.isWorkoutSession=()=>true;
 f.plugin.nativeRecordService.getWorkoutSnapshot=()=>({id:'queued',path:f.ctx.sourcePath});
 f.target.isConnected=false;f.child().onload();assert.equal(f.frames.length,1);
 f.target.isConnected=true;f.plugin.nativeRecordService.isEnabled=()=>false;
 f.frames.shift()();assert.equal(f.timeouts.length,1);f.timeouts.shift()();
 assert.equal(f.counts.nativeRenders,0);assert.equal(f.counts.cachedReads,0);assert.equal(f.timeouts.length,0);
});


test('retired inline workout renderer and exclusive mutators are absent',()=>{
 for(const name of ["WorkoutSetChipWidget","WorkoutSetEmptyWidget","renderWorkoutSetChips","renderEmptyWorkoutSetAction","emptyWorkoutSetActionElement","workoutSetEditorElement","safeWorkoutSetEditorElement","addSeededWorkoutSetAfterBlock","deleteWorkoutSetLine","duplicateWorkoutSetBelow","duplicateWorkoutSetBelowNow","openWorkoutSupersetLinker","applyWorkoutSupersetLinks","openWorkoutDropSetLinker","applyWorkoutDropSetLinks"]) assert.doesNotMatch(source,new RegExp('\\b'+name+'\\b'),name);
 assert.match(source,/class NativeWorkoutSurfaceWidget/);
});

test('100 ordinary or historical list mounts perform zero Health source reads', async () => {
  for (const text of ['Shopping item', 'FOOD:historical entry', '1 serving old food']) {
    const f = fixture({ items: [item(text)], content: text });
    for (let i = 0; i < 100; i++) f.child().onload();
    await settle();
    assert.equal(f.counts.cachedReads, 0, text);
    assert.equal(f.counts.sourceLookups, 0, text);
    assert.equal(f.counts.nativeRenders, 0);
    assert.equal(f.chips.length, 0);
  }
});


test('historical food and Daily Note workout display owners are absent',()=>{
 for(const name of ["FoodLogChipWidget","foodLogChipElement","createFoodLogChipExtension","buildFoodLogChipDecorations","renderFoodLogChips","renderDailyWorkoutHeaders","WorkoutDailyHeaderWidget","createWorkoutDailyHeaderExtension","createWorkoutDailyMarkerProtectionExtension","buildWorkoutDailyHeaderDecorations","workoutDailyHeaderDataFromLines","workoutDailyHeaderElement"]) assert.doesNotMatch(source,new RegExp('\\b'+name+'\\b'),name);
});
