import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('runtime counters and waiting importer ticks cannot write past shared auxiliary admission',{timeout:30_000},async t=>{
  const entry=`import {QamousRuntime} from './src/runtime.ts';
    import {QamousImportState} from './src/import-host.mjs';
    import {IMPORT_MANIFEST,IMPORT_LEDGER_POLICY_VERSION} from './src/import-cloud-policy.mjs';
    import {READ_BUDGET_OBJECT} from './src/read-budget.ts';
    export {QamousReadBudget} from './src/read-budget-object.ts';
    export class TestRuntime extends QamousRuntime {
      rows(){return this.ctx.storage.sql.exec('SELECT scope,used FROM rate_limits ORDER BY scope').toArray();}
      tableCount(){return this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limits'").toArray().length;}
    }
    export class TestImport extends QamousImportState {
      async installWaiting() {
        if(!await this.initialize(true))throw Error('Test setup storage grant failed');
        const now=new Date(),day=now.toISOString().slice(0,10),tomorrow=new Date(Date.parse(day+'T00:00:00Z')+86400000+900000).toISOString();
        const state={jobHash:this.env.IMPORT_JOB_HASH,manifestHash:IMPORT_MANIFEST,cursor:0,packetCount:1,completedRecords:0,totalRecords:1,status:'waiting_for_free_quota',reason:'The dictionary is temporarily busy. Please try again shortly.',lastAttemptAt:now.toISOString(),nextAttemptAt:tomorrow,ledgerPolicyVersion:IMPORT_LEDGER_POLICY_VERSION,days:{[day]:{rowsWritten:0,rowsRead:0}}};
        await this.objects.put('jobs/'+this.env.IMPORT_JOB_HASH+'/checkpoint.json',JSON.stringify(state));
      }
    }
    export default {async fetch(request,env) {
      const budget=env.READ_BUDGET.getByName(READ_BUDGET_OBJECT),runtime=env.RUNTIME.getByName('test'),importer=env.COORDINATOR.getByName(env.IMPORT_JOB_HASH),path=new URL(request.url).pathname;
      if(path==='/runtime') {
        for(let n=0;n<5;n++)if(!await runtime.allow('login',5,300))throw Error('Unexpected local refusal');
        const before=(await budget.status()).auxiliaryWrites;
        for(let n=0;n<100;n++)if(await runtime.allow('login',5,300))throw Error('Per-action limit bypass');
        const after=(await budget.status()).auxiliaryWrites;
        for(let n=0;n<5;n++)if(!await budget.reserveAuxiliaryWrites(499,'runtime'))throw Error('Unexpected global fill refusal');
        if(!await budget.reserveAuxiliaryWrites(470,'runtime'))throw Error('Unexpected tail fill refusal');
        const capped=(await budget.status()).auxiliaryWrites;
        for(let n=0;n<100;n++)if(await runtime.allow('new-scope-'+n,1,60))throw Error('Shared runtime pool bypass');
        const fresh=env.RUNTIME.getByName('never-initialized');
        if(await fresh.allow('login',1,60))throw Error('Fresh runtime object bypassed shared cap');
        return Response.json({before,after,capped,final:(await budget.status()).auxiliaryWrites,rows:await runtime.rows(),freshTableCount:await fresh.tableCount()});
      }
      await importer.installWaiting();
      const before=(await budget.status()).auxiliaryWrites,first=await importer.status();
      for(let n=0;n<100;n++)await importer.tick('scheduled');
      return Response.json({before,after:(await budget.status()).auxiliaryWrites,first,final:await importer.status()});
    }};`;
  const bundled=await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','cloudflare:sockets']});
  const day=new Date().toISOString().slice(0,10);
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],durableObjects:{RUNTIME:{className:'TestRuntime',useSQLite:true},COORDINATOR:{className:'TestImport',useSQLite:true},READ_BUDGET:{className:'QamousReadBudget',useSQLite:true}},bindings:{IMPORT_JOB_HASH:'a'.repeat(64),READ_BUDGET_BOOTSTRAP_DAY:day,READ_BUDGET_BOOTSTRAP_ROWS:'0',AUXILIARY_WRITE_BOOTSTRAP_DAY:day,AUXILIARY_WRITE_BOOTSTRAP_ROWS:'0'},outboundService:()=>{throw Error('No external services');}}));
  t.after(()=>mf.dispose());
  const rateResponse=await mf.dispatchFetch('https://local/runtime');assert.equal(rateResponse.status,200,await rateResponse.clone().text());const rate=await rateResponse.json();
  assert.equal(rate.before.runtime,29,'cold table schema and its budget counter are included');assert.deepEqual(rate.after,rate.before);assert.equal(rate.capped.runtime,3000);assert.deepEqual(rate.final,rate.capped);assert.deepEqual(rate.rows,[{scope:'login',used:5}]);assert.equal(rate.freshTableCount,0,'fresh object creation cannot bypass admission through schema writes');
  const importResponse=await mf.dispatchFetch('https://local/import');assert.equal(importResponse.status,200,await importResponse.clone().text());const importer=await importResponse.json();
  assert.deepEqual(importer.after,importer.before);assert.deepEqual(importer.final,importer.first,'waiting cron performs no timestamp, checkpoint or cleanup writes');
});
