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
  const menus = [], chips = [], sourceLookups = [];
  const ctx = { sourcePath: file.path, getSectionInfo: node => ({ lineStart: node.lineStart }) };
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
    isFoodLogLine: line => typeof line === 'string' && line.startsWith('FOOD:'),
    foodLogChipDataFromLine: line => ({ food: line, macros: ['protein'] }),
    looksLikeFoodLogVisibleLine: text => text.startsWith('1 serving '),
    foodLogChipDataFromRenderedItem: node => ({ food: node.textContent, macros: [] }),
    foodLogChipElement(data, actions) { const chip = { data, actions }; chips.push(chip); return chip; },
    isWorkoutDailyMarkerLine: line => typeof line === 'string' && line.startsWith('WORKOUT:'),
    workoutDailyHeaderDataFromLines: (lines, index) => ({ marker: lines[index], index }),
    workoutDailyHeaderElement(actualPlugin, data, path) { counts.headerRenders++; assert.equal(actualPlugin, plugin); return { data, path }; },
  });
  vm.runInContext(compiled.code, context);
  const { renderFoodLogChips, renderDailyWorkoutHeaders, renderWorkoutSetChips, TPSHealthRenderedControlsChild } = context.api;
  return { root, plugin, ctx, counts, menus, chips, sourceLookups,
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

test('ordinary list items are still inspected against source but not rewritten', async () => {
  const row = item('Shopping reminder');
  const f = fixture({ items: [row], content: '- Shopping reminder' });
  await f.food();
  assert.equal(f.counts.cachedReads, 1);
  assert.equal(f.chips.length, 0);
  assert.equal(row.classes.size, 0);
});

test('unprocessed heading source mapping retains blank lines and skips unrelated h2', async () => {
  const unrelated = item('Other', 0), workout = item('Workout', 2);
  const f = fixture({ headings: [unrelated, workout], content: '## Other\nordinary\n## Workout\n\nWORKOUT:session' });
  await f.headers();
  assert.equal(f.counts.cachedReads, 1);
  assert.equal(unrelated.nextElementSibling, null);
  assert.equal(workout.nextElementSibling.element.data.index, 4);
  assert.equal(workout.nextElementSibling.element.path, f.ctx.sourcePath);
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

test('postprocessor retains its existing async error reporting for eligible content', async () => {
  const f = fixture({ items: [item('Food')], headings: [item('Workout')], read: () => Promise.reject(new Error('synthetic read failure')) });
  f.child().onload();
  await settle();
  assert.equal(f.counts.errors, 2);
});
