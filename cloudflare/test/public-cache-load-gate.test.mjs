import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicCacheLoadGate} from '../src/public-cache-load-gate.ts';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));

test('48 different cold resources queue in order without exceeding two database loaders',async()=>{
  const gate=new PublicCacheLoadGate(),started=[],completed=[];
  let active=0,peak=0;
  const results=await Promise.all(Array.from({length:48},(_,id)=>gate.run(async()=>{
    started.push(id);peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;completed.push(id);return id;
  })));
  assert.equal(peak,2);assert.equal(active,0);
  assert.deepEqual(started,results);assert.equal(completed.length,48);
});

test('a full queue and an expired wait never execute their SQL callback',async()=>{
  const gate=new PublicCacheLoadGate({concurrent:1,queued:1,waitMs:30}),hold=deferred();
  const first=gate.run(()=>hold.promise);let submitted=0;
  const expired=assert.rejects(gate.run(async()=>{submitted++;}),{reason:'public_cache_load_queue_timeout',sqlSubmitted:false});
  await assert.rejects(gate.run(async()=>{submitted++;}),{reason:'public_cache_load_queue_full',sqlSubmitted:false});
  await expired;assert.equal(submitted,0);
  hold.resolve('first');assert.equal(await first,'first');
  assert.equal(await gate.run(async()=>{submitted++;return 'recovered';}),'recovered');assert.equal(submitted,1);
});

test('a failed load releases its slot to the next queued request',async()=>{
  const gate=new PublicCacheLoadGate({concurrent:1,queued:2,waitMs:5000}),hold=deferred(),started=[];
  const first=assert.rejects(gate.run(async()=>{await hold.promise;throw Error('provider failed');}),/provider failed/);
  const second=gate.run(async()=>{started.push(2);return 2;});
  const third=gate.run(async()=>{started.push(3);return 3;});
  await turn();assert.deepEqual(started,[]);hold.resolve();
  await first;assert.deepEqual(await Promise.all([second,third]),[2,3]);assert.deepEqual(started,[2,3]);
});
