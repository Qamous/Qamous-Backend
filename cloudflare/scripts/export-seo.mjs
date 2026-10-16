import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verifyFreePlan} from './free-plan-guard.mjs';
await verifyFreePlan();
const root=fileURLToPath(new URL('..',import.meta.url));
// Only public names and short descriptions, never users, ownership or credentials.
const sql=`SELECT w.id,w.arabicWord,w.francoArabicWord,
 COALESCE((SELECT d.definition FROM definitions d WHERE d.wordId=w.id AND d.isArabic=0 AND d.reportCount<5 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1),'') AS descriptionEn,
 COALESCE((SELECT d.definition FROM definitions d WHERE d.wordId=w.id AND d.isArabic=1 AND d.reportCount<5 ORDER BY d.likeCount-d.dislikeCount DESC,d.id LIMIT 1),'') AS descriptionAr
 FROM words w WHERE w.reportCount<5 AND EXISTS(SELECT 1 FROM definitions d WHERE d.wordId=w.id AND d.reportCount<5) ORDER BY w.id;
 SELECT countryName FROM countries WHERE countryCode IN (SELECT countryCode FROM definitions WHERE reportCount<5) ORDER BY countryName;`;
const child=spawnSync(process.execPath,[root+'/node_modules/wrangler/bin/wrangler.js','d1','execute','qamous','--remote','--command',sql,'--json'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'39292a971f28b413619657e9f2c77003'}});
if(child.status!==0) throw new Error('Authorized SEO export failed; private provider output withheld');
const result=JSON.parse(child.stdout);
const data={exportedAt:new Date().toISOString(),words:result[0].results.map(w=>({...w,descriptionEn:w.descriptionEn.replace(/\s+/g,' ').slice(0,170),descriptionAr:w.descriptionAr.replace(/\s+/g,' ').slice(0,170)})),countries:result[1].results.map(c=>c.countryName)};
await writeFile(new URL('../../urban-dictionary-ar/.seo-data.json',new URL('..',import.meta.url)),JSON.stringify(data));
console.log(JSON.stringify({seoExported:true,words:data.words.length,countries:data.countries.length,containsPrivateAccountData:false}));
