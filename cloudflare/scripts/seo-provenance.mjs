// Only credit the actual definition selected for the public description.
export const creditSql = 'SELECT d.wordId,d.isArabic,s.id AS sourceId,s.name AS sourceName,' +
  "(s.credit || CASE WHEN json_type(r.originalMetadata,'$.attribution')='text' AND json_extract(r.originalMetadata,'$.attribution')<>s.credit THEN ' '||json_extract(r.originalMetadata,'$.attribution') ELSE '' END) AS credit," +
  'r.sourceUrl,s.license,s.licenseUrl,s.rightsStatus,s.notice,s.attributionRequired,t.text AS changes ' +
  'FROM public_definitions d JOIN words w ON w.id=d.wordId JOIN definition_provenance p ON p.definitionId=d.id JOIN import_change_templates t ON t.id=p.changes ' +
  'JOIN import_records r ON r.recordKey=p.recordKey JOIN import_sources s ON s.id=r.sourceId ' +
  "WHERE r.status IN ('accepted','duplicate') AND (d.reportCount+w.reportCount)<5 " +
  'AND d.id=(SELECT x.id FROM public_definitions x WHERE x.wordId=d.wordId AND x.isArabic=d.isArabic ' +
  'AND (x.reportCount+w.reportCount)<5 ORDER BY x.likeCount-x.dislikeCount DESC,x.id LIMIT 1);';

export function groupSeoCredits(rows) {
  const groups=new Map();
  for(const row of rows) {
    const key=row.wordId+':'+(row.isArabic?'ar':'en');
    const {wordId,isArabic,...credit}=row;
    if(typeof credit.changes==='string') {
      try {const changes=JSON.parse(credit.changes);credit.changes=Array.isArray(changes)?changes:[credit.changes];}
      catch {credit.changes=[credit.changes];}
    }
    const keyLicense=String(credit.license||'').toLowerCase().replace(/[\s_-]/g,'');
    if(keyLicense.includes('ccbysa4.0')) credit.licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/';
    else if(keyLicense.includes('ccbysa3.0')) credit.licenseUrl='https://creativecommons.org/licenses/by-sa/3.0/';
    groups.set(key,[...(groups.get(key)||[]),credit]);
  }
  return groups;
}
