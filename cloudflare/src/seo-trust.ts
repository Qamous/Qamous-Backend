// Only the public site Worker holds this token. Direct API callers still use
// the ordinary read limit, while sitemap and word HTML generation can fetch
// through the service binding without throttling verified search crawls.
export function trustedSeoRead(path:string,provided:string|undefined,configured:string|undefined):boolean {
  return path.startsWith('/seo/')&&typeof configured==='string'&&configured.length>=32&&provided===configured;
}
