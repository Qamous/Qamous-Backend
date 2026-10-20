import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { attachProvenance, isImportPreview, licenseLink, registerProvenanceRoutes } from '../src/provenance.ts';
import { publicUser } from '../src/data.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql','0002_reaction_accounting.sql','0003_contributions.sql','0004_import_provenance.sql'])
    sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sql.exec("INSERT INTO users(id,firstName,lastName,email,username,createdAt,accountKind) VALUES(1,'Member','','member@example.invalid','member','2026-01-01','member'),(2,'qalam01','','qalam01@imports.invalid','qalam01','2026-10-19','import');" +
    "INSERT INTO words(id,userId,arabicWord,createdAt) VALUES(1,2,'كتاب','2026-10-19');" +
    "INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(1,1,2,'A book',0),(2,1,1,'Existing definition',0);" +
    "INSERT INTO import_sources VALUES('maknuune','Maknuune','https://example.org','CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/','licensed','Research authors','Copyright notice',1,'release','{}');" +
    "INSERT INTO import_batches(id,manifestHash,createdAt) VALUES(1,'hash','2026-10-19');" +
    "INSERT INTO import_records VALUES(1,'maknuune','sense1','https://example.org/entry',2,1,X'01','accepted','[]',1,'كتاب','','kitāb','Palestinian','','A book','{}',X'01',CURRENT_TIMESTAMP);" +
    "INSERT INTO import_change_templates VALUES(1,'[\"Extracted; text preserved.\"]');INSERT INTO definition_provenance VALUES(1,1,'en',1);" +
    "INSERT INTO definition_examples(definitionId,recordKey,text,language,script) VALUES(1,1,'A book.','en','Latin'),(1,1,'كتاب','ar','Arabic');");
  for(const name of ['0005_dictionary_read_indexes.sql','0006_word_meaning_forms.sql','0007_example_alignment.sql'])sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sql.exec("UPDATE definition_examples SET groupKeys='[\"1:0\"]',alignment='source',kind=CASE WHEN language='en' THEN 'translation' ELSE 'usage' END;");
  const calls = [];
  const db = { prepare(query) {
    const statement = args => ({
      bind: (...values) => statement(values),
      all: async () => { calls.push(query); return {results:sql.prepare(query).all(...args)}; },
      first: async () => sql.prepare(query).get(...args) ?? null,
    });
    return statement([]);
  } };
  return {sql,db,calls};
}
test('cards get original credit, linked license, importer disclosure, and labeled examples', async () => {
  const {sql,db,calls}=fixture();
  try {
    const result=await attachProvenance(db,[{definitionId:1},{definitionId:2}]);
    assert.equal(calls.length,4);
    assert.equal(result[0].sourceCredits[0].credit,'Research authors');
    assert.equal(result[0].sourceCredits[0].importer.username,'qalam01');
    assert.equal(result[0].sourceCredits[0].transliteration,'kitāb');
    assert.deepEqual(result[0].definitionLanguages,['en']);
    assert.deepEqual(result[0].sourceExamples.map(e=>e.language),['ar','en','ar-Latn']);
    assert.equal(result[0].sourceExamples[2].generated,true);
    assert.ok(result[0].sourceExamples.every(e=>e.groupId==='1:0'));
    assert.deepEqual(result[1].sourceCredits,[]);
    assert.deepEqual(result[1].sourcePronunciations,[]);
    assert.ok(!JSON.stringify(result).includes('imports.invalid'));
  } finally { sql.close(); }
});

test('pronunciations follow the linked meaning and source record, never every meaning of the word', async () => {
  const {sql,db}=fixture();
  try {
    sql.exec("INSERT INTO import_pronunciations VALUES(1,'translit','kitāb','ar','transcription'),(1,'CAPHI++','k i t aa b','ar','transcription');" +
      "INSERT INTO import_records SELECT 2,sourceId,'sense2',sourceUrl,importerUserId,batchId,X'02','accepted',reasons,wordId,arabic,franco,transliteration,dialect,definitionAr,definitionEn,originalMetadata,X'02',importedAt,displayFranco FROM import_records WHERE recordKey=1;" +
      "INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(3,1,2,'Another meaning',0);" +
      "INSERT INTO definition_provenance VALUES(3,2,'en',1);INSERT INTO import_pronunciations VALUES(2,'phonemic','/different/','ar','transcription');");
    const rows=await attachProvenance(db,[{definitionId:1},{definitionId:2},{definitionId:3}]);
    assert.deepEqual(rows[0].sourcePronunciations.map(p=>p.value).sort(),['k i t aa b','kitāb']);
    assert.equal(rows[0].sourcePronunciations[0].sourceEntryId,'sense1');
    assert.deepEqual(rows[1].sourcePronunciations,[]);
    assert.deepEqual(rows[2].sourcePronunciations.map(p=>p.value),['/different/']);
    assert.ok(!JSON.stringify(rows[0].sourcePronunciations).includes('imports.invalid'));
  } finally {sql.close();}
});
test('public definitions normalize source notation while preserving raw text, authorship and member contributions',async()=>{
 const {sql,db}=fixture();
 try {
  sql.exec("UPDATE definitions SET definition='polite;decent;relating_to_humans_[auto]' WHERE id=1;UPDATE definitions SET definition='keep_my_text_[auto]' WHERE id=2;");
  const rows=sql.prepare('SELECT id,definition,isArabic FROM definitions ORDER BY id').all();
  const result=await attachProvenance(db,rows);
  assert.equal(result[0].definition,'polite; decent; relating to humans');
  assert.equal(result[0].originalDefinition,rows[0].definition);
  assert.deepEqual(result[0].sourceDefinitionMarkers,['auto']);
  assert.ok(result[0].sourceCredits[0].changes.some(s=>s.includes('[auto]')));
  assert.equal(result[0].sourceCredits[0].credit,'Research authors');
  assert.equal(result[1].definition,'keep_my_text_[auto]');
  assert.equal(result[1].originalDefinition,undefined);
  assert.equal(sql.prepare('SELECT definition FROM definitions WHERE id=1').get().definition,rows[0].definition);
 } finally {sql.close();}
});
test('imported spellings follow the linked meaning and never borrow another dialect',async()=>{
 const {sql,db}=fixture();
 try {
  sql.exec("UPDATE import_records SET franco='ktab',displayFranco='ktab' WHERE recordKey=1;"+
   "INSERT INTO import_records SELECT 2,sourceId,'other-dialect',sourceUrl,importerUserId,batchId,X'02','accepted',reasons,wordId,'كِتاب','unrelated',transliteration,'Tunisian',definitionAr,definitionEn,originalMetadata,X'02',importedAt,'unrelated' FROM import_records WHERE recordKey=1;"+
   "INSERT INTO import_records SELECT 3,sourceId,'same-meaning',sourceUrl,importerUserId,batchId,X'03','accepted',reasons,wordId,'كِتاب','ktaab',transliteration,dialect,definitionAr,definitionEn,originalMetadata,X'03',importedAt,'ktaab' FROM import_records WHERE recordKey=1;"+
   "INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(3,1,2,'Another dialect meaning',0);"+
   "INSERT INTO definition_provenance VALUES(3,2,'en',1),(1,3,'en',1);");
  const globalVariants={arabicSpellings:['كلمة أخرى'],francoSpellings:['unrelated']};
  const rows=await attachProvenance(db,[{definitionId:1,...globalVariants},{definitionId:2,...globalVariants},{definitionId:3,...globalVariants}]);
  assert.equal(rows[0].francoArabicWord,'ktab');
  assert.deepEqual(rows[0].francoSpellings,['ktaab']);
  assert.deepEqual(rows[0].arabicSpellings,[]);
  assert.equal(rows[2].francoArabicWord,'unrelated');
  assert.deepEqual(rows[2].francoSpellings,[]);
  assert.deepEqual(rows[1].francoSpellings,['unrelated']);
  assert.equal(sql.prepare('SELECT franco FROM import_records WHERE recordKey=2').get().franco,'unrelated');
 } finally {sql.close();}
});

test('available definition languages describe the entire canonical word rather than just the matching search row',async()=>{
 const {sql,db}=fixture();
 try {
  sql.exec("INSERT INTO words(id,userId,arabicWord,createdAt) VALUES(2,1,'كِتاب','2026-10-20');INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(3,2,1,'تعريف بالعربية',1);");
  const [row]=await attachProvenance(db,[{definitionId:1}]);
  assert.deepEqual([...row.definitionLanguages].sort(),['ar','en']);
  sql.exec("UPDATE definitions SET displayLanguage='hidden' WHERE id=3;");
  const [hidden]=await attachProvenance(db,[{definitionId:1}]);
  assert.deepEqual(hidden.definitionLanguages,['en']);
 } finally {sql.close();}
});

test('preview routes require both an explicit local flag and a loopback hostname',()=>{
  assert.ok(isImportPreview('http://127.0.0.1:8795/imports/preview/report',{LOCAL_IMPORT_PREVIEW:'true'}));
  assert.equal(isImportPreview('https://api.qamous.org/imports/preview/report',{LOCAL_IMPORT_PREVIEW:'true'}),false);
  assert.equal(isImportPreview('http://localhost/imports/preview/report',{}),false);
});
test('multiple-license source notices still link directly to the applicable CC license',()=>{
  assert.equal(licenseLink('Arabic CC BY-SA 3.0 + PWN notice','https://omwn.org/omw1.html'),'https://creativecommons.org/licenses/by-sa/3.0/');
  assert.equal(licenseLink('Unverified','https://example.org'),'https://example.org');
});
test('public collection profiles omit private account controls',()=>{
  const user=publicUser({id:2,firstName:'qalam01',username:'qalam01',accountKind:'import',email:'qalam01@imports.invalid'});
  assert.equal(user.loginEnabled,undefined);
  assert.equal(user.accountKind,undefined);
  assert.ok(!('email' in user));
});
test('GPL source exports include original notice, license, transcription and per-entry changes, excluding holds', async()=>{
  const {sql,db}=fixture();
  try {
    sql.exec("INSERT INTO import_sources VALUES('aramorph','AraMorph','https://example.org','GPL-2.0-only','https://www.gnu.org/licenses/old-licenses/gpl-2.0.html','licensed','Tim Buckwalter','Copyright 2002 QAMUS LLC and Trustees of the University of Pennsylvania',1,'release','{}');" +
      "INSERT INTO import_license_documents VALUES('aramorph','COPYING.txt','GNU GENERAL PUBLIC LICENSE version 2');" +
      "INSERT INTO import_records VALUES(2,'aramorph','kitAb_1','https://example.org/entry',2,1,X'02','accepted','[]',1,'كتاب','','kitAb','Modern Standard Arabic','','book','{\"changes\":\"Buckwalter decoded\"}',X'02',CURRENT_TIMESTAMP,NULL);" +
      "INSERT INTO import_records VALUES(3,'aramorph','held','https://example.org/held',2,1,X'03','held','[]',NULL,'كلمة','','','Modern Standard Arabic','','held meaning','{}',X'03',CURRENT_TIMESTAMP,NULL);");
    sql.exec("INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(3,1,2,'book;volume',0);INSERT INTO definition_provenance VALUES(3,2,'en',1);");
    const app=new Hono();
    registerProvenanceRoutes(app);
    const response=await app.request('http://localhost/sources/aramorph/export',{}, {DB:db});
    assert.equal(response.status,200);
    const rows=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(rows.length,2);
    assert.match(rows[0].notice,/QAMUS LLC/);
    assert.match(rows[0].licenseText,/version 2/);
    assert.equal(rows[1].transliteration,'kitAb');
    assert.equal(rows[1].originalMetadata.changes,'Buckwalter decoded');
    assert.equal(rows[1].recordKey,2);
    assert.equal(rows[1].definitions[0].definition,'book;volume');
    assert.equal(rows[1].definitions[0].displayDefinition,'book; volume');
    assert.ok(rows[1].definitions[0].changes.some(c=>c.includes('formatting normalized')));
  } finally {sql.close();}
});
