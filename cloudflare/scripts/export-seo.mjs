import {creditSql,groupSeoCredits} from './seo-provenance.mjs';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verifyFreePlan} from './free-plan-guard.mjs';
import {formatImportedDefinition} from '../src/definition-display.mjs';
await verifyFreePlan();
const root=fileURLToPath(new URL('..',import.meta.url));
// Only public names and short descriptions, never users, ownership or credentials.
const sql=`SELECT w.id,w.arabicWord,w.francoArabicWord,
 COALESCE((SELECT d.definition FROM public_definitions d WHERE d.wordId=w.id AND d.isArabic=0 AND (d.reportCount+w.reportCount)<5 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1),'') AS descriptionEn,
 COALESCE((SELECT d.definition FROM public_definitions d WHERE d.wordId=w.id AND d.isArabic=1 AND (d.reportCount+w.reportCount)<5 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1),'') AS descriptionAr
 FROM words w WHERE EXISTS(SELECT 1 FROM public_definitions d WHERE d.wordId=w.id AND (d.reportCount+w.reportCount)<5) ORDER BY w.id LIMIT 250;
 SELECT c.countryCode,c.countryName FROM countries c WHERE EXISTS(SELECT 1 FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.countryCode=c.countryCode AND (d.reportCount+w.reportCount)<5) ORDER BY c.countryName;
 SELECT DISTINCT d.wordId,d.countryCode FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE d.wordId IN (SELECT id FROM words ORDER BY id LIMIT 250) AND (d.reportCount+w.reportCount)<5 AND d.countryCode IS NOT NULL;`;
// Other words render dynamically through the Worker, including full source
// credits. Never create hundreds of thousands of static Worker asset files.
const boundedCredits=creditSql.replace("WHERE r.status", "WHERE d.wordId IN (SELECT id FROM words ORDER BY id LIMIT 250) AND r.status");
const child=spawnSync(process.execPath,[root+'/node_modules/wrangler/bin/wrangler.js','d1','execute','qamous','--remote','--command',sql+boundedCredits,'--json'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'39292a971f28b413619657e9f2c77003'}});
if(child.status!==0) throw new Error('Authorized SEO export failed; private provider output withheld');
const result=JSON.parse(child.stdout);
const credits=groupSeoCredits(result[3]?.results||[]);
const memberships=new Map();
for(const pair of result[2].results) memberships.set(pair.wordId,[...(memberships.get(pair.wordId)||[]),pair.countryCode]);
const data={exportedAt:new Date().toISOString(),words:result[0].results.map(w=>{
 const sourceCreditsEn=credits.get(w.id+':en')||[];
 const formatted=formatImportedDefinition(w.descriptionEn,sourceCreditsEn.map(c=>c.sourceId));
 return {...w,sourceCreditsEn:sourceCreditsEn.map(c=>({...c,changes:[...(Array.isArray(c.changes)?c.changes:[c.changes]),...formatted.changes]})),sourceCreditsAr:credits.get(w.id+':ar')||[],countryCodes:memberships.get(w.id)||[],descriptionEn:formatted.text.replace(/\s+/g,' ').slice(0,170),descriptionAr:w.descriptionAr.replace(/\s+/g,' ').slice(0,170)};
}),countries:result[1].results};
await writeFile(new URL('../../urban-dictionary-ar/.seo-data.json',new URL('..',import.meta.url)),JSON.stringify(data));
console.log(JSON.stringify({seoExported:true,words:data.words.length,countries:data.countries.length,containsPrivateAccountData:false}));
