import test from 'node:test';
import assert from 'node:assert/strict';
import {importDeploymentArgs,verifyImportDeploymentFlags,pausedImportConfiguration} from '../scripts/import-deploy-variables.mjs';
test('importer deploy preserves job variables but explicitly changes reviewed pause/readmodel flags',()=>{
  for(const paused of ['true','false']) {
    const vars={PUBLIC_READ_ONLY:paused,PUBLIC_CARD_PAYLOADS:'true',IMPORT_JOB_HASH:'private-job-identity'};
    const args=importDeploymentArgs('reviewed.jsonc',vars);
    assert.deepEqual(args,['deploy','--config','reviewed.jsonc','--keep-vars','--var','PUBLIC_READ_ONLY:'+paused,'--var','PUBLIC_CARD_PAYLOADS:true']);
    assert.ok(!args.includes(vars.IMPORT_JOB_HASH));
    assert.doesNotThrow(()=>verifyImportDeploymentFlags({bindings:[{name:'PUBLIC_READ_ONLY',text:paused},{name:'PUBLIC_CARD_PAYLOADS',text:'true'}]},vars));
    assert.throws(()=>verifyImportDeploymentFlags({bindings:[{name:'PUBLIC_READ_ONLY',text:paused==='true'?'false':'true'},{name:'PUBLIC_CARD_PAYLOADS',text:'true'}]},vars));
  }
  assert.throws(()=>importDeploymentArgs('reviewed.jsonc',{PUBLIC_READ_ONLY:'false'}));
});

test('the explicit recovery deployment only pauses imports and preserves every resource identity',()=>{
  const source={name:'qamous-import',main:'src/import-host.mjs',account_id:'approved',vars:{PUBLIC_READ_ONLY:'false',PUBLIC_CARD_PAYLOADS:'true',IMPORT_JOB_HASH:'unchanged'},triggers:{crons:['* * * * *']},durable_objects:{bindings:[{namespace_id:'unchanged'}]},d1_databases:[{database_id:'unchanged'}]};
  const paused=pausedImportConfiguration(source);
  assert.deepEqual(paused,{...source,vars:{...source.vars,PUBLIC_READ_ONLY:'true'},triggers:{crons:[]}});
  assert.equal(source.vars.PUBLIC_READ_ONLY,'false');assert.deepEqual(source.triggers.crons,['* * * * *']);
  assert.throws(()=>pausedImportConfiguration({...source,name:'unapproved'}));
  assert.throws(()=>pausedImportConfiguration({...source,main:'other.mjs'}));
});
