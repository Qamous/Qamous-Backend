// Cloudflare omits the implicit Workers Free plan from the subscriptions API.
// Require a verified Free dashboard baseline at installation, then a complete,
// fresh subscription list on every cloud run. Any new account subscription
// except an explicit Workers Free plan fails closed. No billing writes exist.
import {BILLING_ACCOUNT,BILLING_URL,proofFromSubscriptions} from './import-billing.mjs';
export function hostedFreeGuard(body,baseline,observedAt=new Date().toISOString()) {
  if(body?.success!==true||body.errors?.length||!Array.isArray(body.result)||body.result_info?.next_page||body.result_info?.total_pages>1||body.result_info?.total_count>body.result.length)throw Error('Complete current billing subscriptions could not be verified');
  try{return proofFromSubscriptions(body,observedAt);}catch{}
  if(baseline?.accountId!==BILLING_ACCOUNT||baseline.plan!=='Workers Free'||baseline.status!=='Active'||baseline.source!=='cloudflare_dashboard'||!baseline.evidence?.includes('Workers Free Active')||!Number.isFinite(Date.parse(baseline.observedAt))||Date.parse(baseline.observedAt)>Date.parse(observedAt))throw Error('A verified Workers Free installation baseline is required');
  const active=body.result.filter(s=>!['Cancelled','Failed','Expired'].includes(s.state));
  // A scope-less or unfamiliar account product is not silently classified as
  // Free. Zone plans are separate from the Workers account subscription.
  if(active.some(s=>s.rate_plan?.scope!=='zone'||/workers?/i.test([s.rate_plan?.id,s.rate_plan?.public_name,...(s.rate_plan?.sets||[])].join(' '))))throw Error('An account-level subscription changed; review Workers Free before continuing');
  return {accountId:BILLING_ACCOUNT,plan:'Workers Free',status:'Active',source:'hosted_free_guard',observedAt,url:BILLING_URL,baselineObservedAt:baseline.observedAt,evidence:'Verified Workers Free at installation; fresh complete API list has no active account-level subscription',accountSubscriptions:0};
}
export async function fetchHostedFreeGuard(token,baseline,fetcher=fetch) {
  const response=await fetcher(BILLING_URL,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=Error('Hosted billing check HTTP '+response.status);error.code=[401,403].includes(response.status)?'BILLING_READ_REQUIRED':response.status>=500||response.status===429?'RETRY_NETWORK':'BILLING_UNVERIFIED';throw error;}
  return hostedFreeGuard(await response.json(),baseline);
}
