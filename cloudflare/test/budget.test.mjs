import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {claimBudget} from '../src/budget.ts';
function storage() {
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE rate_limits(scope TEXT PRIMARY KEY,used INTEGER NOT NULL,reset INTEGER NOT NULL)');
  return {db,exec(query,...args){return {toArray(){return db.prepare(query).all(...args);}};}};
}
test('AI request 51 and email 31 stop; distinct budgets and day scopes remain independent',()=>{
  const sql=storage();
  for(const [key,limit] of [['chatbot:2026-10-16',50],['reset-emails:2026-10-16',30]]) {
    for(let n=0;n<limit;n++) assert.equal(claimBudget(sql,key,limit,86400,1000),true);
    for(let n=0;n<3;n++) assert.equal(claimBudget(sql,key,limit,86400,1000),false);
  }
  assert.equal(claimBudget(sql,'chatbot:2026-10-17',50,86400,1001),true);
  sql.db.close();
});
test('invalid budgets fail closed and expired address throttles reset',()=>{
  const sql=storage();
  for(const limit of [0,-1,NaN,Infinity,0.1]) assert.equal(claimBudget(sql,'invalid',limit,60,100),false);
  assert.equal(claimBudget(sql,'address',1,60,100),true);
  assert.equal(claimBudget(sql,'address',1,60,159),false);
  assert.equal(claimBudget(sql,'address',1,60,160),true);
  sql.db.close();
});
