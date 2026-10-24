import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('5000 resources share one budgeted SQL schema and evicted hot entries reload without D1',async t=>{
  const bundled=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    import {QamousPublicCache} from './src/public-cache.ts';
    export class Probe extends QamousPublicCache {
      constructor(ctx,env){const grants=[];super(ctx,{READ_BUDGET:{getByName:()=>({reservePublicCacheWrites:async cost=>{grants.push(cost);return true;}})}});this.grants=grants;this.now=Date.now();Date.now=()=>this.now;}
      async seedMany(count){for(let id=1;id<=count;id++)await this.cacheFor('word:'+id).prime(1,{id,text:'x'.repeat(1000)},60000,604800000);return this.inspect();}
      async read(id){return (await this.cacheFor('word:'+id).get(1,60000,604800000,()=>{throw Error('D1 must not run');})).value;}
      async large(){for(let id=6000;id<6004;id++)await this.cacheFor('word:'+id).prime(1,{id,text:'x'.repeat(1500000)},60000,604800000);return this.inspect();}
      async cycles(){let loads=0;const pass=async()=>{for(let id=0;id<129;id++)await this.cacheFor('cycle:'+id).get(1,10,604800000,async()=>{loads++;return {id};});};await pass();this.now+=11;await pass();const afterRefresh=loads;await pass();return {afterRefresh,afterRevisit:loads,metadata:this.freshMetadata.size};}
      async ordered(){const older=this.cacheFor('ordered');this.caches.delete('ordered');await this.cacheFor('ordered').prime(2,{word:'newer'},60000,604800000);await older.prime(1,{word:'older'},60000,604800000);return {memo:this.freshMetadata.get('ordered').revision,value:(await this.cacheFor('ordered').get(2,60000,604800000,()=>{throw Error('D1');})).value};}
      async inspect(){return {granted:this.grants.reduce((sum,n)=>sum+n,0),grants:this.grants.length,hot:this.caches.size,bytes:this.cacheBytes,
        tables:this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='public_cache_values_v3'").one().n,
        stored:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM public_cache_values_v3 WHERE id=0').one().n};}
    }
    export default {async fetch(request,env){const {method,args}=await request.json();return Response.json(await env.CACHE.getByName('shared')[method](...args));}};
  `},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',durableObjects:{CACHE:{className:'Probe',useSQLite:true}}}));
  t.after(()=>mf.dispose());
  const call=async(method,...args)=>{const response=await mf.dispatchFetch('https://test.invalid/',{method:'POST',body:JSON.stringify({method,args})});assert.equal(response.status,200,await response.clone().text());return response.json();};
  const result=await call('seedMany',5000);
  assert.equal(result.granted,5002,'one row per resource plus two schema rows for the entire shared cache');
  assert.equal(result.grants,5000);assert.equal(result.stored,5000);assert.equal(result.tables,1);
  assert.ok(result.hot<=128);assert.ok(result.bytes<=8_000_000);
  assert.equal((await call('read',1)).id,1,'an evicted entry remains durably available');
  assert.equal((await call('inspect')).grants,5000,'read-only restoration performs no schema or persistence writes');
  const large=await call('large');assert.ok(large.bytes<=8_000_000,'the byte bound evicts large resources before the count bound');
  assert.equal((await call('read',6000)).id,6000,'large evicted payloads still reload from shared SQL');
  const cycles=await call('cycles');assert.equal(cycles.afterRefresh,258);assert.equal(cycles.afterRevisit,258,'129-key cycles do not re-run D1 after unchanged TTL revalidation and LRU eviction');assert.ok(cycles.metadata<=8192);
  const ordered=await call('ordered');assert.equal(ordered.memo,2,'a detached old state cannot replace newer retained freshness');assert.equal(ordered.value.word,'newer');
});
