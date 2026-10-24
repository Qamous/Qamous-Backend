import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PublicCacheState} from '../src/public-cache-state.ts';
import {PublicSqliteCacheStore,PUBLIC_CACHE_SQL_CHUNK_BYTES} from '../src/public-cache-sqlite-store.ts';

function fixture() {
  const sql=new DatabaseSync(':memory:'),legacy=new Map(),grants=[];
  let allowed=true,reads=0,failPart;
  const storage={sql:{exec(query,...values){
    if(failPart!==undefined&&query.startsWith('INSERT INTO public_cache_parts_v2')&&values[0]===failPart)throw Error('Synthetic chunk failure');
    if(query.startsWith('SELECT'))reads++;
    const rows=sql.prepare(query).all(...values);return {toArray:()=>rows};
  }},transactionSync(fn){sql.exec('BEGIN');try{const value=fn();sql.exec('COMMIT');return value;}catch(error){sql.exec('ROLLBACK');throw error;}},async get(key){return structuredClone(legacy.get(key));}};
  const make=()=>new PublicSqliteCacheStore(storage,async(cost,tier)=>{grants.push({cost,tier});return allowed;});
  const changes=()=>sql.prepare('SELECT total_changes() AS n').get().n;
  return {sql,legacy,grants,make,changes,get reads(){return reads;},deny(){allowed=false;},allow(){allowed=true;},fail(index){failPart=index;}};
}

test('ordinary cards cost one direct SQLite row and repeated hot reads do not touch storage',async()=>{
  const f=fixture();try {
    const cache=new PublicCacheState(f.make());
    await cache.prime(1,{results:[{definition:'A book',nested:{examples:['مثال']}}]},60_000,86400_000);
    assert.equal(f.changes(),1);assert.deepEqual(f.grants,[{cost:1,tier:'public'}]);
    const reads=f.reads;
    for(let count=0;count<1000;count++)assert.equal((await cache.get(1,60_000,86400_000,()=>{throw Error('D1 must stay unused');})).state,'hit');
    assert.equal(f.reads,reads,'warm in-memory entries avoid even SQLite reads');
    const value=(await cache.get(1,60_000,86400_000,()=>{})).value;
    assert.throws(()=>value.results[0].nested.examples.push('changed'),TypeError);
    assert.deepEqual((await new PublicCacheState(f.make()).get(1,60_000,86400_000,()=>{throw Error('D1');})).value,value);
  } finally {f.sql.close();}
});

test('large Unicode payloads use bounded UTF-8 chunks and survive atomic replacements and restart',async()=>{
  const f=fixture();try {
    const value={text:'ع😀'.repeat(200_000)},cache=new PublicCacheState(f.make());
    await cache.prime(1,value,60_000,86400_000);
    const parts=f.sql.prepare('SELECT payload FROM public_cache_parts_v2 ORDER BY id').all();
    assert.equal(parts.length,3);assert.equal(f.changes(),4);
    assert.ok(parts.every(part=>Buffer.byteLength(part.payload)<=PUBLIC_CACHE_SQL_CHUNK_BYTES));
    assert.deepEqual((await new PublicCacheState(f.make()).get(1,60_000,86400_000,()=>{throw Error('D1');})).value,value);
    f.fail(1);
    await assert.rejects(cache.prime(2,{text:'ب😀'.repeat(200_000)},60_000,86400_000),/chunk failure/);
    assert.deepEqual((await new PublicCacheState(f.make()).get(1,60_000,86400_000,()=>{throw Error('D1');})).value,value,'rollback preserves the complete prior generation');
  } finally {f.sql.close();}
});

test('unchanged TTL refreshes skip durable writes and renew only near the persisted stale deadline',async()=>{
  const f=fixture();let now=100;try {
    const cache=new PublicCacheState(f.make(),()=>now),value={word:'unchanged'};
    await cache.prime(1,value,10,1000);const changes=f.changes(),grants=f.grants.length;
    for(now=120;now<900;now+=20)assert.equal((await cache.get(1,10,1000,async()=>value)).value.word,'unchanged');
    assert.equal(f.changes(),changes);assert.equal(f.grants.length,grants,'identical refreshes do not ask the global write budget');
    now=1095;await cache.get(1,10,1000,async()=>value);
    assert.equal(f.changes(),changes+1,'one metadata row renews the persisted fallback window');
    assert.equal(f.grants.length,grants+1);
  } finally {f.sql.close();}
});

test('a denied public cache write serves its fresh load from memory without reviving an older moderation revision',async()=>{
  const f=fixture();try {
    const cache=new PublicCacheState(f.make());await cache.prime(1,{word:'old'},60_000,86400_000);const before=f.changes();
    f.deny();assert.equal(await cache.prime(2,{word:'new'},60_000,86400_000),false);
    assert.equal(f.changes(),before);
    assert.equal((await cache.get(2,60_000,86400_000,()=>{throw Error('D1');})).value.word,'new');
    await assert.rejects(new PublicCacheState(f.make()).get(2,60_000,86400_000,()=>{throw Error('Budget closed');}),/Budget closed/);
    f.allow();await cache.prime(2,{word:'new'},60_000,86400_000,'essential');
    assert.deepEqual(f.grants.at(-1),{cost:1,tier:'essential'});
    assert.equal((await new PublicCacheState(f.make()).get(2,60_000,86400_000,()=>{throw Error('D1');})).value.word,'new');
  } finally {f.sql.close();}
});

test('daily quota fallback honors a bounded long retry delay without revisiting D1 every minute',async()=>{
  for(const [retryAfter,expectedSeconds] of [[60,900],[7200,3600]]) {
    const f=fixture();let now=100,attempts=0;try {
      const cache=new PublicCacheState(f.make(),()=>now);
      await cache.prime(1,{word:'published'},1,7*86400_000);now=102;
      const unavailable=async()=>{attempts++;throw Object.assign(new Error('Daily budget closed'),{reason:'daily_budget',retryAfter});};
      assert.equal((await cache.get(1,1,7*86400_000,unavailable)).state,'stale');
      now+=61_000;await cache.get(1,1,7*86400_000,unavailable);assert.equal(attempts,1);
      now=102+expectedSeconds*1000-1;await cache.get(1,1,7*86400_000,unavailable);assert.equal(attempts,1);
      now++;await cache.get(1,1,7*86400_000,unavailable);assert.equal(attempts,2);
      await assert.rejects(cache.get(2,1,7*86400_000,unavailable),/Daily budget/,'new moderation revision never inherits the fallback');
    } finally {f.sql.close();}
  }
});

test('legacy KV entries remain readable and migrate to direct SQL only after a budgeted write',async()=>{
  const f=fixture();try {
    const now=Date.now(),json=JSON.stringify({word:'legacy'});
    f.legacy.set('record',{revision:7,token:'legacy-token',freshUntil:now+60_000,staleUntil:now+86400_000,parts:1});
    f.legacy.set('value:legacy-token:0',json);
    const cache=new PublicCacheState(f.make());
    assert.equal((await cache.get(7,60_000,86400_000,()=>{throw Error('D1');})).value.word,'legacy');assert.equal(f.changes(),0);
    await cache.prime(7,{word:'legacy'},60_000,86400_000);
    assert.equal(f.changes(),1);assert.equal(f.legacy.size,2,'no unbudgeted legacy KV deletes');
    assert.equal(f.sql.prepare('SELECT parts FROM public_cache_entry_v2').get().parts,0);
  } finally {f.sql.close();}
});
