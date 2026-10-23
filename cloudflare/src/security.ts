import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { ApiError, type UserRow, type Row } from './data';

export type AppBindings=Env & { LEGACY_PEPPER:string; PASSWORD_PEPPER:string; SESS_SECRET:string; RESET_SECRET:string; EMAIL_USERNAME:string; EMAIL_PASSWORD:string; TURNSTILE_SECRET:string; SEO_INTERNAL_SECRET?:string };
export type AppContext={Bindings:AppBindings;Variables:{user:UserRow|null;sessionKey:string|null;publicMutationData?:Row}};
export const COOKIE='qamous_session';
export const SESSION_TTL_SECONDS=30*24*60*60;
// Renew at most once a day per session instead of writing on every API request.
const SESSION_RENEWAL_INTERVAL_SECONDS=24*60*60;
export const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function runtime(env:AppBindings, atom='daily-budgets') {return env.RUNTIME.getByName(`qamous-v1:${atom}`);}
export async function loadSession(c:Context<AppContext>) {
  c.set('user',null);c.set('sessionKey',null);
  const session=getCookie(c,COOKIE);
  if(!session||!c.env.SESS_SECRET) return;
  const key=await digest(session+c.env.SESS_SECRET);
  const now=Math.floor(Date.now()/1000);
  const result=await c.env.DB.prepare('SELECT data,expires FROM sessions WHERE session_id=? AND expires>?').bind(key,now).first<{data:string;expires:number}>();
  if(!result) return;
  const userId=JSON.parse(result.data).userId;
  const user=await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first<UserRow>();
  if(!user||user.accountKind==='import') return;
  c.set('user',user);c.set('sessionKey',key);
  if(result.expires-now<=SESSION_TTL_SECONDS-SESSION_RENEWAL_INTERVAL_SECONDS) {
    await c.env.DB.prepare('/* qamous-read:256 */ UPDATE sessions SET expires=MAX(expires,?) WHERE session_id=? AND expires>?').bind(now+SESSION_TTL_SECONDS,key,now).run();
    setSessionCookie(c,session);
  }
}
function setSessionCookie(c:Context<AppContext>,session:string) {
  const secure=new URL(c.req.url).protocol==='https:';
  setCookie(c,COOKIE,session,{httpOnly:true,secure,sameSite:'Lax',path:'/',maxAge:SESSION_TTL_SECONDS});
}
export async function createSession(c:Context<AppContext>,userId:number) {
  if(!c.env.SESS_SECRET) throw new ApiError(503,'Authentication is not configured');
  const raw=token();const key=await digest(raw+c.env.SESS_SECRET);
  const now=Math.floor(Date.now()/1000);
  await c.env.DB.batch([
    // session_expiry indexes the bounded cleanup. A login must never scan and
    // delete an unbounded historical session table just to create one session.
    c.env.DB.prepare('/* qamous-read:2000 */ DELETE FROM sessions WHERE session_id IN (SELECT session_id FROM sessions WHERE expires<? ORDER BY expires LIMIT 100)').bind(now),
    c.env.DB.prepare('/* qamous-read:128 */ INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)').bind(key,now+SESSION_TTL_SECONDS,JSON.stringify({userId})),
  ]);
  setSessionCookie(c,raw);
}
export async function logout(c:Context<AppContext>) {
  const key=c.get('sessionKey');
  if(key) await c.env.DB.prepare('/* qamous-read:128 */ DELETE FROM sessions WHERE session_id=?').bind(key).run();
  deleteCookie(c,COOKIE,{path:'/'});
}
export async function checkRate(c:Context<AppContext>,action:string,limit:number,seconds:number) {
  const ip=c.req.header('cf-connecting-ip')||'local';
  const scope=await digest(`${action}:${ip}`);
  const allowed=await runtime(c.env,`rate:${scope}`).allow(scope,limit,seconds);
  if(!allowed) {c.header('Retry-After',String(seconds));throw new ApiError(429,'Too many requests. Please try again later.');}
}

// The existing public-read binding also filters dynamic writes before session
// loading. It is an abuse filter, not a global quota or an identity check.
export async function checkPublicReadRate(c:Context<AppContext>) {
  const key=await digest('read-api:'+(c.req.header('cf-connecting-ip')||'local'));
  let allowed:boolean;
  try {allowed=(await c.env.PUBLIC_READ_RATE_LIMIT.limit({key})).success;}
  catch {c.header('Retry-After','60');throw new ApiError(503,'The dictionary is temporarily busy. Please try again shortly.');}
  if(!allowed) {c.header('Retry-After','60');throw new ApiError(429,'Too many requests. Please try again later.');}
}
