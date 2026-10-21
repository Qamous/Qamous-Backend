import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRagTurnstile} from '../src/turnstile.ts';

const siteverify=(payload,status=200)=>async (_url,options)=>{
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('secret'),'secret');
  assert.equal(options.body.get('response'),'token');
  assert.equal(options.body.get('remoteip'),'192.0.2.1');
  return Response.json(payload,{status});
};

test('requires a token and configured secret before calling Siteverify',async()=>{
  const unexpected=()=>{throw new Error('Siteverify must not run');};
  await assert.rejects(verifyRagTurnstile('', 'secret','qamous.org',undefined,unexpected),{status:403});
  await assert.rejects(verifyRagTurnstile('token','','qamous.org',undefined,unexpected),{status:503});
});
test('accepts only a successful rag token for the configured hostname',async()=>{
  await verifyRagTurnstile('token','secret','qamous.org','192.0.2.1',siteverify({success:true,action:'rag',hostname:'qamous.org'}));
  for(const payload of [
    {success:false,action:'rag',hostname:'qamous.org'},
    {success:true,action:'login',hostname:'qamous.org'},
    {success:true,action:'rag',hostname:'other.example'},
  ]) await assert.rejects(verifyRagTurnstile('token','secret','qamous.org','192.0.2.1',siteverify(payload)),{status:403});
});
test('fails closed if Siteverify is unavailable',async()=>{
  await assert.rejects(verifyRagTurnstile('token','secret','qamous.org','192.0.2.1',siteverify({},502)),{status:503});
});
