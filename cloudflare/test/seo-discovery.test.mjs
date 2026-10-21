import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {SEO_BROWSE_SQL,SEO_SHARD_SQL,SEO_BUCKET_SIZE,seoBucket} from '../src/seo.ts';

const migration=await readFile(new URL('../migrations/0008_seo_discovery.sql',import.meta.url),'utf8');

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE words(id INTEGER PRIMARY KEY,canonicalArabic TEXT NOT NULL,francoArabicWord TEXT,reportCount INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE definitions(id INTEGER PRIMARY KEY,wordId INTEGER NOT NULL,isArabic INTEGER NOT NULL,reportCount INTEGER NOT NULL DEFAULT 0,displayLanguage TEXT NOT NULL DEFAULT 'en',countryCode TEXT);
    CREATE VIEW public_definitions AS SELECT * FROM definitions WHERE displayLanguage!='hidden';
    CREATE TABLE dictionary_cards(canonicalArabic TEXT NOT NULL,isArabic INTEGER NOT NULL,wordId INTEGER NOT NULL,sortWord TEXT NOT NULL,PRIMARY KEY(canonicalArabic,isArabic));
    CREATE TABLE countries(countryCode TEXT PRIMARY KEY,countryName TEXT);
    CREATE INDEX words_canonical_arabic ON words(canonicalArabic,id);
    CREATE INDEX definitions_word ON definitions(wordId,isArabic);`);
  return db;
}

test('sitemap ranges cover public canonical words and keep future inserts current',()=>{
  const db=database();
  try {
    db.exec(`INSERT INTO words VALUES(1,'visible','visible',0),(2,'visible','visible',0),(999,'hidden','hidden',0),(1000,'arabic-only',NULL,0),(1001,'reported','reported',3),(250001,'future','future',0);
      INSERT INTO definitions VALUES(1,1,0,0,'en','EG'),(2,2,1,0,'ar','EG'),(3,999,0,0,'hidden','EG'),(4,1000,1,0,'ar','EG'),(5,1001,0,2,'en','EG'),(6,250001,0,0,'en','EG');`);
    db.exec(migration);
    const buckets=db.prepare('SELECT bucket FROM seo_sitemap_buckets ORDER BY bucket').all().map(row=>row.bucket);
    assert.deepEqual(buckets,[0,1,250]);
    const shard=bucket=>db.prepare(SEO_SHARD_SQL).all(bucket*SEO_BUCKET_SIZE,(bucket+1)*SEO_BUCKET_SIZE);
    assert.deepEqual(shard(0).filter(row=>row.en||row.ar).map(row=>[row.id,row.en,row.ar]),[[1,1,1]]);
    assert.deepEqual(shard(1).filter(row=>row.en||row.ar).map(row=>[row.id,row.en,row.ar]),[[1000,0,1]]);
    assert.deepEqual(shard(250).filter(row=>row.en||row.ar).map(row=>[row.id,row.en,row.ar]),[[250001,1,0]]);
    db.exec(`INSERT INTO words VALUES(500001,'new-import','new-import',0);
      INSERT INTO definitions VALUES(7,500001,0,0,'en','EG');`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_sitemap_buckets WHERE bucket=500').get().n,1);
    assert.deepEqual(shard(500).filter(row=>row.en).map(row=>row.id),[500001]);
    db.exec('DELETE FROM words WHERE id=500001');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_sitemap_buckets WHERE bucket=500').get().n,0);
    assert.throws(()=>seoBucket('1e6'));
    assert.throws(()=>seoBucket('-1'));
  } finally {db.close();}
});

test('alphabetical keyset pages reach every public word beyond 100,000 entries',()=>{
  const db=database();
  try {
    db.exec(`WITH RECURSIVE ids(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM ids WHERE id<100160)
      INSERT INTO words(id,canonicalArabic,francoArabicWord,reportCount) SELECT id,printf('term%06d',id),printf('term%06d',id),0 FROM ids;
      INSERT INTO definitions(id,wordId,isArabic,reportCount,displayLanguage,countryCode)
      SELECT id,id,0,0,'en','EG' FROM words;
      INSERT INTO dictionary_cards(canonicalArabic,isArabic,wordId,sortWord)
      SELECT canonicalArabic,0,id,francoArabicWord FROM words;
      UPDATE definitions SET reportCount=5 WHERE id=25;
      UPDATE definitions SET displayLanguage='hidden' WHERE id=26;`);
    db.exec(migration);
    let sortWord='',canonicalArabic='',seen=0,last=0,pages=0;
    const query=db.prepare(SEO_BROWSE_SQL);
    for(;;) {
      const rows=query.all(0,sortWord,sortWord,sortWord,canonicalArabic,81);
      const page=rows.slice(0,80);
      seen+=page.length;pages++;
      if(!page.length||rows.length<=80) break;
      const tail=page.at(-1);sortWord=tail.sortWord;canonicalArabic=tail.canonicalArabic;last=tail.wordId;
    }
    assert.equal(seen,100158);
    assert.ok(pages>1200);
    assert.ok(last>250);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_sitemap_buckets').get().n,101);
  } finally {db.close();}
});
