// Reviewed one-time read-model installation. Never unpauses a writer, exports
// private data, resets counters, retries an unknown SQL write or prints tokens.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {verifyFreePlan,ACCOUNT_ID,validateImportPause} from './free-plan-guard.mjs';
import {validatePublicSeed} from '../src/public-cache-keys.ts';

const root=fileURLToPath(new URL('..',import.meta.url)),cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const approvedUrl='https://qamous-import.anthonyyoussef01.workers.dev',migration='0009_prepared_public_cards.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function assertOnlyPreparedMigration(output) {
  const pending=[...new Set(String(output).match(/\b\d{4}_[a-z0-9_]+\.sql\b/g)||[])];
  if(pending.length!==1||pending[0]!==migration)throw Error('Refusing migration: the only pending migration must be '+migration);
  return pending;
}
export function preparedSeedBatches(cards) {
  const batches=[];let batch=[];
  for(const card of cards) {
    const next=[...batch,card];
    if(next.length>10||Buffer.byteLength(JSON.stringify({cards:next}))>160_000){if(!batch.length)throw Error('Prepared card exceeds its maintenance batch size');batches.push(batch);batch=[card];}
    else batch=next;
    if(Buffer.byteLength(JSON.stringify({cards:batch}))>160_000)throw Error('Prepared card exceeds its maintenance batch size');
  }
  if(batch.length)batches.push(batch);return batches;
}
export async function auditedPreparedSnapshot(manifestFile,now=Date.now()) {
  const directory=resolve(manifestFile,'..'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  const start=Date.parse(manifest.exportStartedAt),end=Date.parse(manifest.exportCompletedAt),generated=Date.parse(manifest.generatedAt);
  const allowed=['schemaVersion','snapshotId','generatedAt','sourceExportedAt','exportStartedAt','exportCompletedAt','expiresAt','resources','skipped','counts'];
  if(Object.keys(manifest).some(key=>!allowed.includes(key))||manifest.schemaVersion!==1||!/^[a-f0-9]{16}$/.test(manifest.snapshotId)||!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(generated)||start>end||end>generated||generated>now+5000||now-end>2*60*60_000||manifest.sourceExportedAt!==manifest.exportCompletedAt||Date.parse(manifest.expiresAt)!==end+86400000||!Array.isArray(manifest.resources)||manifest.resources.length>50_000||manifest.counts?.resources!==manifest.resources.length||!Number.isSafeInteger(manifest.counts?.publicDefinitions)||manifest.counts.publicDefinitions<1)throw Error('A fresh audited public snapshot with original export timestamps is required');
  const cards=new Map(),feed=new Set(),keys=new Set();
  for(const entry of manifest.resources) {
    if(typeof entry?.key!=='string'||keys.has(entry.key))throw Error('Duplicate or invalid public snapshot key');keys.add(entry.key);
    if(Object.keys(entry).some(key=>!['key','file','bytes','sha256'].includes(key))||entry.file!==hash(entry.key)+'.json'||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>16_000_000)throw Error('Invalid public snapshot file identity');
    const text=await readFile(join(directory,entry.file),'utf8');
    if(Buffer.byteLength(text)!==entry.bytes||hash(text)!==entry.sha256)throw Error('Public snapshot checksum or size differs');
    const payload=JSON.parse(text);if(payload.key!==entry.key||Object.keys(payload).sort().join(',')!=='key,value')throw Error('Public snapshot key differs');
    const validationKey=payload.key==='discovery'?'word:1':/^(?:contributor|license):/.test(payload.key)?'sources':payload.key;
    validatePublicSeed(validationKey,payload.value);
    const audit=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(/sourceFiles|originalMetadata|payloadHash/i.test(key))throw Error('Private snapshot field');audit(child);}};audit(payload.value);
    if(!/^cards:\d+$/.test(entry.key)&&!/^feed:[01]$/.test(entry.key))continue;
    for(const row of payload.value) {
      const id=Number(row.definitionId??row.id);
      if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid snapshot definition identity');
      if(entry.key.startsWith('feed:')){if(feed.has(id))throw Error('Duplicate feed candidate');feed.add(id);continue;}
      if(Math.floor(id/100)!==Number(entry.key.slice(6))||cards.has(id))throw Error('Duplicate or incorrectly bucketed public card');
      if(Buffer.byteLength(JSON.stringify(row))>128_000)throw Error('Prepared public card exceeds its reviewed row size');
      cards.set(id,row);
    }
  }
  if(!keys.has('feed:0')||!keys.has('feed:1')||cards.size!==manifest.counts.publicDefinitions||!feed.size||[...feed].some(id=>!cards.has(id)))throw Error('Public snapshot does not completely cover both feeds and visible definitions');
  return {cards:[...cards.values()].sort((a,b)=>Number(a.definitionId??a.id)-Number(b.definitionId??b.id)),feedCandidates:feed.size,exportCompletedAt:manifest.exportCompletedAt,snapshotId:manifest.snapshotId};
}
function command(args) {
  const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,CI:'true',CLOUDFLARE_ACCOUNT_ID:ACCOUNT_ID}});
  if(result.status!==0)throw Error('Reviewed Wrangler operation failed; inspect its local log before retrying');
  return result.stdout;
}
async function maintenanceAccess() {
  const apiConfig=await verifyFreePlan();if(apiConfig.vars.PUBLIC_READ_ONLY!=='true')throw Error('The API source configuration must remain paused');
  const config=JSON.parse(await readFile(new URL('../wrangler.import-cloud.jsonc',import.meta.url),'utf8'));
  if(config.account_id!==ACCOUNT_ID||config.name!=='qamous-import'||!validateImportPause(config))throw Error('The importer must remain explicitly paused');
  const access=JSON.parse(await readFile(new URL('../private/cloud-import/access.json',import.meta.url),'utf8'));
  if(access.url!==approvedUrl||typeof access.adminToken!=='string'||access.adminToken.length<32||access.jobHash!==config.vars.IMPORT_JOB_HASH)throw Error('Verified importer maintenance access is required');
  const auth=JSON.parse(command(['auth','token','--json']));if(typeof auth.token!=='string'||!auth.token)throw Error('Existing Wrangler authentication is required');
  for(const worker of ['qamous-api','qamous-import']) {
    const reply=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT_ID+'/workers/scripts/'+worker+'/settings',{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(20_000)});
    const body=await reply.json(),bindings=body.result?.bindings;
    if(!reply.ok||body.success!==true||!Array.isArray(bindings)||bindings.find(b=>b.name==='PUBLIC_READ_ONLY')?.text!=='true'||bindings.find(b=>b.name==='DB')?.id!=='d0587244-4f3d-4209-b246-55cefbce7555'&&bindings.find(b=>b.name==='DB')?.database_id!=='d0587244-4f3d-4209-b246-55cefbce7555')throw Error('Both live database writers must remain paused on the approved database');
  }
  const schedulesReply=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT_ID+'/workers/scripts/qamous-import/schedules',{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(20_000)});
  const schedules=await schedulesReply.json();if(!schedulesReply.ok||schedules.success!==true||!Array.isArray(schedules.result?.schedules)||schedules.result.schedules.length)throw Error('Live importer schedules must remain stopped');
  return access;
}
async function call(access,path,body) {
  const reply=await fetch(access.url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access.adminToken,'Content-Type':'application/json','Connection':'close'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60_000)});
  if(!reply.ok)throw Error('Prepared maintenance failed at '+path+' (HTTP '+reply.status+'); inspect before retrying');
  return reply.json();
}
export async function main(args=process.argv.slice(2)) {
  if(args.length!==1&&args.length!==2||!['migrate','seed'].includes(args[0])||args[0]==='seed'&&args.length!==2||args[0]==='migrate'&&args.length!==1)throw Error('Use: node scripts/prepared-cards-maintenance.mjs migrate | seed <private-manifest.json>');
  // Audit all public card inputs before requesting maintenance or writing rows.
  const snapshot=args[0]==='seed'?await auditedPreparedSnapshot(resolve(args[1])):null;
  const access=await maintenanceAccess();
  const reports=new URL('../private/cloud-import/',import.meta.url);await mkdir(reports,{recursive:true});
  if(args[0]==='migrate') {
    const id=randomUUID(),admission=await call(access,'/prepared-cards/maintenance-budget',{id,operation:'migration-0009'});
    if(!admission.allowed)throw Error('Migration was not submitted: '+admission.reason);
    const reportFile=new URL('prepared-card-migration-'+id+'.json',reports);
    const report={migration,admittedAt:new Date().toISOString(),reservation:id,reservedRows:250000,conservativeChargeRetained:true,writersPaused:true,phase:'admitted'};
    await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
    assertOnlyPreparedMigration(command(['d1','migrations','list','qamous','--remote']));
    report.phase='submitting';await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
    // No retry and no settlement/refund: migrations apply does not provide
    // sufficiently complete measured read metadata for the whole command.
    command(['d1','migrations','apply','qamous','--remote']);
    report.completedAt=new Date().toISOString();report.phase='completed';await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
    await writeFile(new URL('prepared-card-migration.json',reports),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...report,next:'Wait at least 60 seconds for the admission lease, then run seed against a fresh audited snapshot.'}));return report;
  }
  const before=await call(access,'/prepared-cards/status');
  if(before.eligibleCards!==snapshot.cards.length||before.feedCandidates!==snapshot.feedCandidates)throw Error('Live database and the audited snapshot differ; no card seed was submitted');
  let submitted=0;const batches=preparedSeedBatches(snapshot.cards);
  for(const cards of batches){const result=await call(access,'/prepared-cards/seed',{cards});if(!Number.isSafeInteger(result.stored)||result.stored<0||result.stored>cards.length)throw Error('Prepared seed acknowledgement is invalid');submitted+=cards.length;console.log(JSON.stringify({submitted,total:snapshot.cards.length}));}
  const after=await call(access,'/prepared-cards/status');
  if(after.preparedCards!==snapshot.cards.length||after.eligibleCards!==snapshot.cards.length||after.missingPayloads!==0||after.feedCandidates!==snapshot.feedCandidates)throw Error('Prepared-card backfill is incomplete; keep writers paused');
  const report={completedAt:new Date().toISOString(),snapshotExportCompletedAt:snapshot.exportCompletedAt,snapshotId:snapshot.snapshotId,cards:submitted,batches:batches.length,before,after,writersPaused:true};
  await writeFile(new URL('prepared-card-seed.json',reports),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
