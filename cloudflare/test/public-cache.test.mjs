import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicCacheState } from '../src/public-cache-state.ts';
import { validatePublicSeed } from '../src/public-cache-keys.ts';
import {publicFreshMs,PUBLIC_STALE_MS} from '../src/public-cache-policy.ts';

function storage(initial=new Map()) {
  return {data:initial,async get(key){return structuredClone(initial.get(key));},async put(key,value){initial.set(key,structuredClone(value));},async delete(key){return initial.delete(key);}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('987 simultaneous cold page requests share one durable country/language refresh',async()=>{
  const store=storage(),cache=new PublicCacheState(store),gate=deferred();let reads=0;
  const load=async()=>{reads++;await gate.promise;return {results:[{wordId:7,word:'test'}]};};
  const pending=Array.from({length:987},()=>cache.get(1,60_000,86400_000,load));
  await new Promise(r=>setImmediate(r));assert.equal(reads,1);
  gate.resolve();const results=await Promise.all(pending);
  assert.equal(reads,1);assert.equal(results.filter(result=>result.state==='miss').length,1);
  assert.ok(results.every(result=>result.value.results[0].wordId===7));
  // A recreated object (another lifetime, same storage) uses the saved value.
  assert.equal((await new PublicCacheState(store).get(1,60_000,86400_000,()=>{throw Error('D1 must not run');})).state,'hit');
});

test('quota failure serves an eligible public snapshot and suppresses refresh retries for one minute',async()=>{
  let now=1000,reads=0;const cache=new PublicCacheState(storage(),()=>now);
  await cache.get(1,100,10000,async()=>({word:'published'}));now=1200;
  const unavailable=async()=>{reads++;throw Error('budget closed');};
  assert.equal((await cache.get(1,100,10000,unavailable)).state,'stale');
  assert.equal((await cache.get(1,100,10000,unavailable)).value.word,'published');assert.equal(reads,1);
  now=12000;await assert.rejects(cache.get(1,100,10000,unavailable),/budget closed/);
});

test('moderation invalidation cannot fall back to an older public generation',async()=>{
  const cache=new PublicCacheState(storage());await cache.get(1,1000,86400_000,async()=>[{definition:'removed'}]);
  await assert.rejects(cache.get(2,1000,86400_000,async()=>{throw Error('quota');}),/quota/);
});

test('unchanged word pages avoid repeated D1 refreshes while edits still invalidate immediately',async()=>{
  let now=0,loads=0;const store=storage(),load=async()=>{loads++;return [{definition:'Original'}];};
  const fresh=publicFreshMs('word:2');
  await new PublicCacheState(store,()=>now).get(1,fresh,PUBLIC_STALE_MS,load);
  now=60*60_000;
  // A fresh object must use durable state, not only an in-memory cache.
  const restarted=new PublicCacheState(store,()=>now);
  assert.equal((await restarted.get(1,fresh,PUBLIC_STALE_MS,load)).state,'hit');
  assert.equal(loads,1);
  const edited=await restarted.get(2,fresh,PUBLIC_STALE_MS,async()=>[{definition:'Corrected'}]);
  assert.equal(edited.value[0].definition,'Corrected');
  await assert.rejects(restarted.get(3,fresh,PUBLIC_STALE_MS,async()=>{throw Error('quota');}),/quota/);
  assert.equal(publicFreshMs('feed:0'),15*60_000);
});

test('an older in-flight load cannot replace a newer generation',async()=>{
  const store=storage(),cache=new PublicCacheState(store),gate=deferred();
  const before=cache.get(1,1000,86400_000,async()=>{await gate.promise;return {word:'old'};});
  await new Promise(r=>setImmediate(r));
  await cache.get(2,1000,86400_000,async()=>({word:'new'}));gate.resolve();await before;
  assert.equal((await new PublicCacheState(store).get(2,1000,86400_000,async()=>{throw Error('D1');})).value.word,'new');
});

test('chunked values survive restart and a failed replacement never corrupts the prior commit',async()=>{
  let now=0;const store=storage(),cache=new PublicCacheState(store,()=>now);
  const old={text:'ع'.repeat(180000)};await cache.prime(1,old,10,1000);now=20;
  const originalPut=store.put;let writes=0;store.put=async(k,v)=>{if(++writes===2)throw Error('storage write failed');return originalPut(k,v);};
  assert.equal((await cache.get(1,10,1000,async()=>({text:'ب'.repeat(180000)}))).value.text,old.text);
  store.put=originalPut;
  assert.equal((await new PublicCacheState(store,()=>now).get(1,10,1000,async()=>{throw Error('D1');})).value.text,old.text);
});

test('public recovery rejects credentials, private reactions, invalid resources and oversized data',()=>{
  for(const value of [[{password:'x'}],[{email:'private@example.invalid'}],[{nested:{sessionId:'x'}}],[{isLiked:true}],[{reportText:'private'}]]) {
    assert.throws(()=>validatePublicSeed('word:1',value),{status:400});
  }
  assert.throws(()=>validatePublicSeed('users:1',[]),{status:400});
  assert.throws(()=>validatePublicSeed('word:1',{}),{status:400});
  assert.doesNotThrow(()=>validatePublicSeed('word:1',[{id:1,isLiked:false,isDisliked:false,isReported:false,word:{id:1,arabicWord:'كلمة'}}]));
});
