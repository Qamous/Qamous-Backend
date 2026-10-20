import test from 'node:test';
import assert from 'node:assert/strict';
import {formatImportedDefinition,formatImportedExample} from '../src/definition-display.mjs';

test('real screenshot glosses become readable without losing the source marker',()=>{
  for(const [original,expected] of [
    ['get_used_to_sb','get used to somebody'],
    ['postpone_[auto]','postpone'],
    ['polite;decent;relating_to_humans_[auto]','polite; decent; relating to humans'],
    ['It_is_an_idiomatic_expression_that_means_that_sb\'s_family_or_origins_is_unknown',"It is an idiomatic expression that means that somebody's family or origins is unknown"],
  ]) {
    const result=formatImportedDefinition(original,['maknuune']);
    assert.equal(result.text,expected);assert.equal(result.changed,true);
    assert.equal(result.sourceMarkers.includes('auto'),original.includes('[auto]'));
    assert.ok(result.changes.some(c=>c.includes('original text retained')));
    assert.equal(formatImportedDefinition(result.text,['maknuune']).changed,false);
  }
  assert.equal(formatImportedDefinition('persisting;remaining;staying',['aramorph']).text,'persisting; remaining; staying');
});
test('member text, unrelated sources, other languages and meaningful literal underscores stay intact',()=>{
  const raw='A_function;example_[auto]';
  assert.equal(formatImportedDefinition(raw,[]).text,raw);
  assert.equal(formatImportedDefinition(raw,['wiktionary_arabic']).text,raw);
  assert.equal(formatImportedDefinition(raw,['maknuune'],false).text,raw);
  assert.equal(formatImportedDefinition('__ plus __ is __',['desert_sky']).text,'__ plus __ is __');
  const protectedValue='a_word; https://example.org/a_b?x=y_z; `a_b`; user_name@example.org; __emphasis__; &nbsp;';
  const result=formatImportedDefinition(protectedValue,['maknuune']);
  assert.match(result.text,/a word; /);
  for(const part of ['https://example.org/a_b?x=y_z;', '`a_b`', 'user_name@example.org;', '__emphasis__', '&nbsp;'])assert.ok(result.text.includes(part));
});
test('source example markers are metadata while Arabic wording and member text stay intact',()=>{
 const raw='عملوا قمة بالرياض_[auto]';
 const result=formatImportedExample(raw,'maknuune');
 assert.equal(result.text,'عملوا قمة بالرياض');assert.deepEqual(result.sourceMarkers,['auto']);
 assert.equal(formatImportedExample(raw,'other').text,raw);
});
