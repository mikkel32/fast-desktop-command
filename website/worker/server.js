import {random,digest,pkce,json,fail,now,sleep,user,browserUser,body,safeRedirect,first,all,run} from './protocol.js';
import {page} from './page.js';
import {tools} from './tools.js';
import {icon} from './branding.js';

const sessionsTTL=24*3600*1000;
const textError=message=>({content:[{type:'text',text:message}],isError:true});
const devicePublic=d=>({id:d.id,name:d.name,online:!!d.seen&&now()-d.seen<20000,pairedAt:d.paired,lastSeen:d.seen});
async function rateLimit(env,key,maximum=10){
 const row=await first(env,'INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count',key,now()+600000,now(),now());
 if(row.count>maximum)fail('Too many attempts. Try again in ten minutes.',429);
}
function challenge(url){return `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource", scope="computer"`;}
async function tokenPair(env,owner,client,resource){
 const access=random(),refresh=random();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO oauth_tokens(hash,owner,client,resource,kind,expires) VALUES(?,?,?,?,?,?)').bind(await digest(access),owner,client,resource,'access',now()+3600000),
  env.DB.prepare('INSERT INTO oauth_tokens(hash,owner,client,resource,kind,expires) VALUES(?,?,?,?,?,?)').bind(await digest(refresh),owner,client,resource,'refresh',now()+30*86400000),
 ]);
 return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'computer'};
}
async function oauth(request,env,url){
 const route=url.pathname;
 if(route==='/.well-known/oauth-protected-resource' || route==='/.well-known/oauth-protected-resource/api/mcp')return json({resource:url.origin+'/api/mcp',authorization_servers:[url.origin],scopes_supported:['computer'],resource_documentation:url.origin,resource_policy_uri:url.origin+'/privacy',resource_tos_uri:url.origin+'/terms'});
 if(route==='/.well-known/oauth-authorization-server')return json({issuer:url.origin,authorization_endpoint:url.origin+'/oauth/authorize',token_endpoint:url.origin+'/oauth/token',registration_endpoint:url.origin+'/oauth/register',revocation_endpoint:url.origin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['computer'],authorization_response_iss_parameter_supported:true});
 if(route==='/oauth/register' && request.method==='POST'){
  const data=await body(request);
  if(!Array.isArray(data.redirect_uris)||!data.redirect_uris.length||data.redirect_uris.length>5)fail('Provide OAuth redirect URIs.');
  const redirects=data.redirect_uris.map(safeRedirect),id=random(16),name=String(data.client_name||'OpenAI client').slice(0,80);
  await run(env,'INSERT INTO oauth_clients(id,redirects,name) VALUES(?,?,?)',id,JSON.stringify(redirects),name);
  return json({client_id:id,client_id_issued_at:Math.floor(now()/1000),redirect_uris:redirects,client_name:name,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},201);
 }
 if(route==='/oauth/authorize'){
  const owner=user(request);
  if(!owner)return Response.redirect(url.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent(url.pathname+url.search),302);
  if(request.method==='GET'){
   const p=Object.fromEntries(url.searchParams);
   if(p.response_type!=='code'||p.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge||''))fail('Authorization code with PKCE S256 is required.');
   if(p.resource!==url.origin+'/api/mcp' || (p.scope&&p.scope!=='computer'))fail('The requested resource or scope does not match.');
   const client=await first(env,'SELECT * FROM oauth_clients WHERE id=?',p.client_id);
   if(!client || !JSON.parse(client.redirects).includes(safeRedirect(p.redirect_uri)))fail('OAuth client or redirect did not match.');
   const nonce=random();
   await run(env,'INSERT INTO oauth_consents(id,owner,params,expires) VALUES(?,?,?,?)',nonce,owner,JSON.stringify(p),now()+300000);
   return page({signedIn:true,mode:'authorize',nonce,clientName:client.name});
  }
  browserUser(request,url);
  const data=await body(request);
  const consent=await first(env,'DELETE FROM oauth_consents WHERE id=? AND owner=? AND expires>? RETURNING *',data.nonce,owner,now());
  if(!consent)fail('This approval expired. Start the connection again.');
  const p=JSON.parse(consent.params),code=random();
  await run(env,'INSERT INTO oauth_codes(hash,owner,client,redirect,challenge,resource,expires) VALUES(?,?,?,?,?,?,?)',await digest(code),owner,p.client_id,p.redirect_uri,p.code_challenge,p.resource,now()+60000);
  const redirect=new URL(p.redirect_uri);redirect.searchParams.set('code',code);redirect.searchParams.set('iss',url.origin);if(p.state)redirect.searchParams.set('state',p.state);
  return json({redirect:redirect.href});
 }
 if(route==='/oauth/token' && request.method==='POST'){
  const data=await body(request);
  if(data.grant_type==='authorization_code'){
   const hash=await digest(String(data.code||''));
   const code=await first(env,'SELECT * FROM oauth_codes WHERE hash=? AND expires>?',hash,now());
   if(!code || code.client!==data.client_id || code.redirect!==data.redirect_uri || code.resource!==data.resource || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.code_verifier||'') || await pkce(data.code_verifier)!==code.challenge)fail('Invalid authorization grant.',400);
   const consumed=await first(env,'DELETE FROM oauth_codes WHERE hash=? RETURNING owner',hash);if(!consumed)fail('Authorization code already used.');
   return json(await tokenPair(env,code.owner,code.client,code.resource));
  }
  if(data.grant_type==='refresh_token'){
   const hash=await digest(String(data.refresh_token||''));
   const token=await first(env,'DELETE FROM oauth_tokens WHERE hash=? AND kind=? AND client=? AND resource=? AND expires>? RETURNING *',hash,'refresh',data.client_id,data.resource,now());
   if(!token)fail('Refresh token expired or already used.',400);
   return json(await tokenPair(env,token.owner,token.client,token.resource));
  }
  fail('Unsupported grant type.');
 }
 if(route==='/oauth/revoke' && request.method==='POST'){
  const data=await body(request);await run(env,'DELETE FROM oauth_tokens WHERE hash=?',await digest(String(data.token||'')));return json({});
 }
 return null;
}

async function deviceAPI(request,env,url){
 if(url.pathname==='/api/pair/start' && request.method==='POST'){
  await rateLimit(env,'pair-start:'+await digest(request.headers.get('cf-connecting-ip')||'unknown'),15);
  const data=await body(request),id=random(16),deviceCode=random(),token=random(),userCode=random(4).toUpperCase();
  const pending=await first(env,'SELECT count(*) AS count FROM devices WHERE owner IS NULL AND expires>?',now());
  if(pending.count>500)fail('Pairing is busy. Try again shortly.',429);
  await run(env,'INSERT INTO devices(id,name,token_hash,code_hash,user_code,expires,revoked) VALUES(?,?,?,?,?,?,0)',id,String(data.name||'My Mac').slice(0,80),await digest(token),await digest(deviceCode),userCode,now()+300000);
  return json({device_id:id,device_code:deviceCode,device_token:token,user_code:userCode,verification_uri:url.origin+'/pair?code='+userCode,expires_in:300,interval:2});
 }
 if(url.pathname==='/api/pair/status' && request.method==='POST'){
  const data=await body(request),row=await first(env,'SELECT owner,revoked,expires FROM devices WHERE code_hash=?',await digest(String(data.device_code||'')));
  if(!row || row.revoked || (!row.owner&&row.expires<now()))fail('Pairing expired. Start again.',410);
  return json({approved:!!row.owner});
 }
 if(url.pathname==='/api/pair/confirm' && request.method==='POST'){
  const owner=browserUser(request,url),data=await body(request),code=String(data.code||'').replaceAll('-','').trim().toUpperCase();
  await rateLimit(env,'pair-confirm:'+owner);
  if(!/^[A-F0-9]{8}$/.test(code))fail('Enter the eight-character code shown in the Mac app.');
  const device=await first(env,'UPDATE devices SET owner=?,paired=? WHERE user_code=? AND owner IS NULL AND expires>? AND revoked=0 RETURNING id,name',owner,now(),code,now());
  if(!device)fail('That code expired or was already paired.');return json({paired:true,name:device.name});
 }
 if(url.pathname==='/api/devices'){
  const owner=browserUser(request,url);
  return json({devices:(await all(env,'SELECT * FROM devices WHERE owner=? AND revoked=0 ORDER BY paired DESC',owner)).map(devicePublic)});
 }
 if(url.pathname==='/api/devices/revoke' && request.method==='POST'){
  const owner=browserUser(request,url),data=await body(request);
  await run(env,'UPDATE devices SET revoked=1 WHERE id=? AND owner=?',data.id,owner);return json({revoked:true});
 }
 if(url.pathname==='/device/poll' && request.method==='POST'){
  const device=await deviceIdentity(request,env);
  await run(env,'UPDATE devices SET seen=? WHERE id=?',now(),device.id);
  const data=await body(request);
  if(data.initial)return json({jobs:[]});
  const deadline=now()+7000;
  while(now()<deadline){
   const lease=random(16);
   const rows=await all(env,"UPDATE jobs SET state='claimed',lease=? WHERE id IN (SELECT id FROM jobs WHERE device=? AND state='queued' AND expires>? ORDER BY created LIMIT 3) RETURNING id,session,request,lease",lease,device.id,now());
   if(rows.length)return json({jobs:rows.map(row=>({...row,request:JSON.parse(row.request)}))});
   await sleep(200);
  }
  return json({jobs:[]});
 }
 if(url.pathname==='/device/result' && request.method==='POST'){
  const device=await deviceIdentity(request,env),data=await body(request,16*1024*1024);
  const job=await first(env,'SELECT * FROM jobs WHERE id=? AND device=? AND lease=?',data.id,device.id,data.lease);
  if(!job || job.expires<now())fail('This request expired.',410);
  if(job.state==='done')return json({accepted:true});
  const key='results/'+job.id;
  await env.BUCKET.put(key,JSON.stringify(data.result),{httpMetadata:{contentType:'application/json'}});
  await run(env,"UPDATE jobs SET state='done',result=? WHERE id=? AND lease=?",key,job.id,data.lease);
  return json({accepted:true});
 }
 return null;
}

async function deviceIdentity(request,env){
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)fail('Device authentication required.',401);
 const device=await first(env,'SELECT * FROM devices WHERE token_hash=? AND owner IS NOT NULL AND revoked=0',await digest(token));
 if(!device)fail('This Mac is not paired or access was revoked.',401);return device;
}
async function mcp(request,env,url,ctx){
 if(request.method==='GET'){return new Response(null,{status:405,headers:{Allow:'POST, DELETE'}});}
 const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');
 const token=bearer?await first(env,"SELECT * FROM oauth_tokens WHERE hash=? AND kind='access' AND resource=? AND expires>?",await digest(bearer),url.origin+'/api/mcp',now()):null;
 if(request.method==='DELETE'){
  if(!token)return json({error:'Authentication required'},401,{'WWW-Authenticate':challenge(url)});
  await run(env,'DELETE FROM mcp_sessions WHERE id=? AND owner=?',request.headers.get('mcp-session-id'),token.owner);return new Response(null,{status:204});
 }
 if(request.method!=='POST')return json({error:'Use POST'},405);
 const rpc=await body(request),headers={};
 if(!rpc || rpc.jsonrpc!=='2.0' || typeof rpc.method!=='string')fail('Invalid MCP request.');
 if(rpc.id===undefined)return new Response(null,{status:202});
 const respond=result=>json({jsonrpc:'2.0',id:rpc.id,result},200,headers);
 if(rpc.method==='initialize'){
  // Tool import runs before account connection. Discovery contains only public
  // schemas; every tool execution below still requires a valid account token.
  if(token){const id=random(16);await run(env,'INSERT INTO mcp_sessions(id,owner,created) VALUES(?,?,?)',id,token.owner,now());headers['Mcp-Session-Id']=id;}
  return respond({protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fast-desktop-command-web',version:'1.0.0'}});
 }
 if(rpc.method==='ping')return respond({});
 if(rpc.method==='tools/list')return respond({tools:[{name:'list_devices',description:'List your paired Macs and whether they are online.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:['computer']}]},{name:'get_request_status',description:'Retrieve a pending request without executing it again. Use the requestId from a pending response.',inputSchema:{type:'object',properties:{requestId:{type:'string'}},required:['requestId'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:['computer']}]},...tools]});
 if(rpc.method!=='tools/call')return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Method not supported'}},200);
 if(!token)return respond({...textError('Connect your account to use your paired Mac.'),_meta:{'mcp/www_authenticate':[challenge(url)+', error="invalid_token", error_description="Connect your account"']}});
 const params=rpc.params||{};
 if(params.name==='list_devices')return respond({content:[{type:'text',text:JSON.stringify((await all(env,'SELECT * FROM devices WHERE owner=? AND revoked=0',token.owner)).map(devicePublic))}]});
 if(params.name==='get_request_status'){
  const job=await first(env,'SELECT * FROM jobs WHERE id=? AND owner=?',params.arguments?.requestId,token.owner);
  if(!job || job.expires<now())return respond(textError('This request is unavailable or expired. Verify its outcome on the Mac before repeating it.'));
  if(job.state==='done'){const object=await env.BUCKET.get(job.result);if(object)return respond(JSON.parse(await object.text()));}
  return respond({content:[{type:'text',text:JSON.stringify({requestId:job.id,state:job.state,action:'Check this request again; do not execute the command again.'})}]});
 }
 if(!tools.some(tool=>tool.name===params.name))return respond(textError('Unknown tool. Refresh the plugin tools.'));
 let session=request.headers.get('mcp-session-id');
 if(session){const row=await first(env,'SELECT id FROM mcp_sessions WHERE id=? AND owner=? AND created>?',session,token.owner,now()-sessionsTTL);if(!row)return json({error:'MCP session expired. Reconnect.'},404);}
 // OAuth may be attached after anonymous discovery. Stateless MCP callers are
 // also valid; the account/client identity below owns interpreter continuity.
 const args={...(params.arguments||{})},deviceID=args.deviceId,requestKey=args.requestKey;delete args.deviceId;delete args.requestKey;
 if(requestKey!==undefined && (typeof requestKey!=='string'||requestKey.length<1||requestKey.length>128))return respond(textError('requestKey must contain 1-128 characters.'));
 const device=deviceID?await first(env,'SELECT * FROM devices WHERE id=? AND owner=? AND revoked=0',deviceID,token.owner):await first(env,'SELECT * FROM devices WHERE owner=? AND revoked=0 ORDER BY seen DESC LIMIT 1',token.owner);
 if(!device)return respond(textError('Pair your Mac from the FAST website first.'));
 if(!device.seen || now()-device.seen>20000)return respond(textError('Your Mac is offline. Open Fast Desktop Command and start its web connection.'));
 const serialized=JSON.stringify({method:'tools/call',params:{name:params.name,arguments:args}});
 // Hosts may reconnect HTTP MCP sessions between tool calls. Keep the Mac's
 // interpreter state bound to the authenticated account/client, not that socket.
 const engineSession=await digest(token.owner+':'+token.client);
 // JSON-RPC IDs may be reused after completion. Only an explicit request key
 // denotes a retry; treating every reused RPC ID as a retry returns stale data.
 const dedupe=await digest(engineSession+':'+device.id+':'+(requestKey??random(16)));
 let job=await first(env,'SELECT * FROM jobs WHERE dedupe=?',dedupe);
 if(job && job.request!==serialized)return respond(textError('This request ID was already used for a different operation.'));
 if(!job){const id=random(16);await run(env,"INSERT OR IGNORE INTO jobs(id,device,owner,session,dedupe,request,state,created,expires) VALUES(?,?,?,?,?,?,'queued',?,?)",id,device.id,token.owner,engineSession,dedupe,serialized,now(),now()+180000);job=await first(env,'SELECT * FROM jobs WHERE dedupe=?',dedupe);}
 const deadline=now()+25000;
 while(now()<deadline){
  const row=await first(env,'SELECT state,result,expires FROM jobs WHERE id=? AND owner=?',job.id,token.owner);
  if(!row || row.expires<now())return respond(textError('Request expired. Do not replay it automatically; verify the result on your Mac.'));
  if(row.state==='done'){
   const object=await env.BUCKET.get(row.result);if(!object)return respond(textError('The saved result expired. Check the Mac before retrying.'));
   return respond(JSON.parse(await object.text()));
  }
  await sleep(150);
 }
 return respond({content:[{type:'text',text:JSON.stringify({requestId:job.id,state:'pending',action:'Use get_request_status to retrieve this result. Do not execute the command again.'})}]});
}

async function cleanup(env){
 const expired=await all(env,'SELECT id,result FROM jobs WHERE expires<? LIMIT 20',now());
 for(const job of expired){if(job.result)await env.BUCKET.delete(job.result);await run(env,'DELETE FROM jobs WHERE id=?',job.id);}
 await run(env,'DELETE FROM devices WHERE owner IS NULL AND expires<?',now()-3600000);
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/icon.png')return new Response(Uint8Array.from(atob(icon),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png','Cache-Control':'public,max-age=86400'}});
  if(url.pathname==='/healthz')return json({ok:true,service:'FAST',version:'1.0.0'});
  const auth=await oauth(request,env,url);if(auth)return auth;
  if(url.pathname==='/api/mcp')return await mcp(request,env,url,ctx);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/device/')){const response=await deviceAPI(request,env,url);if(response){if(Math.random()<.05)ctx.waitUntil(cleanup(env).catch(()=>{}));return response;}}
  if(['/','/pair','/privacy','/terms','/help'].includes(url.pathname))return page({signedIn:!!user(request),mode:url.pathname.slice(1)||'home',code:url.searchParams.get('code')||''});
  return json({error:'Not found'},404);
 }catch(error){return json({error:error.status?error.message:'Service unavailable. Please try again.'},error.status||503);}
}};
