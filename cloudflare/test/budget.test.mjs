import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {claimBudget,claimBudgetSet,chatbotBudgetClaims,chatbotLimitResponse} from '../src/budget.ts';
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

function claimChatbot(sql,day,caller,limit=50) {
  sql.db.exec('BEGIN IMMEDIATE');
  try {
    const blocked=claimBudgetSet(sql,chatbotBudgetClaims(day,limit,caller),1000);
    sql.db.exec('COMMIT');
    return blocked;
  } catch(error) {
    sql.db.exec('ROLLBACK');
    throw error;
  }
}
function used(sql,scope) {
  return sql.db.prepare('SELECT used FROM rate_limits WHERE scope=?').get(scope)?.used??0;
}
test('guest requests are limited per address and cannot exhaust the member reserve',()=>{
  const sql=storage(),day='2026-10-21';
  const first={userId:null,ipHash:'guest-0'};
  assert.equal(claimChatbot(sql,day,first),null);
  assert.equal(claimChatbot(sql,day,first),null);
  assert.equal(claimChatbot(sql,day,first),`chatbot:guest:ip:${day}:guest-0`);
  assert.equal(used(sql,`chatbot:${day}`),2,'a denied request must not consume the global budget');
  for(let n=1;n<15;n++) for(let request=0;request<2;request++) assert.equal(claimChatbot(sql,day,{userId:null,ipHash:`guest-${n}`}),null);
  assert.equal(used(sql,`chatbot:guests:${day}`),30);
  assert.equal(claimChatbot(sql,day,{userId:null,ipHash:'new-guest'}),`chatbot:guests:${day}`);
  assert.equal(used(sql,`chatbot:guest:ip:${day}:new-guest`),0,'guest pool rejection must not consume a caller allowance');
  assert.equal(used(sql,`chatbot:${day}`),30);
  assert.equal(claimChatbot(sql,day,{userId:42,ipHash:'member-ip'}),null,'members retain access after guest exhaustion');
  sql.db.close();
});
test('members have per-account and shared-address limits without consuming budgets on rejection',()=>{
  const sql=storage(),day='2026-10-21';
  const member={userId:1,ipHash:'home'};
  for(let n=0;n<3;n++) assert.equal(claimChatbot(sql,day,member),null);
  assert.equal(claimChatbot(sql,day,member),`chatbot:member:${day}:1`);
  assert.equal(used(sql,`chatbot:member:ip:${day}:home`),3);
  for(let n=0;n<2;n++) assert.equal(claimChatbot(sql,day,{userId:2,ipHash:'home'}),null);
  assert.equal(claimChatbot(sql,day,{userId:3,ipHash:'home'}),null);
  assert.equal(claimChatbot(sql,day,{userId:4,ipHash:'home'}),`chatbot:member:ip:${day}:home`);
  assert.equal(used(sql,`chatbot:member:${day}:4`),0);
  assert.equal(used(sql,`chatbot:${day}`),6);
  assert.equal(claimChatbot(sql,'2026-10-22',member),null,'a new UTC day gets a fresh allowance');
  sql.db.close();
});
test('global cap remains effective across guest and member requests',()=>{
  const sql=storage(),day='2026-10-21';
  assert.equal(claimChatbot(sql,day,{userId:null,ipHash:'guest'},2),null);
  assert.equal(claimChatbot(sql,day,{userId:1,ipHash:'member'},2),null);
  assert.equal(claimChatbot(sql,day,{userId:2,ipHash:'other'},2),`chatbot:${day}`);
  assert.equal(used(sql,`chatbot:member:${day}:2`),0);
  assert.equal(used(sql,`chatbot:${day}`),2);
  sql.db.close();
});
test('only guest-specific limits prompt sign in',()=>{
  const day='2026-10-21',guest={userId:null,ipHash:'guest'},member={userId:1,ipHash:'member'};
  assert.equal(chatbotLimitResponse(`chatbot:guest:ip:${day}:guest`,day,guest).code,'GUEST_CHAT_LIMIT');
  assert.equal(chatbotLimitResponse(`chatbot:guests:${day}`,day,guest).code,'GUEST_CHAT_LIMIT');
  assert.equal(chatbotLimitResponse(`chatbot:${day}`,day,guest).code,undefined);
  assert.equal(chatbotLimitResponse(`chatbot:member:${day}:1`,day,member).code,undefined);
});
