import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWriteRequest,requireJson} from '../src/request-policy.ts';
const allowed=['https://qamous.org'];
test('cookie writes reject missing, null and cross-site origins',()=>{
  for(const values of [{cookie:'qamous_session=test'},{cookie:'x=1; qamous_session=test',referer:'https://qamous.org.evil.invalid/'},{origin:'null'},{origin:'https://evil.invalid'},{origin:'https://qamous.org','sec-fetch-site':'cross-site'}]) {
    assert.throws(()=>validateWriteRequest('POST',new Headers(values),allowed),{status:403});
  }
  for(const values of [{origin:'https://qamous.org'},{cookie:'qamous_session=test',referer:'https://qamous.org/profile'}]) assert.doesNotThrow(()=>validateWriteRequest('PATCH',new Headers(values),allowed));
  assert.doesNotThrow(()=>validateWriteRequest('GET',new Headers(),allowed));
});
test('JSON endpoints cannot be invoked as simple cross-site form requests',()=>{
  for(const type of ['text/plain','application/x-www-form-urlencoded','multipart/form-data','']) assert.throws(()=>requireJson(new Headers({'content-type':type})),{status:415});
  assert.doesNotThrow(()=>requireJson(new Headers({'content-type':'application/json; charset=utf-8'})));
});
