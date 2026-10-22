import { ApiError, escapeLike, normalize, spellingColumns } from './data.ts';
import { feedItemsQuery } from './feed.ts';

// Values are bound parameters; only the fixed sort expressions enter the SQL.
export function exploreQuery(params: URLSearchParams) {
  if (params.has('ids')) return feedItemsQuery(params);
  const query = (params.get('q') || '').trim();
  if (query.length > 200) throw new ApiError(400, 'Search must be 200 characters or fewer');
  const script = params.get('script') || 'both';
  const scope = params.get('scope') || 'all';
  const sort = params.get('sort') || 'popular';
  if (!['ar', 'franco', 'both'].includes(script) || !['all', 'words', 'definitions'].includes(scope) || !['popular', 'newest', 'az'].includes(sort)) {
    throw new ApiError(400, 'Invalid search option');
  }
  const countries = [...new Set(params.getAll('country').map(code => code.toUpperCase()))];
  if (countries.length > 25 || countries.some(code => !/^[A-Z]{2}$/.test(code))) throw new ApiError(400, 'Invalid dialect');
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 12);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50 || (page-1)*limit>10_000) throw new ApiError(400, 'Invalid pagination');
  const values: (string | number)[] = [];
  const filters = ['w.reportCount<=5', 'd.reportCount<=5'];
  if (query) {
    const normalized = normalize(query);
    if ([...normalized].length >= 3) {
      const literal = '"' + normalized.replaceAll('"', '""') + '"';
      const matches: string[] = [];
      if (scope !== 'definitions') {
        matches.push('d.wordId IN (SELECT rowid FROM word_search WHERE word_search MATCH ?)');
        values.push(literal);
        matches.push("d.wordId IN (SELECT wordId FROM word_spellings WHERE searchText LIKE ? ESCAPE '\\')");
        values.push('%'+escapeLike(normalized)+'%');
        matches.push("d.submissionId IN (SELECT id FROM contribution_submissions WHERE francoForm LIKE ? ESCAPE '\\')");
        values.push('%'+escapeLike(normalized)+'%');
      }
      if (scope !== 'words') {
        matches.push('d.id IN (SELECT rowid FROM definition_search WHERE definition_search MATCH ?)');
        values.push(literal);
      }
      filters.push('('+matches.join(' OR ')+')');
    } else {
    const columns = scope === 'words' ? ['w.searchText'] : scope === 'definitions' ? ['d.searchText'] : ['w.searchText', 'd.searchText'];
    const aliasMatch = scope !== 'definitions' ? ` OR EXISTS(SELECT 1 FROM word_spellings a WHERE a.wordId=w.id AND a.searchText LIKE ? ESCAPE '\\') OR d.submissionId IN (SELECT id FROM contribution_submissions WHERE francoForm LIKE ? ESCAPE '\\')` : '';
    filters.push(`(${columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')}${aliasMatch})`);
    values.push(...columns.map(() => `%${escapeLike(normalize(query))}%`));
    if (aliasMatch) values.push(`%${escapeLike(normalize(query))}%`,`%${escapeLike(normalize(query))}%`);
    }
  }
  const preferred=script==='ar'?1:0;
  if (!query && script!=='both') filters.push(`d.isArabic=${preferred}`);
  if (countries.length) { filters.push(`d.countryCode IN (${countries.map(() => '?').join(',')})`); values.push(...countries); }
  if (params.get('examples') === '1') filters.push("(LENGTH(TRIM(COALESCE(d.example,'')))>0 OR LENGTH(TRIM(COALESCE(d.arabicExample,'')))>0 OR EXISTS(SELECT 1 FROM definition_examples e WHERE e.definitionId=d.id AND e.language IN ('ar','ar-Latn') AND e.kind='usage'))");
  const cte = `WITH matches AS (
    SELECT d.*, w.arabicWord, w.francoArabicWord, d.id AS definitionId,
      CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE COALESCE(w.francoArabicWord,w.arabicWord) END AS word,
      (d.likeCount-d.dislikeCount) AS likeDislikeDifference,
      ROW_NUMBER() OVER(PARTITION BY w.canonicalArabic${script==='both'?',d.isArabic':''} ORDER BY ${script==='both'?'':`CASE WHEN d.isArabic=${preferred} THEN 0 ELSE 1 END,`}(d.likeCount-d.dislikeCount) DESC,d.id) AS ranking
    FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE ${filters.join(' AND ')}
  )`;
  const order = sort === 'newest' ? 'm.AddedTimestamp DESC,m.definitionId DESC' : sort === 'az' ? 'm.word COLLATE NOCASE,m.definitionId' : 'm.likeDislikeDifference DESC,m.definitionId';
  // Counting groups does not need ranking, spelling aggregation or per-user
  // reaction checks. Previously the complete expensive result CTE ran twice.
  let countSql = `SELECT COUNT(*) AS total FROM (SELECT w.canonicalArabic${script==='both'?',d.isArabic':''}
    FROM public_definitions d JOIN words w ON w.id=d.wordId WHERE ${filters.join(' AND ')}
    GROUP BY w.canonicalArabic${script==='both'?',d.isArabic':''})`;
  let resultsSql = `${cte} SELECT m.wordId,m.definitionId,m.word,m.arabicWord,m.francoArabicWord,
    m.definition,m.example,m.arabicExample,${spellingColumns('m').replaceAll('m.id','m.wordId')},m.isArabic,m.countryCode,m.likeCount,m.dislikeCount,m.likeDislikeDifference,
    EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=m.definitionId AND r.userId=? AND r.liked=1) AS isLiked,
    EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=m.definitionId AND r.userId=? AND r.liked=0) AS isDisliked,
    EXISTS(SELECT 1 FROM "definition-reports" r WHERE r.definitionId=m.definitionId AND r.userId=?) AS isReported
    FROM matches m WHERE ranking=1 ORDER BY ${order} LIMIT ? OFFSET ?`;
  if (!query && !countries.length && params.get('examples') !== '1') {
    const scriptWhere = script === 'both' ? '' : `WHERE c.isArabic=${preferred}`;
    countSql = 'SELECT SUM(total) AS total FROM dictionary_card_totals WHERE '+(script==='both'?'isArabic IN (0,1)':`isArabic=${preferred}`);
    const cardOrder = sort === 'newest' ? 'c.AddedTimestamp DESC,c.definitionId DESC' : sort === 'az' ? 'c.sortWord COLLATE NOCASE,c.definitionId' : 'c.score DESC,c.definitionId';
    resultsSql = `SELECT d.*,d.id AS definitionId,w.arabicWord,w.francoArabicWord,${spellingColumns()},c.sortWord AS word,c.score AS likeDislikeDifference,
      EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=d.id AND r.userId=? AND r.liked=1) AS isLiked,
      EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=d.id AND r.userId=? AND r.liked=0) AS isDisliked,
      EXISTS(SELECT 1 FROM "definition-reports" r WHERE r.definitionId=d.id AND r.userId=?) AS isReported
      FROM (SELECT * FROM dictionary_cards c ${scriptWhere} ORDER BY ${cardOrder} LIMIT ? OFFSET ?) c
      JOIN public_definitions d ON d.id=c.definitionId JOIN words w ON w.id=c.wordId ORDER BY ${cardOrder}`;
    // The fast path's SELECT placeholders precede its filtered subquery.
    return {countSql,resultsSql,values,page,limit,fastFeed:true};
  }
  return { countSql, resultsSql, values, page, limit };
}
