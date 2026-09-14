import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/barcode-orientation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {BarcodeOrientationLock,barcodeOrientationDrivers}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('portrait lock is acquired once and released after scanning',async()=>{
 const events=[];const driver={lock:async()=>events.push('lock'),unlock:async()=>events.push('unlock')};
 const lock=new BarcodeOrientationLock(()=>[driver],e=>events.push(e));
 await lock.setActive(true);await lock.setActive(true);await lock.setActive(false);await lock.setActive(false);
 assert.deepEqual(events,['lock','locked','unlock','released']);
});
test('closing during a pending lock releases the late acquisition',async()=>{
 const pending=deferred();let unlocks=0;
 const lock=new BarcodeOrientationLock(()=>[{lock:()=>pending.promise,unlock:async()=>{unlocks++;}}],()=>{});
 const start=lock.setActive(true);await Promise.resolve();const stop=lock.setActive(false);pending.resolve();await Promise.all([start,stop]);assert.equal(unlocks,1);
});
test('failed or unsupported locks never unlock another owner and report unavailable',async()=>{
 const events=[];const lock=new BarcodeOrientationLock(()=>[{lock:async()=>{throw Error('unsupported');},unlock:async()=>events.push('unlock')}],e=>events.push(e));
 await lock.setActive(true);await lock.setActive(false);assert.deepEqual(events,['unavailable']);
});
test('native driver failure falls back to web and only releases the acquired driver',async()=>{
 const events=[];const win={Capacitor:{Plugins:{ScreenOrientation:{lock:async o=>{assert.equal(o.orientation,'portrait');throw Error('not installed');},unlock:async()=>events.push('native unlock')}}},screen:{orientation:{lock:async o=>{assert.equal(o,'portrait');events.push('web lock');},unlock:()=>events.push('web unlock')}}};
 const lock=new BarcodeOrientationLock(()=>barcodeOrientationDrivers(win),()=>{});await lock.setActive(true);await lock.setActive(false);assert.deepEqual(events,['web lock','web unlock']);
 assert.deepEqual(barcodeOrientationDrivers({}),[]);
});
test('a release failure is retained for another cleanup attempt',async()=>{
 let attempts=0;const events=[];const lock=new BarcodeOrientationLock(()=>[{lock:async()=>{},unlock:async()=>{if(++attempts===1)throw Error('busy');}}],e=>events.push(e));
 await lock.setActive(true);await lock.setActive(false);await lock.setActive(false);assert.deepEqual(events,['locked','release-failed','released']);
});
