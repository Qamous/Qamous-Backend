import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PREPARED_WORD_SQL} from '../src/public-data.ts';
import {SEED_CORRECTIONS} from '../src/seed-definition-repair.ts';

test('bounded crawl reads and authenticated seed correction preserve caches and quota accounting',async t=>{
  const built=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    import api from './src/index.ts'; import maintenance from './src/import-host.mjs';
    export {QamousRuntime,QamousReadBudget,QamousPublicCache} from './src/index.ts';
    export {QamousImportState} from './src/import-host.mjs';
    export default {fetch(request,env,ctx){return new URL(request.url).pathname.startsWith('/maintenance/correct-seed-meanings')?maintenance.fetch(request,env):api.fetch(request,env,ctx);}};
  `},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,
    compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    ratelimits:{PUBLIC_READ_RATE_LIMIT:{namespace_id:'20261023',simple:{limit:120,period:60}}},
    durableObjects:{RUNTIME:{className:'QamousRuntime',useSQLite:true},READ_BUDGET:{className:'QamousReadBudget',useSQLite:true},PUBLIC_CACHE:{className:'QamousPublicCache',useSQLite:true},COORDINATOR:{className:'QamousImportState',useSQLite:true}},
    bindings:{IMPORT_ADMIN_TOKEN:'synthetic-maintenance-token',IMPORT_JOB_HASH:'a'.repeat(64),PUBLIC_READ_ONLY:'false',PUBLIC_CARD_PAYLOADS:'true',
      APP_URL:'https://qamous.org',ALLOWED_ORIGINS:'https://qamous.org',ENABLE_AI:'false',
      READ_BUDGET_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),READ_BUDGET_BOOTSTRAP_ROWS:'0',
      PUBLIC_CACHE_WRITE_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),PUBLIC_CACHE_WRITE_BOOTSTRAP_ROWS:'0',
      AUXILIARY_WRITE_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),AUXILIARY_WRITE_BOOTSTRAP_ROWS:'0'},
    outboundService:()=>{throw Error('SEO regression tests must not contact external services');}}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())
    await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  await db.exec("INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Seed','','seed@example.invalid','seed','2024-01-01'); INSERT INTO countries VALUES('EG','Egypt'); INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES(1,1,'النهاردة','al-naharda','2024-01-01'),(2,1,'معلش','ma3lish','2024-01-01'),(3,1,'يلا','yalla','2024-01-01'); INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES(2,1,1,'EG','Today',0),(4,2,1,'EG','Never mind',0),(5,3,1,'EG','Go',0);");
  await db.batch(SEED_CORRECTIONS.map(fix=>db.prepare('INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES(?,?,1,\'EG\',?,1)').bind(fix.id,fix.wordId,fix.before)));
  // This population is larger than the entire fast-path reservation. A table
  // scan or filtering before LIMIT would break the measured read assertion.
  await db.exec("WITH RECURSIVE n(x) AS (SELECT 1000 UNION ALL SELECT x+1 FROM n WHERE x<6500) INSERT INTO words(id,userId,arabicWord,createdAt) SELECT x,1,'unrelated-'||x,'2026-01-01' FROM n; INSERT INTO definitions(id,wordId,userId,definition,isArabic) SELECT id,id,1,'Unrelated',0 FROM words WHERE id>=1000;");
  const measured=await db.prepare(PREPARED_WORD_SQL).bind(2).all();
  assert.equal(measured.results.length,2);assert.ok(measured.meta.rows_read<4096);
  assert.ok((await db.prepare('SELECT COUNT(*) FROM definitions').all()).meta.rows_read>4096,'fixture can detect an unbounded scan');
  const call=path=>mf.dispatchFetch('https://api.qamous.org'+path);
  const word=async id=>{const r=await call('/seo/word/'+id);assert.equal(r.status,200,await r.clone().text());return r.json();};
  const before=await word(2);assert.equal(before.rows.find(r=>r.id===3).definition,SEED_CORRECTIONS[1].before);
  await word(1);const unrelated=await word(3);
  const repair=(token='synthetic-maintenance-token',operation='correct-legacy-seed-meanings-v1')=>mf.dispatchFetch('https://private.invalid/maintenance/correct-seed-meanings',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({operation})});
  assert.equal((await repair('wrong')).status,401);
  assert.equal((await repair(undefined,'arbitrary-write')).status,400);
  const response=await repair();assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual((await response.json()).corrected,[1,3]);
  for(const fix of SEED_CORRECTIONS){
    const row=(await word(fix.wordId)).rows.find(row=>row.id===fix.id);
    assert.equal(row.definition,fix.after);assert.equal(row.arabicExample,fix.example);
  }
  assert.deepEqual((await word(3)).rows,unrelated.rows);
  assert.equal((await (await repair()).json()).alreadyCorrect,true,'repeated maintenance never overwrites content');
  await db.prepare("UPDATE definitions SET definition='A later community edit' WHERE id=1").run();
  assert.equal((await repair()).status,400,'a later edit must be reviewed rather than overwritten');
  const bindings=await mf.getBindings(),status=await bindings.READ_BUDGET.getByName('qamous-d1-account-v1').status();
  assert.equal(status.usage.tripped,null);assert.equal(status.usage.unresolved,0);
});
