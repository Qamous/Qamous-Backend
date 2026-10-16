import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const folder=join(root,'private');
await mkdir(folder,{recursive:true});
const location=join(folder,'production-secrets.json');
let secrets;
try {secrets=JSON.parse(await readFile(location,'utf8'));}
catch(error){
  if(error.code!=='ENOENT') throw error;
  const old=parseEnv(await readFile(join(root,'../safe/.env'),'utf8'));
  if(!old.PEPPER) throw new Error('Legacy password pepper is missing');
  const fresh=()=>randomBytes(48).toString('base64url');
  secrets={LEGACY_PEPPER:old.PEPPER,PASSWORD_PEPPER:fresh(),SESS_SECRET:fresh(),RESET_SECRET:fresh(),EMAIL_USERNAME:old.EMAIL_USERNAME||'',EMAIL_PASSWORD:old.EMAIL_PASSWORD||''};
  await writeFile(location,JSON.stringify(secrets,null,2),{mode:0o600,flag:'wx'});
}
const local=Object.fromEntries(Object.entries(secrets).filter(([k])=>!k.startsWith('EMAIL_')));
const localPath=join(root,'.dev.vars');
try {await access(localPath);}
catch {await writeFile(localPath,Object.entries(local).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});}
console.log(JSON.stringify({generated:true,localEmailEnabled:false,secrets:Object.keys(secrets),mailCredentialPresent:!!secrets.EMAIL_USERNAME&&!!secrets.EMAIL_PASSWORD}));
