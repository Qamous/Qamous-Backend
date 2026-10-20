import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { feedWeight, shuffledFeed, feedCandidatesSql, feedScript } from '../src/feed.ts';
import { exploreQuery } from '../src/explore.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const migration of ['0001_initial.sql', '0003_contributions.sql','0004_import_provenance.sql','0005_dictionary_read_indexes.sql','0006_word_meaning_forms.sql','0007_example_alignment.sql']) {
    db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  }
  // The deployment's public view can hide imports beyond the base report rules.
  db.exec(`INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Test','','test@example.invalid','tester','2026-01-01');
    INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES(1,1,'أ','a','2026-01-01'),(2,1,'ب','b','2026-01-01'),(3,1,'ج','c','2026-01-01');
    INSERT INTO definitions(id,wordId,userId,definition,isArabic,likeCount,dislikeCount,reportCount) VALUES
      (1,1,1,'First',0,10,0,0),(2,1,1,'Another meaning',0,1,0,0),
      (3,1,1,'Arabic',1,0,0,0),(4,2,1,'Second',0,0,0,0),(5,3,1,'Reported',0,50,0,6);
    INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(4,1,0);`);
  return db;
}
function hydrate(db, ids, user = 0) {
  const query = exploreQuery(new URLSearchParams({ ids }));
  return db.prepare(query.resultsSql).all(...query.values,user,user,user,query.limit,0);
}

test('approval smoothing starts neutral and limits vote influence', () => {
  assert.equal(feedWeight(0,0),1);
  assert.equal(feedWeight(1,0),0.75 + 0.5 * 4/7);
  assert.ok(feedWeight(80,20)>feedWeight(1,0));
  assert.ok(feedWeight(80,20)>feedWeight(800,2000));
  assert.ok(feedWeight(1e6,0)<1.25);
  assert.ok(feedWeight(0,1e6)>0.75);
});
test('weighted permutation covers every candidate once and modestly favors approval', () => {
  let seed = 12345;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const candidates = [{definitionId:1,likeCount:10000,dislikeCount:0},{definitionId:2,likeCount:0,dislikeCount:0}];
  let wins = 0;
  for (let i=0;i<30000;i++) {
    const order=shuffledFeed(candidates,random);
    assert.deepEqual([...order].sort(),[1,2]);
    if(order[0]===1) wins++;
  }
  assert.ok(wins/30000>0.54 && wins/30000<0.57, String(wins));
  assert.deepEqual(shuffledFeed([],random),[]);
  assert.deepEqual(shuffledFeed(candidates,()=>0),[1,2]);
});
test('snapshot selects one public card per word in the requested script, including unvoted cards', () => {
  const db=fixture();
  assert.deepEqual(db.prepare(feedCandidatesSql).all(feedScript('franco')).map(row=>row.definitionId),[1,4]);
  assert.deepEqual(db.prepare(feedCandidatesSql).all(feedScript('ar')).map(row=>row.definitionId),[3,4]);
  db.exec('UPDATE words SET reportCount=6 WHERE id=2');
  assert.deepEqual(db.prepare(feedCandidatesSql).all(0).map(row=>row.definitionId),[1]);
  if(feedCandidatesSql.includes('public_definitions')) {
    db.exec("UPDATE definitions SET displayLanguage='hidden' WHERE id=1");
    assert.deepEqual(db.prepare(feedCandidatesSql).all(0).map(row=>row.definitionId),[2]);
  }
  db.close();
});
test('hydration preserves snapshot order and personal votes through ranking changes and moderation', () => {
  const db=fixture();
  assert.deepEqual(hydrate(db,'4,1',1).map(row=>[row.definitionId,row.isDisliked]),[[4,1],[1,0]]);
  assert.equal(hydrate(db,'4,1')[0].isDisliked,0);
  db.exec('UPDATE definitions SET likeCount=100 WHERE id=2');
  assert.deepEqual(hydrate(db,'4,1').map(row=>row.definitionId),[4,1]);
  db.exec('UPDATE definitions SET reportCount=6 WHERE id=4');
  assert.deepEqual(hydrate(db,'4,1').map(row=>row.definitionId),[1]);
  assert.deepEqual(hydrate(db,'999999'),[]);
  db.close();
});
test('feed parameters reject invalid IDs, excessive requests and scripts', () => {
  for (const ids of ['', '0', '-1', '1,1', '1.5', '1 OR 1=1', '9007199254740992', Array.from({length:51},(_,i)=>i+1).join(',')]) {
    assert.throws(()=>exploreQuery(new URLSearchParams({ids})),{status:400});
  }
  for (const script of [undefined,'both','en',"' OR 1=1"]) assert.throws(()=>feedScript(script),{status:400});
});
