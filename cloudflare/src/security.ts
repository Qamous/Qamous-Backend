import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { ApiError, type UserRow } from './data';

export type AppBindings=Env & { LEGACY_PEPPER:string; PASSWORD_PEPPER:string; SESS_SECRET:string; RESET_SECRET:string; EMAIL_USERNAME:string; EMAIL_PASSWORD:string };
export type AppContext={Bindings:AppBindings;Variables:{user:UserRow|null;sessionKey:string|null}};
export const COOKIE='qamous_session';
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
  const result=await c.env.DB.prepare('SELECT data,expires FROM sessions WHERE session_id=? AND expires>?').bind(key,Math.floor(Date.now()/1000)).first<{data:string;expires:number}>();
  if(!result) return;
  const userId=JSON.parse(result.data).userId;
  const user=await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first<UserRow>();
  if(!user) return;
  c.set('user',user);c.set('sessionKey',key);
  if(result.expires-Math.floor(Date.now()/1000)<540) {
    await c.env.DB.prepare('UPDATE sessions SET expires=? WHERE session_id=?').bind(Math.floor(Date.now()/1000)+600,key).run();
    setSessionCookie(c,session);
  }
}
function setSessionCookie(c:Context<AppContext>,session:string) {
  const secure=new URL(c.req.url).protocol==='https:';
  setCookie(c,COOKIE,session,{httpOnly:true,secure,sameSite:'Lax',path:'/',maxAge:600});
}
export async function createSession(c:Context<AppContext>,userId:number) {
  if(!c.env.SESS_SECRET) throw new ApiError(503,'Authentication is not configured');
  const raw=token();const key=await digest(raw+c.env.SESS_SECRET);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Math.floor(Date.now()/1000)),
    c.env.DB.prepare('INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)').bind(key,Math.floor(Date.now()/1000)+600,JSON.stringify({userId})),
  ]);
  setSessionCookie(c,raw);
}
export async function logout(c:Context<AppContext>) {
  const key=c.get('sessionKey');
  if(key) await c.env.DB.prepare('DELETE FROM sessions WHERE session_id=?').bind(key).run();
  deleteCookie(c,COOKIE,{path:'/'});
}
export async function checkRate(c:Context<AppContext>,action:string,limit:number,seconds:number) {
  const ip=c.req.header('cf-connecting-ip')||'local';
  const scope=await digest(`${action}:${ip}`);
  const allowed=await runtime(c.env,`rate:${scope}`).allow(scope,limit,seconds);
  if(!allowed) {c.header('Retry-After',String(seconds));throw new ApiError(429,'Too many requests. Please try again later.');}
}
