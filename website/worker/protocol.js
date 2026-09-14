export const random=(bytes=32)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),n=>n.toString(16).padStart(2,'0')).join('');
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
export const pkce=async value=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const now=()=>Date.now();
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const user=request=>request.headers.get('oai-authenticated-user-id');
export function browserUser(request,url){
 const id=user(request);if(!id)fail('Sign in with ChatGPT to continue.',401);
 if(request.method!=='GET' && request.headers.get('origin')!==url.origin)fail('Request origin did not match.',403);
 return id;
}
export async function body(request,limit=65536){
 const value=await request.text();if(value.length>limit)fail('Request is too large.',413);
 try{return request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(value)):JSON.parse(value||'{}');}
 catch{fail('Invalid request body.');}
}
export function safeRedirect(value){
 let url;try{url=new URL(value);}catch{fail('Invalid OAuth redirect URI.');}
 const allowed=['chatgpt.com','chat.openai.com','platform.openai.com','auth.openai.com'];
 if(url.protocol!=='https:' || !allowed.includes(url.hostname) || url.username || url.password || url.hash)fail('Use an official OpenAI OAuth callback.',400);
 return url.href;
}
export const statement=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
export const first=(env,sql,...args)=>statement(env,sql,...args).first();
export const all=async(env,sql,...args)=>(await statement(env,sql,...args).all()).results;
export const run=(env,sql,...args)=>statement(env,sql,...args).run();
export async function deviceIdentity(request,env){
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)fail('Device authentication required.',401);
 const row=await first(env,'SELECT * FROM devices WHERE token_hash=? AND owner IS NOT NULL AND revoked=0',await digest(token));
 if(!row)fail('This Mac is not paired or its access was revoked.',401);return row;
}
export async function accessIdentity(request,env,url,kind='access'){
 const value=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!value)return null;
 return first(env,'SELECT * FROM oauth_tokens WHERE hash=? AND kind=? AND resource=? AND expires>?',await digest(value),kind,url.origin+'/mcp',now());
}
