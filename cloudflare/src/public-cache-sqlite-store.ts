import type {AtomicPublicCacheStore,CacheRecord,StoredPublicCacheEntry} from './public-cache-state.ts';

interface SqlStore {
  exec<T extends Record<string,string|number|null>=Record<string,string|number|null>>(query:string,...values:(string|number|null)[]):{toArray():T[]};
}
interface Store {
  sql:SqlStore;
  transactionSync<T>(callback:()=>T):T;
  get<T>(key:string):Promise<T|undefined>;
}
export const PUBLIC_CACHE_SQL_CHUNK_BYTES=512_000;
const MAX_BYTES=16_000_000;
const encoder=new TextEncoder(),decoder=new TextDecoder();

function jsonParts(bytes:Uint8Array):string[] {
  const parts:string[]=[];
  if(bytes.length>PUBLIC_CACHE_SQL_CHUNK_BYTES)for(let start=0;start<bytes.length;) {
    let end=Math.min(bytes.length,start+PUBLIC_CACHE_SQL_CHUNK_BYTES);
    while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
    parts.push(decoder.decode(bytes.subarray(start,end)));start=end;
  }
  return parts;
}

// Offline seed planners pass JSON.stringify({status:200,json:JSON.stringify(value)}).
// Add one budget-counter row to this direct-storage cost for each seed call.
export function publicCacheInitialWriteRows(json:string):number {
  const bytes=encoder.encode(json);
  if(bytes.length>MAX_BYTES)throw new Error('Public cache result exceeds its size limit');
  return 1+jsonParts(bytes).length;
}

// Unlike DO's KV facade, direct SQLite charges a row per stored entry rather
// than a row per 2 KB of value. Ordinary public resources fit in one row.
export class PublicSqliteCacheStore implements AtomicPublicCacheStore {
  private store:Store;
  private reserveWrites:(cost:number,tier:'public'|'essential')=>Promise<boolean>;
  private initialized=false;
  constructor(store:Store,reserveWrites:(cost:number,tier:'public'|'essential')=>Promise<boolean>) {
    this.store=store;this.reserveWrites=reserveWrites;
  }
  private initialize() {
    if(this.initialized)return;
    this.store.transactionSync(()=>{
      this.store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_entry_v2(id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL,payload TEXT,parts INTEGER NOT NULL)');
      this.store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_parts_v2(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)');
    });
    this.initialized=true;
  }
  async readEntry():Promise<StoredPublicCacheEntry|undefined> {
    this.initialize();
    const row=this.store.sql.exec<{record:string;payload:string|null;parts:number}>('SELECT record,payload,parts FROM public_cache_entry_v2 WHERE id=1').toArray()[0];
    if(row) {
      if(row.parts<0||row.parts>Math.ceil(MAX_BYTES/PUBLIC_CACHE_SQL_CHUNK_BYTES))throw new Error('Invalid public cache chunks');
      const parts=row.parts?this.store.sql.exec<{id:number;payload:string}>('SELECT id,payload FROM public_cache_parts_v2 ORDER BY id').toArray():[];
      if(parts.length!==row.parts||parts.some((part,index)=>part.id!==index))throw new Error('Incomplete public cache entry');
      return {record:JSON.parse(row.record) as CacheRecord,json:row.parts?parts.map(part=>part.payload).join(''):row.payload!};
    }
    // Read older deployed KV records without migrating or deleting them on a
    // public request. The next bounded SQL write supersedes the old snapshot.
    const record=await this.store.get<CacheRecord>('record');
    if(!record)return;
    if(!Number.isSafeInteger(record.parts)||record.parts<1||record.parts>801)throw new Error('Invalid legacy public cache chunks');
    const parts=[];
    for(let index=0;index<record.parts;index++) {
      const part=await this.store.get<string>(`value:${record.token}:${index}`);
      if(part===undefined)return;
      parts.push(part);
    }
    return {record,json:parts.join(''),legacy:true};
  }
  async writeEntry(entry:StoredPublicCacheEntry,tier:'public'|'essential'):Promise<boolean> {
    const bytes=encoder.encode(entry.json);
    if(bytes.length>MAX_BYTES)throw new Error('Public cache result exceeds its size limit');
    this.initialize();
    const previous=this.store.sql.exec<{record:string;payload:string|null;parts:number}>('SELECT record,payload,parts FROM public_cache_entry_v2 WHERE id=1').toArray()[0];
    const previousParts=previous?.parts?this.store.sql.exec<{id:number;payload:string}>('SELECT id,payload FROM public_cache_parts_v2 ORDER BY id').toArray():[];
    const previousJson=previous?.parts?previousParts.map(part=>part.payload).join(''):previous?.payload;
    const unchanged=previousJson===entry.json;
    const parts=jsonParts(bytes);
    const cost=1+(unchanged?0:parts.length+Math.max(0,previousParts.length-parts.length));
    let allowed=false;
    try {allowed=await this.reserveWrites(cost,tier);}catch { /* A lost grant acknowledgement cannot authorize storage writes. */ }
    if(!allowed)return false;
    this.store.transactionSync(()=>{
      if(!unchanged) {
        for(let index=0;index<parts.length;index++)this.store.sql.exec('INSERT INTO public_cache_parts_v2(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',index,parts[index]);
        this.store.sql.exec('DELETE FROM public_cache_parts_v2 WHERE id>=?',parts.length);
      }
      this.store.sql.exec('INSERT INTO public_cache_entry_v2(id,record,payload,parts) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,payload=excluded.payload,parts=excluded.parts',JSON.stringify(entry.record),parts.length?null:entry.json,parts.length);
    });
    return true;
  }
}
