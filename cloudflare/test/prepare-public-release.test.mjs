import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {preparePublicRelease} from '../scripts/prepare-public-release.mjs';

const quoteName=value=>'"'+value.replaceAll('"','""')+'"';
const quoteValue=value=>value===null?'NULL':typeof value==='number'||typeof value==='bigint'?String(value):typeof value==='string'?"'"+value.replaceAll("'","''")+"'":"X'"+Buffer.from(value).toString('hex')+"'";
function exportDatabase(db) {
  const shadow=new Set(db.prepare('PRAGMA table_list').all().filter(row=>row.type==='shadow').map(row=>row.name));
  const schema=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all().filter(row=>!shadow.has(row.name));
  const output=['PRAGMA foreign_keys=OFF;'];
  for(const table of schema.filter(row=>row.type==='table')) {
    output.push(table.sql+';');
    for(const row of db.prepare('SELECT * FROM '+quoteName(table.name)).all())output.push('INSERT INTO '+quoteName(table.name)+'('+Object.keys(row).map(quoteName).join(',')+') VALUES('+Object.values(row).map(quoteValue).join(',')+');');
  }
  for(const item of schema.filter(row=>row.type!=='table'))output.push(item.sql+';');
  return output.join('\n');
}

test('full schema-bearing export prepares public assets with credits and without private account values',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'qamous-full-public-release-')),db=new DatabaseSync(':memory:');
  try {
    const migrations=new URL('../migrations/',import.meta.url);
    for(const file of (await readdir(migrations)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())db.exec(await readFile(new URL(file,migrations),'utf8'));
    db.exec(`INSERT INTO countries VALUES('EG','Egypt');
      INSERT INTO users(id,firstName,lastName,email,username,password,createdAt,accountKind) VALUES
      (1,'Member','','member-private@example.invalid','member','member-private-password','2026-01-01','member'),
      (2,'Importer','','importer-private@example.invalid','public_importer','importer-private-password','2026-01-01','import');
      INSERT INTO words(id,userId,arabicWord,francoArabicWord,createdAt) VALUES(1,2,'كتاب','kitaab','2026-01-01');
      INSERT INTO definitions(id,wordId,userId,countryCode,definition,isArabic,displayLanguage) VALUES(1,1,2,'EG','A book',0,'en'),(2,1,1,'EG','Hidden moderation text',0,'hidden');
      INSERT INTO import_sources VALUES('source','Public dictionary','https://example.test','CC BY 4.0','https://creativecommons.org/licenses/by/4.0/','licensed','Original research authors','Original copyright notice',1,'release','{}');
      INSERT INTO import_license_documents VALUES('source','LICENSE.txt','Public license document');
      INSERT INTO import_batches(id,manifestHash,createdAt) VALUES(1,'hash','2026-01-01');
      INSERT INTO import_records(recordKey,sourceId,sourceEntryId,sourceUrl,importerUserId,batchId,contentHash,status,wordId,arabic,franco,transliteration,dialect,definitionAr,definitionEn,originalMetadata,fingerprint,displayFranco)
      VALUES(1,'source','sense-1','https://example.test/entry',2,1,X'01','accepted',1,'كتاب','kitaab','kitāb','Egyptian','','A book','{"author":"Original entry author"}',X'01','kitaab');
      INSERT INTO import_change_templates VALUES(1,'["Text preserved"]');
      INSERT INTO definition_provenance VALUES(1,1,'en',1);
      INSERT INTO definition_examples(definitionId,recordKey,text,language,script,kind) VALUES(1,1,'كتاب','ar','Arabic','usage');
      INSERT INTO import_pronunciations VALUES(1,'translit','kitāb','ar','transcription');`);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='reaction_insert'").get());
    const source=exportDatabase(db),broken=new DatabaseSync(':memory:');
    try {
      broken.exec(source);
      assert.throws(()=>broken.exec('CREATE TABLE public_importer_names AS SELECT id,username FROM users; DROP TABLE users; ALTER TABLE public_importer_names RENAME TO users;'),/users/);
    }finally{broken.close();}
    const dictionaryFile=join(directory,'private.sql'),exportMetadataFile=join(directory,'export-private.json'),outputDirectory=join(directory,'public'),workDirectory=join(directory,'work'),now=Date.now();
    await writeFile(dictionaryFile,source);
    await writeFile(exportMetadataFile,JSON.stringify({databaseId:'d0587244-4f3d-4209-b246-55cefbce7555',exportStartedAt:new Date(now-1000).toISOString(),exportCompletedAt:new Date(now).toISOString(),bytes:Buffer.byteLength(source),sha256:createHash('sha256').update(source).digest('hex')}));
    const report=await preparePublicRelease({dictionaryFile,exportMetadataFile,workDirectory,outputDirectory});
    assert.equal(report.counts.publicDefinitions,1);assert.equal(report.counts.publicWordAliases,1);
    const manifest=JSON.parse(await readFile(join(outputDirectory,'manifest.json'),'utf8')),payloads=[];
    for(const entry of manifest.resources)payloads.push(await readFile(join(outputDirectory,entry.file),'utf8'));
    const publicText=payloads.join('\n');
    for(const expected of ['Original research authors','Original copyright notice','Original entry author','public_importer','https://example.test/entry','https://creativecommons.org/licenses/by/4.0/','Public license document','kitāb'])assert.ok(publicText.includes(expected),expected);
    for(const forbidden of ['member-private@example.invalid','importer-private@example.invalid','member-private-password','importer-private-password','Hidden moderation text','sourceFiles'])assert.equal(publicText.includes(forbidden),false,forbidden);
    assert.ok(manifest.resources.some(row=>row.key==='contributor:public_importer'));
    assert.ok(manifest.resources.some(row=>row.key==='license:source'));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='reaction_insert'").get(),'the original database retains all accounting triggers');
  } finally {db.close();await rm(directory,{recursive:true,force:true});}
});
