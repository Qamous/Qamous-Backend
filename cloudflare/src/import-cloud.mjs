import {IMPORT_MANIFEST,IMPORT_ACCOUNT,IMPORT_DATABASE,IMPORT_LIMITS,CLOUD_PACKET_RESERVE,IMPORT_LEDGER_POLICY_VERSION,importQuota,importLedgerCapacity,importPolicyAt,quotaRetryAt,nextImportWindow,recoverCloudFlight,validateImportPacket} from './import-cloud-policy.mjs';
import {fetchBillingProof} from '../scripts/import-billing.mjs';
import {guardD1,READ_BUDGET_OBJECT,ReadBudgetError} from './read-budget.ts';

const encode=new TextEncoder();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encode.encode(value):value))).map(b=>b.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const prefix=env=>'jobs/'+env.IMPORT_JOB_HASH+'/';
const stateKey=env=>prefix(env)+'checkpoint.json';
export const BASELINE_HALT_REASON='A current-day, recently observed account read baseline is required';
async function boundedObject(bucket,key,max=IMPORT_LIMITS.objectBytes) {
  const object=await bucket.get(key);
  if(!object)return null;
  if(object.size>max)throw Error('Cloud object exceeds its verified bound');
  return {data:JSON.parse(await object.text()),etag:object.etag};
}
async function authorized(request,env) {
  if(!env.IMPORT_ADMIN_TOKEN)return false;
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(token.length!==env.IMPORT_ADMIN_TOKEN.length)return false;
  return crypto.subtle.timingSafeEqual(encode.encode(token),encode.encode(env.IMPORT_ADMIN_TOKEN));
}
async function saveState(env,state,etag) {
  state.updatedAt=new Date().toISOString();
  const result=await env.IMPORTS.put(stateKey(env),JSON.stringify(state),{onlyIf:{etagMatches:etag},httpMetadata:{contentType:'application/json'}});
  if(!result){const error=Error('Cloud checkpoint ownership changed');error.code='LEASE_LOST';throw error;}
  return result.etag;
}
export async function accountUsage(token,fetcher=fetch,now=new Date()) {
  const day=now.toISOString().slice(0,10);
  const response=await fetcher('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:`query {viewer {accounts(filter:{accountTag:"${IMPORT_ACCOUNT}"}) {d1AnalyticsAdaptiveGroups(limit:100,filter:{date_geq:"${day}",date_leq:"${day}"}) {sum {rowsRead rowsWritten}}}}}`}),signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=Error('Account usage HTTP '+response.status);error.code=[401,403].includes(response.status)?'BILLING_READ_REQUIRED':'RETRY_NETWORK';throw error;}
  const body=await response.json(),groups=body.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if(body.errors?.length||!Array.isArray(groups))throw Error('Account-wide quota could not be verified');
  return {day,rowsWritten:groups.reduce((n,g)=>n+g.sum.rowsWritten,0),rowsRead:groups.reduce((n,g)=>n+g.sum.rowsRead,0)};
}
async function timeTravel(token) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${IMPORT_ACCOUNT}/d1/database/${IMPORT_DATABASE}/time_travel/bookmark`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('A fresh D1 recovery bookmark could not be obtained (HTTP '+response.status+')');
  const body=await response.json();
  if(!body.success||!body.result?.bookmark)throw Error('D1 did not supply a recovery bookmark');
  return {bookmark:body.result.bookmark,createdAt:new Date().toISOString(),retention:'Workers Free: 7 days; do not restore automatically'};
}
const costs=results=>({rowsWritten:results.reduce((n,r)=>n+Number(r.meta?.rows_written||0),0),rowsRead:results.reduce((n,r)=>n+Number(r.meta?.rows_read||0),0),databaseBytes:Math.max(0,...results.map(r=>Number(r.meta?.size_after||0)))});
async function verifyIdentities(env,packet) {
  if(!packet.identities.length)return {rowsRead:0};
  const result=await env.DB.prepare('SELECT recordKey,lower(hex(fingerprint)) AS fingerprint FROM import_records WHERE recordKey IN ('+packet.identities.map(()=>'?').join(',')+')').bind(...packet.identities.map(r=>r.recordKey)).all();
  const byKey=new Map(result.results.map(r=>[r.recordKey,r.fingerprint]));
  if(packet.identities.some(r=>byKey.get(r.recordKey)!==r.fingerprint))throw Error('Live source identity differs from the reviewed packet');
  return {rowsRead:result.meta.rows_read||0};
}
async function integrity(env) {
  // Large conservative reservation, not an inference from the one returned row.
  // The guard stops further D1 work if future growth exceeds this contract.
  const result=await env.DB.prepare(`/* qamous-read:200000 */ SELECT 'duplicate_votes' AS check_name,COUNT(*) AS violations FROM (SELECT 1 FROM "definition-likes-dislikes" GROUP BY definitionId,userId HAVING COUNT(*)>1)
    UNION ALL SELECT 'self_votes',COUNT(*) FROM "definition-likes-dislikes" r JOIN definitions d ON d.id=r.definitionId WHERE r.userId=d.userId
    UNION ALL SELECT 'definition_counters',COUNT(*) FROM definitions d WHERE likeCount!=(SELECT COUNT(*) FROM "definition-likes-dislikes" WHERE definitionId=d.id AND liked=1) OR dislikeCount!=(SELECT COUNT(*) FROM "definition-likes-dislikes" WHERE definitionId=d.id AND liked=0)
    UNION ALL SELECT 'user_totals',COUNT(*) FROM users u WHERE likesReceived!=COALESCE((SELECT SUM(likeCount) FROM definitions WHERE userId=u.id),0) OR points!=COALESCE((SELECT SUM(contributionPoints+likeCount-dislikeCount) FROM definitions WHERE userId=u.id),0)
    UNION ALL SELECT 'import_passwords',COUNT(*) FROM users WHERE accountKind='import' AND password IS NOT NULL`).all();
  if(result.results.some(r=>r.violations))throw Error('Reaction, points or managed-account integrity failed');
  return {passed:true,checkedAt:new Date().toISOString(),checks:result.results,rowsRead:result.meta.rows_read||0};
}
export async function runCloudImport(env,origin='scheduled',dependencies={}) {
  env={...env,DB:guardD1(env.DB,env,{route:'import:packet-and-audit',tier:'import'})};
  const now=dependencies.now?.()||new Date(),started=now.toISOString();
  const loaded=await boundedObject(env.IMPORTS,stateKey(env),131072);
  if(!loaded)return {state:'not_armed',reason:'Stage and verify the immutable import objects first'};
  let state=loaded.data,etag=loaded.etag;
  if(state.jobHash!==env.IMPORT_JOB_HASH||state.manifestHash!==IMPORT_MANIFEST)throw Error('Cloud checkpoint identity mismatch');
  if(state.halted||state.status==='complete')return publicStatus(state);
  if(state.lease&&Date.parse(state.lease.expiresAt)>now.getTime())return {state:'busy'};
  const retryAt=quotaRetryAt(state,now),reschedule=retryAt!==state.nextAttemptAt;
  if(state.nextAttemptAt&&Date.parse(state.nextAttemptAt)>now.getTime()&&!reschedule)return publicStatus(state);
  const leaseId=crypto.randomUUID();
  state.lease={id:leaseId,expiresAt:new Date(now.getTime()+IMPORT_LIMITS.leaseMs).toISOString()};
  const claimed=await env.IMPORTS.put(stateKey(env),JSON.stringify(state),{onlyIf:{etagMatches:etag}});
  if(!claimed)return {state:'busy'};
  etag=claimed.etag;
  const persist=async()=>{etag=await saveState(env,state,etag);};
  try {
    state.ledgerPolicyVersion=IMPORT_LEDGER_POLICY_VERSION;
    if(reschedule){
      state.nextAttemptAt=retryAt;state.quotaPolicy=importPolicyAt(now);
      if(Date.parse(retryAt)>now.getTime()){delete state.lease;await persist();return publicStatus(state);}
    }
    state.lastAttemptAt=started;if(origin==='scheduled')state.lastScheduledAt=started;
    recoverCloudFlight(state,now);
    if(!env.CLOUDFLARE_READ_TOKEN){const error=Error('A persistent Billing Read, Account Analytics Read and D1 Read token is required');error.code='BILLING_READ_REQUIRED';throw error;}
    const proof=await (dependencies.billing||fetchBillingProof)(env.CLOUDFLARE_READ_TOKEN);
    if(proof.accountId!==IMPORT_ACCOUNT)throw Error('Unexpected billing account');
    const observedAt=(dependencies.now?.()||new Date()).toISOString();
    const usage=await (dependencies.usage||accountUsage)(env.CLOUDFLARE_READ_TOKEN);
    // Analytics are only an upward reconciliation signal. They never authorize
    // work: the shared coordinator makes every pre-D1 admission synchronously.
    const sharedLedger=await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reconcile({...usage,observedAt});
    const quota=importQuota(state,usage,now);
    state.days[quota.day]??={...quota.budget,initialAccountReads:usage.rowsRead};
    state.accountUsage=usage;state.effectiveWrites=quota.effectiveWrites;state.planVerifiedAt=proof.observedAt;state.quotaPolicy=quota.policy;
    if(!quota.allowed||quota.remaining<CLOUD_PACKET_RESERVE) {
      state.status='waiting_for_free_quota';state.reason='Shared Free quota reserve reached';state.nextAttemptAt=quota.nextAttemptAt;
      delete state.lease;await persist();return publicStatus(state);
    }
    const operations=2+(!state.schemaVerifiedAt?2:0)+(!state.verifiedScheduledBatch||state.lastAudit?.utcDay!==quota.day||state.cursor+1>=state.packetCount?1:0);
    const capacity=importLedgerCapacity(sharedLedger,now,operations);
    state.sharedBudget={checkedAt:observedAt,...capacity};
    if(!capacity.allowed)throw new ReadBudgetError(capacity.reason,capacity.retryAfter);
    const jobObject=await boundedObject(env.IMPORTS,prefix(env)+'job.json');
    if(!jobObject||await digest(JSON.stringify(jobObject.data))!==env.IMPORT_JOB_HASH)throw Error('Immutable job manifest mismatch');
    const job=jobObject.data;
    if(job.manifestHash!==IMPORT_MANIFEST||job.representation!==2||job.exampleAlignment!==1)throw Error('Reviewed forms and examples are required');
    if(state.cursor>=job.packetCount){
      if(!state.finalAudit){
        if(quota.effectiveReads+2000000>4500000){state.status='awaiting_final_audit';state.reason='Final integrity audit deferred to preserve shared read quota';state.nextAttemptAt=nextImportWindow(now);delete state.lease;await persist();return publicStatus(state);}
        state.finalAudit=await (dependencies.audit||integrity)(env);state.days[quota.day].rowsRead+=state.finalAudit.rowsRead||0;
      }
      state.status='complete';state.reason='All staged packets completed and final integrity verified';delete state.lease;await persist();return publicStatus(state);
    }
    const pageIndex=Math.floor(state.cursor/job.packetsPerPage),pageObject=await env.IMPORTS.get(prefix(env)+'pages/'+String(pageIndex).padStart(6,'0')+'.json');
    if(!pageObject||pageObject.size>IMPORT_LIMITS.objectBytes)throw Error('Staged page missing or too large');
    const bytes=await pageObject.arrayBuffer();
    if(await digest(bytes)!==job.pages[pageIndex].sha256)throw Error('Staged page checksum mismatch');
    const page=JSON.parse(new TextDecoder().decode(bytes)),packet=page.packets[state.cursor%job.packetsPerPage];
    validateImportPacket(packet,state.cursor);
    // These migrations were already reviewed and applied by the laptop runner.
    // A cloud tick never migrates schema or installs new import accounts.
    if(!state.schemaVerifiedAt) {
      const schema=await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all();
      if(job.migrations.some(name=>!schema.results.some(row=>row.name===name)))throw Error('Reviewed production schema is missing');
      const batch=await env.DB.prepare('SELECT manifestHash FROM import_batches WHERE id=?').bind(job.batchId).first();
      if(batch?.manifestHash!==IMPORT_MANIFEST)throw Error('Live import batch does not match');
      state.schemaVerifiedAt=started;state.days[quota.day].rowsRead+=schema.meta.rows_read||0;
    }
    if(state.databaseBytes>IMPORT_LIMITS.databaseBytes)throw Error('Free database storage headroom reached');
    if(!state.recoveryPoint||state.recoveryPoint.createdAt.slice(0,10)!==quota.day)state.recoveryPoint=await (dependencies.backup||timeTravel)(env.CLOUDFLARE_READ_TOKEN);
    const beforeWrite=dependencies.now?.()||new Date();
    if(beforeWrite.toISOString().slice(0,10)!==quota.day||beforeWrite.getUTCHours()===23&&beforeWrite.getUTCMinutes()>=55) {
      state.status='waiting_for_free_quota';state.reason='Waiting for the next import window';state.nextAttemptAt=nextImportWindow(beforeWrite);delete state.lease;await persist();return publicStatus(state);
    }
    // Persist the reservation BEFORE submitting SQL. An isolate crash, lost
    // response or expired lease replays this exact insert-only transaction.
    state.inFlight={index:state.cursor,sha256:await digest(JSON.stringify(packet)),startedAt:started,origin,reservedWrites:CLOUD_PACKET_RESERVE};
    state.status='publishing';state.reason='Applying a bounded reviewed packet';state.nextAttemptAt=null;
    await persist();
    // The validated immutable packet remains one atomic transaction. Reserve
    // 200k reads for its <=32 statements / <=90k SQL bytes (well above observed
    // packet costs), and persist an overrun circuit if that expectation changes.
    const perStatement=Math.floor(200000/packet.statements.length);
    const results=await env.DB.batch(packet.statements.map(sql=>env.DB.prepare(`/* qamous-read:${perStatement} */ `+sql)));
    if(results.some(r=>r.success===false))throw Error('D1 transaction failed');
    const measured=costs(results);
    if(![measured.rowsWritten,measured.rowsRead,measured.databaseBytes].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('D1 metrics are unavailable');
    // Commit the known cost with its receipt before any subsequent read can
    // fail. A crash before this persist retains the old conservative reserve;
    // a crash after it cannot bill the same successful batch twice.
    const packetDay=state.days[quota.day];packetDay.rowsWritten+=measured.rowsWritten;packetDay.rowsRead+=measured.rowsRead;
    state.inFlight.measurement={...measured,charged:true};
    state.lastMeasuredPacket={index:packet.index,...measured,measuredAt:new Date().toISOString()};
    state.databaseBytes=measured.databaseBytes||state.databaseBytes;
    await persist();
    if(measured.rowsWritten>CLOUD_PACKET_RESERVE||state.databaseBytes>IMPORT_LIMITS.databaseBytes)throw Error('Measured packet cost or storage exceeded its rehearsed bound');
    const identities=await verifyIdentities(env,packet);
    // The first scheduled packet which completes records must also pass a full
    // points/counter audit before the laptop is allowed to disable its task.
    let audit;
    const firstProof=origin==='scheduled'&&!state.verifiedScheduledBatch&&packet.completed.length&&measured.rowsWritten>0;
    const finalPacket=state.cursor+1===job.packetCount;
    if((firstProof||state.lastAudit?.utcDay!==quota.day||finalPacket)&&quota.effectiveReads+measured.rowsRead+identities.rowsRead+2000000<=4500000) {
      audit=await (dependencies.audit||integrity)(env);state.lastAudit={...audit,utcDay:quota.day};
      if(finalPacket)state.finalAudit=audit;
    }
    const day=state.days[quota.day];day.rowsRead+=identities.rowsRead+(audit?.rowsRead||0);
    state.cursor++;state.completedRecords+=packet.completed.length;state.databaseBytes=measured.databaseBytes||state.databaseBytes;
    state.lastSuccessAt=new Date().toISOString();state.consecutiveFailures=0;
    state.lastPacket={index:packet.index,sha256:state.inFlight.sha256,origin,recordsCompleted:packet.completed.length,...measured,completedAt:state.lastSuccessAt};
    if(audit&&firstProof)state.verifiedScheduledBatch={...state.lastPacket,jobHash:state.jobHash,integrityPassed:true,audit};
    delete state.inFlight;delete state.lease;
    state.status=state.cursor===job.packetCount?(state.finalAudit?'complete':'awaiting_final_audit'):'active';state.reason=state.status==='complete'?'All staged packets completed and final integrity verified':state.status==='awaiting_final_audit'?'Waiting for final integrity verification':'Waiting for the next cloud minute';
    if(measured.rowsWritten>CLOUD_PACKET_RESERVE||state.databaseBytes>IMPORT_LIMITS.databaseBytes){state.halted=true;state.status='halted';state.reason='Measured packet cost or storage exceeded its rehearsed bound';}
    await persist();
    console.log(JSON.stringify({event:'qamous_import_packet',...publicStatus(state)}));
    return publicStatus(state);
  } catch(error) {
    if(error.code==='LEASE_LOST')return {state:'lease_lost',reason:'Another invocation owns the checkpoint; no further writes submitted'};
    const message=String(error.message||error).slice(0,500);
    // The guard supplies this evidence only before raw D1 submission. Preserve
    // every genuinely unknown batch and every already measured receipt.
    if(error instanceof ReadBudgetError&&error.sqlSubmitted===false&&state.inFlight&&!state.inFlight.measurement) {
      state.lastNotSubmitted={index:state.inFlight.index,reason:error.reason,checkedAt:new Date().toISOString()};
      delete state.inFlight;
    }
    const quota=error.code==='D1_READ_BUDGET'||/D1.*(exceeded|quota|daily limit)|(exceeded|quota|daily limit).*D1/i.test(message);
    const briefBudgetHold=error.code==='D1_READ_BUDGET'&&['burn_rate','concurrency','import_concurrency','coordinator_unavailable'].includes(error.reason);
    const access=error.code==='BILLING_READ_REQUIRED';
    const retry=message===BASELINE_HALT_REASON||error.code==='RETRY_NETWORK'||/network|fetch failed|timed? ?out|temporar|overloaded|internal error|try again|database (busy|locked)|429|50[0234]/i.test(message);
    state.consecutiveFailures=(state.consecutiveFailures||0)+1;
    state.status=quota?'waiting_for_free_quota':access?'needs_access':retry?'retry_pending':'halted';state.halted=!quota&&!access&&!retry;
    state.reason=message;state.lastAttemptAt=started;
    state.nextAttemptAt=briefBudgetHold?new Date(now.getTime()+Math.max(60,error.retryAfter||60)*1000).toISOString():quota?nextImportWindow(now):state.halted?null:new Date(now.getTime()+(access?360:Math.min(360,15*2**Math.min(5,state.consecutiveFailures-1)))*60000).toISOString();
    delete state.lease;
    try{await persist();}catch(saveError){if(saveError.code!=='LEASE_LOST')throw saveError;}
    console.log(JSON.stringify({event:'qamous_import_wait',...publicStatus(state)}));
    return publicStatus(state);
  }
}
export async function recoverBaselineHalt(env,expected,dependencies={}) {
  const loaded=await boundedObject(env.IMPORTS,stateKey(env),131072);
  if(!loaded)throw Error('Existing checkpoint is required');
  const state=loaded.data;
  if(!expected||state.jobHash!==env.IMPORT_JOB_HASH||state.manifestHash!==IMPORT_MANIFEST
    ||['jobHash','manifestHash','cursor','completedRecords','lastAttemptAt'].some(key=>expected[key]!==state[key])
    ||!state.halted||state.status!=='halted'||state.reason!==BASELINE_HALT_REASON||state.inFlight||state.lease)
    throw Error('Checkpoint is not the verified pre-D1 baseline halt');
  if(!env.CLOUDFLARE_READ_TOKEN)throw Error('Existing account read credential is required');
  const now=dependencies.now?.()||new Date(),observedAt=now.toISOString();
  const proof=await (dependencies.billing||fetchBillingProof)(env.CLOUDFLARE_READ_TOKEN);
  if(proof.accountId!==IMPORT_ACCOUNT)throw Error('Unexpected billing account');
  const usage=await (dependencies.usage||accountUsage)(env.CLOUDFLARE_READ_TOKEN);
  const reconciled=await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reconcile({...usage,observedAt});
  if(usage.day!==observedAt.slice(0,10)||reconciled?.day!==usage.day||!reconciled.initialized||!reconciled.usage
    ||reconciled.usage.tripped||reconciled.usage.charged<usage.rowsRead)
    throw Error('Fresh baseline did not verify an operational read ledger');
  state.baselineRecovery={recoveredAt:observedAt,previousReason:state.reason,previousAttemptAt:state.lastAttemptAt,accountUsage:usage};
  state.halted=false;state.status='retry_pending';state.reason='Fresh account baseline verified; awaiting guarded import tick';state.nextAttemptAt=observedAt;
  await saveState(env,state,loaded.etag);
  return publicStatus(state);
}

export function publicStatus(state) {
  return {state:state.status,jobHash:state.jobHash,manifestHash:state.manifestHash,reason:state.reason,cursor:state.cursor,packetCount:state.packetCount,completedRecords:state.completedRecords,totalRecords:state.totalRecords,databaseBytes:state.databaseBytes,days:state.days,effectiveWrites:state.effectiveWrites,accountUsage:state.accountUsage,quotaPolicy:state.quotaPolicy||importPolicyAt(),ledgerPolicyVersion:state.ledgerPolicyVersion,nextAttemptAt:state.nextAttemptAt,lastAttemptAt:state.lastAttemptAt,lastScheduledAt:state.lastScheduledAt,lastSuccessAt:state.lastSuccessAt,verifiedScheduledBatch:state.verifiedScheduledBatch,lastPacket:state.lastPacket,lastMeasuredPacket:state.lastMeasuredPacket,lastNotSubmitted:state.lastNotSubmitted,sharedBudget:state.sharedBudget,inFlight:Boolean(state.inFlight),recoveredPackets:state.recoveredPackets||0,halted:Boolean(state.halted),updatedAt:state.updatedAt};
}
// Each packet is admitted, checkpointed and verified independently. Stop on
// any hold or failure and leave time before the next cron invocation.
export async function runScheduledImports(env,run=runCloudImport,clock=Date.now) {
  const deadline=clock()+45000;
  let result;
  for(let i=0;i<3&&clock()<deadline;i++) {
    result=await run(env,'scheduled');
    if(result.state!=='active')break;
  }
  return result;
}
export default {
  async scheduled(controller,env,ctx) {ctx.waitUntil(runCloudImport(env,'scheduled'));},
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return json({service:'qamous-import',version:1,configured:/^[a-f0-9]{64}$/.test(env.IMPORT_JOB_HASH)});
    if(!await authorized(request,env))return json({error:'Unauthorized'},401);
    if(url.pathname==='/status'&&request.method==='GET') {const state=await boundedObject(env.IMPORTS,stateKey(env),131072);return json(state?publicStatus(state.data):{state:'not_armed'});}
    if(url.pathname==='/tick'&&request.method==='POST')return json(await runCloudImport(env,'manual'));
    if(url.pathname.startsWith('/stage/')&&['PUT','HEAD'].includes(request.method)) {
      const relative=url.pathname.slice(7);
      if(!/^(job\.json|pages\/\d{6}\.json)$/.test(relative))return json({error:'Invalid stage key'},400);
      const key=prefix(env)+relative;
      if(request.method==='HEAD'){const object=await env.IMPORTS.head(key);return new Response(null,{status:object?200:404,headers:object?{'X-Object-Sha256':object.customMetadata?.sha256||'','Content-Length':String(object.size)}:{}});}
      const size=Number(request.headers.get('Content-Length')),sha256=request.headers.get('X-Object-Sha256');
      if(!Number.isSafeInteger(size)||size<1||size>IMPORT_LIMITS.objectBytes||!/^[a-f0-9]{64}$/.test(sha256||''))return json({error:'Bounded length and checksum required'},400);
      const existing=await env.IMPORTS.head(key);
      if(existing)return json({staged:existing.customMetadata?.sha256===sha256,sha256:existing.customMetadata?.sha256},existing.customMetadata?.sha256===sha256?200:409);
      const value=await env.IMPORTS.put(key,request.body,{onlyIf:{etagDoesNotMatch:'*'},sha256,customMetadata:{sha256},httpMetadata:{contentType:'application/json'},storageClass:'Standard'});
      return json({staged:Boolean(value),sha256},value?201:409);
    }
    return json({error:'Not found'},404);
  }
};
