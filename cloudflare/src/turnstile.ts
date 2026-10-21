import { ApiError } from './data.ts';

type SiteverifyResponse={success?:boolean;action?:string;hostname?:string};

export async function verifyRagTurnstile(token:unknown,secret:string,hostname:string,ip?:string,siteverify:typeof fetch=fetch):Promise<void> {
  if(!secret) throw new ApiError(503,'Chat verification is temporarily unavailable. Please try again later.');
  if(typeof token!=='string'||!token||token.length>2048) throw new ApiError(403,'Please complete the chat verification and try again.');
  const form=new URLSearchParams({secret,response:token});
  if(ip) form.set('remoteip',ip);
  let response:Response;
  try {
    response=await siteverify('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',body:form,signal:AbortSignal.timeout(5000),
    });
    if(!response.ok) throw new Error('Siteverify unavailable');
    const result=await response.json() as SiteverifyResponse;
    if(result.success===true&&result.action==='rag'&&result.hostname===hostname) return;
  } catch(error) {
    if(error instanceof ApiError) throw error;
    throw new ApiError(503,'Chat verification is temporarily unavailable. Please try again later.');
  }
  throw new ApiError(403,'Please complete the chat verification and try again.');
}
