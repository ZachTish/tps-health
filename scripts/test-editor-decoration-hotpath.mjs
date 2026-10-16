import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { transform } from 'esbuild';
import { EditorState, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const names = [
  'createRecipeIngredientEditorExtension', 'buildRecipeIngredientEditorDecorations',
  'recipeEditorSourcePath', 'markdownContentLooksLikeRecipe',
  'changedEditorLinesMatch', 'editorChangeTouchesLineBreak', 'selectionTouchesMatchingEditorLine',
];
const declarations = names.map(name => ast.statements.find(node => node.name?.text === name))
  .filter(Boolean).map(node => node.getText(ast));
const compiled = await transform(`${declarations.join('\n')}\nglobalThis.api = { createRecipeIngredientEditorExtension };`, { loader: 'ts' });

function fixture({ path = 'Inbox/Ordinary.md', doc = 'Plain note', recipePath = false, initialSelection = 0 } = {}) {
  class TFile { constructor(filePath) { this.path = filePath; } }
  const file = new TFile(path);
  const counts = { foodLineChecks: 0, recipeContentChecks: 0, foodWidgets: 0, recipeWidgets: 0 };
  const live = StateField.define({ create: () => true, update: value => value });
  const plugin = {
    settings: { recipeTag: '#tps/recipe' },
    app: { workspace: { getActiveFile: () => file } },
    findRecipeIngredientFoodByName: () => null,
  };
  const context = vm.createContext({
    EditorState, StateField, RangeSetBuilder, Decoration, EditorView,
    editorLivePreviewField: live, TFile,
    isRecipeLikeMarkdownFile: (_plugin, candidate) => recipePath && candidate === path,
    frontmatterEndIndex: content => {
      counts.recipeContentChecks++;
      const end = content.indexOf('\n---', 4);
      return content.startsWith('---\n') && end >= 0 ? end + 4 : 0;
    },
    isFoodLogLine: line => { counts.foodLineChecks++; return line.includes('tps-health:food'); },
    foodLogChipDataFromLine: line => line.includes('tps-health:food') ? { food: 'Apple' } : null,
    selectionTouchesLineInState: (state, from, to) => state.selection.ranges.some(range => range.from <= to && range.to >= from),
    parseRecipeIngredientLine: line => line.startsWith('Ingredient:') ? { foodName: 'Apple' } : null,
    FoodLogChipWidget: class { constructor(_plugin, _chip, source) { counts.foodWidgets++; this.source = source; } },
    RecipeIngredientWidget: class { constructor() { counts.recipeWidgets++; } },
    RecipeIngredientAddWidget: class { constructor() { counts.recipeWidgets++; } },
  });
  vm.runInContext(compiled.code, context);
  const recipe = context.api.createRecipeIngredientEditorExtension(plugin);
  let state = EditorState.create({ doc, selection: { anchor: initialSelection }, extensions: [live, recipe] });
  const dispatch = spec => { state = state.update(spec).state; };
  return { counts, file, plugin, recipe, get state() { return state; }, dispatch,
    recipeDecorations: () => state.field(recipe).size,
  };
}

test('ordinary typing and cursor movement inspect changed lines without rescanning a long note', () => {
  const f = fixture({ doc: Array.from({ length: 4000 }, (_, index) => `Line ${index}`).join('\n') });
  f.counts.foodLineChecks = 0;
  f.counts.recipeContentChecks = 0;
  for (let index = 0; index < 40; index++) {
    f.dispatch({ changes: { from: f.state.doc.length, insert: 'x' } });
    f.dispatch({ selection: { anchor: index + 1 } });
  }
  assert.equal(f.counts.foodLineChecks, 0);
  assert.equal(f.counts.recipeContentChecks, 0);
  assert.doesNotMatch(source, /createFoodLogChipExtension|FoodLogChipWidget/);
  assert.equal(f.recipeDecorations(), 0);
});

test('a newly typed recipe tag activates and deleting it removes recipe controls', () => {
  const f = fixture({ doc: 'Plain note\nIngredient: Apple' });
  assert.equal(f.recipeDecorations(), 0);
  f.dispatch({ changes: { from: f.state.doc.length, insert: '\n#tps/recipe' } });
  assert.ok(f.recipeDecorations() > 0);
  assert.ok(f.counts.recipeWidgets > 0);
  f.dispatch({ changes: { from: f.state.doc.length - '#tps/recipe'.length, to: f.state.doc.length } });
  assert.equal(f.recipeDecorations(), 0);
});

test('a recipe path retains ingredient selection behavior without serializing its note', () => {
  const doc = 'Ingredient: Apple\nOrdinary paragraph';
  const f = fixture({ path: 'Health/Recipes/Lunch.md', doc, recipePath: true, initialSelection: doc.length });
  assert.equal(f.recipeDecorations(), 2);
  f.counts.recipeContentChecks = 0;
  f.dispatch({ selection: { anchor: 5 } });
  assert.equal(f.recipeDecorations(), 1, 'the selected ingredient stays editable');
  f.dispatch({ selection: { anchor: f.state.doc.length } });
  assert.equal(f.recipeDecorations(), 2, 'the chip returns after selection leaves');
  f.dispatch({ changes: { from: f.state.doc.length, insert: '!' } });
  assert.equal(f.recipeDecorations(), 2);
  assert.equal(f.counts.recipeContentChecks, 0, 'a path-classified recipe needs no content-wide recipe search');
});
