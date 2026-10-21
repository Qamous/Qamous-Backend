// Shared, dependency-free policy for the private Cloudflare importer.
export const IMPORT_MANIFEST = '01803ed809c2b402278c68f15d66166f4268e137adf65231088d8a07e397c669';
export const IMPORT_ACCOUNT = '39292a971f28b413619657e9f2c77003';
export const IMPORT_DATABASE = 'd0587244-4f3d-4209-b246-55cefbce7555';
export const IMPORT_LIMITS = Object.freeze({dailyImportWrites:75000, accountWrites:80000, packetReserve:5000, dailyReads:3900000, databaseBytes:450000000, statements:32, packetBytes:90000, objectBytes:1048576, leaseMs:20*60*1000});
// Full replay exposed occasional FTS maintenance bursts above the ordinary
// 5k packet margin. Retain the 10k in-flight allowance in both quota windows.
export const CLOUD_PACKET_RESERVE = 10000;
export const LATE_CATCHUP = Object.freeze({startHourUTC:22, endMinuteUTC:23*60+55, targetWrites:95000});
export function importPolicyAt(now=new Date()) {
  const minute=now.getUTCHours()*60+now.getUTCMinutes();
  const late=minute>=LATE_CATCHUP.startHourUTC*60&&minute<LATE_CATCHUP.endMinuteUTC;
  return {version:'late-catchup-v1',phase:late?'late_catchup':'daytime',dailyImportWriteCeiling:late?LATE_CATCHUP.targetWrites:IMPORT_LIMITS.dailyImportWrites,accountWriteCeiling:late?LATE_CATCHUP.targetWrites:IMPORT_LIMITS.accountWrites,packetReserve:CLOUD_PACKET_RESERVE,lateCatchupTarget:LATE_CATCHUP.targetWrites,windowUTC:'22:00–23:55'};
}
export const nextImportDay = now => {
  const date = new Date(now); date.setUTCHours(0,15,0,0);
  if (date.getTime() <= new Date(now).getTime()) date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString();
};
export function nextQuotaOpportunity(now=new Date()) {
  const lateStart=new Date(now);lateStart.setUTCHours(LATE_CATCHUP.startHourUTC,0,0,0);
  if(now<lateStart)return lateStart.toISOString();
  return nextImportDay(now);
}
// Upgrade old quota checkpoints to the new same-day window. Never shorten
// network/auth retries, integrity holds, final-audit waits or uncertain writes.
export function quotaRetryAt(state,now=new Date()) {
  const saved=state.nextAttemptAt,last=Date.parse(state.lastAttemptAt);
  if(state.status!=='waiting_for_free_quota'||state.reason!=='Shared Free quota reserve reached'||state.inFlight||!Number.isFinite(Date.parse(saved))||!Number.isFinite(last)||last>now.getTime())return saved;
  const candidate=nextQuotaOpportunity(new Date(last));
  return Date.parse(candidate)<Date.parse(saved)?candidate:saved;
}
export function importQuota(state, usage, now = new Date()) {
  const day=now.toISOString().slice(0,10);
  if(usage.day!==day || ![usage.rowsWritten,usage.rowsRead].every(n=>Number.isSafeInteger(n)&&n>=0)) throw Error('Fresh account-wide usage is required');
  const budget=state.days[day]??{initialAccountWrites:usage.rowsWritten,rowsWritten:0,rowsRead:0};
  const effectiveWrites=Math.max(usage.rowsWritten,budget.initialAccountWrites+budget.rowsWritten+(budget.maintenanceWritesReserve||0));
  const effectiveReads=Math.max(usage.rowsRead,(budget.initialAccountReads||0)+budget.rowsRead);
  const policy=importPolicyAt(now);
  const remaining=Math.min(policy.dailyImportWriteCeiling-budget.rowsWritten,policy.accountWriteCeiling-effectiveWrites);
  const settling=now.getUTCHours()===0&&now.getUTCMinutes()<15;
  const approachingReset=now.getUTCHours()===23&&now.getUTCMinutes()>=55;
  return {allowed:!settling&&!approachingReset&&remaining>=IMPORT_LIMITS.packetReserve&&effectiveReads<IMPORT_LIMITS.dailyReads,day,budget,effectiveWrites,effectiveReads,remaining,policy,nextAttemptAt:settling?new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),0,15)).toISOString():nextQuotaOpportunity(now)};
}
export function validateImportPacket(packet,index) {
  if(packet.index!==index||!Array.isArray(packet.statements)||!packet.statements.length||packet.statements.length>IMPORT_LIMITS.statements) throw Error('Invalid packet bounds');
  const allowed=new Set(['words','import_records','countries','definitions','definition_provenance','definition_examples','import_pronunciations','word_spellings']);
  for(const sql of packet.statements) {
    const table=typeof sql==='string'&&/^INSERT OR IGNORE INTO "([a-z_]+)"\(/.exec(sql)?.[1];
    if(!allowed.has(table))throw Error('Only the reviewed insert-only packet format is allowed');
  }
  if(new TextEncoder().encode(JSON.stringify(packet)).length>IMPORT_LIMITS.packetBytes)throw Error('Packet exceeds the Free execution bound');
  if(!Array.isArray(packet.completed)||!Array.isArray(packet.identities)||!packet.identities.every(r=>Number.isSafeInteger(r.recordKey)&&/^[a-f0-9]+$/.test(r.fingerprint)))throw Error('Packet provenance identities are missing');
}
export function recoverCloudFlight(state,now = new Date()) {
  if(!state.inFlight)return false;
  const flight=state.inFlight;
  if(flight.index!==state.cursor||!/^\d{4}-\d{2}-\d{2}T/.test(flight.startedAt)||!state.days[flight.startedAt.slice(0,10)])throw Error('Unrecognized interrupted cloud packet');
  // A failed response may hide a committed transaction. Charge once on its
  // original UTC day; replay only INSERT OR IGNORE, never points/vote mutations.
  const reserve=flight.reservedWrites??IMPORT_LIMITS.packetReserve;
  if(!Number.isSafeInteger(reserve)||reserve<IMPORT_LIMITS.packetReserve||reserve>CLOUD_PACKET_RESERVE)throw Error('Unrecognized interrupted write reservation');
  state.days[flight.startedAt.slice(0,10)].rowsWritten+=reserve;
  state.recoveredPackets=(state.recoveredPackets||0)+1;
  state.lastRecovery={...flight,reconciledAt:now.toISOString(),reservedWrites:reserve};
  delete state.inFlight;return true;
}
export function cloudHandoffDecision(config,status) {
  if(!config?.armed)return {action:'local'};
  if(!status||status.jobHash!==config.jobHash||status.manifestHash!==IMPORT_MANIFEST)return {action:'wait',reason:'Cloud handoff status could not be verified; local publication is fenced'};
  const proof=status.verifiedScheduledBatch;
  if(proof?.origin==='scheduled'&&proof.rowsWritten>0&&proof.recordsCompleted>0&&proof.integrityPassed===true&&proof.jobHash===config.jobHash)return {action:'disable',reason:'A scheduled cloud batch has completed and passed integrity checks'};
  return {action:'wait',reason:status.reason||'Waiting for the first verified scheduled cloud batch'};
}
