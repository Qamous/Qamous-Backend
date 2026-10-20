import test from 'node:test';
import assert from 'node:assert/strict';
import {projectExamples} from '../src/example-alignment.mjs';
import {francoExample} from '../src/franco-example.mjs';
const row=(id,text,language,groupKeys,extra={})=>({id,text,language,script:language==='ar'?'Arabic':'Latin',kind:language==='en'?'translation':'usage',groupKeys,alignment:'source',...extra});
test('source groups never cross-pair different sentences or show an orphan English sample',()=>{
 const result=projectExamples([row(1,'هذا كتاب','ar',['one']),row(2,'A book','en',['one']),row(3,'Hadi dar','ar-Latn',['two']),row(4,'A house','en',['two']),row(5,'Unknown','en',[],{kind:'unclassified'})]);
 assert.equal(result.find(e=>e.text==='A book').groupId,'one');
 assert.equal(result.find(e=>e.text==='A house').groupId,'two');
 assert.ok(!result.some(e=>e.text==='Unknown'));
 assert.equal(result.find(e=>e.generated).derivedFromArabic,'هذا كتاب');
 assert.equal(result.filter(e=>e.generated).length,1);
});
test('one repeated translation can belong to two explicitly parallel blocks',()=>{
 const result=projectExamples([row(1,'Hada','ar-Latn',['a']),row(2,'Hadi','ar-Latn',['b']),row(3,'This','en',['a','b'])]);
 assert.deepEqual(result.filter(e=>e.language==='en').map(e=>e.groupId),['a','b']);
});
test('source Franco wins; unsupported letters stay unresolved; written vowels and shadda remain stable',()=>{
 assert.equal(projectExamples([row(1,'كتاب','ar',['a']),row(2,'kitab','ar-Latn',['a'])]).some(e=>e.generated),false);
 assert.equal(francoExample('مُعَلِّم'),'mo3allem');
 assert.equal(francoExample('ب ّ'),'b ');
 assert.equal(francoExample('بaّ'),'ba');
 assert.equal(francoExample('ٶ'),'');
 assert.equal(francoExample('English only'),'');
});
