import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const checks=[];
async function inspect(path, expected, validate) {
  const response=await fetch('https://qamous.org'+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,expected,path);
  assert.equal(response.headers.get('server'),'cloudflare');
  assert.equal(response.headers.get('x-vercel-id'),null);
  const content=await response.text();
  const data=response.headers.get('content-type')?.includes('application/json')?JSON.parse(content):content;
  if(validate) validate(data,response);
  checks.push({path,status:response.status,server:'cloudflare',passed:true});
}
await inspect('/',200,(html,response)=>{assert.ok(html.includes('id="root"'));assert.ok(response.headers.get('strict-transport-security')?.includes('max-age=15552000'));});
await inspect('/word/2',200,html=>assert.ok(html.includes('id="root"')));
await inspect('/api/auth/health',200,data=>assert.equal(data.status,'OK'));
await inspect('/api/auth/session',200,data=>assert.equal(data.authenticated,false));
for(const [path,count] of [['/api/countries',17],['/api/posts',6]]) await inspect(path,200,data=>assert.equal(data.length,count));
for(const path of ['/api/users','/api/definitions','/api/word/search/all','/api/reactions/1/likes-dislikes']) await inspect(path,401);
await inspect('/robots.txt',200,text=>{assert.ok(text.includes('User-agent: GPTBot'));assert.ok(text.includes('Allow: /api/definitions/word/'));assert.ok(text.includes('Sitemap: https://qamous.org/sitemap.xml'));});
await inspect('/sitemap.xml',200,text=>{assert.ok(text.includes('<sitemapindex'));assert.ok(text.includes('https://qamous.org/sitemap-static.xml'));assert.ok(text.includes('https://qamous.org/sitemap-words-'));assert.ok(!text.includes('/login'));});
await inspect('/sitemap-static.xml',200,text=>{assert.ok(text.includes('https://qamous.org/browse/en'));assert.ok(text.includes('https://qamous.org/browse/ar'));});
await inspect('/login',200,(_text,response)=>assert.ok(response.headers.get('x-robots-tag')?.includes('noindex')));
await inspect('/word/2',200,(html,response)=>{assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));assert.ok(html.includes('rel="canonical" href="https://qamous.org/word/2"'));});
for(const origin of ['https://qamous.org','https://not-qamous.example']) {
  const response=await fetch('https://qamous.org/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'nonexistent-release-probe',password:'not-a-real-user-password'}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,origin==='https://qamous.org'?401:403);
  checks.push({check:origin==='https://qamous.org'?'same-origin gateway authentication':'unapproved origin rejected',status:response.status,passed:true});
}
const api=await fetch('https://api.qamous.org/auth/health',{signal:AbortSignal.timeout(30000)});
assert.equal(api.status,200);assert.equal((await api.json()).status,'OK');
assert.ok(api.headers.get('strict-transport-security')?.includes('max-age=15552000'));
checks.push({check:'direct API HTTPS',passed:true});
const redirect=await fetch('https://www.qamous.org/word/2?test=retained',{redirect:'manual',signal:AbortSignal.timeout(30000)});
assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'https://qamous.org/word/2?test=retained');
checks.push({check:'www preserves path and query',passed:true});
const report={verifiedAt:new Date().toISOString(),frontendVersion:process.env.QAMOUS_FRONTEND_VERSION||'record separately from deployment output',apiVersion:process.env.QAMOUS_API_VERSION||'record separately from deployment output',checks};
await writeFile('private/release-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
