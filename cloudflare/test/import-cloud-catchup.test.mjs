import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {IMPORT_ACCOUNT,IMPORT_MANIFEST,CLOUD_PACKET_RESERVE,importPolicyAt,importQuota,quotaRetryAt,recoverCloudFlight} from '../src/import-cloud-policy.mjs';
import {runCloudImport} from '../src/import-cloud.mjs';

const at=time=>new Date('2026-10-21T'+time+'Z');
const state=writes=>({days:{'2026-10-21':{initialAccountWrites:0,rowsWritten:writes,rowsRead:0}}});
const usage=writes=>({day:'2026-10-21',rowsWritten:writes,rowsRead:100});
const waiting={status:'waiting_for_free_quota',reason:'Shared Free quota reserve reached',lastAttemptAt:'2026-10-21T04:24:07Z',nextAttemptAt:'2026-10-22T00:15:00.000Z'};

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
  const env={IMPORTS:objects,IMPORT_JOB_HASH:jobHash,CLOUDFLARE_READ_TOKEN:'synthetic',DB:{prepare:sql=>({sql}),batch:async()=>{batches++;return [{success:true,meta:{rows_written:300,rows_read:10,size_after:1000}}];}}};
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
