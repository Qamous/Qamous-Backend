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
      writes=0;events=[];ledger;
      constructor(ctx,env) {
        super(ctx,env);
        const store={sql:{exec:(query,...args)=>{
          const cursor=ctx.storage.sql.exec(query,...args),rows=[...cursor];this.writes+=cursor.rowsWritten;
          return {toArray:()=>rows,one:()=>{if(rows.length!==1)throw Error('Expected one row');return rows[0];}};
        }},transactionSync:callback=>ctx.storage.transactionSync(callback)};
        this.ledger=new ReadBudgetLedger(store,{day,rows:0},event=>this.events.push(event));
      }
      run(scenario) {
        const sql=this.ctx.storage.sql,ledger=this.ledger;
        const claim=(id,tier='public')=>({id:'request-'+id,rows:1,route:'/measured',tier});
        if(scenario==='worst-cleanup') {
          sql.exec('INSERT INTO read_budget_days(day,charged) VALUES(?,0)','2026-10-16');
          sql.exec("INSERT INTO read_budget_leases(id,day,tier,route,reserved,started,minute,status) VALUES('old-lease','2026-10-16','public','/old',1,1,1,'settled')");
          sql.exec("INSERT INTO read_budget_routes(day,route,tier) VALUES('2026-10-16','/old','public')");
          sql.exec('INSERT INTO read_budget_minutes(minute) VALUES(1)');
          sql.exec('UPDATE read_budget_days SET operations=?,charged=? WHERE day=?',READ_BUDGET_POLICY.ledgerWarningOperations-1,3499999,day);
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
    assert.ok(result.writes<=32,scenario+' exceeds the conservative lifecycle allocation');
    assert.equal(result.duplicateUnknownWrites,0);assert.equal(result.duplicateSuccessWrites,0);
  }
  const response=await mf.dispatchFetch('https://local/cap');assert.equal(response.status,200,await response.clone().text());
  const capped=await response.json();t.diagnostic(JSON.stringify(capped));
  assert.equal(capped.denialWrites,0);assert.equal(capped.operations,2000);
  assert.ok(capped.writes<=capped.operations*capped.policy.ledgerRowsPerOperation);
});
