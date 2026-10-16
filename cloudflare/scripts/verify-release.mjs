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
await inspect('/',200,html=>assert.ok(html.includes('id="root"')));
await inspect('/word/2',200,html=>assert.ok(html.includes('id="root"')));
await inspect('/api/auth/health',200,data=>assert.equal(data.status,'OK'));
await inspect('/api/auth/session',200,data=>assert.equal(data.authenticated,false));
for(const [path,count] of [['/api/users',21],['/api/countries',17],['/api/word/search/all',60],['/api/definitions',105],['/api/posts',6]]) await inspect(path,200,data=>assert.equal(data.length,count));
for(const origin of ['https://qamous.org','https://not-qamous.example']) {
  const response=await fetch('https://qamous.org/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'nonexistent-release-probe',password:'not-a-real-user-password'}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,origin==='https://qamous.org'?401:403);
  checks.push({check:origin==='https://qamous.org'?'same-origin gateway authentication':'unapproved origin rejected',status:response.status,passed:true});
}
const api=await fetch('https://api.qamous.org/auth/health',{signal:AbortSignal.timeout(30000)});
assert.equal(api.status,200);assert.equal((await api.json()).status,'OK');
checks.push({check:'direct API HTTPS',passed:true});
const redirect=await fetch('https://www.qamous.org/word/2?test=retained',{redirect:'manual',signal:AbortSignal.timeout(30000)});
assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'https://qamous.org/word/2?test=retained');
checks.push({check:'www preserves path and query',passed:true});
const report={verifiedAt:new Date().toISOString(),frontendVersion:'f226bb0b-e6d8-49d7-b4af-4915af152f2f',apiVersion:'84573ac1-4463-4b45-88f2-286223f3e81b',checks};
await writeFile('private/release-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
