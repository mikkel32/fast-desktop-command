import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('app controls real MCP clients, verifies health, isolates sessions, and restarts', {timeout:20000},async()=>{
  // Keep the Unix socket path below macOS's length limit.
  const directory=await mkdtemp('/tmp/faf-app-test-');
  const env={...process.env,FAF_APP_RUNTIME_DIR:directory,DC_CONFIG_DIR:path.join(directory,'config'),FAF_NO_AUTO_OPEN:'1'};
  const clients=[];
  let service;
  let stderr='';
  async function startService(){
    service=spawn(process.execPath,['scripts/app-service.mjs'],{cwd:root,env,stdio:['pipe','pipe','pipe']});
    service.stderr.on('data',chunk=>{stderr+=chunk;});
    service.stdout.resume();
    for(let i=0;i<100;i++){
      assert.equal(service.exitCode,null,stderr);
      try{
        const state=JSON.parse(await readFile(path.join(directory,'service.json'),'utf8'));
        if(state.pid===service.pid)return state;
      }catch{}
      await delay(50);
    }
    throw new Error('App service did not become ready: '+stderr);
  }
  async function stopService(){
    if(!service || service.exitCode!==null)return;
    const done=new Promise(resolve=>service.once('exit',resolve));
    service.stdin.end();
    await done;
  }
  async function health(state,check=false){
    const response=await fetch(`http://127.0.0.1:${state.port}/${check?'check':'health'}`,{method:check?'POST':'GET',headers:{Authorization:`Bearer ${state.token}`}});
    assert.equal(response.status,200);
    return response.json();
  }
  async function connect(){
    const client=new Client({name:'fast-native-app-test',version:'1'});
    const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/app-connect.mjs')],env,stderr:'pipe'});
    await client.connect(transport);
    transport.stderr?.resume();
    clients.push(client);
    return client;
  }
  try{
    let state=await startService();
    assert.equal((await stat(path.join(directory,'service.json'))).mode&0o077,0);
    assert.equal((await stat(path.join(directory,'mcp.sock'))).mode&0o077,0);
    assert.equal((await fetch(`http://127.0.0.1:${state.port}/health`)).status,401);
    let status=await health(state,true);
    assert(status.healthy && status.lastCheck.healthy);
    assert.equal(status.toolCount,33);
    const first=await connect(),second=await connect();
    assert.equal((await first.listTools()).tools.length,33);
    assert.equal(status.nativeEnabled,false);
    const nativeURL=`http://127.0.0.1:${state.port}/native/enable`;
    assert.equal((await fetch(nativeURL,{method:'POST',body:JSON.stringify({enabled:true})})).status,401);
    for(const enabled of [true,false]){
      const response=await fetch(nativeURL,{method:'POST',headers:{Authorization:`Bearer ${state.token}`},body:JSON.stringify({enabled})});
      assert.equal(response.status,200);
      assert.equal((await health(state)).nativeEnabled,enabled);
      assert.equal(JSON.parse(await readFile(path.join(directory,'config/config.json'),'utf8')).nativeControlEnabled,enabled);
      if(enabled && process.platform==='darwin'){
        const untouched=await connect();
        const noTarget=await untouched.callTool({name:'native_click',arguments:{x:0,y:0}});
        assert.equal(noTarget.isError,true);
        assert.match(noTarget.content[0].text,/Capture the target window/);
        await untouched.close();
      }
    }
    const toolChange=await first.callTool({name:'set_config_value',arguments:{key:'nativeControlEnabled',value:true}});
    assert.equal(toolChange.isError,true);
    const blockedInput=await first.callTool({name:'native_key',arguments:{key:'escape'}});
    assert.equal(blockedInput.isError,true);
    assert.match(blockedInput.content[0].text,/Native input is disabled/);
    status=await health(state);
    assert.equal(status.clients.filter(c=>c.ready).length,2);
    const started=await first.callTool({name:'start_process',arguments:{command:'node -i',shell:'/bin/sh',timeout_ms:1000}});
    const pid=Number(started.content[0].text.match(/PID (\d+)/)?.[1]);
    assert(pid>0);
    const firstSessions=await first.callTool({name:'list_sessions',arguments:{}});
    const secondSessions=await second.callTool({name:'list_sessions',arguments:{}});
    assert(firstSessions.content[0].text.includes(String(pid)));
    assert(!secondSessions.content[0].text.includes(String(pid)));
    const original=await readFile(path.join(root,'header.png'));
    const result=await first.callTool({name:'read_file',arguments:{path:path.join(root,'header.png')}});
    assert.deepEqual(Buffer.from(result.content.find(c=>c.type==='image').data,'base64'),original);
    await first.callTool({name:'interact_with_process',arguments:{pid,input:'process.exit(0)',timeout_ms:1000}});
    await first.close();await second.close();
    await stopService();
    await assert.rejects(()=>stat(path.join(directory,'service.json')),/ENOENT/);
    state=await startService();
    const fresh=await connect();
    await fresh.ping();
    status=await health(state);
    assert(status.healthy);
    assert.equal(status.clients.filter(c=>c.ready).length,1);
    await fresh.close();
  }finally{
    for(const client of clients)await client.close().catch(()=>{});
    await stopService();
    await rm(directory,{recursive:true,force:true});
  }
});
