// Source-aware presentation only. Original text, IDs and search indexes stay
// in the import ledger/database; member-authored text is never rewritten here.
export const GLOSS_DISPLAY_VERSION = 'source-gloss-display-v1';
const encodedGlossSources = new Set(['maknuune','aramorph']);
export function formatImportedExample(originalText,sourceId) {
  if(sourceId!=='maknuune'||typeof originalText!=='string'||!/\[auto\][ \t]*$/i.test(originalText))return {text:originalText,changed:false,changes:[],sourceMarkers:[]};
  const text=originalText.replace(/(?:_+|[ \t])*\[auto\][ \t]*$/i,'').trim();
  if(text===originalText)return {text:originalText,changed:false,changes:[],sourceMarkers:[]};
  return {text,changed:true,sourceMarkers:['auto'],changes:['The original example carries the source marker [auto], retained in the source record rather than the displayed example.']};
}
export function formatImportedDefinition(originalText, sourceIds = [], english = true) {
  const unchanged = {text:originalText,changed:false,changes:[],sourceMarkers:[]};
  if (typeof originalText !== 'string' || !english || !sourceIds.some(id=>encodedGlossSources.has(id))) return unchanged;
  const sourceMarkers = [];
  const maknuune = sourceIds.includes('maknuune');
  // Keep URLs, emails, inline code, Markdown emphasis and entity references
  // intact. Underscores elsewhere in these two lexica encode word spaces.
  const protectedText = /((?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|`[^`]*`|\*\*[^*]*\*\*|__[^_]+__|&(?:#[0-9]+|#x[\da-f]+|\w+);)/gi;
  const text = originalText.split(protectedText).map((part,index)=> {
    if (index%2) return part;
    let value=part;
    if (maknuune) value=value.replace(/(?:_+|[ \t])*\[auto\]/gi,()=>{sourceMarkers.push('auto');return '';});
    value=value.replace(/_+/g,' ');
    if (maknuune) value=value.replace(/\bsb\b/g,'somebody').replace(/\bsth\b/g,'something');
    return value.replace(/[ \t]*;[ \t]*(?=\S)/g,'; ');
  }).join('').trim();
  if (text===originalText) return unchanged;
  return {text,changed:true,sourceMarkers:[...new Set(sourceMarkers)],changes:[
    'Source gloss formatting normalized for display (word separators, punctuation spacing and dictionary abbreviations); original text retained.',
    ...(sourceMarkers.length ? ['The original gloss carries the source marker [auto], retained in the source record rather than the displayed definition.'] : []),
  ]};
}
