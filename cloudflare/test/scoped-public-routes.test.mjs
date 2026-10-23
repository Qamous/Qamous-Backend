import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Full Hono middleware, dependency planning, real Durable Object RPC and local
// D1 metadata. Fixtures and writes are isolated inside this Miniflare instance.
test('scoped public mutations through authenticated API routes at 4.6m reads',async t=>{
  const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/index.ts',import.meta.url))],bundle:true,write:false,
    format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,
    ratelimits:{PUBLIC_READ_RATE_LIMIT:{namespace_id:'20261023',simple:{limit:120,period:60}}},
    compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    durableObjects:{RUNTIME:{className:'QamousRuntime',useSQLite:true},READ_BUDGET:{className:'QamousReadBudget',useSQLite:true},PUBLIC_CACHE:{className:'QamousPublicCache',useSQLite:true}},
    bindings:{SESS_SECRET:'scoped-test-session-secret',PASSWORD_PEPPER:'scoped-test-password-pepper',RESET_SECRET:'scoped-test-reset-secret',
      ALLOWED_ORIGINS:'https://qamous.org',APP_URL:'https://qamous.org',ENABLE_AI:'false',
      READ_BUDGET_BOOTSTRAP_DAY:new Date().toISOString().slice(0,10),READ_BUDGET_BOOTSTRAP_ROWS:'0'},
    outboundService:()=>{throw new Error('Scoped mutation tests must not contact external services');}}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'))
      .split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  }
  const call=(path,{method='GET',cookie,data}={})=>mf.dispatchFetch('https://api.qamous.org'+path,{method,
    headers:{Origin:'https://qamous.org','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:data===undefined?undefined:JSON.stringify(data)});
  const expected=async(response,status)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  const password='Synthetic-scoped-route-test-password!';
  const user=await expected(await call('/users/register',{method:'POST',data:{username:'scoped_route_test',firstName:'Scoped',lastName:'Test',
    email:'scoped-route@example.invalid',password,passwordConfirmation:password}}),201);
  const login=await call('/auth/login',{method:'POST',data:{username:'scoped_route_test',password}});
  await expected(login,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  await db.batch([
    db.prepare("INSERT INTO countries VALUES ('EG','Egypt'),('LB','Lebanon')"),
    db.prepare("INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES (1,?,'كلمة','kalima','2026-01-01'),(2,?,'يلا','yalla','2026-01-01'),(1001,?,'كلمة','kalima-alias','2026-01-01')").bind(user.id,user.id,user.id),
    db.prepare("INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic) VALUES (1,1,?,'EG','Original meaning A',0),(201,2,?,'LB','Unrelated meaning B',0),(202,2,?,'LB','معنى عربي مستقل',1)").bind(user.id,user.id,user.id),
    db.prepare("INSERT INTO posts VALUES ('scoped-post',?,'Original post','Original content',100,0)").bind(String(user.id)),
  ]);
  const bindings=await mf.getBindings(),budget=bindings.READ_BUDGET.getByName('qamous-d1-account-v1');
  const revision=bindings.PUBLIC_CACHE.getByName('qamous-public:v1:revision');
  const charge=rowsRead=>budget.reconcile({day:new Date().toISOString().slice(0,10),rowsRead,observedAt:new Date().toISOString()});
  const submitted=status=>status.routes.reduce((sum,route)=>sum+Number(route.queries||0),0);
  const wordA=await expected(await call('/seo/word/1'),200),wordB=await expected(await call('/seo/word/2'),200);
  assert.equal(wordA.rows[0].definition,'Original meaning A');
  assert.deepEqual((await expected(await call('/seo/word/1001'),200)).rows,wordA.rows);
  assert.deepEqual(wordB.rows.map(row=>row.id),[201,202]);
  assert.equal(wordB.related.country.countryCode,'LB');
  await expected(await call('/posts'),200);
  const bKeys=['word:2','related:LB:franco','related:LB:ar','countries'];
  const initialB=await revision.snapshot(bKeys);
  const aKeys=['word:1','word:1001'],initialA=await revision.snapshot(aKeys);
  await charge(4_600_000);

  const assertBUnchanged=async()=>{
    const before=await budget.status(),response=await call('/seo/word/2');
    assert.deepEqual(await expected(response,200),wordB,'all meanings and unaffected discovery remain identical');
    const after=await budget.status();
    assert.equal(submitted(after),submitted(before),'unrelated word B executes no D1 after public allowance closes');
    assert.equal(after.usage.measured,before.usage.measured);
    const current=await revision.snapshot(bKeys);
    assert.deepEqual(current.versions,initialB.versions);
    assert.ok(current.pending.every(value=>!value));
  };
  await t.test('authenticated definition edit changes only A and preserves B without D1',async()=>{
    await expected(await call('/definitions/1',{method:'PATCH',cookie,data:{definition:'Edited meaning A'}}),200);
    assert.equal((await db.prepare('SELECT definition FROM definitions WHERE id=1').first()).definition,'Edited meaning A');
    await assertBUnchanged();
    const currentA=await revision.snapshot(aKeys);
    assert.ok(currentA.versions.every((version,index)=>version>initialA.versions[index]),'every canonical alias is invalidated');
    for(const wordId of [1,1001]) {
      const response=await call('/seo/word/'+wordId);
      assert.ok([200,503].includes(response.status),await response.clone().text());
      if(response.status===200) {
        const body=await response.json();
        assert.equal(body.rows.find(row=>row.id===1).definition,'Edited meaning A');
        assert.ok(!JSON.stringify(body.rows).includes('Original meaning A'));
      } else {
        assert.ok(Number(response.headers.get('retry-after'))>0);
        assert.equal((await response.json()).code,'D1_READ_BUDGET');
      }
    }
  });
  await t.test('authenticated deletion never serves removed A and keeps B available',async()=>{
    await expected(await call('/definitions/1',{method:'DELETE',cookie}),200);
    assert.equal(await db.prepare('SELECT id FROM definitions WHERE id=1').first(),null);
    for(const wordId of [1,1001]) {
      const response=await call('/seo/word/'+wordId);
      assert.ok([404,503].includes(response.status),await response.clone().text());
      assert.ok(!(await response.text()).includes('Edited meaning A'));
    }
    await assertBUnchanged();
  });
  await t.test('publishing a blog post does not invalidate unrelated word or country caches',async()=>{
    const post=await expected(await call('/posts',{method:'POST',cookie,data:{title:'New scoped post',content:'New post content'}}),201);
    assert.equal((await db.prepare('SELECT content FROM posts WHERE id=?').bind(post.id).first()).content,'New post content');
    await assertBUnchanged();
  });
  await t.test('denied authenticated writes preserve existing versions and cached public browsing',async()=>{
    await charge(4_900_000);
    const before=await revision.snapshot(bKeys),usage=await budget.status();
    const response=await call('/definitions/201',{method:'PATCH',cookie,data:{definition:'Must not be written'}});
    assert.equal(response.status,503,await response.clone().text());
    assert.ok(Number(response.headers.get('retry-after'))>0);
    const after=await revision.snapshot(bKeys);
    assert.equal(after.revision,before.revision);
    assert.deepEqual(after.versions,before.versions);
    assert.deepEqual(after.pending,before.pending);
    assert.equal(submitted(await budget.status()),submitted(usage));
    await assertBUnchanged();
  });
});
