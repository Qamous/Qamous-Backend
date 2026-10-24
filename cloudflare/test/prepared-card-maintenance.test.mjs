import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {assertOnlyPreparedMigration,preparedSeedBatches,auditedPreparedSnapshot} from '../scripts/prepared-cards-maintenance.mjs';

const checksum=text=>createHash('sha256').update(text).digest('hex');
test('prepared migration tooling permits only migration0009 and bounds both seed count and UTF8 size',()=>{
  assert.deepEqual(assertOnlyPreparedMigration('│ 0009_prepared_public_cards.sql │'),['0009_prepared_public_cards.sql']);
  for(const output of ['', '0008_other.sql\n0009_prepared_public_cards.sql','0010_other.sql'])assert.throws(()=>assertOnlyPreparedMigration(output));
  const cards=Array.from({length:115},(_,n)=>({definitionId:n+1,definition:'ك'.repeat(50_000)}));
  const batches=preparedSeedBatches(cards);
  assert.equal(batches.flat().length,115);
  assert.ok(batches.every(cards=>cards.length<=50&&Buffer.byteLength(JSON.stringify({cards}))<=1_800_000));
});

test('prepared seed audits all hashes and feed coverage before submitting maintenance',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'qamous-prepared-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const resources=[];
  for(const [key,value] of [['cards:0',[{definitionId:1,definition:'Book'}]],['feed:0',[{definitionId:1}]],['feed:1',[]]]){
    const text=JSON.stringify({key,value}),file=checksum(key)+'.json';await writeFile(join(directory,file),text);resources.push({key,file,bytes:Buffer.byteLength(text),sha256:checksum(text)});
  }
  const time=Date.now(),stamp=new Date(time).toISOString();
  const manifestFile=join(directory,'manifest.json'),manifest={schemaVersion:1,snapshotId:'a'.repeat(16),generatedAt:stamp,sourceExportedAt:stamp,exportStartedAt:stamp,exportCompletedAt:stamp,expiresAt:new Date(time+86400000).toISOString(),resources,counts:{resources:3,publicDefinitions:1}};await writeFile(manifestFile,JSON.stringify(manifest));
  assert.equal((await auditedPreparedSnapshot(manifestFile)).cards.length,1);
  await writeFile(join(directory,resources[0].file),'changed');await assert.rejects(()=>auditedPreparedSnapshot(manifestFile),/checksum/);
  manifest.exportStartedAt=manifest.exportCompletedAt=manifest.sourceExportedAt='2020-01-01T00:00:00Z';manifest.expiresAt='2020-01-02T00:00:00Z';await writeFile(manifestFile,JSON.stringify(manifest));await assert.rejects(()=>auditedPreparedSnapshot(manifestFile),/fresh/);
});

test('paused ledger inspection is authenticated and independent of D1 and importer state',{timeout:30_000},async t=>{
  // Missing DB/COORDINATOR bindings make accidental access fail this test.
  const built=await build({stdin:{contents:"export {default} from './src/import-host.mjs';export {QamousReadBudget} from './src/read-budget-object.ts';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},external:['cloudflare:workers'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],durableObjects:{READ_BUDGET:{className:'QamousReadBudget',useSQLite:true}},bindings:{IMPORT_ADMIN_TOKEN:'local-inspection-token',PUBLIC_READ_ONLY:'true',READ_BUDGET_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),READ_BUDGET_BOOTSTRAP_ROWS:'123456'},outboundService:()=>{throw Error('No external services');}}));
  t.after(()=>mf.dispose());
  assert.equal((await mf.dispatchFetch('https://local/read-budget')).status,401);
  const inspect=()=>mf.dispatchFetch('https://local/read-budget',{headers:{Authorization:'Bearer local-inspection-token'}});
  const first=await inspect();assert.equal(first.status,200);const before=await first.json();
  assert.equal(before.usage.charged,123456);assert.equal(before.usage.baseline,123456);assert.equal(before.usage.operations,0);
  const second=await inspect();assert.equal(second.status,200);const after=await second.json();assert.deepEqual(after.usage,before.usage);
  assert.deepEqual(after.routes,[]);
});

test('prepared administration requires auth, paused writers, explicit readmodel and bounded bodies',{timeout:30_000},async t=>{
  const built=await build({stdin:{contents:"export {default,QamousImportState} from './src/import-host.mjs';export {QamousReadBudget} from './src/read-budget-object.ts';export {QamousPublicCache} from './src/public-cache.ts';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},external:['cloudflare:workers'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const token='test-admin-credential-exclusively-local';
  for(const [paused,prepared] of [['true','true'],['true','false'],['false','true']]) {
    const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],durableObjects:{COORDINATOR:{className:'QamousImportState',useSQLite:true},READ_BUDGET:{className:'QamousReadBudget',useSQLite:true},PUBLIC_CACHE:{className:'QamousPublicCache',useSQLite:true}},d1Databases:['DB'],bindings:{IMPORT_ADMIN_TOKEN:token,IMPORT_JOB_HASH:'a'.repeat(64),PUBLIC_READ_ONLY:paused,PUBLIC_CARD_PAYLOADS:prepared,READ_BUDGET_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),READ_BUDGET_BOOTSTRAP_ROWS:'0'},outboundService:()=>{throw Error('No external services');}}));
    try {
      const post=(path,body,auth=true)=>mf.dispatchFetch('https://local'+path,{method:'POST',headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
      const get=path=>mf.dispatchFetch('https://local'+path,{headers:{Authorization:'Bearer '+token}});
      for(const path of ['/prepared-cards/seed','/prepared-cards/maintenance-budget'])assert.equal((await post(path,{},false)).status,401);
      assert.equal((await mf.dispatchFetch('https://local/prepared-cards/status')).status,401);
      const claim={id:'maintenance-'+prepared,operation:'migration-0009'};
      if(paused!=='true') {
        assert.equal((await post('/prepared-cards/maintenance-budget',claim)).status,409);
        assert.equal((await post('/prepared-cards/seed',{cards:[{definitionId:1}]})).status,409);
        assert.equal((await get('/prepared-cards/status')).status,409);continue;
      }
      for(const body of [null,[],{}, {...claim,rows:1}, {...claim,operation:'arbitrary'}, {...claim,id:'bad'}, {...claim,junk:'x'.repeat(1100)}])assert.equal((await post('/prepared-cards/maintenance-budget',body)).status,400);
      assert.equal((await post('/tick',{})).status,503,'maintenance does not resume ingestion');
      // Fixed migration admission works even before tables are installed or the
      // feature flag is enabled. Verify the durable conservative charge.
      const admit=async()=>{const admitted=await post('/prepared-cards/maintenance-budget',claim);assert.equal(admitted.status,200);const admission=await admitted.json();assert.equal(admission.allowed,true);assert.equal(admission.reserved,250000);assert.equal((await post('/prepared-cards/maintenance-budget',claim).then(r=>r.json())).reason,'replayed_reservation');};
      if(prepared!=='true') {
        await admit();
        assert.equal((await post('/prepared-cards/seed',{cards:[{definitionId:1}]})).status,409);assert.equal((await get('/prepared-cards/status')).status,409);continue;
      }
      const db=await mf.getD1Database('DB');
      for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
      await db.exec("INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Test','','test@example.invalid','test','2026-01-01');INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES(1,1,'كتاب','kitab','2026-01-01');INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(1,1,1,'Book',0);");
      for(const body of [null,[],{}, {cards:[]},{cards:Array.from({length:51},()=>({definitionId:1}))},{cards:[{definitionId:1}],extra:true},{cards:[{definitionId:1,email:'private'}]}])assert.equal((await post('/prepared-cards/seed',body)).status,400);
      const before=await get('/prepared-cards/status').then(r=>r.json());assert.deepEqual(before,{preparedCards:0,feedCandidates:1,eligibleCards:1,missingPayloads:1});
      const result=await post('/prepared-cards/seed',{cards:[{definitionId:1,definition:'Book'}]});assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).stored,1);
      const after=await get('/prepared-cards/status').then(r=>r.json());assert.deepEqual(after,{preparedCards:1,feedCandidates:1,eligibleCards:1,missingPayloads:0});
      await admit();
    }finally {await mf.dispose();}
  }
});
