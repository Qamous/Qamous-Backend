import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {IMPORT_ACCOUNT,IMPORT_MANIFEST,CLOUD_PACKET_RESERVE,IMPORT_LEDGER_POLICY_VERSION,importPolicyAt,importQuota,importLedgerCapacity,quotaRetryAt,recoverCloudFlight} from '../src/import-cloud-policy.mjs';
import {runCloudImport,recoverBaselineHalt,BASELINE_HALT_REASON} from '../src/import-cloud.mjs';
import {READ_BUDGET_POLICY} from '../src/read-budget-ledger.ts';

const at=time=>new Date('2026-10-21T'+time+'Z');
const state=writes=>({days:{'2026-10-21':{initialAccountWrites:0,rowsWritten:writes,rowsRead:0}}});
const usage=writes=>({day:'2026-10-21',rowsWritten:writes,rowsRead:100});
const waiting={status:'waiting_for_free_quota',reason:'Shared Free quota reserve reached',lastAttemptAt:'2026-10-21T04:24:07Z',nextAttemptAt:'2026-10-22T00:15:00.000Z'};
const ledgerStatus=()=>({day:'2026-10-21',initialized:true,policy:READ_BUDGET_POLICY,usage:{charged:100,ledgerRows:0,tierLedgerRows:{public:0,import:0,essential:0,unknown:0},tripped:null}});

test('only 22:00 through 23:54 UTC raises the two ceilings to 95k',()=>{
  for(const time of ['00:15:00','12:00:00','21:59:59','23:55:00'])assert.equal(importPolicyAt(at(time)).phase,'daytime');
  for(const time of ['22:00:00','23:54:59'])assert.deepEqual(importPolicyAt(at(time)),{version:'late-catchup-v1',phase:'late_catchup',dailyImportWriteCeiling:95000,accountWriteCeiling:95000,packetReserve:10000,lateCatchupTarget:95000,windowUTC:'22:00–23:55'});
  assert.equal(importPolicyAt(at('21:59:59')).dailyImportWriteCeiling,75000);
  assert.equal(importPolicyAt(at('21:59:59')).accountWriteCeiling,80000);
});

test('daytime quota hold wakes at the late window rather than skipping to tomorrow',()=>{
  const q=importQuota(state(65241),usage(65241),at('14:00:00'));
  assert.ok(q.remaining<CLOUD_PACKET_RESERVE);assert.equal(q.nextAttemptAt,'2026-10-21T22:00:00.000Z');
  assert.equal(quotaRetryAt(waiting,at('14:00:00')),'2026-10-21T22:00:00.000Z');
  assert.equal(quotaRetryAt({...waiting,lastAttemptAt:'2026-10-21T22:30:00Z'},at('23:00:00')),waiting.nextAttemptAt);
});

test('quota wakeup never bypasses non-quota retries, final audit, or an uncertain write',()=>{
  for(const change of [{status:'retry_pending'},{status:'needs_access'},{status:'awaiting_final_audit'},{reason:'D1 daily limit exceeded'},{inFlight:{index:0}},{lastAttemptAt:'invalid'},{lastAttemptAt:'2026-10-22T04:00:00Z'}])assert.equal(quotaRetryAt({...waiting,...change},at('22:00:00')),waiting.nextAttemptAt);
});

test('legacy generic budget holds receive exactly one fresh policy reassessment without bypassing uncertain work or halts',()=>{
  const held={...waiting,reason:'The dictionary is temporarily busy. Please try again shortly.'};
  assert.equal(quotaRetryAt(held,at('14:00:00')),at('14:00:00').toISOString());
  assert.equal(quotaRetryAt({...held,ledgerPolicyVersion:IMPORT_LEDGER_POLICY_VERSION},at('14:00:00')),held.nextAttemptAt);
  for(const change of [{inFlight:{index:0}},{halted:true},{status:'halted'},{reason:'Reaction, points or managed-account integrity failed'}])assert.equal(quotaRetryAt({...held,...change},at('14:00:00')),held.nextAttemptAt);
});

test('shared usage, maintenance reserves and the full 10k allowance constrain late catch-up',()=>{
  assert.equal(importQuota(state(65241),usage(65241),at('22:00:00')).remaining,29759);
  assert.equal(importQuota(state(85000),usage(85000),at('22:00:00')).remaining,10000);
  assert.ok(importQuota(state(85001),usage(85001),at('22:00:00')).remaining<CLOUD_PACKET_RESERVE);
  const reserved=state(65241);reserved.days['2026-10-21'].maintenanceWritesReserve=23341;
  assert.equal(importQuota(reserved,usage(65241),at('22:00:00')).effectiveWrites,88582);
  assert.ok(importQuota(reserved,usage(65241),at('22:00:00')).remaining<CLOUD_PACKET_RESERVE);
  assert.ok(importQuota(state(1000),usage(94000),at('22:00:00')).remaining<CLOUD_PACKET_RESERVE);
  const reads={...usage(0),rowsRead:3900000};assert.equal(importQuota(state(0),reads,at('22:00:00')).allowed,false);
});

test('settling and five-minute UTC cutoff remain in force',()=>{
  assert.equal(importQuota(state(0),usage(0),at('00:14:59')).allowed,false);
  assert.equal(importQuota(state(0),usage(0),at('00:14:59')).nextAttemptAt,'2026-10-21T00:15:00.000Z');
  assert.equal(importQuota(state(0),usage(0),at('23:55:00')).allowed,false);
  assert.equal(importQuota(state(0),usage(0),at('23:55:00')).nextAttemptAt,'2026-10-22T00:15:00.000Z');
  const next=importQuota({days:{}},{day:'2026-10-22',rowsRead:0,rowsWritten:0},new Date('2026-10-22T00:15:00Z'));
  assert.equal(next.policy.dailyImportWriteCeiling,75000);
});

class Objects {
  values=new Map();version=0;
  async put(key,value,options={}){const previous=this.values.get(key);if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==previous?.etag)return null;const etag=String(++this.version);this.values.set(key,{value,etag});return {etag};}
  async get(key){const row=this.values.get(key);return row?{etag:row.etag,size:Buffer.byteLength(row.value),text:async()=>row.value,arrayBuffer:async()=>Buffer.from(row.value)}:null;}
}
const hash=text=>createHash('sha256').update(text).digest('hex');
async function fixture(time='22:00:01',writes=65241){
  const objects=new Objects();let now=at(time),batches=0;
  const packet={index:0,statements:['INSERT OR IGNORE INTO "words"("id") VALUES(1);'],identities:[],completed:[42]};
  const page=JSON.stringify({packets:[packet]}),job={manifestHash:IMPORT_MANIFEST,representation:2,exampleAlignment:1,packetCount:1,packetsPerPage:8,pages:[{sha256:hash(page)}]};
  const jobText=JSON.stringify(job),jobHash=hash(jobText),key='jobs/'+jobHash+'/';
  const checkpoint={...state(writes),...waiting,jobHash,manifestHash:IMPORT_MANIFEST,cursor:0,packetCount:1,completedRecords:0,totalRecords:1,schemaVerifiedAt:now.toISOString(),recoveryPoint:{createdAt:now.toISOString()}};
  await objects.put(key+'checkpoint.json',JSON.stringify(checkpoint));await objects.put(key+'job.json',jobText);await objects.put(key+'pages/000000.json',page);
  const budget={reserve:async request=>({allowed:true,id:request.id,day:now.toISOString().slice(0,10),reserved:request.rows}),settle:async()=>({settled:true}),reconcile:async()=>ledgerStatus()};
  const env={IMPORTS:objects,IMPORT_JOB_HASH:jobHash,CLOUDFLARE_READ_TOKEN:'synthetic',READ_BUDGET:{getByName:()=>budget},DB:{prepare:sql=>({sql}),batch:async()=>{batches++;return [{success:true,meta:{rows_written:300,rows_read:10,size_after:1000}}];}}};
  const deps={now:()=>now,billing:async()=>({accountId:IMPORT_ACCOUNT,observedAt:now.toISOString()}),usage:async()=>usage(writes),audit:async()=>({passed:true,rowsRead:5})};
  return {env,deps,objects,key,get batches(){return batches;},set time(time){now=at(time);}};
}

test('upgrade persists the earlier wakeup without making any D1 or billing request',async()=>{
  const f=await fixture('17:00:00');f.deps.billing=()=>{throw Error('Unexpected billing request before window');};
  const result=await runCloudImport(f.env,'scheduled',f.deps);
  assert.equal(result.nextAttemptAt,'2026-10-21T22:00:00.000Z');assert.equal(result.cursor,0);assert.equal(f.batches,0);
  const checkpoint=JSON.parse(await (await f.objects.get(f.key+'checkpoint.json')).text());assert.equal(checkpoint.lease,undefined);assert.equal(checkpoint.days['2026-10-21'].rowsWritten,65241);
});

test('legacy midnight hold resumes in the late window, then retries are duplicate-safe',async()=>{
  const f=await fixture();const result=await runCloudImport(f.env,'scheduled',f.deps);
  assert.equal(result.state,'complete');assert.equal(result.cursor,1);assert.equal(result.days['2026-10-21'].rowsWritten,65541);assert.equal(result.quotaPolicy.accountWriteCeiling,95000);assert.equal(result.verifiedScheduledBatch.integrityPassed,true);
  await runCloudImport(f.env,'scheduled',f.deps);assert.equal(f.batches,1);
});

test('late window never submits a packet which cannot fit its unchanged reservation',async()=>{
  for(const writes of [85001,95000,100000]){const f=await fixture('22:00:01',writes);const result=await runCloudImport(f.env,'scheduled',f.deps);assert.equal(f.batches,0);assert.equal(result.cursor,0);assert.equal(result.nextAttemptAt,'2026-10-22T00:15:00.000Z');}
});

test('restart recovery still charges an uncertain packet only once on its original day',()=>{
  const s={...state(65241),cursor:0,inFlight:{index:0,startedAt:'2026-10-21T22:01:00Z',reservedWrites:10000}};
  assert.equal(recoverCloudFlight(s,new Date('2026-10-22T00:15:00Z')),true);assert.equal(s.days['2026-10-21'].rowsWritten,75241);assert.equal(recoverCloudFlight(s),false);
});

test('global read guard pauses import before SQL even when analytics report low usage',async()=>{
  const f=await fixture();
  f.env.READ_BUDGET.getByName=()=>({reconcile:async()=>ledgerStatus(),reserve:async()=>({allowed:false,reason:'import_paused',retryAfter:3600})});
  const result=await runCloudImport(f.env,'scheduled',f.deps);
  assert.equal(result.state,'waiting_for_free_quota');assert.equal(f.batches,0);assert.equal(result.cursor,0);
  const saved=JSON.parse(await (await f.objects.get(f.key+'checkpoint.json')).text());
  assert.equal(saved.inFlight,undefined,'definitive admission denial cannot create a phantom write reservation');
  assert.equal(saved.days['2026-10-21'].rowsWritten,65241);
  f.time='23:00:01';await runCloudImport(f.env,'scheduled',f.deps);
  const retry=JSON.parse(await (await f.objects.get(f.key+'checkpoint.json')).text());
  assert.equal(retry.days['2026-10-21'].rowsWritten,65241);
});

test('shared storage and read capacity pause imports automatically before an in-flight marker',async()=>{
  for(const mode of ['storage','reads','missing']) {
    const f=await fixture();const status=ledgerStatus();
    if(mode==='storage'){status.usage.ledgerRows=48000;status.usage.tierLedgerRows.public=48000;}
    if(mode==='reads')status.usage.charged=3400000;
    f.env.READ_BUDGET.getByName=()=>({reconcile:async()=>mode==='missing'?{}:status});
    const result=await runCloudImport(f.env,'scheduled',f.deps);
    assert.equal(f.batches,0);assert.equal(result.halted,false);assert.equal(result.state,'waiting_for_free_quota');
    const saved=JSON.parse(await (await f.objects.get(f.key+'checkpoint.json')).text());assert.equal(saved.inFlight,undefined);
    if(mode==='missing')assert.equal(result.nextAttemptAt,'2026-10-21T22:01:01.000Z');
    else assert.equal(result.nextAttemptAt,'2026-10-22T00:15:00.000Z');
  }
});

test('reassessing an old hold still requires fresh storage capacity and persists the policy version on refusal',async()=>{
  const f=await fixture('14:00:00',0),key=f.key+'checkpoint.json';
  const checkpoint=JSON.parse(await (await f.objects.get(key)).text());checkpoint.reason='The dictionary is temporarily busy. Please try again shortly.';await f.objects.put(key,JSON.stringify(checkpoint));
  const status=ledgerStatus();status.usage.ledgerRows=48000;status.usage.tierLedgerRows.public=48000;
  f.env.READ_BUDGET.getByName=()=>({reconcile:async()=>status});
  const result=await runCloudImport(f.env,'scheduled',f.deps);assert.equal(f.batches,0);assert.equal(result.ledgerPolicyVersion,IMPORT_LEDGER_POLICY_VERSION);assert.equal(result.nextAttemptAt,'2026-10-22T00:15:00.000Z');
  assert.equal(JSON.parse(await (await f.objects.get(key)).text()).inFlight,undefined);
});

test('tier-aware importer preflight preserves the essential reserve without treating its usage as import spend',()=>{
  const status=ledgerStatus();status.usage.ledgerRows=53944;status.usage.tierLedgerRows={public:41952,import:2976,essential:9016,unknown:0};
  const allowed=importLedgerCapacity(status,at('22:00:00'));
  assert.equal(allowed.allowed,true);assert.equal(allowed.remainingLedgerRows,3072);
  status.usage.tierLedgerRows.unknown=3072;status.usage.ledgerRows+=3072;
  assert.equal(importLedgerCapacity(status,at('22:00:00')).reason,'do_storage_budget');
});

test('a measured batch receipt survives audit failure without a second 10k write charge',async()=>{
  const f=await fixture();let audits=0,batches=0;
  f.env.DB.batch=async()=>[{success:true,meta:{rows_written:batches++?0:300,rows_read:10,size_after:1000}}];
  f.deps.audit=async()=>{if(audits++===0)throw Error('Temporary audit service unavailable');return {passed:true,rowsRead:5};};
  const first=await runCloudImport(f.env,'scheduled',f.deps);assert.equal(first.state,'retry_pending');assert.equal(first.cursor,0);assert.equal(first.days['2026-10-21'].rowsWritten,65541);
  const receipt=JSON.parse(await (await f.objects.get(f.key+'checkpoint.json')).text()).inFlight.measurement;assert.equal(receipt.charged,true);assert.equal(receipt.rowsWritten,300);
  f.time='23:00:01';const second=await runCloudImport(f.env,'scheduled',f.deps);assert.equal(second.state,'complete');assert.equal(second.days['2026-10-21'].rowsWritten,65541);assert.equal(second.days['2026-10-21'].rowsRead,25);assert.equal(batches,2);
});

test('unknown raw D1 failures retain the full write reservation and are charged only once',async()=>{
  const f=await fixture();f.env.DB.batch=async()=>{throw Error('Network response lost');};
  const first=await runCloudImport(f.env,'scheduled',f.deps);assert.equal(first.state,'retry_pending');assert.equal(first.days['2026-10-21'].rowsWritten,65241);
  assert.ok(JSON.parse(await (await f.objects.get(f.key+'checkpoint.json')).text()).inFlight);
  f.time='23:00:01';const second=await runCloudImport(f.env,'scheduled',f.deps);assert.equal(second.days['2026-10-21'].rowsWritten,75241);
});

test('malformed measured receipts cannot suppress a conservative recovery charge',()=>{
  const flight={index:0,startedAt:'2026-10-21T22:01:00Z',reservedWrites:10000,measurement:{rowsWritten:300,rowsRead:10,databaseBytes:1000,charged:true}};
  assert.throws(()=>recoverCloudFlight({...state(0),cursor:0,inFlight:flight}),/Unrecognized measured/);
});

test('baseline clock rejection is retryable before any D1 work',async()=>{
  const f=await fixture();f.env.READ_BUDGET.getByName=()=>({reconcile:async()=>{throw Error(BASELINE_HALT_REASON);}});
  const result=await runCloudImport(f.env,'scheduled',f.deps);
  assert.equal(result.state,'retry_pending');assert.equal(result.halted,false);assert.equal(result.cursor,0);assert.equal(f.batches,0);
});

async function haltedFixture(change={}) {
  const f=await fixture(),key=f.key+'checkpoint.json';
  const state=JSON.parse(await (await f.objects.get(key)).text());
  Object.assign(state,{halted:true,status:'halted',reason:BASELINE_HALT_REASON,nextAttemptAt:null},change);
  await f.objects.put(key,JSON.stringify(state));
  const expected=Object.fromEntries(['jobHash','manifestHash','cursor','completedRecords','lastAttemptAt'].map(k=>[k,state[k]]));
  f.env.READ_BUDGET.getByName=()=>({reconcile:async input=>({day:input.day,initialized:true,usage:{charged:input.rowsRead,tripped:null}})});
  f.env.DB=new Proxy({},{get(){throw Error('Baseline repair must never access D1');}});
  return {...f,key,state,expected};
}

test('precise baseline halt recovery reconciles fresh usage without a packet or checkpoint advance',async()=>{
  const f=await haltedFixture(),before=f.state;
  const result=await recoverBaselineHalt(f.env,f.expected,f.deps);
  assert.equal(result.state,'retry_pending');assert.equal(result.halted,false);assert.equal(result.cursor,before.cursor);assert.equal(result.completedRecords,before.completedRecords);
  const after=JSON.parse(await (await f.objects.get(f.key)).text());
  assert.deepEqual(after.days,before.days);assert.equal(after.lastAttemptAt,before.lastAttemptAt);assert.equal(after.baselineRecovery.previousReason,BASELINE_HALT_REASON);
  assert.equal(f.batches,0);
});

test('recovery refuses other halts, checkpoint identity changes and uncertain/leased packets unchanged',async()=>{
  for(const change of [{reason:'Immutable job manifest mismatch'},{inFlight:{index:0}},{lease:{id:'old',expiresAt:'2020-01-01'}},{halted:false},{status:'retry_pending'}]) {
    const f=await haltedFixture(change),before=await (await f.objects.get(f.key)).text();
    await assert.rejects(recoverBaselineHalt(f.env,f.expected,f.deps),/verified pre-D1/);
    assert.equal(await (await f.objects.get(f.key)).text(),before);
  }
  const f=await haltedFixture();await assert.rejects(recoverBaselineHalt(f.env,{...f.expected,cursor:1},f.deps),/verified pre-D1/);
});

test('recovery preserves halt when provider baseline, ledger circuit or ownership cannot be verified',async()=>{
  for(const failure of ['provider','circuit','stale-day','ownership']) {
    const f=await haltedFixture(),before=await (await f.objects.get(f.key)).text();
    if(failure==='provider')f.deps.usage=async()=>{throw Error('Provider unavailable');};
    if(failure==='circuit')f.env.READ_BUDGET.getByName=()=>({reconcile:async input=>({day:input.day,initialized:true,usage:{charged:input.rowsRead,tripped:'reservation_exceeded'}})});
    if(failure==='stale-day')f.deps.usage=async()=>({day:'2026-10-20',rowsRead:0,rowsWritten:0});
    if(failure==='ownership')f.objects.put=async()=>null;
    await assert.rejects(recoverBaselineHalt(f.env,f.expected,f.deps));assert.equal(await (await f.objects.get(f.key)).text(),before);
  }
});
