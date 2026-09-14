import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/server.js';
import {pkce} from '../worker/protocol.js';

function environment(){
 const database=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())database.exec(readFileSync('drizzle/'+file,'utf8'));
 const DB={
  prepare(sql){
   return {bind(...params){
    return {
     async first(){return database.prepare(sql).get(...params)??null;},
     async all(){return {results:database.prepare(sql).all(...params)};},
     async run(){return database.prepare(sql).run(...params);}
    };
   }};
  },
  async batch(items){return Promise.all(items.map(item=>item.run()));}
 };
 const blobs=new Map();const BUCKET={async put(key,text){blobs.set(key,text);},async get(key){return blobs.has(key)?{text:async()=>blobs.get(key)}:null;},async delete(key){blobs.delete(key);}};
 return {DB,BUCKET,database};
}
const origin='https://fast.example';
function client(env,owner){return async(route,data,extra={})=>{
 const request=new Request(origin+route,{method:data===undefined?'GET':'POST',headers:{...(owner?{'oai-authenticated-user-id':owner}:{}),Origin:origin,'Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
 return worker.fetch(request,env,{waitUntil:()=>{}});
};}
async function jsonRequest(call,route,data,headers){const r=await call(route,data,headers);const b=await r.json();return {status:r.status,body:b,response:r};}
async function account(env,owner){
 const call=client(env,owner),redirect='https://chatgpt.com/connector_platform/oauth/callback';
 const reg=await jsonRequest(call,'/oauth/register',{redirect_uris:[redirect],client_name:'ChatGPT'});
 const verifier='a'.repeat(43),challenge=await pkce(verifier);
 const q=new URLSearchParams({client_id:reg.body.client_id,redirect_uri:redirect,response_type:'code',resource:origin+'/api/mcp',scope:'computer',code_challenge:challenge,code_challenge_method:'S256',state:'test'});
 const consent=await call('/oauth/authorize?'+q);
 assert.equal(consent.status,200);
 const nonce=env.database.prepare('SELECT id FROM oauth_consents WHERE owner=?').get(owner).id;
 const approved=await jsonRequest(call,'/oauth/authorize',{nonce});
 const code=new URL(approved.body.redirect).searchParams.get('code');
 const exchanged=await jsonRequest(call,'/oauth/token',{grant_type:'authorization_code',code,client_id:reg.body.client_id,redirect_uri:redirect,resource:origin+'/api/mcp',code_verifier:verifier});
 assert.equal(exchanged.status,200,JSON.stringify(exchanged.body));
 return {call,token:exchanged.body.access_token,refresh:exchanged.body.refresh_token,clientId:reg.body.client_id};
}
test('pairing, OAuth PKCE, tenant isolation, exact result relay, deduplication and revocation',async()=>{
 const env=environment(),anonymous=client(env),a=await account(env,'owner-a'),b=await account(env,'owner-b');
 const pair=await jsonRequest(anonymous,'/api/pair/start',{name:'Test Mac'});
 assert.equal((await jsonRequest(anonymous,'/device/poll',{initial:true},{Authorization:'Bearer '+pair.body.device_token})).status,401);
 const denied=await jsonRequest(a.call,'/api/pair/confirm',{code:pair.body.user_code},{Origin:'https://evil.example'});assert.equal(denied.status,403);
 assert.equal((await jsonRequest(a.call,'/api/pair/confirm',{code:pair.body.user_code})).status,200);
 assert.equal((await jsonRequest(b.call,'/api/devices')).body.devices.length,0);
 const deviceHeaders={Authorization:'Bearer '+pair.body.device_token};
 await jsonRequest(anonymous,'/device/poll',{initial:true},deviceHeaders);
 const auth={Authorization:'Bearer '+a.token};
 const init=await jsonRequest(a.call,'/api/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},auth);
 const session=init.response.headers.get('mcp-session-id');assert(session);
 const headers={...auth,'Mcp-Session-Id':session};
 const request={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'list_sessions',arguments:{requestKey:'fixture-request'}}};
 const pending=jsonRequest(a.call,'/api/mcp',request,headers);
 const work=await jsonRequest(anonymous,'/device/poll',{},deviceHeaders);
 assert.equal(work.body.jobs.length,1);
 const job=work.body.jobs[0],result={content:[{type:'text',text:'verified-result'}]};
 await jsonRequest(anonymous,'/device/result',{id:job.id,lease:job.lease,result},deviceHeaders);
 assert.deepEqual((await pending).body.result,result);
 assert.deepEqual((await jsonRequest(a.call,'/api/mcp',request,headers)).body.result,result);
 const reconnect=await jsonRequest(a.call,'/api/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},auth);
 assert.deepEqual((await jsonRequest(a.call,'/api/mcp',request,{...auth,'Mcp-Session-Id':reconnect.response.headers.get('mcp-session-id')})).body.result,result);
 assert.equal(env.database.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
 const stolen=await jsonRequest(b.call,'/api/mcp',{...request,id:3},{Authorization:'Bearer '+b.token,'Mcp-Session-Id':session});assert.equal(stolen.status,404);
 const codeReplay=await jsonRequest(a.call,'/oauth/token',{grant_type:'refresh_token',refresh_token:a.refresh,client_id:a.clientId,resource:origin+'/api/mcp'});assert.equal(codeReplay.status,200);
 assert.equal((await jsonRequest(a.call,'/oauth/token',{grant_type:'refresh_token',refresh_token:a.refresh,client_id:a.clientId,resource:origin+'/api/mcp'})).status,400);
 await jsonRequest(a.call,'/api/devices/revoke',{id:pair.body.device_id});
 assert.equal((await jsonRequest(anonymous,'/device/poll',{initial:true},deviceHeaders)).status,401);
 env.database.close();
});
test('metadata is accurate and anonymous command requests do not reach a device',async()=>{
 const env=environment(),call=client(env);
 const meta=await jsonRequest(call,'/.well-known/oauth-authorization-server');assert.deepEqual(meta.body.code_challenge_methods_supported,['S256']);
 const init=await jsonRequest(call,'/api/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{}});assert.equal(init.status,200);assert(init.body.result.capabilities.tools);assert.equal(init.response.headers.get('mcp-session-id'),null);
 const inventory=await jsonRequest(call,'/api/mcp',{jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal(inventory.body.result.tools.length,32);assert(inventory.body.result.tools.every(tool=>tool.securitySchemes[0].type==='oauth2'));
 const command=await jsonRequest(call,'/api/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'start_process',arguments:{command:'ignored'}}});assert(command.body.result.isError);
 assert.equal(env.database.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
 const wrong=await jsonRequest(call,'/oauth/register',{redirect_uris:['https://evil.example/callback']});assert.equal(wrong.status,400);
 env.database.close();
});
