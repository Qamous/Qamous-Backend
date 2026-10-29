import { ApiError, positiveId, joinWord, withWord, withSpellings, type Row } from './data.ts';
import { exploreQuery } from './explore.ts';
import { feedCandidatesSql, preparedFeedCandidatesSql, feedItemsQuery } from './feed.ts';
import { attachProvenance, licenseLink } from './provenance.ts';
import { seoIndex, seoShard, seoBucket, seoBrowse, seoDialect } from './seo.ts';
import { validatePublicSeed } from './public-cache-keys.ts';

export const RELATED_SAMPLE_SIZE = 100;
export const PUBLIC_CARD_BUCKET_SIZE = 100;
// LIMIT is deliberately inside the materialized country-index sample, before
// language, visibility, ranking and spelling work. A hostile country request
// cannot force a complete dialect scan simply because few rows are visible.
export const RELATED_CARDS_SQL = `/* qamous-read:4096 */ WITH sample AS MATERIALIZED (
  SELECT id FROM definitions INDEXED BY definitions_country WHERE countryCode=? ORDER BY id LIMIT ${RELATED_SAMPLE_SIZE}
), ranked AS (
  SELECT d.wordId,d.id AS definitionId,w.canonicalArabic AS arabicWord,w.francoArabicWord,
    CASE WHEN d.isArabic=1 THEN w.canonicalArabic ELSE COALESCE(w.francoArabicWord,w.canonicalArabic) END AS word,
    d.isArabic,d.countryCode,ROW_NUMBER() OVER(PARTITION BY w.canonicalArabic ORDER BY d.likeCount-d.dislikeCount DESC,d.id) AS ranking,
    d.likeCount-d.dislikeCount AS score
  FROM sample s JOIN public_definitions d ON d.id=s.id JOIN words w ON w.id=d.wordId
  WHERE d.isArabic=? AND d.reportCount+w.reportCount<5
) SELECT wordId,definitionId,arabicWord,francoArabicWord,word,isArabic,countryCode
  FROM ranked WHERE ranking=1 ORDER BY score DESC,definitionId LIMIT 6`;

export function relatedKey(country: string | undefined, script: string | undefined) {
  const code=(country||'').toUpperCase();
  if(!/^[A-Z]{2}$/.test(code) || !['ar','franco'].includes(script||'')) throw new ApiError(400,'Invalid related words option');
  return `related:${code}:${script}`;
}

export function exploreCacheKey(params: URLSearchParams) {
  // Parsing before choosing a cache key prevents equivalent orderings and
  // irrelevant tracking parameters from producing extra database misses.
  exploreQuery(params);
  const clean = new URLSearchParams();
  for (const name of ['q','script','scope','sort','page','limit','examples','ids']) {
    const value=params.get(name); if(value!==null && value!=='') clean.set(name,value.trim());
  }
  for(const code of [...new Set(params.getAll('country').map(code=>code.toUpperCase()))].sort()) clean.append('country',code);
  return 'explore:'+clean.toString();
}

// Bound both alias and definition fan-out BEFORE visibility filters or payload
// joins. Larger groups use the complete legacy reader; no meaning is truncated.
// These index walks touch at most 17 words and 51 definitions. The 4096-row
// reservation includes the bounded materialized joins and payload lookups.
export const PREPARED_WORD_SQL = `/* qamous-read:4096 */ WITH variants AS MATERIALIZED (
  SELECT w.id,w.reportCount FROM words w INDEXED BY words_canonical_arabic
  WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=?) LIMIT 17
), candidates AS MATERIALIZED (
  SELECT d.id,d.wordId,d.reportCount,d.displayLanguage
  FROM variants v CROSS JOIN definitions d INDEXED BY definitions_word
  WHERE d.wordId=v.id LIMIT 51
), bounds AS MATERIALIZED (
  SELECT (SELECT COUNT(*) FROM variants) AS aliases,
    (SELECT COUNT(*) FROM candidates) AS meanings,
    (SELECT MIN(id) FROM variants WHERE reportCount<5) AS canonicalWordId
) SELECT d.id,b.canonicalWordId,p.payload,
  (b.aliases=17 OR b.meanings=51) AS incomplete
  FROM bounds b
  LEFT JOIN candidates d ON b.aliases<17 AND b.meanings<51
  LEFT JOIN variants w ON w.id=d.wordId
  LEFT JOIN public_card_payloads p ON p.definitionId=d.id
  WHERE b.aliases=17 OR b.meanings=51
    OR (d.displayLanguage!='hidden' AND d.reportCount+w.reportCount<5)
  ORDER BY d.id`;

export async function publicWord(db: D1Database,id: number,prepared=false) {
  if(prepared) {
    const values=await db.prepare(PREPARED_WORD_SQL).bind(id).all<{id:number;canonicalWordId:number;payload:string|null;incomplete:number}>();
    if(!values.results.length)throw new ApiError(404,'Word not found');
    if(values.results.every(row=>!row.incomplete&&typeof row.payload==='string'))return values.results.map(value=>{
      const card=JSON.parse(value.payload!) as Row;
      validatePublicSeed('items:'+value.id,[card]);
      if(!card||typeof card!=='object'||Number(card.definitionId??card.id)!==value.id)throw new ApiError(503,'Invalid prepared public word');
      // Feed cards are flat and carry a sorting-only difference. Word pages
      // retain their established nested word object and every visible sense.
      const {likeDislikeDifference,...row}=card;
      return {...withWord({...row,definitionId:value.id,canonicalWordId:value.canonicalWordId,isLiked:false,isDisliked:false,isReported:false}),
        arabicWord:card.arabicWord,francoArabicWord:card.francoArabicWord};
    });
  }
  const canonical=await db.prepare(`SELECT MIN(variant.id) AS id FROM words input
    JOIN words variant ON variant.canonicalArabic=input.canonicalArabic AND variant.reportCount<5
    WHERE input.id=?`).bind(id).first<{id:number|null}>();
  if(!canonical?.id) throw new ApiError(404,'Word not found');
  const rows=(await db.prepare(joinWord+` WHERE w.canonicalArabic=(SELECT canonicalArabic FROM words WHERE id=?)
    AND (d.reportCount+w.reportCount)<5 ORDER BY d.id`).bind(id).all<Row>()).results;
  if(!rows.length) throw new ApiError(404,'Word not found');
  // Keep every meaning and the /definitions/word shape. SEO previously returned
  // only the best meaning in each language, forcing a second SSR read.
  return attachProvenance(db,rows.map(row=>withWord({...row,definitionId:row.id,canonicalWordId:canonical.id,
    isLiked:false,isDisliked:false,isReported:false})));
}

export async function publicExplore(db: D1Database, params: URLSearchParams) {
  const query=exploreQuery(params),{countSql,resultsSql,values,page,limit}=query;
  const [count,rows]=await db.batch<Row>([
    db.prepare(countSql).bind(...values),
    db.prepare(resultsSql).bind(...(query.fastFeed?[0,0,0,...values,limit,(page-1)*limit]:[...values,0,0,0,limit,(page-1)*limit])),
  ]);
  return {results:await attachProvenance(db,rows.results.map(withSpellings)),total:Number(count.results[0]?.total||0),page,limit};
}

export async function personalReactions(db: D1Database,rows: Row[],userId: number) {
  if(!userId || !rows.length) return rows;
  const ids=[...new Set(rows.map(row=>Number(row.definitionId??row.id)))];
  const flags=new Map<number,Row>();
  for(let offset=0;offset<ids.length;offset+=80) {
    const part=ids.slice(offset,offset+80);
    const requested=`WITH requested(id) AS (VALUES ${part.map(()=>'(?)').join(',')})`;
    const results=await db.prepare(`${requested} SELECT id,
      EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=requested.id AND r.userId=? AND r.liked=1) AS isLiked,
      EXISTS(SELECT 1 FROM "definition-likes-dislikes" r WHERE r.definitionId=requested.id AND r.userId=? AND r.liked=0) AS isDisliked,
      EXISTS(SELECT 1 FROM "definition-reports" r WHERE r.definitionId=requested.id AND r.userId=?) AS isReported
      FROM requested`).bind(...part,userId,userId,userId).all<Row>();
    for(const row of results.results) flags.set(Number(row.id),row);
  }
  return rows.map(row=>{const own=flags.get(Number(row.definitionId??row.id));return {...row,
    isLiked:!!own?.isLiked,isDisliked:!!own?.isDisliked,isReported:!!own?.isReported};});
}

export function publicItemBuckets(params: URLSearchParams): string[] {
  const {values}=feedItemsQuery(params);
  return [...new Set(values.map(id=>'cards:'+Math.floor(id/PUBLIC_CARD_BUCKET_SIZE)))];
}

export function publicItemsFromBuckets(params: URLSearchParams,buckets: Row[][]) {
  const {values,limit}=feedItemsQuery(params),script=params.get('script')||'both';
  const byId=new Map(buckets.flat().map(row=>[Number(row.definitionId??row.id),row]));
  const results=values.map(id=>byId.get(id)).filter((row):row is Row=>!!row &&
    (script==='both'||Number(row.isArabic)===(script==='ar'?1:0)));
  return {results,total:results.length,page:1,limit};
}

// Canonicalize only the cache identity. The caller's random order is restored
// by publicItemsFromBuckets; permutations must not create different cache fills.
export function publicItemsKey(params: URLSearchParams): string {
  const {values}=feedItemsQuery(params);
  return 'items:'+values.slice().sort((a,b)=>a-b).join(',');
}

export async function publicItems(db:D1Database,ids:number[],prepared=false):Promise<Row[]> {
  const ready=new Map<number,Row>();
  if(prepared) {
    const stored=await db.prepare(`SELECT definitionId,payload FROM public_card_payloads WHERE definitionId IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<{definitionId:number;payload:string}>();
    for(const entry of stored.results) {
      const row=JSON.parse(entry.payload) as Row;
      validatePublicSeed('items:'+entry.definitionId,[row]);
      if(!row||typeof row!=='object'||Array.isArray(row)||Number(row.definitionId??row.id)!==entry.definitionId)throw new ApiError(503,'Invalid prepared public card');
      ready.set(entry.definitionId,row);
    }
  }
  const missing=ids.filter(id=>!ready.has(id));
  if(!missing.length)return ids.map(id=>ready.get(id)!);
  // The public cache accepts at most 50 exact IDs. A cold ten-card request
  // enriches ten definitions, rather than ten unrelated 100-definition ranges.
  const marks=missing.map(()=>'?').join(',');
  const rows=await db.prepare(`SELECT d.*,d.id AS definitionId,
    CASE WHEN d.isArabic=1 THEN d.arabicWord ELSE COALESCE(d.francoArabicWord,d.arabicWord) END AS word,
    d.likeCount-d.dislikeCount AS likeDislikeDifference,0 AS isLiked,0 AS isDisliked,0 AS isReported
    FROM (${joinWord}) d WHERE d.id IN (${marks}) AND d.reportCount<=5 AND d.wordReportCount<=5 ORDER BY d.id`)
    .bind(...missing).all<Row>();
  for(const row of await attachProvenance(db,rows.results.map(withSpellings)))ready.set(Number(row.definitionId),row);
  return ids.map(id=>ready.get(id)).filter((row):row is Row=>!!row);
}

export async function resolvePublicData(db: D1Database,key: string,preparedCards=false): Promise<unknown> {
  if(key==='posts') return (await db.prepare('SELECT id,userId,title,content,createdSeconds,createdNanoseconds FROM posts ORDER BY createdSeconds DESC,createdNanoseconds DESC').all<Row>()).results.map(p=>({id:p.id,userId:p.userId,title:p.title,content:p.content,createdAt:{seconds:p.createdSeconds,nanoseconds:p.createdNanoseconds}}));
  if(key==='sources') return (await db.prepare('SELECT id,name,sourceUrl,license,licenseUrl,rightsStatus,credit,notice,attributionRequired,releaseHash FROM import_sources ORDER BY name').all<Row>()).results.map(row=>({...row,licenseUrl:licenseLink(String(row.license),String(row.licenseUrl))}));
  if(key==='countries') return (await db.prepare('SELECT * FROM countries ORDER BY countryName').all()).results;
  if(/^feed:[01]$/.test(key)) return (await db.prepare(preparedCards?preparedFeedCandidatesSql:feedCandidatesSql).bind(Number(key.slice(-1))).all()).results;
  if(/^word:[1-9]\d*$/.test(key)) return publicWord(db,positiveId(key.slice(5)),preparedCards);
  if(key.startsWith('items:')) {
    const params=new URLSearchParams({ids:key.slice(6)});
    if(publicItemsKey(params)!==key) throw new ApiError(400,'Invalid public item resource');
    return publicItems(db,feedItemsQuery(params).values,preparedCards);
  }
  if(/^cards:\d+$/.test(key)) {
    const bucket=Number(key.slice(6));
    if(!Number.isSafeInteger(bucket)||bucket<0||bucket>Math.floor(Number.MAX_SAFE_INTEGER/PUBLIC_CARD_BUCKET_SIZE)-1) throw new ApiError(400,'Invalid card bucket');
    const rows=await db.prepare(`SELECT d.*,d.id AS definitionId,
      CASE WHEN d.isArabic=1 THEN d.arabicWord ELSE COALESCE(d.francoArabicWord,d.arabicWord) END AS word,
      d.likeCount-d.dislikeCount AS likeDislikeDifference,0 AS isLiked,0 AS isDisliked,0 AS isReported
      FROM (${joinWord}) d WHERE d.id>=? AND d.id<? AND d.reportCount<=5 AND d.wordReportCount<=5 ORDER BY d.id`)
      .bind(bucket*PUBLIC_CARD_BUCKET_SIZE,(bucket+1)*PUBLIC_CARD_BUCKET_SIZE).all<Row>();
    return attachProvenance(db,rows.results.map(withSpellings));
  }
  const related=/^related:([A-Z]{2}):(ar|franco)$/.exec(key);
  if(related) return {results:(await db.prepare(RELATED_CARDS_SQL).bind(related[1],related[2]==='ar'?1:0).all()).results,page:1,limit:6};
  if(key.startsWith('explore:')) return publicExplore(db,new URLSearchParams(key.slice(8)));
  if(key==='seo-index') return seoIndex(db);
  if(key.startsWith('seo-shard:')) return seoShard(db,seoBucket(key.slice(10)));
  if(key.startsWith('seo-browse:')) {
    const [,language,after]=key.split(':');return seoBrowse(db,language,after||null);
  }
  if(key.startsWith('seo-dialect:')) return seoDialect(db,decodeURIComponent(key.slice(12)));
  throw new ApiError(400,'Invalid public data resource');
}
