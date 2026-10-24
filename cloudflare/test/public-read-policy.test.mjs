import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('snapshot pause and native read limiting work while every database and Durable Object binding is unavailable',async t=>{
  const entry=`import api from './src/index.ts';
    import importer from './src/import-host.mjs';
    export {QamousRuntime,QamousPublicCache,QamousReadBudget} from './src/index.ts';
    let touches=0;
    const denied=new Proxy({}, {get(){touches++;throw Error('Persistent storage must not be touched');}});
    export default {async fetch(request,env,ctx) {
      const url=new URL(request.url),mode=request.headers.get('x-test-mode');
      const safe={...env,DB:denied,RUNTIME:denied,READ_BUDGET:denied,PUBLIC_CACHE:denied,COORDINATOR:denied};
      if(mode==='status-probe')safe.COORDINATOR={getByName(){return {status:async()=>({state:'waiting_for_free_quota',cursor:42,halted:false}),recoverBaseline:async()=>({state:'retry_pending',cursor:42})};}};
      if(mode==='native'||mode==='native-missing')safe.PUBLIC_READ_ONLY='false';
      if(mode==='native-missing')safe.PUBLIC_READ_RATE_LIMIT=undefined;
      if(url.pathname==='/__touches')return Response.json({touches});
      if(url.pathname==='/__scheduled') {
        let waits=0;await importer.scheduled({},safe,{waitUntil(){waits++;}});
        return Response.json({waits,touches});
      }
      if(url.pathname.startsWith('/__import/')) {
        url.pathname=url.pathname.slice('/__import'.length);
        return importer.fetch(new Request(url,request),safe);
      }
      return api.fetch(request,safe,ctx);
    }};`;
  const bundled=await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},
    bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,
    compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],
    ratelimits:{PUBLIC_READ_RATE_LIMIT:{namespace_id:'20261023',simple:{limit:2,period:60}}},
    bindings:{PUBLIC_READ_ONLY:'true',ALLOWED_ORIGINS:'https://qamous.org',APP_URL:'https://qamous.org',
      SEO_INTERNAL_SECRET:'synthetic-seo-secret',IMPORT_ADMIN_TOKEN:'synthetic-admin-token',IMPORT_JOB_HASH:'a'.repeat(64)},
    outboundService:()=>{throw Error('Read policy tests must not contact external services');}}));
  t.after(()=>mf.dispose());
  const call=(path,{method='GET',mode,auth=false,cookie=false}={})=>mf.dispatchFetch('https://api.qamous.org'+path,{method,
    headers:{Origin:'https://qamous.org','Content-Type':'application/json','x-qamous-seo-internal':'synthetic-seo-secret',
      ...(mode?{'x-test-mode':mode}:{}),...(auth?{Authorization:'Bearer synthetic-admin-token'}:{}),
      ...(cookie?{Cookie:'qamous_session='+'b'.repeat(64)}:{})},
    body:['POST','PATCH','PUT'].includes(method)?'{}':undefined});

  await t.test('health metadata and robots bypass storage even with an old session cookie',async()=>{
    for(const path of ['/','/robots.txt','/__import/health']) {
      const result=await call(path,{cookie:true});assert.equal(result.status,200,await result.text());
    }
  });
  await t.test('all dynamic reads and mutations stop before persistent bindings',async()=>{
    for(const [method,path] of [['GET','/auth/health'],['GET','/auth/session'],['GET','/seo/word/1'],['HEAD','/definitions/feed'],
      ['GET','/word/explore'],['POST','/auth/login'],['POST','/contributions'],['PATCH','/word/1'],['DELETE','/definitions/1'],
      ['POST','/word-reports'],['POST','/maintenance/embeddings']]) {
      const result=await call(path,{method,cookie:true});
      assert.equal(result.status,503,method+' '+path);assert.equal(result.headers.get('Retry-After'),'60');
      if(method!=='HEAD')assert.equal((await result.json()).code,'PUBLIC_READ_ONLY');
    }
  });
  await t.test('the importer pauses cron and authenticated admin endpoints before its coordinator',async()=>{
    assert.deepEqual(await (await call('/__scheduled')).json(),{waits:0,touches:0});
    for(const [method,path] of [['POST','/status'],['HEAD','/status'],['POST','/tick'],['POST','/arm'],['PUT','/stage/job.json'],
      ['GET','/read-budget'],['POST','/read-budget/reconcile'],['POST','/public-cache/seed']]) {
      const result=await call('/__import'+path,{method,auth:true});
      assert.equal(result.status,503,method+' '+path);assert.equal(result.headers.get('Retry-After'),'60');
    }
    assert.equal((await call('/__import/status')).status,401,'admin authentication is preserved');
  });
  await t.test('paused checkpoint inspection requires authentication and never opens mutations or maintenance',async()=>{
    const status=await call('/__import/status',{auth:true,mode:'status-probe'});
    assert.equal(status.status,200);
    assert.equal(status.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(await status.json(),{state:'waiting_for_free_quota',cursor:42,halted:false});
    for(const [method,path] of [['POST','/tick'],['GET','/read-budget'],['POST','/read-budget/reserve']])
      assert.equal((await call('/__import'+path,{method,auth:true,mode:'status-probe'})).status,503);
    assert.equal((await call('/__import/status',{mode:'status-probe'})).status,401);
    assert.equal((await call('/__import/recover-baseline',{method:'POST',mode:'status-probe'})).status,401);
    const recovery=await call('/__import/recover-baseline',{method:'POST',mode:'status-probe',auth:true});
    assert.equal(recovery.status,200);assert.deepEqual(await recovery.json(),{state:'retry_pending',cursor:42});
  });
  await t.test('native limiter permits normal anonymous reads then rejects excess without Durable Objects',async()=>{
    for(let i=0;i<2;i++) {
      const result=await call('/auth/session',{mode:'native'});
      assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).authenticated,false);
    }
    const rejected=await call('/auth/session',{mode:'native'});
    assert.equal(rejected.status,429);assert.equal(rejected.headers.get('Retry-After'),'60');
  });
  await t.test('missing native binding fails safely rather than falling back to persistent rate limiting',async()=>{
    const rejected=await call('/auth/session',{mode:'native-missing'});
    assert.equal(rejected.status,503);assert.equal(rejected.headers.get('Retry-After'),'60');
    assert.deepEqual(await (await call('/__touches')).json(),{touches:0});
  });
  await t.test('exhausted native quota rejects every method and old cookies before session or action limits',async()=>{
    for(const [method,path] of [['POST','/auth/login'],['POST','/users/register'],['POST','/auth/logout'],['PATCH','/word/1'],
      ['DELETE','/definitions/1'],['GET','/auth/health'],['HEAD','/countries']]) {
      const result=await call(path,{method,mode:'native',cookie:true});
      assert.equal(result.status,429,method+' '+path);assert.equal(result.headers.get('Retry-After'),'60');
    }
    assert.deepEqual(await (await call('/__touches')).json(),{touches:0});
  });
});
