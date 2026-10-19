import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseContribution, saveContribution } from '../src/contributions.ts';
import { exploreQuery } from '../src/explore.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql','0002_reaction_accounting.sql','0003_contributions.sql']) sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
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
