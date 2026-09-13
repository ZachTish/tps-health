import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({stdin:{contents:'export * from "./src/food-log-tags"; export { foodEntryLine } from "./src/format"; export { normalizeTPSHealthSettings } from "./src/settings-normalization";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const { normalizeFoodLogTags, foodEntryLine, normalizeTPSHealthSettings } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('nested tags accept hashes or plain names and deduplicate safely',()=>{
 assert.deepEqual(normalizeFoodLogTags('#food/healthy, food/healthy #meal/breakfast #123 bad]value'),['food/healthy','meal/breakfast']);
});
test('tray tags survive settings serialization and do not change the food definition',()=>{
 const food={id:'apple',name:'Apple',source:'manual'};
 const draft={id:'draft',updatedAt:new Date().toISOString(),selectionItems:[{item:food,quantity:1,unit:'serving',tags:['#food/healthy']}]};
 const settings=normalizeTPSHealthSettings(JSON.parse(JSON.stringify({pendingFoodLogDraft:draft})));
 assert.deepEqual(settings.pendingFoodLogDraft.selectionItems[0].tags,['food/healthy']);
 assert.equal(settings.pendingFoodLogDraft.selectionItems[0].item.tags,undefined);
});
test('legacy food log lines carry visible entry tags and metadata for subsequent edits',()=>{
 const line=foodEntryLine({id:'entry',createdDate:'2026-09-13',item:{id:'apple',name:'Apple',source:'manual',nutrition:{calories:100}},quantity:1,unit:'serving',tags:['food/healthy']});
 assert.match(line,/Apple #food\/healthy <!--/);
 assert.match(line,/\[tags:: food\/healthy\]/);
});
