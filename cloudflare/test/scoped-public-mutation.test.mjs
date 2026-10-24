import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Exercise the production coordinator, resource cache, mutation barrier, SQL
// guard and read ledger together. Only the Worker base class and D1 transport
// are local adapters; queries execute against the real migrated SQLite schema.
// Synthetic metadata below tests accounting integration, not D1 query costs.
const bundled=await build({stdin:{contents:`
  export {QamousPublicCache,publicData,publicDataMany,publicMutationBarrier,preparePublicMutation} from './src/public-cache.ts';
  export {ReadBudgetLedger} from './src/read-budget-ledger.ts';
  export {guardD1} from './src/read-budget.ts';
  export {PUBLIC_CACHE_PREFIX,PUBLIC_CACHE_REVISION} from './src/public-cache-keys.ts';
`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,write:false,
  format:'esm',platform:'node',target:'es2022',plugins:[{
    name:'local-durable-object-base',
    setup(build) {
      build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'workers',namespace:'local-worker'}));
      build.onLoad({filter:/.*/,namespace:'local-worker'},()=>({contents:
        'export class DurableObject { constructor(ctx,env) {this.ctx=ctx;this.env=env;} }'}));
    },
  }]});
const {QamousPublicCache,publicData,publicDataMany,publicMutationBarrier,preparePublicMutation,ReadBudgetLedger,guardD1,
  PUBLIC_CACHE_PREFIX,PUBLIC_CACHE_REVISION}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const day='2026-10-22',now=Date.parse(day+'T12:00:00Z');
const migrations=await Promise.all((await readdir(new URL('../migrations/',import.meta.url)))
  .filter(name=>name.endsWith('.sql')).sort().map(name=>readFile(new URL('../migrations/'+name,import.meta.url),'utf8')));
function store(db=new DatabaseSync(':memory:')) {
  const values=new Map();
  return {db,sql:{exec(query,...args) {
    const rows=db.prepare(query).all(...args);
    return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};
  }},transactionSync(fn) {
    db.exec('BEGIN IMMEDIATE');try {const value=fn();db.exec('COMMIT');return value;}
    catch(error) {db.exec('ROLLBACK');throw error;}
  },async get(key) {return structuredClone(values.get(key));},
  async put(key,value) {values.set(key,structuredClone(value));},
  async delete(key) {return values.delete(key);}};
}

function fixture(t) {
  const sql=new DatabaseSync(':memory:'),ledgerStore=store(),objects=new Map(),stores=new Map();
  for(const migration of migrations) sql.exec(migration);
  sql.exec(`INSERT INTO countries VALUES ('EG','Egypt');
    INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES
      (1,'Synthetic','','synthetic@example.invalid','scoped_test','2026-01-01');
    INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES
      (1,1,'كلمة','kalima','2026-01-01'),(2,1,'يلا','yalla','2026-01-01');
    INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES
      (1,1,1,'EG','Original meaning A',0),(2,1,1,'EG','معنى عربي',1),
      (201,2,1,'EG','Unrelated meaning B',0);
    INSERT INTO posts VALUES ('post-a','1','Original post','Original post content',100,0);`);
  const ledger=new ReadBudgetLedger(ledgerStore,{day,rows:0,cacheDay:day,cacheRows:0},()=>{});
  let executions=0,failNextWrite=false,afterReadBatch,afterSettledBatch,unknownSql;
  const raw={prepare(query) {
    const create=(args=[])=>({bind(...next) {return create(next);},async all() {
      executions++;
      const writing=/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query.replace(/^\s*\/\*[\s\S]*?\*\/\s*/,''));
      if(writing&&failNextWrite) {failNextWrite=false;unknownSql=()=>sql.prepare(query).all(...args);throw Error('Synthetic unknown D1 result');}
      const results=sql.prepare(query).all(...args);
      const written=writing?Number(sql.prepare('SELECT changes() AS n').get().n):0;
      return {success:true,results,meta:{rows_read:Math.max(1,results.length),rows_written:written}};
    },async run() {return this.all();}});
    return create();
  },async batch(statements) {
    const results=[];sql.exec('BEGIN');try {for(const statement of statements)results.push(await statement.all());sql.exec('COMMIT');}
    catch(error) {sql.exec('ROLLBACK');throw error;}
    if(afterReadBatch&&results.every(row=>row.meta.rows_written===0)){afterSettledBatch=afterReadBatch;afterReadBatch=undefined;}
    return results;
  }};
  const env={DB:raw,READ_BUDGET:{getByName:()=>({
    reserve:async input=>ledger.reserve(input,now),
    reservePublicCacheWrites:async(cost,tier)=>ledger.reservePublicCacheWrites(cost,tier,now),
    settle:async(id,actual,writes)=>{const result=ledger.settle(id,actual,writes,now);
      if(afterSettledBatch){const hook=afterSettledBatch;afterSettledBatch=undefined;await hook();}return result;},
  })},PUBLIC_CACHE:{getByName(name) {
    if(!objects.has(name)) {
      if(!stores.has(name)) stores.set(name,store());
      objects.set(name,new QamousPublicCache({storage:stores.get(name)},env));
    }
    return objects.get(name);
  }}};
  const coordinator=env.PUBLIC_CACHE.getByName(PUBLIC_CACHE_REVISION);
  const charge=rowsRead=>ledger.reconcile({day,rowsRead,observedAt:new Date(now).toISOString()},now);
  const writer=barrier=>guardD1(raw,env,{route:'/definitions/1',tier:'essential',
    beforeWrite:barrier.beforeWrite,unknownWrite:barrier.unknownWrite});
  t.after(()=>{sql.close();ledgerStore.db.close();for(const item of stores.values()) item.db.close();});
  return {sql,env,ledger,coordinator,charge,writer,
    get executions() {return executions;},
    failWrite() {failNextWrite=true;},
    commitUnknownWrite() {assert.ok(unknownSql);const commit=unknownSql;unknownSql=undefined;commit();},
    afterReadBatch(hook) {afterReadBatch=hook;},
    expireTickets() {stores.get(PUBLIC_CACHE_REVISION).db.exec('UPDATE public_cache_scoped_mutations SET expires=0');},
    restart(key) {objects.delete(PUBLIC_CACHE_PREFIX+key);}};
}

async function warm(f,keys=['word:1','word:2']) {
  const values=[];
  // Sequential initial loads avoid making SQL-concurrency limits part of this
  // focused mutation test; read-budget.test.mjs separately exercises the burst.
  for(const key of keys) values.push(await publicData(f.env,key));
  const before=f.executions;
  assert.deepEqual(await publicDataMany(f.env,keys),values);
  assert.equal(f.executions,before,'warm reads execute no D1 statements');
  return values;
}
const temporarilyUnavailable=error=>error.name==='ReadBudgetError'&&error.status===503;

test('prepared-card publication retains the word lock until the derived D1 payload is stored',async t=>{
  const f=fixture(t);f.env.PUBLIC_CARD_PAYLOADS='true';
  const scope=async()=>['word:1','cards:0'];
  const prepare=(keys,renew)=>preparePublicMutation(f.env,keys,renew);
  const first=publicMutationBarrier(f.env,scope,undefined,prepare);
  await f.writer(first).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('First edited meaning',1).run();
  let competed=false;
  f.afterReadBatch(async()=>{
    const second=publicMutationBarrier(f.env,scope,undefined,prepare);
    const before=f.executions;
    await assert.rejects(()=>f.writer(second).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('Competing edit',1).run(),{status:409});
    await second.finish();
    assert.equal(f.executions,before,'a concurrent edit cannot reach D1 during preparation');competed=true;
  });
  await first.finish();assert.equal(competed,true);
  const saved=JSON.parse(f.sql.prepare('SELECT payload FROM public_card_payloads WHERE definitionId=1').get().payload);
  assert.equal(saved.definition,'First edited meaning');
  assert.equal((await f.coordinator.snapshot(['word:1'])).anyPending,false);
});

test('a slow prepared-card read cannot overwrite the newer payload after its mutation lease expires',async t=>{
  const f=fixture(t);f.env.PUBLIC_CARD_PAYLOADS='true';
  const scope=async()=>['word:1','cards:0'];
  const prepare=(keys,renew)=>preparePublicMutation(f.env,keys,renew);
  const first=publicMutationBarrier(f.env,scope,undefined,prepare);
  await f.writer(first).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('Older edited meaning',1).run();
  let competed=false;
  f.afterReadBatch(async()=>{
    f.expireTickets();
    const second=publicMutationBarrier(f.env,scope,undefined,prepare);
    await f.writer(second).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('Newest edited meaning',1).run();
    await second.finish();competed=true;
    assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM public_card_payloads WHERE definitionId=1').get().payload).definition,'Newest edited meaning');
  });
  await first.finish();assert.equal(competed,true);
  assert.equal(f.sql.prepare('SELECT definition FROM definitions WHERE id=1').get().definition,'Newest edited meaning');
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM public_card_payloads WHERE definitionId=1').get().payload).definition,'Newest edited meaning');
  assert.equal((await f.coordinator.snapshot(['word:1'])).anyPending,false);
});

test('an uncertain prepared-card INSERT retains its word claim until a potentially delayed D1 write is safe',async t=>{
  const f=fixture(t);f.env.PUBLIC_CARD_PAYLOADS='true';
  const scope=async()=>['word:1','cards:0'];
  const prepare=(keys,renew)=>preparePublicMutation(f.env,keys,renew);
  const first=publicMutationBarrier(f.env,scope,undefined,prepare);
  await f.writer(first).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('First edited meaning',1).run();
  f.failWrite();await first.finish();
  assert.deepEqual((await f.coordinator.snapshot(['word:1','word:2'])).pending,[true,false]);
  const second=publicMutationBarrier(f.env,scope,undefined,prepare);
  await assert.rejects(()=>f.writer(second).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('Premature edit',1).run(),{status:409});
  await second.finish();
  f.commitUnknownWrite();
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM public_card_payloads WHERE definitionId=1').get().payload).definition,'First edited meaning');
  f.expireTickets();
  const next=publicMutationBarrier(f.env,scope,undefined,prepare);
  await f.writer(next).prepare('UPDATE definitions SET definition=? WHERE id=?').bind('Newest edited meaning',1).run();
  await next.finish();
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM public_card_payloads WHERE definitionId=1').get().payload).definition,'Newest edited meaning');
});

test('at 4.6m reads, editing A blocks its stale snapshot but B stays warm without D1',async t=>{
  const f=fixture(t),[,wordB]=await warm(f);
  f.charge(4_600_000);
  const before=await f.coordinator.snapshot(['word:1','word:2']);
  const barrier=publicMutationBarrier(f.env,async()=>['word:1']);
  await f.writer(barrier).prepare('/* qamous-read:4000 */ UPDATE definitions SET definition=? WHERE id=?')
    .bind('Edited meaning A',1).run();
  const afterWrite=f.executions;
  await assert.rejects(()=>publicData(f.env,'word:1'),temporarilyUnavailable);
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,afterWrite,'pending A never blocks or reloads B');
  await barrier.finish();
  const after=await f.coordinator.snapshot(['word:1','word:2']);
  assert.ok(after.versions[0]>before.versions[0]);
  assert.equal(after.versions[1],before.versions[1]);
  assert.equal(after.anyPending,false);
  await assert.rejects(()=>publicData(f.env,'word:1'),error=>temporarilyUnavailable(error)&&error.reason==='daily_budget');
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,afterWrite,'a denied cache refresh never submits SQL');
  assert.equal(f.sql.prepare('SELECT definition FROM definitions WHERE id=1').get().definition,'Edited meaning A');
});

test('a deleted word cannot reappear from stale storage, including after a resource object restarts',async t=>{
  const f=fixture(t),[,wordB]=await warm(f);
  f.charge(4_600_000);
  const barrier=publicMutationBarrier(f.env,async()=>['word:1']);
  await f.writer(barrier).prepare('/* qamous-read:4000 */ DELETE FROM definitions WHERE wordId=?').bind(1).run();
  await barrier.finish();
  const afterWrite=f.executions;
  for(let attempt=0;attempt<2;attempt++) {
    await assert.rejects(()=>publicData(f.env,'word:1'),temporarilyUnavailable);
    assert.deepEqual(await publicData(f.env,'word:2'),wordB);
    f.restart('word:1');
  }
  assert.equal(f.executions,afterWrite);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM definitions WHERE wordId=1').get().n,0);
});

test('editing a post cannot clear cached dictionary words during a read-budget outage',async t=>{
  const f=fixture(t),keys=['word:1','word:2','posts'],values=await warm(f,keys);
  f.charge(4_600_000);
  const before=await f.coordinator.snapshot(keys);
  const barrier=publicMutationBarrier(f.env,async()=>['posts']);
  await f.writer(barrier).prepare('/* qamous-read:4000 */ UPDATE posts SET content=? WHERE id=?').bind('Edited post','post-a').run();
  const afterWrite=f.executions;
  assert.deepEqual(await publicDataMany(f.env,keys.slice(0,2)),values.slice(0,2));
  await assert.rejects(()=>publicData(f.env,'posts'),temporarilyUnavailable);
  await barrier.finish();
  assert.deepEqual(await publicDataMany(f.env,keys.slice(0,2)),values.slice(0,2));
  const after=await f.coordinator.snapshot(keys);
  assert.deepEqual(after.versions.slice(0,2),before.versions.slice(0,2));
  assert.ok(after.versions[2]>before.versions[2]);
  assert.equal(f.executions,afterWrite);
});

test('a denied essential write does not resolve dependencies, invalidate versions or discard warm data',async t=>{
  const f=fixture(t),keys=['word:1','word:2','posts'],values=await warm(f,keys);
  f.charge(4_900_000);
  const before=await f.coordinator.snapshot(keys),executions=f.executions;
  let resolved=0;
  const barrier=publicMutationBarrier(f.env,async()=>{resolved++;return ['word:1'];});
  await assert.rejects(()=>f.writer(barrier).prepare('/* qamous-read:4000 */ DELETE FROM definitions WHERE wordId=?').bind(1).run(),temporarilyUnavailable);
  await barrier.finish();
  assert.equal(resolved,0);
  assert.deepEqual(await f.coordinator.snapshot(keys),before);
  assert.deepEqual(await publicDataMany(f.env,keys),values);
  assert.equal(f.executions,executions);
});

test('an unknown write result leaves only its own resources pending and never revives old content',async t=>{
  const f=fixture(t),[,wordB]=await warm(f);
  f.charge(4_600_000);
  const barrier=publicMutationBarrier(f.env,async()=>['word:1']);
  f.failWrite();
  await assert.rejects(()=>f.writer(barrier).prepare('/* qamous-read:4000 */ DELETE FROM definitions WHERE wordId=?').bind(1).run(),/Synthetic unknown D1 result/);
  await barrier.finish();
  const afterWrite=f.executions,snapshot=await f.coordinator.snapshot(['word:1','word:2']);
  assert.deepEqual(snapshot.pending,[true,false]);
  await assert.rejects(()=>publicData(f.env,'word:1'),temporarilyUnavailable);
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,afterWrite);
});

test('an overlapping word claim refuses a second write before D1 and refunds its reservation',async t=>{
  const f=fixture(t),[,wordB]=await warm(f);
  f.charge(4_600_000);
  let resolved=0;
  const first=publicMutationBarrier(f.env,async()=>{resolved++;return ['word:1'];});
  await first.beforeWrite();
  const usage=f.ledger.status(now).usage,executions=f.executions;
  const second=publicMutationBarrier(f.env,async()=>['word:1']);
  await assert.rejects(()=>f.writer(second).prepare('/* qamous-read:4000 */ DELETE FROM definitions WHERE wordId=?').bind(1).run(),{status:409});
  await second.finish();
  assert.equal(f.executions,executions,'a refused claim never submits the reserved SQL');
  const after=f.ledger.status(now).usage;
  assert.equal(after.charged,usage.charged,'known pre-submit refusal refunds its reservation');
  assert.equal(after.measured,usage.measured);
  const resolvedBeforeUnknownFinish=resolved;
  first.unknownWrite();
  await first.finish();
  assert.equal(resolved,resolvedBeforeUnknownFinish+1,'unknown writes attempt to include any newly allocated IDs');
  assert.deepEqual((await f.coordinator.snapshot(['word:1','word:2'])).pending,[true,false]);
  await assert.rejects(()=>publicData(f.env,'word:1'),temporarilyUnavailable);
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,executions);
});

test('membership discovered after the first word claim is protected before SQL submission',async t=>{
  const f=fixture(t);await warm(f);f.charge(4_600_000);
  let lookups=0;
  const barrier=publicMutationBarrier(f.env,async()=>++lookups===1?['word:1']:['word:1','word:2']);
  const executions=f.executions;
  await barrier.beforeWrite();
  assert.deepEqual((await f.coordinator.snapshot(['word:1','word:2'])).pending,[true,true]);
  assert.equal(f.executions,executions);
  barrier.unknownWrite();await barrier.finish();
});

test('confirmed post-write payloads restore only changed resources while public SQL is paused',async t=>{
  const f=fixture(t),[wordA,wordB]=await warm(f);
  f.charge(4_600_000);
  let refreshes=0;
  const fresh=wordA.map(row=>row.id===1?{...row,definition:'Freshly published A'}:row);
  const barrier=publicMutationBarrier(f.env,async()=>['word:1'],async keys=>{
    refreshes++;
    assert.deepEqual(keys,['word:1']);
    assert.equal((await f.coordinator.snapshot(keys)).anyPending,false);
    return [{key:'word:1',value:fresh,status:200}];
  });
  await f.writer(barrier).prepare('/* qamous-read:4000 */ UPDATE definitions SET definition=? WHERE id=?').bind('Freshly published A',1).run();
  await barrier.finish();
  const afterWrite=f.executions;
  assert.equal(refreshes,1);
  assert.deepEqual(await publicDataMany(f.env,['word:1','word:2']),[fresh,wordB]);
  assert.equal(f.executions,afterWrite);
});

test('a confirmed deletion can publish a true 404 without caching a budget denial as missing',async t=>{
  const f=fixture(t),[,wordB]=await warm(f);
  f.charge(4_600_000);
  const barrier=publicMutationBarrier(f.env,async()=>['word:1'],async()=>[
    {key:'word:1',value:'Word not found',status:404},
  ]);
  await f.writer(barrier).prepare('/* qamous-read:4000 */ DELETE FROM definitions WHERE wordId=?').bind(1).run();
  await barrier.finish();
  const afterWrite=f.executions;
  await assert.rejects(()=>publicData(f.env,'word:1'),{status:404,message:'Word not found'});
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,afterWrite);
});

test('a concurrent second mutation prevents an older refresh from publishing under its newer version',async t=>{
  const f=fixture(t),[wordA,wordB]=await warm(f);
  f.charge(4_600_000);
  const outdated=wordA.map(row=>row.id===1?{...row,definition:'First edit'}:row);
  const first=publicMutationBarrier(f.env,async()=>['word:1'],async()=>{
    const second=publicMutationBarrier(f.env,async()=>['word:1']);
    await f.writer(second).prepare('/* qamous-read:4000 */ UPDATE definitions SET definition=? WHERE id=?').bind('Second edit',1).run();
    await second.finish();
    return [{key:'word:1',value:outdated,status:200}];
  });
  await f.writer(first).prepare('/* qamous-read:4000 */ UPDATE definitions SET definition=? WHERE id=?').bind('First edit',1).run();
  await first.finish();
  const afterWrites=f.executions;
  await assert.rejects(()=>publicData(f.env,'word:1'),temporarilyUnavailable);
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,afterWrites);
  assert.equal(f.sql.prepare('SELECT definition FROM definitions WHERE id=1').get().definition,'Second edit');
});

test('an unrelated coordinator clock change during a read does not reject an unchanged warm resource',async t=>{
  const f=fixture(t),[,wordB]=await warm(f);
  f.charge(4_600_000);
  const object=f.env.PUBLIC_CACHE.getByName(PUBLIC_CACHE_PREFIX+'word:2'),get=object.get.bind(object);
  object.get=async(...args)=>{
    const result=await get(...args);
    await f.coordinator.beginScoped('concurrent-post-edit',['posts']);
    await f.coordinator.finishScoped('concurrent-post-edit');
    return result;
  };
  const before=f.executions;
  assert.deepEqual(await publicData(f.env,'word:2'),wordB);
  assert.equal(f.executions,before);
});
