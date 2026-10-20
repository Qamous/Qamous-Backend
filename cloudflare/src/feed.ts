import { ApiError, joinWord, type Row } from './data.ts';

interface Candidate { definitionId: number; likeCount: number; dislikeCount: number }

export function feedWeight(likes: number, dislikes: number): number {
  return 0.75 + 0.5 * (likes + 3) / (likes + dislikes + 6);
}

// Exponential races give a weighted permutation without replacement. The
// browser retains only this ID snapshot; voting never reshuffles a visit.
export function shuffledFeed(rows: Candidate[], random = Math.random): number[] {
  return rows.map(row => ({ id: row.definitionId,
    key: -Math.log(1 - random()) / feedWeight(row.likeCount, row.dislikeCount),
  })).sort((a, b) => a.key - b.key || a.id - b.id).map(row => row.id);
}

// Reuse the dictionary's public source and moderation rules. The subquery is
// flattened by SQLite, so unused card text/spelling columns are not fetched.
export const feedCandidatesSql = `WITH requested(isArabic) AS (VALUES (?)) SELECT d.id AS definitionId,d.likeCount,d.dislikeCount
 FROM dictionary_cards c JOIN public_definitions d ON d.id=c.definitionId
 JOIN words w ON w.id=d.wordId CROSS JOIN requested r WHERE (c.isArabic=r.isArabic OR NOT EXISTS(SELECT 1 FROM dictionary_cards preferred WHERE preferred.canonicalArabic=c.canonicalArabic AND preferred.isArabic=r.isArabic)) AND d.reportCount<=5 AND w.reportCount<=5`;

export function feedScript(value: string | undefined): number {
  if (value !== 'ar' && value !== 'franco') throw new ApiError(400, 'Invalid feed script');
  return value === 'ar' ? 1 : 0;
}

// Hydrate an immutable slice through /word/explore so its existing public
// serialization (including source credits) and personal reaction flags apply.
export function feedItemsQuery(params: URLSearchParams) {
  const raw = params.get('ids') || '';
  if (!/^\d+(,\d+)*$/.test(raw) || raw.length > 850) throw new ApiError(400, 'Invalid feed IDs');
  const values = raw.split(',').map(Number);
  if (values.length > 50 || new Set(values).size !== values.length || values.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new ApiError(400, 'Invalid feed IDs');
  }
  const requested = `WITH requested(id,position) AS (VALUES ${values.map((_, i) => `(?,${i})`).join(',')})`;
  const from = `FROM (${joinWord}) d JOIN requested r ON r.id=d.id WHERE d.reportCount<=5 AND d.wordReportCount<=5`;
  return {
    countSql: `${requested} SELECT COUNT(*) AS total ${from}`,
    resultsSql: `${requested} SELECT d.*,d.id AS definitionId,
      CASE WHEN d.isArabic=1 THEN d.arabicWord ELSE COALESCE(d.francoArabicWord,d.arabicWord) END AS word,
      d.likeCount-d.dislikeCount AS likeDislikeDifference,
      EXISTS(SELECT 1 FROM "definition-likes-dislikes" v WHERE v.definitionId=d.id AND v.userId=? AND v.liked=1) AS isLiked,
      EXISTS(SELECT 1 FROM "definition-likes-dislikes" v WHERE v.definitionId=d.id AND v.userId=? AND v.liked=0) AS isDisliked,
      EXISTS(SELECT 1 FROM "definition-reports" v WHERE v.definitionId=d.id AND v.userId=?) AS isReported
      ${from} ORDER BY r.position LIMIT ? OFFSET ?`,
    values, page: 1, limit: values.length, fastFeed: false,
  };
}

export type FeedCandidate = Candidate & Row;
