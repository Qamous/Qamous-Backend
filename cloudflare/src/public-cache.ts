import { DurableObject } from 'cloudflare:workers';
import { ApiError } from './data.ts';
import { guardD1, ReadBudgetError } from './read-budget';
import { resolvePublicData } from './public-data.ts';
import { PublicCacheState } from './public-cache-state.ts';
import { PublicCacheRevision } from './public-cache-revision.ts';
import { PUBLIC_CACHE_PREFIX as PREFIX, PUBLIC_CACHE_REVISION as REVISION, validPublicCacheKey, validatePublicSeed } from './public-cache-keys.ts';

const FRESH_MS=15*60_000;
const STALE_MS=24*60*60_000;
interface PublicValue { status: 200 | 404; json: string }
type PublicReply = { ok: true; payload: PublicValue; state: string } | { ok: false; status: ApiError['status']; message: string; budgetReason?: string; retryAfter?: number };

// One object per public resource coalesces misses across every Cloudflare
// location. Personal cookies, identities, session state and votes never cross
// this boundary. The revision object invalidates all content after mutations.
export class QamousPublicCache extends DurableObject<Env> {
  private cache: PublicCacheState;
  private coordinator?:PublicCacheRevision;
  constructor(ctx: DurableObjectState,env: Env) {
    super(ctx,env);
    this.cache=new PublicCacheState({
      get: <T>(key: string)=>ctx.storage.get<T>(key),
      put: <T>(key: string,value: T)=>ctx.storage.put(key,value),
      delete: (key: string)=>ctx.storage.delete(key),
    });
  }
  private revisions() {return this.coordinator??=new PublicCacheRevision(this.ctx.storage);}
  async revision(): Promise<number> {
    const current=this.revisions().current();
    if(current.pending) throw new Error('Public content mutation is in progress');
    return current.revision;
  }
  async invalidate(): Promise<void> {
    this.revisions().invalidate();
  }
  async beginMutation(id:string):Promise<void> {this.revisions().begin(id);}
  async finishMutation(id:string):Promise<void> {this.revisions().finish(id);}
  async seed(key: string,value: unknown,revision: number): Promise<{stored:boolean}> {
    validatePublicSeed(key,value);
    if(!Number.isSafeInteger(revision) || revision<1 || await this.env.PUBLIC_CACHE.getByName(REVISION).revision()!==revision) {
      throw new Error('Public snapshot generation changed; export a new snapshot');
    }
    await this.cache.prime(revision,{status:200,json:JSON.stringify(value)},FRESH_MS,STALE_MS);
    return {stored:true};
  }
  async get(key: string,revision: number): Promise<PublicReply> {
    if(!validPublicCacheKey(key) || !Number.isSafeInteger(revision) || revision<1) return {ok:false,status:400,message:'Invalid public cache request'};
    try {
      const result=await this.cache.get<PublicValue>(revision,FRESH_MS,STALE_MS,async()=>{
        const db=guardD1(this.env.DB,this.env,{route:'cache:'+key.split(':')[0],tier:'public'});
        try {return {status:200,json:JSON.stringify(await resolvePublicData(db,key))};}
        catch(error) {if(error instanceof ApiError && error.status===404) return {status:404,json:JSON.stringify(error.message)};throw error;}
      },value=>value.status===404?{freshMs:5*60_000,staleMs:5*60_000}:{freshMs:FRESH_MS,staleMs:STALE_MS});
      if(result.state!=='hit') console.log(JSON.stringify({event:'public_cache',resource:key.split(':')[0],state:result.state}));
      return {ok:true,payload:result.value,state:result.state};
    } catch(error) {
      if(error instanceof ReadBudgetError) return {ok:false,status:503,message:error.message,budgetReason:error.reason,retryAfter:error.retryAfter};
      return {ok:false,status:error instanceof ApiError?error.status:503,message:error instanceof ApiError?error.message:'Public data is temporarily unavailable. Please try again later.'};
    }
  }
}

export async function publicData<T>(env: Pick<Env,'PUBLIC_CACHE'>,key: string): Promise<T> {
  return (await publicDataMany<T>(env,[key]))[0];
}

export async function publicDataMany<T>(env: Pick<Env,'PUBLIC_CACHE'>,keys: string[]): Promise<T[]> {
  // If revision coordination fails, fail closed. Serving an older unknown
  // generation here could expose a definition removed by moderation.
  let revision:number;
  try {revision=await env.PUBLIC_CACHE.getByName(REVISION).revision();}
  catch {throw new ReadBudgetError('public_cache_coordination_unavailable',10);}
  const values=await Promise.all(keys.map(async key=>{
    const result=await env.PUBLIC_CACHE.getByName(PREFIX+key).get(key,revision);
    if(!result.ok) {
      if(result.budgetReason) throw new ReadBudgetError(result.budgetReason,result.retryAfter);
      throw new ApiError(result.status,result.message);
    }
    if(result.payload.status===404) throw new ApiError(404,String(JSON.parse(result.payload.json)));
    return JSON.parse(result.payload.json) as T;
  }));
  try {
    if(await env.PUBLIC_CACHE.getByName(REVISION).revision()!==revision)throw new Error('Public content changed');
  }catch {throw new ReadBudgetError('public_cache_generation_changed',10);}
  return values;
}

export async function invalidatePublicData(env: Pick<Env,'PUBLIC_CACHE'>): Promise<void> {
  await env.PUBLIC_CACHE.getByName(REVISION).invalidate();
}

export function publicMutationBarrier(env:Pick<Env,'PUBLIC_CACHE'>) {
  const id=crypto.randomUUID();let started=false,unknown=false;
  return {
    async beforeWrite() {await env.PUBLIC_CACHE.getByName(REVISION).beginMutation(id);started=true;},
    unknownWrite() {unknown=true;},
    async finish() {
      if(!started||unknown) return;
      try {await env.PUBLIC_CACHE.getByName(REVISION).finishMutation(id);}
      catch {
        // The durable pending ticket continues to deny cache reads and its
        // expiry advances the generation again. A committed write can still
        // be acknowledged without exposing a removed pre-mutation snapshot.
        console.error(JSON.stringify({event:'public_cache_mutation_completion_delayed'}));
      }
    },
  };
}
