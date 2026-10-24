import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLiveImportState,validateImportApiReady} from '../scripts/import-deploy-transition.mjs';
import {validateImportPause} from '../scripts/free-plan-guard.mjs';
const settings=flag=>({bindings:[{name:'PUBLIC_READ_ONLY',text:flag}]});

test('a paused live importer can transition to a separately validated active release',()=>{
  assert.equal(validateLiveImportState(settings('true'),{schedules:[]}),true);
  assert.equal(validateImportPause({vars:{PUBLIC_READ_ONLY:'false'},triggers:{crons:['* * * * *']}}),false);
  assert.doesNotThrow(()=>validateImportApiReady(settings('false')));
  assert.equal(validateLiveImportState(settings('false'),{schedules:[{cron:'* * * * *'}]}),false);
});
test('live schedule mismatch and unknown pause states cannot pass transition inspection',()=>{
  for(const [flag,schedules] of [['true',[{cron:'* * * * *'}]],['false',[]],['invalid',[]],[undefined,[]],['true',undefined],['false',[{cron:'*/5 * * * *'}]]])
    assert.throws(()=>validateLiveImportState(settings(flag),{schedules}));
});
test('ingestion cannot resume while the API remains paused or its state is unknown',()=>{
  for(const value of [settings('true'),settings(''),settings(undefined),{},undefined])
    assert.throws(()=>validateImportApiReady(value),/explicitly unpaused/);
});
