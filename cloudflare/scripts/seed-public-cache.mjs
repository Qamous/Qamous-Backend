// Restore public reads during a D1 outage using reviewed public projections.
// Requires the existing private importer credential; never sends raw exports.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validatePublicSeed} from '../src/public-cache-keys.ts';

const [manifestArg,revisionArg]=process.argv.slice(2);
const revision=Number(revisionArg);
if(!manifestArg||!Number.isSafeInteger(revision)||revision<1)throw Error('Usage: node scripts/seed-public-cache.mjs <private-manifest.json> <expected-revision>');
const manifestFile=resolve(manifestArg),directory=resolve(manifestFile,'..');
const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
const age=Date.now()-Date.parse(manifest.builtAt);
if(!Number.isFinite(age)||age<0||age>4*60*60_000||!Array.isArray(manifest.resources)||manifest.resources.length>50_000)throw Error('Snapshot is missing, expired or invalid. Export a fresh snapshot.');
const access=JSON.parse(await readFile(new URL('../private/cloud-import/access.json',import.meta.url),'utf8'));
if(access.url!=='https://qamous-import.anthonyyoussef01.workers.dev'||typeof access.adminToken!=='string'||access.adminToken.length<32)throw Error('Approved importer access is unavailable');
const headers={Authorization:'Bearer '+access.adminToken,'Content-Type':'application/json'};
async function call(path,body) {
  const response=await fetch(access.url+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30_000)});
  if(!response.ok){await response.body?.cancel();throw Error('Private cache operation failed with HTTP '+response.status);}
  return response.json();
}
const current=await call('/public-cache/revision');
if(current.revision!==revision)throw Error('Public content changed. Export a new snapshot at the current revision.');
const priority=key=>key==='countries'||key.startsWith('feed:')?0:key==='word:2'?1:key.startsWith('cards:')?2:key.startsWith('related:')?3:key.startsWith('seo-')?4:key.startsWith('explore:')?5:6;
const resources=[...manifest.resources].sort((a,b)=>priority(a.key)-priority(b.key));
const report={startedAt:new Date().toISOString(),revision,manifest:manifestFile,stored:[],failed:[]};
const reportFile=join(directory,'seed-report.json');
let cursor=0,stopped=false;
async function worker() {
  while(!stopped&&cursor<resources.length) {
    const entry=resources[cursor++];
    try {
      if(!/^[a-f0-9]{64}\.json$/.test(entry.file))throw Error('Invalid snapshot filename');
      const json=await readFile(join(directory,entry.file),'utf8');
      if(createHash('sha256').update(json).digest('hex')!==entry.sha256)throw Error('Snapshot checksum mismatch');
      const payload=JSON.parse(json);if(payload.key!==entry.key)throw Error('Snapshot key mismatch');
      validatePublicSeed(payload.key,payload.value);
      const result=await call('/public-cache/seed',{...payload,revision});
      if(!result.stored)throw Error('Cache seed was not stored');
      report.stored.push(entry.key);
      if(report.stored.length%100===0)console.log(JSON.stringify({stored:report.stored.length,total:resources.length}));
    } catch(error){stopped=true;report.failed.push({key:entry.key,error:error.message});}
  }
}
await Promise.all(Array.from({length:6},()=>worker()));
report.finishedAt=new Date().toISOString();
const final=await call('/public-cache/revision');
report.finalRevision=final.revision;
await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stored:report.stored.length,total:resources.length,failed:report.failed.length,revision,finalRevision:final.revision,report:reportFile}));
if(report.failed.length||report.stored.length!==resources.length||final.revision!==revision)throw Error('Cache recovery is incomplete; inspect the private seed report.');
