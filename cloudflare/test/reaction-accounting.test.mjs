import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0002_reaction_accounting.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec(`INSERT INTO users(id,firstName,lastName,email,username,createdAt,points,likesReceived) VALUES
    (1,'Author','','a@example.invalid','author','2026-10-17',103,-1),
    (2,'Reader','','b@example.invalid','reader','2026-10-17',0,0),
    (3,'Reader','','c@example.invalid','reader2','2026-10-17',0,0),
    (7,'Archive','','d@example.invalid','archive','2026-10-17',0,0);
    INSERT INTO words(id,userId,arabicWord,createdAt) VALUES(1,1,'test','2026-10-17'),(2,1,'other','2026-10-17');
    INSERT INTO definitions(id,wordId,userId,definition,isArabic,likeCount) VALUES(1,1,1,'one',1,50),(2,1,2,'two',0,0),(3,2,1,'three',1,0);
    INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(1,1,1),(1,2,1),(1,2,0),(1,3,1),(2,1,1);`);
  db.exec(migration);
  return db;
}
function audit(db) {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM definitions d WHERE
    likeCount!=(SELECT COUNT(*) FROM "definition-likes-dislikes" WHERE definitionId=d.id AND liked=1) OR
    dislikeCount!=(SELECT COUNT(*) FROM "definition-likes-dislikes" WHERE definitionId=d.id AND liked=0)`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE
    likesReceived!=COALESCE((SELECT SUM(likeCount) FROM definitions WHERE userId=u.id),0) OR
    points!=COALESCE((SELECT SUM(contributionPoints+likeCount-dislikeCount) FROM definitions WHERE userId=u.id),0)`).get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "definition-likes-dislikes" r JOIN definitions d ON d.id=r.definitionId WHERE r.userId=d.userId').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM "definition-likes-dislikes" GROUP BY definitionId,userId HAVING COUNT(*)>1)').get().n, 0);
}
const points = (db,id=1) => db.prepare('SELECT points FROM users WHERE id=?').get(id).points;

test('migration repairs duplicates, self votes, counters, negative likes received and reputation', () => {
  const db=fixture(); audit(db);
  assert.equal(points(db),4); assert.equal(points(db,2),2);
  assert.equal(db.prepare('SELECT liked FROM "definition-likes-dislikes" WHERE definitionId=1 AND userId=2').get().liked,0);
  assert.equal(db.prepare('SELECT SUM(contributionPoints-1) AS n FROM definitions').get().n,2);
  db.close();
});
test('vote transitions, uniqueness and self-vote rejection maintain exact totals', () => {
  const db=fixture();
  db.exec('UPDATE "definition-likes-dislikes" SET liked=1 WHERE definitionId=1 AND userId=2'); assert.equal(points(db),6); audit(db);
  db.exec('UPDATE "definition-likes-dislikes" SET liked=1 WHERE definitionId=1 AND userId=2'); assert.equal(points(db),6); audit(db);
  db.exec('UPDATE "definition-likes-dislikes" SET liked=0 WHERE definitionId=1 AND userId=2'); assert.equal(points(db),4); audit(db);
  db.exec('DELETE FROM "definition-likes-dislikes" WHERE definitionId=1 AND userId=2'); assert.equal(points(db),5); audit(db);
  assert.throws(()=>db.exec('INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(1,1,1)'), /Self reactions/);
  assert.throws(()=>db.exec('INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(1,3,1)'), /UNIQUE/);
  assert.throws(()=>db.exec('UPDATE "definition-likes-dislikes" SET definitionId=3 WHERE definitionId=1'), /identity/);
  audit(db); db.close();
});
test('deleting definitions reverses contribution points and all cascaded reactions exactly once', () => {
  const db=fixture();
  db.exec('DELETE FROM definitions WHERE id=1'); audit(db); assert.equal(points(db),2);
  db.exec('DELETE FROM definitions WHERE id=2'); audit(db); assert.equal(points(db,2),0);
  db.close();
});
test('voter deletion and archive transfers remove votes and transfer reputation without self votes', () => {
  const db=fixture();
  db.exec('DELETE FROM users WHERE id=3'); audit(db); assert.equal(points(db),3);
  db.exec('INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(1,7,1)'); audit(db);
  db.exec('UPDATE definitions SET userId=7 WHERE userId=1'); audit(db); assert.equal(points(db),0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "definition-likes-dislikes" WHERE definitionId=1 AND userId=7').get().n,0);
  db.exec('UPDATE words SET userId=7 WHERE userId=1; DELETE FROM users WHERE id=1'); audit(db);
  assert.equal(points(db,2),1); db.close();
});
test('create/delete cycles cannot retain first-definition bonuses or contribution points', () => {
  const db=fixture(); const before=points(db);
  for(let i=0;i<5;i++) {
    db.exec(`INSERT INTO definitions(id,wordId,userId,definition,isArabic,contributionPoints) VALUES(100,1,1,'temporary',1,1); DELETE FROM definitions WHERE id=100;`); audit(db);
  }
  assert.equal(points(db),before);
  db.exec('DELETE FROM definitions WHERE wordId=2'); const empty=points(db);
  for(let i=0;i<5;i++) {
    db.exec(`INSERT INTO definitions(id,wordId,userId,definition,isArabic,contributionPoints) VALUES(100,2,1,'temporary first',1,2); DELETE FROM definitions WHERE id=100;`); audit(db);
  }
  assert.equal(points(db),empty); db.close();
});
test('500 deterministic interleaved votes, deletes and ownership transfers preserve invariants', () => {
  const db=fixture(); let seed=617; const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  for(let i=0;i<500;i++) {
    const id=1+random()%3, userId=[1,2,3,7][random()%4], action=random()%5;
    const row=db.prepare('SELECT userId FROM definitions WHERE id=?').get(id);
    if(!row) db.prepare(`INSERT INTO definitions(id,wordId,userId,definition,isArabic,contributionPoints) VALUES(?,1,?,'generated',1,1+NOT EXISTS(SELECT 1 FROM definitions WHERE wordId=1))`).run(id,userId);
    else if(action===0) db.prepare('DELETE FROM definitions WHERE id=?').run(id);
    else if(action===1) db.prepare('UPDATE definitions SET userId=? WHERE id=?').run(userId,id);
    else if(action===2) db.prepare('DELETE FROM "definition-likes-dislikes" WHERE definitionId=? AND userId=?').run(id,userId);
    else if(row.userId!==userId) db.prepare('INSERT INTO "definition-likes-dislikes"(definitionId,userId,liked) VALUES(?,?,?) ON CONFLICT(definitionId,userId) DO UPDATE SET liked=excluded.liked').run(id,userId,random()%2);
    audit(db);
  }
  db.close();
});
test('migration reconciles the original snapshot without changing contribution text or ownership', async t => {
  let restore;
  try {restore=await readFile(new URL('../private/restore.sql',import.meta.url),'utf8');}
  catch(error) {if(error.code==='ENOENT'){t.skip('Private restoration snapshot is not published');return;}throw error;}
  const db=new DatabaseSync(':memory:');db.exec(schema);db.exec(restore);
  const before=db.prepare('SELECT id,wordId,userId,definition,example,AddedTimestamp FROM definitions ORDER BY id').all();
  db.exec(migration);audit(db);
  assert.deepEqual(db.prepare('SELECT id,wordId,userId,definition,example,AddedTimestamp FROM definitions ORDER BY id').all(),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "definition-likes-dislikes"').get().n,20);
  db.close();
});
