import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ACCOUNT_ID='39292a971f28b413619657e9f2c77003';
export function validateProof(proof, now=Date.now()) {
  if(proof.accountId!==ACCOUNT_ID||proof.plan!=='Workers Free'||proof.status!=='Active') throw new Error('Deployment refused: Workers Free must be Active in the approved account');
  if(proof.source!=='cloudflare_dashboard'||!proof.evidence?.includes('Workers Free Active')) throw new Error('Deployment refused: missing verified billing evidence');
  const age=now-Date.parse(proof.observedAt);
  if(!Number.isFinite(age)||age<0||age>2*60*60*1000) throw new Error('Deployment refused: billing verification must be refreshed (maximum age 2 hours)');
  return true;
}
export async function verifyFreePlan() {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
  if(config.account_id!==ACCOUNT_ID||config.name!=='qamous-api') throw new Error('Deployment refused: unexpected account or Worker');
  if(config.workers_dev!==false||config.preview_urls!==false) throw new Error('Deployment refused: public preview mirrors would bypass zone security');
  const blocked=['r2_buckets','vectorize','hyperdrive','containers','queues','workflows','pipelines','dispatch_namespaces'];
  if(blocked.some(k=>config[k])) throw new Error('Deployment refused: a paid or unapproved binding was found');
  if(config.triggers?.crons?.length) throw new Error('Deployment refused: unexpected background schedules');
  if(config.ai?.binding!=='AI'||config.durable_objects?.bindings?.[0]?.class_name!=='QamousRuntime') throw new Error('Deployment refused: unexpected bindings');
  if(config.d1_databases?.length!==1||config.d1_databases[0].database_id!=='d0587244-4f3d-4209-b246-55cefbce7555') throw new Error('Deployment refused: database is not the approved Qamous database');
  if(config.vars.AI_DAILY_LIMIT!=='50'||config.vars.EMAIL_DAILY_LIMIT!=='30') throw new Error('Deployment refused: quota caps changed');
  if(config.routes?.some(r=>r.pattern!=='api.qamous.org'||r.custom_domain!==true)) throw new Error('Deployment refused: unapproved API hostname');
  const proof=JSON.parse(await readFile(resolve(root,'private/billing-proof.json'),'utf8'));
  validateProof(proof);
  console.log(JSON.stringify({accountId:ACCOUNT_ID,workersPlan:'Free',verifiedAt:proof.observedAt,paidFallback:false}));
  return config;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await verifyFreePlan();
