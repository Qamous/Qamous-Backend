import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyFreePlan } from './free-plan-guard.mjs';
import { verifyPublicSnapshotUnpause } from './public-snapshot-deploy-guard.mjs';
const config = await verifyFreePlan();
const args=process.argv.slice(2);
if(args.some(arg=>!['--dry-run','--restore-reads'].includes(arg))||new Set(args).size!==args.length) throw new Error('Deployment refused: configuration/account overrides are not allowed');
// This explicit transition only opens reads. The guarded frontend release must
// remove static authority before a normal deployment can enable mutations.
const bridge=args.includes('--restore-reads');
const effective=bridge?{...config,vars:{...config.vars,PUBLIC_READ_ONLY:'false',PUBLIC_WRITES_PAUSED:'true'}}:config;
await verifyPublicSnapshotUnpause(effective);
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const result=spawnSync(process.execPath,[cli,'deploy',...args.filter(arg=>arg==='--dry-run'),...(bridge?['--var','PUBLIC_READ_ONLY:false','--var','PUBLIC_WRITES_PAUSED:true']:[])],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'39292a971f28b413619657e9f2c77003'}});
process.exitCode=result.status??1;
