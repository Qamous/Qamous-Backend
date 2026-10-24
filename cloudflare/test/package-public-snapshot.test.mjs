import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {packagePublicSnapshot,validateExportMetadata} from '../scripts/package-public-snapshot.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const sql=`CREATE TABLE users(id INTEGER,username TEXT,email TEXT,password TEXT,accountKind TEXT,createdAt TEXT);
INSERT INTO users VALUES(1,'member','private@example.test','credential-value','member','today');
CREATE TABLE words(id INTEGER,canonicalArabic TEXT,reportCount INTEGER);INSERT INTO words VALUES(1,'word',0);
CREATE TABLE definitions(id INTEGER,wordId INTEGER,displayLanguage TEXT,reportCount INTEGER);INSERT INTO definitions VALUES(1,1,'en',0);
CREATE TABLE countries(id INTEGER);CREATE TABLE posts(id INTEGER);
CREATE TABLE import_records(recordKey INTEGER,importerUserId INTEGER,sourceId TEXT);
CREATE TABLE definition_provenance(recordKey INTEGER,definitionId INTEGER);
CREATE TABLE definition_examples(definitionId INTEGER,language TEXT,kind TEXT);
CREATE TABLE import_sources(id TEXT,name TEXT);`;
async function fixture(run) {
  const root=await mkdtemp(join(tmpdir(),'qamous-public-package-'));
  try {
    const dictionaryFile=join(root,'private.sql'),exportMetadataFile=join(root,'private-metadata.json'),projectionDirectory=join(root,'projection'),outputDirectory=join(root,'public');
    await mkdir(projectionDirectory);await writeFile(dictionaryFile,sql);
    const now=Date.now(),meta={databaseId:'d0587244-4f3d-4209-b246-55cefbce7555',exportStartedAt:new Date(now-1000).toISOString(),exportCompletedAt:new Date(now).toISOString(),bytes:Buffer.byteLength(sql),sha256:sha(sql)};
    await writeFile(exportMetadataFile,JSON.stringify(meta));
    const values={'countries':[],'posts':[],'sources':[],'feed:0':[],'feed:1':[],'seo-index':{},'seo-browse:en:':{},'seo-browse:ar:':{},'word:1':[{id:1,definitionId:1,wordId:1}],'cards:0':[{id:1,definitionId:1,wordId:1}]};
    async function project(changes={}) {
      const resources=[];
      for(const [key,value] of Object.entries({...values,...changes})) {
        const json=JSON.stringify({key,value}),file=sha(key)+'.json';
        await writeFile(join(projectionDirectory,file),json);resources.push({key,file,bytes:Buffer.byteLength(json),sha256:sha(json)});
      }
      await writeFile(join(projectionDirectory,'manifest.json'),JSON.stringify({sourceFiles:[dictionaryFile],resources,skipped:[]}));
    }
    await project();await run({dictionaryFile,exportMetadataFile,projectionDirectory,outputDirectory,now,root,meta,project});
  }finally{await rm(root,{recursive:true,force:true});}
}
test('publishes sanitized manifest only after full coverage and credential audit',()=>fixture(async options=>{
  const report=await packagePublicSnapshot(options),text=await readFile(join(options.outputDirectory,'manifest.json'),'utf8');
  assert.equal(report.counts.publicDefinitions,1);assert.equal(report.counts.publicWordAliases,1);
  assert.equal(text.includes('sourceFiles'),false);assert.equal(text.includes(options.root),false);
  assert.ok(JSON.parse(text).resources.some(x=>x.key==='discovery'));
}));
test('credential values and hidden cards reject publication without leaving output',()=>fixture(async options=>{
  for(const value of [[{id:1,definitionId:1,wordId:1,definition:'private@example.test'}],[{id:2,definitionId:2,wordId:1}]]) {
    await options.project({'cards:0':value});await assert.rejects(packagePublicSnapshot(options),/Private account|Hidden card/);
    assert.equal((await readdir(options.root)).some(x=>x.startsWith('public')),false);
  }
}));
test('private properties, personalized flags and checksum corruption reject publication',()=>fixture(async options=>{
  for(const value of [{email:'public-looking'}, {isLiked:true}]) {
    await options.project({'posts':[value]});await assert.rejects(packagePublicSnapshot(options),/Private data|Private field|Personal reaction/);
  }
  await options.project();await writeFile(join(options.projectionDirectory,sha('posts')+'.json'),'{}');
  await assert.rejects(packagePublicSnapshot(options),/checksum/);
}));
test('stale or different exports are refused before output creation',()=>fixture(async options=>{
  assert.throws(()=>validateExportMetadata(options.meta,Buffer.from(sql+'\n'),options.now),/mismatched/);
  assert.throws(()=>validateExportMetadata(options.meta,Buffer.from(sql),options.now+7200001),/stale/);
}));
