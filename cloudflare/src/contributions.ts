import { ApiError, normalize, nowSql, positiveId, text, type Row } from './data.ts';
import { countryCodes } from '../../src/utils/country-codes.ts';

const optionalText = (value: unknown, field: string, max = 255) => value == null || value === '' ? null : text(value, field, max, false) || null;
function spellings(value: unknown, script: 'ar' | 'franco', primary: string | null) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new ApiError(400, 'Use at most 20 alternate spellings per script');
  const seen = new Set(primary ? [normalize(primary)] : []);
  return value.map(item => text(item, 'alternate spelling')).filter(spelling => {
    if ((script === 'ar') !== /\p{Script=Arabic}/u.test(spelling)) throw new ApiError(400, 'Use the correct script for each alternate spelling');
    const key = normalize(spelling);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function parseContribution(data: Row) {
  const requestId = text(data.requestId, 'requestId', 80);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new ApiError(400, 'Invalid requestId');
  const wordId = data.wordId == null ? null : positiveId(String(data.wordId));
  const arabicWord = wordId ? null : text(data.arabicWord, 'arabicWord');
  if (arabicWord && !/\p{Script=Arabic}/u.test(arabicWord)) throw new ApiError(400, 'Enter the word in Arabic');
  const francoArabicWord = optionalText(data.francoArabicWord, 'francoArabicWord');
  if (francoArabicWord && /\p{Script=Arabic}/u.test(francoArabicWord)) throw new ApiError(400, 'Use Latin letters for the Franco spelling');
  const arabicDefinition = optionalText(data.arabicDefinition, 'arabicDefinition', 10000);
  const englishDefinition = optionalText(data.englishDefinition, 'englishDefinition', 10000);
  if (!arabicDefinition && !englishDefinition) throw new ApiError(400, 'Write at least one definition in Arabic or English');
  const countryCode = data.countryCode ? text(data.countryCode, 'countryCode', 2).toUpperCase() : null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new ApiError(400, 'Invalid country');
  return { requestId, wordId, arabicWord, francoArabicWord, arabicDefinition, englishDefinition, countryCode,
    arabicExample: optionalText(data.arabicExample, 'arabicExample'), francoExample: optionalText(data.francoExample, 'francoExample'),
    arabicSpellings: spellings(data.arabicSpellings, 'ar', arabicWord),
    francoSpellings: spellings(data.francoSpellings, 'franco', francoArabicWord),
  };
}

export async function saveContribution(db: D1Database, userId: number, input: ReturnType<typeof parseContribution>, payloadHash: string) {
  const { requestId, wordId, arabicWord, francoArabicWord, countryCode } = input;
  const previous = await db.prepare('SELECT userId,payloadHash,wordId FROM contribution_submissions WHERE id=?').bind(requestId).first<Row>();
  if (previous && (previous.userId !== userId || previous.payloadHash !== payloadHash)) throw new ApiError(409, 'This request was already used for a different contribution');
  if (previous) {
    const definitions = await db.prepare('SELECT id FROM definitions WHERE submissionId=? ORDER BY id').bind(requestId).all<Row>();
    return { wordId: Number(previous.wordId), definitionIds: definitions.results.map(row => Number(row.id)) };
  }
  const countryName = countryCode ? Object.entries(countryCodes).find(([, code]) => code === countryCode)?.[0] : null;
  const countryExists = countryCode ? await db.prepare('SELECT countryCode FROM countries WHERE countryCode=?').bind(countryCode).first() : null;
  if (countryCode && !countryName && !countryExists) throw new ApiError(400, 'Choose a valid country');
  if (!previous) {
    const target = wordId
      ? await db.prepare('SELECT id,reportCount FROM words WHERE id=?').bind(wordId).first<Row>()
      : await db.prepare('SELECT id,reportCount FROM words WHERE arabicWord=? COLLATE NOCASE ORDER BY id LIMIT 1').bind(arabicWord).first<Row>();
    if (wordId && !target) throw new ApiError(404, 'Word not found');
    if (target && Number(target.reportCount) > 5) throw new ApiError(409, 'This word is unavailable');
  }
  const now = nowSql();
  const statements = [db.prepare(`INSERT INTO contribution_submissions(id,userId,payloadHash,createdAt) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET payloadHash=CASE WHEN contribution_submissions.userId=excluded.userId AND contribution_submissions.payloadHash=excluded.payloadHash THEN contribution_submissions.payloadHash ELSE NULL END`)
    .bind(requestId, userId, payloadHash, now)];
  if (countryCode && !countryExists) statements.push(db.prepare('INSERT OR IGNORE INTO countries(countryCode,countryName) VALUES(?,?)').bind(countryCode, countryName));
  if (!wordId) {
    statements.push(db.prepare(`INSERT INTO words(userId,arabicWord,francoArabicWord,createdAt,searchText)
      SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM words WHERE arabicWord=? COLLATE NOCASE)
      AND (SELECT wordId FROM contribution_submissions WHERE id=?) IS NULL`)
      .bind(userId, arabicWord, francoArabicWord, now, normalize(`${arabicWord} ${francoArabicWord || ''}`), arabicWord, requestId));
  }
  statements.push(db.prepare(`UPDATE contribution_submissions SET wordId=COALESCE(wordId,${wordId ? '?' : '(SELECT id FROM words WHERE arabicWord=? COLLATE NOCASE ORDER BY id LIMIT 1)'}) WHERE id=?`)
    .bind(wordId || arabicWord, requestId));
  if (francoArabicWord && !wordId) {
    statements.push(db.prepare(`UPDATE words SET francoArabicWord=?,searchText=? WHERE id=(SELECT wordId FROM contribution_submissions WHERE id=?) AND (francoArabicWord IS NULL OR francoArabicWord='')`)
      .bind(francoArabicWord, normalize(`${arabicWord} ${francoArabicWord}`), requestId));
  }
  for (const [script, values] of [['ar', input.arabicSpellings], ['franco', input.francoSpellings]] as const) {
    for (const spelling of values) statements.push(db.prepare(`INSERT INTO word_spellings(wordId,userId,script,spelling,searchText,createdAt)
      SELECT wordId,?,?,?,?,? FROM contribution_submissions WHERE id=? ON CONFLICT(wordId,script,searchText) DO NOTHING`)
      .bind(userId, script, spelling, normalize(spelling), now, requestId));
  }
  for (const [isArabic, definition] of [[1, input.arabicDefinition], [0, input.englishDefinition]] as const) {
    if (!definition) continue;
    statements.push(db.prepare(`INSERT INTO definitions(wordId,userId,countryCode,definition,example,arabicExample,isArabic,searchText,contributionPoints,submissionId)
      SELECT s.wordId,?,?,?,?,?,?,?,1+CASE WHEN EXISTS(SELECT 1 FROM definitions d WHERE d.wordId=s.wordId) THEN 0 ELSE 1 END,s.id
      FROM contribution_submissions s WHERE s.id=? AND NOT EXISTS(SELECT 1 FROM definitions d WHERE d.submissionId=s.id AND d.isArabic=?)`)
      .bind(userId, countryCode, definition, input.francoExample, input.arabicExample, isArabic, normalize(definition), requestId, isArabic));
  }
  statements.push(db.prepare('SELECT wordId FROM contribution_submissions WHERE id=?').bind(requestId));
  statements.push(db.prepare('SELECT id FROM definitions WHERE submissionId=? ORDER BY id').bind(requestId));
  let result: D1Result<Row>[];
  try { result = await db.batch<Row>(statements); }
  catch (error) {
    if (error instanceof Error && /NOT NULL constraint failed: contribution_submissions.payloadHash/.test(error.message)) throw new ApiError(409, 'This request was already used for a different contribution');
    throw error;
  }
  const savedWordId = Number(result.at(-2)?.results[0]?.wordId);
  if (!savedWordId) throw new ApiError(503, 'Could not save this contribution');
  return { wordId: savedWordId, definitionIds: result.at(-1)!.results.map(row => Number(row.id)) };
}
