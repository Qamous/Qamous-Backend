import { ApiError, escapeLike, normalize } from './data.ts';

// Values are bound parameters; only the fixed sort expressions enter the SQL.
export function exploreQuery(params: URLSearchParams) {
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
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiError(400, 'Invalid pagination');
  const values: (string | number)[] = [];
  const filters = ['w.reportCount<=5', 'd.reportCount<=5'];
  if (query) {
    const columns = scope === 'words' ? ['w.searchText'] : scope === 'definitions' ? ['d.searchText'] : ['w.searchText', 'd.searchText'];
    filters.push(`(${columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    values.push(...columns.map(() => `%${escapeLike(normalize(query))}%`));
  }
  if (script !== 'both') { filters.push('d.isArabic=?'); values.push(script === 'ar' ? 1 : 0); }
  if (countries.length) { filters.push(`d.countryCode IN (${countries.map(() => '?').join(',')})`); values.push(...countries); }
  if (params.get('examples') === '1') filters.push("LENGTH(TRIM(COALESCE(d.example,'')))>0");
  const cte = `WITH matches AS (
    SELECT d.*, w.arabicWord, w.francoArabicWord, d.id AS definitionId,
      CASE WHEN d.isArabic=1 THEN w.arabicWord ELSE COALESCE(w.francoArabicWord,w.arabicWord) END AS word,
      (d.likeCount-d.dislikeCount) AS likeDislikeDifference,
      ROW_NUMBER() OVER(PARTITION BY w.id,d.isArabic ORDER BY (d.likeCount-d.dislikeCount) DESC,d.id) AS ranking
    FROM definitions d JOIN words w ON w.id=d.wordId WHERE ${filters.join(' AND ')}
  )`;
  const order = sort === 'newest' ? 'm.AddedTimestamp DESC,m.definitionId DESC' : sort === 'az' ? 'm.word COLLATE NOCASE,m.definitionId' : 'm.likeDislikeDifference DESC,m.definitionId';
  const countSql = `${cte} SELECT COUNT(*) AS total FROM matches WHERE ranking=1`;
  const resultsSql = `${cte} SELECT m.wordId,m.definitionId,m.word,m.arabicWord,m.francoArabicWord,
    m.definition,m.example,m.isArabic,m.countryCode,m.likeCount,m.dislikeCount,m.likeDislikeDifference,
    EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=m.definitionId AND r.userId=? AND r.liked=1) AS isLiked,
    EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=m.definitionId AND r.userId=? AND r.liked=0) AS isDisliked,
    EXISTS(SELECT 1 FROM "definition-reports" r WHERE r.definitionId=m.definitionId AND r.userId=?) AS isReported
    FROM matches m WHERE ranking=1 ORDER BY ${order} LIMIT ? OFFSET ?`;
  return { countSql, resultsSql, values, page, limit };
}
