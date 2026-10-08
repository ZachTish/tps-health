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
const names = ['renderFoodLogChips', 'renderDailyWorkoutHeaders', 'renderWorkoutSetChips', 'renderNativeWorkoutSurfaceInReadingView', 'TPSHealthRenderedControlsChild'];
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
  const { renderFoodLogChips, renderDailyWorkoutHeaders, renderWorkoutSetChips, TPSHealthRenderedControlsChild } = context.api;
  return { root, plugin, ctx, counts, menus, chips, sourceLookups, target, frames, timeouts,
    food: () => renderFoodLogChips(root, plugin, ctx),
    headers: () => renderDailyWorkoutHeaders(root, plugin, ctx),
    sets: () => renderWorkoutSetChips(root, plugin, ctx),
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

test('workout lists retain ownership, set ordering and line targets', () => {
  const first = item('Squat 5 reps', 3), second = item('Squat 8 reps', 4);
  const f = fixture({ workout: true, items: [first, second] });
  f.sets();
  assert.equal(f.counts.workoutOwners, 1);
  assert.equal(f.counts.workoutChecks, 1);
  assert.equal(f.counts.setRenders, 2);
  assert.deepEqual([first, second].map(row => row.children[0].chip.setOrdinal), [1, 2]);
  assert.deepEqual([first, second].map(row => row.children[0].source.lineNumber), [3, 4]);
  assert.equal(first.children[0].source.filePath, f.ctx.sourcePath);
});

test('standalone li roots retain explicit workout rows in ordinary notes', () => {
  const row = item('SET:Squat 5 reps', 7);
  const f = fixture({ rootItem: row });
  f.sets();
  assert.equal(f.counts.setRenders, 1);
  assert.equal(row.children[0].source.lineNumber, 7);
  const ordinary = fixture({ items: [item('Squat shopping reminder')] });
  ordinary.sets();
  assert.equal(ordinary.counts.setRenders, 0);
});

test('already rendered workout headings do not reread the note', async () => {
  const heading = item('Workout', 0);
  heading.nextElementSibling = { classList: { contains: name => name === 'tps-health-daily-workout-header' } };
  const f = fixture({ headings: [heading], content: '## Workout\nWORKOUT:session' });
  for (let n = 0; n < 20; n++) await f.headers();
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.fileLookups, 0);
  assert.equal(f.counts.headerRenders, 0);
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

test('hidden source fields and custom food units remain authoritative with repeated visible rows', async () => {
  const visible = '2 portions oats';
  const f = fixture({ items: [item(visible, 0), item(visible, 0)], content: `FOOD:${visible}|id:first\nFOOD:${visible}|id:second` });
  await f.food();
  assert.equal(f.counts.cachedReads, 1);
  assert.deepEqual(f.chips.map(chip => chip.data.food), [`FOOD:${visible}|id:first`, `FOOD:${visible}|id:second`]);
  assert.deepEqual(f.sourceLookups.map(value => value.after), [0, 1]);
  f.chips[1].actions.onMenu('event');
  assert.deepEqual(f.menus[0], ['event', f.ctx.sourcePath, 1, `FOOD:${visible}|id:second`]);
});

test('raw food rows and source-less visible fallback retain their menus', async () => {
  const raw = fixture({ items: [item('FOOD:raw|id:1', 4)], content: '' });
  await raw.food();
  assert.equal(raw.chips.length, 1);
  raw.chips[0].actions.onMenu('raw event');
  assert.deepEqual(raw.menus[0], ['raw event', raw.ctx.sourcePath, 4, 'FOOD:raw|id:1']);
  const missing = fixture({ missingFile: true, items: [item('1 serving oats', 2)] });
  await missing.food();
  assert.equal(missing.counts.cachedReads, 0);
  assert.equal(missing.chips.length, 1);
});

test('ordinary list sections with complete source do not read the note', async () => {
  const row = item('Shopping reminder');
  row.sectionInfo = { text: '- Shopping reminder' };
  const f = fixture({ items: [row], content: '- Shopping reminder' });
  await f.food();
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.fileLookups, 0);
  assert.equal(f.chips.length, 0);
  assert.equal(row.classes.size, 0);
});

test('ordinary heading sections with complete source do not read the note', async () => {
  const heading = item('Shopping', 0);
  heading.sectionInfo = { text: '## Shopping\nA plain section about groceries.' };
  const f = fixture({ headings: [heading], content: '## Shopping\nA plain section about groceries.' });
  await f.headers();
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.fileLookups, 0);
  assert.equal(f.counts.headerRenders, 0);
});

test('full-document section text uses the heading lineStart before deciding to read', async () => {
  const content = '- Shopping reminder\n\n## Plans\nOrdinary prose.\n## Workout\n<!-- tps-health:workout [workoutId:: qa] -->';
  const plans = item('Plans', 2);
  plans.sectionInfo = { text: content };
  const ordinary = fixture({ headings: [plans], content });
  await ordinary.headers();
  assert.equal(ordinary.counts.cachedReads, 0);
  assert.equal(ordinary.counts.headerRenders, 0);

  const workoutHeading = item('Workout', 4);
  workoutHeading.sectionInfo = { text: content };
  const workout = fixture({ headings: [workoutHeading], content });
  await workout.headers();
  assert.equal(workout.counts.cachedReads, 1);
  assert.equal(workout.counts.headerRenders, 1);
  assert.equal(workoutHeading.nextElementSibling.element.data.index, 5);
});

test('ambiguous section-local and global H2 candidates keep the source read', async () => {
  const heading = item('Workout', 2);
  heading.sectionInfo = { text: '## Workout\n<!-- tps-health:workout [workoutId:: qa] -->\n## Other\nordinary' };
  const content = 'front\nother\n## Workout\n<!-- tps-health:workout [workoutId:: qa] -->';
  const f = fixture({ headings: [heading], content });
  await f.headers();
  assert.equal(f.counts.cachedReads, 1);
  assert.equal(f.counts.headerRenders, 1);
  assert.equal(heading.nextElementSibling.element.data.index, 3);
});

test('many ordinary list and heading sections start zero Health source reads', async () => {
  const row = item('Shopping reminder', 1);
  row.sectionInfo = { text: '- Shopping reminder' };
  const heading = item('Shopping', 0);
  heading.sectionInfo = { text: '## Shopping\nA plain section about groceries.' };
  const f = fixture({ items: [row], headings: [heading], content: '## Shopping\n- Shopping reminder' });
  for (let index = 0; index < 62; index++) f.child().onload();
  await settle();
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.fileLookups, 0);
  assert.equal(f.counts.recipeChecks, 62, 'recipe identity keeps its existing owner');
  assert.equal(f.counts.headerRenders, 0);
  assert.equal(f.counts.errors, 0);
});

test('unprocessed workout heading mapping retains blank lines and skips unrelated h2', async () => {
  const unrelated = item('Other', 0), workout = item('Workout', 2);
  unrelated.sectionInfo = { text: '## Other\nordinary' };
  workout.sectionInfo = { text: '## Workout\n\nWORKOUT:session' };
  const f = fixture({ headings: [unrelated, workout], content: '## Other\nordinary\n## Workout\n\nWORKOUT:session' });
  await f.headers();
  assert.equal(f.counts.cachedReads, 1);
  assert.equal(unrelated.nextElementSibling, null);
  assert.equal(workout.nextElementSibling.element.data.index, 4);
  assert.equal(workout.nextElementSibling.element.path, f.ctx.sourcePath);
});

test('source-backed hidden food rows still read and resolve repeated custom-unit records', async () => {
  const visible = '2 bowls oats';
  const first = item(visible, 0), second = item(visible, 0);
  first.sectionInfo = { text: `FOOD:${visible}|id:first` };
  second.sectionInfo = { text: `FOOD:${visible}|id:second` };
  const f = fixture({ items: [first, second], content: `FOOD:${visible}|id:first\nFOOD:${visible}|id:second` });
  await f.food();
  assert.equal(f.counts.cachedReads, 1);
  assert.deepEqual(f.chips.map(chip => chip.data.food), [`FOOD:${visible}|id:first`, `FOOD:${visible}|id:second`]);
  assert.deepEqual(f.sourceLookups.map(value => value.after), [0, 1]);
  f.chips[1].actions.onMenu('event');
  assert.deepEqual(f.menus[0], ['event', f.ctx.sourcePath, 1, `FOOD:${visible}|id:second`]);
});

test('complete Obsidian section source keeps hidden food and workout comments eligible', async () => {
  const foodSource = '- QA Apple <!-- tps-health:food [food:: QA Apple] [qty:: 1] -->';
  const row = item('QA Apple', 0);
  row.sectionInfo = { text: foodSource };
  const food = fixture({ items: [row], content: foodSource });
  await food.food();
  assert.equal(food.counts.cachedReads, 1);
  assert.equal(food.chips[0].data.food, foodSource);
  food.chips[0].actions.onMenu('event');
  assert.deepEqual(food.menus[0], ['event', food.ctx.sourcePath, 0, foodSource]);

  const workoutSource = '## Workout\n\n<!-- tps-health:workout [workoutId:: qa] -->';
  const heading = item('Workout', 0);
  heading.sectionInfo = { text: workoutSource };
  const workout = fixture({ headings: [heading], content: workoutSource });
  await workout.headers();
  assert.equal(workout.counts.cachedReads, 1);
  assert.equal(workout.counts.headerRenders, 1);
  assert.equal(heading.nextElementSibling.element.data.index, 2);
});

test('null and incomplete section information retains the existing source read', async () => {
  for (const sectionInfo of [null, { text: '' }, { text: '- Shopping' }]) {
    const row = item('Shopping reminder', 0);
    row.sectionInfo = sectionInfo;
    const f = fixture({ items: [row], content: '- Shopping reminder' });
    await f.food();
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.chips.length, 0);
  }
  for (const sectionInfo of [null, { text: '' }, { text: '## Workout\n\n' }]) {
    const heading = item('Workout', 0);
    heading.sectionInfo = sectionInfo;
    const f = fixture({ headings: [heading], content: '## Workout\nWORKOUT:session' });
    await f.headers();
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.counts.headerRenders, sectionInfo === null ? 0 : 1);
  }
});

test('missing workout files do not read or render', async () => {
  const f = fixture({ missingFile: true, headings: [item('Workout')] });
  await f.headers();
  assert.equal(f.counts.cachedReads, 0);
  assert.equal(f.counts.headerRenders, 0);
});

test('concurrent header renders recheck the existing header after the source await', async () => {
  const d = deferred(), heading = item('Workout', 0);
  const f = fixture({ headings: [heading], read: () => d.promise });
  const first = f.headers(), second = f.headers();
  d.resolve('## Workout\nWORKOUT:session');
  await Promise.all([first, second]);
  assert.equal(f.counts.headerRenders, 1);
});

test('postprocessor reports an eligible historical food read failure', async () => {
  const f = fixture({ items: [item('Food')], headings: [item('Workout')], read: () => Promise.reject(new Error('synthetic read failure')) });
  f.child().onload();
  await settle();
  assert.equal(f.counts.errors, 1);
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
const sweepCode = await transform(`
  class Sweep { ${classMethods(ast, 'TPSHealthPlugin', ['ensureNativeWorkoutReadingSurfaces', 'updateNativeWorkoutSurfaces'])} }
  class Records { ${classMethods(nativeAst, 'HealthNativeRecordService', ['isWorkoutSession', 'getWorkoutSnapshot', 'getKindRecords'])} }
  ${mountTarget.getText(ast)}
  globalThis.sweepApi = { Sweep, Records };
`, { loader: 'ts', target: 'es2020' });

function navigationFixture({ history = 0 } = {}) {
  const counts = { snapshots: 0, enumerations: 0, visits: 0, membership: 0, renders: 0 };
  class Element {
    constructor(className = '') { this.className = className; this.children = []; this.dataset = {}; this.parentElement = null; this.connected = true; }
    get isConnected() { return this.connected && (!this.parentElement || this.parentElement.isConnected); }
    matches(selector) {
      const [classSelector] = selector.split('[');
      return this.className.split(' ').includes(classSelector.slice(1))
        && (!selector.includes('[data-workout-path]') || this.dataset.workoutPath !== undefined);
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
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
  function addWorkout(path, fields = {}) {
    const frontmatter = { status: 'active', scheduled: '2026-10-06T09:00:00', ...fields };
    const archived = frontmatter.archived;
    Object.defineProperty(frontmatter, 'archived', { configurable: true, get() { counts.visits++; return archived; } });
    const record = { kind: 'workout-session', id: `id:${path}`, file: new TFile(path), frontmatter };
    records.recordsByPath.set(path, record);
    records.pathsByKind.get('workout-session').add(path);
    return record;
  }
  function addLeaf(path, { missingTarget = false, connected = true } = {}) {
    const preview = new Element('markdown-preview-view');
    preview.connected = connected;
    const target = preview.appendChild(new Element('markdown-preview-sizer'));
    const footer = target.appendChild(new Element('mod-footer'));
    const leaf = { view: new MarkdownView(new TFile(path)), preview, target, footer,
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
  return { plugin, records, counts, addLeaf, addWorkout, addSurface, sweep: () => plugin.updateNativeWorkoutSurfaces() };
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
