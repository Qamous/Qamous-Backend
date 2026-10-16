export interface BudgetStorage {
  exec(query:string,...args:(string|number)[]):{toArray():Record<string,unknown>[]};
}
export function claimBudget(storage:BudgetStorage,scope:string,limit:number,seconds:number,now=Math.floor(Date.now()/1000)):boolean {
  if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(seconds)||seconds<1) return false;
  const rows=storage.exec(
    'INSERT INTO rate_limits(scope,used,reset) VALUES(?,1,?) ON CONFLICT(scope) DO UPDATE SET used=CASE WHEN reset<=? THEN 1 ELSE used+1 END,reset=CASE WHEN reset<=? THEN ? ELSE reset END RETURNING used,reset',
    scope,now+seconds,now,now,now+seconds,
  ).toArray();
  storage.exec('DELETE FROM rate_limits WHERE reset<?',now-86400);
  return Number(rows[0].used)<=limit;
}
