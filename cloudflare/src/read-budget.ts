import {READ_BUDGET_POLICY,type ReadTier,type Admission} from './read-budget-ledger.ts';

export const READ_BUDGET_OBJECT='qamous-d1-account-v1';
export interface ReadBudgetStub {
  reserve(input:{id:string;rows:number;route:string;tier:ReadTier}):Promise<Admission>;
  settle(id:string,actual:number|null,writes?:number):Promise<unknown>;
}
export interface ReadBudgetEnvironment {READ_BUDGET:{getByName(name:string):ReadBudgetStub};}
export interface ReadBudgetContext {route:string;tier:ReadTier;beforeWrite?:()=>Promise<void>;unknownWrite?:()=>void;}
export class ReadBudgetError extends Error {
  readonly status=503;
  readonly code='D1_READ_BUDGET';
  readonly reason:string;
  readonly retryAfter:number;
  readonly sqlSubmitted:boolean;
  constructor(reason:string,retryAfter=60,sqlSubmitted=false) {super('The dictionary is temporarily busy. Please try again shortly.');this.name='ReadBudgetError';this.reason=reason;this.retryAfter=retryAfter;this.sqlSubmitted=sqlSubmitted;}
}
const fail=(reason:string):never=>{throw new ReadBudgetError(reason);};

// Cost contracts are authored in reviewed server SQL, never in request input.
// The default is deliberately large and is NOT a proof for arbitrary SQL. An
// unexpected measured overrun opens the durable circuit instead of retrying it.
export function queryReservation(sql:string):number {
  const contract=/^\s*\/\*\s*qamous-read:(\d+)\s*\*\//.exec(sql);
  if(contract) {
    const rows=Number(contract[1]);
    if(Number.isSafeInteger(rows)&&rows>0&&rows<=READ_BUDGET_POLICY.maxReservationRows)return rows;
    return fail('invalid_query_contract');
  }
  if(/^\s*SELECT\s+1\s*;?\s*$/i.test(sql))return 1;
  // Literal primary/unique-key lookups have no joins or correlated subqueries.
  // A 128-row reservation includes generous index traversal headroom. Anything
  // beyond these exact shapes keeps the conservative default.
  if(/^\s*SELECT\s+(?:\*|[\w, ]+)\s+FROM\s+(?:users|words|definitions|countries|embeddings|password_resets|sessions)\s+WHERE\s+(?:id|countryCode|documentId|token_hash|session_id)\s*=\s*\?(?:\s+AND\s+expires\s*>\s*\?)?\s*;?\s*$/i.test(sql))return 128;
  if(/^\s*SELECT\s+(?:\*|[\w, ]+)\s+FROM\s+users\s+WHERE\s+(?:username|email)\s*=\s*\?\s+COLLATE\s+NOCASE(?:\s+AND\s+accountKind='member')?\s*;?\s*$/i.test(sql))return 128;
  return READ_BUDGET_POLICY.defaultQueryRows;
}
function routeName(route:string) {
  return route.split('?')[0].replace(/(reset-password\/)[^/]+/g,'$1:token').replace(/\/[0-9]+(?=\/|$)/g,'/:id').slice(0,96);
}

/** Closed facade: no raw D1 object or statement is exposed to application code. */
export function guardD1(database:D1Database,env:ReadBudgetEnvironment,context:ReadBudgetContext):D1Database {
  const route=routeName(context.route);
  const statementData=new WeakMap<object,{raw:D1PreparedStatement;rows:number;writes:boolean}>();
  const coordinator=()=>{
    if(!env.READ_BUDGET?.getByName)return fail('coordinator_unavailable');
    return env.READ_BUDGET.getByName(READ_BUDGET_OBJECT);
  };
  const execute=async<T>(statements:D1PreparedStatement[],run:()=>Promise<D1Result<T>[]>):Promise<D1Result<T>[]>=>{
    const data=statements.map(statement=>statementData.get(statement)||fail('foreign_statement'));
    const rows=data.reduce((sum,statement)=>sum+statement.rows,0);
    if(rows>READ_BUDGET_POLICY.maxReservationRows)return fail('batch_cost_too_large');
    let stub:ReadBudgetStub;const id=crypto.randomUUID();
    let admission:Admission;
    try {
      stub=coordinator();
      admission=await stub.reserve({id,rows,route,tier:context.tier});
      // Short bounded contention retries are safe only after a definitive
      // denial (no reservation exists). Never retry a lost acknowledgement.
      for(let retry=0;!admission.allowed&&admission.reason==='concurrency'&&retry<4;retry++) {
        await new Promise(resolve=>setTimeout(resolve,50*2**retry));
        admission=await stub.reserve({id,rows,route,tier:context.tier});
      }
    }catch {return fail('coordinator_unavailable');}
    if(!admission.allowed)throw new ReadBudgetError(admission.reason,admission.retryAfter);
    let results:D1Result<T>[];let submitted=false;
    try {
      // Admit the database cost before invalidating public content. A denied
      // mutation must not discard the only usable snapshot during an outage.
      if(data.some(statement=>statement.writes))await context.beforeWrite?.();
      submitted=true;
      results=await run();
    }
    catch(error) {
      if(submitted&&data.some(statement=>statement.writes))context.unknownWrite?.();
      // A pre-write scope/claim refusal is known to have submitted no SQL.
      // Once submitted, a missing result retains its entire reservation.
      try {await stub.settle(id,submitted?null:0);}catch { /* The persisted charge remains. */ }
      // Admission failures prove SQL was not submitted. Never let a downstream
      // error reuse that proof after the raw D1 execution has started.
      if(submitted&&error instanceof ReadBudgetError)throw new ReadBudgetError(error.reason,error.retryAfter,true);
      throw error;
    }
    const valid=results.length===statements.length&&results.every(result=>result.success===true&&Number.isSafeInteger(result.meta?.rows_read)&&result.meta.rows_read>=0&&Number.isSafeInteger(result.meta?.rows_written)&&result.meta.rows_written>=0);
    const actual=valid?results.reduce((sum,result)=>sum+result.meta.rows_read,0):null;
    const writes=valid?results.reduce((sum,result)=>sum+result.meta.rows_written,0):0;
    try {await stub.settle(id,actual,writes);}
    catch {
      // A successful mutation must not be reported as failed merely because
      // accounting acknowledgement was lost. The full reservation stays charged.
      console.error(JSON.stringify({event:'d1_read_settlement_unavailable',route,tier:context.tier,reserved:rows,actual}));
    }
    if(actual===null)throw new ReadBudgetError('missing_cost_metadata',60,true);
    return results;
  };
  const prepare=(owner:D1Database|D1DatabaseSession,sql:string):D1PreparedStatement=>{
    const rows=queryReservation(sql);
    const writes=/^(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql.replace(/^(?:\s|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$))*/,''));
    const wrap=(raw:D1PreparedStatement):D1PreparedStatement=>{
      const statement:D1PreparedStatement={
        bind(...values:unknown[]) {return wrap(raw.bind(...values));},
        async all<T=Record<string,unknown>>() {return (await execute<T>([statement],async()=>[await raw.all<T>()]))[0];},
        async run<T=Record<string,unknown>>() {return (await execute<T>([statement],async()=>[await raw.run<T>()]))[0];},
        async first<T=Record<string,unknown>>(column?:string):Promise<T|null> {
          // first() hides meta. Execute exactly once using all(), then project
          // its first row; INSERT ... RETURNING also remains a single execution.
          const result=await statement.all<Record<string,unknown>>(),row=result.results[0];
          if(!row)return null;
          if(column!==undefined){if(!(column in row))throw Error('D1_COLUMN_NOTFOUND: Column not found');return row[column] as T;}
          return row as T;
        },
        raw:():Promise<never>=>Promise.reject(new ReadBudgetError('raw_without_cost_metadata_disabled')),
      };
      statementData.set(statement,{raw,rows,writes});return Object.freeze(statement);
    };
    return wrap(owner.prepare(sql));
  };
  const batch=<T>(owner:D1Database|D1DatabaseSession,statements:D1PreparedStatement[])=>execute<T>(statements,()=>owner.batch<T>(statements.map(statement=>statementData.get(statement)?.raw||fail('foreign_statement'))));
  return Object.freeze({
    prepare:(sql:string)=>prepare(database,sql),
    batch:<T>(statements:D1PreparedStatement[])=>batch<T>(database,statements),
    exec:()=>Promise.reject(new ReadBudgetError('unmetered_exec_disabled')),
    dump:()=>Promise.reject(new ReadBudgetError('unmetered_dump_disabled')),
    withSession:(constraint?:D1SessionBookmark|D1SessionConstraint):D1DatabaseSession=>{
      const session=database.withSession(constraint);
      return Object.freeze({prepare:(sql:string)=>prepare(session,sql),batch:<T>(statements:D1PreparedStatement[])=>batch<T>(session,statements),getBookmark:()=>session.getBookmark()});
    },
  });
}
