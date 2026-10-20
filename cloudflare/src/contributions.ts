import { ApiError, normalize, nowSql, positiveId, text, type Row } from './data.ts';
import { countryCodes } from '../../src/utils/country-codes.ts';
import { stripTashkil, hasArabicLetter } from './arabic-model.mjs';

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
  const originalWord = wordId ? null : text(data.arabicWord, 'arabicWord').normalize('NFC');
  if (originalWord && !hasArabicLetter(originalWord)) throw new ApiError(400, 'Enter the word in Arabic');
  const arabicWord = originalWord ? stripTashkil(originalWord) : null;
  const arabicForm = optionalText(data.arabicForm, 'arabicForm')?.normalize('NFC') || originalWord;
  if (arabicForm && !hasArabicLetter(arabicForm)) throw new ApiError(400, 'Enter the reading in Arabic');
  if (arabicWord && arabicForm && stripTashkil(arabicForm)!==arabicWord) throw new ApiError(400, 'Add vowels to the same word, or correct the word above');
  const francoArabicWord = optionalText(data.francoArabicWord, 'francoArabicWord');
  if (francoArabicWord && /\p{Script=Arabic}/u.test(francoArabicWord)) throw new ApiError(400, 'Use Latin letters for the Franco spelling');
  const arabicDefinition = optionalText(data.arabicDefinition, 'arabicDefinition', 10000);
  const englishDefinition = optionalText(data.englishDefinition, 'englishDefinition', 10000);
  if (!arabicDefinition && !englishDefinition) throw new ApiError(400, 'Write at least one definition in Arabic or English');
  const countryCode = data.countryCode ? text(data.countryCode, 'countryCode', 2).toUpperCase() : null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new ApiError(400, 'Invalid country');
  const transliteration=optionalText(data.transliteration,'transliteration'),ipa=optionalText(data.ipa,'ipa');
  if ([transliteration,ipa].some(v=>v&&/\p{Script=Arabic}/u.test(v))) throw new ApiError(400,'Use the Arabic reading field for Arabic text');
  return { requestId, wordId, arabicWord, arabicForm, francoArabicWord, arabicDefinition, englishDefinition, countryCode,
    transliteration,ipa,dialect:optionalText(data.dialect,'dialect',100),englishExample:optionalText(data.englishExample,'englishExample',2000),
    arabicExample: optionalText(data.arabicExample, 'arabicExample',2000), francoExample: optionalText(data.francoExample, 'francoExample',2000),
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
  let chosenArabic=arabicWord;
  if (!previous) {
    const target = wordId
      ? await db.prepare('SELECT id,reportCount,canonicalArabic FROM words WHERE id=?').bind(wordId).first<Row>()
      : await db.prepare('SELECT id,reportCount,canonicalArabic FROM words WHERE canonicalArabic=? ORDER BY id LIMIT 1').bind(arabicWord).first<Row>();
    if (wordId && !target) throw new ApiError(404, 'Word not found');
    if (target && Number(target.reportCount) > 5) throw new ApiError(409, 'This word is unavailable');
    chosenArabic=String(target?.canonicalArabic || arabicWord || '');
    if(input.arabicForm&&stripTashkil(input.arabicForm)!==chosenArabic)throw new ApiError(400,'Add vowels to the selected word, or choose another word');
  }
  const now = nowSql();
  const statements = [db.prepare(`INSERT INTO contribution_submissions(id,userId,payloadHash,createdAt,arabicForm,francoForm,transliteration,ipa,englishExample,dialect,arabicVariants,francoVariants) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET payloadHash=CASE WHEN contribution_submissions.userId=excluded.userId AND contribution_submissions.payloadHash=excluded.payloadHash THEN contribution_submissions.payloadHash ELSE NULL END`)
    .bind(requestId, userId, payloadHash, now,input.arabicForm||chosenArabic,francoArabicWord,input.transliteration,input.ipa,input.englishExample,input.dialect,JSON.stringify(input.arabicSpellings),JSON.stringify(input.francoSpellings))];
  if (countryCode && !countryExists) statements.push(db.prepare('INSERT OR IGNORE INTO countries(countryCode,countryName) VALUES(?,?)').bind(countryCode, countryName));
  if (!wordId) {
    statements.push(db.prepare(`INSERT INTO words(userId,arabicWord,francoArabicWord,createdAt,searchText,canonicalArabic)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM words WHERE canonicalArabic=?)
      AND (SELECT wordId FROM contribution_submissions WHERE id=?) IS NULL`)
      .bind(userId, arabicWord, francoArabicWord, now, normalize(`${arabicWord} ${francoArabicWord || ''}`),arabicWord, arabicWord, requestId));
  }
  statements.push(db.prepare(`UPDATE contribution_submissions SET wordId=COALESCE(wordId,${wordId ? '?' : '(SELECT id FROM words WHERE canonicalArabic=? ORDER BY id LIMIT 1)'}) WHERE id=?`)
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
      SELECT s.wordId,?,?,?,?,?,?,?,1+CASE WHEN EXISTS(SELECT 1 FROM definitions d JOIN words w ON w.id=d.wordId WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=s.wordId)) THEN 0 ELSE 1 END,s.id
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
