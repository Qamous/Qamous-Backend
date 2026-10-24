// Private, card-free staging and checkpoints in one SQLite Durable Object.
// The same reviewed D1 importer is shared with the original R2 implementation.
import {DurableObject} from 'cloudflare:workers';
import {runCloudImport,publicStatus,recoverBaselineHalt} from './import-cloud.mjs';
import {READ_BUDGET_OBJECT} from './read-budget.ts';
import {PUBLIC_CACHE_PREFIX,PUBLIC_CACHE_REVISION,validatePublicSeed} from './public-cache-keys.ts';
import {IMPORT_MANIFEST,IMPORT_LIMITS} from './import-cloud-policy.mjs';
import {guardD1} from './read-budget.ts';
import {storePreparedCards} from './public-card-payloads.ts';
import {fetchHostedFreeGuard} from '../scripts/hosted-free-guard.mjs';

const encoder=new TextEncoder();
const checksum=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const prefix=env=>'jobs/'+env.IMPORT_JOB_HASH+'/';

// Implements only the bounded object operations the importer needs. Conditional
// writes execute synchronously against the DO's SQLite database, with no await
// between checking an ETag and updating it. No process-local state is authoritative.
class ImportObjectStore {
  constructor(ctx){this.ctx=ctx;this.sql=ctx.storage.sql;}
  async get(key){
    const row=this.sql.exec('SELECT value,etag,bytes,sha256 FROM import_objects WHERE key=?',key).toArray()[0];
    if(!row)return null;
    return {etag:row.etag,size:row.bytes,customMetadata:{sha256:row.sha256},text:async()=>row.value,arrayBuffer:async()=>encoder.encode(row.value).buffer};
  }
  async head(key){const row=this.sql.exec('SELECT etag,bytes,sha256 FROM import_objects WHERE key=?',key).toArray()[0];return row?{etag:row.etag,size:row.bytes,customMetadata:{sha256:row.sha256}}:null;}
  async put(key,value,options={}){
    if(typeof value!=='string'||encoder.encode(value).length>IMPORT_LIMITS.objectBytes)throw Error('Bounded UTF-8 import object required');
    return this.ctx.storage.transactionSync(()=>{
      const previous=this.sql.exec('SELECT etag FROM import_objects WHERE key=?',key).toArray()[0];
      if(options.onlyIf?.etagMatches&&previous?.etag!==options.onlyIf.etagMatches)return null;
      if(options.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;
      const etag=crypto.randomUUID(),bytes=encoder.encode(value).length;
      this.sql.exec('INSERT INTO import_objects(key,value,etag,bytes,sha256) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,etag=excluded.etag,bytes=excluded.bytes,sha256=excluded.sha256',key,value,etag,bytes,options.customMetadata?.sha256||'');
      if(!previous&&/\/pages\/\d{6}\.json$/.test(key))this.sql.exec('UPDATE import_storage SET pages=pages+1,bytes=bytes+? WHERE id=1',bytes);
      return {etag};
    });
  }
}

export class QamousImportState extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS import_objects(key TEXT PRIMARY KEY,value TEXT NOT NULL,etag TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL) WITHOUT ROWID');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS import_storage(id INTEGER PRIMARY KEY,pages INTEGER NOT NULL,bytes INTEGER NOT NULL,deletedPages INTEGER NOT NULL,lastCleanupAt TEXT,lastScheduledAt TEXT)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO import_storage(id,pages,bytes,deletedPages) VALUES(1,0,0,0)');
    this.objects=new ImportObjectStore(ctx);
  }
  async stage(file,method,value,sha256){
    if(!/^(job\.json|pages\/\d{6}\.json)$/.test(file))throw Error('Invalid staging key');
    const key=prefix(this.env)+file,existing=await this.objects.head(key);
    if(method==='HEAD')return existing?{exists:true,bytes:existing.size,sha256:existing.customMetadata.sha256}:{exists:false};
    if(!existing&&this.ctx.storage.sql.databaseSize+encoder.encode(value||'').length>450000000)throw Error('Free staging storage headroom reached');
    if(typeof value!=='string'||encoder.encode(value).length>IMPORT_LIMITS.objectBytes||await checksum(value)!==sha256)throw Error('Staged object checksum or length differs');
    if(existing){if(existing.customMetadata.sha256!==sha256)throw Error('Immutable staging object differs');return {staged:true,sha256};}
    const stored=await this.objects.put(key,value,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256}});
    if(!stored)throw Error('Concurrent stage conflict');
    return {staged:true,sha256};
  }
  async arm(state){
    if(state.jobHash!==this.env.IMPORT_JOB_HASH||state.manifestHash!==IMPORT_MANIFEST||state.cursor!==0)throw Error('Unexpected initial import checkpoint');
    const key=prefix(this.env),existing=await this.objects.get(key+'checkpoint.json');
    if(existing)return this.status();
    const root=await this.objects.get(key+'job.json');if(!root)throw Error('Job manifest has not been staged');
    const text=await root.text();if(await checksum(text)!==this.env.IMPORT_JOB_HASH)throw Error('Job checksum differs');
    const job=JSON.parse(text),storage=this.ctx.storage.sql.exec('SELECT pages FROM import_storage WHERE id=1').one();
    if(storage.pages!==job.pages.length)throw Error('Not all prepared pages have been staged');
    // Every immutable upload checks its hash, and the installer HEAD-verifies
    // all of them before arming. State contains no arbitrary SQL or new records.
    if(state.packetCount!==job.packetCount||state.totalRecords!==job.totalRecords)throw Error('Checkpoint counts differ from staged manifest');
    await this.objects.put(key+'checkpoint.json',JSON.stringify(state),{onlyIf:{etagDoesNotMatch:'*'}});
    return this.status();
  }
  async cleanupConsumed(){
    const loaded=await this.objects.get(prefix(this.env)+'checkpoint.json');if(!loaded)return;
    const state=JSON.parse(await loaded.text());
    if(state.manifestHash!==IMPORT_MANIFEST||state.jobHash!==this.env.IMPORT_JOB_HASH)throw Error('Cleanup checkpoint mismatch');
    const pageEnd=state.cursor===state.packetCount?Math.ceil(state.cursor/8):Math.floor(state.cursor/8);
    // Literal per-job allowlist: only fully consumed page objects. Never delete
    // checkpoint, job manifest, D1 records, source credits or local recovery data.
    const lower=prefix(this.env)+'pages/000000.json',upper=prefix(this.env)+'pages/'+String(pageEnd).padStart(6,'0')+'.json';
    this.ctx.storage.transactionSync(()=>{
      const consumed=this.ctx.storage.sql.exec('SELECT key,bytes FROM import_objects WHERE key>=? AND key<? ORDER BY key LIMIT 50',lower,upper).toArray();
      if(!consumed.length)return;
      for(const row of consumed)this.ctx.storage.sql.exec('DELETE FROM import_objects WHERE key=?',row.key);
      this.ctx.storage.sql.exec('UPDATE import_storage SET pages=pages-?,bytes=bytes-?,deletedPages=deletedPages+?,lastCleanupAt=? WHERE id=1',consumed.length,consumed.reduce((sum,row)=>sum+row.bytes,0),consumed.length,new Date().toISOString());
    });
  }
  async tick(origin){
    if(!['scheduled','manual'].includes(origin))throw Error('Invalid invocation origin');
    if(origin==='scheduled')this.ctx.storage.sql.exec('UPDATE import_storage SET lastScheduledAt=? WHERE id=1',new Date().toISOString());
    const baseline=JSON.parse(this.env.FREE_PLAN_BASELINE||'null');
    const result=await runCloudImport({...this.env,IMPORTS:this.objects},origin,{billing:()=>fetchHostedFreeGuard(this.env.CLOUDFLARE_READ_TOKEN,baseline)});
    await this.cleanupConsumed();
    const staging=this.storageStatus();return {...result,lastScheduledAt:staging.lastScheduledAt,staging};
  }
  storageStatus(){const row=this.ctx.storage.sql.exec('SELECT pages,bytes,deletedPages,lastCleanupAt,lastScheduledAt FROM import_storage WHERE id=1').one();return {backend:'Free SQLite Durable Object',remainingPages:row.pages,remainingBytes:row.bytes,databaseBytes:this.ctx.storage.sql.databaseSize,consumedPagesDeleted:row.deletedPages,lastCleanupAt:row.lastCleanupAt,lastScheduledAt:row.lastScheduledAt,cleanup:'after verified D1 commit and durable checkpoint'};}
  async status(){const loaded=await this.objects.get(prefix(this.env)+'checkpoint.json');const staging=this.storageStatus();return {...(loaded?publicStatus(JSON.parse(await loaded.text())):{state:'not_armed'}),lastScheduledAt:staging.lastScheduledAt,staging};}
  async recoverBaseline(expected){const baseline=JSON.parse(this.env.FREE_PLAN_BASELINE||'null');return recoverBaselineHalt({...this.env,IMPORTS:this.objects},expected,{billing:()=>fetchHostedFreeGuard(this.env.CLOUDFLARE_READ_TOKEN,baseline)});}
}

async function isAuthorized(request,env){
  const supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(!env.IMPORT_ADMIN_TOKEN||supplied.length!==env.IMPORT_ADMIN_TOKEN.length)return false;
  return crypto.subtle.timingSafeEqual(encoder.encode(supplied),encoder.encode(env.IMPORT_ADMIN_TOKEN));
}
const coordinator=env=>env.COORDINATOR.getByName(env.IMPORT_JOB_HASH);
async function boundedJson(request,maxBytes) {
  const size=Number(request.headers.get('Content-Length'));
  if(size>maxBytes)throw Error('Request body is too large');
  if(!request.body)throw Error('A JSON body is required');
  const reader=request.body.getReader(),chunks=[];let bytes=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw Error('Request body is too large');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(all));
}
export default {
  async scheduled(controller,env,ctx){if(env.PUBLIC_READ_ONLY==='true')return;ctx.waitUntil(coordinator(env).tick('scheduled'));},
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return response({service:'qamous-import',version:2,staging:'Free SQLite Durable Object',configured:/^[a-f0-9]{64}$/.test(env.IMPORT_JOB_HASH)});
    if(!await isAuthorized(request,env))return response({error:'Unauthorized'},401);
    // Authenticated inspection and the narrowly checked pre-D1 baseline repair
    // are available during pause; neither endpoint submits an import packet.
    if(env.PUBLIC_READ_ONLY==='true'&&!(url.pathname==='/status'&&request.method==='GET')&&!(url.pathname==='/read-budget'&&request.method==='GET')&&!(url.pathname==='/recover-baseline'&&request.method==='POST')&&!(url.pathname==='/recovery-export-budget'&&request.method==='POST')
      &&!(url.pathname==='/prepared-cards/seed'&&request.method==='POST')&&!(url.pathname==='/prepared-cards/status'&&request.method==='GET')&&!(url.pathname==='/prepared-cards/maintenance-budget'&&request.method==='POST')
      &&!(url.pathname==='/public-cache/revision'&&request.method==='GET')&&!(url.pathname==='/public-cache/seed'&&request.method==='POST'))return Response.json({error:'Imports and maintenance are paused while the public snapshot is active',code:'PUBLIC_READ_ONLY'},
      {status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Retry-After':'60'}});
    try {
      if(url.pathname==='/read-budget'&&request.method==='GET')return response(await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).status());
      if(url.pathname==='/prepared-cards/maintenance-budget'&&request.method==='POST') {
        if(env.PUBLIC_READ_ONLY!=='true')return response({error:'Prepared-card migration requires paused writers'},409);
        const input=await boundedJson(request,1024);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='id,operation'||input.operation!=='migration-0009'||typeof input.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(input.id))throw Error('The reviewed migration identity is required');
        // Fixed essential admission works before the prepared tables exist.
        // This endpoint executes no SQL and grants no caller-selected budget.
        return response(await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reserve({id:input.id,rows:250000,route:'maintenance:prepared-migration-0009',tier:'essential'}));
      }
      if(url.pathname==='/prepared-cards/seed'&&request.method==='POST') {
        if(env.PUBLIC_READ_ONLY!=='true'||env.PUBLIC_CARD_PAYLOADS!=='true')return response({error:'Prepared-card seeding requires paused writers and the installed read model'},409);
        const input=await boundedJson(request,2_000_000);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='cards'||!Array.isArray(input.cards)||input.cards.length<1||input.cards.length>50)throw Error('A bounded prepared-card batch is required');
        const db=guardD1(env.DB,env,{route:'maintenance:prepare-cards',tier:'essential'});
        return response({stored:await storePreparedCards(db,input.cards)});
      }
      if(url.pathname==='/prepared-cards/status'&&request.method==='GET') {
        if(env.PUBLIC_READ_ONLY!=='true'||env.PUBLIC_CARD_PAYLOADS!=='true')return response({error:'Prepared-card inspection requires paused writers and the installed read model'},409);
        const db=guardD1(env.DB,env,{route:'maintenance:prepared-status',tier:'essential'});
        const result=await db.prepare(`/* qamous-read:50000 */ SELECT (SELECT COUNT(*) FROM public_card_payloads) AS preparedCards,
          (SELECT COUNT(*) FROM public_feed_candidates) AS feedCandidates,
          (SELECT COUNT(*) FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.reportCount<=5 AND w.reportCount<=5) AS eligibleCards,
          (SELECT COUNT(*) FROM public_definitions d JOIN words w ON w.id=d.wordId LEFT JOIN public_card_payloads p ON p.definitionId=d.id WHERE d.reportCount<=5 AND w.reportCount<=5 AND p.definitionId IS NULL) AS missingPayloads`).first();
        return response(result);
      }
      // Admission only: this cannot run SQL or resume writers. Keep the full
      // conservative export charge; never refund an unmeasured D1 export.
      if(url.pathname==='/recovery-export-budget'&&request.method==='POST') {
        if(env.PUBLIC_READ_ONLY!=='true')return response({error:'Recovery export requires ingestion to remain paused'},409);
        const {id}=await boundedJson(request,1024);
        return response(await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reserve({id,rows:250000,route:'maintenance:recovery-export',tier:'essential'}));
      }
      if(url.pathname==='/recover-baseline'&&request.method==='POST'){
        if(env.PUBLIC_READ_ONLY!=='true')return response({error:'Baseline recovery requires ingestion to remain explicitly paused'},409);
        return response(await coordinator(env).recoverBaseline(await boundedJson(request,2048)));
      }
      if(url.pathname==='/read-budget/reconcile'&&request.method==='POST') {
        return response(await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reconcile(await boundedJson(request,1024)));
      }
      if(url.pathname==='/read-budget/reserve'&&request.method==='POST') {
        const {id,rows}=await boundedJson(request,1024);
        return response(await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reserve({id,rows,route:'maintenance:cli',tier:'import'}));
      }
      if(url.pathname==='/read-budget/settle'&&request.method==='POST') {
        const {id,rowsRead,rowsWritten}=await boundedJson(request,1024);
        if(typeof id!=='string'||(rowsRead!==null&&(!Number.isSafeInteger(rowsRead)||rowsRead<0))||!Number.isSafeInteger(rowsWritten)||rowsWritten<0)throw Error('Valid measured costs are required');
        return response(await env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).settle(id,rowsRead,rowsWritten));
      }
      if(url.pathname==='/public-cache/revision'&&request.method==='GET')return response({revision:await env.PUBLIC_CACHE.getByName(PUBLIC_CACHE_REVISION).revision()});
      if(url.pathname==='/public-cache/seed'&&request.method==='POST') {
        const {key,value,revision}=await boundedJson(request,2_000_000);
        if(typeof key!=='string'||!Number.isSafeInteger(revision)||revision<0)throw Error('A public resource key and revision are required');
        validatePublicSeed(key,value);
        return response(await env.PUBLIC_CACHE.getByName(PUBLIC_CACHE_PREFIX+key).seed(key,value,revision));
      }
      const stub=coordinator(env);
      if(url.pathname==='/status'&&request.method==='GET')return response(await stub.status());
      if(url.pathname==='/tick'&&request.method==='POST')return response(await stub.tick('manual'));
      if(url.pathname==='/arm'&&request.method==='POST'){
        if(Number(request.headers.get('Content-Length'))>131072)return response({error:'Checkpoint too large'},413);
        return response(await stub.arm(await request.json()));
      }
      if(url.pathname.startsWith('/stage/')&&['HEAD','PUT'].includes(request.method)){
        const file=url.pathname.slice(7);
        if(request.method==='HEAD'){const result=await stub.stage(file,'HEAD',null,null);return new Response(null,{status:result.exists?200:404,headers:result.exists?{'Content-Length':String(result.bytes),'X-Object-Sha256':result.sha256}:{}});}
        const size=Number(request.headers.get('Content-Length')),sha256=request.headers.get('X-Object-Sha256');
        if(!Number.isSafeInteger(size)||size<1||size>IMPORT_LIMITS.objectBytes||!/^[a-f0-9]{64}$/.test(sha256||''))return response({error:'Bounded length and checksum required'},400);
        return response(await stub.stage(file,'PUT',await request.text(),sha256),201);
      }
      return response({error:'Not found'},404);
    }catch(error){return response({error:String(error.message).slice(0,500)},400);}
  }
};
