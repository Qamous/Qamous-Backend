import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {IMPORT_MANIFEST} from '../src/import-cloud-policy.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const packets=Array.from({length:16},(_,i)=>{
  const key=i+1,wordId=1000000000+key,definitionId=2000000000+key;
  return {index:i,completed:[key],identities:[{recordKey:key,fingerprint:key.toString(16).padStart(2,'0')}],statements:[
    `INSERT OR IGNORE INTO "words"("id","userId","arabicWord","francoArabicWord","createdAt") VALUES(${wordId},2,'كتاب ${key}','ktab ${key}',CURRENT_TIMESTAMP);`,
    `INSERT OR IGNORE INTO "import_records"("recordKey","sourceId","sourceEntryId","sourceUrl","importerUserId","batchId","contentHash","status","arabic","franco","transliteration","dialect","definitionAr","definitionEn","fingerprint","wordId") VALUES(${key},'source','sense-${key}','https://example.org',2,1,X'01','accepted','كتاب','ktab','','','','book',X'${key.toString(16).padStart(2,'0')}',${wordId});`,
    `INSERT OR IGNORE INTO "definitions"("id","wordId","userId","definition","isArabic","languageCode","displayLanguage") VALUES(${definitionId},${wordId},2,'book',0,'en','en');`,
    `INSERT OR IGNORE INTO "definition_provenance"("definitionId","recordKey","language","changes") VALUES(${definitionId},${key},'en',1);`
  ]};
});
const pages=[JSON.stringify({packets:packets.slice(0,8)}),JSON.stringify({packets:packets.slice(8)})];
const job={manifestHash:IMPORT_MANIFEST,representation:2,exampleAlignment:1,batchId:1,migrations:[],packetCount:16,packetsPerPage:8,totalRecords:16,pages:pages.map(value=>({sha256:hash(value)}))};
const serialized=JSON.stringify(job),jobHash=hash(serialized);
const built=await build({entryPoints:[fileURLToPath(new URL('../src/import-host.mjs',import.meta.url))],external:['cloudflare:workers'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],durableObjects:{COORDINATOR:{className:'QamousImportState',useSQLite:true}},d1Databases:['DB'],bindings:{IMPORT_JOB_HASH:jobHash,IMPORT_ADMIN_TOKEN:'synthetic-admin',CLOUDFLARE_READ_TOKEN:'synthetic-read'},outboundService:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/subscriptions'))return Response.json({success:true,result:[{state:'Provisioned',price:0,rate_plan:{id:'workers_free',public_name:'Workers Free'}}]});
  if(path.endsWith('/graphql'))return Response.json({data:{viewer:{accounts:[{d1AnalyticsAdaptiveGroups:[{sum:{rowsWritten:0,rowsRead:0}}]}]}}});
  if(path.endsWith('/time_travel/bookmark'))return Response.json({success:true,result:{bookmark:'local-recovery'}});
  throw Error('Unexpected external request: '+path);
}}));
try{
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  await db.exec("INSERT INTO users(id,firstName,lastName,email,username,createdAt,accountKind) VALUES(1,'Member','','member@example.invalid','member','2026-01-01','member'),(2,'Import','','import@imports.invalid','qalam01','2026-10-20','import');INSERT INTO import_accounts VALUES(0,2);INSERT INTO import_sources VALUES('source','Dictionary','https://example.org','CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/','licensed','Original authors','Notice',1,'hash','{}');INSERT INTO import_batches(id,manifestHash,createdAt) VALUES(1,'"+IMPORT_MANIFEST+"','2026-10-20');INSERT INTO import_change_templates VALUES(1,'[]');");
  const headers={Authorization:'Bearer synthetic-admin'};
  const call=(path,options={})=>mf.dispatchFetch('https://local'+path,{...options,headers:{...headers,...options.headers}});
  assert.equal((await mf.dispatchFetch('https://local/status')).status,401);
  for(const [file,value] of [['pages/000000.json',pages[0]],['pages/000001.json',pages[1]],['job.json',serialized]]){
    const result=await call('/stage/'+file,{method:'PUT',headers:{'Content-Length':String(Buffer.byteLength(value)),'X-Object-Sha256':hash(value)},body:value});assert.equal(result.status,201,await result.text());
  }
  const checkpoint={jobHash,manifestHash:IMPORT_MANIFEST,status:'active',cursor:0,packetCount:16,completedRecords:0,totalRecords:16,days:{},schemaVerifiedAt:new Date().toISOString()};
  assert.equal((await call('/arm',{method:'POST',body:JSON.stringify(checkpoint)})).status,200);
  const tick=()=>call('/tick',{method:'POST'}).then(r=>r.json());
  const parallel=await Promise.all([tick(),tick()]);
  assert.equal(parallel.filter(r=>r.state==='active').length,1);assert.equal(parallel.filter(r=>r.state==='busy').length,1);
  for(let i=1;i<7;i++)assert.equal((await tick()).state,'active');
  let status=await call('/status').then(r=>r.json());assert.equal(status.cursor,7);assert.equal(status.staging.remainingPages,2);assert.equal(status.staging.consumedPagesDeleted,0);
  await tick();status=await call('/status').then(r=>r.json());assert.equal(status.cursor,8);assert.equal(status.staging.remainingPages,1);assert.equal(status.staging.consumedPagesDeleted,1);
  assert.equal((await call('/stage/pages/000000.json',{method:'HEAD'})).status,404);
  assert.equal((await call('/stage/pages/000001.json',{method:'HEAD'})).status,200);
  for(let i=8;i<16;i++)await tick();
  status=await call('/status').then(r=>r.json());assert.equal(status.state,'complete');assert.equal(status.staging.remainingPages,0);assert.equal(status.staging.remainingBytes,0);assert.equal(status.staging.consumedPagesDeleted,2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM import_records').first()).n,16);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM definition_provenance').first()).n,16);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM definitions').first()).n,16);
  assert.equal((await db.prepare('SELECT points FROM users WHERE id=2').first()).points,16);
  assert.equal((await db.prepare('SELECT points FROM users WHERE id=1').first()).points,0);
  const before=status.days[new Date().toISOString().slice(0,10)].rowsWritten;
  await tick();assert.equal((await call('/status').then(r=>r.json())).days[new Date().toISOString().slice(0,10)].rowsWritten,before);
  console.log(JSON.stringify({passed:true,bindings:'real local SQLite Durable Object and D1',concurrentCommitSafe:true,packets:16,deletedConsumedPages:2,remainingStagedBytes:0,ledgerPreserved:true,pointsPreserved:true,productionWrites:0}));
}finally{await mf.dispose();}
