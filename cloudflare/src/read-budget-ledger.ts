// D1 rows-read accounting is separate from this object's SQLite accounting.
// Reservations are persisted synchronously before any caller may submit D1 SQL.
export type ReadTier='public'|'essential'|'import';
export const READ_BUDGET_POLICY=Object.freeze({
  publicRows:4_500_000,totalRows:4_900_000,importStopRows:3_500_000,
  minuteRows:250_000,essentialMinuteRows:50_000,maxConcurrent:6,publicConcurrent:4,importConcurrent:1,
  leaseMs:60_000,resetQuietMs:60_000,defaultQueryRows:50_000,maxReservationRows:250_000,
});
type SqlValue=string|number|null;
interface SqlStore {exec<T extends Record<string,SqlValue>=Record<string,SqlValue>>(query:string,...values:SqlValue[]):{toArray():T[];one():T};}
interface Store {sql:SqlStore;transactionSync<T>(callback:()=>T):T;}
interface Day extends Record<string,SqlValue> {day:string;charged:number;measured:number;baseline:number;denied:number;tripped:string|null;alerted:number;}
interface Lease extends Record<string,SqlValue> {id:string;day:string;tier:ReadTier;route:string;reserved:number;started:number;minute:number;status:string;actual:number|null;}
export interface Reservation {id:string;route:string;tier:ReadTier;rows:number;}
export type Admission={allowed:true;id:string;day:string;reserved:number}|{allowed:false;reason:string;retryAfter:number};
const dayAt=(now:number)=>new Date(now).toISOString().slice(0,10);
const validInteger=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const safeRoute=(route:string)=>route.replace(/[^a-zA-Z0-9_:/.-]/g,'_').slice(0,96);

export class ReadBudgetLedger {
  private store:Store;
  private emit:(event:Record<string,unknown>)=>void;
  constructor(store:Store,bootstrap:{day?:string;rows?:number},emit:(event:Record<string,unknown>)=>void=event=>console.log(JSON.stringify(event))) {
    this.store=store;this.emit=emit;
    const sql=store.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_days(day TEXT PRIMARY KEY,charged INTEGER NOT NULL,measured INTEGER NOT NULL DEFAULT 0,baseline INTEGER NOT NULL DEFAULT 0,denied INTEGER NOT NULL DEFAULT 0,tripped TEXT,alerted INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_leases(id TEXT PRIMARY KEY,day TEXT NOT NULL,tier TEXT NOT NULL,route TEXT NOT NULL,reserved INTEGER NOT NULL,started INTEGER NOT NULL,minute INTEGER NOT NULL,status TEXT NOT NULL,actual INTEGER)');
    sql.exec('CREATE INDEX IF NOT EXISTS read_budget_leases_active ON read_budget_leases(status,started)');
    sql.exec('CREATE INDEX IF NOT EXISTS read_budget_leases_day ON read_budget_leases(day)');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_minutes(minute INTEGER PRIMARY KEY,charged INTEGER NOT NULL DEFAULT 0,essential INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE TABLE IF NOT EXISTS read_budget_routes(day TEXT NOT NULL,route TEXT NOT NULL,tier TEXT NOT NULL,charged INTEGER NOT NULL DEFAULT 0,measured INTEGER NOT NULL DEFAULT 0,queries INTEGER NOT NULL DEFAULT 0,writes INTEGER NOT NULL DEFAULT 0,denied INTEGER NOT NULL DEFAULT 0,unknown INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,route,tier))');
    if(bootstrap.day&&/^\d{4}-\d{2}-\d{2}$/.test(bootstrap.day)&&validInteger(bootstrap.rows)) {
      sql.exec('INSERT OR IGNORE INTO read_budget_days(day,charged,baseline) VALUES(?,?,?)',bootstrap.day,bootstrap.rows,bootstrap.rows);
    }
  }
  private current(now:number):Day|null {
    const sql=this.store.sql,day=dayAt(now);
    let current=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day=?',day).toArray()[0];
    if(current)return current;
    // A new installation has no authority to assume zero usage mid-day. It
    // needs an explicit baseline. Later UTC days can start from zero plus any
    // unresolved previous-day work, which is deliberately double charged.
    const prior=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day<? ORDER BY day DESC LIMIT 1',day).toArray()[0];
    if(!prior)return null;
    const carry=Number(sql.exec('SELECT COALESCE(SUM(reserved),0) AS n FROM read_budget_leases WHERE day=? AND status IN (\'pending\',\'unknown\')',prior.day).one().n);
    sql.exec('INSERT INTO read_budget_days(day,charged,baseline) VALUES(?,?,?)',day,carry,carry);
    // Keep a bounded operational history. Expired reservations remain charged
    // in their day; deleting old lease detail never refunds those charges.
    const cutoff=new Date(now-3*86400_000).toISOString().slice(0,10);
    sql.exec('DELETE FROM read_budget_leases WHERE day<?',cutoff);
    sql.exec('DELETE FROM read_budget_routes WHERE day<?',cutoff);
    sql.exec('DELETE FROM read_budget_minutes WHERE minute<?',Math.floor(now/60_000)-2880);
    sql.exec('DELETE FROM read_budget_days WHERE day<?',cutoff);
    current=sql.exec<Day>('SELECT * FROM read_budget_days WHERE day=?',day).one();
    return current;
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
  }
  reserve(input:Reservation,now=Date.now()):Admission {
    if(!input||!['public','essential','import'].includes(input.tier)||typeof input.route!=='string'||typeof input.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)||!validInteger(input.rows)||input.rows<1||input.rows>READ_BUDGET_POLICY.maxReservationRows) return {allowed:false,reason:'invalid_reservation',retryAfter:60};
    return this.store.transactionSync(()=>{
      const sql=this.store.sql,day=dayAt(now),minute=Math.floor(now/60_000),route=safeRoute(input.route),row=this.current(now);
      const prior=sql.exec<Lease>('SELECT * FROM read_budget_leases WHERE id=?',input.id).toArray()[0];
      if(prior)return {allowed:false,reason:'replayed_reservation',retryAfter:60};
      const deny=(reason:string,retryAfter=60):Admission=>{
        if(row){sql.exec('UPDATE read_budget_days SET denied=denied+1 WHERE day=?',day);sql.exec('INSERT INTO read_budget_routes(day,route,tier,denied) VALUES(?,?,?,1) ON CONFLICT(day,route,tier) DO UPDATE SET denied=denied+1',day,route,input.tier);}
        // One route aggregate retains every denial. Logs are rate bounded to
        // avoid replacing a D1 exhaustion with the Free observability limit.
        if(!row||row.denied<5||row.denied%100===0)this.emit({event:'d1_read_denied',day,route,tier:input.tier,reason,retryAfter});
        return {allowed:false,reason,retryAfter};
      };
      if(!row)return deny('baseline_required');
      const midnight=Date.parse(day+'T00:00:00Z')+86400_000;
      if(now>=midnight-READ_BUDGET_POLICY.resetQuietMs)return deny('utc_rollover',Math.max(1,Math.ceil((midnight-now)/1000)));
      if(row.tripped)return deny('cost_circuit_open',Math.max(60,Math.ceil((midnight-now)/1000)));
      const ceiling=input.tier==='essential'?READ_BUDGET_POLICY.totalRows:input.tier==='import'?READ_BUDGET_POLICY.importStopRows:READ_BUDGET_POLICY.publicRows;
      if(row.charged+input.rows>ceiling)return deny(input.tier==='import'?'import_paused':'daily_budget',Math.max(60,Math.ceil((midnight-now)/1000)));
      // A crashed / timed-out invocation keeps its full charge. Only its
      // concurrency slot expires; a late success still settles exactly once.
      sql.exec('UPDATE read_budget_leases SET status=\'unknown\' WHERE status=\'pending\' AND started<?',now-READ_BUDGET_POLICY.leaseMs);
      const active=Number(sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\'').one().n);
      if(active>=READ_BUDGET_POLICY.maxConcurrent)return deny('concurrency');
      if(input.tier!=='essential'&&Number(sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND tier!=\'essential\'').one().n)>=READ_BUDGET_POLICY.publicConcurrent)return deny('concurrency');
      if(input.tier==='import'&&Number(sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND tier=\'import\'').one().n)>=READ_BUDGET_POLICY.importConcurrent)return deny('import_concurrency');
      sql.exec('INSERT OR IGNORE INTO read_budget_minutes(minute) VALUES(?)',minute);
      const window=sql.exec('SELECT charged,essential FROM read_budget_minutes WHERE minute=?',minute).one();
      const burnCeiling=READ_BUDGET_POLICY.minuteRows+(input.tier==='essential'?READ_BUDGET_POLICY.essentialMinuteRows:0);
      if(Number(window.charged)+input.rows>burnCeiling)return deny('burn_rate',60-now/1000%60|0||1);
      sql.exec('INSERT INTO read_budget_leases(id,day,tier,route,reserved,started,minute,status) VALUES(?,?,?,?,?,?,?,\'pending\')',input.id,day,input.tier,route,input.rows,now,minute);
      sql.exec('UPDATE read_budget_days SET charged=charged+? WHERE day=?',input.rows,day);
      sql.exec('UPDATE read_budget_minutes SET charged=charged+?,essential=essential+? WHERE minute=?',input.rows,input.tier==='essential'?input.rows:0,minute);
      sql.exec('INSERT INTO read_budget_routes(day,route,tier,charged,queries) VALUES(?,?,?,?,1) ON CONFLICT(day,route,tier) DO UPDATE SET charged=charged+excluded.charged,queries=queries+1',day,route,input.tier,input.rows);
      this.alerts(day);
      return {allowed:true,id:input.id,day,reserved:input.rows};
    });
  }
  settle(id:string,actual:number|null,writes=0,now=Date.now()) {
    return this.store.transactionSync(()=>{
      const sql=this.store.sql,lease=sql.exec<Lease>('SELECT * FROM read_budget_leases WHERE id=?',id).toArray()[0];
      if(!lease||lease.status==='settled')return {settled:false};
      if(actual===null||!validInteger(actual)||!validInteger(writes)) {
        sql.exec('UPDATE read_budget_leases SET status=\'unknown\' WHERE id=?',id);
        sql.exec('UPDATE read_budget_routes SET unknown=unknown+1 WHERE day=? AND route=? AND tier=?',lease.day,lease.route,lease.tier);
        return {settled:false,charged:lease.reserved};
      }
      const delta=actual-lease.reserved;
      sql.exec('UPDATE read_budget_leases SET status=\'settled\',actual=? WHERE id=?',actual,id);
      sql.exec('UPDATE read_budget_days SET charged=charged+?,measured=measured+? WHERE day=?',delta,actual,lease.day);
      sql.exec('UPDATE read_budget_minutes SET charged=MAX(0,charged+?),essential=MAX(0,essential+?) WHERE minute=?',delta,lease.tier==='essential'?delta:0,lease.minute);
      sql.exec('UPDATE read_budget_routes SET charged=charged+?,measured=measured+?,writes=writes+? WHERE day=? AND route=? AND tier=?',delta,actual,writes,lease.day,lease.route,lease.tier);
      // A contract violation is never silently learned and retried. Stop fresh
      // D1 work until the next UTC day (or a reviewed code fix). Existing cache
      // responses remain available. SQL LIMIT is not a scanned-row bound.
      if(actual>lease.reserved) {
        const reason='reservation_exceeded';
        sql.exec('UPDATE read_budget_days SET tripped=? WHERE day=?',reason,lease.day);
        const current=this.current(now);
        if(current&&current.day!==lease.day)sql.exec('UPDATE read_budget_days SET tripped=? WHERE day=?',reason,current.day);
        this.emit({event:'d1_read_cost_overrun',day:lease.day,route:lease.route,reserved:lease.reserved,actual});
      }
      this.alerts(lease.day);
      return {settled:true,charged:actual,overrun:actual>lease.reserved};
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
    const current=this.current(now);
    return {day:dayAt(now),initialized:!!current,policy:READ_BUDGET_POLICY,usage:current,
      active:Number(this.store.sql.exec('SELECT COUNT(*) AS n FROM read_budget_leases WHERE status=\'pending\' AND started>=?',now-READ_BUDGET_POLICY.leaseMs).one().n),
      routes:this.store.sql.exec('SELECT route,tier,charged,measured,queries,writes,denied,unknown FROM read_budget_routes WHERE day=? ORDER BY charged DESC LIMIT 100',dayAt(now)).toArray()};
  }
}
