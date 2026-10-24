import {validPublicCacheKey,publicItemIds} from './public-cache-keys.ts';

interface SqlStore {exec<T extends Record<string,string|number|null>=Record<string,string|number|null>>(query:string,...values:(string|number|null)[]):{toArray():T[];one():T};}
interface Store {sql:SqlStore;transactionSync<T>(callback:()=>T):T;}
export interface PublicCacheSnapshot {revision:number;versions:number[];pending:boolean[];anyPending:boolean;}
// D1 has a 30-second statement/batch timeout. Every admitted mutation renews
// this two-minute barrier immediately before executing; a lost request cannot
// leave old public data eligible when the barrier eventually recovers.
export const PUBLIC_MUTATION_LEASE_MS=120_000;
const MAX_SELECTORS=4096;
const MAX_KEYS=4096;
const validIdentifier=(id:string)=>typeof id==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(id);
const prefixSelector=(value:string)=>/^(?:word|cards|feed|explore|related|seo-shard|seo-browse|seo-dialect):\*$/.test(value)
  || /^related:[A-Z]{2}:\*$/.test(value) || /^seo-browse:(?:en|ar):\*$/.test(value);
export function validPublicCacheSelector(value:string):boolean {
  return typeof value==='string'&&(prefixSelector(value)||validPublicCacheKey(value));
}
function selectorsFor(key:string):string[] {
  const selectors=[key],colon=key.indexOf(':');
  if(colon!==-1) selectors.push(key.slice(0,colon)+':*');
  // Reuse the existing bounded mutation scopes for exact-ID batches. Content
  // edits and moderation invalidate every batch containing an affected ID;
  // unrelated card ranges stay warm, including legacy seeded snapshots.
  const itemIds=publicItemIds(key);
  if(itemIds)selectors.push('cards:*',...itemIds.map(id=>'cards:'+Math.floor(id/100)));
  const related=/^related:([A-Z]{2}):/.exec(key);
  if(related) selectors.push(`related:${related[1]}:*`);
  const browse=/^seo-browse:(en|ar):/.exec(key);
  if(browse) selectors.push(`seo-browse:${browse[1]}:*`);
  return [...new Set(selectors)];
}

export class PublicCacheRevision {
  private store:Store;
  constructor(store:Store) {
    this.store=store;
    store.transactionSync(()=>{
      // Preserve these two deployed tables. Seeded cache records carry their
      // legacy revision; untouched resources continue to use that same value.
      store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL)');
      store.sql.exec('INSERT OR IGNORE INTO public_cache_revision VALUES(1,1)');
      store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_mutations(id TEXT PRIMARY KEY,expires INTEGER NOT NULL)');
      store.sql.exec('CREATE INDEX IF NOT EXISTS public_cache_mutations_expiry ON public_cache_mutations(expires)');
      store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_clock(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL)');
      store.sql.exec('INSERT OR IGNORE INTO public_cache_clock SELECT id,revision FROM public_cache_revision WHERE id=1');
      store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_scope_versions(selector TEXT PRIMARY KEY,revision INTEGER NOT NULL) WITHOUT ROWID');
      store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_scoped_mutations(id TEXT PRIMARY KEY,expires INTEGER NOT NULL)');
      store.sql.exec('CREATE INDEX IF NOT EXISTS public_cache_scoped_mutations_expiry ON public_cache_scoped_mutations(expires)');
      store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_mutation_scopes(mutationId TEXT NOT NULL,selector TEXT NOT NULL,PRIMARY KEY(mutationId,selector)) WITHOUT ROWID');
      store.sql.exec('CREATE INDEX IF NOT EXISTS public_cache_mutation_scopes_selector ON public_cache_mutation_scopes(selector,mutationId)');
      store.sql.exec('UPDATE public_cache_clock SET revision=(SELECT revision FROM public_cache_revision WHERE id=1) WHERE id=1 AND revision<(SELECT revision FROM public_cache_revision WHERE id=1)');
    });
  }
  private next():number {
    const revision=Number(this.store.sql.exec('UPDATE public_cache_clock SET revision=revision+1 WHERE id=1 RETURNING revision').one().revision);
    if(!Number.isSafeInteger(revision)) throw new Error('Public cache revision exhausted');
    return revision;
  }
  private bump(selectors:string[],revision=this.next()) {
    for(const selector of selectors) this.store.sql.exec('INSERT INTO public_cache_scope_versions(selector,revision) VALUES(?,?) ON CONFLICT(selector) DO UPDATE SET revision=excluded.revision',selector,revision);
  }
  private legacyBump() {this.store.sql.exec('UPDATE public_cache_revision SET revision=? WHERE id=1',this.next());}
  private expire(now:number) {
    const sql=this.store.sql;
    // Do not issue a DELETE or UPDATE for an ordinary read with no expirations.
    if(sql.exec('SELECT id FROM public_cache_mutations WHERE expires<=? LIMIT 1',now).toArray().length) {
      sql.exec('DELETE FROM public_cache_mutations WHERE expires<=?',now);
      this.legacyBump();
    }
    const expired=sql.exec<{id:string}>('SELECT id FROM public_cache_scoped_mutations WHERE expires<=?',now).toArray();
    if(!expired.length) return;
    const scopes=new Set<string>();
    for(const {id} of expired) {
      for(const row of sql.exec<{selector:string}>('SELECT selector FROM public_cache_mutation_scopes WHERE mutationId=?',id).toArray()) scopes.add(row.selector);
      sql.exec('DELETE FROM public_cache_mutation_scopes WHERE mutationId=?',id);
      sql.exec('DELETE FROM public_cache_scoped_mutations WHERE id=?',id);
    }
    if(scopes.size) this.bump([...scopes]);
  }
  /** Legacy global generation. New readers use snapshot(keys) instead. */
  current(now=Date.now()) {
    return this.store.transactionSync(()=>{
      this.expire(now);
      return {revision:Number(this.store.sql.exec('SELECT revision FROM public_cache_revision WHERE id=1').one().revision),
        pending:Number(this.store.sql.exec('SELECT COUNT(*) AS n FROM public_cache_mutations').one().n)};
    });
  }
  snapshot(keys:string[],now=Date.now()):PublicCacheSnapshot {
    if(!Array.isArray(keys)||keys.length>MAX_KEYS||keys.some(key=>typeof key!=='string'||!validPublicCacheKey(key))) throw new Error('Invalid public cache keys');
    return this.store.transactionSync(()=>{
      this.expire(now);
      const sql=this.store.sql,legacy=Number(sql.exec('SELECT revision FROM public_cache_revision WHERE id=1').one().revision);
      const revision=Number(sql.exec('SELECT revision FROM public_cache_clock WHERE id=1').one().revision);
      const legacyPending=sql.exec('SELECT id FROM public_cache_mutations LIMIT 1').toArray().length>0;
      const anyPending=legacyPending||sql.exec('SELECT id FROM public_cache_scoped_mutations LIMIT 1').toArray().length>0;
      const groups=keys.map(selectorsFor),selectors=[...new Set(groups.flat())],versions=new Map<string,number>(),pending=new Set<string>();
      // Indexed equality lookups avoid scanning every saved scope or ticket.
      for(let offset=0;offset<selectors.length;offset+=80) {
        const chunk=selectors.slice(offset,offset+80),marks=chunk.map(()=>'?').join(',');
        for(const row of sql.exec<{selector:string;revision:number}>(`SELECT selector,revision FROM public_cache_scope_versions WHERE selector IN (${marks})`,...chunk).toArray()) versions.set(row.selector,Number(row.revision));
        for(const row of sql.exec<{selector:string}>(`SELECT DISTINCT selector FROM public_cache_mutation_scopes WHERE selector IN (${marks})`,...chunk).toArray()) pending.add(row.selector);
      }
      return {revision,versions:groups.map(group=>Math.max(legacy,...group.map(selector=>versions.get(selector)||0))),
        pending:groups.map(group=>legacyPending||group.some(selector=>pending.has(selector))),anyPending};
    });
  }
  private conflicts(id:string,selectors:Set<string>,now:number):boolean {
    const sql=this.store.sql;
    if(sql.exec('SELECT id FROM public_cache_mutations WHERE expires>? LIMIT 1',now).toArray().length)return true;
    const words=[...selectors].filter(selector=>/^word:[1-9]\d*$/.test(selector));
    if(selectors.has('word:*')) {
      return sql.exec(`SELECT 1 FROM public_cache_mutation_scopes s JOIN public_cache_scoped_mutations m ON m.id=s.mutationId
        WHERE s.selector GLOB 'word:*' AND s.mutationId<>? AND m.expires>? LIMIT 1`,id,now).toArray().length>0;
    }
    if(words.length) {
      const candidates=['word:*',...words];
      for(let offset=0;offset<candidates.length;offset+=80) {
        const chunk=candidates.slice(offset,offset+80),marks=chunk.map(()=>'?').join(',');
        if(sql.exec(`SELECT 1 FROM public_cache_mutation_scopes s JOIN public_cache_scoped_mutations m ON m.id=s.mutationId
          WHERE s.selector IN (${marks}) AND s.mutationId<>? AND m.expires>? LIMIT 1`,...chunk,id,now).toArray().length)return true;
      }
    }
    return false;
  }
  private scoped(id:string,selectors:string[],now:number,claim:boolean,existingOnly=false):boolean {
    if(!validIdentifier(id)) throw new Error('Invalid public mutation identifier');
    if(!Array.isArray(selectors)||!selectors.length||selectors.length>MAX_SELECTORS||selectors.some(selector=>!validPublicCacheSelector(selector))) throw new Error('Invalid public mutation selectors');
    return this.store.transactionSync(()=>{
      const sql=this.store.sql,merged=new Set(sql.exec<{selector:string}>(`SELECT s.selector FROM public_cache_mutation_scopes s
        JOIN public_cache_scoped_mutations m ON m.id=s.mutationId WHERE s.mutationId=? AND m.expires>?`,id,now).toArray().map(row=>row.selector));
      if(existingOnly&&!merged.size)return false;
      for(const selector of selectors) merged.add(selector);
      if(merged.size>MAX_SELECTORS) throw new Error('Too many public mutation selectors');
      if(claim) {
        // Check active tickets before expiry maintenance: a denied claim must
        // leave the clock and every durable row untouched. Shared discovery
        // selectors do not serialize edits to otherwise unrelated words.
        if(this.conflicts(id,merged,now))return false;
      }
      this.expire(now);
      sql.exec('INSERT INTO public_cache_scoped_mutations(id,expires) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires',id,now+PUBLIC_MUTATION_LEASE_MS);
      for(const selector of merged) sql.exec('INSERT OR IGNORE INTO public_cache_mutation_scopes(mutationId,selector) VALUES(?,?)',id,selector);
      // A renewed multi-statement ticket keeps all earlier dependencies dirty.
      this.bump([...merged]);
      return true;
    });
  }
  beginScoped(id:string,selectors:string[],now=Date.now()):void {this.scoped(id,selectors,now,false);}
  claimScoped(id:string,selectors:string[],now=Date.now(),existingOnly=false):boolean {return this.scoped(id,selectors,now,true,existingOnly);}
  renewScoped(id:string,now=Date.now()):boolean {
    if(!validIdentifier(id))throw new Error('Invalid public mutation identifier');
    return this.store.transactionSync(()=>{
      // Never resurrect an expired ticket: its source data may already have
      // been changed by a newer writer after expiration.
      const ticket=this.store.sql.exec<{expires:number}>('SELECT expires FROM public_cache_scoped_mutations WHERE id=?',id).toArray()[0];
      if(!ticket||Number(ticket.expires)<=now)return false;
      const selectors=new Set(this.store.sql.exec<{selector:string}>('SELECT selector FROM public_cache_mutation_scopes WHERE mutationId=?',id).toArray().map(row=>row.selector));
      if(this.conflicts(id,selectors,now))return false;
      this.store.sql.exec('UPDATE public_cache_scoped_mutations SET expires=? WHERE id=?',now+PUBLIC_MUTATION_LEASE_MS,id);
      return true;
    });
  }
  finishScoped(id:string):void {
    if(!validIdentifier(id)) throw new Error('Invalid public mutation identifier');
    this.store.transactionSync(()=>{
      const sql=this.store.sql,selectors=sql.exec<{selector:string}>('SELECT selector FROM public_cache_mutation_scopes WHERE mutationId=?',id).toArray().map(row=>row.selector);
      if(!selectors.length) return;
      this.bump(selectors);
      sql.exec('DELETE FROM public_cache_mutation_scopes WHERE mutationId=?',id);
      sql.exec('DELETE FROM public_cache_scoped_mutations WHERE id=?',id);
    });
  }
  begin(id:string,now=Date.now()) {
    if(!validIdentifier(id)) throw new Error('Invalid public mutation identifier');
    return this.store.transactionSync(()=>{
      this.expire(now);
      this.store.sql.exec('INSERT INTO public_cache_mutations(id,expires) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires',id,now+PUBLIC_MUTATION_LEASE_MS);
      this.legacyBump();
    });
  }
  finish(id:string) {
    return this.store.transactionSync(()=>{
      if(this.store.sql.exec('SELECT id FROM public_cache_mutations WHERE id=?',id).toArray().length) {
        this.store.sql.exec('DELETE FROM public_cache_mutations WHERE id=?',id);
        this.legacyBump();
      }
    });
  }
  invalidate() {this.store.transactionSync(()=>this.legacyBump());}
}
