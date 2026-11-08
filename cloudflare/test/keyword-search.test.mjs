import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {keywordSearchPage,keywordSearchQuery} from '../src/keyword-search.ts';
import {escapeLike,normalize,rankedSql} from '../src/data.ts';

const migrations=readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
  .map(name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
const originalSql=rankedSql("AND (w.searchText LIKE ? ESCAPE '\\' OR d.searchText LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM word_spellings a WHERE a.wordId=w.id AND a.searchText LIKE ? ESCAPE '\\') OR d.submissionId IN (SELECT id FROM contribution_submissions WHERE francoForm LIKE ? ESCAPE '\\'))");
const originalValues=(keyword,user=0)=>{const like='%'+escapeLike(normalize(keyword))+'%';return [user,user,user,like,like,like,like];};

test('indexed keyword lookup preserves literal matching, canonical ranking, languages, alternate spellings and personal reactions',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const migration of migrations)db.exec(migration);
    db.exec("INSERT INTO countries VALUES('EG','Egypt'); INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Test','','test@example.invalid','tester','2026-01-01'),(2,'Reader','','reader@example.invalid','reader','2026-01-01');");
    const words=[[1,'كتاب','kitab'],[2,'كِتاب','kitaab'],[3,'يلا','yalla'],[4,'100%_literal','symbol'],[5,'مخفي','hidden']];
    for(const [id,ar,franco] of words)db.prepare('INSERT INTO words(id,userId,arabicWord,francoArabicWord,searchText,createdAt) VALUES(?,1,?,?,?,?)').run(id,ar,franco,normalize(ar+' '+franco),'2026-01-01');
    const rows=[[1,1,'Good book',0,2],[2,2,'Library meaning',0,5],[3,1,'كتاب جميل',1,0],[4,3,'Let us go',0,0],[5,4,'Literal symbols %_',0,0],[6,5,'hidden meaning',0,0]];
    for(const [id,word,definition,language,likes] of rows)db.prepare('INSERT INTO definitions(id,wordId,userId,countryCode,definition,searchText,isArabic,likeCount) VALUES(?,?,1,\'EG\',?,?,?,?)').run(id,word,definition,normalize(definition),language,likes);
    db.exec("UPDATE definitions SET displayLanguage='hidden' WHERE id=6; INSERT INTO word_spellings(wordId,userId,script,spelling,searchText,createdAt) VALUES(3,1,'franco','together','together','2026-01-01'); INSERT INTO contribution_submissions(id,userId,payloadHash,wordId,createdAt,francoForm) VALUES('sense-1',1,'hash',1,'2026-01-01','sense-specific'); UPDATE definitions SET submissionId='sense-1' WHERE id=1; INSERT INTO \"definition-likes-dislikes\"(definitionId,userId,liked) VALUES(2,2,1);");
    for(const term of ['كتاب','كِتاب','kit','Library','good','together','sense-specific','100%_literal','%_','a','لا','hidden','" OR *','عبارة تجريبية غير موجودة']) {
      const query=keywordSearchQuery(term,2);
      const expected=db.prepare(originalSql).all(...originalValues(term,2));
      assert.deepEqual(db.prepare(query.sql).all(...query.values),expected,term);
      const pages=[];
      for(let offset=0;offset<expected.length;offset+=2) {
        const page=keywordSearchQuery(term,2,{limit:2,offset});
        pages.push(...db.prepare(page.sql).all(...page.values));
      }
      assert.deepEqual(pages,expected,'pagination preserves ranking and every result: '+term);
      for(const language of [0,1]) {
        const canonical=row=>db.prepare('SELECT canonicalArabic FROM words WHERE id=?').get(row.wordId).canonicalArabic;
        const preferred=new Set(expected.filter(row=>row.isArabic===language).map(canonical));
        const visible=expected.filter(row=>row.isArabic===language||!preferred.has(canonical(row)));
        const localized=[];
        for(let offset=0;offset<visible.length;offset++) {
          const page=keywordSearchQuery(term,2,{limit:1,offset,language});
          localized.push(...db.prepare(page.sql).all(...page.values).map(({searchLanguageRanking,...row})=>row));
        }
        assert.deepEqual(localized,visible.map(row=>({...row})),'language preference is applied before pagination: '+term);
      }
    }
    const query=keywordSearchQuery('عبارة تجريبية غير موجودة');
    const plans=db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.values).map(row=>row.detail);
    assert.ok(plans.some(plan=>/SEARCH definitions USING INTEGER PRIMARY KEY/.test(plan)));
    assert.ok(plans.some(plan=>/definition_search VIRTUAL TABLE INDEX .*M/.test(plan)));
    assert.ok(!plans.some(plan=>/^SCAN definitions\b/.test(plan)));
    for(const invalid of ['', ' ', 'a'.repeat(201)])assert.throws(()=>keywordSearchQuery(invalid),{status:400});
  } finally {db.close();}
});

test('an absent Arabic phrase avoids a full dictionary scan and an actual D1 cost overrun leaves other HTTP routes healthy',{timeout:60_000},async t=>{
  const built=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    import api from './src/index.ts'; import {guardD1} from './src/read-budget.ts'; import {attachProvenance} from './src/provenance.ts';
    export {QamousRuntime,QamousReadBudget,QamousPublicCache} from './src/index.ts';
    export default {async fetch(request,env,ctx) {
      if(new URL(request.url).pathname==='/test/provenance') {
        return Response.json(await attachProvenance(guardD1(env.DB,env,{route:'cache:word',tier:'public'}),[{definitionId:1000}]));
      }
      if(new URL(request.url).pathname==='/test/overrun') {
        const db=guardD1(env.DB,env,{route:'/test/overrun',tier:'public'});
        try {return Response.json(await db.prepare('/* qamous-read:1 */ SELECT COUNT(*) AS n FROM words WHERE id>=?').bind(1000).all());}
        catch(error) {return Response.json({reason:error.reason},{status:error.status||500});}
      }
      return api.fetch(request,env,ctx);
    }};
  `},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const day=new Date().toISOString().slice(0,10);
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,
    compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    ratelimits:{PUBLIC_READ_RATE_LIMIT:{namespace_id:'20261023',simple:{limit:120,period:60}}},
    durableObjects:{RUNTIME:{className:'QamousRuntime',useSQLite:true},READ_BUDGET:{className:'QamousReadBudget',useSQLite:true},PUBLIC_CACHE:{className:'QamousPublicCache',useSQLite:true}},
    bindings:{APP_URL:'https://qamous.org',ALLOWED_ORIGINS:'https://qamous.org',ENABLE_AI:'false',PUBLIC_READ_ONLY:'false',PUBLIC_CARD_PAYLOADS:'true',
      READ_BUDGET_BOOTSTRAP_DAY:day,READ_BUDGET_BOOTSTRAP_ROWS:'0',PUBLIC_CACHE_WRITE_BOOTSTRAP_DAY:day,PUBLIC_CACHE_WRITE_BOOTSTRAP_ROWS:'0',AUXILIARY_WRITE_BOOTSTRAP_DAY:day,AUXILIARY_WRITE_BOOTSTRAP_ROWS:'0'},
    outboundService:()=>{throw Error('Keyword regression tests must not contact external services');}}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const migration of migrations)await db.exec(migration.split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  await db.exec("INSERT INTO countries VALUES('EG','Egypt'); INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Test','','test@example.invalid','tester','2026-01-01'); WITH RECURSIVE n(x) AS (SELECT 1000 UNION ALL SELECT x+1 FROM n WHERE x<31000) INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt,searchText) SELECT x,1,'unrelated-'||x,'other-'||x,'2026-01-01','unrelated-'||x||' other-'||x FROM n; INSERT INTO definitions(id,wordId,userId,definition,isArabic,searchText) SELECT id,id,1,'An unrelated definition',0,'an unrelated definition' FROM words;");
  const term='عبارة تجريبية غير موجودة',query=keywordSearchQuery(term);
  const old=await db.prepare(originalSql).bind(...originalValues(term)).all();
  const improved=await db.prepare(query.sql).bind(...query.values).all();
  assert.deepEqual(improved.results,old.results);
  assert.ok(old.meta.rows_read>50_000,'fixture reproduces an overrun of the default reservation');
  assert.ok(improved.meta.rows_read<1000,'an absent long phrase must not walk the dictionary');
  t.diagnostic(JSON.stringify({legacyRowsRead:old.meta.rows_read,indexedRowsRead:improved.meta.rows_read}));
  const call=path=>mf.dispatchFetch('https://api.qamous.org'+path);
  const search=await call('/word/search/kwd='+encodeURIComponent(term));assert.equal(search.status,200,await search.clone().text());assert.deepEqual(await search.json(),[]);
  const bindings=await mf.getBindings(),ledger=bindings.READ_BUDGET.getByName('qamous-d1-account-v1');
  if(Date.now()%60000>55000)await new Promise(resolve=>setTimeout(resolve,60001-Date.now()%60000));
  const prior=await ledger.reserve({id:'preceding-crawl-burst',rows:100000,route:'/test/crawl',tier:'public'});
  assert.equal(prior.allowed,true);await ledger.settle(prior.id,100000);
  const beforeBurst=await ledger.status();
  const provenance=await call('/test/provenance');assert.equal(provenance.status,200,await provenance.clone().text());
  assert.deepEqual((await provenance.json())[0].sourceCredits,[]);
  const afterBurst=await ledger.status();
  assert.equal(afterBurst.usage.operations-beforeBurst.usage.operations,4,'a refused 200k batch is replaced by four individually admitted reads');
  assert.ok(afterBurst.usage.charged-beforeBurst.usage.charged<1000,'real D1 metadata queries remain fully charged');
  assert.equal(afterBurst.usage.unresolved,0);
  await db.prepare("UPDATE definitions SET definition=? WHERE wordId IN (SELECT id FROM words WHERE francoArabicWord LIKE 'other-100%')").bind('A meaning '+ 'x'.repeat(2500)).run();
  const pagedPath='/word/search/kwd=unrelated-100';
  const first=await call(pagedPath+'?page=1&limit=20'),firstText=await first.text();assert.equal(first.status,200,firstText);
  const firstPage=JSON.parse(firstText);assert.equal(firstPage.results.length,20);assert.equal(firstPage.hasMore,true);assert.equal(firstPage.page,1);
  assert.ok(Buffer.byteLength(firstText)<262144,'the initial server-rendered page stays within the existing payload guard');
  const second=await call(pagedPath+'?page=2&limit=20');assert.equal(second.status,200);const secondPage=await second.json();
  assert.equal(new Set([...firstPage.results,...secondPage.results].map(row=>row.definitionId)).size,40,'consecutive pages do not overlap');
  const legacy=await call(pagedPath),legacyText=await legacy.text();assert.equal(legacy.status,200,legacyText);
  assert.ok(Array.isArray(JSON.parse(legacyText)));assert.ok(Buffer.byteLength(legacyText)>262144,'the fixture reproduces the oversized unpaginated response');
  for(const params of ['page=0','page=1.5','page=1&page=2','limit=51','limit=0'])assert.equal((await call(pagedPath+'?'+params)).status,400,params);
  assert.equal((await call('/test/overrun')).status,200);
  const before=await ledger.status();assert.equal(Object.keys(before.costCircuits).length,1);assert.equal(before.usage.tripped,null);
  const denied=await call('/test/overrun');assert.equal(denied.status,503);assert.equal((await denied.json()).reason,'query_cost_circuit_open');
  assert.equal((await ledger.status()).usage.charged,before.usage.charged,'the refused query executes no D1 work');
  for(const path of ['/auth/health','/countries','/word/search/kwd='+encodeURIComponent(term)]) {
    const response=await call(path);assert.equal(response.status,200,path+': '+await response.text());
  }
});

test('keyword paging is opt-in and rejects invalid limits and duplicate controls',()=>{
  assert.equal(keywordSearchPage(new URLSearchParams()),null);
  assert.deepEqual(keywordSearchPage(new URLSearchParams('page=2&limit=20')),{page:2,limit:20});
  for(const params of ['page=0','page=-1','page=NaN','page=10001','limit=51','limit=1&limit=2','page=1&language=xx','page=1&language=en&language=ar'])
    assert.throws(()=>keywordSearchPage(new URLSearchParams(params)),error=>error.status===400,params);
});
