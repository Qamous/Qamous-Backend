import test from 'node:test';
import assert from 'node:assert/strict';
import {importDeploymentArgs,verifyImportDeploymentFlags} from '../scripts/import-deploy-variables.mjs';
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
