import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT_ID,validateProof,validateReadProtection,validateImportPause} from '../scripts/free-plan-guard.mjs';

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

test('deployment permits only the reviewed native read limiter and an explicit snapshot pause setting',()=>{
  const config={ratelimits:[{name:'PUBLIC_READ_RATE_LIMIT',namespace_id:'20261023',simple:{limit:120,period:60}}],vars:{PUBLIC_READ_ONLY:'true'}};
  assert.equal(validateReadProtection(config),true);
  assert.equal(validateReadProtection({...config,vars:{PUBLIC_READ_ONLY:'false'}}),true);
  for(const altered of [
    {ratelimits:undefined},{ratelimits:[...config.ratelimits,...config.ratelimits]},
    {ratelimits:[{...config.ratelimits[0],name:'OTHER'}]},
    {ratelimits:[{...config.ratelimits[0],namespace_id:'1'}]},
    {ratelimits:[{...config.ratelimits[0],simple:{limit:1000,period:60}}]},
    {vars:{}},{vars:{PUBLIC_READ_ONLY:'yes'}},
  ])assert.throws(()=>validateReadProtection({...config,...altered}),/Deployment refused/);
});

test('paused importer deployment requires zero configured and live cron schedules',()=>{
  const paused={vars:{PUBLIC_READ_ONLY:'true'},triggers:{crons:[]}},active={vars:{PUBLIC_READ_ONLY:'false'},triggers:{crons:['* * * * *']}};
  assert.equal(validateImportPause(paused,[]),true);
  assert.equal(validateImportPause(active,[{cron:'* * * * *'}]),false);
  assert.throws(()=>validateImportPause({...paused,triggers:active.triggers},[]),/schedule/);
  assert.throws(()=>validateImportPause(paused,[{cron:'* * * * *'}]),/live/);
  assert.throws(()=>validateImportPause(active,[]),/live/);
  assert.throws(()=>validateImportPause(paused,undefined),/live/);
  assert.throws(()=>validateImportPause(paused,{}),/live/);
  assert.throws(()=>validateImportPause({...paused,vars:{}}),/explicit/);
});
