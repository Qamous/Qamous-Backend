// Update only the existing hosted importer. Never stage new data or migrate D1.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateProof,validateImportPause,ACCOUNT_ID} from './free-plan-guard.mjs';
import {verifyPublicSnapshotUnpause} from './public-snapshot-deploy-guard.mjs';
import {validateLiveImportState,validateImportApiReady} from './import-deploy-transition.mjs';
import {importDeploymentArgs,verifyImportDeploymentFlags} from './import-deploy-variables.mjs';
import {IMPORT_DATABASE,IMPORT_MANIFEST} from '../src/import-cloud-policy.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const privateRoot=new URL('../private/cloud-import/',import.meta.url);
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const configPath=fileURLToPath(new URL('../wrangler.import-cloud.jsonc',import.meta.url));
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
function command(args,input){
  const r=spawnSync(process.execPath,[cli,...args],{cwd:root,input,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  if(r.status!==0)throw Error('Wrangler operation failed: '+String(r.stderr||r.stdout).replace(/Bearer\s+\S+/g,'Bearer [withheld]').slice(-1500));
  return r.stdout;
}
const mode=process.argv[2];if(!['--deploy','--recover-monitor'].includes(mode)||process.argv.length!==3)throw Error('Use --deploy or --recover-monitor explicitly');
const proof=await readJson(new URL('../private/billing-proof.json',import.meta.url));validateProof(proof);
const config=await readJson(configPath);
const deployArgs=importDeploymentArgs(configPath,config.vars);
const paused=validateImportPause(config);
await verifyPublicSnapshotUnpause(config);
if(config.name!=='qamous-import'||config.account_id!==ACCOUNT_ID||config.main!=='src/import-host.mjs'||config.d1_databases?.length!==1||config.d1_databases[0].database_id!==IMPORT_DATABASE||config.durable_objects?.bindings?.length!==3||config.durable_objects.bindings[0].class_name!=='QamousImportState'||config.durable_objects.bindings[1].name!=='READ_BUDGET'||config.durable_objects.bindings[1].class_name!=='QamousReadBudget'||config.durable_objects.bindings[1].script_name!=='qamous-api'||config.durable_objects.bindings[2].name!=='PUBLIC_CACHE'||config.durable_objects.bindings[2].class_name!=='QamousPublicCache'||config.durable_objects.bindings[2].script_name!=='qamous-api'||config.migrations?.length!==1||config.migrations[0].tag!=='v1'||JSON.stringify(config.migrations[0].new_sqlite_classes)!=='["QamousImportState"]'||config.preview_urls!==false||config.workers_dev!==true||config.routes?.length||['ai','r2_buckets','assets','kv_namespaces','queues','workflows','vectorize','hyperdrive','containers','pipelines'].some(key=>config[key]))throw Error('Importer configuration exceeds its approved resources');
const auth=JSON.parse(command(['auth','token','--json']));if(!auth.token)throw Error('Existing Wrangler authentication required');
const base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT_ID+'/workers/scripts/qamous-import';
async function platform(path,script='qamous-import'){const r=await fetch(base.replace(/qamous-import$/,script)+path,{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(20000)});const b=await r.json();if(!r.ok||!b.success)throw Error('Live Worker inspection failed: '+r.status);return b.result;}
const settings=await platform('/settings'),schedules=await platform('/schedules');
validateLiveImportState(settings,schedules);
if(!paused)validateImportApiReady(await platform('/settings','qamous-api'));
if(settings.bindings.find(b=>b.name==='IMPORT_JOB_HASH')?.text!==config.vars.IMPORT_JOB_HASH||settings.bindings.find(b=>b.name==='DB')?.database_id!==IMPORT_DATABASE||settings.bindings.find(b=>b.name==='COORDINATOR')?.namespace_id!=='26a3dafb50294f63b391fb4d1f478fdb')throw Error('Existing deployment identity changed; inspect before updating');
const accessFile=new URL('access.json',privateRoot);let access;
try{access=await readJson(accessFile);}catch(error){if(error.code!=='ENOENT')throw error;}
if(mode==='--recover-monitor'){
  if(access)throw Error('A local monitoring credential already exists; do not rotate it unnecessarily');
  await mkdir(privateRoot,{recursive:true});
  access={adminToken:randomBytes(32).toString('hex'),url:'https://qamous-import.anthonyyoussef01.workers.dev',jobHash:config.vars.IMPORT_JOB_HASH,armed:true,recoveredAt:new Date().toISOString()};
  // Save before upload so a lost acknowledgement never loses the new value.
  await writeFile(accessFile,JSON.stringify(access,null,2)+'\n');
  command(['secret','bulk','--config',configPath],JSON.stringify({IMPORT_ADMIN_TOKEN:access.adminToken}));
  console.log(JSON.stringify({monitorRecovered:true,readOnlyWorkerSecretPreserved:true}));
}else{
  if(!access||access.jobHash!==config.vars.IMPORT_JOB_HASH)throw Error('Recover the private monitoring credential before deployment');
  if(paused) {
    // The DO may already be out of writes. A pause-only release needs no DO
    // status read: identity is verified above and it changes no stored job data.
    await writeFile(new URL('pre-snapshot-pause-deployment.json',privateRoot),JSON.stringify({verifiedAt:new Date().toISOString(),settings,deployments:await platform('/deployments')},null,2)+'\n');
    console.log(command([...deployArgs,'--dry-run']));
    console.log(command(deployArgs));
    const afterSettings=await platform('/settings');validateImportPause(config,(await platform('/schedules')).schedules);
    verifyImportDeploymentFlags(afterSettings,config.vars);
    if(afterSettings.bindings.find(b=>b.name==='PUBLIC_READ_ONLY')?.text!=='true')throw Error('Importer pause was not published');
    const check=await fetch(access.url+'/tick',{method:'POST',headers:{Authorization:'Bearer '+access.adminToken},signal:AbortSignal.timeout(20000)});
    if(check.status!==503||(await check.json()).code!=='PUBLIC_READ_ONLY')throw Error('Paused importer still permits dynamic operations');
    const report={publishedAt:new Date().toISOString(),paused:true,deployments:await platform('/deployments'),plan:proof.plan,paidFallback:false};
    await writeFile(new URL('snapshot-pause-deployment.json',privateRoot),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({published:true,paused:true,scheduled:false}));
  }else{
  const status=async()=>{const r=await fetch(access.url+'/status',{headers:{Authorization:'Bearer '+access.adminToken},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Private importer status failed: '+r.status);return r.json();};
  const before=await status();if(before.manifestHash!==IMPORT_MANIFEST||before.jobHash!==access.jobHash||before.halted)throw Error('Existing import is not in a verified deployable state');
  await writeFile(new URL('pre-catchup-deployment.json',privateRoot),JSON.stringify({verifiedAt:new Date().toISOString(),settings,deployments:await platform('/deployments'),before},null,2)+'\n');
  console.log(command([...deployArgs,'--dry-run']));
  console.log(command(deployArgs));
  const afterSettings=await platform('/settings');
  verifyImportDeploymentFlags(afterSettings,config.vars);
  if(afterSettings.bindings.find(b=>b.name==='PUBLIC_READ_ONLY')?.text!=='false')throw Error('Importer unpause was not published');
  validateImportPause(config,(await platform('/schedules')).schedules);
  const after=await status();
  if(after.jobHash!==before.jobHash||after.manifestHash!==before.manifestHash||after.packetCount!==before.packetCount||after.totalRecords!==before.totalRecords||after.cursor<before.cursor||after.completedRecords<before.completedRecords||after.staging.consumedPagesDeleted<before.staging.consumedPagesDeleted)throw Error('Post-deployment checkpoint or cleanup invariant failed');
  const report={publishedAt:new Date().toISOString(),before,after,deployments:await platform('/deployments'),plan:proof.plan,paidFallback:false};
  await writeFile(new URL('catchup-deployment.json',privateRoot),JSON.stringify(report,null,2)+'\n');
  await writeFile(new URL('status.json',privateRoot),JSON.stringify(after,null,2)+'\n');
  console.log(JSON.stringify({published:true,state:after.state,cursor:after.cursor,completedRecords:after.completedRecords,quotaPolicy:after.quotaPolicy,nextAttemptAt:after.nextAttemptAt}));
  }
}
