import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base=process.env.QAMOUS_TEST_URL || 'http://127.0.0.1:8794';
if(new URL(base).hostname!=='127.0.0.1') throw new Error('These synthetic fixtures are local only');
const stamp=Date.now().toString(36),username='contribute_'+stamp,password=randomUUID()+'-test';
let cookie='',ip=0;
async function call(path,method='GET',data,expected=200) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5182','CF-Connecting-IP':`198.18.42.${++ip}`,...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
  const body=await response.json();
  assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(body)}`);
  if(response.headers.getSetCookie().length) cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  return body;
}
await call('/contributions','POST',{},401);
const user=await call('/users/register','POST',{username,email:username+'@example.invalid',firstName:'Local',lastName:'Test',password,passwordConfirmation:password},201);
await call('/auth/login','POST',{username,password});
const input={requestId:randomUUID(),arabicWord:'اختبار مساهمة '+stamp,francoArabicWord:'contribution_'+stamp,arabicDefinition:'معنى عربي للاختبار المحلي',englishDefinition:'Local integration meaning',
  arabicExample:'ده مثال عربي.',francoExample:'Da methal franco.',arabicSpellings:['اختبار بديل '+stamp],francoSpellings:['alternate_'+stamp],countryCode:'LB'};
const first=await call('/contributions','POST',input,201);
const retry=await call('/contributions','POST',input,201);assert.deepEqual(retry,first);
await call('/contributions','POST',{...input,englishDefinition:'Changed payload'},409);
const rows=await call('/definitions/word/'+first.wordId);
assert.equal(rows.length,2);assert.ok(rows.every(row=>row.arabicExample===input.arabicExample&&row.example===input.francoExample));
assert.ok(rows.every(row=>row.francoSpellings.includes('alternate_'+stamp)&&!('submissionId' in row)));
assert.equal((await call('/users/'+user.id)).points,3);
assert.equal((await call('/word/suggestions?q=alternate_'+stamp))[0].id,first.wordId);
assert.equal((await call('/word/search/kwd=alternate_'+stamp)).length,2);
assert.equal((await call('/word/explore?examples=1&q=alternate_'+stamp)).results.length,2);
await call('/contributions','POST',{requestId:randomUUID(),wordId:first.wordId,englishDefinition:'An additional meaning'},201);
assert.equal((await call('/definitions/word/'+first.wordId)).length,3);
assert.equal((await call('/users/'+user.id)).points,4);
await writeFile(new URL('../private/contribution-local-fixture.json',import.meta.url),JSON.stringify({username,password,userId:user.id,wordId:first.wordId}));
console.log(JSON.stringify({passed:true,wordId:first.wordId,checks:['authenticated atomic save','both examples','searchable alternate spellings','retry idempotency','conflicting retry rejection','existing word meanings','exact contribution points'],testData:'isolated local D1'}));
