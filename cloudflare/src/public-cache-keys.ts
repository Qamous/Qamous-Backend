import { ApiError } from './data.ts';

export const PUBLIC_CACHE_PREFIX='qamous-public:v1:';
export const PUBLIC_CACHE_REVISION=PUBLIC_CACHE_PREFIX+'revision';
export function validPublicCacheKey(key: string): boolean {
  return key.length<=2200 && (['countries','posts','sources','seo-index'].includes(key) || /^feed:[01]$/.test(key)
    || /^word:[1-9]\d{0,15}$/.test(key) || /^cards:\d{1,14}$/.test(key) || /^related:[A-Z]{2}:(ar|franco)$/.test(key)
    || /^seo-shard:\d{1,14}$/.test(key) || /^seo-browse:(ar|en):(?:[1-9]\d{0,15})?$/.test(key)
    || /^seo-dialect:[^:]{1,1200}$/.test(key) || /^explore:/.test(key));
}

// The protected recovery endpoint may seed an exported public snapshot; no
// session, credential, private vote or report data may enter a shared cache.
export function validatePublicSeed(key: string,value: unknown): void {
  if(!validPublicCacheKey(key)) throw new ApiError(400,'Invalid public cache resource');
  const visit=(item: unknown,depth=0): void=>{
    if(depth>30) throw new ApiError(400,'Invalid public cache payload');
    if(item===null || typeof item==='string' || typeof item==='boolean' || (typeof item==='number'&&Number.isFinite(item))) return;
    if(Array.isArray(item)) {for(const child of item) visit(child,depth+1);return;}
    if(typeof item!=='object') throw new ApiError(400,'Invalid public cache payload');
    for(const [name,child] of Object.entries(item)) {
      if(/password|session|secret|token|email|reportText/i.test(name) || (['isLiked','isDisliked','isReported'].includes(name)&&!!child)) {
        throw new ApiError(400,'Private data is not permitted in the public cache');
      }
      visit(child,depth+1);
    }
  };
  visit(value);
  if((key==='countries'||key.startsWith('word:')||key.startsWith('feed:')||key.startsWith('cards:')||key.startsWith('seo-shard:'))&&!Array.isArray(value)) {
    throw new ApiError(400,'Invalid public cache payload shape');
  }
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>16_000_000) throw new ApiError(413,'Public cache payload is too large');
}
