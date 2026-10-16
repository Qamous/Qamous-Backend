import { ApiError } from './data.ts';

export function validateWriteRequest(method:string,headers:Headers,allowedOrigins:string[]) {
  if(['GET','HEAD','OPTIONS'].includes(method)) return;
  const origin=headers.get('origin');
  if(origin&&!allowedOrigins.includes(origin)) throw new ApiError(403,'Origin is not allowed');
  if(headers.get('sec-fetch-site')==='cross-site') throw new ApiError(403,'Cross-site requests are not allowed');
  if(!origin&&/(?:^|;\s*)qamous_session=/.test(headers.get('cookie')||'')) {
    let refererOrigin='';
    try {refererOrigin=new URL(headers.get('referer')||'').origin;} catch {}
    if(!allowedOrigins.includes(refererOrigin)) throw new ApiError(403,'A trusted request origin is required');
  }
}

export function requireJson(headers:Headers) {
  if(headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') {
    throw new ApiError(415,'Content-Type must be application/json');
  }
}
