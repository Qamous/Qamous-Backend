import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,copyFile,readdir,rename,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {validatePublicSeed} from '../src/public-cache-keys.ts';

export function validateExportMetadata(metadata,bytes,now=Date.now()) {
  const start=Date.parse(metadata?.exportStartedAt),end=Date.parse(metadata?.exportCompletedAt);
  if(metadata?.databaseId!=='d0587244-4f3d-4209-b246-55cefbce7555'||!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>now+300000||now-end>7200000
    ||metadata.bytes!==bytes.length||metadata.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Public packaging refused: invalid, stale or mismatched private export');
}
export async function packagePublicSnapshot({dictionaryFile,projectionDirectory,exportMetadataFile,outputDirectory,now=Date.now()}) {
  const destination=resolve(outputDirectory);
  if(await access(destination).then(()=>true,()=>false))throw Error('Public output must be a new directory');
  const sourceBytes=await readFile(resolve(dictionaryFile));
  const source=sourceBytes.toString('utf8');
  const exportMeta=JSON.parse(await readFile(resolve(exportMetadataFile),'utf8'));
  validateExportMetadata(exportMeta,sourceBytes,now);
  const directoryUrl=path=>pathToFileURL(resolve(path)+ '/');
  const projection=directoryUrl(projectionDirectory);
  const stage=destination+'.staging-'+randomUUID();
  const output=directoryUrl(stage);
  let sqlite;
  try {
const manifest=JSON.parse(await readFile(new URL('manifest.json',projection),'utf8'));
if(!Array.isArray(manifest.resources)||!Array.isArray(manifest.skipped)||manifest.skipped.some(entry=>!entry||Object.keys(entry).some(key=>!['key','status'].includes(key))||typeof entry.key!=='string'||entry.status!==404))throw Error('Invalid private projection manifest');
sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=OFF;');sqlite.exec(source);
const credentialValues=sqlite.prepare('SELECT email,password FROM users').all().flatMap(row=>[row.email,row.password]).filter(value=>typeof value==='string'&&value.length>=8);
const forbiddenProperties=/password|session|secret|token|email|reportText|sourceFiles|originalMetadata|payloadHash/i;
let checkedObjects=0,credentialChecks=0;
function audit(value) {
  if(value===null||typeof value==='boolean'||typeof value==='number')return;
  if(typeof value==='string') {
    if(credentialValues.some(credential=>value.includes(credential)))throw Error('Private account value detected in a public projection');
    credentialChecks++;
    return;
  }
  if(Array.isArray(value)){for(const child of value)audit(child);return;}
  if(typeof value!=='object')throw Error('Non-JSON public projection');
  checkedObjects++;
  for(const [key,child] of Object.entries(value)) {
    if(forbiddenProperties.test(key))throw Error('Private field detected in public projection: '+key);
    if(['isLiked','isDisliked','isReported'].includes(key)&&!!child)throw Error('Personal reaction detected');
    audit(child);
  }
}
const count=table=>Number(sqlite.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n);
const counts={words:count('words'),definitions:count('definitions'),countries:count('countries'),posts:count('posts'),sourceRecords:count('import_records')};
const canonicalByWord=new Map(sqlite.prepare('SELECT id,canonicalArabic FROM words').all().map(row=>[row.id,row.canonicalArabic]));
const definitionsWithUsage=new Set(sqlite.prepare("SELECT DISTINCT definitionId FROM definition_examples WHERE language IN ('ar','ar-Latn') AND kind='usage'").all().map(row=>row.definitionId));
const visible=new Set(sqlite.prepare("SELECT d.id FROM definitions d JOIN words w ON w.id=d.wordId WHERE d.displayLanguage!='hidden' AND d.reportCount<=5 AND w.reportCount<=5").all().map(row=>row.id));
const wordVisible=new Set(sqlite.prepare("SELECT w.id FROM words w WHERE w.reportCount<5 AND EXISTS(SELECT 1 FROM words v JOIN definitions d ON d.wordId=v.id WHERE v.canonicalArabic=w.canonicalArabic AND d.displayLanguage!='hidden' AND d.reportCount+v.reportCount<5)").all().map(row=>row.id));
const countsByKind={},discovery=new Map(),resources=[],seenKeys=new Set();
const flatFields=['id','definitionId','wordId','canonicalWordId','arabicWord','francoArabicWord','definition','example','arabicExample','isArabic','countryCode','likeCount','dislikeCount','AddedTimestamp','arabicSpellings','francoSpellings'];
await mkdir(output,{recursive:false});
for(const resource of manifest.resources) {
  if(!resource||Object.keys(resource).some(key=>!['key','file','bytes','sha256'].includes(key))||seenKeys.has(resource.key))throw Error('Invalid or duplicate public resource');
  seenKeys.add(resource.key);
  if(!/^[a-f0-9]{64}\.json$/.test(resource.file)||resource.file!==createHash('sha256').update(resource.key).digest('hex')+'.json')throw Error('Unsafe resource filename');
  const bytes=await readFile(new URL(resource.file,projection));
  if(bytes.length!==resource.bytes||createHash('sha256').update(bytes).digest('hex')!==resource.sha256)throw Error('Resource checksum mismatch');
  const payload=JSON.parse(bytes);
  if(payload.key!==resource.key)throw Error('Resource key mismatch');
  validatePublicSeed(payload.key,payload.value);audit(payload.value);
  if(payload.key.startsWith('word:')) {
    if(!wordVisible.has(Number(payload.key.slice(5))))throw Error('Hidden word snapshot');
    for(const row of payload.value)if(!visible.has(Number(row.definitionId??row.id)))throw Error('Hidden meaning in word snapshot');
  }
  if(payload.key.startsWith('cards:')) {
    for(const row of payload.value) {
      const id=Number(row.definitionId??row.id);if(!visible.has(id))throw Error('Hidden card snapshot');
      if(discovery.has(id))throw Error('Duplicate definition ID across card buckets');
      const flat=Object.fromEntries(flatFields.filter(field=>row[field]!==undefined).map(field=>[field,row[field]]));
      flat.definitionId=id;flat.canonicalArabic=canonicalByWord.get(Number(row.wordId));
      flat.hasExamples=Boolean(String(row.example||'').trim()||String(row.arabicExample||'').trim()||definitionsWithUsage.has(id));
      discovery.set(id,flat);
    }
  }
  const kind=resource.key.split(':')[0];countsByKind[kind]=(countsByKind[kind]||0)+1;
  resources.push({...resource});await copyFile(new URL(resource.file,projection),new URL(resource.file,output));
}
if(discovery.size!==visible.size)throw Error('Discovery coverage does not match visible definitions');
if(countsByKind.word!==wordVisible.size)throw Error('Word coverage does not match visible aliases');
for(const key of ['countries','posts','sources','feed:0','feed:1','seo-index','seo-browse:en:','seo-browse:ar:'])if(!seenKeys.has(key))throw Error('Missing required public resource: '+key);
const discoveryPayload={key:'discovery',value:[...discovery.values()].sort((a,b)=>a.definitionId-b.definitionId)};
audit(discoveryPayload.value);validatePublicSeed('word:1',discoveryPayload.value);
const discoveryJson=JSON.stringify(discoveryPayload),discoveryFile=createHash('sha256').update('discovery').digest('hex')+'.json';
await writeFile(new URL(discoveryFile,output),discoveryJson);
resources.push({key:'discovery',file:discoveryFile,bytes:Buffer.byteLength(discoveryJson),sha256:createHash('sha256').update(discoveryJson).digest('hex')});
const importers=sqlite.prepare("SELECT u.id,u.username,u.createdAt,COUNT(DISTINCT p.definitionId) AS definitions FROM users u LEFT JOIN import_records r ON r.importerUserId=u.id LEFT JOIN definition_provenance p ON p.recordKey=r.recordKey WHERE u.accountKind='import' GROUP BY u.id").all();
for(const row of importers) {
  const sources=sqlite.prepare('SELECT DISTINCT s.id,s.name FROM import_sources s JOIN import_records r ON r.sourceId=s.id WHERE r.importerUserId=? ORDER BY s.name').all(row.id);
  const key='contributor:'+String(row.username).toLowerCase();
  const payload={key,value:{id:row.id,username:row.username,createdAt:row.createdAt,definitions:Number(row.definitions),description:'Vocabulary collection. Original sources are credited with each entry.',sources}};
  audit(payload.value);validatePublicSeed('sources',payload.value);
  const json=JSON.stringify(payload),file=createHash('sha256').update(key).digest('hex')+'.json';
  await writeFile(new URL(file,output),json);resources.push({key,file,bytes:Buffer.byteLength(json),sha256:createHash('sha256').update(json).digest('hex')});
}
countsByKind.contributor=importers.length;
if(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='import_license_documents'").get()) {
  const licenses=sqlite.prepare('SELECT sourceId,fileName,text FROM import_license_documents').all();
  for(const row of licenses) {
    const key='license:'+row.sourceId,payload={key,value:{fileName:row.fileName,text:row.text}};
    audit(payload.value);validatePublicSeed('sources',payload.value);
    const json=JSON.stringify(payload),file=createHash('sha256').update(key).digest('hex')+'.json';
    await writeFile(new URL(file,output),json);resources.push({key,file,bytes:Buffer.byteLength(json),sha256:createHash('sha256').update(json).digest('hex')});
  }
  countsByKind.license=licenses.length;
}
const publicManifest={schemaVersion:1,snapshotId:exportMeta.sha256.slice(0,16),generatedAt:new Date().toISOString(),sourceExportedAt:exportMeta.exportCompletedAt,exportStartedAt:exportMeta.exportStartedAt,exportCompletedAt:exportMeta.exportCompletedAt,expiresAt:new Date(Date.parse(exportMeta.exportCompletedAt)+86400000).toISOString(),resources,skipped:manifest.skipped,counts:{...counts,publicWordAliases:wordVisible.size,publicDefinitions:visible.size,resources:resources.length}};
audit(publicManifest);
await writeFile(new URL('manifest.json',output),JSON.stringify(publicManifest)+'\n');
const allowedFiles=new Set(['manifest.json',...resources.map(resource=>resource.file)]);
for(const file of await readdir(output))if(!allowedFiles.has(file))throw Error('Unexpected file in public output: '+file);
const report={checkedAt:new Date().toISOString(),snapshotId:publicManifest.snapshotId,publicDirectory:output.pathname,exportStartedAt:exportMeta.exportStartedAt,exportCompletedAt:exportMeta.exportCompletedAt,expiresAt:publicManifest.expiresAt,counts:publicManifest.counts,countsByKind,discoveryBytes:Buffer.byteLength(discoveryJson),totalResourceBytes:resources.reduce((sum,row)=>sum+row.bytes,0),checkedObjects,credentialChecks,publicAssetFiles:allowedFiles.size,privateFields:false,privateAccountValues:false,allCardIdsVisible:true,allVisibleCardsCovered:true,allVisibleWordAliasesCovered:true};
  sqlite.close();sqlite=undefined;
  await rename(stage,destination);
  return {...report,publicDirectory:destination};
  } catch(error) {
    sqlite?.close();
    await rm(stage,{recursive:true,force:true});
    throw error;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};const names={'--dictionary':'dictionaryFile','--projection':'projectionDirectory','--metadata':'exportMetadataFile','--output':'outputDirectory'};
  for(let i=2;i<process.argv.length;i+=2) {
    const key=names[process.argv[i]];if(!key||!process.argv[i+1]||options[key])throw Error('Use --dictionary <private.sql> --projection <private directory> --metadata <private.json> --output <new public directory>');
    options[key]=process.argv[i+1];
  }
  if(Object.keys(options).length!==4)throw Error('All four packaging paths are required');
  console.log(JSON.stringify(await packagePublicSnapshot(options)));
}
