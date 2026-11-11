import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('buffered cold words survive realistic D1 latency while hot reads and LRU coalescing remain available',{timeout:30000},async t=>{
  const built=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    import {QamousPublicCache} from './src/public-cache.ts';
    export {QamousReadBudget} from './src/index.ts';
    export class Probe extends QamousPublicCache {
      constructor(ctx,env){
        const metrics={reads:0,active:0,peak:0};
        const wrap=statement=>({bind(...args){return wrap(statement.bind(...args));},async all(){
          metrics.reads++;metrics.peak=Math.max(metrics.peak,++metrics.active);
          try{await new Promise(resolve=>setTimeout(resolve,180));return await statement.all();}finally{metrics.active--;}
        }});
        super(ctx,{...env,DB:{prepare:query=>wrap(env.DB.prepare(query))}});this.metrics=metrics;
      }
      async burst(bypass){
        if(bypass)this.loadGate={run:load=>load()};
        await this.get('word:1',1);this.metrics.reads=0;this.metrics.peak=0;
        const burst=Promise.all(Array.from({length:24},(_,i)=>this.get('word:'+(i+2),1)));
        const hot=await this.get('word:1',1),results=await burst;
        return {hot:hot.state,success:results.filter(r=>r.ok).length,errors:results.filter(r=>!r.ok).map(r=>r.budgetReason),...this.metrics};
      }
      async evicted(){
        this.metrics.reads=0;const first=this.get('word:31',1);
        await new Promise(resolve=>setTimeout(resolve,25));
        for(let id=100;id<300;id++)this.cacheFor('word:'+id);
        const replies=await Promise.all([first,this.get('word:31',1)]);
        return {ok:replies.every(r=>r.ok),reads:this.metrics.reads,hot:this.caches.size};
      }
    }
    export default {async fetch(request,env){const {name,method,args=[]}=await request.json();return Response.json(await env.CACHE.getByName(name)[method](...args));}};
  `},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const today=new Date().toISOString().slice(0,10);
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,
    compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    durableObjects:{READ_BUDGET:{className:'QamousReadBudget',useSQLite:true},CACHE:{className:'Probe',useSQLite:true}},
    bindings:{PUBLIC_CARD_PAYLOADS:'true',READ_BUDGET_BOOTSTRAP_DAY:today,READ_BUDGET_BOOTSTRAP_ROWS:'0',
      PUBLIC_CACHE_WRITE_BOOTSTRAP_DAY:today,PUBLIC_CACHE_WRITE_BOOTSTRAP_ROWS:'0'},
    outboundService:()=>{throw Error('Burst tests must stay local');}}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())
    await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  await db.exec("INSERT INTO users(id,firstName,lastName,email,username,createdAt) VALUES(1,'Fixture','','fixture@example.invalid','fixture','2026-01-01');");
  for(let id=1;id<=31;id++) {
    const word='Fixture '+id;
    await db.batch([
      db.prepare("INSERT INTO words(id,userId,arabicWord,createdAt) VALUES(?,1,?,'2026-01-01')").bind(id,word),
      db.prepare("INSERT INTO definitions(id,wordId,userId,definition,isArabic) VALUES(?,?,1,'Synthetic meaning',0)").bind(id,id),
      db.prepare('INSERT INTO public_card_payloads(definitionId,payload) VALUES(?,?)').bind(id,JSON.stringify({id,definitionId:id,wordId:id,definition:'Synthetic meaning',arabicWord:word,isArabic:false})),
    ]);
  }
  const call=async(name,method,...args)=>{const r=await mf.dispatchFetch('https://test.invalid/',{method:'POST',body:JSON.stringify({name,method,args})});assert.equal(r.status,200,await r.clone().text());return r.json();};
  const baseline=await call('baseline','burst',true);
  assert.ok(baseline.errors.length>0,'the control reproduces the existing direct-admission failure');
  assert.ok(baseline.errors.every(reason=>reason==='concurrency'));
  const buffered=await call('buffered','burst',false);
  assert.equal(buffered.success,24);assert.deepEqual(buffered.errors,[]);
  assert.equal(buffered.peak,2);assert.equal(buffered.reads,24);assert.equal(buffered.hot,'hit');
  const coalesced=await call('buffered','evicted');
  assert.equal(coalesced.ok,true);assert.equal(coalesced.reads,1);assert.ok(coalesced.hot<=128);
  const bindings=await mf.getBindings(),budget=await bindings.READ_BUDGET.getByName('qamous-d1-account-v1').status();
  assert.equal(budget.usage.tripped,null);assert.equal(budget.usage.unresolved,0);assert.deepEqual(budget.costCircuits,{});
  t.diagnostic(JSON.stringify({baseline:{success:baseline.success,failures:baseline.errors.length,peak:baseline.peak},buffered,coalesced}));
});
