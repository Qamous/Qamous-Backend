import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {resolvePublicMutationScope} from '../src/public-mutation-scope.ts';

const migrations=await Promise.all((await readdir(new URL('../migrations/',import.meta.url)))
  .filter(name=>name.endsWith('.sql')).sort().map(name=>readFile(new URL('../migrations/'+name,import.meta.url),'utf8')));
function fixture(t) {
  const sql=new DatabaseSync(':memory:');for(const migration of migrations)sql.exec(migration);
  sql.exec(`INSERT INTO countries VALUES ('EG','Egypt'),('LB','Lebanon'),('MA','Morocco');
    INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES
      (2,'Other','','scope2@example.invalid','scope2','2026-01-01'),
      (7,'Archive','','scope7@example.invalid','scope7','2026-01-01'),
      (8,'Voter','','scope8@example.invalid','scope8','2026-01-01'),
      (9,'Owner','','scope9@example.invalid','scope9','2026-01-01');
    INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES
      (1,9,'كلمة','kalima','2026-01-01'),(1001,2,'كَلِمَة','kalima','2026-01-01'),
      (3001,2,'كتاب','kitab','2026-01-01'),(5001,2,'بعيد','baeed','2026-01-01'),
      (7001,2,'آخر','akhar','2026-01-01');
    INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES
      (11,1,2,'EG','A word',0),(211,1001,2,'LB','كلمة',1),
      (399,3001,9,'EG','A book',0),(511,5001,2,'MA','Far',0),(711,7001,2,'MA','Other',0);
    INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES (511,9,1),(399,8,0);
    INSERT INTO "word-reports"(id,userId,wordId,reportText) VALUES (99,9,1001,'Test');
    INSERT INTO "definition-reports"(id,userId,definitionId,reportText) VALUES (77,9,211,'Test');`);
  const queries=[];
  const db={prepare(query) {
    assert.match(query.replace(/^\s*\/\*[\s\S]*?\*\/\s*/,''),/^SELECT\b/i,'scope lookup must never write');
    const make=(values=[])=>({bind(...args){return make(args);},async all() {
      queries.push({query,values});return {success:true,results:sql.prepare(query).all(...values),meta:{rows_read:1,rows_written:0}};
    }});return make();
  }};
  t.after(()=>sql.close());
  return {sql,db,queries,resolve:(method,path,data={},userId=9)=>resolvePublicMutationScope(db,method,path,data,userId)};
}
function includes(scope,keys) {for(const key of keys)assert.ok(scope.includes(key),`missing ${key}: ${scope.join(', ')}`);}
function excludes(scope,keys) {for(const key of keys)assert.ok(!scope.includes(key),`unexpected ${key}`);}

test('posts and uncached account/auth changes never inspect or expire dictionary data',async t=>{
  const f=fixture(t);
  assert.deepEqual(await f.resolve('POST','/posts'),['posts']);
  assert.deepEqual(await f.resolve('PATCH','/users/9',{username:'renamed'}),[]);
  assert.deepEqual(await f.resolve('POST','/auth/login'),[]);
  assert.deepEqual(await f.resolve('GET','/word/1'),[]);
  assert.equal(f.queries.length,0);
});

test('word reports target every canonical alias and definition card bucket, preserving unrelated words',async t=>{
  const f=fixture(t),scope=await f.resolve('POST','/word-reports',{wordId:1});
  includes(scope,['word:1','word:1001','cards:0','cards:2','seo-shard:0','seo-shard:1',
    'feed:*','explore:*','seo-browse:*','seo-index','related:EG:*','related:LB:*','seo-dialect:Egypt','seo-dialect:Lebanon']);
  excludes(scope,['word:*','cards:*','word:3001','word:5001','word:7001','cards:3','cards:5','related:MA:*']);
  assert.deepEqual(scope,[...new Set(scope)].sort());
});

test('rename scopes include current, previously bound, and destination groups after a concurrent rename',async t=>{
  const f=fixture(t);
  f.sql.exec("UPDATE words SET arabicWord='بعيد' WHERE id=1");
  const scope=await f.resolve('PATCH','/word/1',{wordId:1,previousArabicWord:'كَلِمَة',arabicWord:'كِتاب'});
  includes(scope,['word:1','word:1001','word:3001','word:5001','cards:0','cards:2','cards:3','cards:5']);
  excludes(scope,['word:7001','word:*','seo-index']);
});

test('word POST uses the trusted existing word ID as well as its actual bound Arabic group',async t=>{
  const f=fixture(t);
  f.sql.exec("UPDATE words SET arabicWord='بعيد' WHERE id=1");
  const scope=await f.resolve('POST','/word',{wordId:1,arabicWord:'كلمة',francoArabicWord:'new form'});
  includes(scope,['word:1','word:1001','word:5001']);excludes(scope,['word:3001','word:7001']);
});

test('word trigger normalization preserves hamza and matches its limited ASCII whitespace folding',async t=>{
  const f=fixture(t),arabic='  أَلف          بَاء  ';
  f.sql.prepare("INSERT INTO words(id,userId,arabicWord,createdAt) VALUES (8001,2,?,'2026-01-01')").run(arabic);
  // Route validation trims before binding, while the trigger removes marks.
  const scope=await f.resolve('POST','/word',{arabicWord:arabic.trim()});
  includes(scope,['word:8001']);excludes(scope,['word:1','word:*']);
});

test('report DELETE resolves report IDs instead of confusing them with entity IDs',async t=>{
  const f=fixture(t);
  const word=await f.resolve('DELETE','/word-reports/99');
  const definition=await f.resolve('DELETE','/definition-reports/77');
  for(const scope of [word,definition]) {
    includes(scope,['word:1','word:1001','cards:2']);excludes(scope,['word:99','word:77','word:3001']);
  }
  f.sql.exec('DELETE FROM "definition-reports" WHERE id=77');
  const after=await f.resolve('DELETE','/definition-reports/77');
  includes([...new Set([...definition,...after])],['word:1','word:1001','cards:2']);
  excludes(after,['word:*','cards:*']);
});

test('contributions find existing normalized groups and only expire countries when creation is possible',async t=>{
  const f=fixture(t);
  const existing=await f.resolve('POST','/contributions',{arabicWord:'كَلمة',countryCode:'EG'});
  includes(existing,['word:1','word:1001','cards:0','cards:2']);excludes(existing,['countries','word:5001']);
  const newCountry=await f.resolve('POST','/contributions',{wordId:1,countryCode:'TN'});
  includes(newCountry,['countries','related:TN:*','seo-dialect:Tunisia']);
});

test('new contributions do not flush existing words and final resolution discovers assigned IDs',async t=>{
  const f=fixture(t),data={arabicWord:'مُستقبل',countryCode:'EG',requestId:'scope_request_0001'};
  const before=await f.resolve('POST','/contributions',data);
  excludes(before,['word:*','cards:*','word:1','countries']);
  f.sql.exec(`INSERT INTO words(id,userId,arabicWord,createdAt) VALUES (9001,9,'مستقبل','2026-01-01');
    INSERT INTO contribution_submissions(id,userId,payloadHash,wordId,createdAt) VALUES ('scope_request_0001',9,'hash',9001,'2026-01-01');
    INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic,submissionId) VALUES (901,9001,9,'EG','Future',0,'scope_request_0001');`);
  const after=await f.resolve('POST','/contributions',data);
  includes(after,['word:9001','cards:9','seo-shard:9']);excludes(after,['word:1','word:5001','word:*']);
});

test('definition create, edit and deletion retain all aliases and do not expire the sitemap index for text edits',async t=>{
  const f=fixture(t);
  const create=await f.resolve('POST','/definitions',{wordId:1,countryName:'Egypt'});
  includes(create,['word:1','word:1001','seo-index']);excludes(create,['countries','word:5001']);
  f.sql.exec("INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES (899,1,9,'EG','New',0)");
  includes(await f.resolve('POST','/definitions',{wordId:1,id:899,countryName:'Egypt'}),['cards:8']);
  const edit=await f.resolve('PATCH','/definitions/211',{definition:'Updated'});
  includes(edit,['word:1','word:1001','cards:0','cards:2','cards:8']);excludes(edit,['seo-index','countries','word:5001']);
  const beforeDelete=await f.resolve('DELETE','/definitions/211');
  f.sql.exec('DELETE FROM definitions WHERE id=211');
  const afterDelete=await f.resolve('DELETE','/definitions/211');
  includes([...new Set([...beforeDelete,...afterDelete])],['word:1001','cards:2','seo-index']);
  excludes(afterDelete,['word:*','cards:*']);
});

test('definition country creation scopes the new country while INSERT OR IGNORE on an existing code does not',async t=>{
  const f=fixture(t);
  includes(await f.resolve('POST','/definitions',{wordId:1,countryName:'New dialect'}),['countries','related:XX:*','seo-dialect:New%20dialect']);
  f.sql.exec("INSERT INTO countries VALUES ('XX','Unknown')");
  const scope=await f.resolve('POST','/definitions',{wordId:1,countryName:'New dialect'});
  excludes(scope,['countries']);includes(scope,['related:XX:*','seo-dialect:Unknown']);
});

test('country rename expires old and new names without expiring word snapshots',async t=>{
  const f=fixture(t),scope=await f.resolve('PATCH','/countries/EG',{countryName:'New Egypt'});
  includes(scope,['countries','seo-index','seo-dialect:Egypt','seo-dialect:New%20Egypt']);
  assert.ok(scope.every(key=>!key.startsWith('word:')&&!key.startsWith('cards:')));
  includes(await f.resolve('POST','/countries',{countryCode:'ZZ',countryName:'Literal*'}),['seo-dialect:*']);
});

test('country DELETE includes definitions referencing that country even when FK rejection or SET NULL may occur',async t=>{
  const f=fixture(t),scope=await f.resolve('DELETE','/countries/EG');
  includes(scope,['word:1','word:1001','word:3001','cards:0','cards:2','cards:3','countries','seo-index']);
  excludes(scope,['word:5001','word:7001']);
  assert.throws(()=>f.sql.exec("DELETE FROM countries WHERE countryCode='EG'"),/FOREIGN KEY constraint failed/);
});

test('account deletion includes owned words, authored meanings, and cascaded votes on other authors',async t=>{
  const f=fixture(t),scope=await f.resolve('DELETE','/users/9');
  includes(scope,['word:1','word:1001','word:3001','word:5001','cards:5','posts']);
  excludes(scope,['word:7001','cards:7','word:*']);
  const voter=await f.resolve('DELETE','/users/8');
  includes(voter,['word:3001','cards:3','posts']);excludes(voter,['word:1','word:1001','word:5001','word:7001']);
});

test('reaction scopes include the whole affected canonical group',async t=>{
  const f=fixture(t);
  for(const [method,path] of [['POST','/reactions/211/like'],['DELETE','/reactions/211/likes/9']]) {
    const scope=await f.resolve(method,path);includes(scope,['word:1','word:1001','cards:0','cards:2']);excludes(scope,['word:5001']);
  }
});

test('indexed keyset enumeration covers aliases and meanings spanning several pages',async t=>{
  const f=fixture(t);
  f.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<145)
    INSERT INTO words(id,userId,arabicWord,createdAt) SELECT 10000+x,2,'كلمة','2026-01-01' FROM n;
    WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<145)
    INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic)
      SELECT 20000+x*100,1,2,'EG','Meaning',x%2 FROM n;`);
  const scope=await f.resolve('POST','/word-reports',{wordId:1});
  includes(scope,['word:10145','cards:345','cards:344','word:1001']);excludes(scope,['word:5001','word:*']);
  const paged=f.queries.filter(({query})=>query.includes('LIMIT 128'));
  assert.ok(paged.length>3);assert.ok(paged.every(({query})=>query.includes('qamous-read:4000')));
});

test('failed lookups, corrupt canonical metadata, and selector overflow fail closed instead of flushing all words',async t=>{
  const f=fixture(t);
  await assert.rejects(resolvePublicMutationScope({prepare(){throw Error('Budget denied');}},'POST','/word-reports',{wordId:1},9),/Budget denied/);
  f.sql.exec('UPDATE words SET canonicalArabic=NULL WHERE id=1');
  await assert.rejects(f.resolve('POST','/word-reports',{wordId:1}),{status:503});
  f.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<4097)
    INSERT INTO words(id,userId,arabicWord,createdAt) SELECT 20000+x,2,'كثرة','2026-01-01' FROM n;`);
  await assert.rejects(f.resolve('POST','/word-reports',{wordId:20001}),{status:503});
});
