import { ApiError, type Row } from './data.ts';
import { stripTashkil } from './arabic-model.mjs';
import { countryCodes } from '../../src/utils/country-codes.ts';

const PAGE_SIZE=128;
const MAX_SELECTORS=4096;
const MAX_METADATA_ROWS=32768;
const CARD_BUCKET_SIZE=100;
const SEO_BUCKET_SIZE=1000;
const id=(value:unknown):number|null=>{
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>0?number:null;
};
const string=(value:unknown)=>typeof value==='string'?value.trim():'';

// /word writes use this SQL-trigger normalization, which intentionally differs
// from contribution parsing (NFC + all whitespace). Match the actual stored
// canonical group, including its three passes of ASCII-space collapsing.
function wordCanonical(value:string):string {
  return value.replace(/[\u064b-\u0652\u0670\u0640]/gu,'')
    .replace(/ {2}/g,' ').replace(/ {2}/g,' ').replace(/ {2}/g,' ').replace(/^ +| +$/g,'');
}

class Scope {
  readonly selectors=new Set<string>();
  private readonly groups=new Set<string>();
  private readonly words=new Set<number>();
  private readonly countries=new Map<string,Row|undefined>();
  private metadataRows=0;
  private readonly db:D1Database;
  constructor(db:D1Database) {this.db=db;}
  add(...selectors:string[]) {
    for(const selector of selectors)this.selectors.add(selector);
    if(this.selectors.size>MAX_SELECTORS)throw new ApiError(503,'This change requires a larger cache maintenance operation');
  }
  async rows(sql:string,...values:unknown[]):Promise<Row[]> {
    // This is always the caller's guarded D1 facade. Failed admission or SQL
    // must abort scope resolution; an empty fallback would publish stale data.
    const result=await this.db.prepare(sql).bind(...values).all<Row>();
    if(!result.success||!Array.isArray(result.results))throw new ApiError(503,'Could not resolve the affected public content');
    this.metadataRows+=result.results.length;
    if(this.metadataRows>MAX_METADATA_ROWS)throw new ApiError(503,'This change requires a larger cache maintenance operation');
    return result.results;
  }
  async first(sql:string,...values:unknown[]):Promise<Row|undefined> {
    return (await this.rows(sql,...values))[0];
  }
  discovery(index=true) {this.add('feed:*','explore:*','seo-browse:*');if(index)this.add('seo-index');}
  unknownDictionary() {
    // Never replace an incomplete group with word:*: at the read ceiling that
    // would discard every usable snapshot. Reject before submitting the write.
    throw new ApiError(503,'Could not resolve the affected public content');
  }
  dialect(name:unknown) {
    if(typeof name!=='string'||!name)return;
    let encoded:string;
    try {encoded=encodeURIComponent(name);}catch {this.add('seo-dialect:*');return;}
    // A literal asterisk in a country name must not become a selector glob.
    this.add(encoded.includes('*')?'seo-dialect:*':'seo-dialect:'+encoded);
  }
  async country(code:unknown,fallbackName?:string) {
    if(code==null||code==='')return false;
    if(typeof code!=='string'||!/^[A-Z]{2}$/.test(code)) {
      this.add('related:*','seo-dialect:*');return false;
    }
    this.add(`related:${code}:*`);
    if(this.countries.has(code)){if(fallbackName)this.dialect(fallbackName);return !!this.countries.get(code);}
    const row=await this.first('SELECT countryName FROM countries WHERE countryCode=?',code);
    this.countries.set(code,row);
    this.dialect(row?.countryName||fallbackName);
    if(!row&&!fallbackName)this.add('seo-dialect:*');
    return !!row;
  }
  async definitions(wordId:number) {
    let cursor:Row|undefined;
    for(;;) {
      // definitions_word(wordId,isArabic,rowid) supports both this ordering and
      // the keyset range; LIMIT alone would not bound a filtered table scan.
      const rows=await this.rows(`/* qamous-read:4000 */ SELECT id,isArabic,countryCode FROM definitions INDEXED BY definitions_word
        WHERE wordId=? ${cursor?'AND (isArabic,id)>(?,?)':''} ORDER BY isArabic,id LIMIT ${PAGE_SIZE}`,
        wordId,...(cursor?[cursor.isArabic,cursor.id]:[]));
      for(const row of rows) {
        const definitionId=id(row.id);
        if(!definitionId){this.unknownDictionary();continue;}
        this.add('cards:'+Math.floor(definitionId/CARD_BUCKET_SIZE));
        await this.country(row.countryCode);
      }
      if(rows.length<PAGE_SIZE)break;
      cursor=rows.at(-1);
    }
  }
  async group(canonical:unknown) {
    if(typeof canonical!=='string'){this.unknownDictionary();return;}
    if(this.groups.has(canonical))return;
    this.groups.add(canonical);
    let after=0;
    for(;;) {
      const rows=await this.rows(`/* qamous-read:4000 */ SELECT id FROM words INDEXED BY words_canonical_arabic
        WHERE canonicalArabic=? AND id>? ORDER BY id LIMIT ${PAGE_SIZE}`,canonical,after);
      for(const row of rows) {
        const wordId=id(row.id);
        if(!wordId){this.unknownDictionary();continue;}
        this.add('word:'+wordId,'seo-shard:'+Math.floor(wordId/SEO_BUCKET_SIZE));
        if(!this.words.has(wordId)){this.words.add(wordId);await this.definitions(wordId);}
      }
      if(rows.length<PAGE_SIZE)break;
      const last=id(rows.at(-1)?.id);
      if(last===null||last<=after)throw new ApiError(503,'Could not resolve the affected public content');
      after=last;
    }
  }
  async word(value:unknown) {
    const wordId=id(value);if(wordId===null)return;
    this.add('word:'+wordId,'seo-shard:'+Math.floor(wordId/SEO_BUCKET_SIZE));
    if(this.words.has(wordId))return;
    const row=await this.first('SELECT id,canonicalArabic FROM words WHERE id=?',wordId);
    if(row)await this.group(row.canonicalArabic);
  }
  async definition(value:unknown) {
    const definitionId=id(value);if(definitionId===null)return;
    this.add('cards:'+Math.floor(definitionId/CARD_BUCKET_SIZE));
    const row=await this.first('SELECT wordId FROM definitions WHERE id=?',definitionId);
    if(row){if(id(row.wordId)===null)this.unknownDictionary();else await this.word(row.wordId);}
  }
  async definitionsInCountry(code:string) {
    let after=0;
    for(;;) {
      const rows=await this.rows(`/* qamous-read:4000 */ SELECT id,wordId FROM definitions INDEXED BY definitions_country
        WHERE countryCode=? AND id>? ORDER BY id LIMIT ${PAGE_SIZE}`,code,after);
      for(const row of rows) {
        if(id(row.wordId)===null)this.unknownDictionary();
        await this.word(row.wordId);
      }
      if(rows.length<PAGE_SIZE)break;
      const last=id(rows.at(-1)?.id);
      if(last===null||last<=after)throw new ApiError(503,'Could not resolve the affected public content');
      after=last;
    }
  }
  async account(userId:number) {
    // Ownership is archived; deleting this user's reactions also changes other
    // authors' counters and the chosen dictionary card for those word groups.
    // The ownership scans have leading userId indexes. Reactions do not, so
    // that scan deliberately retains the guard's conservative default cost.
    const ownedWords=await this.rows(`/* qamous-read:20000 */ SELECT id FROM words INDEXED BY words_owner WHERE userId=? LIMIT ${MAX_SELECTORS+1}`,userId);
    const authored=await this.rows(`/* qamous-read:20000 */ SELECT wordId FROM definitions INDEXED BY definitions_user WHERE userId=? LIMIT ${MAX_SELECTORS+1}`,userId);
    const voted=await this.rows(`SELECT d.wordId FROM "definition-likes-dislikes" r JOIN definitions d ON d.id=r.definitionId WHERE r.userId=? LIMIT ${MAX_SELECTORS+1}`,userId);
    if([ownedWords,authored,voted].some(rows=>rows.length>MAX_SELECTORS))throw new ApiError(503,'This change requires a larger cache maintenance operation');
    const affected=new Set([...ownedWords.map(row=>row.id),...authored.map(row=>row.wordId),...voted.map(row=>row.wordId)]);
    for(const wordId of affected) {
      if(id(wordId)===null)this.unknownDictionary();
      await this.word(wordId);
    }
    if(affected.size)this.discovery();
    this.add('posts');
  }
}

/**
 * Resolve against the guarded essential D1 connection before the first write.
 * The caller retains the UNION across all writes and final resolution: deletes
 * cannot be rediscovered, and sequential transactions can partially succeed.
 * After creation, merge returned wordId/definitionIds (or id) into data and
 * resolve again before releasing the mutation lease. A quota/SQL failure here
 * must retain the existing lease, never clear it with an incomplete scope.
 */
export async function resolvePublicMutationScope(db:D1Database,method:string,path:string,data:Row,userId:number|null):Promise<string[]> {
  const verb=method.toUpperCase(),route=path.split('?')[0].replace(/\/$/,'')||'/';
  if(!['POST','PATCH','DELETE','PUT'].includes(verb))return [];
  const scope=new Scope(db);
  if(route==='/posts')return ['posts'];

  const countryMatch=/^\/countries(?:\/([A-Za-z]{2}))?$/.exec(route);
  if(countryMatch) {
    scope.add('countries','seo-index');
    const code=(countryMatch[1]||string(data.countryCode)).toUpperCase();
    scope.dialect(data.countryName);
    scope.dialect(data.previousCountryName);
    if(/^[A-Z]{2}$/.test(code)) {
      await scope.country(code,string(data.countryName)||undefined);
      if(verb==='DELETE') {
        // Current foreign keys reject a referenced country deletion. Include
        // its definitions anyway so SET NULL/cascade behavior cannot leave a
        // stale countryCode if a deployed schema changes that FK action.
        await scope.definitionsInCountry(code);
        if([...scope.selectors].some(key=>key.startsWith('word:')))scope.discovery();
      }
    } else scope.add('seo-dialect:*');
    return [...scope.selectors].sort();
  }

  const accountMatch=/^\/users\/([1-9]\d*)$/.exec(route);
  if(accountMatch) {
    if(verb==='DELETE') {
      const accountId=id(accountMatch[1]);
      if(accountId!==null)await scope.account(accountId);
    }
    // Cached dictionary/posts contain author IDs, not member profile names.
    return [...scope.selectors].sort();
  }

  const wordMatch=/^\/word(?:\/([1-9]\d*))?$/.exec(route);
  const definitionMatch=/^\/definitions(?:\/([1-9]\d*))?$/.exec(route);
  const reportMatch=/^\/(word|definition)-reports(?:\/([1-9]\d*))?$/.exec(route);
  const reactionMatch=/^\/reactions\/([1-9]\d*)\/(?:like|dislike|unlike|undislike|switch-reaction|likes|dislikes)(?:\/[1-9]\d*)?$/.exec(route);
  if(!wordMatch&&!definitionMatch&&!reportMatch&&!reactionMatch&&route!=='/contributions')return [];
  scope.discovery(!(verb==='PATCH'&&(wordMatch||definitionMatch)));

  if(wordMatch) {
    await scope.word(wordMatch[1]||data.wordId||data.id);
    const arabic=string(data.arabicWord);
    if(arabic)await scope.group(wordCanonical(arabic));
    const previousArabic=string(data.previousArabicWord);
    if(previousArabic)await scope.group(wordCanonical(previousArabic));
    if(!wordMatch[1]&&arabic) {
      // The existing /word POST uses a NOCASE exact spelling lookup before
      // deciding to insert. Include that result even for non-Arabic input.
      const existing=await scope.first('/* qamous-read:4000 */ SELECT id FROM words WHERE arabicWord=? COLLATE NOCASE ORDER BY id LIMIT 1',arabic);
      if(existing)await scope.word(existing.id);
    }
  } else if(route==='/contributions') {
    await scope.word(data.wordId);
    const arabic=string(data.arabicWord);
    if(arabic)await scope.group(stripTashkil(arabic));
    const requestId=string(data.requestId);
    if(requestId&&userId!==null) {
      const saved=await scope.first('/* qamous-read:128 */ SELECT wordId FROM contribution_submissions WHERE id=? AND userId=?',requestId,userId);
      if(saved)await scope.word(saved.wordId);
    }
    if(Array.isArray(data.definitionIds))for(const definitionId of data.definitionIds)await scope.definition(definitionId);
    const code=string(data.countryCode).toUpperCase();
    if(code) {
      const name=Object.entries(countryCodes).find(([,value])=>value===code)?.[0];
      const exists=await scope.country(code,name);
      // Contribution batches can create this country before their definitions.
      if(!exists)scope.add('countries');
    }
  } else if(definitionMatch) {
    await scope.definition(definitionMatch[1]||data.id||data.definitionId);
    await scope.word(data.wordId);
    if(verb==='POST') {
      const name=string(data.countryName)||'Unknown';
      const country=await scope.first('/* qamous-read:4000 */ SELECT countryCode,countryName FROM countries WHERE countryName=? COLLATE NOCASE',name);
      const exists=await scope.country(country?.countryCode||countryCodes[name]||'XX',String(country?.countryName||name));
      scope.dialect(name);if(!country&&!exists)scope.add('countries');
    }
  } else if(reportMatch) {
    const type=reportMatch[1],column=type+'Id';
    let target=data[column];
    if(verb==='DELETE'&&reportMatch[2]) {
      // The route ID is the report's ID, never the word/definition ID.
      const report=await scope.first(`/* qamous-read:128 */ SELECT ${column} FROM "${type}-reports" WHERE id=?`,Number(reportMatch[2]));
      if(report)target=report[column];
    }
    if(type==='word')await scope.word(target);else await scope.definition(target);
  } else if(reactionMatch)await scope.definition(reactionMatch[1]);
  return [...scope.selectors].sort();
}
