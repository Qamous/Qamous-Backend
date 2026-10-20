import {francoExample,FRANCO_METHOD} from './franco-example.mjs';
export function projectExamples(rows=[]) {
 const groups=new Map();
 for(const [index,row] of rows.entries()){
  if(!row.text?.trim()||row.kind==='unclassified'||row.language==='en'&&row.kind!=='translation')continue;
  let keys=row.groupId?[row.groupId]:Array.isArray(row.groupKeys)?row.groupKeys:[];
  if(!keys.length&&row.language!=='en'&&row.kind==='usage')keys=['unpaired:'+(row.id??index)];
  for(const key of keys){const values=groups.get(String(key))||[];if(!values.some(e=>e.text===row.text&&e.language===row.language&&e.kind===row.kind))values.push({...row,groupId:String(key)});groups.set(String(key),values);}
 }
 const result=[];
 for(const values of groups.values()){
  const originals=values.filter(e=>e.kind==='usage'&&(e.language==='ar'||e.language==='ar-Latn'));
  if(!originals.length)continue;
  const retained=values.filter(e=>e.kind==='usage'||e.kind==='translation'&&['source','community'].includes(e.alignment));
  if(!retained.some(e=>e.language==='ar-Latn'&&e.kind==='usage')){
   const original=originals.find(e=>e.language==='ar'),generated=original&&francoExample(original.text);
   if(original&&generated)retained.push({...original,text:generated,language:'ar-Latn',script:'Latin',generated:true,generationMethod:FRANCO_METHOD,derivedFromExampleId:original.id,derivedFromArabic:original.text});
  }
  result.push(...retained);
 }
 return result;
}
