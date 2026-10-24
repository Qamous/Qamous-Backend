import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('revision grants cover real Durable Object SQL rows and denied maintenance keeps unrelated browsing available',async t=>{
  const bundled=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    import {DurableObject} from 'cloudflare:workers';
    import {BudgetedPublicRevision} from './src/public-cache-revision-budget.ts';
    export class Probe extends DurableObject {
      denied=false;grants=[];
      constructor(ctx,env){super(ctx,env);this.budget=new BudgetedPublicRevision(ctx.storage,async cost=>{this.grants.push(cost);return !this.denied;});}
      async snapshot(keys){return this.budget.run('snapshot',{},(revision,now,maintain)=>revision.snapshot(keys,now,maintain),true);}
      async claim(id,selectors){return this.budget.run('claimScoped',{id,selectors},(revision,now)=>revision.claimScoped(id,selectors,now));}
      async finish(id){return this.budget.run('finishScoped',{id},revision=>revision.finishScoped(id));}
      async deny(){this.denied=true;}
      async expire(){this.ctx.storage.sql.exec('UPDATE public_cache_scoped_mutations SET expires=0');}
      async inspect(){return {grants:this.grants,rows:[...this.ctx.storage.sql.exec('SELECT selector FROM public_cache_mutation_scopes')]};}
      async measure(){const result=[];for(const query of ['CREATE TABLE budget_metric_probe(id INTEGER PRIMARY KEY,value TEXT)','INSERT INTO budget_metric_probe VALUES(1,1)','INSERT OR IGNORE INTO budget_metric_probe VALUES(1,1)','CREATE TABLE IF NOT EXISTS budget_metric_probe(id INTEGER PRIMARY KEY,value TEXT)','UPDATE budget_metric_probe SET value=1 WHERE id=999','CREATE INDEX budget_probe_index ON budget_metric_probe(value)']){const cursor=this.ctx.storage.sql.exec(query);cursor.toArray();result.push({query,writes:cursor.rowsWritten});}return result;}
    }
    export default {async fetch(request,env){const {method,args}=await request.json();try{return Response.json({value:await env.REV.getByName('synthetic')[method](...args)});}catch(error){return Response.json({error:error.message}, {status:500});}}};
  `},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',durableObjects:{REV:{className:'Probe',useSQLite:true}}}));
  t.after(()=>mf.dispose());const probe=new Proxy({}, {get:(_,method)=>async(...args)=>{const response=await mf.dispatchFetch('https://test.invalid/',{method:'POST',body:JSON.stringify({method,args})});const result=await response.json();if(!response.ok)throw new Error(result.error);return result.value;}});
  assert.deepEqual((await probe.measure()).map(row=>row.writes),[2,1,0,0,0,2],'real workerd meters schema creation as storage writes too');
  assert.deepEqual((await probe.snapshot(['word:1','word:2'])).versions,[1,1]);
  const initial=(await probe.inspect()).grants.length;
  await probe.snapshot(['word:1']);assert.equal((await probe.inspect()).grants.length,initial,'ordinary snapshots need no write grant');
  await probe.claim('synthetic-mutation',['word:1','cards:0','feed:*']);
  assert.deepEqual((await probe.snapshot(['word:1','word:2'])).pending,[true,false]);
  await probe.finish('synthetic-mutation');
  await probe.claim('expiring-mutation',['word:1']);await probe.expire();await probe.deny();
  assert.deepEqual((await probe.snapshot(['word:1','word:2'])).pending,[true,false]);
  await assert.rejects(probe.claim('denied-mutation',['word:2']),/temporarily busy/);
  assert.equal((await probe.inspect()).rows.some(row=>row.selector==='word:2'),false);
});
