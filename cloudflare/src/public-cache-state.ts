// The cache stores public data only. This module has no Worker imports so the
// concurrency, failure, expiry and invalidation rules can run in local tests.
export interface LegacyPublicCacheStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}
export interface CacheRecord { revision: number; token: string; freshUntil: number; staleUntil: number; parts: number }
export interface StoredPublicCacheEntry {record:CacheRecord;json:string;legacy?:boolean;}
export interface AtomicPublicCacheStore {
  readEntry():Promise<StoredPublicCacheEntry|undefined>;
  writeEntry(entry:StoredPublicCacheEntry,tier:'public'|'essential'):Promise<boolean>;
}
export type PublicCacheStore=LegacyPublicCacheStore|AtomicPublicCacheStore;
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
  private memory?:StoredPublicCacheEntry&{value:unknown};
  private durable?:StoredPublicCacheEntry;
  constructor(store: PublicCacheStore,clock: () => number = Date.now) {this.store=store;this.clock=clock;}

  private async stored<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.storageTail;
    let release!: () => void;
    this.storageTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }

  async prime<T>(revision: number,value: T,freshMs: number,staleMs: number,tier:'public'|'essential'='public'): Promise<boolean> {
    this.latestRevision=Math.max(this.latestRevision,revision);
    const json=JSON.stringify(value);
    if(new TextEncoder().encode(json).byteLength>MAX_BYTES) throw new Error('Public cache result exceeds its size limit');
    return this.stored(async()=>{
      if(revision!==this.latestRevision) return false;
      const now=this.clock();
      if('writeEntry' in this.store) {
        const previous=this.durable??await this.store.readEntry();
        const record:CacheRecord={revision,token:'',freshUntil:now+freshMs,staleUntil:now+staleMs,parts:1};
        const entry={record,json};
        let stored=true;
        // Unchanged content needs no chunk or metadata rewrite on every TTL.
        // Renew the durable stale window only as it approaches its end.
        if(!(previous&&!previous.legacy&&previous.record.revision===revision&&previous.json===json&&previous.record.staleUntil>now+freshMs)) {
          stored=await this.store.writeEntry(entry,tier);
          if(stored)this.durable=entry;
        } else this.durable=previous;
        this.memory={...entry,value:freezePublicValue(JSON.parse(json))};
        this.retryAt.delete(revision);
        return stored;
      }
      const parts=Math.max(1,Math.ceil(json.length/CHUNK_SIZE)),token=crypto.randomUUID();
      for(let i=0;i<parts;i++) await this.store.put(`value:${token}:${i}`,json.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));
      const previous=await this.store.get<CacheRecord>('record');
      // The record is committed last. A crash halfway through writing chunks
      // leaves the previously committed value intact.
      await this.store.put('record',{revision,token,freshUntil:now+freshMs,staleUntil:now+staleMs,parts});
      if(previous) for(let i=0;i<previous.parts;i++) await this.store.delete(`value:${previous.token}:${i}`);
      this.retryAt.delete(revision);
      return true;
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
          const detail=error as {reason?:string;retryAfter?:number};
          const dailyStop=['daily_budget','do_storage_budget','cost_circuit_open'].includes(detail?.reason||'');
          const seconds=typeof detail?.retryAfter==='number'&&Number.isFinite(detail.retryAfter)?detail.retryAfter:60;
          this.retryAt.set(revision,this.clock()+Math.min(3600,Math.max(dailyStop?900:60,seconds))*1000);
          return { value: saved.value, state: 'stale' };
        }
        throw error;
      }
    })();
    this.pending.set(revision, work);
    try { return await work; } finally { if (this.pending.get(revision) === work) this.pending.delete(revision); }
  }

  private async read<T>(revision: number): Promise<{record: CacheRecord; value: T} | undefined> {
    if('readEntry' in this.store) {
      if(this.memory?.record.revision===revision&&this.memory.record.staleUntil>this.clock())return this.memory as {record:CacheRecord;value:T};
      const entry=await this.store.readEntry();
      if(!entry)return;
      this.durable=entry;
      if(entry.record.revision!==revision||entry.record.staleUntil<=this.clock())return;
      this.memory={...entry,value:freezePublicValue(JSON.parse(entry.json))};
      return this.memory as {record:CacheRecord;value:T};
    }
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

function freezePublicValue<T>(value:T):T {
  if(value&&typeof value==='object') {
    for(const child of Object.values(value))freezePublicValue(child);
    Object.freeze(value);
  }
  return value;
}
