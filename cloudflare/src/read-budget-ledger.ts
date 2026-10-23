// D1 rows-read accounting is separate from this object's SQLite accounting.
// Reservations are persisted synchronously before any caller may submit D1 SQL.
export type ReadTier='public'|'essential'|'import';
export const READ_BUDGET_POLICY=Object.freeze({
  publicRows:4_500_000,totalRows:4_900_000,importStopRows:3_500_000,
  minuteRows:250_000,essentialMinuteRows:50_000,maxConcurrent:6,publicConcurrent:4,importConcurrent:1,
  leaseMs:60_000,resetQuietMs:60_000,defaultQueryRows:50_000,maxReservationRows:250_000,
  ledgerPublicOperations:1500,ledgerTotalOperations:2000,ledgerImportOperations:1000,
  ledgerRowsPerOperation:32,ledgerWarningOperations:1000,
});
type SqlValue=string|number|null;
interface SqlStore {exec<T extends Record<string,SqlValue>=Record<string,SqlValue>>(query:string,...values:SqlValue[]):{toArray():T[];one():T};}
interface Store {sql:SqlStore;transactionSync<T>(callback:()=>T):T;}
interface Day extends Record<string,SqlValue> {day:string;charged:number;measured:number;baseline:number;denied:number;tripped:string|null;alerted:number;operations:number;}
interface Lease extends Record<string,SqlValue> {id:string;day:string;tier:ReadTier;route:string;reserved:number;started:number;minute:number;status:string;actual:number|null;}
export interface Reservation {id:string;route:string;tier:ReadTier;rows:number;}
export type Admission={allowed:true;id:string;day:string;reserved:number}|{allowed:false;reason:string;retryAfter:number};
const dayAt=(now:number)=>new Date(now).toISOString().slice(0,10);
const validInteger=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const safeRoute=(route:string)=>route.replace(/[^a-zA-Z0-9_:/.-]/g,'_').slice(0,96);

export class ReadBudgetLedger {
  private store:Store;
  private emit:(event:Record<string,unknown>)=>void;
  private deniedDay='';
  private deniedCount=0;
  private denialEvents=new Map<string,number>();
  constructor(store:Store,bootstrap:{day?:string;rows?:number},emit:(event:Record<string,unknown>)=>void=event=>console.log(JSON.stringify(event))) {
    this.store=store;this.emit=emit;
    const sql=store.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_days(day TEXT PRIMARY KEY,charged INTEGER NOT NULL,measured INTEGER NOT NULL DEFAULT 0,baseline INTEGER NOT NULL DEFAULT 0,denied INTEGER NOT NULL DEFAULT 0,tripped TEXT,alerted INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_leases(id TEXT PRIMARY KEY,day TEXT NOT NULL,tier TEXT NOT NULL,route TEXT NOT NULL,reserved INTEGER NOT NULL,started INTEGER NOT NULL,minute INTEGER NOT NULL,status TEXT NOT NULL,actual INTEGER)');
    sql.exec('CREATE INDEX IF NOT EXISTS read_budget_leases_active ON read_budget_leases(status,started)');
    sql.exec('CREATE INDEX IF NOT EXISTS read_budget_leases_day ON read_budget_leases(day)');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_minutes(minute INTEGER PRIMARY KEY,charged INTEGER NOT NULL DEFAULT 0,essential INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_routes(day TEXT NOT NULL,route TEXT NOT NULL,tier TEXT NOT NULL,charged INTEGER NOT NULL DEFAULT 0,measured INTEGER NOT NULL DEFAULT 0,queries INTEGER NOT NULL DEFAULT 0,writes INTEGER NOT NULL DEFAULT 0,denied INTEGER NOT NULL DEFAULT 0,unknown INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,route,tier))');
    if(!sql.exec('PRAGMA table_info(read_budget_days)').toArray().some(column=>column.name==='operations')) {
      // Existing deployments must not get a new allowance after migration.
      // Query counts were already persisted with each admitted reservation.
      store.transactionSync(()=>{
        sql.exec('ALTER TABLE read_budget_days ADD COLUMN operations INTEGER NOT NULL DEFAULT 0');
        sql.exec('UPDATE read_budget_days SET operations=(SELECT COALESCE(SUM(queries),0) FROM read_budget_routes WHERE read_budget_routes.day=read_budget_days.day)');
      });
    }
    if(bootstrap.day&&/^\d{4}-\d{2}-\d{2}$/.test(bootstrap.day)&&validInteger(bootstrap.rows)) {
      sql.exec('INSERT OR IGNORE INTO read_budget_days(day,charged,baseline) VALUES(?,?,?)',bootstrap.day,bootstrap.rows,bootstrap.rows);
    }
  }
  private current(now:number,persist=true):Day|null {
    const sql=this.store.sql,day=dayAt(now);
    let current=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day=?',day).toArray()[0];
    if(current)return current;
    // A new installation has no authority to assume zero usage mid-day. It
    // needs an explicit baseline. Later UTC days can start from zero plus any
    // unresolved previous-day work, which is deliberately double charged.
    const prior=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day<? ORDER BY day DESC LIMIT 1',day).toArray()[0];
    if(!prior)return null;
    const carry=Number(sql.exec('SELECT COALESCE(SUM(reserved),0) AS n FROM read_budget_leases WHERE day=? AND status IN (\'pending\',\'unknown\')',prior.day).one().n);
    if(!persist)return {day,charged:carry,baseline:carry,measured:0,denied:0,tripped:null,alerted:0,operations:0};
    sql.exec('INSERT INTO read_budget_days(day,charged,baseline) VALUES(?,?,?)',day,carry,carry);
    current=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day=?',day).one();
    return current;
  }
  private cleanup(now:number) {
    // Each admission pays for at most one old row per table, including indexes.
    // Rollover and repeated refusal/status calls never delete a historical day
    // worth of rows at once. Expired charges are never refunded by cleanup.
    const sql=this.store.sql,cutoff=new Date(now-3*86400_000).toISOString().slice(0,10);
    sql.exec('DELETE FROM read_budget_leases WHERE id IN (SELECT id FROM read_budget_leases WHERE day<? LIMIT 1)',cutoff);
    sql.exec('DELETE FROM read_budget_routes WHERE rowid IN (SELECT rowid FROM read_budget_routes WHERE day<? LIMIT 1)',cutoff);
    sql.exec('DELETE FROM read_budget_minutes WHERE minute IN (SELECT minute FROM read_budget_minutes WHERE minute<? LIMIT 1)',Math.floor(now/60_000)-2880);
    sql.exec('DELETE FROM read_budget_days WHERE day IN (SELECT day FROM read_budget_days WHERE day<? LIMIT 1) AND NOT EXISTS (SELECT 1 FROM read_budget_leases WHERE read_budget_leases.day=read_budget_days.day)',cutoff);
  }
  private deny(day:string,route:string,tier:ReadTier,reason:string,retryAfter:number,row:Day|null):Admission {
    if(this.deniedDay!==day){this.deniedDay=day;this.deniedCount=0;this.denialEvents.clear();}
    this.deniedCount++;
    const key=reason+':'+tier,count=(this.denialEvents.get(key)||0)+1;this.denialEvents.set(key,count);
    // Counts/log throttles are deliberately volatile. A refused request cannot
    // spend the very storage-write allowance it is protecting. Log powers of
    // two rather than writing a counter or logging every retry.
    if((count&(count-1))===0)this.emit({event:reason==='do_storage_budget'?'do_storage_budget_denied':'d1_read_denied',day,route,tier,reason,retryAfter,
      operations:row?.operations||0,estimatedLedgerRows:(row?.operations||0)*READ_BUDGET_POLICY.ledgerRowsPerOperation,
      publicOperations:READ_BUDGET_POLICY.ledgerPublicOperations,totalOperations:READ_BUDGET_POLICY.ledgerTotalOperations,denialsThisProcess:count});
    return {allowed:false,reason,retryAfter};
  }
  private alerts(day:string) {
    const sql=this.store.sql,row=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day=?',day).one();
    for(const [index,threshold] of [3_500_000,4_000_000,4_500_000,4_900_000].entries()) {
      const bit=1<<index;
      if(row.charged>=threshold&&!(row.alerted&bit)) {
        sql.exec('UPDATE read_budget_days SET alerted=alerted|? WHERE day=?',bit,day);
        this.emit({event:'d1_read_budget_threshold',day,threshold,charged:row.charged,publicCeiling:READ_BUDGET_POLICY.publicRows,totalCeiling:READ_BUDGET_POLICY.totalRows});
      }
    }
    if(row.operations>=READ_BUDGET_POLICY.ledgerWarningOperations&&!(row.alerted&16)) {
      sql.exec('UPDATE read_budget_days SET alerted=alerted|16 WHERE day=?',day);
      this.emit({event:'do_storage_budget_threshold',day,operations:row.operations,estimatedLedgerRows:row.operations*READ_BUDGET_POLICY.ledgerRowsPerOperation,
        publicOperations:READ_BUDGET_POLICY.ledgerPublicOperations,totalOperations:READ_BUDGET_POLICY.ledgerTotalOperations});
    }
  }
  reserve(input:Reservation,now=Date.now()):Admission {
    if(!input||!['public','essential','import'].includes(input.tier)||typeof input.route!=='string'||typeof input.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)||!validInteger(input.rows)||input.rows<1||input.rows>READ_BUDGET_POLICY.maxReservationRows) return {allowed:false,reason:'invalid_reservation',retryAfter:60};
    return this.store.transactionSync(()=>{
      const sql=this.store.sql,day=dayAt(now),minute=Math.floor(now/60_000),route=safeRoute(input.route),row=this.current(now,false);
      const prior=sql.exec<Lease>('SELECT * FROM read_budget_leases WHERE id=?',input.id).toArray()[0];
      if(prior)return {allowed:false,reason:'replayed_reservation',retryAfter:60};
      const deny=(reason:string,retryAfter=60)=>this.deny(day,route,input.tier,reason,retryAfter,row);
      if(!row)return deny('baseline_required');
      const midnight=Date.parse(day+'T00:00:00Z')+86400_000;
      if(now>=midnight-READ_BUDGET_POLICY.resetQuietMs)return deny('utc_rollover',Math.max(1,Math.ceil((midnight-now)/1000)));
      if(row.tripped)return deny('cost_circuit_open',Math.max(60,Math.ceil((midnight-now)/1000)));
      const operationCeiling=input.tier==='essential'?READ_BUDGET_POLICY.ledgerTotalOperations:input.tier==='import'?READ_BUDGET_POLICY.ledgerImportOperations:READ_BUDGET_POLICY.ledgerPublicOperations;
      if(row.operations>=operationCeiling)return deny('do_storage_budget',Math.max(60,Math.ceil((midnight-now)/1000)));
      const ceiling=input.tier==='essential'?READ_BUDGET_POLICY.totalRows:input.tier==='import'?READ_BUDGET_POLICY.importStopRows:READ_BUDGET_POLICY.publicRows;
      if(row.charged+input.rows>ceiling)return deny(input.tier==='import'?'import_paused':'daily_budget',Math.max(60,Math.ceil((midnight-now)/1000)));
      // A crashed / timed-out invocation keeps its full charge. Only its
      // concurrency slot expires; a late success still settles exactly once.
      const leaseCutoff=now-READ_BUDGET_POLICY.leaseMs;
      const active=Number(sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND started>=?',leaseCutoff).one().n);
      if(active>=READ_BUDGET_POLICY.maxConcurrent)return deny('concurrency');
      if(input.tier!=='essential'&&Number(sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND started>=? AND tier!=\'essential\'',leaseCutoff).one().n)>=READ_BUDGET_POLICY.publicConcurrent)return deny('concurrency');
      if(input.tier==='import'&&Number(sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND started>=? AND tier=\'import\'',leaseCutoff).one().n)>=READ_BUDGET_POLICY.importConcurrent)return deny('import_concurrency');
      const window=sql.exec('SELECT charged,essential FROM read_budget_minutes WHERE minute=?',minute).toArray()[0]||{charged:0,essential:0};
      const burnCeiling=READ_BUDGET_POLICY.minuteRows+(input.tier==='essential'?READ_BUDGET_POLICY.essentialMinuteRows:0);
      if(Number(window.charged)+input.rows>burnCeiling)return deny('burn_rate',60-now/1000%60|0||1);
      this.current(now);
      sql.exec('INSERT OR IGNORE INTO read_budget_minutes(minute) VALUES(?)',minute);
      sql.exec('INSERT INTO read_budget_leases(id,day,tier,route,reserved,started,minute,status) VALUES(?,?,?,?,?,?,?,\'pending\')',input.id,day,input.tier,route,input.rows,now,minute);
      sql.exec('UPDATE read_budget_days SET charged=charged+?,operations=operations+1 WHERE day=?',input.rows,day);
      sql.exec('UPDATE read_budget_minutes SET charged=charged+?,essential=essential+? WHERE minute=?',input.rows,input.tier==='essential'?input.rows:0,minute);
      sql.exec('INSERT INTO read_budget_routes(day,route,tier,charged,queries) VALUES(?,?,?,?,1) ON CONFLICT(day,route,tier) DO UPDATE SET charged=charged+excluded.charged,queries=queries+1',day,route,input.tier,input.rows);
      this.alerts(day);
      this.cleanup(now);
      return {allowed:true,id:input.id,day,reserved:input.rows};
    });
  }
  settle(id:string,actual:number|null,writes=0,now=Date.now()) {
    return this.store.transactionSync(()=>{
      const sql=this.store.sql,lease=sql.exec<Lease>('SELECT * FROM read_budget_leases WHERE id=?',id).toArray()[0];
      if(!lease||lease.status==='settled')return {settled:false};
      const unknown=actual===null||!validInteger(actual)||!validInteger(writes);
      if(unknown&&lease.status==='unknown')return {settled:false,charged:lease.reserved};
      if(lease.day!==dayAt(now)) {
        // Late accounting is billed today, not on the reservation's UTC day.
        // Charge a new lifecycle unit before writing; a refusal retains the
        // conservative original D1 reservation and can be retried another day.
        const current=this.current(now,false);
        if(!current||current.operations>=READ_BUDGET_POLICY.ledgerTotalOperations) {
          this.deny(dayAt(now),lease.route,lease.tier,'do_storage_budget',60,current);
          return {settled:false,charged:lease.reserved,reason:'do_storage_budget'};
        }
        this.current(now);
        sql.exec('UPDATE read_budget_days SET operations=operations+1 WHERE day=?',dayAt(now));
        this.alerts(dayAt(now));
      }
      if(unknown) {
        sql.exec('UPDATE read_budget_leases SET status=\'unknown\' WHERE id=?',id);
        sql.exec('UPDATE read_budget_routes SET unknown=unknown+1 WHERE day=? AND route=? AND tier=?',lease.day,lease.route,lease.tier);
        return {settled:false,charged:lease.reserved};
      }
      const measured=actual as number,delta=measured-lease.reserved;
      sql.exec('UPDATE read_budget_leases SET status=\'settled\',actual=? WHERE id=?',measured,id);
      sql.exec('UPDATE read_budget_days SET charged=charged+?,measured=measured+? WHERE day=?',delta,measured,lease.day);
      sql.exec('UPDATE read_budget_minutes SET charged=MAX(0,charged+?),essential=MAX(0,essential+?) WHERE minute=?',delta,lease.tier==='essential'?delta:0,lease.minute);
      sql.exec('UPDATE read_budget_routes SET charged=charged+?,measured=measured+?,writes=writes+? WHERE day=? AND route=? AND tier=?',delta,measured,writes,lease.day,lease.route,lease.tier);
      // A contract violation is never silently learned and retried. Stop fresh
      // D1 work until the next UTC day (or a reviewed code fix). Existing cache
      // responses remain available. SQL LIMIT is not a scanned-row bound.
      if(measured>lease.reserved) {
        const reason='reservation_exceeded';
        sql.exec('UPDATE read_budget_days SET tripped=? WHERE day=?',reason,lease.day);
        const current=this.current(now);
        if(current&&current.day!==lease.day)sql.exec('UPDATE read_budget_days SET tripped=? WHERE day=?',reason,current.day);
        this.emit({event:'d1_read_cost_overrun',day:lease.day,route:lease.route,reserved:lease.reserved,actual});
      }
      this.alerts(lease.day);
      return {settled:true,charged:measured,overrun:measured>lease.reserved};
    });
  }
  reconcile(input:{day:string;rowsRead:number;observedAt:string},now=Date.now()) {
    if(!input||input.day!==dayAt(now)||!validInteger(input.rowsRead)||!Number.isFinite(Date.parse(input.observedAt))||Date.parse(input.observedAt)>now||now-Date.parse(input.observedAt)>300_000)throw Error('A current-day, recently observed account read baseline is required');
    return this.store.transactionSync(()=>{
      const sql=this.store.sql;
      const row=this.current(now);
      if(!row)sql.exec('INSERT INTO read_budget_days(day,charged,baseline) VALUES(?,?,?)',input.day,input.rowsRead,input.rowsRead);
      else if(input.rowsRead>row.charged)sql.exec('UPDATE read_budget_days SET baseline=baseline+?,charged=? WHERE day=?',input.rowsRead-row.charged,input.rowsRead,input.day);
      this.alerts(input.day);
      this.emit({event:'d1_read_baseline_reconciled',day:input.day,observedRows:input.rowsRead});
      return this.status(now);
    });
  }
  status(now=Date.now()) {
    const current=this.current(now,false);
    return {day:dayAt(now),initialized:!!current,policy:READ_BUDGET_POLICY,usage:current?{...current,denied:current.denied+(this.deniedDay===current.day?this.deniedCount:0)}:null,
      denialAccounting:'Current-process counts plus legacy persisted counts; bounded events are emitted without storage writes.',
      active:Number(this.store.sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND started>=?',now-READ_BUDGET_POLICY.leaseMs).one().n),
      routes:this.store.sql.exec('SELECT route,tier,charged,measured,queries,writes,denied,unknown FROM read_budget_routes WHERE day=? ORDER BY charged DESC LIMIT 100',dayAt(now)).toArray()};
  }
}
