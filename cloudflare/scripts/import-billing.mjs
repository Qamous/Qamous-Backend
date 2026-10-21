// Read-only billing verification for an unattended import. No subscription writes.
export const BILLING_ACCOUNT = '39292a971f28b413619657e9f2c77003';
export const BILLING_URL = `https://api.cloudflare.com/client/v4/accounts/${BILLING_ACCOUNT}/subscriptions`;

export function proofFromSubscriptions(response, observedAt = new Date().toISOString()) {
  if (response?.success !== true || response.errors?.length || !Array.isArray(response.result)) throw new Error('Billing response could not be verified');
  if (response.result_info?.total_count > response.result.length) throw new Error('Billing subscription list is incomplete');
  const active = response.result.filter(s => !['Cancelled', 'Failed', 'Expired'].includes(s.state));
  const workers = active.filter(s => /workers?/i.test([s.rate_plan?.id, s.rate_plan?.public_name, s.rate_plan?.scope, ...(s.rate_plan?.sets || [])].join(' ')));
  const free = workers.filter(s => /\bworkers?\s+free\b|\bworkers?_free\b/i.test([s.rate_plan?.id, s.rate_plan?.public_name].join(' ')) && s.price === 0 && ['Provisioned', 'Paid', 'Active'].includes(s.state));
  if (!free.length || workers.some(s => !free.includes(s))) throw new Error('An active, explicitly free Workers subscription was not verified');
  // Persist only the evidence needed for the plan check, never payment details.
  const subscriptions = response.result.map(s => ({state:s.state, price:s.price, rate_plan:{id:s.rate_plan?.id, public_name:s.rate_plan?.public_name, scope:s.rate_plan?.scope, sets:s.rate_plan?.sets}}));
  return {accountId:BILLING_ACCOUNT, plan:'Workers Free', status:'Active', source:'cloudflare_api', observedAt, url:BILLING_URL, evidence:'Workers Free Active; verified by read-only account subscriptions API', apiResponse:{success:true, result:subscriptions}};
}

export async function fetchBillingProof(token, fetcher = fetch) {
  const response = await fetcher(BILLING_URL, {headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(20000)});
  if (response.status === 401 || response.status === 403) {
    const error = new Error('The existing login cannot read billing. A Qamous account Billing Read token is required.');
    error.code = 'BILLING_READ_REQUIRED'; throw error;
  }
  if (!response.ok) {const error = new Error('Billing verification HTTP '+response.status); error.code = response.status >= 500 || response.status === 429 ? 'RETRY_NETWORK' : 'BILLING_UNVERIFIED'; throw error;}
  return proofFromSubscriptions(await response.json());
}
