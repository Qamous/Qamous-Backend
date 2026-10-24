import {ApiError,type Row} from './data.ts';
import {validatePublicSeed} from './public-cache-keys.ts';

// Prepared rows are a derived read model, never an independent content source.
// Source-table triggers remove affected payloads in the same D1 transaction.
export async function storePreparedCards(db:D1Database,rows:Row[]):Promise<number> {
  if(rows.length>50)throw new ApiError(400,'Too many prepared public cards');
  if(!rows.length)return 0;
  const seen=new Set<number>();
  const statements=rows.map(row=>{
    const id=Number(row.definitionId??row.id);
    if(!Number.isSafeInteger(id)||id<1||seen.has(id))throw new ApiError(400,'Invalid prepared public card');
    seen.add(id);validatePublicSeed('cards:'+Math.floor(id/100),[row]);
    const payload=JSON.stringify(row);
    if(new TextEncoder().encode(payload).byteLength>128_000)throw new ApiError(413,'Prepared public card is too large');
    // Primary-key lookups only, including the conflict update. No broad scan.
    return db.prepare(`/* qamous-read:128 */ INSERT INTO public_card_payloads(definitionId,payload)
      SELECT d.id,? FROM public_definitions d JOIN words w ON w.id=d.wordId
      WHERE d.id=? AND d.reportCount<=5 AND w.reportCount<=5
      ON CONFLICT(definitionId) DO UPDATE SET payload=excluded.payload
      WHERE public_card_payloads.payload!=excluded.payload`).bind(payload,id);
  });
  const results=await db.batch(statements);
  return results.reduce((sum,row)=>sum+Number(row.meta.changes||0),0);
}
