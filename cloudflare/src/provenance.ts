import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { ApiError, positiveId, type Row, withWord } from './data.ts';
import type { AppContext } from './security';
import { formatImportedDefinition,formatImportedExample } from './definition-display.mjs';
import { stripTashkil,hasTashkil,countryForDialect } from './arabic-model.mjs';

export interface SourceCredit {
  sourceId: string; sourceName: string; sourceUrl: string; sourceEntryId: string;
  license: string; licenseUrl: string; rightsStatus: string; attributionRequired: boolean;
  credit: string; notice: string; changes: string[];
  importer: { username: string };
  dialect: string; transliteration: string;
}
const parse = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === 'string' ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};
export function licenseLink(license: string, evidenceUrl: string): string {
  const key=license.toLowerCase().replace(/[\s_-]/g,'');
  if(key.includes('ccbysa4.0')) return 'https://creativecommons.org/licenses/by-sa/4.0/';
  if(key.includes('ccbysa3.0')) return 'https://creativecommons.org/licenses/by-sa/3.0/';
  if(key.includes('cc0')) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  return evidenceUrl;
}
const publicSource = (row: Row) => ({...row,licenseUrl:licenseLink(String(row.license),String(row.licenseUrl))});
export function isImportPreview(url: string, env: object): boolean {
  const flag = (env as { LOCAL_IMPORT_PREVIEW?: string | boolean }).LOCAL_IMPORT_PREVIEW;
  return (flag === 'true' || flag === true)
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
}
// Batched lookups avoid an additional database request for each card/source.
export async function attachProvenance(db: D1Database, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map(r => Number(r.definitionId ?? r.id)).filter(Number.isSafeInteger))];
  const credits = new Map<number, SourceCredit[]>(), examples = new Map<number, Row[]>(), pronunciations = new Map<number, Row[]>(),forms=new Map<number,Row[]>(), community=new Map<number,Row>(),exampleChanges=new Map<number,Set<string>>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90), placeholders = part.map(() => '?').join(',');
    const [sourceRows, exampleRows, pronunciationRows, formRows] = await Promise.all([
      db.prepare('SELECT p.definitionId,t.text AS changes,s.id AS sourceId,s.name AS sourceName,' +
        's.license,s.licenseUrl,s.rightsStatus,s.attributionRequired,s.credit,s.notice,' +
        'r.sourceUrl,r.sourceEntryId,r.dialect,r.transliteration,r.originalMetadata,r.recordKey,r.arabic,r.franco,r.displayFranco,u.username ' +
        'FROM definition_provenance p JOIN import_change_templates t ON t.id=p.changes JOIN import_records r ON r.recordKey=p.recordKey ' +
        'JOIN import_sources s ON s.id=r.sourceId JOIN users u ON u.id=r.importerUserId ' +
        'WHERE p.definitionId IN (' + placeholders + ") AND r.status IN ('accepted','duplicate') " +
        'ORDER BY s.id,r.recordKey').bind(...part).all<Row>(),
      db.prepare('SELECT DISTINCT e.definitionId,e.text,e.language,e.script,e.kind,r.sourceId FROM definition_examples e JOIN import_records r ON r.recordKey=e.recordKey ' +
        "WHERE e.language IN ('ar','en','ar-Latn') AND e.definitionId IN (" + placeholders + ') ORDER BY e.definitionId,e.language,e.text').bind(...part).all<Row>(),
      db.prepare('SELECT DISTINCT p.definitionId,n.scheme,n.value,n.language,n.kind,r.sourceId,s.name AS sourceName,' +
        'r.sourceUrl,r.sourceEntryId,r.dialect FROM definition_provenance p ' +
        'JOIN import_records r ON r.recordKey=p.recordKey JOIN import_sources s ON s.id=r.sourceId ' +
        'JOIN import_pronunciations n ON n.recordKey=r.recordKey WHERE p.definitionId IN (' + placeholders +
        ") AND r.status IN ('accepted','duplicate') ORDER BY p.definitionId,r.sourceId,r.sourceEntryId,n.scheme,n.value").bind(...part).all<Row>(),
      db.prepare('SELECT d.id AS definitionId,w.arabicWord AS originalArabic,w.francoArabicWord,w.canonicalArabic,s.arabicForm,s.francoForm,s.transliteration,s.ipa,s.englishExample,s.dialect,s.arabicVariants,s.francoVariants,'+
        '(SELECT MIN(id) FROM words ww WHERE ww.canonicalArabic=w.canonicalArabic AND ww.reportCount<=5) AS canonicalWordId,'+
        '(SELECT MIN(id) FROM definitions dd WHERE dd.submissionId=s.id) AS communityMeaningId '+
        'FROM definitions d JOIN words w ON w.id=d.wordId LEFT JOIN contribution_submissions s ON s.id=d.submissionId WHERE d.id IN ('+placeholders+')').bind(...part).all<Row>(),
    ]);
    for (const r of sourceRows.results) {
      const id = Number(r.definitionId), metadata = parse<Row>(r.originalMetadata, {});
      const entryCredit = typeof metadata.attribution === 'string' ? metadata.attribution : '';
      const projectCredit = String(r.credit);
      const authors = [metadata.author, metadata.authors, metadata.contributor, metadata.username]
        .flatMap(value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter(v => typeof v === 'string') : []);
      const originalCredit = projectCredit + (entryCredit && !projectCredit.includes(entryCredit) ? ' ' + entryCredit : '')
        + (authors.length ? ' Original contributor(s): ' + [...new Set(authors)].join(', ') : '');
      const credit: SourceCredit = {
        sourceId: String(r.sourceId), sourceName: String(r.sourceName), sourceUrl: String(r.sourceUrl),
        sourceEntryId: String(r.sourceEntryId), license: String(r.license), licenseUrl: licenseLink(String(r.license), String(r.licenseUrl)),
        rightsStatus: String(r.rightsStatus), attributionRequired: !!r.attributionRequired,
        credit: originalCredit,
        notice: String(r.notice), changes: [...parse<string[]>(r.changes, []),
          ...(metadata.franco_origin === 2 ? ['Franco spelling generated by Qamous from written Arabic; pronunciation has not been verified.'] : [])],
        importer: { username: String(r.username) },
        dialect: String(r.dialect), transliteration: String(r.transliteration),
      };
      credits.set(id, [...(credits.get(id) || []), credit]);
      const ownForms=forms.get(id)||[];
      const form={meaningId:'source:'+r.recordKey,arabic:String(r.arabic),franco:String(r.displayFranco||r.franco||''),francoResolved:r.displayFranco!==null,dialect:String(r.dialect),sourceId:r.sourceId};
      if(!ownForms.some(f=>f.meaningId===form.meaningId))ownForms.push(form);
      forms.set(id,ownForms);
      if(hasTashkil(r.arabic)){
        const original={scheme:'Arabic vocalization',value:String(r.arabic),language:'ar',kind:'vocalization',sourceId:String(r.sourceId),sourceName:String(r.sourceName),sourceUrl:String(r.sourceUrl),sourceEntryId:String(r.sourceEntryId),dialect:String(r.dialect)};
        pronunciations.set(id,[...(pronunciations.get(id)||[]),original]);
      }
    }
    for (const r of exampleRows.results) {
      const id = Number(r.definitionId);
      const formatted=formatImportedExample(String(r.text),String(r.sourceId));
      const values=examples.get(id)||[];
      if(!values.some(e=>e.text===formatted.text&&e.language===r.language&&e.script===r.script&&e.kind===r.kind)) {
        values.push({text:formatted.text,language:r.language,script:r.script,kind:r.kind,
          ...(formatted.changed?{originalText:r.text,sourceMarkers:formatted.sourceMarkers}:{})});
      }
      examples.set(id,values);
      if(formatted.changes.length)exampleChanges.set(id,new Set([...(exampleChanges.get(id)||[]),...formatted.changes]));
    }
    for (const {definitionId, ...entry} of pronunciationRows.results) {
      const id = Number(definitionId);
      pronunciations.set(id, [...(pronunciations.get(id) || []), entry]);
    }
    for(const r of formRows.results) {
      const id=Number(r.definitionId);community.set(id,r);
      if(!forms.has(id)) {
        forms.set(id,[{meaningId:(r.communityMeaningId?'community:':'legacy:')+(r.communityMeaningId||id),arabic:String(r.arabicForm||r.originalArabic),franco:String(r.communityMeaningId?(r.francoForm||''):(r.francoArabicWord||'')),francoResolved:true,dialect:String(r.dialect||''),sourceId:''}]);
        for(const [scheme,value] of [['Arabic vocalization',r.arabicForm||r.originalArabic],['translit',r.transliteration],['IPA',r.ipa]]) {
          if(!value||(scheme==='Arabic vocalization'&&!hasTashkil(value)))continue;
          pronunciations.set(id,[...(pronunciations.get(id)||[]),{scheme,value,language:'ar',kind:scheme==='Arabic vocalization'?'vocalization':'transcription',sourceId:'',sourceName:'',sourceUrl:'',sourceEntryId:String(r.communityMeaningId||id),dialect:String(r.dialect||'')}]);
        }
        if(r.englishExample)examples.set(id,[...(examples.get(id)||[]),{text:r.englishExample,language:'en',script:'Latin',kind:'usage'}]);
      }
    }
  }
  return rows.map(row => {
    const id = Number(row.definitionId ?? row.id);
    const sources=credits.get(id)||[];
    const info=community.get(id),meaningForms=forms.get(id)||[],primary=meaningForms[0];
    const arabic=String(info?.canonicalArabic||stripTashkil(primary?.arabic||row.arabicWord||''));
    const franco=String(primary?.franco||(!primary?.francoResolved?info?.francoArabicWord:'')||'');
    const countryCodes=[...new Set(meaningForms.map(f=>countryForDialect(f.dialect)).filter(Boolean))];
    const displayCountry=row.countryCode||(countryCodes.length===1?countryCodes[0]:null);
    const displayWord=typeof row.word==='object'&&row.word?{...row.word as Row,arabicWord:arabic,francoArabicWord:franco||null}:row.isArabic?arabic:franco||arabic;
    const formatted=formatImportedDefinition(String(row.definition??''),sources.map(c=>c.sourceId),row.isArabic===false||row.isArabic===0);
    return { ...row,
      ...(info?{arabicWord:arabic,francoArabicWord:franco||null,word:displayWord,canonicalWordId:info.canonicalWordId,meaningForms,
        ...(info.communityMeaningId?{arabicSpellings:parse<string[]>(info.arabicVariants,[]),francoSpellings:parse<string[]>(info.francoVariants,[])}:{}),
        countryCode:displayCountry,dialect:primary?.dialect||''}:{}),
      ...(formatted.changed?{definition:formatted.text,originalDefinition:row.definition,sourceDefinitionMarkers:formatted.sourceMarkers}:{}),
      sourceCredits: sources.map(credit=>({...credit,changes:[...credit.changes,...formatted.changes,...(exampleChanges.get(id)||[])]})),
      sourceExamples: examples.get(id) || [], sourcePronunciations: pronunciations.get(id) || [] };
  });
}

export function registerProvenanceRoutes(app: Hono<AppContext>) {
  app.get('/sources/:id/license', async c => {
    const doc = await c.env.DB.prepare('SELECT fileName,text FROM import_license_documents WHERE sourceId=?')
      .bind(c.req.param('id')).first<{ fileName: string; text: string }>();
    if (!doc) throw new ApiError(404, 'License document not found');
    c.header('Content-Disposition', 'inline; filename="' + doc.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_') + '"');
    return c.text(doc.text);
  });
  app.get('/sources/:id/export', async c => {
    const sourceId = c.req.param('id');
    if (!['freedict_ar_en', 'aramorph'].includes(sourceId)) throw new ApiError(404, 'Collection export not available');
    const source = await c.env.DB.prepare("SELECT name,sourceUrl,credit,notice,license,licenseUrl,releaseHash FROM import_sources WHERE id=? AND rightsStatus='licensed'").bind(sourceId).first<Row>();
    if (!source) throw new ApiError(404, 'Collection not found');
    const doc = await c.env.DB.prepare('SELECT text FROM import_license_documents WHERE sourceId=?').bind(sourceId).first<{ text: string }>();
    if (!doc) throw new ApiError(404, 'License document not found');
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="qamous-' + sourceId.replace(/_/g, '-') + '-editable.jsonl"');
    return stream(c, async output => {
      await output.write(JSON.stringify({ type: 'license', ...source, licenseText: doc.text,
        changes: 'Language-specific extraction, conservative moderation and exact duplicate consolidation. Per-entry changes accompany each definition; original forms remain in originalMetadata.',
        transformationInstructions: [
          'Use the source entry/release identifiers and release hash to identify the original text. Original spellings, glosses, transcription and entry metadata accompany each record.',
          sourceId === 'aramorph' ? 'Decode the original Buckwalter citation lemma rather than importing inflected analyzer stems. Retain the first human-provided English gloss, and the original stem row and source line. Exclude proper names, unverified headers and empty gloss groups.' : 'Read the FreeDict Arabic-English 0.6.3 release using its stored entry offsets and sizes. Retain the original Arabic headword and human-provided English gloss.',
          'Split explicitly labeled definition languages. Consolidate only exact compatible-license meanings within the same dialect. Keep all source-record links.',
          'Public display puts a space after semicolon-separated AraMorph glosses. The original definition and its display version are both exported; display-only formatting does not rewrite the source record.',
          'Hold NC/ND, sensitive, demo and explicitly flagged editorial records. Hold examples with uncertain language or reuse rights.',
          'Franco generated by Qamous maps written Arabic letters and written vowels to Arabizi; it does not infer missing short vowels. Original scholarly transcription remains separate. The generated form is marked in entry metadata.',
          'The exported JSONL is editable UTF-8 text. Keep the license, original copyright notices, source identifiers and modification notices with redistributions.',
        ] }) + '\n');
      let cursor = 0;
      // Keyset pagination bounds memory and avoids progressively larger offset scans.
      while (!output.aborted) {
        const rows = await c.env.DB.prepare("SELECT r.recordKey,r.sourceEntryId,r.arabic,r.franco,r.transliteration,r.dialect,r.definitionAr,r.definitionEn,r.sourceUrl,r.originalMetadata,w.francoArabicWord AS displayFranco," +
          "(SELECT json_group_array(json_object('definition',d.definition,'language',p.language,'changes',json(t.text))) FROM definition_provenance p JOIN definitions d ON d.id=p.definitionId JOIN import_change_templates t ON t.id=p.changes WHERE p.recordKey=r.recordKey) AS definitions " +
          "FROM import_records r LEFT JOIN words w ON w.id=r.wordId WHERE r.sourceId=? AND r.status IN ('accepted','duplicate') AND r.recordKey>? ORDER BY r.recordKey LIMIT 2000")
          .bind(sourceId, cursor).all<Row>();
        for (const row of rows.results) await output.write(JSON.stringify({...row, originalMetadata:parse<Row>(row.originalMetadata, {}),definitions:parse<Row[]>(row.definitions,[]).map(definition=>{
          const formatted=formatImportedDefinition(String(definition.definition??''),[sourceId],definition.language==='en');
          return {...definition,displayDefinition:formatted.text,changes:[...parse<string[]>(typeof definition.changes==='string'?definition.changes:JSON.stringify(definition.changes),[]),...formatted.changes]};
        })}) + '\n');
        if (rows.results.length < 2000) break;
        cursor = Number(rows.results[rows.results.length - 1].recordKey);
      }
    });
  });
  app.get('/sources', async c => c.json((await c.env.DB.prepare('SELECT id,name,sourceUrl,license,licenseUrl,' +
    'rightsStatus,credit,notice,attributionRequired,releaseHash FROM import_sources ORDER BY name').all()).results.map(publicSource)));
  app.get('/sources/:id', async c => {
    const row = await c.env.DB.prepare('SELECT id,name,sourceUrl,license,licenseUrl,rightsStatus,credit,notice,' +
      'attributionRequired,releaseHash FROM import_sources WHERE id=?').bind(c.req.param('id')).first<Row>();
    if (!row) throw new ApiError(404, 'Source not found');
    return c.json(publicSource(row));
  });
  app.get('/definitions/:id/provenance', async c => {
    const id = positiveId(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT id,wordId,definition,isArabic FROM public_definitions WHERE id=?').bind(id).first<Row>();
    if (!row) throw new ApiError(404, 'Definition not found');
    return c.json((await attachProvenance(c.env.DB, [row]))[0]);
  });
  app.get('/contributors/:username', async c => {
    const row = await c.env.DB.prepare('SELECT u.id,u.username,u.createdAt,u.accountKind,' +
      'COUNT(DISTINCT p.definitionId) AS importedDefinitions ' +
      'FROM users u LEFT JOIN import_records r ON r.importerUserId=u.id ' +
      'LEFT JOIN definition_provenance p ON p.recordKey=r.recordKey ' +
      "WHERE u.username=? COLLATE NOCASE AND u.accountKind='import' GROUP BY u.id")
      .bind(c.req.param('username')).first<Row>();
    if (!row) throw new ApiError(404, 'Import profile not found');
    const sources = await c.env.DB.prepare('SELECT DISTINCT s.id,s.name FROM import_sources s ' +
      'JOIN import_records r ON r.sourceId=s.id WHERE r.importerUserId=? ORDER BY s.name').bind(row.id).all();
    return c.json({ id:row.id,username:row.username,createdAt:row.createdAt,definitions:Number(row.importedDefinitions),
      description:'Vocabulary collection. Original sources are credited with each entry.', sources:sources.results });
  });
  app.get('/imports/preview/report', async c => {
    if (!isImportPreview(c.req.url, c.env)) throw new ApiError(404, 'Route not found');
    const row = await c.env.DB.prepare('SELECT reportJson,manifestHash FROM import_batches ORDER BY createdAt DESC LIMIT 1').first<Row>();
    if (!row) throw new ApiError(404, 'No prepared import');
    const report=parse<Row>(row.reportJson,{});
    // This route is local-only. Recount the represented copy rather than
    // editing the immutable manifest or the source release's stored report.
    const [records,definitions,wordGroups]=await c.env.DB.batch<Row>([
      c.env.DB.prepare('SELECT sourceId,status,COUNT(*) AS n FROM import_records GROUP BY sourceId,status'),
      c.env.DB.prepare('SELECT displayLanguage,COUNT(*) AS n FROM definitions WHERE id IN (SELECT definitionId FROM definition_provenance) GROUP BY displayLanguage'),
      c.env.DB.prepare('SELECT r.sourceId,COUNT(DISTINCT r.wordId) AS words,COUNT(DISTINCT w.canonicalArabic) AS canonicalWords FROM import_records r JOIN words w ON w.id=r.wordId GROUP BY r.sourceId UNION ALL SELECT NULL,COUNT(DISTINCT r.wordId),COUNT(DISTINCT w.canonicalArabic) FROM import_records r JOIN words w ON w.id=r.wordId'),
    ]);
    const statuses:Record<string,number>={},sourceStatuses=new Map<string,Record<string,number>>();
    for(const r of records.results){const status=String(r.status),source=String(r.sourceId);statuses[status]=(statuses[status]||0)+Number(r.n);const own=sourceStatuses.get(source)||{};own[status]=Number(r.n);sourceStatuses.set(source,own);}
    const groups=wordGroups.results.find(r=>r.sourceId===null);
    const display:Record<string,number>=Object.fromEntries(definitions.results.map(r=>[String(r.displayLanguage),Number(r.n)]));
    const sources=(Array.isArray(report.sources)?report.sources:[]).map((source:Row)=>{const group=wordGroups.results.find(r=>r.sourceId===source.id);return {...source,records:sourceStatuses.get(String(source.id))||source.records,...(group?{words:group.words,canonical_words:group.canonicalWords}:{})};});
    const totals=report.totals as Row||{};
    return c.json({...report,sources,totals:{...totals,...statuses,definitions:Object.values(display).reduce((sum,n)=>sum+n,0),definitions_by_display_language:display,words:groups?.words,canonical_words:groups?.canonicalWords},manifest_sha256:row.manifestHash});
  });
  app.get('/imports/preview/ledger', async c => {
    if (!isImportPreview(c.req.url, c.env)) throw new ApiError(404, 'Route not found');
    const q = (c.req.query('q') || '').slice(0, 120), source = c.req.query('source') || '';
    const status = c.req.query('status') || '', page = Math.max(1, Math.min(100000, Number(c.req.query('page')) || 1));
    if (!Number.isInteger(page) || !['', 'accepted', 'held', 'duplicate', 'removed'].includes(status)) throw new ApiError(400, 'Invalid filter');
    const clauses: string[] = [], args: string[] = [];
    if (source) { clauses.push('r.sourceId=?'); args.push(source); }
    if (status) { clauses.push('r.status=?'); args.push(status); }
    else clauses.push("r.status IN ('accepted','duplicate')");
    if (q) {
      clauses.push("(r.arabic LIKE ? ESCAPE '\\' OR r.franco LIKE ? ESCAPE '\\' OR r.sourceEntryId LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
      const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'; args.push(like, like, like, like);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = await c.env.DB.prepare('SELECT r.recordKey,r.sourceId,r.sourceEntryId,r.sourceUrl,r.status,r.reasons,r.wordId,' +
      'r.arabic,r.franco,r.transliteration,r.dialect,u.username,' +
      '(SELECT json_group_array(definitionId) FROM definition_provenance p WHERE p.recordKey=r.recordKey) AS definitionIds,' +
      "(SELECT json_group_array(json_object('definitionId',d.id,'username',owner.username)) FROM definition_provenance p JOIN definitions d ON d.id=p.definitionId JOIN users owner ON owner.id=d.userId WHERE p.recordKey=r.recordKey) AS definitionOwners " +
      'FROM import_records r JOIN users u ON u.id=r.importerUserId ' + where + ' ORDER BY r.recordKey LIMIT 26 OFFSET ?')
      .bind(...args, (page - 1) * 25).all<Row>();
    return c.json({ page, hasMore: rows.results.length > 25, results: rows.results.slice(0, 25).map(row => ({
      ...row, reasons: parse<string[]>(row.reasons, []), definitionIds: parse<number[]>(row.definitionIds, []),
      definitionOwners: parse<Row[]>(row.definitionOwners, []),
    })) });
  });
  app.get('/imports/preview/samples', async c => {
    if (!isImportPreview(c.req.url, c.env)) throw new ApiError(404, 'Route not found');
    const sources = (await c.env.DB.prepare('SELECT id FROM import_sources ORDER BY name').all<{ id: string }>()).results;
    const rows: Row[] = [];
    for (const source of sources) {
      for (const language of ['ar', 'en']) {
        const row = await c.env.DB.prepare('SELECT d.*,w.arabicWord,w.francoArabicWord,p.language,s.name AS sampleSource ' +
          'FROM import_records r JOIN definition_provenance p ON p.recordKey=r.recordKey ' +
          'JOIN public_definitions d ON d.id=p.definitionId JOIN words w ON w.id=d.wordId JOIN import_sources s ON s.id=r.sourceId ' +
          "WHERE r.sourceId=? AND r.status='accepted' AND (CASE WHEN d.isArabic=1 THEN 'ar' ELSE 'en' END)=? ORDER BY r.recordKey LIMIT 1")
          .bind(source.id, language).first<Row>();
        if (row) rows.push(withWord(row));
      }
    }
    return c.json(await attachProvenance(c.env.DB, rows));
  });
}
