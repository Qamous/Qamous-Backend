import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ReadBudgetLedger,READ_BUDGET_POLICY} from '../src/read-budget-ledger.ts';
import {guardD1,ReadBudgetError,queryReservation} from '../src/read-budget.ts';

const day='2026-10-22',start=Date.parse(day+'T12:00:00Z');
function fixture(rows=0) {
  const db=new DatabaseSync(':memory:'),events=[];
  const store={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};},},transactionSync(callback){db.exec('BEGIN IMMEDIATE');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const ledger=new ReadBudgetLedger(store,{day,rows},event=>events.push(event));
  return {db,store,events,ledger};
}
let seq=0;
const claim=(rows=100,tier='public',route='/word/:id')=>({id:'request-'+(++seq),rows,tier,route});

test('public allowance is 4.5m; importer pauses first; essential reserve stops at 4.9m',()=>{
  const f=fixture(3_499_950);
  assert.equal(f.ledger.reserve(claim(100,'import'),start).reason,'import_paused');
  assert.equal(f.ledger.reserve(claim(100),start).allowed,true);
  f.ledger.reconcile({day,rowsRead:4_499_950,observedAt:new Date(start).toISOString()},start);
  assert.equal(f.ledger.reserve(claim(100),start).reason,'daily_budget');
  assert.equal(f.ledger.reserve(claim(100,'essential'),start).allowed,true);
  f.ledger.reconcile({day,rowsRead:4_899_950,observedAt:new Date(start).toISOString()},start);
  assert.equal(f.ledger.reserve(claim(100,'essential'),start).reason,'daily_budget');
  assert.equal(READ_BUDGET_POLICY.publicRows,4_500_000);
  assert.equal(5_000_000-READ_BUDGET_POLICY.totalRows,100_000);
  f.db.close();
});

test('987 distributed uncached requests share one day cap regardless of IP or URL',()=>{
  const f=fixture();let admitted=0;
  for(let i=0;i<987;i++) {
    const now=start+i*6000,r=f.ledger.reserve(claim(10_000,'public','/word/'+i),now);
    if(r.allowed){admitted++;f.ledger.settle(r.id,10_000,0,now);}
  }
  const status=f.ledger.status(start+987*6000);
  assert.equal(admitted,450);assert.equal(status.usage.charged,4_500_000);assert.equal(status.usage.denied,537);
  assert.equal(f.events.filter(e=>e.event==='d1_read_budget_threshold'&&e.threshold===4_500_000).length,1);
  f.db.close();
});

test('unknown results keep their reservation after a crash; only concurrency expires',()=>{
  const f=fixture(),r=f.ledger.reserve(claim(50_000),start);
  assert.ok(r.allowed);
  f.ledger.settle(r.id,null,0,start+1000);
  const restart=new ReadBudgetLedger(f.store,{day,rows:0},()=>{});
  assert.equal(restart.status(start+100_000).usage.charged,50_000);
  assert.equal(restart.reserve(claim(50_000),start+100_000).allowed,true);
  restart.settle(r.id,9,3,start+100_000);
  assert.equal(restart.status(start+100_000).usage.charged,50_009);
  restart.settle(r.id,9,3,start+100_000);
  assert.equal(restart.status(start+100_000).usage.charged,50_009);
  f.db.close();
});

test('cost overruns open a durable circuit instead of silently expanding the estimate',()=>{
  const f=fixture(),r=f.ledger.reserve(claim(100),start);
  f.ledger.settle(r.id,101,0,start+1);
  assert.equal(f.ledger.status(start+1).usage.charged,101);
  assert.equal(f.ledger.reserve(claim(1,'essential'),start+2).reason,'cost_circuit_open');
  const restart=new ReadBudgetLedger(f.store,{day,rows:0},()=>{});
  assert.equal(restart.reserve(claim(1),start+3).reason,'cost_circuit_open');
  assert.equal(f.events.filter(e=>e.event==='d1_read_cost_overrun').length,1);
  f.db.close();
});

test('UTC rollover pauses new work, carries uncertain work, and starts the next clean day',()=>{
  const f=fixture(),near=Date.parse(day+'T23:58:30Z'),r=f.ledger.reserve(claim(500),near);
  assert.equal(f.ledger.reserve(claim(100),near+30_001).reason,'utc_rollover');
  const tomorrow=Date.parse('2026-10-23T00:00:01Z');
  assert.equal(f.ledger.status(tomorrow).usage.charged,500);
  f.ledger.settle(r.id,20,0,tomorrow);
  assert.equal(f.ledger.status(tomorrow).usage.charged,500,'late settlement never refunds next-day carry');
  assert.equal(f.ledger.reserve(claim(100),tomorrow).allowed,true);
  const exhausted=fixture(6_812_838);
  assert.equal(exhausted.ledger.reserve(claim(1),start).reason,'daily_budget');
  assert.equal(exhausted.ledger.status(tomorrow).usage.charged,0);
  f.db.close();exhausted.db.close();
});

test('baseline reconciliation is fresh, upward only, and cannot clear an overrun',()=>{
  const f=fixture(100);
  assert.throws(()=>f.ledger.reconcile({day,rowsRead:0,observedAt:new Date(start-301_000).toISOString()},start));
  assert.throws(()=>f.ledger.reconcile({day:'2026-10-21',rowsRead:0,observedAt:new Date(start).toISOString()},start));
  assert.equal(f.ledger.reconcile({day,rowsRead:1,observedAt:new Date(start).toISOString()},start).usage.charged,100);
  const r=f.ledger.reserve(claim(100),start);f.ledger.settle(r.id,101,0,start);
  assert.equal(f.ledger.reconcile({day,rowsRead:0,observedAt:new Date(start).toISOString()},start).usage.tripped,'reservation_exceeded');
  f.db.close();
});

test('same-minute burn, concurrency, importer concurrency and duplicate reservations are bounded',()=>{
  const f=fixture();
  const first=claim(50_000,'import'),r=f.ledger.reserve(first,start);
  assert.equal(f.ledger.reserve(first,start).reason,'replayed_reservation');
  assert.equal(f.ledger.status(start).usage.charged,50_000);
  assert.equal(f.ledger.reserve(claim(50_000,'import'),start).reason,'import_concurrency');
  for(let i=0;i<3;i++)assert.equal(f.ledger.reserve(claim(50_000),start).allowed,true);
  assert.equal(f.ledger.reserve(claim(1),start).reason,'concurrency');
  assert.equal(f.ledger.reserve(claim(50_000,'essential'),start).allowed,true);
  assert.equal(f.ledger.reserve(claim(50_000,'essential'),start).allowed,true);
  assert.equal(f.ledger.reserve(claim(1,'essential'),start).reason,'concurrency');
  const burst=fixture();assert.equal(burst.ledger.reserve(claim(250_000),start).allowed,true);
  assert.equal(burst.ledger.reserve(claim(1),start).reason,'burn_rate');
  assert.equal(burst.ledger.reserve(claim(50_000,'essential'),start).allowed,true);
  assert.equal(burst.ledger.reserve(claim(1,'essential'),start).reason,'burn_rate');
  f.db.close();burst.db.close();
});

test('storage admissions are nonrefundable, retain an essential reserve, and survive restart',()=>{
  const f=fixture();
  for(let n=0;n<READ_BUDGET_POLICY.ledgerPublicOperations;n++) {
    const r=f.ledger.reserve(claim(1),start);assert.equal(r.allowed,true);
    f.ledger.settle(r.id,0,0,start);
  }
  assert.equal(f.ledger.status(start).usage.charged,0);
  assert.equal(f.ledger.reserve(claim(1),start).reason,'do_storage_budget');
  assert.equal(f.ledger.reserve(claim(1,'import'),start).reason,'do_storage_budget');
  const restart=new ReadBudgetLedger(f.store,{day,rows:0},event=>f.events.push(event));
  for(let n=READ_BUDGET_POLICY.ledgerPublicOperations;n<READ_BUDGET_POLICY.ledgerTotalOperations;n++) {
    const r=restart.reserve(claim(1,'essential'),start);assert.equal(r.allowed,true);
    restart.settle(r.id,0,0,start);
  }
  const before=f.db.prepare('SELECT total_changes() AS n').get().n;
  for(let n=0;n<1000;n++)assert.equal(restart.reserve(claim(1,'essential'),start).reason,'do_storage_budget');
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before,'blocked retries write no rows');
  assert.equal(restart.status(start).usage.operations,READ_BUDGET_POLICY.ledgerTotalOperations);
  assert.equal(f.events.filter(event=>event.event==='do_storage_budget_threshold').length,1);
  assert.ok(f.events.filter(event=>event.event==='do_storage_budget_denied').length<20);
  f.db.close();
});

test('legacy admitted queries consume the storage allowance during migration',()=>{
  const f=fixture();
  f.db.prepare('INSERT INTO read_budget_routes(day,route,tier,queries) VALUES(?,?,?,?)').run(day,'/legacy','public',7770);
  f.db.exec('ALTER TABLE read_budget_days DROP COLUMN operations');
  const upgraded=new ReadBudgetLedger(f.store,{day,rows:0},()=>{});
  assert.equal(upgraded.status(start).usage.operations,7770);
  assert.equal(upgraded.reserve(claim(1,'essential'),start).reason,'do_storage_budget');
  f.db.close();
});

test('refusals never write cleanup or expiry and UTC rollover persists only one carry row',()=>{
  const f=fixture();
  for(let n=0;n<4;n++)assert.equal(f.ledger.reserve(claim(1),start).allowed,true);
  const before=f.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(f.ledger.reserve(claim(1),start).reason,'concurrency');
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before);
  const later=start+120_000,minute=Math.floor(later/60_000);
  f.db.prepare('INSERT INTO read_budget_minutes(minute,charged) VALUES(?,?)').run(minute,READ_BUDGET_POLICY.minuteRows);
  const burned=f.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(f.ledger.reserve(claim(1),later).reason,'burn_rate');
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,burned,'expired leases stay untouched during denial');
  const tomorrow=Date.parse('2026-10-23T23:59:30Z');
  assert.equal(f.ledger.status(tomorrow).usage.charged,4);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,burned,'status preview is read only');
  assert.equal(f.ledger.reserve(claim(1),tomorrow).reason,'utc_rollover');
  assert.equal(f.ledger.status(tomorrow).usage.charged,4);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,burned+1,'the first rollover refusal persists its conservative carry once');
  for(let n=0;n<10;n++) {
    const restarted=new ReadBudgetLedger(f.store,{day,rows:0},()=>{});
    assert.equal(restarted.reserve(claim(1),tomorrow).reason,'utc_rollover');
  }
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,burned+1,'cold retries do not rewrite the carry');
  f.db.close();
});

test('unknown settlement retries are idempotent and late settlements pay todays storage allowance',()=>{
  const f=fixture(),r=f.ledger.reserve(claim(100),start);
  f.ledger.settle(r.id,null,0,start);
  const unknown=f.db.prepare('SELECT total_changes() AS n').get().n;
  for(let n=0;n<1000;n++)f.ledger.settle(r.id,null,0,start);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,unknown);
  const tomorrow=Date.parse('2026-10-23T12:00:00Z');
  f.ledger.settle(r.id,10,0,tomorrow);
  assert.equal(f.ledger.status(tomorrow).usage.operations,1);
  assert.equal(f.ledger.status(tomorrow).usage.charged,100,'late success cannot refund the conservative carry');
  const other=f.ledger.reserve(claim(100),start+1000);
  f.db.prepare('UPDATE read_budget_days SET operations=? WHERE day=?').run(READ_BUDGET_POLICY.ledgerTotalOperations,'2026-10-23');
  const closed=f.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(f.ledger.settle(other.id,10,0,tomorrow).reason,'do_storage_budget');
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,closed);
  f.db.close();
});

test('rollover preview never replaces persisted counters and refreshes after meaningful mutations',()=>{
  const f=fixture(),tomorrow=Date.parse('2026-10-23T12:00:00Z');
  const first=f.ledger.reserve(claim(100),start);
  assert.equal(f.ledger.status(tomorrow).usage.charged,100);
  // An operation on the preview's source day changes its unresolved carry.
  f.ledger.settle(first.id,20,0,start+1);
  assert.equal(f.ledger.status(tomorrow).usage.charged,0);
  const second=f.ledger.reserve(claim(200),start+2);
  assert.equal(f.ledger.status(tomorrow).usage.charged,200);
  f.ledger.settle(second.id,null,0,start+3);
  assert.equal(f.ledger.status(tomorrow).usage.charged,200);
  const next=f.ledger.reserve(claim(50),tomorrow);
  assert.equal(next.allowed,true);
  assert.equal(f.ledger.status(tomorrow).usage.charged,250);
  assert.equal(f.ledger.status(tomorrow).usage.operations,1);
  f.ledger.reconcile({day:'2026-10-23',rowsRead:4_500_000,observedAt:new Date(tomorrow).toISOString()},tomorrow);
  assert.equal(f.ledger.reserve(claim(1),tomorrow).reason,'daily_budget');
  assert.equal(f.ledger.status(tomorrow).usage.charged,4_500_000);
  const restart=new ReadBudgetLedger(f.store,{day,rows:0},()=>{});
  assert.equal(restart.reserve(claim(1),tomorrow).reason,'daily_budget');
  assert.equal(restart.status(tomorrow).usage.operations,1);
  f.db.close();
});

function fakeD1({reads=12,writes=0,wait,fail=false,missing=false}={}) {
  let calls=0,firstCalls=0;
  const create=sql=>({sql,bind(){return create(sql);},async all(){calls++;if(wait)await wait;if(fail)throw Error('D1 unknown response');return {success:true,results:[{answer:42}],meta:missing?{}:{rows_read:reads,rows_written:writes}};},async run(){return this.all();},async first(){firstCalls++;throw Error('first must not hide metadata');}});
  const db={prepare:create,async batch(statements){return Promise.all(statements.map(s=>s.all()));},withSession(){return {...db,getBookmark:()=> 'bookmark-1'};},async exec(){throw Error('raw bypass');},async dump(){throw Error('raw bypass');}};
  return {db,get calls(){return calls;},get firstCalls(){return firstCalls;}};
}
const environment=(ledger,now=start)=>({READ_BUDGET:{getByName:()=>({reserve:input=>Promise.resolve(ledger.reserve(input,now)),settle:(...args)=>Promise.resolve(ledger.settle(...args,now))})}});

test('first/all/run/batch/session are metered including reads caused by writes; raw escape hatches fail',async()=>{
  const f=fixture(),raw=fakeD1({reads:12,writes:4}),env=environment(f.ledger),db=guardD1(raw.db,env,{route:'/word/124?private=1',tier:'public'});
  assert.equal(await db.prepare('SELECT answer FROM sample').bind(1).first('answer'),42);
  assert.equal(raw.firstCalls,0);
  await db.prepare('UPDATE sample SET answer=42').run();
  await db.batch([db.prepare('SELECT answer FROM sample'),db.prepare('SELECT answer FROM sample')]);
  const session=db.withSession('first-primary');
  assert.equal(session.getBookmark(),'bookmark-1');await session.prepare('SELECT answer FROM sample').all();
  assert.equal(f.ledger.status(start).usage.charged,60);assert.equal(raw.calls,5);
  assert.equal(f.ledger.status(start).routes[0].writes,20);
  assert.equal(f.ledger.status(start).routes[0].route,'/word/:id');
  await assert.rejects(()=>db.exec('SELECT 1'),ReadBudgetError);
  await assert.rejects(()=>db.dump(),ReadBudgetError);
  await assert.rejects(()=>db.prepare('SELECT 1').raw(),ReadBudgetError);
  await assert.rejects(()=>db.batch([raw.db.prepare('SELECT 1')]),ReadBudgetError);
  await assert.rejects(()=>db.batch(Array.from({length:6},()=>db.prepare('SELECT answer FROM sample'))),ReadBudgetError);
  assert.equal(raw.calls,5);f.db.close();
});

test('987 concurrent callers cannot race past persisted global reservations',{timeout:30_000},async()=>{
  const f=fixture();let release;
  const wait=new Promise(resolve=>release=resolve),raw=fakeD1({reads:20,wait}),env=environment(f.ledger);
  const work=Array.from({length:987},(_,n)=>guardD1(raw.db,env,{route:'/word/'+n,tier:'public'}).prepare('SELECT answer FROM sample').all());
  // Hold the admitted queries until every other caller has exhausted its
  // contention retries. A fixed sleep could release slots before late timers
  // ran on a busy CI host, legitimately admitting more than the first four.
  const denied=new Promise(resolve=>{let count=0;for(const promise of work) promise.catch(()=>{if(++count===987-READ_BUDGET_POLICY.publicConcurrent)resolve();});});
  const settled=Promise.allSettled(work);await denied;
  assert.equal(raw.calls,4);assert.equal(f.ledger.status(start).usage.charged,200_000);
  release();const results=await settled;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,4);assert.equal(f.ledger.status(start).usage.charged,80);
  f.db.close();
});

test('coordinator failure submits no SQL; unknown D1 result never refunds the reservation',async()=>{
  const raw=fakeD1(),broken={READ_BUDGET:{getByName:()=>({reserve:async()=>{throw Error('unavailable');}})}};
  await assert.rejects(()=>guardD1(raw.db,broken,{route:'/word',tier:'public'}).prepare('SELECT answer FROM sample').all(),ReadBudgetError);assert.equal(raw.calls,0);
  const f=fixture(),failed=fakeD1({fail:true});
  await assert.rejects(()=>guardD1(failed.db,environment(f.ledger),{route:'/word',tier:'public'}).prepare('SELECT answer FROM sample').all());
  assert.equal(f.ledger.status(start).usage.charged,50_000);
  const noMeta=fakeD1({missing:true});
  await assert.rejects(()=>guardD1(noMeta.db,environment(f.ledger),{route:'/word',tier:'public'}).prepare('SELECT answer FROM sample').all(),ReadBudgetError);
  assert.equal(f.ledger.status(start).usage.charged,100_000);f.db.close();
});

test('SQL LIMIT never becomes a scanned-row estimate; invalid contracts fail closed',()=>{
  assert.equal(queryReservation('SELECT * FROM definitions ORDER BY random() LIMIT 1'),50_000);
  assert.equal(queryReservation('SELECT * FROM users WHERE id=?'),128);
  assert.equal(queryReservation('SELECT 1'),1);
  assert.throws(()=>queryReservation('/* qamous-read:0 */ SELECT 1'),ReadBudgetError);
  assert.throws(()=>queryReservation('/* qamous-read:500000 */ SELECT 1'),ReadBudgetError);
});

test('public mutation barrier runs after admission and before SQL; denied writes retain cached content',async()=>{
  const f=fixture(),raw=fakeD1();let invalidations=0;
  const db=guardD1(raw.db,environment(f.ledger),{route:'/definitions/1',tier:'essential',beforeWrite:async()=>{assert.equal(raw.calls,1);invalidations++;}});
  await db.prepare('SELECT answer FROM sample').all();assert.equal(invalidations,0);
  await db.prepare('/* qamous-read:4000 */ UPDATE definitions SET definition=? WHERE id=?').bind('new',1).run();
  assert.equal(invalidations,1);assert.equal(raw.calls,2);
  f.ledger.reconcile({day,rowsRead:4_900_000,observedAt:new Date(start).toISOString()},start);
  await assert.rejects(()=>db.prepare('DELETE FROM definitions WHERE id=?').bind(1).run(),ReadBudgetError);
  assert.equal(invalidations,1);assert.equal(raw.calls,2);f.db.close();
});
