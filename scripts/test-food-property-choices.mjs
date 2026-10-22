import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({stdin:{contents:'export * from "./src/food-property-choices"; export * from "./src/food-serving";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm'});
const {foodServingChoices:p,foodEntryPortion}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
const values=f=>p.getChoices(f).map(c=>c.value);
test('known can, cup, gram and bottle labels offer compatible choices only',()=>{
 assert.deepEqual(values({servingAmount:1,servingUnit:'can',servingMl:355}),['can','serving','ml','fl oz','cup']);
 assert.deepEqual(values({servingAmount:2,servingUnit:'pieces',servingGrams:30}),['pieces','serving','g','oz']);
 assert.deepEqual(values({servingAmount:0.5,servingUnit:'cup'}),['cup','serving','ml','fl oz']);
 assert.deepEqual(values({servingAmount:1,servingUnit:'bottle'}),['bottle','serving']);
});
test('authored g/ml and quoted labels override stale auxiliary metrics',()=>{
 assert.deepEqual(values({servingAmount:'100',servingUnit:'ml',servingGrams:200}),['ml','serving','fl oz','cup']);
 assert.deepEqual(values({servingAmount:'50',servingUnit:'g',servingMl:200}),['g','serving','oz']);
});
test('every advertised unit/alias is accepted by the shared native calculation',()=>{
 for(const food of [{servingAmount:12,servingUnit:'fl oz'}, {servingAmount:.5,servingUnit:'cup',servingGrams:40}, {servingAmount:2,servingUnit:'pieces'}, {servingAmount:100,servingUnit:'g'}])
 for(const c of p.getChoices(food))for(const unit of [c.value,...c.aliases])for(const quantity of [0,.5,2])assert.ok(foodEntryPortion({quantity,unit},food),unit);
});
test('labels explain the amount rather than changing stored unit semantics',()=>{
 const choices=p.getChoices({servingAmount:2,servingUnit:'pieces',servingGrams:30});
 assert.match(choices.find(c=>c.value==='serving').label,/2 pieces \(30 g\)/);
 assert.equal(foodEntryPortion({quantity:1,unit:'pieces'},{servingAmount:2,servingUnit:'pieces',servingGrams:30}).servings,.5);
});
test('no invented density, missing definitions or malformed denominator choices',()=>{
 assert.deepEqual(values({}),[]);for(const servingAmount of [0,-1,'bad','',true])assert.deepEqual(values({servingAmount,servingUnit:'cup'}),[]);
 assert.equal(values({servingAmount:1,servingUnit:'can',servingMl:355}).includes('g'),false);
});
