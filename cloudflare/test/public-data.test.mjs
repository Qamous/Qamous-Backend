import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { RELATED_CARDS_SQL, resolvePublicData, publicItemsFromBuckets, publicItemBuckets, personalReactions, exploreCacheKey } from '../src/public-data.ts';
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
  const db={prepare(query){const make=(args=[])=>({bind(...next){return make(next);},async all(){return {success:true,results:sql.prepare(query).all(...args),meta:{}};},async first(){return sql.prepare(query).get(...args)||null;}});return make();},async batch(statements){return Promise.all(statements.map(s=>s.all()));}};
  return {sql,db};
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
