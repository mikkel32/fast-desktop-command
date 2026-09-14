import { createServer as createSocketServer, createConnection } from 'node:net';
import { createServer as createHTTPServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, chmod, writeFile, readFile, lstat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebConnection } from './web-connection.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=process.env.FAF_APP_RUNTIME_DIR || path.join(os.homedir(),'.fast-as-fuck-desktop-command','app');
const socketPath=path.join(directory,'mcp.sock');
const statePath=path.join(directory,'service.json');
const web=new WebConnection({root,runtimeDirectory:directory});
const token=randomBytes(32).toString('hex');
const sessions=new Map();
const events=[];
let closing=false;
let checkInFlight;
let lastCheck=null;
let version='';
let toolCount=0;
let nativeEnabled=false;
const startedAt=new Date().toISOString();
const env={...process.env,DESKTOP_COMMANDER_DISABLE_TELEMETRY:'true'};
const log=(message)=>{events.push({id:randomBytes(6).toString('hex'),time:new Date().toISOString(),message});if(events.length>20)events.shift();};
const canary=new Client({name:'fast-desktop-health',version:'1.0.0'});
const canaryTransport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist','local.js')],cwd:root,env,stderr:'pipe'});

await mkdir(directory,{recursive:true,mode:0o700});
await chmod(directory,0o700);
// Only remove a stale socket after proving that nothing is listening there.
try {
  const stat=await lstat(socketPath);
  if(!stat.isSocket() || stat.uid!==process.getuid()) throw new Error('Connection path is occupied by another file.');
  const alive=await new Promise(resolve=>{
    const connection=createConnection(socketPath);
    connection.once('connect',()=>{connection.destroy();resolve(true);});
    connection.once('error',error=>resolve(error.code!=='ECONNREFUSED' && error.code!=='ENOENT'));
  });
  if(alive) throw new Error('Fast Desktop Command is already running.');
  await unlink(socketPath);
} catch(error) {if(error.code!=='ENOENT') throw error;}

await canary.connect(canaryTransport);
canaryTransport.stderr?.on('data',()=>{});
version=canary.getServerVersion()?.version || 'unknown';
toolCount=(await canary.listTools()).tools.length;
try {nativeEnabled=JSON.parse(await readFile(path.join(process.env.DC_CONFIG_DIR || path.join(os.homedir(),'.fast-as-fuck-desktop-command'),'config.json'),'utf8')).nativeControlEnabled===true;} catch {}
log('Connection started.');

const text=result=>result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n') || '';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fullCheck() {
  if(checkInFlight) return checkInFlight;
  checkInFlight=(async()=>{
    const result={checkedAt:new Date().toISOString(),healthy:false,pingMs:null,commandMs:null,imageMs:null,error:null};
    try {
      let start=performance.now();
      await canary.ping({timeout:2500});
      result.pingMs=performance.now()-start;
      start=performance.now();
      const command=await canary.callTool({name:'start_process',arguments:{command:"printf 'FAST_HEALTH_OK\\n'",shell:'/bin/sh',timeout_ms:1000}},undefined,{timeout:4000});
      if(command.isError || !text(command).includes('FAST_HEALTH_OK')) throw new Error('Command check did not return the expected output.');
      result.commandMs=performance.now()-start;
      const imagePath=path.join(root,'icon.png');
      const expected=hash(await readFile(imagePath));
      start=performance.now();
      const image=await canary.callTool({name:'read_file',arguments:{path:imagePath}},undefined,{timeout:4000});
      const block=image.content?.find(item=>item.type==='image');
      if(image.isError || !block || hash(Buffer.from(block.data,'base64'))!==expected) throw new Error('Image check did not return the expected image.');
      result.imageMs=performance.now()-start;
      result.healthy=true;
      log('Commands and images checked successfully.');
    } catch(error) {result.error=error.message;log('Health check needs attention.');}
    lastCheck=result;
    return result;
  })().finally(()=>{checkInFlight=undefined;});
  return checkInFlight;
}

function stopChild(child) {
  if(child.exitCode!==null || child.signalCode!==null) return;
  try {process.kill(-child.pid,'SIGTERM');} catch {}
  const timer=setTimeout(()=>{if(child.exitCode===null && child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}},1500);
  timer.unref();
}
const socketServer=createSocketServer(socket=>{
  if(closing){socket.destroy();return;}
  const id=randomBytes(6).toString('hex');
  const child=spawn(process.execPath,[path.join(root,'dist','local.js')],{cwd:root,env,stdio:['pipe','pipe','pipe'],detached:true});
  const session={id,pid:child.pid,connectedAt:new Date().toISOString(),ready:false,socket,child};
  sessions.set(id,session);
  let handshake='';
  let ended=false;
  const finish=()=>{if(ended)return;ended=true;sessions.delete(id);socket.destroy();stopChild(child);log('An app disconnected.');};
  // Stream bytes unchanged: each client has its own MCP identity and process state.
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
  child.stdout.on('data',chunk=>{
    if(!session.ready) {
      handshake=(handshake+chunk.toString()).slice(-32768);
      if(handshake.includes('"serverInfo"')) {session.ready=true;handshake='';log('An app connected.');}
    }
  });
  child.stderr.on('data',()=>{});
  child.stdin.on('error',finish);
  child.once('error',()=>{log('An app connection could not start.');finish();});
  child.once('close',code=>{if(!ended && code)log('An app connection stopped unexpectedly.');finish();});
  socket.once('error',finish);
  socket.once('close',finish);
});
await new Promise((resolve,reject)=>{socketServer.once('error',reject);socketServer.listen(socketPath,resolve);});
await chmod(socketPath,0o600);

function authorized(request) {
  const supplied=Buffer.from(request.headers.authorization || '');
  const expected=Buffer.from(`Bearer ${token}`);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}
const httpServer=createHTTPServer(async(request,response)=>{
  response.setHeader('Content-Type','application/json');
  response.setHeader('Cache-Control','no-store');
  if(!authorized(request)){response.writeHead(401);response.end('{"error":"Unauthorized"}');return;}
  if(request.url==='/native/enable' && request.method==='POST'){
    let input='';for await(const chunk of request){input+=chunk;if(input.length>1024){response.writeHead(413);response.end('{}');return;}}
    try{const data=JSON.parse(input);if(typeof data.enabled!=='boolean')throw Error();const result=await canary.callTool({name:'set_config_value',arguments:{key:'nativeControlEnabled',value:data.enabled}});if(result.isError)throw Error();nativeEnabled=data.enabled;response.end(JSON.stringify({enabled:nativeEnabled}));}catch{response.writeHead(400);response.end('{"error":"Could not update native controls"}');}return;
  }
  if(request.url==='/web/pair' && request.method==='POST'){
    try{response.end(JSON.stringify(await web.pair()));}catch(error){response.writeHead(503);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(request.url==='/web/disconnect' && request.method==='POST'){await web.stop(true);response.end(JSON.stringify(web.status()));return;}
  if(request.url==='/check' && request.method==='POST') await fullCheck();
  else if(request.url!=='/health' || request.method!=='GET') {response.writeHead(404);response.end('{}');return;}
  let healthy=false,pingMs=null,error=null;
  try {const start=performance.now();await canary.ping({timeout:2500});pingMs=performance.now()-start;healthy=true;}
  catch(failure){error=failure.message;}
  response.end(JSON.stringify({healthy,pingMs,error,version,toolCount,startedAt,pid:process.pid,
    clients:[...sessions.values()].map(({id,pid,ready,connectedAt})=>({id,pid,ready,connectedAt})),lastCheck,events,web:web.status(),nativeEnabled}));
});
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
await fullCheck();
await writeFile(statePath,JSON.stringify({pid:process.pid,port:httpServer.address().port,token,socketPath,startedAt}),{mode:0o600});
await chmod(statePath,0o600);
process.stdout.write(JSON.stringify({event:'ready',pid:process.pid})+'\n');
await web.resume();

async function stop() {
  if(closing)return;
  closing=true;
  await web.stop();
  socketServer.close();
  for(const {socket,child} of sessions.values()){socket.destroy();stopChild(child);}
  httpServer.closeAllConnections();
  httpServer.close();
  await canary.close();
  for(const file of [statePath,socketPath]) {
    try {await unlink(file);} catch(error){if(error.code!=='ENOENT')process.stderr.write(error.message+'\n');}
  }
  process.exit(0);
}
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
// The native app owns this pipe. Abrupt app exit also tears down its service.
process.stdin.on('end',stop);
process.stdin.resume();
