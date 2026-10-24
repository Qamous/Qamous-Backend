// Synchronous admission always persists before SQL can run. Compact state and
// unindexed WITHOUT ROWID leases avoid charging several index/materialization
// writes for each individual D1 query. Never cache uncommitted totals in memory.
export type ReadTier='public'|'essential'|'import';
export const READ_BUDGET_POLICY=Object.freeze({
  publicRows:4_500_000,totalRows:4_900_000,importStopRows:3_500_000,
  minuteRows:250_000,essentialMinuteRows:50_000,maxConcurrent:6,publicConcurrent:4,importConcurrent:1,
  leaseMs:60_000,resetQuietMs:60_000,defaultQueryRows:50_000,maxReservationRows:250_000,
  ledgerPublicOperations:6000,ledgerTotalOperations:8000,ledgerImportOperations:4000,
  ledgerRowsPerOperation:8,ledgerWarningOperations:4000,
  ledgerPublicRows:48_000,ledgerTotalRows:64_000,ledgerImportRows:32_000,
  cachePublicRows:16_000,cacheTotalRows:20_000,
});
type SqlValue=string|number|null;
interface SqlStore {exec<T extends Record<string,SqlValue>=Record<string,SqlValue>>(query:string,...values:SqlValue[]):{toArray():T[];one():T};}
interface Store {sql:SqlStore;transactionSync<T>(callback:()=>T):T;}
interface Lease extends Record<string,SqlValue> {id:string;day:string;tier:ReadTier;route:string;reserved:number;started:number;minute:number;status:string;actual:number|null;}
interface Route {route:string;tier:ReadTier;charged:number;measured:number;queries:number;writes:number;denied:number;unknown:number;}
interface TierRows {public:number;import:number;essential:number;unknown:number;}
interface State {day:string;charged:number;measured:number;baseline:number;denied:number;tripped:string|null;alerted:number;operations:number;ledgerRows:number;tierLedgerRows?:TierRows;unresolved:number;minutes:Record<string,{charged:number;essential:number}>;routes:Record<string,Route>;active:Record<string,{tier:ReadTier;started:number}>;cleanupCursor:string;}
export interface Reservation {id:string;route:string;tier:ReadTier;rows:number;}
export type Admission={allowed:true;id:string;day:string;reserved:number}|{allowed:false;reason:string;retryAfter:number};
const dayAt=(now:number)=>new Date(now).toISOString().slice(0,10);
const validInteger=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const safeRoute=(route:string)=>route.replace(/[^a-zA-Z0-9_:/.-]/g,'_').slice(0,96);
const empty=(day:string,rows:number):State=>({day,charged:rows,measured:0,baseline:rows,denied:0,tripped:null,alerted:0,operations:0,ledgerRows:0,tierLedgerRows:{public:0,import:0,essential:0,unknown:0},unresolved:0,minutes:{},routes:{},active:{},cleanupCursor:''});

export class ReadBudgetLedger {
  private store:Store;private emit:(event:Record<string,unknown>)=>void;
  private hasLegacyLeases=false;
  private deniedDay='';private deniedCount=0;private denialEvents=new Map<string,number>();
  constructor(store:Store,bootstrap:{day?:string;rows?:number;cacheDay?:string;cacheRows?:number},emit:(event:Record<string,unknown>)=>void=event=>console.log(JSON.stringify(event))) {
    this.store=store;this.emit=emit;
    const sql=store.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_compact_days(day TEXT PRIMARY KEY,state TEXT NOT NULL) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_compact_leases(id TEXT PRIMARY KEY,day TEXT NOT NULL,tier TEXT NOT NULL,route TEXT NOT NULL,reserved INTEGER NOT NULL,started INTEGER NOT NULL,minute INTEGER NOT NULL,status TEXT NOT NULL,actual INTEGER) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS public_cache_write_days(day TEXT PRIMARY KEY,charged INTEGER NOT NULL) WITHOUT ROWID');
    // Legacy tables remain read-only evidence. Copy each existing day exactly
    // once and carry all previously spent lifecycle allocations at the OLD
    // 32-row rate. Deploying this change cannot reset today's storage budget.
    const legacy=sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='read_budget_days'").toArray().length;
    this.hasLegacyLeases=!!legacy;
    if(legacy)store.transactionSync(()=>{
      const columns=sql.exec('PRAGMA table_info(read_budget_days)').toArray();
      for(const prior of sql.exec('SELECT * FROM read_budget_days').toArray()) {
        const day=String(prior.day);if(this.get(day))continue;
        const state={...empty(day,Number(prior.charged)),...prior} as State;
        state.operations=columns.some(c=>c.name==='operations')?Number(prior.operations):Number(sql.exec('SELECT COALESCE(SUM(queries),0) AS n FROM read_budget_routes WHERE day=?',day).one().n);
        state.ledgerRows=state.operations*32;
        state.routes={};
        for(const route of sql.exec('SELECT route,tier,charged,measured,queries,writes,denied,unknown FROM read_budget_routes WHERE day=?',day).toArray()) {
          const target=this.route(state,String(route.route),route.tier as ReadTier);
          for(const key of ['charged','measured','queries','writes','denied','unknown'] as const)target[key]+=Number(route[key]);
        }
        for(const minute of sql.exec('SELECT minute,charged,essential FROM read_budget_minutes WHERE minute>=? AND minute<?',Date.parse(day+'T00:00:00Z')/60000,Date.parse(day+'T00:00:00Z')/60000+1440).toArray())state.minutes[String(minute.minute)]={charged:Number(minute.charged),essential:Number(minute.essential)};
        const pending=sql.exec<Lease>("SELECT * FROM read_budget_leases WHERE day=? AND status IN ('pending','unknown')",day).toArray();
        state.unresolved=pending.reduce((sum,lease)=>sum+lease.reserved,0);
        // At most six leases can remain concurrent; use the newest six to
        // preserve that restriction even across a deployment/eviction.
        for(const lease of pending.filter(l=>l.status==='pending').sort((a,b)=>b.started-a.started).slice(0,READ_BUDGET_POLICY.maxConcurrent))state.active[lease.id]={tier:lease.tier,started:lease.started};
        delete state.tierLedgerRows;state.tierLedgerRows=this.classifyTierRows(state);this.save(state);
      }
    });
    // Upgrade already compact days exactly once. Classify saved reservations;
    // never reset or reduce the durable global allocation during deployment.
    store.transactionSync(()=>{
      for(const row of sql.exec('SELECT state FROM read_budget_compact_days').toArray()) {
        const state=JSON.parse(String(row.state)) as State;
        if(!state.tierLedgerRows){state.tierLedgerRows=this.classifyTierRows(state);this.save(state);}
      }
    });
    if(bootstrap.day&&/^\d{4}-\d{2}-\d{2}$/.test(bootstrap.day)&&validInteger(bootstrap.rows)&&!this.get(bootstrap.day))this.save(empty(bootstrap.day,bootstrap.rows));
    if(bootstrap.cacheDay&&/^\d{4}-\d{2}-\d{2}$/.test(bootstrap.cacheDay)&&validInteger(bootstrap.cacheRows))sql.exec('INSERT OR IGNORE INTO public_cache_write_days(day,charged) VALUES(?,?)',bootstrap.cacheDay,bootstrap.cacheRows+1);
  }
  reservePublicCacheWrites(cost:number,tier:'public'|'essential',now=Date.now()):boolean {
    if(!validInteger(cost)||cost<1||cost>512||!['public','essential'].includes(tier))return false;
    return this.store.transactionSync(()=>{
      const sql=this.store.sql,day=dayAt(now),current=sql.exec('SELECT charged FROM public_cache_write_days WHERE day=?',day).toArray()[0];
      // This new pool needs an explicit initial-day baseline. It cannot assume
      // earlier cache writers used zero rows simply because code was deployed.
      if(!current&&!sql.exec('SELECT day FROM public_cache_write_days WHERE day<? ORDER BY day DESC LIMIT 1',day).toArray().length)return false;
      const charged=Number(current?.charged||0),ceiling=tier==='essential'?READ_BUDGET_POLICY.cacheTotalRows:READ_BUDGET_POLICY.cachePublicRows,allocation=cost+1;
      if(charged+allocation>ceiling)return false;
      sql.exec('INSERT INTO public_cache_write_days(day,charged) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET charged=excluded.charged',day,charged+allocation);
      return true;
    });
  }
  private classifyTierRows(state:State):TierRows {
    const counts={public:0,import:0,essential:0},legacy={public:0,import:0,essential:0};
    for(const route of Object.values(state.routes))counts[route.tier]+=route.queries;
    if(this.hasLegacyLeases)for(const row of this.store.sql.exec('SELECT tier,SUM(queries) AS n FROM read_budget_routes WHERE day=? GROUP BY tier',state.day).toArray()) {
      if(row.tier==='public'||row.tier==='import'||row.tier==='essential')legacy[row.tier]=Number(row.n);
    }
    const result:TierRows={public:0,import:0,essential:0,unknown:0};
    for(const tier of ['public','import','essential'] as const) {
      const prior=Math.min(counts[tier],legacy[tier]);
      result[tier]=prior*32+(counts[tier]-prior)*READ_BUDGET_POLICY.ledgerRowsPerOperation;
    }
    const classified=result.public+result.import+result.essential;
    // Late lifecycle units are not represented in route query counts. Charge
    // unclassified legacy work against both nonessential and import headroom.
    // Inconsistent historical stats fail closed without reducing total spend.
    if(classified>state.ledgerRows)return {public:0,import:0,essential:0,unknown:state.ledgerRows};
    result.unknown=state.ledgerRows-classified;return result;
  }
  private get(day:string):State|null {const row=this.store.sql.exec('SELECT state FROM read_budget_compact_days WHERE day=?',day).toArray()[0];return row?JSON.parse(String(row.state)):null;}
  private save(state:State) {
    const encoded=JSON.stringify(state);
    // State is bounded to 1440 minute entries, 128 routes/tier and six active
    // leases. Refuse atomically rather than exceeding SQLite's row-size limit.
    if(encoded.length>512_000)throw Error('Read-budget compact state exceeds its safe size');
    this.store.sql.exec('INSERT INTO read_budget_compact_days(day,state) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET state=excluded.state',state.day,encoded);
  }
  private current(now:number,persist=true):State|null {
    const day=dayAt(now),current=this.get(day);if(current)return current;
    const prior=this.store.sql.exec('SELECT state FROM read_budget_compact_days WHERE day<? ORDER BY day DESC LIMIT 1',day).toArray()[0];
    if(!prior)return null;
    const state=empty(day,Number((JSON.parse(String(prior.state)) as State).unresolved));
    if(persist)this.save(state);return state;
  }
  private route(state:State,route:string,tier:ReadTier):Route {
    let key=tier+':'+route;
    if(!state.routes[key]&&Object.keys(state.routes).length>=125){route='/other';key=tier+':'+route;}
    return state.routes[key]??=( {route,tier,charged:0,measured:0,queries:0,writes:0,denied:0,unknown:0});
  }
  private lease(id:string):Lease|undefined {
    const sql=this.store.sql,row=sql.exec<Lease>('SELECT * FROM read_budget_compact_leases WHERE id=?',id).toArray()[0];
    if(row)return row;
    if(this.hasLegacyLeases)return sql.exec<Lease>('SELECT * FROM read_budget_leases WHERE id=?',id).toArray()[0];
  }
  private saveLease(lease:Lease) {this.store.sql.exec('INSERT INTO read_budget_compact_leases(id,day,tier,route,reserved,started,minute,status,actual) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,actual=excluded.actual',lease.id,lease.day,lease.tier,lease.route,lease.reserved,lease.started,lease.minute,lease.status,lease.actual);}
  private cleanup(state:State,now:number) {
    // One ordered primary-key probe and at most one row deletion per admission.
    // Never scan/delete a whole historical day during a refusal or rollover.
    const row=this.store.sql.exec('SELECT id,day FROM read_budget_compact_leases WHERE id>? ORDER BY id LIMIT 1',state.cleanupCursor).toArray()[0];
    state.cleanupCursor=row?String(row.id):'';
    // A migrated lease's compact row is also its settlement tombstone. Its
    // immutable legacy row must never become visible again after cleanup.
    if(row&&String(row.day)<dayAt(now-3*86400_000)&&(!this.hasLegacyLeases||!this.store.sql.exec('SELECT id FROM read_budget_leases WHERE id=?',row.id).toArray().length))this.store.sql.exec('DELETE FROM read_budget_compact_leases WHERE id=?',row.id);
  }
  private deny(day:string,route:string,tier:ReadTier,reason:string,retryAfter:number,row:State|null):Admission {
    if(this.deniedDay!==day){this.deniedDay=day;this.deniedCount=0;this.denialEvents.clear();}this.deniedCount++;
    const key=reason+':'+tier,count=(this.denialEvents.get(key)||0)+1;this.denialEvents.set(key,count);
    if((count&(count-1))===0)this.emit({event:reason==='do_storage_budget'?'do_storage_budget_denied':'d1_read_denied',day,route,tier,reason,retryAfter,operations:row?.operations||0,estimatedLedgerRows:row?.ledgerRows||0,denialsThisProcess:count});
    return {allowed:false,reason,retryAfter};
  }
  private alerts(state:State) {
    for(const [index,threshold] of [3_500_000,4_000_000,4_500_000,4_900_000].entries()) {
      const bit=1<<index;if(state.charged>=threshold&&!(state.alerted&bit)){state.alerted|=bit;this.emit({event:'d1_read_budget_threshold',day:state.day,threshold,charged:state.charged,publicCeiling:READ_BUDGET_POLICY.publicRows,totalCeiling:READ_BUDGET_POLICY.totalRows});}
    }
    if(state.ledgerRows>=READ_BUDGET_POLICY.ledgerWarningOperations*READ_BUDGET_POLICY.ledgerRowsPerOperation&&!(state.alerted&16)){state.alerted|=16;this.emit({event:'do_storage_budget_threshold',day:state.day,operations:state.operations,estimatedLedgerRows:state.ledgerRows});}
  }
  reserve(input:Reservation,now=Date.now()):Admission {
    if(!input||!['public','essential','import'].includes(input.tier)||typeof input.route!=='string'||typeof input.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)||!validInteger(input.rows)||input.rows<1||input.rows>READ_BUDGET_POLICY.maxReservationRows)return {allowed:false,reason:'invalid_reservation',retryAfter:60};
    return this.store.transactionSync(()=>{
      const day=dayAt(now),minute=Math.floor(now/60_000),route=safeRoute(input.route),state=this.current(now);
      if(this.lease(input.id))return {allowed:false,reason:'replayed_reservation',retryAfter:60};
      const deny=(reason:string,retryAfter=60)=>this.deny(day,route,input.tier,reason,retryAfter,state);
      if(!state)return deny('baseline_required');
      const midnight=Date.parse(day+'T00:00:00Z')+86400_000,retry=Math.max(60,Math.ceil((midnight-now)/1000));
      if(now>=midnight-READ_BUDGET_POLICY.resetQuietMs)return deny('utc_rollover',Math.max(1,Math.ceil((midnight-now)/1000)));
      if(state.tripped)return deny('cost_circuit_open',retry);
      const allocation=READ_BUDGET_POLICY.ledgerRowsPerOperation,tiers=state.tierLedgerRows!;
      if(state.ledgerRows+allocation>READ_BUDGET_POLICY.ledgerTotalRows
        ||input.tier!=='essential'&&tiers.public+tiers.import+tiers.unknown+allocation>READ_BUDGET_POLICY.ledgerPublicRows
        ||input.tier==='import'&&tiers.import+tiers.unknown+allocation>READ_BUDGET_POLICY.ledgerImportRows)return deny('do_storage_budget',retry);
      const ceiling=input.tier==='essential'?READ_BUDGET_POLICY.totalRows:input.tier==='import'?READ_BUDGET_POLICY.importStopRows:READ_BUDGET_POLICY.publicRows;
      if(state.charged+input.rows>ceiling)return deny(input.tier==='import'?'import_paused':'daily_budget',retry);
      for(const [id,active] of Object.entries(state.active))if(active.started<now-READ_BUDGET_POLICY.leaseMs)delete state.active[id];
      const active=Object.values(state.active);
      if(active.length>=READ_BUDGET_POLICY.maxConcurrent||input.tier!=='essential'&&active.filter(a=>a.tier!=='essential').length>=READ_BUDGET_POLICY.publicConcurrent)return deny('concurrency');
      if(input.tier==='import'&&active.filter(a=>a.tier==='import').length>=READ_BUDGET_POLICY.importConcurrent)return deny('import_concurrency');
      const window=state.minutes[minute]||{charged:0,essential:0},burn=READ_BUDGET_POLICY.minuteRows+(input.tier==='essential'?READ_BUDGET_POLICY.essentialMinuteRows:0);
      if(window.charged+input.rows>burn)return deny('burn_rate',60-now/1000%60|0||1);
      state.charged+=input.rows;state.unresolved+=input.rows;state.operations++;state.ledgerRows+=allocation;tiers[input.tier]+=allocation;
      state.minutes[minute]={charged:window.charged+input.rows,essential:window.essential+(input.tier==='essential'?input.rows:0)};
      state.active[input.id]={tier:input.tier,started:now};
      const entry=this.route(state,route,input.tier);entry.charged+=input.rows;entry.queries++;
      this.saveLease({id:input.id,day,tier:input.tier,route:entry.route,reserved:input.rows,started:now,minute,status:'pending',actual:null});
      this.cleanup(state,now);this.alerts(state);this.save(state);
      return {allowed:true,id:input.id,day,reserved:input.rows};
    });
  }
  settle(id:string,actual:number|null,writes=0,now=Date.now()) {
    return this.store.transactionSync(()=>{
      const lease=this.lease(id);if(!lease||lease.status==='settled')return {settled:false};
      const unknown=actual===null||!validInteger(actual)||!validInteger(writes);
      if(unknown&&lease.status==='unknown')return {settled:false,charged:lease.reserved};
      const state=this.get(lease.day);if(!state)throw Error('Missing durable reservation day');
      let current:State|null=null;
      if(lease.day!==dayAt(now)) {
        current=this.current(now,false);
        if(!current||current.ledgerRows+READ_BUDGET_POLICY.ledgerRowsPerOperation>READ_BUDGET_POLICY.ledgerTotalRows){this.deny(dayAt(now),lease.route,lease.tier,'do_storage_budget',60,current);return {settled:false,charged:lease.reserved,reason:'do_storage_budget'};}
        current.ledgerRows+=READ_BUDGET_POLICY.ledgerRowsPerOperation;current.tierLedgerRows!.essential+=READ_BUDGET_POLICY.ledgerRowsPerOperation;current.operations++;
      }
      const entry=this.route(state,lease.route,lease.tier);delete state.active[id];
      if(unknown){lease.status='unknown';entry.unknown++;}
      else {
        const delta=(actual as number)-lease.reserved;lease.status='settled';lease.actual=actual;
        state.charged+=delta;state.measured+=actual as number;state.unresolved-=lease.reserved;
        const minute=state.minutes[lease.minute];if(minute){minute.charged=Math.max(0,minute.charged+delta);if(lease.tier==='essential')minute.essential=Math.max(0,minute.essential+delta);}
        entry.charged+=delta;entry.measured+=actual as number;entry.writes+=writes;
        if((actual as number)>lease.reserved){state.tripped='reservation_exceeded';if(current)current.tripped=state.tripped;this.emit({event:'d1_read_cost_overrun',day:lease.day,route:lease.route,reserved:lease.reserved,actual});}
      }
      this.saveLease(lease);this.alerts(state);this.save(state);
      if(current){this.alerts(current);this.save(current);}
      return {settled:!unknown,charged:unknown?lease.reserved:actual,overrun:!unknown&&(actual as number)>lease.reserved};
    });
  }
  reconcile(input:{day:string;rowsRead:number;observedAt:string},now=Date.now()) {
    if(!input||input.day!==dayAt(now)||!validInteger(input.rowsRead)||!Number.isFinite(Date.parse(input.observedAt))||Date.parse(input.observedAt)>now+5_000||now-Date.parse(input.observedAt)>300_000)throw Error('A current-day, recently observed account read baseline is required');
    return this.store.transactionSync(()=>{const state=this.current(now,false)||empty(input.day,input.rowsRead);if(input.rowsRead>state.charged){state.baseline+=input.rowsRead-state.charged;state.charged=input.rowsRead;}this.alerts(state);this.save(state);this.emit({event:'d1_read_baseline_reconciled',day:input.day,observedRows:input.rowsRead});return this.status(now);});
  }
  status(now=Date.now()) {
    const state=this.current(now,false),{minutes:_minutes,routes:_routes,active:_active,cleanupCursor:_cursor,...usage}=state||{};
    const cache=this.store.sql.exec('SELECT charged FROM public_cache_write_days WHERE day=?',dayAt(now)).toArray()[0];
    return {day:dayAt(now),initialized:!!state,policy:READ_BUDGET_POLICY,usage:state?{...usage,denied:state.denied+(this.deniedDay===state.day?this.deniedCount:0)}:null,publicCacheWrites:{initialized:!!cache,charged:cache?Number(cache.charged):null},denialAccounting:'Current-process counts plus legacy persisted counts; bounded events are emitted without storage writes.',active:state?Object.values(state.active).filter(a=>a.started>=now-READ_BUDGET_POLICY.leaseMs).length:0,routes:state?Object.values(state.routes).sort((a,b)=>b.charged-a.charged).slice(0,100):[]};
  }
}
