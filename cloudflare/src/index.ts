import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import { ApiError, type Row, type UserRow, type DictionaryRow, text, positiveId, normalize, escapeLike, nowSql, publicUser, requireUser, rankedSql, personalJoinWord, withWord } from './data';
import { loadSession, createSession, logout, runtime, checkRate, digest, token, type AppContext } from './security';
import { countryCodes } from '../../src/utils/country-codes';
import { validateWriteRequest, requireJson } from './request-policy';
export { QamousRuntime } from './runtime';

const app=new Hono<AppContext>();
const withoutSearch=(row:Row)=>{const {searchText,...rest}=row;return rest;};
const changed={generatedMaps:[],raw:[],affected:1};
const deleted={raw:[],affected:1};
async function body(c:Context<AppContext>):Promise<Row> {
  requireJson(c.req.raw.headers);
  try {const v=await c.req.json();if(v&&typeof v==='object'&&!Array.isArray(v)) return v;}catch{}
  throw new ApiError(400,'Invalid JSON request body');
}
const owner=(c:Context<AppContext>,id:number)=>{const u=requireUser(c.get('user'));if(u.id!==id) throw new ApiError(403,'You can only change your own account');return u;};
function admin(c:Context<AppContext>) {
  const user=requireUser(c.get('user'));
  const ids=((c.env as typeof c.env & {ADMIN_USER_IDS?:string}).ADMIN_USER_IDS||'').split(',').map(Number);
  if(!ids.includes(user.id)) throw new ApiError(403,'Administrative access required');
  return user;
}
function password(value:unknown):string {
  if(typeof value!=='string'||value.length<8||value.length>200) throw new ApiError(400,'Password must have 8 to 200 characters');
  return value;
}
function email(value:unknown):string {
  const v=text(value,'email',254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ApiError(400,'Invalid email');
  return v;
}
function quotaMessage(error:Error) {return /limit|quota|resource|exceeded/i.test(error.message);}

app.use('*',async(c,next)=>{
  c.header('X-Content-Type-Options','nosniff');
  c.header('X-Frame-Options','DENY');
  c.header('Referrer-Policy','no-referrer');
  c.header('X-Robots-Tag','noindex, nofollow, noarchive');
  c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  c.header('Cache-Control','no-store');
  await next();
});
app.use('*',bodyLimit({maxSize:32768,onError:c=>c.json({message:'Request body is too large'},413)}));
app.use('*',cors({origin:(origin,c)=>c.env.ALLOWED_ORIGINS.split(',').includes(origin)?origin:undefined,credentials:true,allowMethods:['GET','POST','PATCH','DELETE','PUT','OPTIONS'],allowHeaders:['Content-Type','Authorization']}));
app.use('*',async(c,next)=>{
  validateWriteRequest(c.req.method,c.req.raw.headers,c.env.ALLOWED_ORIGINS.split(','));
  // Keep the deployed read API bounded per client, including workers.dev where
  // zone WAF rules do not run. This is not a claim of scraper-proof public data.
  if(['GET','HEAD'].includes(c.req.method)&&!['/','/auth/health','/robots.txt'].includes(c.req.path)) await checkRate(c,'read-api',120,60);
  await loadSession(c);await next();
});
app.onError((error,c)=>{
  if(error instanceof ApiError) return c.json({statusCode:error.status,message:error.message},error.status);
  if(/UNIQUE constraint failed/i.test(error.message)) return c.json({statusCode:409,message:'A record with those details already exists'},409);
  // Never log a database row, password, email credential, cookie or model payload.
  console.error(JSON.stringify({event:'api_error',path:new URL(c.req.url).pathname.replace(/(reset-password\/)[^/]+/g,'$1[redacted]'),kind:quotaMessage(error)?'quota':'internal'}));
  return c.json({statusCode:503,message:quotaMessage(error)?'The free service limit is temporarily unavailable. Please try again later.':'The service is temporarily unavailable. Please try again later.'},503);
});
app.get('/',c=>c.json({service:'Qamous',status:'OK'}));
app.get('/robots.txt',c=>c.text('User-agent: *\nDisallow: /\n'));
app.get('/auth/health',async c=>{await c.env.DB.prepare('SELECT 1').first();return c.json({status:'OK'});});
app.get('/auth/session',c=>{
  const user=c.get('user');
  return c.json({session:user?{passport:{user:publicUser(user,true)}}:{},sessionId:user?'authenticated':null,authenticated:!!user});
});
app.post('/auth/login',async c=>{
  await checkRate(c,'login',5,300);
  const data=await body(c);const username=text(data.username,'username',80);const pass=typeof data.password==='string'?data.password:'';
  if(!pass||pass.length>200) throw new ApiError(401,'Invalid credentials');
  const user=await c.env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').bind(username).first<UserRow>();
  if(!user?.password||!await runtime(c.env,`password:${user.id}`).verifyPassword(pass,user.password,user.passwordVersion)) throw new ApiError(401,'Invalid credentials');
  if(user.passwordVersion==='legacy') {
    const upgraded=await runtime(c.env,`password:${user.id}`).hashPassword(pass);
    await c.env.DB.prepare('UPDATE users SET password=?,passwordVersion=? WHERE id=? AND password=?').bind(upgraded,'v2',user.id,user.password).run();
  }
  await createSession(c,user.id);return c.json(publicUser(user,true));
});
app.post('/auth/logout',async c=>{await logout(c);return c.json({message:'Logged out successfully'});});

app.get('/users',async c=>{
  admin(c);
  const users=(await c.env.DB.prepare('SELECT * FROM users ORDER BY id').all<UserRow>()).results;
  return c.json(users.map(u=>publicUser(u)));
});
app.get('/users/me/points',c=>c.json({points:requireUser(c.get('user')).points}));
app.get('/users/:id/points',async c=>{
  const user=await c.env.DB.prepare('SELECT points FROM users WHERE id=?').bind(positiveId(c.req.param('id'))).first<{points:number}>();
  if(!user) throw new ApiError(404,'User not found');return c.json(user);
});
app.get('/users/:id',async c=>{
  const user=await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(positiveId(c.req.param('id'))).first<UserRow>();
  if(!user) throw new ApiError(404,'User not found');return c.json(publicUser(user,c.get('user')?.id===user.id));
});
app.post('/users/register',async c=>{
  await checkRate(c,'register',5,3600);const data=await body(c);
  const username=text(data.username,'username',40);
  if(!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)) throw new ApiError(400,'Invalid username');
  const firstName=text(data.firstName,'firstName',80),lastName=text(data.lastName,'lastName',80),mail=email(data.email),pass=password(data.password);
  if(pass!==data.passwordConfirmation) throw new ApiError(400,'Password confirmation does not match password');
  const dob=data.dateOfBirth?text(data.dateOfBirth,'dateOfBirth',40):null;
  if(dob&&(!Number.isFinite(Date.parse(dob))||Date.parse(dob)>Date.now())) throw new ApiError(400,'Invalid date of birth');
  const hashed=await runtime(c.env,`password:new:${crypto.randomUUID()}`).hashPassword(pass);
  const user=await c.env.DB.prepare('INSERT INTO users(firstName,lastName,email,username,password,dateOfBirth,createdAt,passwordVersion) VALUES(?,?,?,?,?,?,?,?) RETURNING *').bind(firstName,lastName,mail,username,hashed,dob,nowSql(),'v2').first<UserRow>();
  return c.json(publicUser(user!,true),201);
});
app.patch('/users/:id',async c=>{
  const id=positiveId(c.req.param('id'));const user=owner(c,id);const data=await body(c);
  await checkRate(c,'account-change',5,300);
  if(typeof data.oldPassword!=='string'||!await runtime(c.env,`password:${user.id}`).verifyPassword(data.oldPassword,user.password,user.passwordVersion)) throw new ApiError(400,'Old password is incorrect');
  const sets:string[]=[],values:(string|number|null)[]=[];
  for(const field of ['firstName','lastName','username','dateOfBirth'] as const) if(data[field]!==undefined) {sets.push(`"${field}"=?`);values.push(text(data[field],field,field==='dateOfBirth'?40:80));}
  if(data.email!==undefined){sets.push('email=?');values.push(email(data.email));}
  if(data.password) {
    const pass=password(data.password);if(pass!==data.passwordConfirmation) throw new ApiError(400,'Password confirmation does not match password');
    sets.push('password=?','passwordVersion=?');values.push(await runtime(c.env,`password:${user.id}`).hashPassword(pass),'v2');
  }
  if(!sets.length) throw new ApiError(400,'No changes provided');
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).bind(...values,id).run();
  if(data.password) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE json_extract(data,'$.userId')=?").bind(id).run();
    await createSession(c,id);
  }
  return c.json(changed);
});
app.delete('/users/:id',async c=>{
  const id=positiveId(c.req.param('id'));owner(c,id);
  if(id===7) throw new ApiError(403,'The contribution archive account cannot be deleted');
  const archive=await c.env.DB.prepare('SELECT id FROM users WHERE id=7').first();
  if(!archive) throw new ApiError(503,'Contribution archive account is unavailable');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE words SET userId=7 WHERE userId=?').bind(id),
    c.env.DB.prepare('UPDATE definitions SET userId=7 WHERE userId=?').bind(id),
    c.env.DB.prepare('UPDATE posts SET userId=? WHERE userId=?').bind('7',String(id)),
    c.env.DB.prepare("DELETE FROM sessions WHERE json_extract(data,'$.userId')=?").bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id),
  ]);
  await logout(c);return c.json(deleted);
});
app.post('/users/reset-password',async c=>{
  await checkRate(c,'password-reset',5,3600);const data=await body(c);const mail=email(data.email);
  const addressKey=await digest(mail);
  if(!await runtime(c.env,`rate:reset:${addressKey}`).allow('requests',3,3600)) throw new ApiError(429,'Please wait before requesting another password reset');
  const user=await c.env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').bind(mail).first<{id:number}>();
  if(user) {
    if(!c.env.RESET_SECRET) throw new ApiError(503,'Password reset is temporarily unavailable');
    const raw=token(),key=await digest(raw+c.env.RESET_SECRET);
    await c.env.DB.batch([c.env.DB.prepare('DELETE FROM password_resets WHERE user_id=? OR expires<?').bind(user.id,Math.floor(Date.now()/1000)),c.env.DB.prepare('INSERT INTO password_resets(token_hash,user_id,expires) VALUES(?,?,?)').bind(key,user.id,Math.floor(Date.now()/1000)+900)]);
    const result=await runtime(c.env).sendReset(mail,raw);
    if(!result.ok){await c.env.DB.prepare('DELETE FROM password_resets WHERE token_hash=?').bind(key).run();throw new ApiError(result.reason==='quota'?429:503,'Password reset email is temporarily unavailable. Please try again later.');}
  }
  return c.json({message:'If that email belongs to an account, a password-reset link has been sent.'});
});
app.post('/users/reset-password/:token',async c=>{
  await checkRate(c,'use-password-reset',10,3600);const data=await body(c);const pass=password(data.newPassword);
  const key=await digest(text(c.req.param('token'),'token',128)+c.env.RESET_SECRET);
  const now=Math.floor(Date.now()/1000);
  const reset=await c.env.DB.prepare('SELECT user_id FROM password_resets WHERE token_hash=? AND consumed=0 AND expires>?').bind(key,now).first<{user_id:number}>();
  if(!reset) throw new ApiError(400,'Invalid or expired token');
  const hashed=await runtime(c.env,`password:${reset.user_id}`).hashPassword(pass);
  const results=await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password=?,passwordVersion='v2' WHERE id=? AND EXISTS(SELECT 1 FROM password_resets WHERE token_hash=? AND consumed=0 AND expires>?)").bind(hashed,reset.user_id,key,now),
    c.env.DB.prepare('UPDATE password_resets SET consumed=1 WHERE token_hash=? AND consumed=0 AND expires>?').bind(key,now),
    c.env.DB.prepare("DELETE FROM sessions WHERE json_extract(data,'$.userId')=?").bind(reset.user_id),
  ]);
  if(!results[0].meta.changes) throw new ApiError(400,'Invalid or expired token');
  return c.json({message:'Password updated successfully'});
});

app.get('/countries',async c=>c.json((await c.env.DB.prepare('SELECT * FROM countries ORDER BY countryName').all()).results));
app.get('/countries/:code',async c=>{
  const row=await c.env.DB.prepare('SELECT * FROM countries WHERE countryCode=?').bind(c.req.param('code').toUpperCase()).first();
  if(!row) throw new ApiError(404,'Country not found');return c.json(row);
});
app.post('/countries',async c=>{admin(c);const data=await body(c);const row=await c.env.DB.prepare('INSERT INTO countries(countryCode,countryName) VALUES(?,?) RETURNING *').bind(text(data.countryCode,'countryCode',2).toUpperCase(),text(data.countryName,'countryName')).first();return c.json(row,201);});
app.patch('/countries/:code',async c=>{admin(c);const data=await body(c);await c.env.DB.prepare('UPDATE countries SET countryName=? WHERE countryCode=?').bind(text(data.countryName,'countryName'),c.req.param('code')).run();return c.json(changed);});
app.delete('/countries/:code',async c=>{admin(c);await c.env.DB.prepare('DELETE FROM countries WHERE countryCode=?').bind(c.req.param('code')).run();return c.json(deleted);});

app.get('/word/search/all',async c=>{admin(c);return c.json((await c.env.DB.prepare('SELECT id,userId,arabicWord,francoArabicWord,createdAt,reportCount FROM words ORDER BY id').all()).results);});
app.get('/word/search/:filter',async c=>{
  const filter=c.req.param('filter');const user=c.get('user')?.id||0;
  if(filter.startsWith('kwd=')) {
    const keyword=text(filter.slice(4),'keyword',200);
    const like='%'+escapeLike(normalize(keyword))+'%';
    return c.json((await c.env.DB.prepare(rankedSql("AND (w.searchText LIKE ? ESCAPE '\\' OR d.searchText LIKE ? ESCAPE '\\')")).bind(user,user,user,like,like).all()).results);
  }
  if(filter.startsWith('iso=')) {
    const code=filter.slice(4).toUpperCase();
    const rows=(await c.env.DB.prepare(rankedSql('AND d.countryCode=?')).bind(user,user,user,code).all()).results;
    return c.json(rows.map(r=>({...r,isLiked:!!r.isLiked,isDisliked:!!r.isDisliked,isReported:!!r.isReported})));
  }
  throw new ApiError(404,'Search route not found');
});
app.get('/word/:id',async c=>{
  const row=await c.env.DB.prepare('SELECT * FROM words WHERE id=?').bind(positiveId(c.req.param('id'))).first();
  if(!row) throw new ApiError(404,'Word not found');return c.json(withoutSearch(row));
});
app.post('/word',async c=>{
  const user=requireUser(c.get('user'));await checkRate(c,'add-word',30,3600);const data=await body(c);
  const arabic=text(data.arabicWord,'arabicWord'),franco=data.francoArabicWord?text(data.francoArabicWord,'francoArabicWord'):null;
  const existing=await c.env.DB.prepare('SELECT * FROM words WHERE arabicWord=? COLLATE NOCASE').bind(arabic).first();
  if(existing){if(!existing.francoArabicWord&&franco) await c.env.DB.prepare('UPDATE words SET francoArabicWord=?,searchText=? WHERE id=?').bind(franco,normalize(arabic+' '+franco),existing.id).run();return c.json(withoutSearch({...existing,francoArabicWord:existing.francoArabicWord||franco}));}
  const row=await c.env.DB.prepare('INSERT INTO words(userId,arabicWord,francoArabicWord,createdAt,searchText) VALUES(?,?,?,?,?) RETURNING *').bind(user.id,arabic,franco,nowSql(),normalize(arabic+' '+(franco||''))).first();
  return c.json(withoutSearch(row!),201);
});
app.patch('/word/:id',async c=>{
  const user=requireUser(c.get('user')),id=positiveId(c.req.param('id')),data=await body(c);
  const row=await c.env.DB.prepare('SELECT * FROM words WHERE id=?').bind(id).first();
  if(!row) throw new ApiError(404,'Word not found');if(row.userId!==user.id) throw new ApiError(403,'Unauthorized');
  const arabic=data.arabicWord===undefined?String(row.arabicWord):text(data.arabicWord,'arabicWord');
  const f=data.francoArabicWord??data.FrancoArabicWord;const franco=f===undefined?row.francoArabicWord:(f?text(f,'francoArabicWord'):null);
  await c.env.DB.prepare('UPDATE words SET arabicWord=?,francoArabicWord=?,searchText=? WHERE id=?').bind(arabic,franco,normalize(arabic+' '+(franco||'')),id).run();
  queueEmbedding(c);return c.json(changed);
});

app.get('/definitions/most-liked',async c=>{
  const user=c.get('user')?.id||0,page=Math.max(1,Math.min(10000,Number(c.req.query('page'))||1)),limit=Math.max(1,Math.min(50,Number(c.req.query('limit'))||10));
  if(!Number.isInteger(page)||!Number.isInteger(limit)) throw new ApiError(400,'Invalid pagination');
  return c.json((await c.env.DB.prepare(rankedSql('',true)).bind(user,user,user,limit,(page-1)*limit).all()).results);
});
app.get('/definitions/random-matching',async c=>{
  const word=await c.env.DB.prepare('SELECT wordId FROM definitions GROUP BY wordId HAVING SUM(isArabic=1)>0 AND SUM(isArabic=0)>0 ORDER BY random() LIMIT 1').first<{wordId:number}>();
  if(!word) return c.json([]);const user=c.get('user')?.id||0;
  return c.json((await c.env.DB.prepare(rankedSql('AND d.wordId=?')).bind(user,user,user,word.wordId).all()).results);
});
app.get('/definitions/user/:id',async c=>{const user=owner(c,positiveId(c.req.param('id'))).id;return c.json((await c.env.DB.prepare(personalJoinWord+' WHERE d.userId=? ORDER BY d.id').bind(user,user,user,user).all()).results.map(withWord));});
app.get('/definitions/word/:id',async c=>{const user=c.get('user')?.id||0;return c.json((await c.env.DB.prepare(personalJoinWord+' WHERE d.wordId=? AND (d.reportCount+w.reportCount)<5 ORDER BY d.id').bind(user,user,user,positiveId(c.req.param('id'))).all()).results.map(withWord));});
app.get('/definitions/:id/country',async c=>{
  const row=await c.env.DB.prepare('SELECT c.* FROM countries c JOIN definitions d ON d.countryCode=c.countryCode WHERE d.id=?').bind(positiveId(c.req.param('id'))).first();
  return c.json(row);
});
app.get('/definitions/:id',async c=>{
  const row=await c.env.DB.prepare('SELECT * FROM definitions WHERE id=?').bind(positiveId(c.req.param('id'))).first();
  if(!row) throw new ApiError(404,'Definition not found');return c.json(withoutSearch(row));
});
app.get('/definitions',async c=>{admin(c);return c.json((await c.env.DB.prepare('SELECT * FROM definitions ORDER BY id').all()).results.map(withoutSearch));});
app.post('/definitions',async c=>{
  const user=requireUser(c.get('user'));await checkRate(c,'add-definition',30,3600);const data=await body(c);
  const wordId=positiveId(String(data.wordId)),definition=text(data.definition,'definition',10000),example=data.example?text(data.example,'example',255):null;
  const isArabic=data.isArabic===true||data.isArabic===1?1:data.isArabic===false||data.isArabic===0?0:null;
  if(isArabic===null) throw new ApiError(400,'Invalid isArabic');
  if(!await c.env.DB.prepare('SELECT id FROM words WHERE id=?').bind(wordId).first()) throw new ApiError(404,'Word not found');
  const countryName=text(data.countryName||'Unknown','countryName');
  let country=await c.env.DB.prepare('SELECT * FROM countries WHERE countryName=? COLLATE NOCASE').bind(countryName).first<{countryCode:string}>();
  if(!country){const code=countryCodes[countryName]||'XX';await c.env.DB.prepare('INSERT OR IGNORE INTO countries(countryCode,countryName) VALUES(?,?)').bind(code,countryName).run();country={countryCode:code};}
  const results=await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET points=points+1+CASE WHEN EXISTS(SELECT 1 FROM definitions WHERE wordId=?) THEN 0 ELSE 1 END WHERE id=?').bind(wordId,user.id),
    c.env.DB.prepare('INSERT INTO definitions(wordId,userId,countryCode,definition,example,isArabic,searchText) VALUES(?,?,?,?,?,?,?) RETURNING *').bind(wordId,user.id,country.countryCode,definition,example,isArabic,normalize(definition)),
  ]);
  queueEmbedding(c);return c.json(withoutSearch(results[1].results[0] as Row),201);
});
app.patch('/definitions/:id',async c=>{
  const user=requireUser(c.get('user')),id=positiveId(c.req.param('id')),data=await body(c);
  const row=await c.env.DB.prepare('SELECT * FROM definitions WHERE id=?').bind(id).first();
  if(!row) throw new ApiError(404,'Definition not found');if(row.userId!==user.id) throw new ApiError(403,'Unauthorized');
  const definition=data.definition===undefined?String(row.definition):text(data.definition,'definition',10000),example=data.example===undefined?row.example:data.example?text(data.example,'example'):null;
  await c.env.DB.prepare('UPDATE definitions SET definition=?,example=?,searchText=? WHERE id=?').bind(definition,example,normalize(definition),id).run();queueEmbedding(c);return c.json(changed);
});
app.delete('/definitions/:id',async c=>{
  const user=requireUser(c.get('user')),id=positiveId(c.req.param('id'));
  const row=await c.env.DB.prepare('SELECT * FROM definitions WHERE id=?').bind(id).first();
  if(!row) throw new ApiError(404,'Definition not found');if(row.userId!==user.id) throw new ApiError(403,'Unauthorized');
  await c.env.DB.prepare('DELETE FROM definitions WHERE id=?').bind(id).run();queueEmbedding(c);return c.json(deleted);
});
function queueEmbedding(c:Context<AppContext>) {
  // Local tests must never call a remote AI binding or external paid provider.
  if(c.env.ENABLE_AI==='true') c.executionCtx.waitUntil(runtime(c.env).syncEmbeddings(1).catch(()=>({updated:0})));
}

app.post('/reactions/:id/:action',async c=>{
  const user=requireUser(c.get('user'));await checkRate(c,'react',60,60);
  const action=c.req.param('action');let target:number|null;
  if(action==='like') target=1;else if(action==='dislike') target=0;else if(action==='unlike'||action==='undislike') target=null;
  else if(action==='switch-reaction'){const data=await body(c);if(data.toReaction!=='like'&&data.toReaction!=='dislike') throw new ApiError(400,'Invalid reaction');target=data.toReaction==='like'?1:0;}
  else throw new ApiError(404,'Reaction route not found');
  const definitionId=positiveId(c.req.param('id'));
  const result=await runtime(c.env,`definition:${definitionId}`).react(user.id,definitionId,target,action);
  if('error' in result&&result.error) throw new ApiError(result.status as 400|403|404,result.error);
  return c.json(result);
});
app.get('/reactions/:id/:kind',async c=>{
  const id=positiveId(c.req.param('id')),kind=c.req.param('kind');
  if(kind==='likes-dislikes') {admin(c);return c.json((await c.env.DB.prepare('SELECT * FROM "definition-likes-dislikes" WHERE definitionId=? ORDER BY id').bind(id).all()).results);}
  if(kind==='likes'||kind==='dislikes'){const row=await c.env.DB.prepare(`SELECT ${kind==='likes'?'likeCount':'dislikeCount'} AS count FROM definitions WHERE id=?`).bind(id).first<{count:number}>();return c.json(row?.count||0);}
  throw new ApiError(404,'Reaction route not found');
});
app.delete('/reactions/:id/:kind/:userId',async c=>{
  const user=owner(c,positiveId(c.req.param('userId'))),kind=c.req.param('kind');
  if(!['likes','dislikes'].includes(kind)) throw new ApiError(404,'Reaction route not found');
  const definitionId=positiveId(c.req.param('id'));
  return c.json(await runtime(c.env,`definition:${definitionId}`).react(user.id,definitionId,null,kind==='likes'?'unlike':'undislike'));
});

for(const type of ['word','definition'] as const) {
  const base=`/${type}-reports`,table=`"${type}-reports"`,column=`${type}Id`,targetTable=type==='word'?'words':'definitions';
  app.post(base,async c=>{
    const user=requireUser(c.get('user'));await checkRate(c,'report',10,3600);const data=await body(c);const id=positiveId(String(data[column]));const report=text(data.reportText,'reportText',2000);
    const exists=await c.env.DB.prepare(`SELECT id FROM ${targetTable} WHERE id=?`).bind(id).first();if(!exists) throw new ApiError(404,'Content not found');
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${targetTable} SET reportCount=reportCount+1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM ${table} WHERE ${column}=? AND userId=?)`).bind(id,id,user.id),
      c.env.DB.prepare(`INSERT INTO ${table}(userId,${column},reportText) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE ${column}=? AND userId=?)`).bind(user.id,id,report,id,user.id),
    ]);
    return c.json(await c.env.DB.prepare(`SELECT * FROM ${table} WHERE ${column}=? AND userId=? ORDER BY id DESC LIMIT 1`).bind(id,user.id).first(),201);
  });
  app.get(base,async c=>{admin(c);return c.json((await c.env.DB.prepare(`SELECT * FROM ${table}`).all()).results);});
  app.get(`${base}/word/:id`,async c=>{admin(c);if(type!=='word') throw new ApiError(404,'Route not found');return c.json((await c.env.DB.prepare(`SELECT * FROM ${table} WHERE wordId=?`).bind(positiveId(c.req.param('id'))).all()).results);});
  app.get(`${base}/:id`,async c=>{admin(c);return c.json(await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(positiveId(c.req.param('id'))).first());});
  app.delete(`${base}/:id`,async c=>{admin(c);const id=positiveId(c.req.param('id'));await c.env.DB.batch([c.env.DB.prepare(`UPDATE ${targetTable} SET reportCount=MAX(0,reportCount-1) WHERE id=(SELECT ${column} FROM ${table} WHERE id=?)`).bind(id),c.env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id)]);return c.json(deleted);});
}

app.get('/posts',async c=>c.json((await c.env.DB.prepare('SELECT * FROM posts ORDER BY createdSeconds DESC,createdNanoseconds DESC').all<{id:string;userId:string;title:string;content:string;createdSeconds:number;createdNanoseconds:number}>()).results.map(p=>({id:p.id,userId:p.userId,title:p.title,content:p.content,createdAt:{seconds:p.createdSeconds,nanoseconds:p.createdNanoseconds}}))));
app.post('/posts',async c=>{
  const user=requireUser(c.get('user'));await checkRate(c,'post',5,3600);const data=await body(c);
  const title=text(data.title,'title',250),content=text(data.content,'content',20000),id=crypto.randomUUID(),ms=Date.now();
  await c.env.DB.prepare('INSERT INTO posts(id,userId,title,content,createdSeconds,createdNanoseconds) VALUES(?,?,?,?,?,?)').bind(id,String(user.id),title,content,Math.floor(ms/1000),(ms%1000)*1000000).run();
  return c.json({id,userId:String(user.id),title,content,createdAt:{seconds:Math.floor(ms/1000),nanoseconds:(ms%1000)*1000000}},201);
});
app.post('/rag',async c=>{
  await checkRate(c,'chatbot',5,60);const data=await body(c);const query=text(data.query,'query',2000);
  const language=data.preferredLanguage==='franco-arabic'?'franco-arabic':'arabic';
  const result=await runtime(c.env).rag(query,language);
  if('error' in result) throw new ApiError(result.status as 429|503,result.error!);
  return c.json(result);
});
app.post('/maintenance/embeddings',async c=>{admin(c);return c.json(await runtime(c.env).syncEmbeddings(10));});
app.post('/maintenance/mailer-check',async c=>{admin(c);const result=await runtime(c.env).verifyMailer();return c.json({configured:result.ok,diagnostic:result.ok?undefined:result});});
app.post('/users/recalculate-points',c=>{admin(c);throw new ApiError(409,'Historical points are preserved; bulk recalculation is disabled');});
app.post('/reactions/recalculate-all',c=>{admin(c);throw new ApiError(409,'Historical counters are preserved; bulk recalculation is disabled');});
app.notFound(c=>c.json({message:'Route not found'},404));
export default app;
