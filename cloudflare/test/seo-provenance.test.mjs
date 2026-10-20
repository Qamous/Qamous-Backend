import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSeoCredits,creditSql} from '../scripts/seo-provenance.mjs';
import {DatabaseSync} from 'node:sqlite';
test('SEO credits remain grouped by word and actual definition language',()=>{
  const groups=groupSeoCredits([{wordId:5,isArabic:1,credit:'Arabic authors'},{wordId:5,isArabic:0,credit:'English authors'}]);
  assert.equal(groups.get('5:ar')[0].credit,'Arabic authors');
  assert.equal(groups.get('5:en')[0].credit,'English authors');
  assert.ok(!('wordId' in groups.get('5:en')[0]));
});
test('entry credit does not replace the dataset authors or copyright notice',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE words(id,reportCount);CREATE TABLE definitions(id,wordId,isArabic,definition,reportCount,likeCount,dislikeCount);" +
      "CREATE VIEW public_definitions AS SELECT * FROM definitions;CREATE TABLE import_change_templates(id,text);INSERT INTO import_change_templates VALUES(1,'Extracted');CREATE TABLE definition_provenance(definitionId,recordKey,changes);CREATE TABLE import_records(recordKey,sourceId,originalMetadata,sourceUrl,status);" +
      "CREATE TABLE import_sources(id,name,credit,license,licenseUrl,rightsStatus,notice,attributionRequired);" +
      "INSERT INTO words VALUES(1,0);INSERT INTO definitions VALUES(1,1,0,'A book',0,0,0);" +
      "INSERT INTO definition_provenance VALUES(1,'key',1);" +
      "INSERT INTO import_records VALUES('key','source','{\"attribution\":\"Entry authors\"}','https://example.org','accepted');" +
      "INSERT INTO import_sources VALUES('source','Lexicon','Dataset authors','CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/','licensed','Copyright notice',1);");
    const row=db.prepare(creditSql).get();
    assert.equal(row.credit,'Dataset authors Entry authors');
    assert.equal(row.notice,'Copyright notice');
  } finally {db.close();}
});
