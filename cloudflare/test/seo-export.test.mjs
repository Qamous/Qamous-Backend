import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';

test('SEO queries expose only public vocabulary and visible country memberships',async()=>{
  const script=await readFile(new URL('../scripts/export-seo.mjs',import.meta.url),'utf8');
  const sql=script.match(/const sql=`([\s\S]*?)`;/)?.[1];assert.ok(sql);
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE words(id INTEGER,arabicWord TEXT,francoArabicWord TEXT,reportCount INTEGER,userId INTEGER);
      CREATE TABLE countries(countryCode TEXT,countryName TEXT);
      CREATE TABLE definitions(id INTEGER,wordId INTEGER,isArabic INTEGER,definition TEXT,reportCount INTEGER,likeCount INTEGER,dislikeCount INTEGER,countryCode TEXT);
      CREATE VIEW public_definitions AS SELECT * FROM definitions;
      INSERT INTO countries VALUES('EG','Egypt'),('LB','Lebanon');
      INSERT INTO words VALUES(1,'كلمة','word',0,123),(2,'مخفية','hidden',2,456),(3,'محظورة','blocked',5,789);
      INSERT INTO definitions VALUES(1,1,0,'Public meaning',0,2,0,'EG'),(2,1,1,'معنى',0,1,0,'EG'),
        (3,2,0,'Combined reports hide this',3,100,0,'LB'),(4,3,0,'Hidden word',0,100,0,'LB'),
        (5,1,0,'Hidden definition',5,100,0,'LB');`);
    const [words,countries,memberships]=sql.split(';').filter(part=>part.trim()).map(query=>db.prepare(query).all());
    assert.equal(words.length,1);assert.equal(words[0].descriptionEn,'Public meaning');assert.equal(words[0].descriptionAr,'معنى');
    assert.deepEqual(Object.keys(words[0]).sort(),['id','arabicWord','francoArabicWord','descriptionEn','descriptionAr'].sort());
    assert.deepEqual(countries.map(row=>({...row})),[{countryCode:'EG',countryName:'Egypt'}]);
    assert.deepEqual(memberships.map(row=>({...row})),[{wordId:1,countryCode:'EG'}]);
  } finally {db.close();}
});
