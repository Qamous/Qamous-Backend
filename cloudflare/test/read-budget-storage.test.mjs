import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('real SQLite Durable Object row-write metering stays inside the lifecycle allocation',{timeout:30_000},async t=>{
  const entry=`import {DurableObject} from 'cloudflare:workers';
    import {ReadBudgetLedger,READ_BUDGET_POLICY} from './src/read-budget-ledger.ts';
    const day='2026-10-22',now=Date.parse(day+'T12:00:00Z');
    export class MeasuredLedger extends DurableObject {
      writes=0;reads=0;events=[];ledger;store;
      constructor(ctx,env) {
        super(ctx,env);
        const store={sql:{exec:(query,...args)=>{
          const cursor=ctx.storage.sql.exec(query,...args),rows=[...cursor];this.writes+=cursor.rowsWritten;this.reads+=cursor.rowsRead;
          return {toArray:()=>rows,one:()=>{if(rows.length!==1)throw Error('Expected one row');return rows[0];}};
        }},transactionSync:callback=>ctx.storage.transactionSync(callback)};
        this.store=store;this.ledger=new ReadBudgetLedger(store,{day,rows:0},event=>this.events.push(event));
      }
      run(scenario) {
        const sql=this.ctx.storage.sql,ledger=this.ledger;
        const change=(day,mutate)=>{const state=JSON.parse(sql.exec('SELECT state FROM read_budget_compact_days WHERE day=?',day).one().state);mutate(state);sql.exec('UPDATE read_budget_compact_days SET state=? WHERE day=?',JSON.stringify(state),day);};
        const claim=(id,tier='public')=>({id:'request-'+id,rows:1,route:'/measured',tier});
        if(scenario==='cache-pool') {
          const before=this.writes;
          const cacheLedger=new ReadBudgetLedger(this.store,{day,rows:0,cacheDay:day,cacheRows:0},()=>{});
          let admissions=0;
          while(cacheLedger.reservePublicCacheWrites(1,'public',now))admissions++;
          const publicAdmissions=admissions;
          while(cacheLedger.reservePublicCacheWrites(1,'essential',now))admissions++;
          const capped=this.writes;
          for(let n=0;n<1000;n++)if(cacheLedger.reservePublicCacheWrites(1,'essential',now))throw Error('Cache pool bypass');
          const status=cacheLedger.status(now);
          return {scenario,publicAdmissions,admissions,writes:capped-before,denialWrites:this.writes-capped,charged:status.publicCacheWrites.charged,d1Operations:status.usage.operations};
        }
        if(scenario==='rollover-denials') {
          for(let n=0;n<1500;n++)sql.exec("INSERT INTO read_budget_compact_leases(id,day,tier,route,reserved,started,minute,status) VALUES(?,?,'public','/old',3000,?,?,'unknown')",'old-'+n,day,now,Math.floor(now/60000));
          change(day,state=>{state.unresolved=4500000;state.charged=4500000;});
          const beforeReads=this.reads,beforeWrites=this.writes,tomorrow=now+86400000;
          for(let n=0;n<1000;n++)if(ledger.reserve(claim('rollover-'+n),tomorrow).reason!=='daily_budget')throw Error('Carry bypass');
          const deniedReads=this.reads-beforeReads;
          for(let n=0;n<1000;n++)if(ledger.status(tomorrow).usage.charged!==4500000)throw Error('Carry changed');
          const statusReads=this.reads-beforeReads-deniedReads,restartReads=this.reads,restartWrites=this.writes;
          for(let n=0;n<1000;n++) {
            const restarted=new ReadBudgetLedger(this.store,{day,rows:0},()=>{});
            if(restarted.reserve(claim('restart-'+n),tomorrow).reason!=='daily_budget')throw Error('Restart bypass');
          }
          return {scenario,deniedReads,statusReads,writes:restartWrites-beforeWrites,restartReads:this.reads-restartReads,restartWrites:this.writes-restartWrites};
        }
        if(scenario==='worst-cleanup') {
          sql.exec("INSERT INTO read_budget_compact_leases(id,day,tier,route,reserved,started,minute,status) VALUES('old-lease','2026-10-16','public','/old',1,1,1,'settled')");
          change(day,state=>{state.operations=READ_BUDGET_POLICY.ledgerWarningOperations-1;state.ledgerRows=state.operations*READ_BUDGET_POLICY.ledgerRowsPerOperation;state.charged=3499999;});
        }
        const before=this.writes;
        if(scenario==='cap') {
          for(let n=0;n<READ_BUDGET_POLICY.ledgerTotalOperations;n++) {
            const r=ledger.reserve(claim(n,n<READ_BUDGET_POLICY.ledgerPublicOperations?'public':'essential'),now);
            if(!r.allowed)throw Error('Unexpected admission refusal');ledger.settle(r.id,0,0,now);
          }
          const capped=this.writes;
          for(let n=0;n<1000;n++)if(ledger.reserve(claim('denied-'+n,'essential'),now).reason!=='do_storage_budget')throw Error('Cap bypass');
          return {scenario,writes:capped-before,denialWrites:this.writes-capped,operations:ledger.status(now).usage.operations,policy:READ_BUDGET_POLICY};
        }
        const r=ledger.reserve(claim(scenario),now);if(!r.allowed)throw Error('Unexpected refusal');
        ledger.settle(r.id,null,0,now);
        const unknown=this.writes;
        for(let n=0;n<100;n++)ledger.settle(r.id,null,0,now);
        const duplicateUnknownWrites=this.writes-unknown;
        ledger.settle(r.id,scenario==='overrun'?2:0,0,now);
        const settled=this.writes;
        for(let n=0;n<100;n++)ledger.settle(r.id,0,0,now);
        return {scenario,writes:settled-before,duplicateUnknownWrites,duplicateSuccessWrites:this.writes-settled,events:this.events};
      }
    }
    export default {async fetch(request,env) {const scenario=new URL(request.url).pathname.slice(1);return Response.json(await env.LEDGER.getByName(scenario).run(scenario));}};`;
  const bundled=await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},
    bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',
    durableObjects:{LEDGER:{className:'MeasuredLedger',useSQLite:true}},outboundService:()=>{throw Error('No external services');}}));
  t.after(()=>mf.dispose());
  for(const scenario of ['ordinary','worst-cleanup','overrun']) {
    const response=await mf.dispatchFetch('https://local/'+scenario);assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();t.diagnostic(JSON.stringify(result));
    assert.ok(result.writes<=8,scenario+' exceeds the conservative lifecycle allocation');
    assert.equal(result.duplicateUnknownWrites,0);assert.equal(result.duplicateSuccessWrites,0);
  }
  const response=await mf.dispatchFetch('https://local/cap');assert.equal(response.status,200,await response.clone().text());
  const capped=await response.json();t.diagnostic(JSON.stringify(capped));
  assert.equal(capped.denialWrites,0);assert.equal(capped.operations,capped.policy.ledgerTotalOperations);
  assert.ok(capped.writes<=capped.operations*capped.policy.ledgerRowsPerOperation);
  const rolloverResponse=await mf.dispatchFetch('https://local/rollover-denials');assert.equal(rolloverResponse.status,200,await rolloverResponse.clone().text());
  const rollover=await rolloverResponse.json();t.diagnostic(JSON.stringify(rollover));
  assert.ok(rollover.deniedReads<=5000,'a historical carry scan must not repeat for each denial');
  assert.ok(rollover.statusReads<=5000,'status polling must reuse the same conservative rollover preview');
  assert.ok(rollover.writes<=1,'rollover may insert only its one durable carry row');
  assert.ok(rollover.restartReads<=25_000,'cold refusals must not rescan historical leases');
  assert.equal(rollover.restartWrites,0);
  const cacheResponse=await mf.dispatchFetch('https://local/cache-pool');assert.equal(cacheResponse.status,200,await cacheResponse.clone().text());
  const cache=await cacheResponse.json();t.diagnostic(JSON.stringify(cache));
  assert.equal(cache.publicAdmissions,7999);assert.equal(cache.admissions,9999);
  assert.equal(cache.writes,cache.admissions+1,'one row per admission plus the initial counter row');
  assert.equal(cache.charged,cache.writes+cache.admissions,'the pool reserves every counter write and every promised cache-row write');
  assert.equal(cache.denialWrites,0);assert.equal(cache.d1Operations,0);
});
