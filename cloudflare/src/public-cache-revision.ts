interface SqlStore {exec<T extends Record<string,string|number|null>=Record<string,string|number|null>>(query:string,...values:(string|number|null)[]):{toArray():T[];one():T};}
interface Store {sql:SqlStore;transactionSync<T>(callback:()=>T):T;}
// D1 has a 30-second statement/batch timeout. Every admitted mutation renews
// this two-minute barrier immediately before executing; a lost request cannot
// leave old public data eligible when the barrier eventually recovers.
export const PUBLIC_MUTATION_LEASE_MS=120_000;
export class PublicCacheRevision {
  private store:Store;
  constructor(store:Store) {
    this.store=store;
    store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL)');
    store.sql.exec('INSERT OR IGNORE INTO public_cache_revision VALUES(1,1)');
    store.sql.exec('CREATE TABLE IF NOT EXISTS public_cache_mutations(id TEXT PRIMARY KEY,expires INTEGER NOT NULL)');
  }
  private expire(now:number) {
    if(this.store.sql.exec('DELETE FROM public_cache_mutations WHERE expires<=? RETURNING id',now).toArray().length) {
      this.store.sql.exec('UPDATE public_cache_revision SET revision=revision+1 WHERE id=1');
    }
  }
  current(now=Date.now()) {
    return this.store.transactionSync(()=>{
      this.expire(now);
      return {revision:Number(this.store.sql.exec('SELECT revision FROM public_cache_revision WHERE id=1').one().revision),
        pending:Number(this.store.sql.exec('SELECT COUNT(*) AS n FROM public_cache_mutations').one().n)};
    });
  }
  begin(id:string,now=Date.now()) {
    if(!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid public mutation identifier');
    return this.store.transactionSync(()=>{
      this.expire(now);
      this.store.sql.exec('INSERT INTO public_cache_mutations(id,expires) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires',id,now+PUBLIC_MUTATION_LEASE_MS);
      this.store.sql.exec('UPDATE public_cache_revision SET revision=revision+1 WHERE id=1');
    });
  }
  finish(id:string) {
    return this.store.transactionSync(()=>{
      if(this.store.sql.exec('DELETE FROM public_cache_mutations WHERE id=? RETURNING id',id).toArray().length) {
        this.store.sql.exec('UPDATE public_cache_revision SET revision=revision+1 WHERE id=1');
      }
    });
  }
  invalidate() {this.store.sql.exec('UPDATE public_cache_revision SET revision=revision+1 WHERE id=1');}
}
