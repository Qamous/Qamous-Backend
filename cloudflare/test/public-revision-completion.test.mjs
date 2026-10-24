import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('prepaid revision completion survives exhausted pools, restart, midnight and expired leases',async t=>{
  const bundled=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    import {DurableObject} from 'cloudflare:workers';
    import {ReadBudgetLedger} from './src/read-budget-ledger.ts';
    import {BudgetedPublicRevision} from './src/public-cache-revision-budget.ts';
    export class Probe extends DurableObject {
      clock=Date.parse('2026-10-24T23:59:00Z');writes=0;ledger;budget;store;delay=false;creditReads=0;
      constructor(ctx,env){super(ctx,env);this.store={transactionSync:fn=>ctx.storage.transactionSync(fn),sql:{exec:(query,...args)=>{const cursor=ctx.storage.sql.exec(query,...args),rows=cursor.toArray();this.writes+=cursor.rowsWritten;return {rowsWritten:cursor.rowsWritten,toArray:()=>rows,one:()=>{if(rows.length!==1)throw Error('One row required');return rows[0];}};}}};this.restart();}
      restart(){this.ledger=new ReadBudgetLedger(this.store,{day:'2026-10-24',rows:0,auxiliaryDay:'2026-10-24',auxiliaryRows:2000},()=>{});this.budget=new BudgetedPublicRevision(this.store,cost=>Promise.resolve(this.ledger.reserveAuxiliaryWrites(cost,'revision',this.clock)),{credits:()=>{this.creditReads++;return Promise.resolve(this.ledger.revisionWriteCredits());},reserve:(id,cost,completion)=>{const allowed=this.ledger.reserveRevisionLifecycle(id,cost,completion,this.clock);if(this.delay){this.delay=false;this.clock+=180000;}return Promise.resolve(allowed);},complete:id=>Promise.resolve(this.ledger.completeRevisionLifecycle(id,this.clock))},()=>this.clock);}
      snapshot(){return this.budget.run('snapshot',{},(revision,now,maintain)=>revision.snapshot(['feed:0','word:1'],now,maintain),true);}
      claim(id){return this.budget.run('claimScoped',{id,selectors:['feed:*','word:1']},(revision,now)=>revision.claimScoped(id,['feed:*','word:1'],now));}
      finish(id){return this.budget.run('finishScoped',{id},revision=>revision.finishScoped(id));}
      fill(){for(const kind of ['revision','runtime','import']){while(this.ledger.reserveAuxiliaryWrites(499,kind,this.clock)){}while(this.ledger.reserveAuxiliaryWrites(1,kind,this.clock)){}}}
      async run(scenario){
        if(scenario==='slow'){
          this.clock=Date.parse('2026-10-24T12:00:00Z');await this.snapshot();this.delay=true;await this.claim('slow-new-mutation');
          const expires=Number(this.ctx.storage.sql.exec('SELECT expires FROM public_cache_scoped_mutations WHERE id=?','slow-new-mutation').one().expires),applicationTime=this.clock;
          this.delay=true;
          const renewed=await this.budget.run('claimScoped',{id:'slow-new-mutation',selectors:['word:1'],existingOnly:true},(revision,now)=>revision.claimScoped('slow-new-mutation',['word:1'],now,true));
          const after=await this.snapshot(),reads=this.creditReads;
          for(let i=0;i<100;i++)await this.snapshot();
          return {expires,applicationTime,renewed,after,reads,finalReads:this.creditReads};
        }
        if(scenario==='crossing-grant'){
          await this.snapshot();this.delay=true;let refused=false;
          try{await this.claim('crossing-mutation');}catch{refused=true;}
          const tickets=this.ctx.storage.sql.exec('SELECT id FROM public_cache_scoped_mutations').toArray();
          return {refused,tickets};
        }
        await this.snapshot();await this.claim('prepaid-mutation');
        const credit=this.ledger.revisionWriteCredits()[0];
        if(scenario!=='same-day')this.clock+=86400000;
        this.fill();const capped=this.ledger.status(this.clock).auxiliaryWrites;
        if(this.ledger.reserveAuxiliaryWrites(1,'revision',this.clock))throw Error('Pool not exhausted');
        this.restart();const before=this.writes;
        if(scenario==='expiry')await this.snapshot();else await this.finish('prepaid-mutation');
        const after=await this.snapshot(),spent=this.writes-before;
        return {credit,capped,after,spent,remaining:this.ledger.revisionWriteCredits(),final:this.ledger.status(this.clock).auxiliaryWrites};
      }
    }
    export default {async fetch(request,env){return Response.json(await env.PROBE.getByName(new URL(request.url).pathname).run(new URL(request.url).pathname.slice(1)));}};
  `},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',durableObjects:{PROBE:{className:'Probe',useSQLite:true}}}));t.after(()=>mf.dispose());
  for(const scenario of ['same-day','midnight','expiry']){
    const response=await mf.dispatchFetch('https://test.invalid/'+scenario);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
    assert.ok(result.capped.charged>=11999,'entire shared auxiliary pool is exhausted');assert.ok(result.capped.revision>=2999,'new revision work is exhausted');
    assert.deepEqual(result.after.pending,[false,false],'admitted mutation cannot strand the feed or word dirty');assert.equal(result.after.anyPending,false);assert.deepEqual(result.remaining,[]);
    assert.ok(result.spent<=result.credit.cost+1,'completion SQL plus durable hold acknowledgement was prepaid');
    assert.deepEqual(result.final,result.capped,'completion never asks for or resets exhausted allowance');
  }
  const response=await mf.dispatchFetch('https://test.invalid/slow');assert.equal(response.status,200,await response.clone().text());const slow=await response.json();
  assert.equal(slow.expires-slow.applicationTime,120000,'slow grants issue a fresh full lease from actual application time');assert.equal(slow.renewed,false,'an existing-only claim may not resurrect an expired ticket after a slow grant');assert.equal(slow.after.anyPending,false);
  assert.equal(slow.finalReads,slow.reads,'ordinary browsing does not make an auxiliary credits RPC per snapshot');
  const crossed=await mf.dispatchFetch('https://test.invalid/crossing-grant').then(response=>response.json());assert.equal(crossed.refused,true);assert.deepEqual(crossed.tickets,[],'an old-day admission never executes new-day claim writes');
});
