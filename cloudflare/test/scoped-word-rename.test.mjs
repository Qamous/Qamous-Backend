import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('overlapping renames produce one conflict and preserve the winning canonical alias cache',async t=>{
  // The transport hook exists only in this local test bundle. It completes a
  // second real authenticated Hono request after A has read/planned X -> Z,
  // immediately before A submits its conditional UPDATE. No timing/sleeps.
  const entry=`
    import app from './src/index.ts';
    export {QamousRuntime,QamousReadBudget,QamousPublicCache} from './src/index.ts';
    function beforeWordUpdate(db,before) {
      let fired=false;
      const wrap=(sql,statement)=>new Proxy(statement,{get(target,name) {
        if(name==='bind')return (...values)=>wrap(sql,target.bind(...values));
        if(['all','run','first'].includes(name))return async(...args)=>{
          if(!fired&&/^UPDATE words SET arabicWord=/i.test(sql.trim())) {fired=true;await before();}
          return target[name](...args);
        };
        const value=target[name];return typeof value==='function'?value.bind(target):value;
      }});
      return new Proxy(db,{get(target,name) {
        if(name==='prepare')return sql=>wrap(sql,target.prepare(sql));
        const value=target[name];return typeof value==='function'?value.bind(target):value;
      }});
    }
    export default {async fetch(request,env,ctx) {
      if(request.headers.get('x-local-test-rename-race')!=='1')return app.fetch(request,env,ctx);
      let winnerStatus=0,warmed=[];
      const db=beforeWordUpdate(env.DB,async()=>{
        const winner=await app.fetch(new Request(new URL('/word/1',request.url),{
          method:'PATCH',headers:{Origin:'https://qamous.org','Content-Type':'application/json',Cookie:request.headers.get('cookie')||''},
          body:JSON.stringify({arabicWord:'يلا'})
        }),env,ctx);
        winnerStatus=winner.status;await winner.body?.cancel();
        const alias=await app.fetch(new Request(new URL('/seo/word/2',request.url)),env,ctx);
        if(alias.status!==200)throw Error('The intermediate alias did not warm');
        warmed=(await alias.json()).rows.map(row=>row.id);
      });
      const response=await app.fetch(request,{...env,DB:db},ctx);
      const headers=new Headers(response.headers);
      headers.set('x-local-test-winner-status',String(winnerStatus));
      headers.set('x-local-test-warmed-definitions',warmed.join(','));
      return new Response(response.body,{status:response.status,headers});
    }};
  `;
  const bundled=await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,write:false,
    format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,
    ratelimits:{PUBLIC_READ_RATE_LIMIT:{namespace_id:'20261023',simple:{limit:120,period:60}}},
    compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    durableObjects:{RUNTIME:{className:'QamousRuntime',useSQLite:true},READ_BUDGET:{className:'QamousReadBudget',useSQLite:true},PUBLIC_CACHE:{className:'QamousPublicCache',useSQLite:true}},
    bindings:{SESS_SECRET:'rename-test-session-secret',PASSWORD_PEPPER:'rename-test-password-pepper',RESET_SECRET:'rename-test-reset-secret',
      ALLOWED_ORIGINS:'https://qamous.org',APP_URL:'https://qamous.org',ENABLE_AI:'false',
      READ_BUDGET_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),READ_BUDGET_BOOTSTRAP_ROWS:'0'},
    outboundService:()=>{throw new Error('Rename race tests must not contact external services');}}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'))
      .split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  }
  const call=(path,{method='GET',cookie,data,race=false}={})=>mf.dispatchFetch('https://api.qamous.org'+path,{method,
    headers:{Origin:'https://qamous.org','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(race?{'x-local-test-rename-race':'1'}:{})},
    body:data===undefined?undefined:JSON.stringify(data)});
  const expected=async(response,status)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  const password='Synthetic-rename-test-password!';
  const user=await expected(await call('/users/register',{method:'POST',data:{username:'rename_race_test',firstName:'Rename',lastName:'Test',
    email:'rename-race@example.invalid',password,passwordConfirmation:password}}),201);
  const login=await call('/auth/login',{method:'POST',data:{username:'rename_race_test',password}});
  await expected(login,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  await db.batch([
    db.prepare("INSERT INTO countries VALUES ('EG','Egypt')"),
    db.prepare("INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES (1,?,'كلمة','kalima','2026-01-01'),(2,?,'يلا','yalla','2026-01-01')").bind(user.id,user.id),
    db.prepare("INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES (1,1,?,'EG','Meaning moved by the winning rename',0),(201,2,?,'EG','Existing Y meaning',0)").bind(user.id,user.id),
  ]);
  await expected(await call('/seo/word/1'),200);
  const before=await expected(await call('/seo/word/2'),200);
  assert.deepEqual(before.rows.map(row=>row.id),[201]);

  const outer=await call('/word/1',{method:'PATCH',cookie,data:{arabicWord:'زمرد'},race:true});
  const innerStatus=Number(outer.headers.get('x-local-test-winner-status'));
  assert.deepEqual([outer.status,innerStatus].sort((a,b)=>a-b),[200,409],await outer.clone().text());
  // A scoped write claim rejects B before its write; the optimistic SQL check
  // also defends runtimes where B committed before A acquired that protection.
  const innerWon=innerStatus===200,aliasIds=innerWon?[1,201]:[201];
  assert.equal(outer.headers.get('x-local-test-warmed-definitions'),aliasIds.join(','));
  if(outer.status===409) assert.match((await outer.json()).message,/changed while you were editing/);
  else await outer.body?.cancel();
  assert.equal((await db.prepare('SELECT arabicWord FROM words WHERE id=1').first()).arabicWord,innerWon?'يلا':'زمرد');
  const finalAlias=await expected(await call('/seo/word/2'),200);
  assert.deepEqual(finalAlias.rows.map(row=>row.id),aliasIds);
  assert.ok(finalAlias.rows.every(row=>row.canonicalWordId===(innerWon?1:2)));

  // Once the public allowance closes, the alias must still be the confirmed
  // winning group, served entirely from cache rather than repaired by D1.
  const bindings=await mf.getBindings(),budget=bindings.READ_BUDGET.getByName('qamous-d1-account-v1');
  await budget.reconcile({day:new Date().toISOString().slice(0,10),rowsRead:4_600_000,observedAt:new Date().toISOString()});
  const usage=await budget.status();
  assert.deepEqual((await expected(await call('/seo/word/2'),200)).rows,finalAlias.rows);
  const after=await budget.status();
  assert.equal(after.usage.measured,usage.usage.measured);
  assert.equal(after.routes.reduce((sum,row)=>sum+row.queries,0),usage.routes.reduce((sum,row)=>sum+row.queries,0));
});
