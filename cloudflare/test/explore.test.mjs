import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { exploreQuery } from '../src/explore.ts';
import { normalize } from '../src/data.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_contributions.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0004_import_provenance.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0005_dictionary_read_indexes.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0006_word_meaning_forms.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO countries VALUES ('EG','Egypt'),('LB','Lebanon');
    INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES (1,'Test','User','test@example.invalid','tester','2026-01-01');`);
  const word = db.prepare('INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt,reportCount,searchText) VALUES (?,1,?,?,?,0,?)');
  word.run(1,'مَرْحَبَا','Marhaba','2026-01-01',normalize('مَرْحَبَا Marhaba'));
  word.run(2,'يلا','Yalla','2026-01-02',normalize('يلا Yalla'));
  word.run(3,'خاص','100%_literal','2026-01-03',normalize('خاص 100%_literal'));
  const definition = db.prepare('INSERT INTO definitions(id,wordId,userId,countryCode,definition,example,isArabic,likeCount,reportCount,searchText,AddedTimestamp) VALUES (?,?,1,?,?,?,?,?,?,?,?)');
  for (const row of [
    [1,1,'EG','A greeting','Marhaba!',0,10,0,'2026-01-01'],
    [2,1,'LB','Hello from Lebanon','',0,3,0,'2026-02-01'],
    [3,1,'EG','ترحيب','مرحبا بك',1,5,0,'2026-01-01'],
    [4,2,'EG','Let us go','Yalla!',0,1,0,'2026-03-01'],
    [5,3,'LB','Literal punctuation','',0,0,0,'2026-01-01'],
    [6,2,'LB','Hidden definition','hidden',0,100,6,'2026-04-01'],
  ]) {
    const [id,wordId,country,meaning,example,script,likes,reports,date]=row;
    definition.run(id,wordId,country,meaning,example,script,likes,reports,normalize(meaning),date);
  }
  db.exec(`INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES (2,1,1);
    INSERT INTO "definition-reports"(definitionId,userId,reportText) VALUES (2,1,'Test');`);
  return db;
}
function search(db, query='', user=0) {
  const plan = exploreQuery(new URLSearchParams(query));
  return {
    total: db.prepare(plan.countSql).get(...plan.values).total,
    rows: db.prepare(plan.resultsSql).all(...(plan.fastFeed?[user,user,user,...plan.values,plan.limit,(plan.page-1)*plan.limit]:[...plan.values,user,user,user,plan.limit,(plan.page-1)*plan.limit])),
  };
}

test('combines dialect, script and keyword before choosing the best matching definition', () => {
  const db=fixture();
  const result=search(db,'q=hello&country=LB&script=franco');
  assert.equal(result.total,1);
  assert.equal(result.rows[0].definitionId,2);
  assert.equal(result.rows[0].example,'');
  assert.equal(search(db,'q=hello&country=EG&script=franco').total,0);
  assert.equal(search(db,'country=EG&country=LB&script=franco').total,3);
  db.close();
});
test('search scope, normalized Arabic and literal wildcard characters work', () => {
  const db=fixture();
  assert.equal(search(db,'q=greeting&scope=words').total,0);
  assert.equal(search(db,'q=greeting&scope=definitions').total,1);
  assert.equal(search(db,'q='+encodeURIComponent('مَرْحَبَا')+'&script=ar').rows[0].word,'مَرْحَبَا');
  assert.equal(search(db,'q='+encodeURIComponent('%_')+'&scope=words').total,1);
  assert.equal(search(db,'q='+encodeURIComponent("' OR 1=1 --")).total,0);
  db.close();
});
test('examples filter and moderation apply to counts and rows; reaction flags remain personal', () => {
  const db=fixture();
  assert.equal(search(db,'examples=1&script=franco').total,2);
  assert.equal(search(db,'q=hidden').total,0);
  assert.equal(search(db,'country=LB',1).rows.find(row=>row.definitionId===2).isLiked,1);
  assert.equal(search(db,'country=LB',1).rows.find(row=>row.definitionId===2).isReported,1);
  assert.equal(search(db,'country=LB').rows.find(row=>row.definitionId===2).isLiked,0);
  db.close();
});
test('pagination has a stable total and sorts by popularity, date or word', () => {
  const db=fixture();
  const first=search(db,'script=franco&limit=1');
  const second=search(db,'script=franco&limit=1&page=2');
  assert.equal(first.total,3); assert.equal(second.total,3);
  assert.notEqual(first.rows[0].definitionId,second.rows[0].definitionId);
  assert.equal(search(db,'script=franco&sort=newest').rows[0].word,'Yalla');
  assert.deepEqual(search(db,'script=franco&sort=az').rows.map(row=>row.word),['100%_literal','Marhaba','Yalla']);
  assert.equal(search(db,'script=franco&page=20').rows.length,0);
  db.close();
});
test('rejects invalid and unbounded search options', () => {
  for (const query of ['page=0','page=1.5','limit=999','sort=drop','script=bad','scope=bad','country=EG%27','q='+'a'.repeat(201)]) {
    assert.throws(()=>exploreQuery(new URLSearchParams(query)),{status:400});
  }
});
