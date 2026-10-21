import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const ttl=30*24*60*60,day=24*60*60;
const now=()=>Math.floor(Date.now()/1000);
const hash=value=>createHash('sha256').update(value).digest('hex');

test('persistent login sessions in the local Workers/D1 runtime',async t=>{
  const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/index.ts',import.meta.url))],bundle:true,write:false,
    format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,
    compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    durableObjects:{RUNTIME:{className:'QamousRuntime',useSQLite:true}},
    bindings:{SESS_SECRET:'synthetic-session-secret',PASSWORD_PEPPER:'synthetic-password-pepper',RESET_SECRET:'synthetic-reset-secret',
      ALLOWED_ORIGINS:'https://qamous.org',APP_URL:'https://qamous.org',ENABLE_AI:'false'},
    outboundService:()=>{throw new Error('Session tests must not contact external services');}}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).split('\n').filter(line=>!line.trimStart().startsWith('--')).join(' '));
  }
  const password='Synthetic-session-test-password!';
  const call=(path,{method='GET',cookie,data}={})=>mf.dispatchFetch('https://api.qamous.org'+path,{method,
    headers:{Origin:'https://qamous.org','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:data===undefined?undefined:JSON.stringify(data)});
  const cookieOf=response=>response.headers.get('set-cookie')?.split(';')[0];
  const sessionRow=cookie=>db.prepare('SELECT * FROM sessions WHERE session_id=?').bind(hash(cookie.split('=')[1]+'synthetic-session-secret')).first();
  const expireAt=(cookie,expires)=>db.prepare('UPDATE sessions SET expires=? WHERE session_id=?').bind(expires,hash(cookie.split('=')[1]+'synthetic-session-secret')).run();
  const assertRenewed=async(response,cookie,before)=>{
    assert.equal(response.status,200);
    const header=response.headers.get('set-cookie');
    assert.match(header,/Max-Age=2592000/);
    for(const attribute of ['HttpOnly','Secure','SameSite=Lax','Path=/']) assert.ok(header.includes(attribute),attribute);
    assert.equal(cookieOf(response),cookie);
    const row=await sessionRow(cookie);
    assert.ok(row.expires>=before+ttl&&row.expires<=now()+ttl);
  };
  const registered=await call('/users/register',{method:'POST',data:{username:'session_test',firstName:'Session',lastName:'Test',
    email:'session@example.invalid',password,passwordConfirmation:password}});
  assert.equal(registered.status,201);
  const {id}=await registered.json();
  const login=async(pass=password)=>{
    const response=await call('/auth/login',{method:'POST',data:{username:'session_test',password:pass}});
    assert.equal(response.status,200);return response;
  };
  let cookie;

  await t.test('login gives matching 30-day server and secure browser expiry',async()=>{
    const before=now(),response=await login();cookie=cookieOf(response);
    assert.ok(cookie);
    await assertRenewed(response,cookie,before);
    assert.notEqual((await sessionRow(cookie)).session_id,cookie.split('=')[1]);
    assert.equal((await (await call('/auth/session',{cookie})).json()).authenticated,true);
  });
  await t.test('returning after the old 10-minute window stays authenticated without a renewal write',async()=>{
    const expires=now()+ttl-11*60;
    await expireAt(cookie,expires);
    const response=await call('/auth/session',{cookie});
    assert.equal((await response.json()).authenticated,true);
    assert.equal(response.headers.get('set-cookie'),null);
    assert.equal((await sessionRow(cookie)).expires,expires);
  });
  await t.test('daily activity renews both expiries and subsequent requests do not rewrite them',async()=>{
    await expireAt(cookie,now()+ttl-day-1);
    const before=now(),response=await call('/auth/session',{cookie});
    await assertRenewed(response,cookie,before);
    const expires=(await sessionRow(cookie)).expires;
    const next=await call('/auth/session',{cookie});
    assert.equal(next.headers.get('set-cookie'),null);
    assert.equal((await sessionRow(cookie)).expires,expires);
  });
  await t.test('an unexpired old 10-minute session upgrades on its next request',async()=>{
    await expireAt(cookie,now()+600);
    const before=now(),response=await call('/auth/session',{cookie});
    assert.equal((await response.clone().json()).authenticated,true);
    await assertRenewed(response,cookie,before);
  });
  await t.test('expired sessions cannot be revived',async()=>{
    await expireAt(cookie,0);
    const response=await call('/auth/session',{cookie});
    assert.equal((await response.json()).authenticated,false);
    assert.equal(response.headers.get('set-cookie'),null);
    assert.equal((await sessionRow(cookie)).expires,0);
  });
  await t.test('logout deletes the session and clears the persistent cookie',async()=>{
    cookie=cookieOf(await login());
    const response=await call('/auth/logout',{method:'POST',cookie});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal(await sessionRow(cookie),null);
    assert.equal((await (await call('/auth/session',{cookie})).json()).authenticated,false);
  });
  await t.test('changing a password revokes other sessions and creates a persistent replacement',async()=>{
    cookie=cookieOf(await login());
    const other=cookieOf(await login()),before=now();
    const response=await call('/users/'+id,{method:'PATCH',cookie,data:{oldPassword:password,password:password+'changed',passwordConfirmation:password+'changed'}});
    const replacement=cookieOf(response);
    await assertRenewed(response,replacement,before);
    for(const old of [cookie,other]) assert.equal((await (await call('/auth/session',{cookie:old})).json()).authenticated,false);
    cookie=replacement;
  });
  await t.test('password reset still revokes persistent sessions',async()=>{
    const raw=randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO password_resets(token_hash,user_id,expires) VALUES(?,?,?)').bind(hash(raw+'synthetic-reset-secret'),id,now()+900).run();
    const response=await call('/users/reset-password/'+raw,{method:'POST',data:{newPassword:password+'reset'}});
    assert.equal(response.status,200);
    assert.equal((await (await call('/auth/session',{cookie})).json()).authenticated,false);
  });
});
