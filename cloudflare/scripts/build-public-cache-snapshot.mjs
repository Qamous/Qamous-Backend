// Build public-only cache payloads from a current, private D1 SQL export.
// Never publish the raw export or this in-memory database.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {resolvePublicData,exploreCacheKey} from '../src/public-data.ts';
import {validatePublicSeed} from '../src/public-cache-keys.ts';

const [dictionaryFile,supportFile,outputDirectory]=process.argv.slice(2);
if(!dictionaryFile||!supportFile||!outputDirectory) throw Error('Usage: node scripts/build-public-cache-snapshot.mjs <private-dictionary.sql> <private-support.sql> <private-output-directory>');
const output=resolve(outputDirectory);
await mkdir(output,{recursive:true});
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=OFF;');
sqlite.exec(await readFile(resolve(dictionaryFile),'utf8'));
sqlite.exec(await readFile(resolve(supportFile),'utf8'));
// A schema-bearing export includes reaction/accounting triggers referencing
// users. They are irrelevant to this isolated read-only projector and would
// make SQLite reject the account-table replacement while validating ALTER.
// Discard them only in memory, after loading the complete exported data.
sqlite.exec('PRAGMA foreign_keys=OFF;');
for(const {name} of sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all()) {
  sqlite.exec('DROP TRIGGER "'+name.replaceAll('"','""')+'"');
}
// Only the public importer display name is needed for attribution. Remove all
// other account fields before invoking any public projection.
sqlite.exec('CREATE TABLE public_importer_names AS SELECT id,username FROM users; DROP TABLE users; ALTER TABLE public_importer_names RENAME TO users;');
sqlite.exec(`CREATE VIEW IF NOT EXISTS public_definitions AS SELECT * FROM definitions WHERE displayLanguage!='hidden';
CREATE TABLE IF NOT EXISTS "definition-likes-dislikes"(definitionId INTEGER,userId INTEGER,liked INTEGER);
CREATE TABLE IF NOT EXISTS "definition-reports"(definitionId INTEGER,userId INTEGER);
CREATE INDEX IF NOT EXISTS definitions_country ON definitions(countryCode,id);
CREATE INDEX IF NOT EXISTS recovery_definitions_word ON definitions(wordId);
CREATE INDEX IF NOT EXISTS recovery_words_canonical ON words(canonicalArabic,id);
CREATE INDEX IF NOT EXISTS recovery_provenance_definition ON definition_provenance(definitionId);
CREATE INDEX IF NOT EXISTS recovery_examples_definition ON definition_examples(definitionId);
CREATE INDEX IF NOT EXISTS recovery_pronunciations_record ON import_pronunciations(recordKey);
CREATE INDEX IF NOT EXISTS recovery_spelling_word ON word_spellings(wordId,script);`);
const db={prepare(sql){const native=sqlite.prepare(sql);const make=(values=[])=>({bind(...args){return make(args)},async all(){return {success:true,results:native.all(...values),meta:{rows_read:0,rows_written:0}}},async first(column){const row=native.get(...values);return row?(column===undefined?row:row[column]):null}});return make();},async batch(statements){return Promise.all(statements.map(statement=>statement.all()));}};
const keys=new Set(['countries','posts','sources','feed:0','feed:1','seo-index','seo-browse:en:','seo-browse:ar:']);
const words=sqlite.prepare(`SELECT w.id FROM words w WHERE w.reportCount<5 AND EXISTS(SELECT 1 FROM words variant JOIN public_definitions d ON d.wordId=variant.id WHERE variant.canonicalArabic=w.canonicalArabic AND d.reportCount+variant.reportCount<5)`).all();
for(const {id} of words)keys.add('word:'+id);
for(const {bucket} of sqlite.prepare('SELECT bucket FROM seo_sitemap_buckets').all())keys.add('seo-shard:'+bucket);
for(const {bucket} of sqlite.prepare('SELECT DISTINCT CAST(id/100 AS INTEGER) AS bucket FROM public_definitions').all())keys.add('cards:'+bucket);
const countries=await resolvePublicData(db,'countries');
for(const country of countries) {
  keys.add('related:'+country.countryCode+':ar');keys.add('related:'+country.countryCode+':franco');
  keys.add('seo-dialect:'+encodeURIComponent(country.countryName));
  for(const script of ['ar','franco']) keys.add(exploreCacheKey(new URLSearchParams({script,scope:'all',sort:'popular',page:'1',limit:'12',country:country.countryCode})));
}
for(const script of ['ar','franco'])keys.add(exploreCacheKey(new URLSearchParams({script,scope:'all',sort:'popular',page:'1',limit:'12'})));
const manifest={builtAt:new Date().toISOString(),sourceFiles:[dictionaryFile,supportFile].map(file=>resolve(file)),resources:[],skipped:[]};
let bytes=0;
for(const key of keys) {
  let value;
  try{value=await resolvePublicData(db,key);}catch(error){if(error.status===404){manifest.skipped.push({key,status:404});continue;}throw new Error('Public projection failed for '+key,{cause:error});}
  validatePublicSeed(key,value);
  const json=JSON.stringify({key,value});
  const size=Buffer.byteLength(json);if(size>1_950_000)throw Error('Cache seed exceeds endpoint limit: '+key);
  const name=createHash('sha256').update(key).digest('hex')+'.json';
  await writeFile(join(output,name),json);
  manifest.resources.push({key,file:name,bytes:size,sha256:createHash('sha256').update(json).digest('hex')});bytes+=size;
  if(key.startsWith('seo-browse:')&&value.next)keys.add(key.split(':').slice(0,2).join(':')+':'+value.next);
}
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
sqlite.close();
console.log(JSON.stringify({resources:manifest.resources.length,skipped:manifest.skipped.length,bytes,manifest:join(output,'manifest.json')}));
