import {ApiError,escapeLike,normalize,rankedSql,text} from './data.ts';

export function keywordSearchPage(params:URLSearchParams) {
  if(!params.has('page')&&!params.has('limit'))return null;
  const read=(name:string,fallback:number,max:number)=>{
    const values=params.getAll(name),value=values[0]??String(fallback);
    if(values.length>1||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)
      throw new ApiError(400,'Invalid search '+name);
    return Number(value);
  };
  const language=params.get('language');
  if(params.getAll('language').length>1||(language!==null&&!['en','ar'].includes(language)))throw new ApiError(400,'Invalid search language');
  return {page:read('page',1,10000),limit:read('limit',20,50),...(language!==null?{language:language==='ar'?1:0}:{})};
}

function windowed(query:{sql:string;values:(string|number)[]},page?:{limit:number;offset:number;language?:number}) {
  if(!page)return query;
  if(page.language!==undefined)query={sql:`WITH SearchResults AS (${query.sql}), PreferredLanguage AS (
    SELECT r.*,ROW_NUMBER() OVER(PARTITION BY w.canonicalArabic ORDER BY CASE WHEN r.isArabic=? THEN 0 ELSE 1 END,r.definitionId) AS searchLanguageRanking
    FROM SearchResults r JOIN words w ON w.id=r.wordId
  ) SELECT * FROM PreferredLanguage WHERE searchLanguageRanking=1 ORDER BY likeDislikeDifference DESC,definitionId`,values:[...query.values,page.language]};
  return {sql:query.sql+' LIMIT ? OFFSET ?',values:[...query.values,page.limit,page.offset]};
}

// Resolve indexed IDs before ranking, spellings, reactions and provenance.
// The former OR/EXISTS predicate walked every public definition and repeated
// the alias lookup for each row, even when a long phrase matched nothing.
export function keywordSearchQuery(value:string,userId=0,page?:{limit:number;offset:number;language?:number}) {
  const keyword=normalize(text(value,'keyword',200)),like='%'+escapeLike(keyword)+'%';
  if([...keyword].length<3) {
    // Trigram MATCH cannot represent one/two-character substrings. Retain the
    // literal substring behavior, scanning the small alias tables only once.
    return windowed({sql:rankedSql("AND (w.searchText LIKE ? ESCAPE '\\' OR d.searchText LIKE ? ESCAPE '\\' OR w.id IN (SELECT wordId FROM word_spellings WHERE searchText LIKE ? ESCAPE '\\') OR d.submissionId IN (SELECT id FROM contribution_submissions WHERE francoForm LIKE ? ESCAPE '\\'))"),
      values:[userId,userId,userId,like,like,like,like]},page);
  }
  const literal='"'+keyword.replaceAll('"','""')+'"';
  return windowed({sql:rankedSql(`AND d.id IN (
    SELECT rowid FROM definition_search WHERE definition_search MATCH ?
    UNION
    SELECT d.id FROM word_search f CROSS JOIN definitions d INDEXED BY definitions_word
      WHERE word_search MATCH ? AND d.wordId=f.rowid
    UNION
    SELECT d.id FROM word_spellings a CROSS JOIN definitions d INDEXED BY definitions_word
      WHERE a.searchText LIKE ? ESCAPE '\\' AND d.wordId=a.wordId
    UNION
    SELECT d.id FROM contribution_submissions s CROSS JOIN definitions d INDEXED BY definitions_submission_language
      WHERE s.francoForm LIKE ? ESCAPE '\\' AND d.submissionId=s.id
  )`),values:[userId,userId,userId,literal,literal,like,like]},page);
}
