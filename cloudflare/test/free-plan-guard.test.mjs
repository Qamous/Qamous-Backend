import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT_ID,validateProof} from '../scripts/free-plan-guard.mjs';

test('deployment requires recent dashboard evidence for the approved Free account',()=>{
  const now=Date.parse('2026-10-21T15:00:00Z');
  const proof={accountId:ACCOUNT_ID,plan:'Workers Free',status:'Active',
    source:'cloudflare_dashboard',observedAt:new Date(now).toISOString(),evidence:'Workers Free Active'};
  assert.equal(validateProof(proof,now),true);
  for(const altered of [
    {accountId:'another-account'},
    {plan:'Workers Paid'},
    {source:'cloudflare_api'},
    {observedAt:new Date(now-2*60*60*1000-1).toISOString()},
    {evidence:'unverified'},
  ]) assert.throws(()=>validateProof({...proof,...altered},now),/Deployment refused/);
});
