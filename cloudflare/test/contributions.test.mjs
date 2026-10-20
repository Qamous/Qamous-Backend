import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseContribution, saveContribution } from '../src/contributions.ts';
import { exploreQuery } from '../src/explore.ts';
import {attachProvenance} from '../src/provenance.ts';
import {stripTashkil,countryForDialect} from '../src/arabic-model.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql','0002_reaction_accounting.sql','0003_contributions.sql','0004_import_provenance.sql','0005_dictionary_read_indexes.sql','0006_word_meaning_forms.sql']) sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sql.exec(`INSERT INTO countries VALUES('EG','Egypt');
    INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'A','','a@example.invalid','author','2026-01-01'),(2,'B','','b@example.invalid','reader','2026-01-01');`);
  const db = {
    prepare(query) {
      return { bind(...args) { return {
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({ results: sql.prepare(query).all(...args) }),
        query, args,
      }; } };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map(({query,args}) => ({results:sql.prepare(query).all(...args)}));
        sql.exec('COMMIT'); return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, db };
}
const draft = (extra = {}) => parseContribution({requestId:'test-request-1234567890',arabicWord:'معلش',francoArabicWord:'ma3lish',
  arabicDefinition:'لا بأس',englishDefinition:'Never mind',countryCode:'EG',arabicExample:'معلش، هتتعوض.',francoExample:'Ma3lish, hatet3awwad.',
  arabicSpellings:['معليش'],francoSpellings:['ma3lesh','MA3LESH'],...extra});

test('requires an Arabic word and at least one meaning; optional fields can be empty',()=>{
  assert.throws(()=>draft({arabicDefinition:' ',englishDefinition:null}),/at least one/);
  assert.throws(()=>draft({arabicWord:'Latin'}),/Arabic/);
  assert.throws(()=>draft({francoSpellings:['معليش']}),/correct script/);
  assert.equal(draft({francoArabicWord:null,arabicDefinition:null}).englishDefinition,'Never mind');
  assert.deepEqual(draft().francoSpellings,['ma3lesh']);
});

test('saves bilingual meanings, script-specific examples and aliases atomically with correct points',async()=>{
  const {sql,db}=fixture();const result=await saveContribution(db,1,draft(),'hash');
  assert.equal(result.definitionIds.length,2);
  const rows=sql.prepare('SELECT * FROM definitions ORDER BY id').all();
  assert.equal(rows[0].arabicExample,'معلش، هتتعوض.');assert.equal(rows[0].example,'Ma3lish, hatet3awwad.');
  assert.deepEqual(rows.map(row=>row.contributionPoints),[2,1]);
  assert.equal(sql.prepare('SELECT points FROM users WHERE id=1').get().points,3);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM word_spellings').get().n,2);
  const plan=exploreQuery(new URLSearchParams('q=ma3lesh&scope=words'));
  assert.equal(sql.prepare(plan.resultsSql).all(...plan.values,0,0,0,plan.limit,0).length,2);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);sql.close();
});

test('retries and overlapping requests cannot duplicate meanings or award points twice',async()=>{
  const {sql,db}=fixture();const input=draft();
  const results=await Promise.all(Array.from({length:5},()=>saveContribution(db,1,input,'hash')));
  assert.ok(results.every(result=>result.wordId===results[0].wordId));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM definitions').get().n,2);
  assert.equal(sql.prepare('SELECT points FROM users WHERE id=1').get().points,3);
  await assert.rejects(saveContribution(db,1,draft({arabicWord:'جديد'}),'other-hash'),error=>error.status===409);
  await assert.rejects(saveContribution(db,2,input,'hash'),error=>error.status===409);sql.close();
});

test('a failed meaning rolls back its new word, country, request and spellings',async()=>{
  const {sql,db}=fixture();
  sql.exec(`CREATE TRIGGER fail_meaning BEFORE INSERT ON definitions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`);
  await assert.rejects(saveContribution(db,1,draft({countryCode:'LB'}),'hash'),/synthetic failure/);
  for (const table of ['words','definitions','word_spellings','contribution_submissions']) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM countries').get().n,1);sql.close();
});

test('adds meanings to an existing word, and deleting a meaning cannot make a retry recreate it',async()=>{
  const {sql,db}=fixture();const saved=await saveContribution(db,1,draft(),'hash');
  const extra=draft({requestId:'another-request-1234567890',wordId:saved.wordId,arabicDefinition:null,englishDefinition:'It is okay',countryCode:null,arabicSpellings:[],francoSpellings:[]});
  const added=await saveContribution(db,2,extra,'extra-hash');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM words').get().n,1);
  assert.equal(sql.prepare('SELECT points FROM users WHERE id=2').get().points,1);
  sql.prepare('DELETE FROM definitions WHERE id=?').run(added.definitionIds[0]);
  assert.deepEqual((await saveContribution(db,2,extra,'extra-hash')).definitionIds,[]);
  assert.equal(sql.prepare('SELECT points FROM users WHERE id=2').get().points,0);sql.close();
});

test('vowelled and unvowelled phrases share a word while each meaning retains its own forms and English example',async()=>{
 const {sql,db}=fixture();
 const first=await saveContribution(db,1,draft({arabicWord:'عَلَم',arabicForm:null,francoArabicWord:'3alam',englishDefinition:'flag',arabicDefinition:'راية',englishExample:'Raise the flag.',transliteration:'ʕalam',ipa:'/ʕalam/'}),'flag');
 const second=await saveContribution(db,2,draft({requestId:'knowledge-request-123456',arabicWord:'علم',arabicForm:'عِلْم',francoArabicWord:'3ilm',arabicDefinition:null,englishDefinition:'knowledge'}),'knowledge');
 assert.equal(first.wordId,second.wordId);
 assert.equal(sql.prepare('SELECT arabicWord FROM words').get().arabicWord,'علم');
 const rows=await attachProvenance(db,sql.prepare('SELECT id,wordId,definition,isArabic FROM definitions ORDER BY id').all());
 assert.equal(rows[0].meaningForms[0].meaningId,rows[1].meaningForms[0].meaningId);
 assert.notEqual(rows[0].meaningForms[0].meaningId,rows[2].meaningForms[0].meaningId);
 assert.equal(rows[0].francoArabicWord,'3alam');assert.equal(rows[2].francoArabicWord,'3ilm');
 const search=exploreQuery(new URLSearchParams({q:'3ilm',scope:'words',script:'franco'}));
 assert.equal(sql.prepare(search.resultsSql).all(...search.values,0,0,0,12,0)[0].definition,'knowledge');
 assert.equal(rows[0].sourcePronunciations.find(p=>p.scheme==='Arabic vocalization').value,'عَلَم');
 assert.equal(rows[2].sourcePronunciations.find(p=>p.scheme==='Arabic vocalization').value,'عِلْم');
 assert.equal(rows[0].sourceExamples[0].language,'en');
 assert.equal(sql.prepare('SELECT points FROM users WHERE id=2').get().points,1);
 await assert.rejects(saveContribution(db,2,draft({requestId:'wrong-reading-12345678',wordId:first.wordId,arabicForm:'كِتاب'}),'wrong'),/selected word/);
 assert.equal(stripTashkil('أَكَلَ'),'أكل');assert.notEqual(stripTashkil('أكل'),stripTashkil('اكل'));
 assert.equal(countryForDialect('قاهري'),'EG');assert.equal(countryForDialect('Omani Arabic'),'OM');assert.equal(countryForDialect('Gulf Arabic'),null);assert.equal(countryForDialect('Bahrani Arabic'),null);
 sql.close();
});

test('grouped cards survive voting, hiding and deletion of a vowelled variant without moving reactions',()=>{
 const {sql}=fixture();
 sql.exec("INSERT INTO words(id,userId,arabicWord,createdAt) VALUES(10,1,'علم','2026-10-20'),(11,1,'عَلَم','2026-10-20');INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(10,10,1,'knowledge',0),(11,11,1,'flag',0);INSERT INTO \"definition-likes-dislikes\"(definitionId,userId,liked) VALUES(11,2,1);");
 assert.equal(sql.prepare('SELECT definitionId FROM dictionary_cards').get().definitionId,11);
 sql.exec('DELETE FROM definitions WHERE wordId=11;DELETE FROM words WHERE id=11');
 assert.equal(sql.prepare('SELECT definitionId FROM dictionary_cards').get().definitionId,10);
 assert.equal(sql.prepare('SELECT total FROM dictionary_card_totals WHERE isArabic=2').get().total,1);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM "definition-likes-dislikes"').get().n,0);
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);sql.close();
});
