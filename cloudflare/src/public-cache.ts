import { DurableObject } from 'cloudflare:workers';
import { ApiError } from './data.ts';
import { guardD1, ReadBudgetError, READ_BUDGET_OBJECT } from './read-budget';
import { resolvePublicData } from './public-data.ts';
import { PublicCacheState,type PublicCacheFreshness } from './public-cache-state.ts';
import { PublicSqliteCacheStore } from './public-cache-sqlite-store.ts';
import { BudgetedPublicRevision } from './public-cache-revision-budget.ts';
import { publicItems } from './public-data.ts';
import { storePreparedCards } from './public-card-payloads.ts';
import { PUBLIC_CACHE_CONTENT_V2 as CONTENT, PUBLIC_CACHE_REVISION as REVISION, validPublicCacheKey, validatePublicSeed } from './public-cache-keys.ts';

const FRESH_MS=15*60_000;
// Only the exact current scoped revision is eligible. A quota outage may last
// through a reset; unchanged, unwithdrawn content remains browsable meanwhile.
const STALE_MS=7*24*60*60_000;
interface PublicValue { status: 200 | 404; json: string }
type PublicReply = { ok: true; payload: PublicValue; state: string } | { ok: false; status: ApiError['status']; message: string; budgetReason?: string; retryAfter?: number };

// One shared SQL cache coalesces each resource's misses across Cloudflare
// locations with a bounded hot-memory LRU. Personal state never crosses this
// boundary. The separate coordinator versions only resources a mutation touches.
export class QamousPublicCache extends DurableObject<Env> {
  private caches=new Map<string,PublicCacheState>();
  private cacheSizes=new Map<string,number>();
  private cacheBytes=0;
  private freshMetadata=new Map<string,PublicCacheFreshness>();
  private coordinator?:BudgetedPublicRevision;
  constructor(ctx: DurableObjectState,env: Env) {
    super(ctx,env);
  }
  private cacheFor(key:string):PublicCacheState {
    const known=this.caches.get(key);
    if(known){this.caches.delete(key);this.caches.set(key,known);return known;}
    const cache=new PublicCacheState(new PublicSqliteCacheStore(this.ctx.storage,(cost,tier)=>
      this.env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reservePublicCacheWrites(cost,tier),key),Date.now,bytes=>{
        if(this.caches.get(key)!==cache){cache.releaseMemory();return;}
        this.cacheBytes+=bytes-(this.cacheSizes.get(key)||0);this.cacheSizes.set(key,bytes);this.pruneCaches();
      },{
        get:()=>this.freshMetadata.get(key),
        put:value=>{if((this.freshMetadata.get(key)?.revision||0)>value.revision)return;this.freshMetadata.delete(key);this.freshMetadata.set(key,value);while(this.freshMetadata.size>8192)this.freshMetadata.delete(this.freshMetadata.keys().next().value!);},
      });
    this.caches.set(key,cache);this.pruneCaches();return cache;
  }
  private pruneCaches() {
    while(this.caches.size>128||this.cacheBytes>8_000_000) {
      const key=this.caches.keys().next().value!;const cache=this.caches.get(key)!;
      this.caches.delete(key);this.cacheBytes-=this.cacheSizes.get(key)||0;this.cacheSizes.delete(key);cache.releaseMemory();
    }
  }
  private revisions() {return this.coordinator??=new BudgetedPublicRevision(this.ctx.storage,cost=>
    this.env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reserveAuxiliaryWrites(cost,'revision'),{
      credits:()=>this.env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).revisionWriteCredits(),
      reserve:(id,cost,completion)=>this.env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).reserveRevisionLifecycle(id,cost,completion),
      complete:id=>this.env.READ_BUDGET.getByName(READ_BUDGET_OBJECT).completeRevisionLifecycle(id),
    });}
  async revision(): Promise<number> {
    const current=await this.revisions().run('snapshot',{},(revision,now,maintain)=>revision.snapshot([],now,maintain),true);
    if(current.anyPending) throw new Error('Public content mutation is in progress');
    return current.revision;
  }
  async snapshot(keys:string[]) {return this.revisions().run('snapshot',{},(revision,now,maintain)=>revision.snapshot(keys,now,maintain),true);}
  async invalidate(): Promise<void> {
    await this.revisions().run('invalidate',{},revision=>revision.invalidate());
  }
  async beginMutation(id:string):Promise<void> {await this.revisions().run('begin',{id},(revision,now)=>revision.begin(id,now));}
  async finishMutation(id:string):Promise<void> {await this.revisions().run('finish',{id},revision=>revision.finish(id));}
  async beginScoped(id:string,selectors:string[]):Promise<void> {await this.revisions().run('beginScoped',{id,selectors},(revision,now)=>revision.beginScoped(id,selectors,now));}
  async claimScoped(id:string,selectors:string[],existingOnly=false):Promise<boolean> {return this.revisions().run('claimScoped',{id,selectors,existingOnly},(revision,now)=>revision.claimScoped(id,selectors,now,existingOnly));}
  async renewScoped(id:string):Promise<boolean> {return this.revisions().run('renewScoped',{id},(revision,now)=>revision.renewScoped(id,now));}
  async finishScoped(id:string):Promise<void> {await this.revisions().run('finishScoped',{id},revision=>revision.finishScoped(id));}
  async seed(key: string,value: unknown,revision: number): Promise<{stored:boolean}> {
    validatePublicSeed(key,value);
    if(!Number.isSafeInteger(revision) || revision<1 || await this.env.PUBLIC_CACHE.getByName(REVISION).revision()!==revision) {
      throw new Error('Public snapshot generation changed; export a new snapshot');
    }
    const current=await this.env.PUBLIC_CACHE.getByName(REVISION).snapshot([key]);
    if(current.revision!==revision||current.anyPending) throw new Error('Public snapshot generation changed; export a new snapshot');
    return {stored:await this.cacheFor(key).prime(current.versions[0],{status:200,json:JSON.stringify(value)},FRESH_MS,STALE_MS)};
  }
  async publish(key:string,value:unknown,status:200|404,revision:number):Promise<{stored:boolean}> {
    if(!validPublicCacheKey(key)||(status!==200&&status!==404)) throw new Error('Invalid public mutation payload');
    if(status===200) validatePublicSeed(key,value);
    const current=await this.env.PUBLIC_CACHE.getByName(REVISION).snapshot([key]);
    if(current.pending[0]||current.versions[0]!==revision) return {stored:false};
    const lifetime=status===404?5*60_000:undefined;
    return {stored:await this.cacheFor(key).prime(revision,{status,json:JSON.stringify(value)},lifetime??FRESH_MS,lifetime??STALE_MS,'essential')};
  }
  async get(key: string,revision: number): Promise<PublicReply> {
    if(!validPublicCacheKey(key) || !Number.isSafeInteger(revision) || revision<1) return {ok:false,status:400,message:'Invalid public cache request'};
    try {
      const result=await this.cacheFor(key).get<PublicValue>(revision,FRESH_MS,STALE_MS,async()=>{
        const db=guardD1(this.env.DB,this.env,{route:'cache:'+key.split(':')[0],tier:'public'});
        try {return {status:200,json:JSON.stringify(await resolvePublicData(db,key,this.env.PUBLIC_CARD_PAYLOADS==='true'))};}
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
  if(!keys.length) return [];
  // Check each resource before and after loading. An unrelated mutation may
  // advance the coordinator's clock without invalidating this response.
  const coordinator=env.PUBLIC_CACHE.getByName(REVISION);
  let before:Awaited<ReturnType<typeof coordinator.snapshot>>;
  try {before=await coordinator.snapshot(keys);}
  catch {throw new ReadBudgetError('public_cache_coordination_unavailable',10);}
  if(before.pending.some(Boolean)) throw new ReadBudgetError('public_cache_mutation_pending',10);
  const values=await Promise.all(keys.map(async(key,index)=>{
    const result=await env.PUBLIC_CACHE.getByName(CONTENT).get(key,before.versions[index]);
    if(!result.ok) {
      if(result.budgetReason) throw new ReadBudgetError(result.budgetReason,result.retryAfter);
      throw new ApiError(result.status,result.message);
    }
    if(result.payload.status===404) throw new ApiError(404,String(JSON.parse(result.payload.json)));
    return JSON.parse(result.payload.json) as T;
  }));
  try {
    const after=await coordinator.snapshot(keys);
    if(after.pending.some(Boolean)||after.versions.some((version,index)=>version!==before.versions[index]))throw new Error('Public content changed');
  }catch {throw new ReadBudgetError('public_cache_generation_changed',10);}
  return values;
}

export async function invalidatePublicData(env: Pick<Env,'PUBLIC_CACHE'>): Promise<void> {
  await env.PUBLIC_CACHE.getByName(REVISION).invalidate();
}

export interface MutationPublication {key:string;value:unknown;status:200|404;}
function mutationRefreshKeys(selectors:string[]) {
  return [...new Set(selectors.filter(key=>/^word:\d+$/.test(key)).slice(0,4)
    .concat(selectors.filter(key=>key==='countries'||key==='posts')))];
}

// Reuse the essential allowance for a small, bounded refresh after a successful
// content write. A failed refresh never re-enables a pre-moderation snapshot.
export async function refreshPublicMutation(env:Env,selectors:string[]):Promise<MutationPublication[]> {
  const db=guardD1(env.DB,env,{route:'cache:mutation-refresh',tier:'essential'});
  const keys=mutationRefreshKeys(selectors);
  const entries:MutationPublication[]=[];
  for(const key of keys) {
    try {entries.push({key,value:await resolvePublicData(db,key),status:200});}
    catch(error) {
      if(error instanceof ApiError&&error.status===404) entries.push({key,value:error.message,status:404});
      else {console.log(JSON.stringify({event:'public_cache_mutation_refresh_deferred',resource:key.split(':')[0]}));break;}
    }
  }
  return entries;
}

export class PublicPreparationUncertainError extends Error {}
export async function preparePublicMutation(env:Env,selectors:string[],renew:()=>Promise<boolean>):Promise<void> {
  if(env.PUBLIC_CARD_PAYLOADS!=='true')return;
  let uncertain=false;
  const requireLease=async()=>{if(!await renew())throw new Error('Public preparation lease expired');};
  const db=guardD1(env.DB,env,{route:'cache:prepare-cards',tier:'essential',beforeWrite:requireLease,unknownWrite:()=>{uncertain=true;}});
  const ids=new Set<number>();
  try {
  for(const key of selectors.filter(key=>/^word:\d+$/.test(key)).slice(0,4)) {
    await requireLease();
    const rows=await db.prepare(`SELECT d.id FROM public_definitions d JOIN words w ON w.id=d.wordId
      WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=?)
      AND d.reportCount<=5 AND w.reportCount<=5 ORDER BY d.id LIMIT 51`).bind(Number(key.slice(5))).all<{id:number}>();
    // Large dictionary maintenance uses the bounded offline publisher instead
    // of making an interactive writer prepare an unbounded collection.
    if(rows.results.length>50)continue;
    rows.results.forEach(row=>ids.add(Number(row.id)));
  }
  const values=[...ids];
  for(let offset=0;offset<values.length;offset+=50) {
    await requireLease();
    const cards=await publicItems(db,values.slice(offset,offset+50),false);
    await storePreparedCards(db,cards);
  }
  } catch(error) {
    // A lost INSERT acknowledgement may still be executing in D1. Keep the
    // word barrier until its lease expires, beyond D1's statement timeout.
    if(uncertain)throw new PublicPreparationUncertainError('Prepared public card write outcome is unknown');
    throw error;
  }
}

export function publicMutationBarrier(env:Pick<Env,'PUBLIC_CACHE'>,resolveScope:()=>Promise<string[]>,refresh?:(selectors:string[])=>Promise<MutationPublication[]>,prepare?:(selectors:string[],renew:()=>Promise<boolean>)=>Promise<void>) {
  const id=crypto.randomUUID();let started=false,unknown=false;
  const selectors=new Set<string>();
  const coordinator=env.PUBLIC_CACHE.getByName(REVISION);
  const scope=async()=>{for(const key of await resolveScope()) selectors.add(key);return [...selectors];};
  return {
    async beforeWrite() {
      const keys=await scope();
      if(keys.length) {
        if(!await coordinator.claimScoped(id,keys)) throw new ApiError(409,'This word is being updated. Please try again.');
        started=true;
        // A rename may have completed between metadata lookup and this claim.
        // Re-resolve while the known word IDs are held, then protect the full
        // current membership before allowing any SQL to be submitted.
        if(keys.some(key=>/^word:\d+$/.test(key))&&!await coordinator.claimScoped(id,await scope())) {
          throw new ApiError(409,'This word is being updated. Please try again.');
        }
      }
    },
    unknownWrite() {unknown=true;},
    async finish() {
      if(!started) return;
      if(unknown) {
        // Retain the lease and its word claims. Try to include IDs allocated by
        // an uncertain write, but never release its old-content barrier.
        try {await coordinator.beginScoped(id,await scope());}
        catch {console.error(JSON.stringify({event:'public_cache_mutation_scope_delayed'}));}
        return;
      }
      try {
        // Resolve again to include IDs allocated by INSERT and both the old and
        // new membership of renamed words. The original scopes remain held.
        const size=selectors.size,keys=await scope();
        if(selectors.size!==size&&!await coordinator.claimScoped(id,keys,true))throw new Error('Public mutation lease expired or its expanded scope is busy');
        // Derived D1 rows must be prepared while the content ticket is held.
        // Releasing first would allow a newer edit to be overwritten by an
        // older preparation result. Failed preparation leaves rows dirty.
        if(prepare) {
          try {await prepare(keys,()=>coordinator.renewScoped(id));}
          catch(error) {
            console.log(JSON.stringify({event:'public_card_preparation_deferred'}));
            if(error instanceof PublicPreparationUncertainError)return;
          }
        }
        await coordinator.finishScoped(id);
        if(refresh) {
          // Capture versions BEFORE the fresh read. A simultaneous edit must
          // never let an older payload be published under its newer version.
          const refreshKeys=mutationRefreshKeys(keys),before=await coordinator.snapshot(refreshKeys);
          const allowed=refreshKeys.filter((_,index)=>!before.pending[index]);
          const entries=allowed.length?await refresh(allowed):[];
          await Promise.all(entries.map(entry=>{
            const index=refreshKeys.indexOf(entry.key);
            return index<0||before.pending[index]?Promise.resolve():
              env.PUBLIC_CACHE.getByName(CONTENT).publish(entry.key,entry.value,entry.status,before.versions[index]);
          }));
        }
      }
      catch {
        // An unfinished durable ticket blocks only its affected resources.
        // Expiry advances those generations again after uncertain SQL work.
        console.error(JSON.stringify({event:'public_cache_mutation_completion_delayed'}));
      }
    },
  };
}
