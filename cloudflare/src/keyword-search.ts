import {escapeLike,normalize,rankedSql,text} from './data.ts';

// Resolve indexed IDs before ranking, spellings, reactions and provenance.
// The former OR/EXISTS predicate walked every public definition and repeated
// the alias lookup for each row, even when a long phrase matched nothing.
export function keywordSearchQuery(value:string,userId=0) {
  const keyword=normalize(text(value,'keyword',200)),like='%'+escapeLike(keyword)+'%';
  if([...keyword].length<3) {
    // Trigram MATCH cannot represent one/two-character substrings. Retain the
    // literal substring behavior, scanning the small alias tables only once.
    return {sql:rankedSql("AND (w.searchText LIKE ? ESCAPE '\\' OR d.searchText LIKE ? ESCAPE '\\' OR w.id IN (SELECT wordId FROM word_spellings WHERE searchText LIKE ? ESCAPE '\\') OR d.submissionId IN (SELECT id FROM contribution_submissions WHERE francoForm LIKE ? ESCAPE '\\'))"),
      values:[userId,userId,userId,like,like,like,like]};
  }
  const literal='"'+keyword.replaceAll('"','""')+'"';
  return {sql:rankedSql(`AND d.id IN (
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
  )`),values:[userId,userId,userId,literal,literal,like,like]};
}
