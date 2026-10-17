import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import bcrypt from 'bcryptjs';
import {sqlLiteral} from '../scripts/mysql-dump.mjs';

// This suite mutates only the local runtime, never a production database.
const base=process.env.QAMOUS_TEST_URL||'http://127.0.0.1:8787';
if(new URL(base).hostname!=='127.0.0.1') throw new Error('Integration fixtures are restricted to local development');
const stamp=Date.now().toString(36),pass='Synthetic-test-password-39!';
let ip=1;const runOctet=randomBytes(1)[0];
async function call(path,{method='GET',data,cookie,expected=200,testIp}={}) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':testIp||`198.18.${runOctet}.${ip++}`,Origin:'http://localhost:8788',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await response.json();
  assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(body)}`);
  return {body,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),headers:response.headers};
}
async function sql(command) {
  const file=new URL('../private/test-operation.sql',import.meta.url);
  await writeFile(file,command);
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','qamous','--local',...(process.env.QAMOUS_TEST_PERSIST_DIR?['--persist-to',process.env.QAMOUS_TEST_PERSIST_DIR]:[]),'--file',fileURLToPath(file),'--json'],{encoding:'utf8',windowsHide:true});
  if(result.status!==0) throw new Error('Local D1 fixture operation failed');
  return JSON.parse(result.stdout);
}
import {fileURLToPath} from 'node:url';
for(const path of ['/word/search/all','/definitions','/users','/reactions/1/likes-dislikes']) await call(path,{expected:401});
const counts=await sql('SELECT (SELECT COUNT(*) FROM words) AS words,(SELECT COUNT(*) FROM definitions) AS definitions;');
assert.equal(counts[0].results[0].words,60);assert.equal(counts[0].results[0].definitions,105);
assert.equal((await call('/countries')).body.length,17);
assert.equal((await call('/posts')).body.length,6);
const feed=(await call('/definitions/most-liked?page=1&limit=10')).body;assert.equal(feed.length,10);
assert.ok(feed.every(d=>d.wordId&&d.definitionId&&typeof d.isArabic==='number'));
const source=feed.find(w=>w.francoArabicWord);assert.ok(source);
assert.ok((await call('/word/search/kwd='+encodeURIComponent(source.francoArabicWord))).body.length>0);
assert.ok((await call('/word/search/kwd='+encodeURIComponent(source.arabicWord))).body.length>0);
assert.equal((await call('/auth/session')).body.authenticated,false);
await call('/word',{method:'POST',data:{arabicWord:'اختبار'},expected:401});
await call('/maintenance/embeddings',{method:'POST',expected:401});
const users=[];
for(const suffix of ['author','reader']) {
  const username=`migration_${suffix}_${stamp}`;
  const created=(await call('/users/register',{method:'POST',data:{username,firstName:'Migration',lastName:'Test',email:`${username}@example.invalid`,password:pass,passwordConfirmation:pass,dateOfBirth:'2000-01-01'},expected:201})).body;
  assert.ok(!('password' in created));
  const login=await call('/auth/login',{method:'POST',data:{username,password:pass}});
  assert.ok(login.cookie.includes('qamous_session='));
  assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(login.headers.get('set-cookie').includes('SameSite=Lax'));
  users.push({...created,cookie:login.cookie,username});
}
const [author,reader]=users;
assert.equal(author.id,52);assert.equal(reader.id,53);
assert.equal((await call('/auth/session',{cookie:author.cookie})).body.session.passport.user.id,author.id);
const word=(await call('/word',{method:'POST',cookie:author.cookie,data:{arabicWord:'اختبار ترحيل '+stamp,francoArabicWord:'migration '+stamp},expected:201})).body;assert.equal(word.id,61);
const definition=(await call('/definitions',{method:'POST',cookie:author.cookie,data:{wordId:word.id,definition:'معنى تجريبي',example:'مثال',isArabic:true,countryName:'Egypt'},expected:201})).body;assert.equal(definition.id,106);
await call('/definitions/'+definition.id,{method:'PATCH',cookie:reader.cookie,data:{definition:'Unauthorized'},expected:403});
await call('/definitions/'+definition.id,{method:'PATCH',cookie:author.cookie,data:{definition:'معنى معدل'}});
assert.equal((await call('/definitions/'+definition.id)).body.definition,'معنى معدل');
await call(`/reactions/${definition.id}/like`,{method:'POST',cookie:author.cookie,expected:403});
await Promise.all(Array.from({length:12},()=>call(`/reactions/${definition.id}/like`,{method:'POST',cookie:reader.cookie})));
assert.equal((await call('/definitions/'+definition.id)).body.likeCount,1);
assert.equal((await sql(`SELECT COUNT(*) AS n FROM "definition-likes-dislikes" WHERE definitionId=${definition.id};`))[0].results[0].n,1);
assert.equal((await call('/users/me/points',{cookie:author.cookie})).body.points,3);
await call(`/reactions/${definition.id}/switch-reaction`,{method:'POST',cookie:reader.cookie,data:{toReaction:'dislike'}});
assert.equal((await call('/definitions/'+definition.id)).body.dislikeCount,1);
await call(`/reactions/${definition.id}/undislike`,{method:'POST',cookie:reader.cookie});
assert.equal((await call('/users/me/points',{cookie:author.cookie})).body.points,2);
await call('/definition-reports',{method:'POST',cookie:reader.cookie,data:{definitionId:definition.id,reportText:'Fixture'},expected:201});
await call('/definition-reports',{method:'POST',cookie:reader.cookie,data:{definitionId:definition.id,reportText:'Fixture'},expected:201});
assert.equal((await call('/definitions/'+definition.id)).body.reportCount,1);
const post=(await call('/posts',{method:'POST',cookie:author.cookie,data:{title:'Migration test',content:'**Markdown** test',userId:'7'},expected:201})).body;assert.equal(post.userId,String(author.id));
assert.equal((await call('/definitions/user/'+author.id,{cookie:author.cookie})).body[0].word.id,word.id);
assert.equal((await call('/definitions/user/'+author.id,{cookie:author.cookie})).body[0].isArabic,true);
await call('/definitions/user/'+author.id,{cookie:reader.cookie,expected:403});
const csrf=await fetch(base+'/auth/logout',{method:'POST',headers:{Origin:'https://malicious.invalid',Cookie:author.cookie}});assert.equal(csrf.status,403);
await call('/auth/logout',{method:'POST',cookie:reader.cookie});assert.equal((await call('/auth/session',{cookie:reader.cookie})).body.authenticated,false);
const secondSession=await call('/auth/login',{method:'POST',data:{username:author.username,password:pass}});
const passwordChange=await call('/users/'+author.id,{method:'PATCH',cookie:author.cookie,data:{oldPassword:pass,password:pass+'changed',passwordConfirmation:pass+'changed'}});
assert.equal((await call('/auth/session',{cookie:secondSession.cookie})).body.authenticated,false);
assert.equal((await call('/auth/session',{cookie:author.cookie})).body.authenticated,false);
assert.equal((await call('/auth/session',{cookie:passwordChange.cookie})).body.authenticated,true);
await call('/rag',{method:'POST',data:{query:'What is this?'},expected:503});
await call('/users/reset-password',{method:'POST',data:{email:author.email},expected:503});

// Verify the exact legacy salt + SHA3-512 + bcrypt pipeline without knowing any
// original user's password. The old credential is upgraded only after login.
const local=parseEnv(await readFile(new URL('../.dev.vars',import.meta.url),'utf8'));
const salt=randomBytes(16).toString('hex');
const hash=salt+await bcrypt.hash(createHash('sha3-512').update(pass+salt).digest('hex')+local.LEGACY_PEPPER,10);
const legacyName='legacy_'+stamp;
await sql(`INSERT INTO users(id,firstName,lastName,email,username,password,createdAt,passwordVersion) VALUES(100000,'Synthetic','Legacy','legacy@example.invalid',${sqlLiteral(legacyName)},${sqlLiteral(hash)},'2026-10-16','legacy');`);
const legacy=await call('/auth/login',{method:'POST',data:{username:legacyName,password:pass}});
assert.equal(legacy.body.id,100000);
let results=await sql('SELECT passwordVersion FROM users WHERE id=100000;');assert.equal(results[0].results[0].passwordVersion,'v2');
await call('/auth/login',{method:'POST',data:{username:legacyName,password:pass}});
const resetToken=randomBytes(32).toString('hex'),resetHash=createHash('sha256').update(resetToken+local.RESET_SECRET).digest('hex');
await sql(`INSERT INTO password_resets(token_hash,user_id,expires) VALUES(${sqlLiteral(resetHash)},100000,${Math.floor(Date.now()/1000)+900});`);
const resetPass=pass+'new';
await call('/users/reset-password/'+resetToken,{method:'POST',data:{newPassword:resetPass}});
await call('/users/reset-password/'+resetToken,{method:'POST',data:{newPassword:resetPass},expected:400});
assert.equal((await call('/auth/session',{cookie:legacy.cookie})).body.authenticated,false);
const renewed=await call('/auth/login',{method:'POST',data:{username:legacyName,password:resetPass}});
const session=(await call('/auth/session',{cookie:renewed.cookie})).body;
assert.equal(session.sessionId,'authenticated');
await sql("UPDATE sessions SET expires=0 WHERE json_extract(data,'$.userId')=100000;");
assert.equal((await call('/auth/session',{cookie:renewed.cookie})).body.authenticated,false);
for(let n=0;n<5;n++) await call('/auth/login',{method:'POST',testIp:'198.51.100.19',data:{username:'missing',password:'wrong'},expected:401});
await call('/auth/login',{method:'POST',testIp:'198.51.100.19',data:{username:'missing',password:'wrong'},expected:429});
const missingOrigin=await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:passwordChange.cookie}});assert.equal(missingOrigin.status,403);
const plain=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'text/plain',Origin:'http://localhost:8788','CF-Connecting-IP':'198.51.100.20'},body:JSON.stringify({username:'missing',password:'wrong'})});assert.equal(plain.status,415);
// Exercise the repaired accounting in the actual local Workers/D1 runtime.
const readerAgain=await call('/auth/login',{method:'POST',data:{username:reader.username,password:pass}});
const authorCookie=passwordChange.cookie,readerCookie=readerAgain.cookie;
const authorPoints=async()=>(await call('/users/me/points',{cookie:authorCookie})).body;
assert.deepEqual(await authorPoints(),{definitionPoints:1,wordBonusPoints:1,reactionPoints:0,points:2});
for(const [action,toReaction,delta,liked,disliked] of [
  ['like',null,1,true,false],['like',null,1,true,false],
  ['switch-reaction','dislike',-1,false,true],['unlike',null,-1,false,true],
  ['undislike',null,0,false,false],['dislike',null,-1,false,true],
  ['switch-reaction','like',1,true,false],['unlike',null,0,false,false],
]) {
  const result=(await call(`/reactions/${definition.id}/${action}`,{method:'POST',cookie:readerCookie,...(toReaction?{data:{toReaction}}:{})})).body;
  assert.equal(result.isLiked,liked);assert.equal(result.isDisliked,disliked);
  assert.equal(result.definitionId,definition.id);assert.equal((await authorPoints()).points,2+delta);
}
const extraWord=(await call('/word',{method:'POST',cookie:authorCookie,data:{arabicWord:'نقاط '+stamp},expected:201})).body;
for(let i=0;i<2;i++) {
  const extra=(await call('/definitions',{method:'POST',cookie:authorCookie,data:{wordId:extraWord.id,definition:'Local scoring regression',isArabic:true,countryName:'Egypt'},expected:201})).body;
  assert.equal((await authorPoints()).points,4);
  await call(`/reactions/${extra.id}/like`,{method:'POST',cookie:readerCookie});
  assert.equal((await authorPoints()).points,5);
  await call('/definitions/'+extra.id,{method:'DELETE',cookie:authorCookie});
  assert.equal((await authorPoints()).points,2);
}
await call(`/reactions/${definition.id}/like`,{method:'POST',cookie:readerCookie});
await call('/users/'+reader.id,{method:'DELETE',cookie:readerCookie});
assert.equal((await call('/definitions/'+definition.id)).body.likeCount,0);
assert.equal((await authorPoints()).points,2);
await call('/users/'+author.id,{method:'DELETE',cookie:authorCookie});
assert.equal((await call('/definitions/'+definition.id)).body.userId,7);
for(const result of await sql(await readFile(new URL('../scripts/audit-reactions.sql',import.meta.url),'utf8'))) {
  for(const row of result.results) assert.equal(row.violations,0);
}
for(let n=0;n<120;n++) await call('/countries',{testIp:'198.51.100.21'});
await call('/countries',{testIp:'198.51.100.21',expected:429});
console.log(JSON.stringify({passed:true,checks:['source counts','Arabic and Franco search','registration','legacy password upgrade','login/logout/expiry','single-use reset','ownership','contributions','concurrent idempotent reactions','canonical reaction responses','points breakdown','definition deletion accounting','voter deletion accounting','archive transfer accounting','create/delete bonus farming prevention','final zero-violation accounting audit','reports','blog author identity','CSRF','missing-origin rejection','JSON-only writes','password-change session revocation','bulk export denied','API read throttle','login throttle','AI unavailable','email unavailable'],testData:'local only'}));
