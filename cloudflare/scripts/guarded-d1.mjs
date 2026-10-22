// Administrative SQL must reserve in the same ledger BEFORE using Wrangler.
// This helper never prints the importer credential. Unknown/lost D1 responses
// keep their entire reservation; it cannot be used for unlimited migrations.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const args=process.argv.slice(2),allowed=new Set(['--file','--reserve']);
if(args.length!==4||args.some((value,index)=>index%2===0&&!allowed.has(value)))throw Error('Use --file <reviewed.sql> --reserve <maximum scanned rows, at most 250000>');
const options=Object.fromEntries([args.slice(0,2),args.slice(2,4)]),rows=Number(options['--reserve']);
if(!Number.isSafeInteger(rows)||rows<1||rows>250000||!options['--file'])throw Error('A reviewed SQL file and conservative read reservation (1..250000) are required');
const sqlFile=resolve(options['--file']),sql=await readFile(sqlFile,'utf8');
if(Buffer.byteLength(sql)>1_000_000)throw Error('Split large maintenance into reviewed bounded batches');
const root=fileURLToPath(new URL('..',import.meta.url)),cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const access=JSON.parse(await readFile(new URL('../private/cloud-import/access.json',import.meta.url),'utf8'));
if(access.url!=='https://qamous-import.anthonyyoussef01.workers.dev'||typeof access.adminToken!=='string'||access.adminToken.length<32)throw Error('Verified private importer access is required');
async function budget(path,body) {
  const response=await fetch(access.url+path,{method:'POST',headers:{Authorization:'Bearer '+access.adminToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Read-budget service unavailable: HTTP '+response.status);
  return response.json();
}
const id=randomUUID(),admission=await budget('/read-budget/reserve',{id,rows});
if(!admission.allowed)throw Error('D1 operation not submitted: '+admission.reason+'; retry in '+admission.retryAfter+' seconds');
const execution=spawnSync(process.execPath,[cli,'d1','execute','qamous','--remote','--file',sqlFile,'--json'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
let measured=null,written=0;
try {
  if(execution.status===0) {
    const result=JSON.parse(execution.stdout),parts=Array.isArray(result)?result:[];
    if(parts.length&&parts.every(part=>part.success===true&&Number.isSafeInteger(part.meta?.rows_read)&&part.meta.rows_read>=0&&Number.isSafeInteger(part.meta?.rows_written)&&part.meta.rows_written>=0)) {
      measured=parts.reduce((sum,part)=>sum+part.meta.rows_read,0);written=parts.reduce((sum,part)=>sum+part.meta.rows_written,0);
    }
  }
} catch { /* Unparseable output retains the full reservation. */ }
try {await budget('/read-budget/settle',{id,rowsRead:measured,rowsWritten:written});}
catch {console.error('Accounting acknowledgement unavailable; the full reservation remains charged.');}
console.log(JSON.stringify({submitted:true,reservation:id,reservedRows:rows,measuredRows:measured,rowsWritten:written,exitCode:execution.status,outputWithheld:true}));
if(execution.status!==0||measured===null) {console.error('Inspect the reviewed operation before retrying; a missing result may hide a committed write.');process.exitCode=1;}
