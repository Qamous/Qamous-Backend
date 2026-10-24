import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PublicCacheState} from '../src/public-cache-state.ts';
import {PublicSqliteCacheStore,PUBLIC_CACHE_SQL_CHUNK_BYTES,PUBLIC_CACHE_SQL_MAX_BYTES} from '../src/public-cache-sqlite-store.ts';

function fixture() {
  const sql=new DatabaseSync(':memory:'),legacy=new Map(),grants=[];
  let allowed=true,reads=0,failPart,databaseSize=0;
  const storage={sql:{get databaseSize(){return databaseSize;},exec(query,...values){
    if(failPart!==undefined&&query.startsWith('INSERT INTO public_cache_values_v3')&&values[1]===failPart+1)throw Error('Synthetic chunk failure');
    if(query.startsWith('SELECT'))reads++;
    const rows=sql.prepare(query).all(...values);return {toArray:()=>rows};
  }},transactionSync(fn){sql.exec('BEGIN');try{const value=fn();sql.exec('COMMIT');return value;}catch(error){sql.exec('ROLLBACK');throw error;}},async get(key){return structuredClone(legacy.get(key));}};
  const make=()=>new PublicSqliteCacheStore(storage,async(cost,tier)=>{grants.push({cost,tier});return allowed;});
  const changes=()=>sql.prepare('SELECT total_changes() AS n').get().n;
  return {sql,legacy,grants,make,changes,get reads(){return reads;},size(bytes){databaseSize=bytes;},deny(){allowed=false;},allow(){allowed=true;},fail(index){failPart=index;}};
}

test('ordinary cards cost one direct SQLite row and repeated hot reads do not touch storage',async()=>{
  const f=fixture();try {
    const cache=new PublicCacheState(f.make());
    await cache.prime(1,{results:[{definition:'A book',nested:{examples:['مثال']}}]},60_000,86400_000);
    assert.equal(f.changes(),1);assert.deepEqual(f.grants,[{cost:3,tier:'public'}]);
    const reads=f.reads;
    for(let count=0;count<1000;count++)assert.equal((await cache.get(1,60_000,86400_000,()=>{throw Error('D1 must stay unused');})).state,'hit');
    assert.equal(f.reads,reads,'warm in-memory entries avoid even SQLite reads');
    const value=(await cache.get(1,60_000,86400_000,()=>{})).value;
    assert.throws(()=>value.results[0].nested.examples.push('changed'),TypeError);
    assert.deepEqual((await new PublicCacheState(f.make()).get(1,60_000,86400_000,()=>{throw Error('D1');})).value,value);
  } finally {f.sql.close();}
});

test('the shared storage ceiling rejects growth before grants or schema writes while preserving existing entries',async()=>{
  const f=fixture();let now=100;try {
    const cache=new PublicCacheState(f.make(),()=>now);
    f.size(PUBLIC_CACHE_SQL_MAX_BYTES);
    assert.equal(await cache.prime(1,{word:'new'},10,1000),false);
    assert.equal(f.grants.length,0);assert.equal(f.changes(),0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='public_cache_values_v3'").get().n,0,'a full cache does not create a new schema');
    f.size(1_000_000);assert.equal(await cache.prime(1,{word:'published'},10,1000),true);
    const grants=f.grants.length;
    f.size(PUBLIC_CACHE_SQL_MAX_BYTES);now=1095;
    assert.equal(await cache.prime(1,{word:'published'},10,1000),true,'unchanged metadata can renew at the ceiling');
    assert.equal(f.grants.length,grants+1);
    assert.equal(await cache.prime(1,{word:'short'},10,1000),true,'shrinking entries remain writable');
    const before=f.grants.length;
    assert.equal(await cache.prime(1,{word:'a growing value'},10,1000),false);
    assert.equal(f.grants.length,before);
    assert.equal((await new PublicCacheState(f.make(),()=>now).get(1,10,1000,()=>{throw Error('D1');})).value.word,'short');
  } finally {f.sql.close();}
});

test('large Unicode payloads use bounded UTF-8 chunks and survive atomic replacements and restart',async()=>{
  const f=fixture();try {
    const value={text:'ع😀'.repeat(200_000)},cache=new PublicCacheState(f.make());
    await cache.prime(1,value,60_000,86400_000);
    const parts=f.sql.prepare('SELECT payload FROM public_cache_values_v3 WHERE id>0 ORDER BY id').all();
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

test('retained freshness never marks an older persisted payload fresh after a changed write was denied',async()=>{
  const f=fixture();let now=100,memo,loads=0;try {
    const freshness={get:()=>memo,put:value=>{memo=value;}};
    const cache=new PublicCacheState(f.make(),()=>now,undefined,freshness);
    await cache.prime(1,{word:'old'},10,1000);now=120;f.deny();
    await cache.prime(1,{word:'new'},10,1000);cache.releaseMemory();
    const restarted=new PublicCacheState(f.make(),()=>now,undefined,freshness);
    assert.equal((await restarted.get(1,10,1000,async()=>{loads++;return {word:'new'};})).value.word,'new');
    assert.equal(loads,1,'SHA-256 mismatch forces revalidation instead of returning the old SQL payload');
  } finally {f.sql.close();}
});

test('a detached older cache state cannot overwrite a newer revision committed before its write begins',async()=>{
  const f=fixture();try {
    const older=new PublicCacheState(f.make()),newer=new PublicCacheState(f.make());
    await newer.prime(2,{word:'new revision'},60_000,86400_000);
    const grants=f.grants.length;
    assert.equal(await older.prime(1,{word:'old delayed load'},60_000,86400_000),false);
    assert.equal(f.grants.length,grants,'older generations are refused before spending a write grant');
    assert.equal((await new PublicCacheState(f.make()).get(2,60_000,86400_000,()=>{throw Error('D1');})).value.word,'new revision');
  } finally {f.sql.close();}
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
    assert.equal(f.sql.prepare('SELECT parts FROM public_cache_values_v3 WHERE id=0').get().parts,0);
  } finally {f.sql.close();}
});
