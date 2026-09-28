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
const names = ['renderFoodLogChips', 'renderDailyWorkoutHeaders', 'TPSHealthRenderedControlsChild'];
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
    addEventListener(name, fn) { this.listeners[name] = fn; },
    insertAdjacentElement(position, element) {
      assert.equal(position, 'afterend');
      this.nextElementSibling = { classList: { contains: name => name === 'tps-health-daily-workout-header' }, element };
    },
  };
}
function fixture({ items = [], headings = [], recipe = false, missingFile = false, content = '', read = null } = {}) {
  const counts = { cachedReads: 0, fileLookups: 0, recipeChecks: 0, recipeRenders: 0, sourceLookups: 0, headerRenders: 0, errors: 0 };
  class TFile { constructor(path) { this.path = path; } }
  const file = new TFile('Inbox/QA render.md');
  const root = { querySelectorAll: selector => selector === 'li' ? items : selector === 'h2' ? headings : [] };
  const menus = [], chips = [], sourceLookups = [];
  const ctx = { sourcePath: file.path, getSectionInfo: node => ({ lineStart: node.lineStart }) };
  const plugin = {
    app: { vault: {
      getAbstractFileByPath(path) { counts.fileLookups++; assert.equal(path, file.path); return missingFile ? null : file; },
      cachedRead(actual) { counts.cachedReads++; assert.equal(actual, file); return read ? read() : Promise.resolve(content); },
    } },
    openFoodLogEntryMenuFromLine(...args) { menus.push(args); },
  };
  const context = vm.createContext({
    TFile,
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    renderWorkoutSetChips() {}, renderNativeWorkoutSurfaceInReadingView() {},
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
  const { renderFoodLogChips, renderDailyWorkoutHeaders, TPSHealthRenderedControlsChild } = context.api;
  return { root, plugin, ctx, counts, menus, chips, sourceLookups,
    food: () => renderFoodLogChips(root, plugin, ctx),
    headers: () => renderDailyWorkoutHeaders(root, plugin, ctx),
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
  assert.equal(f.counts.errors, 0);
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
