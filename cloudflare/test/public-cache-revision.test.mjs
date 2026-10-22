import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PublicCacheRevision,PUBLIC_MUTATION_LEASE_MS} from '../src/public-cache-revision.ts';

test('mutation barriers persist across restart and advance the generation before and after a write',()=>{
  const db=new DatabaseSync(':memory:');
  const store={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const revision=new PublicCacheRevision(store);
  assert.deepEqual(revision.current(1000),{revision:1,pending:0});
  revision.begin('mutation-123',1000);
  assert.deepEqual(new PublicCacheRevision(store).current(1001),{revision:2,pending:1});
  revision.finish('mutation-123');assert.deepEqual(revision.current(1002),{revision:3,pending:0});
  revision.finish('mutation-123');assert.equal(revision.current(1003).revision,3);
  revision.begin('mutation-456',2000);
  assert.deepEqual(revision.current(2000+PUBLIC_MUTATION_LEASE_MS),{revision:5,pending:0});
  assert.throws(()=>revision.begin('x',3000),/identifier/);db.close();
});
