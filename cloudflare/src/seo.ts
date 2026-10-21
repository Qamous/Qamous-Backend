import { ApiError } from './data.ts';

export const SEO_BUCKET_SIZE = 1000;
export const SEO_BROWSE_SIZE = 80;

export function seoBucket(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new ApiError(404, 'Sitemap not found');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > Math.floor(Number.MAX_SAFE_INTEGER / SEO_BUCKET_SIZE) - 1) {
    throw new ApiError(404, 'Sitemap not found');
  }
  return number;
}

// The word's established canonical ID is the first visible ID in its exact
// Arabic spelling group. Language existence is checked against the same public
// definition threshold used by /definitions/word/:id.
export const SEO_SHARD_SQL = `SELECT w.id,
  EXISTS(SELECT 1 FROM words variant JOIN public_definitions d ON d.wordId=variant.id
    WHERE variant.canonicalArabic=w.canonicalArabic AND d.isArabic=0
      AND d.reportCount+variant.reportCount<5) AS en,
  EXISTS(SELECT 1 FROM words variant JOIN public_definitions d ON d.wordId=variant.id
    WHERE variant.canonicalArabic=w.canonicalArabic AND d.isArabic=1
      AND d.reportCount+variant.reportCount<5) AS ar
  FROM words w WHERE w.id>=? AND w.id<? AND w.reportCount<5
    AND w.id=(SELECT MIN(first.id) FROM words first
      WHERE first.canonicalArabic=w.canonicalArabic AND first.reportCount<5)
  ORDER BY w.id`;

export const SEO_BROWSE_SQL = `SELECT c.wordId,c.canonicalArabic,c.sortWord,w.francoArabicWord,
  (SELECT MIN(first.id) FROM words first
    WHERE first.canonicalArabic=c.canonicalArabic AND first.reportCount<5) AS canonicalId
  FROM dictionary_cards c JOIN words w ON w.id=c.wordId
  WHERE c.isArabic=?
    AND (?='' OR c.sortWord COLLATE NOCASE>? COLLATE NOCASE
      OR (c.sortWord COLLATE NOCASE=? COLLATE NOCASE AND c.canonicalArabic>?))
    AND EXISTS(SELECT 1 FROM words variant JOIN public_definitions d ON d.wordId=variant.id
      WHERE variant.canonicalArabic=c.canonicalArabic AND d.isArabic=c.isArabic
        AND d.reportCount+variant.reportCount<5)
  ORDER BY c.sortWord COLLATE NOCASE,c.canonicalArabic LIMIT ?`;

export async function seoIndex(db: D1Database) {
  const [buckets,countries] = await db.batch<{bucket:number;countryCode:string;countryName:string}>([
    db.prepare('SELECT bucket FROM seo_sitemap_buckets ORDER BY bucket'),
    db.prepare(`SELECT c.countryCode,c.countryName FROM countries c
      WHERE EXISTS(SELECT 1 FROM public_definitions d JOIN words w ON w.id=d.wordId
        WHERE d.countryCode=c.countryCode AND d.reportCount+w.reportCount<5)
      ORDER BY c.countryName`),
  ]);
  return {buckets:buckets.results.map(row=>Number(row.bucket)),countries:countries.results};
}

export async function seoShard(db: D1Database,bucket: number) {
  const start=bucket*SEO_BUCKET_SIZE;
  const exists=await db.prepare('SELECT 1 FROM seo_sitemap_buckets WHERE bucket=?').bind(bucket).first();
  if (!exists) throw new ApiError(404,'Sitemap not found');
  return (await db.prepare(SEO_SHARD_SQL).bind(start,start+SEO_BUCKET_SIZE).all()).results;
}

export async function seoBrowse(db: D1Database,language: string,after: string | null) {
  if (!['en','ar'].includes(language)) throw new ApiError(404,'Browse page not found');
  const isArabic=language==='ar'?1:0;
  let cursor={sortWord:'',canonicalArabic:''};
  if (after!==null) {
    if (!/^[1-9]\d*$/.test(after) || !Number.isSafeInteger(Number(after))) throw new ApiError(404,'Browse page not found');
    const row=await db.prepare('SELECT sortWord,canonicalArabic FROM dictionary_cards WHERE wordId=? AND isArabic=?')
      .bind(Number(after),isArabic).first<typeof cursor>();
    if (!row) throw new ApiError(404,'Browse page not found');
    cursor=row;
  }
  const rows=(await db.prepare(SEO_BROWSE_SQL)
    .bind(isArabic,cursor.sortWord,cursor.sortWord,cursor.sortWord,cursor.canonicalArabic,SEO_BROWSE_SIZE+1).all()).results;
  const visible=rows.slice(0,SEO_BROWSE_SIZE);
  return {language,words:visible,next:rows.length>SEO_BROWSE_SIZE?Number(visible.at(-1)?.wordId):null};
}

export async function seoRelated(db: D1Database,countryCode: unknown,canonicalArabic: unknown) {
  if (typeof countryCode!=='string' || !/^[A-Z]{2}$/.test(countryCode)) return {country:null,words:[]};
  const country=await db.prepare('SELECT countryCode,countryName FROM countries WHERE countryCode=?').bind(countryCode).first();
  if (!country) return {country:null,words:[]};
  const words=(await db.prepare(`WITH candidates AS (
      SELECT d.wordId FROM public_definitions d JOIN words w ON w.id=d.wordId
      WHERE d.countryCode=? AND d.reportCount+w.reportCount<5 AND w.canonicalArabic<>?
      ORDER BY d.id LIMIT 100
    ) SELECT MIN(first.id) AS id,w.canonicalArabic,MAX(w.francoArabicWord) AS francoArabicWord
    FROM candidates d JOIN words w ON w.id=d.wordId
    JOIN words first ON first.canonicalArabic=w.canonicalArabic AND first.reportCount<5
    GROUP BY w.canonicalArabic ORDER BY w.canonicalArabic LIMIT 5`)
    .bind(countryCode,String(canonicalArabic||'')).all()).results;
  return {country,words};
}

export async function seoDialect(db: D1Database,name: string) {
  if (!name || name.length>100) throw new ApiError(404,'Dialect not found');
  const country=await db.prepare('SELECT countryCode,countryName FROM countries WHERE countryName=?').bind(name).first<{countryCode:string;countryName:string}>();
  if (!country) throw new ApiError(404,'Dialect not found');
  // The country index bounds this sample independently of collection size.
  // Complete discovery is provided by the keyset browse pages and sitemaps.
  const words=(await db.prepare(`WITH candidates AS (
      SELECT d.wordId FROM public_definitions d JOIN words visible ON visible.id=d.wordId
      WHERE d.countryCode=? AND d.reportCount+visible.reportCount<5 ORDER BY d.id LIMIT 100
    ) SELECT MIN(first.id) AS id,w.canonicalArabic,MAX(w.francoArabicWord) AS francoArabicWord
    FROM candidates d JOIN words w ON w.id=d.wordId
    JOIN words first ON first.canonicalArabic=w.canonicalArabic AND first.reportCount<5
    GROUP BY w.canonicalArabic ORDER BY w.canonicalArabic LIMIT 24`).bind(country.countryCode).all()).results;
  return {country,words};
}
