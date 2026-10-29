import {ApiError,normalize,type Row} from './data.ts';

// A narrowly scoped correction for two original demo entries. Imported source
// records and later community edits are outside this maintenance operation.
export const SEED_CORRECTIONS = [
  {id:1,wordId:1,word:'النهاردة',
    before:'تعبير عامي مصري يُستخدم للتعبير عن الموافقة أو الاستسماح، ويعني "ما فيش مشكلة" أو "ما عليك". يُستخدم كبديل عن التعبير عن الشكر أو الاعتذار.',
    after:'كلمة عامية مصرية تعني «اليوم»، وتُستخدم للإشارة إلى اليوم الحالي أو إلى حدث يقع فيه.',
    example:'النهاردة أنا مبسوط علشان عملت حاجة حلوة.'},
  {id:3,wordId:2,word:'معلش',
    before:'تعبير عامي مصري يعني "اليوم" في اللغة العربية الفصحى، ويُستخدم في المحادثات اليومية للإشارة إلى الزمن الحالي أو الحدث الذي يحدث في يوم الحديث.',
    after:'تعبير عامي مصري يُستخدم للاعتذار أو التهوين أو طمأنة شخص، بمعنى «آسف» أو «لا بأس» أو «ولا يهمك»، بحسب السياق.',
    example:'معلش، هتتعوض.'},
] as const;

export async function inspectSeedDefinitions(db:D1Database):Promise<Row[]> {
  const result=await db.prepare(`/* qamous-read:128 */ SELECT d.id,d.wordId,d.userId,d.isArabic,d.definition,w.arabicWord
    FROM definitions d JOIN words w ON w.id=d.wordId WHERE d.id IN (1,3) ORDER BY d.id`).all<Row>();
  const rows=result.results;
  if(rows.length!==SEED_CORRECTIONS.length||SEED_CORRECTIONS.some(fix=>{
    const row=rows.find(row=>row.id===fix.id);
    return !row||row.wordId!==fix.wordId||row.userId!==1||Number(row.isArabic)!==1||row.arabicWord!==fix.word
      ||row.definition!==fix.before&&row.definition!==fix.after;
  }))throw new ApiError(409,'The original seed definitions have changed; review them before correcting content');
  return rows;
}

export async function correctSeedDefinitions(db:D1Database) {
  const rows=await inspectSeedDefinitions(db);
  const fixes=SEED_CORRECTIONS.filter(fix=>rows.find(row=>row.id===fix.id)?.definition===fix.before);
  if(!fixes.length)return {corrected:[] as number[],alreadyCorrect:true};
  const results=await db.batch(fixes.map(fix=>db.prepare(`/* qamous-read:50000 */ UPDATE definitions
    SET definition=?,arabicExample=COALESCE(arabicExample,?),searchText=?
    WHERE id=? AND wordId=? AND userId=1 AND isArabic=1 AND definition=?`)
    .bind(fix.after,fix.example,normalize(fix.after),fix.id,fix.wordId,fix.before)));
  return {corrected:fixes.filter((_,i)=>Number(results[i].meta.changes)>0).map(fix=>fix.id),alreadyCorrect:false};
}
