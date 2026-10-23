export interface BudgetStorage {
  exec(query:string,...args:(string|number)[]):{toArray():Record<string,unknown>[]};
}
export interface BudgetClaim {scope:string;limit:number;seconds:number}
export interface ChatbotCaller {userId:number|null;ipHash:string}
export function chatbotBudgetClaims(day:string,globalLimit:number,caller:ChatbotCaller):BudgetClaim[] {
  // Anonymous traffic can use at most 60% of the shared AI allowance.
  // Account and address limits make a single caller's share smaller still.
  const individual:BudgetClaim[]=caller.userId===null
    ? [{scope:`chatbot:guest:ip:${day}:${caller.ipHash}`,limit:2,seconds:86400},
      {scope:`chatbot:guests:${day}`,limit:Math.floor(globalLimit*0.6),seconds:86400}]
    : [{scope:`chatbot:member:${day}:${caller.userId}`,limit:3,seconds:86400},
      {scope:`chatbot:member:ip:${day}:${caller.ipHash}`,limit:6,seconds:86400}];
  // Check shared capacity first so sign-in is offered only while it can help.
  return [{scope:`chatbot:${day}`,limit:globalLimit,seconds:86400},...individual];
}
export function chatbotLimitResponse(blocked:string,day:string,caller:ChatbotCaller) {
  if(caller.userId===null&&blocked!==`chatbot:${day}`) return {error:'Guest chat limit reached. Sign in to keep chatting.',status:429 as const,code:'GUEST_CHAT_LIMIT' as const};
  return {error:blocked.includes(':ip:')||blocked.includes(':member:')?'You have reached your daily chatbot limit. Please try again tomorrow.':'The free daily chatbot limit has been reached. Please try again tomorrow.',status:429 as const};
}
export function claimBudget(storage:BudgetStorage,scope:string,limit:number,seconds:number,now=Math.floor(Date.now()/1000)):boolean {
  if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(seconds)||seconds<1) return false;
  // Rejected traffic must not keep incrementing a persisted counter or trigger
  // cleanup. This synchronous path cannot interleave within its Durable Object.
  const current=storage.exec('SELECT used,reset FROM rate_limits WHERE scope=?',scope).toArray()[0];
  if(current&&Number(current.reset)>now&&Number(current.used)>=limit) return false;
  const rows=storage.exec(
    'INSERT INTO rate_limits(scope,used,reset) VALUES(?,1,?) ON CONFLICT(scope) DO UPDATE SET used=CASE WHEN reset<=? THEN 1 ELSE used+1 END,reset=CASE WHEN reset<=? THEN ? ELSE reset END WHERE reset<=? OR used<? RETURNING used,reset',
    scope,now+seconds,now,now,now+seconds,now,limit,
  ).toArray();
  if(!rows.length) return false;
  storage.exec('DELETE FROM rate_limits WHERE scope IN (SELECT scope FROM rate_limits WHERE reset<? LIMIT 128)',now-86400);
  return true;
}

// Call inside one SQLite transaction so a denied caller cannot consume any
// part of a shared allowance, and concurrent requests cannot overbook it.
export function claimBudgetSet(storage:BudgetStorage,claims:BudgetClaim[],now=Math.floor(Date.now()/1000)):string|null {
  if(!claims.length) return 'empty-budget';
  const seen=new Set<string>();
  for(const claim of claims) {
    if(!claim.scope||seen.has(claim.scope)||!Number.isSafeInteger(claim.limit)||claim.limit<1||!Number.isSafeInteger(claim.seconds)||claim.seconds<1) return claim.scope;
    seen.add(claim.scope);
    const row=storage.exec('SELECT used,reset FROM rate_limits WHERE scope=?',claim.scope).toArray()[0];
    if(row&&Number(row.reset)>now&&Number(row.used)>=claim.limit) return claim.scope;
  }
  for(const claim of claims) if(!claimBudget(storage,claim.scope,claim.limit,claim.seconds,now)) throw new Error('Budget changed during atomic claim');
  return null;
}
