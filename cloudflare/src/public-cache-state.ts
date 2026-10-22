// The cache stores public data only. This module has no Worker imports so the
// concurrency, failure, expiry and invalidation rules can run in local tests.
export interface PublicCacheStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}
interface CacheRecord { revision: number; token: string; freshUntil: number; staleUntil: number; parts: number }
export type CacheResult<T> = { value: T; state: 'hit' | 'miss' | 'stale' | 'coalesced' };
const CHUNK_SIZE = 20_000;
const MAX_BYTES = 16_000_000;

export class PublicCacheState {
  private pending = new Map<number, Promise<CacheResult<unknown>>>();
  private retryAt = new Map<number, number>();
  private latestRevision = 0;
  private storageTail: Promise<void> = Promise.resolve();
  private store: PublicCacheStore;
  private clock: () => number;
  constructor(store: PublicCacheStore,clock: () => number = Date.now) {this.store=store;this.clock=clock;}

  private async stored<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.storageTail;
    let release!: () => void;
    this.storageTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }

  async prime<T>(revision: number,value: T,freshMs: number,staleMs: number): Promise<void> {
    this.latestRevision=Math.max(this.latestRevision,revision);
    const json=JSON.stringify(value);
    if(new TextEncoder().encode(json).byteLength>MAX_BYTES) throw new Error('Public cache result exceeds its size limit');
    await this.stored(async()=>{
      if(revision!==this.latestRevision) return;
      const parts=Math.max(1,Math.ceil(json.length/CHUNK_SIZE)),token=crypto.randomUUID();
      for(let i=0;i<parts;i++) await this.store.put(`value:${token}:${i}`,json.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));
      const previous=await this.store.get<CacheRecord>('record'),now=this.clock();
      // The record is committed last. A crash halfway through writing chunks
      // leaves the previously committed value intact.
      await this.store.put('record',{revision,token,freshUntil:now+freshMs,staleUntil:now+staleMs,parts});
      if(previous) for(let i=0;i<previous.parts;i++) await this.store.delete(`value:${previous.token}:${i}`);
      this.retryAt.delete(revision);
    });
  }

  async get<T>(revision: number, freshMs: number, staleMs: number, load: () => Promise<T>,lifetimes?: (value:T)=>{freshMs:number;staleMs:number}): Promise<CacheResult<T>> {
    this.latestRevision = Math.max(this.latestRevision, revision);
    const saved = await this.stored(() => this.read<T>(revision));
    if (saved && saved.record.freshUntil > this.clock()) return { value: saved.value, state: 'hit' };
    if (saved && (this.retryAt.get(revision) || 0) > this.clock()) return { value: saved.value, state: 'stale' };
    const pending = this.pending.get(revision);
    if (pending) {
      const result = await pending;
      return { value: result.value as T, state: result.state === 'stale' ? 'stale' : 'coalesced' };
    }
    const work = (async (): Promise<CacheResult<T>> => {
      try {
        const value = await load();
        // A newer generation may have arrived while this load was awaiting D1.
        // It must never be overwritten by an older in-flight response.
        const lifetime=lifetimes?.(value)||{freshMs,staleMs};
        await this.prime(revision,value,lifetime.freshMs,lifetime.staleMs);
        return { value, state: 'miss' };
      } catch (error) {
        // Moderation invalidations change the revision. An old revision is
        // never eligible for the fallback, including during a quota outage.
        if (saved && saved.record.staleUntil > this.clock()) {
          this.retryAt.set(revision, this.clock() + 60_000);
          return { value: saved.value, state: 'stale' };
        }
        throw error;
      }
    })();
    this.pending.set(revision, work);
    try { return await work; } finally { if (this.pending.get(revision) === work) this.pending.delete(revision); }
  }

  private async read<T>(revision: number): Promise<{record: CacheRecord; value: T} | undefined> {
    const record = await this.store.get<CacheRecord>('record');
    if (!record || record.revision !== revision || record.staleUntil <= this.clock()) return;
    const chunks: string[] = [];
    for (let i = 0; i < record.parts; i++) {
      const part = await this.store.get<string>(`value:${record.token}:${i}`);
      if (part === undefined) return;
      chunks.push(part);
    }
    return { record, value: JSON.parse(chunks.join('')) as T };
  }
}
