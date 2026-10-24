import type {AtomicPublicCacheStore,CacheRecord,StoredPublicCacheEntry} from './public-cache-state.ts';

interface SqlStore {
  databaseSize?:number;
  exec<T extends Record<string,string|number|null>=Record<string,string|number|null>>(query:string,...values:(string|number|null)[]):{toArray():T[];rowsWritten?:number};
}
interface Store {
  sql:SqlStore;
  transactionSync<T>(callback:()=>T):T;
  get<T>(key:string):Promise<T|undefined>;
}
export const PUBLIC_CACHE_SQL_CHUNK_BYTES=512_000;
export const PUBLIC_CACHE_SQL_MAX_BYTES=200_000_000;
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
  private resource:string;
  constructor(store:Store,reserveWrites:(cost:number,tier:'public'|'essential')=>Promise<boolean>,resource='') {
    this.store=store;this.reserveWrites=reserveWrites;this.resource=resource;
  }
  private exists():boolean {
    if(!this.initialized)this.initialized=this.store.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='public_cache_values_v3'").toArray().length>0;
    return this.initialized;
  }
  async readEntry():Promise<StoredPublicCacheEntry|undefined> {
    const row=this.exists()?this.store.sql.exec<{record:string;payload:string;parts:number}>('SELECT record,payload,parts FROM public_cache_values_v3 WHERE resource=? AND id=0',this.resource).toArray()[0]:undefined;
    if(row) {
      if(row.parts<0||row.parts>Math.ceil(MAX_BYTES/PUBLIC_CACHE_SQL_CHUNK_BYTES))throw new Error('Invalid public cache chunks');
      const parts=row.parts?this.store.sql.exec<{id:number;payload:string}>('SELECT id,payload FROM public_cache_values_v3 WHERE resource=? AND id>0 ORDER BY id',this.resource).toArray():[];
      if(parts.length!==row.parts||parts.some((part,index)=>part.id!==index+1))throw new Error('Incomplete public cache entry');
      return {record:JSON.parse(row.record) as CacheRecord,json:row.parts?parts.map(part=>part.payload).join(''):row.payload!};
    }
    // Read older deployed KV records without migrating or deleting them on a
    // public request. The next bounded SQL write supersedes the old snapshot.
    if(this.resource)return;
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
    const existed=this.exists();
    const previous=existed?this.store.sql.exec<{record:string;payload:string;parts:number}>('SELECT record,payload,parts FROM public_cache_values_v3 WHERE resource=? AND id=0',this.resource).toArray()[0]:undefined;
    if(previous&&Number((JSON.parse(previous.record) as CacheRecord).revision)>entry.record.revision)return false;
    const previousParts=previous?.parts?this.store.sql.exec<{id:number;payload:string}>('SELECT id,payload FROM public_cache_values_v3 WHERE resource=? AND id>0 ORDER BY id',this.resource).toArray():[];
    const previousJson=previous?.parts?previousParts.map(part=>part.payload).join(''):previous?.payload;
    const unchanged=previousJson===entry.json;
    const oldBytes=previousJson===undefined?0:encoder.encode(previousJson).byteLength;
    // Keep the shared cache far below the account's storage allowance. Refuse
    // new/growing entries before any grant or DDL; existing content can still
    // renew metadata or shrink while maintenance frees space.
    const exceedsStorage=()=>{
      if(previousJson!==undefined&&bytes.length<=oldBytes)return false;
      const size=this.store.sql.databaseSize;
      const growth=Math.max(0,bytes.length-oldBytes)+encoder.encode(this.resource).byteLength*(1+Math.ceil(bytes.length/PUBLIC_CACHE_SQL_CHUNK_BYTES))+64_000;
      return typeof size==='number'&&(!Number.isFinite(size)||size<0||size+growth>PUBLIC_CACHE_SQL_MAX_BYTES);
    };
    if(exceedsStorage())return false;
    const parts=jsonParts(bytes);
    const cost=(existed?0:2)+1+(unchanged?0:parts.length+Math.max(0,previousParts.length-parts.length));
    let allowed=false;
    try {allowed=await this.reserveWrites(cost,tier);}catch { /* A lost grant acknowledgement cannot authorize storage writes. */ }
    if(!allowed)return false;
    const stored=this.store.transactionSync(()=>{
      // Another resource may have grown while the asynchronous grant ran.
      if(exceedsStorage())return false;
      if(this.exists()) {
        const current=this.store.sql.exec<{record:string;payload:string;parts:number}>('SELECT record,payload,parts FROM public_cache_values_v3 WHERE resource=? AND id=0',this.resource).toArray()[0];
        if(current&&Number((JSON.parse(current.record) as CacheRecord).revision)>entry.record.revision)return false;
        const currentJson=current?.parts?this.store.sql.exec<{payload:string}>('SELECT payload FROM public_cache_values_v3 WHERE resource=? AND id>0 ORDER BY id',this.resource).toArray().map(part=>part.payload).join(''):current?.payload;
        // An LRU eviction can create a second state while an older load is
        // still pending. It must not replace a newer committed resource.
        if(current?.record!==previous?.record||currentJson!==previousJson)return false;
      }
      let remaining=cost;
      const exec=(query:string,...values:(string|number|null)[])=>{const cursor=this.store.sql.exec(query,...values);cursor.toArray();if(typeof cursor.rowsWritten==='number'&&(remaining-=cursor.rowsWritten)<0)throw new Error('Public cache storage exceeded its write grant');};
      exec('CREATE TABLE IF NOT EXISTS public_cache_values_v3(resource TEXT NOT NULL,id INTEGER NOT NULL,record TEXT,payload TEXT NOT NULL,parts INTEGER NOT NULL,PRIMARY KEY(resource,id)) WITHOUT ROWID');
      if(!unchanged) {
        for(let index=0;index<parts.length;index++)exec('INSERT INTO public_cache_values_v3(resource,id,record,payload,parts) VALUES(?,?,NULL,?,0) ON CONFLICT(resource,id) DO UPDATE SET payload=excluded.payload',this.resource,index+1,parts[index]);
        exec('DELETE FROM public_cache_values_v3 WHERE resource=? AND id>?',this.resource,parts.length);
      }
      exec('INSERT INTO public_cache_values_v3(resource,id,record,payload,parts) VALUES(?,0,?,?,?) ON CONFLICT(resource,id) DO UPDATE SET record=excluded.record,payload=excluded.payload,parts=excluded.parts',this.resource,JSON.stringify(entry.record),parts.length?'':entry.json,parts.length);
      return true;
    });
    if(stored)this.initialized=true;
    return stored;
  }
}
