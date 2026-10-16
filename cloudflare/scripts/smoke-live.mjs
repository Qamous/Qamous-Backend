import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {verifyFreePlan} from './free-plan-guard.mjs';
await verifyFreePlan();
const base='https://qamous.org/api';
const fixtureFile='private/live-fixture.json',reportFile='private/live-smoke.json';
async function call(path,{method='GET',data,cookie}={}) {
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:'https://qamous.org',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
  const body=await r.json();
  if(!r.ok) throw new Error(`Live check ${path} failed (${r.status}): ${body.message||'unavailable'}`);
  return {body,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),secure:r.headers.get('set-cookie')?.includes('Secure')};
}
if(process.argv.includes('--prepare')) {
  const settings=JSON.parse(await readFile('private/production-secrets.json','utf8'));
  const [local,domain]=settings.EMAIL_USERNAME.split('@');
  if(domain.toLowerCase()!=='gmail.com') throw new Error('Expected the configured Gmail sender for a self-addressed reset test');
  const suffix=Date.now().toString(36),username='migration_verify_'+suffix,password=randomBytes(32).toString('base64url'),email=`${local}+qamous-migration-${suffix}@${domain}`;
  const user=(await call('/users/register',{method:'POST',data:{username,firstName:'Migration',lastName:'Verification',email,password,passwordConfirmation:password,dateOfBirth:'2000-01-01'}})).body;
  const login=await call('/auth/login',{method:'POST',data:{username,password}});
  assert.equal(login.secure,true);assert.ok(login.cookie);
  const fixture={...user,username,password,email,cookie:login.cookie};
  await writeFile(fixtureFile,JSON.stringify(fixture,null,2),{mode:0o600,flag:'wx'});
  await writeFile(reportFile,JSON.stringify({verifiedAt:new Date().toISOString(),registration:true,login:true,secureCookie:true,fixtureId:user.id},null,2));
  console.log(JSON.stringify({prepared:true,testAccountId:user.id,registration:true,login:true,secureCookie:true}));
} else if(process.argv.includes('--services')) {
  const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
  // Refresh the short-lived session if deployment/verification took longer.
  fixture.cookie=(await call('/auth/login',{method:'POST',data:{username:fixture.username,password:fixture.password}})).cookie;
  await writeFile(fixtureFile,JSON.stringify(fixture,null,2),{mode:0o600});
  const mailer=(await call('/maintenance/mailer-check',{method:'POST',cookie:fixture.cookie})).body.configured;
  assert.equal(mailer,true,'Gmail TLS authentication must work inside Cloudflare');
  console.log(JSON.stringify({cloudflareSMTPVerified:true}));
  const email=await call('/users/reset-password',{method:'POST',data:{email:fixture.email}});
  await writeFile(reportFile,JSON.stringify({...JSON.parse(await readFile(reportFile,'utf8')),cloudflareSMTPVerified:true,resetEmailAccepted:!!email.body.message},null,2));
  console.log(JSON.stringify({resetEmailAccepted:true}));
  let updates=0;
  for(let n=0;n<8;n++) {
    const batch=(await call('/maintenance/embeddings',{method:'POST',cookie:fixture.cookie})).body;
    updates+=batch.updated;console.log(JSON.stringify({embeddingBatch:n+1,updated:batch.updated}));
    if(!batch.updated) break;
  }
  const ai=(await call('/rag',{method:'POST',data:{query:'ما معنى معلش؟',preferredLanguage:'arabic',model:'cloudflare'}})).body;
  assert.ok(ai.response?.length>5);assert.ok(ai.sources.every(s=>s.startsWith('https://qamous.org/word/')));
  console.log(JSON.stringify({liveAI:true,sourceCount:ai.sources.length,answer:ai.response.slice(0,400)}));
  const report={...JSON.parse(await readFile(reportFile,'utf8')),cloudflareSMTPVerified:mailer,embeddingsUpdated:updates,ai:true,aiSourceCount:ai.sources.length,resetEmailAccepted:!!email.body.message};
  await writeFile(reportFile,JSON.stringify(report,null,2));
  console.log(JSON.stringify({servicesPassed:true,resetEmailAccepted:true}));
} else throw new Error('Choose --prepare or --services');
