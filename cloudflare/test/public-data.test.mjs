import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { RELATED_CARDS_SQL, resolvePublicData, publicItemsFromBuckets, publicItemBuckets, publicItemsKey, personalReactions, exploreCacheKey } from '../src/public-data.ts';
import {validPublicCacheKey} from '../src/public-cache-keys.ts';
import {preparedFeedCandidatesSql} from '../src/feed.ts';
import { exploreQuery } from '../src/explore.ts';

function fixture() {
  const sql=new DatabaseSync(':memory:');
  for(const migration of ['0001_initial.sql','0003_contributions.sql','0004_import_provenance.sql','0005_dictionary_read_indexes.sql','0006_word_meaning_forms.sql','0007_example_alignment.sql','0008_seo_discovery.sql']) sql.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
  sql.exec(`INSERT INTO countries VALUES ('EG','Egypt');
    INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Test','','private@example.invalid','tester','2026-01-01');
    INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES(1,1,'كلمة','kalima','2026-01-01'),(2,1,'يلا','yalla','2026-01-01');
    INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic,likeCount) VALUES
      (1,1,1,'EG','First meaning',0,10),(2,1,1,'EG','Another meaning',0,1),(3,1,1,'EG','تعريف',1,2),(4,2,1,'EG','Go',0,1);
    INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(2,1,1);`);
  const reads=[];
  const db={prepare(query){const make=(args=[])=>({bind(...next){return make(next);},async all(){const results=sql.prepare(query).all(...args);reads.push({query,args,rows:results.length});return {success:true,results,meta:{}};},async first(){reads.push({query,args});return sql.prepare(query).get(...args)||null;}});return make();},async batch(statements){return Promise.all(statements.map(s=>s.all()));}};
  return {sql,db,reads};
}

test('SEO public word reuses all visible senses and keeps personal flags and private data out',async()=>{
  const {sql,db}=fixture();try {
    const rows=await resolvePublicData(db,'word:1');
    assert.deepEqual(rows.map(row=>row.id),[1,2,3]);
    assert.ok(rows.every(row=>row.definitionId===row.id && row.word.id===1 && row.canonicalWordId===1));
    assert.ok(rows.every(row=>row.isLiked===false && row.isDisliked===false && row.isReported===false));
    assert.ok(!JSON.stringify(rows).includes('private@example.invalid'));
    const personalized=await personalReactions(db,rows,1);
    assert.equal(personalized.find(row=>row.id===2).isLiked,true);
    assert.equal(rows.find(row=>row.id===2).isLiked,false);
  } finally {sql.close();}
});

test('feed hydration assembles arbitrary random IDs from public buckets without another database scan',async()=>{
  const {sql,db}=fixture();try {
    const params=new URLSearchParams('ids=4,2,3,999&script=franco');
    assert.deepEqual(publicItemBuckets(params),['cards:0','cards:9']);
    const values=await Promise.all(publicItemBuckets(params).map(key=>resolvePublicData(db,key)));
    const result=publicItemsFromBuckets(params,values);
    assert.deepEqual(result.results.map(row=>row.definitionId),[4,2]);assert.equal(result.total,2);assert.equal(result.limit,4);
    sql.exec('UPDATE definitions SET reportCount=6 WHERE id=2');
    const refreshed=publicItemsFromBuckets(params,[await resolvePublicData(db,'cards:0')]);
    assert.deepEqual(refreshed.results.map(row=>row.definitionId),[4]);
  } finally {sql.close();}
});

test('cold random feed reads only requested definitions and keeps identical card serialization and order',async()=>{
  const {sql,db,reads}=fixture();try {
    const insert=sql.prepare("INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES(?,2,1,'EG',?,0)");
    for(let id=100;id<1100;id++)insert.run(id,'Meaning '+id);
    const params=new URLSearchParams({ids:Array.from({length:10},(_,i)=>1001-i*100).join(','),script:'franco'});
    const legacy=await Promise.all(publicItemBuckets(params).map(key=>resolvePublicData(db,key)));
    const before={queries:reads.length,definitions:legacy.flat().length};
    reads.length=0;
    const exact=await resolvePublicData(db,publicItemsKey(params));
    assert.deepEqual(publicItemsFromBuckets(params,[exact]),publicItemsFromBuckets(params,legacy));
    assert.deepEqual(before,{queries:90,definitions:1000});
    assert.equal(reads.length,5,'one exact-ID content query and four batched enrichment queries');
    assert.equal(exact.length,10,'no unrelated definitions are loaded or enriched');
    assert.equal(reads[0].rows,10);
    assert.deepEqual(reads[0].args,Array.from({length:10},(_,i)=>101+i*100));
    assert.equal(publicItemsKey(new URLSearchParams('ids=4,2,3')),publicItemsKey(new URLSearchParams('ids=3,4,2')));
    sql.exec('UPDATE definitions SET reportCount=6 WHERE id=101');
    assert.equal((await resolvePublicData(db,publicItemsKey(params))).some(row=>row.definitionId===101),false);
  } finally {sql.close();}
});

test('exact item cache keys bound the ID set and forbid duplicate or alternate encodings',()=>{
  for(const key of ['items:1','items:1,2,9007199254740991'])assert.equal(validPublicCacheKey(key),true,key);
  for(const key of ['items:','items:0','items:01','items:2,1','items:1,1','items:9007199254740992','items:'+Array.from({length:51},(_,i)=>i+1).join(',')])assert.equal(validPublicCacheKey(key),false,key);
});

test('prepared cards satisfy an arbitrary feed slice in one read and rebuild only missing payloads without writes',async()=>{
  const {sql,db,reads}=fixture();try {
    sql.exec('CREATE TABLE public_card_payloads(definitionId INTEGER PRIMARY KEY,payload TEXT NOT NULL)');
    const params=new URLSearchParams('ids=4,2,3&script=both'),key=publicItemsKey(params);
    const original=await resolvePublicData(db,key);
    for(const row of original)sql.prepare('INSERT INTO public_card_payloads VALUES(?,?)').run(row.definitionId,JSON.stringify(row));
    const changes=()=>sql.prepare('SELECT total_changes() AS n').get().n;
    const before=changes();reads.length=0;
    const ready=await resolvePublicData(db,key,true);
    assert.deepEqual(ready,original);assert.equal(reads.length,1);
    assert.equal(changes(),before,'GET never rewrites prepared cards');
    assert.ok(sql.prepare('EXPLAIN QUERY PLAN SELECT definitionId,payload FROM public_card_payloads WHERE definitionId IN (?,?,?)').all(2,3,4).some(row=>row.detail.includes('INTEGER PRIMARY KEY')));
    sql.exec('DELETE FROM public_card_payloads WHERE definitionId=3');reads.length=0;
    assert.deepEqual(await resolvePublicData(db,key,true),original);
    assert.deepEqual(reads[1].args,[3],'only the missing card receives content/provenance reads');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM public_card_payloads').get().n,2,'a read does not repopulate D1');
    sql.prepare('UPDATE public_card_payloads SET payload=? WHERE definitionId=2').run(JSON.stringify({...original[0],isLiked:true}));
    await assert.rejects(resolvePublicData(db,key,true),/Private data/);
  } finally {sql.close();}
});

test('prepared feed refresh reads only the selected language from a covering index',async()=>{
  const {sql,db,reads}=fixture();try {
    sql.exec(`CREATE TABLE public_feed_candidates(definitionId INTEGER PRIMARY KEY,isArabic INTEGER,likeCount INTEGER,dislikeCount INTEGER);
      CREATE INDEX public_feed_candidates_language ON public_feed_candidates(isArabic,definitionId,likeCount,dislikeCount);`);
    const languages=await Promise.all([resolvePublicData(db,'feed:0'),resolvePublicData(db,'feed:1')]);
    const insert=sql.prepare('INSERT INTO public_feed_candidates VALUES(?,?,?,?)');
    for(let language=0;language<2;language++)for(const row of languages[language])insert.run(row.definitionId,language,row.likeCount,row.dislikeCount);
    reads.length=0;
    assert.deepEqual(await resolvePublicData(db,'feed:0',true),languages[0]);
    assert.equal(reads.length,1);
    assert.equal(reads[0].rows,languages[0].length);
    assert.ok(sql.prepare('EXPLAIN QUERY PLAN '+preparedFeedCandidatesSql).all(0).some(row=>row.detail.includes('COVERING INDEX public_feed_candidates_language')));
    assert.ok(!reads[0].query.includes('JOIN'));
  } finally {sql.close();}
});

test('related words materialize at most 100 country IDs before visibility and language work',()=>{
  const {sql}=fixture();try {
    assert.ok(sql.prepare('EXPLAIN QUERY PLAN '+RELATED_CARDS_SQL).all('EG',0).some(row=>row.detail.includes('MATERIALIZE sample')));
    assert.ok(sql.prepare('EXPLAIN QUERY PLAN '+RELATED_CARDS_SQL).all('EG',0).some(row=>row.detail.includes('definitions_country')));
    const insert=sql.prepare("INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic,reportCount) VALUES(?,2,1,'EG','Hidden',0,6)");
    for(let id=5;id<=105;id++) insert.run(id);
    sql.exec("UPDATE definitions SET reportCount=6 WHERE id<=100;UPDATE definitions SET reportCount=0 WHERE id=105;");
    assert.deepEqual(sql.prepare(RELATED_CARDS_SQL).all('EG',0),[]);
  } finally {sql.close();}
});

test('filtered Explore count omits sorting, ranking and spelling expansion, and limits offset work',()=>{
  const count=exploreQuery(new URLSearchParams('country=EG&script=franco')).countSql;
  assert.ok(!/ROW_NUMBER|word_spellings|ORDER BY/.test(count));
  assert.throws(()=>exploreQuery(new URLSearchParams('limit=50&page=10000')),{status:400});
  assert.equal(exploreCacheKey(new URLSearchParams('country=eg&country=LB&track=1')),exploreCacheKey(new URLSearchParams('country=LB&country=EG&track=2')));
});
