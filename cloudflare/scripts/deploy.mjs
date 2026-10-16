import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyFreePlan } from './free-plan-guard.mjs';
await verifyFreePlan();
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const result=spawnSync(process.execPath,[cli,'deploy',...process.argv.slice(2)],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'39292a971f28b413619657e9f2c77003'}});
process.exitCode=result.status??1;
