import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedFreeGuard,fetchHostedFreeGuard} from '../scripts/hosted-free-guard.mjs';
const baseline={accountId:'39292a971f28b413619657e9f2c77003',plan:'Workers Free',status:'Active',source:'cloudflare_dashboard',observedAt:'2026-10-20T18:00:00Z',evidence:'Workers Free Active; observed in the signed-in dashboard'};
const freeZone={state:'Paid',price:0,rate_plan:{id:'free',public_name:'Cloudflare Free Plan',scope:'zone'}};
const current={success:true,result:[freeZone],result_info:{total_count:1,total_pages:1,next_page:false}};
test('implicit Free requires the installation baseline and a complete fresh subscription list',()=>{
  assert.equal(hostedFreeGuard(current,baseline,'2026-10-21T00:15:00Z').plan,'Workers Free');
  assert.throws(()=>hostedFreeGuard(current,null));
  assert.throws(()=>hostedFreeGuard(current,{...baseline,plan:'Workers Paid'}));
  assert.throws(()=>hostedFreeGuard(current,{...baseline,accountId:'other'}));
  assert.throws(()=>hostedFreeGuard(current,baseline,'2026-10-19T00:00:00Z'));
  for(const result_info of [{next_page:true},{total_count:2},{total_pages:2}])assert.throws(()=>hostedFreeGuard({...current,result_info},baseline));
});
test('paid, trial, unfamiliar and even mislabeled Workers account subscriptions fail closed',()=>{
  for(const subscription of [
    {state:'Paid',price:5,rate_plan:{id:'workers',scope:'account'}},
    {state:'Trial',price:0,rate_plan:{public_name:'Workers Paid',scope:'account'}},
    {state:'Paid',price:5,rate_plan:{id:'workers_paid',scope:'zone'}},
    {state:'Paid',price:0,rate_plan:{id:'unknown',scope:'account'}},
    {state:'Paid',price:0,rate_plan:{id:'unknown'}}
  ])assert.throws(()=>hostedFreeGuard({success:true,result:[freeZone,subscription]},baseline));
});
test('an explicit Free plan is accepted and a paid Workers plan cannot hide behind it',()=>{
  const free={state:'Provisioned',price:0,rate_plan:{id:'workers_free',public_name:'Workers Free',scope:'account'}};
  assert.equal(hostedFreeGuard({success:true,result:[free]},null).plan,'Workers Free');
  assert.throws(()=>hostedFreeGuard({success:true,result:[free,{state:'Paid',price:5,rate_plan:{id:'workers_paid',scope:'account'}}]},baseline));
  assert.throws(()=>hostedFreeGuard({success:true,result:[free],result_info:{next_page:true}},baseline));
});
test('billing permission and transient failures remain distinct, without plan mutation',async()=>{
  await assert.rejects(fetchHostedFreeGuard('synthetic',baseline,async()=>new Response('',{status:403})),error=>error.code==='BILLING_READ_REQUIRED');
  await assert.rejects(fetchHostedFreeGuard('synthetic',baseline,async()=>new Response('',{status:503})),error=>error.code==='RETRY_NETWORK');
  let request;
  const proof=await fetchHostedFreeGuard('synthetic',baseline,async(url,options)=>{request={url,options};return Response.json(current);});
  assert.equal(proof.accountSubscriptions,0);assert.equal(request.options.method,undefined);assert.ok(!request.options.body);
});
