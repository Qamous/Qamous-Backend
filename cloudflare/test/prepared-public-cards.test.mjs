import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {publicItems,publicWord,resolvePublicData} from '../src/public-data.ts';
import {feedCandidatesSql,preparedFeedCandidatesSql} from '../src/feed.ts';
import {storePreparedCards} from '../src/public-card-payloads.ts';

function fixture() {
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sql.exec(`INSERT INTO countries VALUES('EG','Egypt');
    INSERT INTO users(id,firstName,lastName,email,username,createdAt,accountKind) VALUES
      (1,'Member','','member@example.invalid','member','2026-01-01','member'),
      (2,'Importer','','importer@example.invalid','importer','2026-01-01','import');
    INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES
      (1,2,'كتاب','kitab','2026-01-01'),(2,1,'كِتاب','kitaab','2026-01-01'),(3,1,'يلا','yalla','2026-01-01');
    INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic,likeCount,dislikeCount) VALUES
      (1,1,2,'EG','A book',0,4,1),(2,2,1,'EG','Another meaning',0,1,0),
      (3,3,1,'EG','Go',0,1,0),(4,1,1,'EG','مؤلف',1,0,0);
    INSERT INTO import_sources VALUES('maknuune','Maknuune','https://example.org','CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/','licensed','Research authors','Copyright notice',1,'release','{}');
    INSERT INTO import_batches(id,manifestHash,createdAt) VALUES(1,'hash','2026-10-19');
    INSERT INTO import_records(recordKey,sourceId,sourceEntryId,sourceUrl,importerUserId,batchId,contentHash,status,reasons,wordId,arabic,franco,transliteration,dialect,definitionAr,definitionEn,originalMetadata,fingerprint,importedAt)
      VALUES(1,'maknuune','entry1','https://example.org/entry',2,1,X'01','accepted','[]',1,'كتاب','','kitāb','Egyptian','','A book','{}',X'01',CURRENT_TIMESTAMP);
    INSERT INTO import_change_templates VALUES(1,'["Extracted; text preserved."]');
    INSERT INTO definition_provenance VALUES(1,1,'en',1);
    INSERT INTO definition_examples(definitionId,recordKey,text,language,script) VALUES(1,1,'كتاب جميل','ar','Arabic');`);
  const reads=[];
  const db={prepare(query){const make=(args=[])=>({bind(...values){return make(values);},async first(){return (await this.all()).results[0]??null;},async all(){
    const before=sql.prepare('SELECT total_changes() AS n').get().n;
    const results=sql.prepare(query).all(...args);reads.push({query,args,rows:results.length});
    return {success:true,results,meta:{changes:sql.prepare('SELECT total_changes() AS n').get().n-before,rows_read:0,rows_written:0}};
  }});return make();},async batch(statements){sql.exec('BEGIN');try{const results=await Promise.all(statements.map(statement=>statement.all()));sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const seed=async()=>storePreparedCards(db,await publicItems(db,[1,2,3,4]));
  const saved=()=>sql.prepare('SELECT definitionId FROM public_card_payloads ORDER BY definitionId').all().map(row=>row.definitionId);
  const candidates=()=>[0,1].map(language=>sql.prepare(preparedFeedCandidatesSql).all(language));
  const authoritative=()=>[0,1].map(language=>sql.prepare(feedCandidatesSql).all(language).sort((a,b)=>a.definitionId-b.definitionId));
  return {sql,db,reads,seed,saved,candidates,authoritative};
}

test('prepared-card migration keeps votes and selected language candidates consistent through representative and visibility changes',()=>{
  const f=fixture();try {
    const same=()=>assert.deepEqual(f.candidates(),f.authoritative());
    same();
    f.sql.exec('UPDATE definitions SET likeCount=6,dislikeCount=3 WHERE id=1');same();
    assert.deepEqual({...f.candidates()[0].find(row=>row.definitionId===1)},{definitionId:1,likeCount:6,dislikeCount:3});
    f.sql.exec('UPDATE definitions SET likeCount=100 WHERE id=2');same();
    assert.deepEqual(f.candidates()[0].map(row=>row.definitionId),[2,3]);
    f.sql.exec('UPDATE definitions SET reportCount=6 WHERE id=2');same();
    f.sql.exec("UPDATE words SET arabicWord='قصة',francoArabicWord='qissa' WHERE id=2");same();
    f.sql.exec('UPDATE definitions SET reportCount=0 WHERE id=2');same();
    f.sql.exec("UPDATE words SET arabicWord='كتاب' WHERE id=2");same();
    f.sql.exec('UPDATE words SET reportCount=6 WHERE id=1');same();
    f.sql.exec("UPDATE definitions SET displayLanguage='hidden' WHERE id=3");same();
    f.sql.exec('DELETE FROM definitions WHERE id=4');same();
    f.sql.exec('DELETE FROM definitions WHERE wordId=2;DELETE FROM words WHERE id=2');same();
  } finally {f.sql.close();}
});

test('prepared cards use one exact lookup with complete credits, forms and examples, and dirty source payloads rebuild only their card',async()=>{
  const f=fixture();try {
    const expected=await publicItems(f.db,[1,3]);
    assert.equal(await f.seed(),4);
    assert.deepEqual(f.saved(),[1,2,3,4]);f.reads.length=0;
    const fast=await publicItems(f.db,[1,3],true);
    assert.deepEqual(fast,expected);assert.equal(f.reads.length,1);
    assert.equal(fast[0].sourceCredits[0].importer.username,'importer');
    assert.ok(fast[0].meaningForms.length);assert.ok(fast[0].sourceExamples.length);
    f.sql.exec("UPDATE definition_examples SET text='كتاب جديد' WHERE definitionId=1");
    assert.deepEqual(f.saved(),[2,3,4]);f.reads.length=0;
    const rebuilt=await publicItems(f.db,[1,3],true);
    assert.ok(rebuilt[0].sourceExamples.some(example=>example.text==='كتاب جديد'));
    assert.deepEqual(rebuilt[1],expected[1]);
    assert.deepEqual(f.reads[1].args,[1]);
    assert.deepEqual(f.saved(),[2,3,4],'fallback GET never writes to the prepared table');
  } finally {f.sql.close();}
});

test('prepared word pages preserve every alias and their exact nested serialization with one query',async()=>{
  const f=fixture();try {
    const expected=[];for(const id of [1,2,3])expected.push(await publicWord(f.db,id,false));
    await f.seed();
    for(const [index,id] of [1,2,3].entries()) {
      f.reads.length=0;
      assert.deepEqual(await publicWord(f.db,id,true),expected[index]);
      assert.equal(f.reads.length,1,'all prepared senses need one indexed group lookup');
    }
    f.sql.exec('UPDATE definitions SET reportCount=5 WHERE id=1');
    assert.deepEqual(await publicWord(f.db,1,true),await publicWord(f.db,1,false),'combined word/definition threshold remains stricter than cards');
    await assert.rejects(publicWord(f.db,999,true),{status:404});
  } finally {f.sql.close();}
});

test('only public importer name changes invalidate credited payloads; private account bookkeeping keeps cards prepared',async()=>{
  const f=fixture();try {
    await f.seed();
    f.sql.exec("UPDATE users SET points=points+1,likesReceived=likesReceived+1,email='changed@example.invalid' WHERE id=2");
    assert.deepEqual(f.saved(),[1,2,3,4]);
    f.sql.exec("UPDATE users SET username='importer' WHERE id=2");assert.deepEqual(f.saved(),[1,2,3,4]);
    f.sql.exec("UPDATE users SET username='renamed_importer' WHERE id=2");
    assert.deepEqual(f.saved(),[2,3,4]);
    assert.equal((await publicItems(f.db,[1],true))[0].sourceCredits[0].importer.username,'renamed_importer');
  } finally {f.sql.close();}
});

test('canonical-group changes discard dependent cards while unrelated words remain prepared',async()=>{
  const f=fixture();try {
    await f.seed();
    f.sql.exec("INSERT INTO word_spellings(wordId,userId,spelling,script,searchText,createdAt) VALUES(2,1,'كِتَاب','ar','كتاب','2026-01-01')");
    assert.deepEqual(f.saved(),[3]);
    await f.seed();
    f.sql.exec('UPDATE definitions SET reportCount=6 WHERE id=1');
    assert.deepEqual(f.saved(),[3]);
    assert.deepEqual((await publicItems(f.db,[1,2,3,4],true)).map(row=>row.definitionId),[2,3,4]);
    await f.seed();
    f.sql.exec('DELETE FROM definitions WHERE id=2');
    assert.deepEqual(f.saved(),[3]);
    f.sql.exec('DELETE FROM definitions WHERE id=3');assert.deepEqual(f.saved(),[]);
  } finally {f.sql.close();}
});

test('prepared card writes reject personal data, duplicate IDs and oversized requests before submitting SQL',async()=>{
  const f=fixture();try {
    const row=(await publicItems(f.db,[1]))[0];f.reads.length=0;
    await assert.rejects(storePreparedCards(f.db,[{...row,isLiked:true}]),/Private data/);
    await assert.rejects(storePreparedCards(f.db,[row,row]),/Invalid prepared/);
    await assert.rejects(storePreparedCards(f.db,Array.from({length:51},(_,i)=>({...row,id:i+1,definitionId:i+1}))),/Too many/);
    assert.equal(f.reads.length,0);assert.deepEqual(f.saved(),[]);
    await f.seed();
    f.sql.exec("UPDATE import_sources SET credit='Updated research credit' WHERE id='maknuune'");
    assert.deepEqual(f.saved(),[2,3,4]);
    assert.equal((await resolvePublicData(f.db,'items:1',true))[0].sourceCredits[0].credit,'Updated research credit');
  } finally {f.sql.close();}
});
