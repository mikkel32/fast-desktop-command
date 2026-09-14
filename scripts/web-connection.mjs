import {readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class WebConnection {
  constructor({root,runtimeDirectory}){
    this.root=root;this.runtimeDirectory=runtimeDirectory;
    this.base=process.env.FAF_WEB_URL || 'https://fast-desktop-command.mikkel-mynderup.chatgpt.site';
    if(new URL(this.base).protocol!=='https:')throw new Error('Web connections require HTTPS.');
    this.file=path.join(runtimeDirectory,'web-connection.json');
    this.clients=new Map();this.inflight=new Set();this.generation=0;
    this.state={state:'disconnected',message:'Connect your Mac to ChatGPT on the web.'};
  }
  status(){return {...this.state,siteURL:this.base};}
  async api(route,data,token){
    const response=await fetch(this.base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(route==='/device/poll'?15000:10000)});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.error||'Web connection unavailable.'),{status:response.status});
    return result;
  }
  async resume(){
    try{const config=JSON.parse(await readFile(this.file,'utf8'));if(config.site!==this.base)return;this.connect(config.token);}
    catch{}
  }
  async pair(){
    await this.stop(false);
    const generation=++this.generation;
    this.state={state:'pairing',message:'Creating a pairing code...'};
    try{
      const pair=await this.api('/api/pair/start',{name:process.env.FAF_DEVICE_NAME || os.hostname()});
      if(new URL(pair.verification_uri).origin!==new URL(this.base).origin)throw new Error('Unexpected pairing destination.');
      this.state={state:'pairing',message:'Confirm this code on the FAST website.',code:pair.user_code,verificationURL:pair.verification_uri};
      void (async()=>{
        const deadline=Date.now()+pair.expires_in*1000;
        while(this.generation===generation && Date.now()<deadline){
          await wait(2000);
          const result=await this.api('/api/pair/status',{device_code:pair.device_code});
          if(this.generation!==generation)return;
          if(result.approved){await writeFile(this.file,JSON.stringify({site:this.base,token:pair.device_token}),{mode:0o600});this.connect(pair.device_token);return;}
        }
        if(this.generation===generation)this.state={state:'disconnected',message:'Pairing expired. Create a new code.'};
      })().catch(error=>{if(this.generation===generation)this.state={state:'error',message:error.message};});
      return this.status();
    }catch(error){this.state={state:'error',message:error.message};throw error;}
  }
  connect(token){
    const generation=++this.generation;
    this.state={state:'connecting',message:'Connecting to the web...'};
    void (async()=>{
      await this.api('/device/poll',{initial:true},token);
      while(this.generation===generation){
        try{
          this.state={state:'connected',message:'Your Mac is available to your authenticated account.'};
          const {jobs}=await this.api('/device/poll',{},token);
          if(this.generation!==generation)return;
          for(const job of jobs)if(!this.inflight.has(job.id)){
            this.inflight.add(job.id);
            void this.execute(job,token,generation).finally(()=>this.inflight.delete(job.id));
          }
        }catch(error){
          if(this.generation!==generation)return;
          this.state={state:'error',message:error.status===401?'Web access was revoked. Pair this Mac again.':error.message};
          if(error.status===401)return;
          await wait(2000);
        }
      }
    })().catch(error=>{if(this.generation===generation)this.state={state:'error',message:error.message};});
  }
  async session(id){
    if(this.clients.has(id))return this.clients.get(id);
    if(this.clients.size>=12)throw new Error('Too many web sessions. Restart the web connection to clear inactive sessions.');
    const promise=(async()=>{
      const client=new Client({name:'fast-web-client',version:'1.0.0'});
      const transport=new StdioClientTransport({command:process.execPath,args:[path.join(this.root,'scripts/app-connect.mjs')],cwd:this.root,env:{...process.env,FAF_APP_RUNTIME_DIR:this.runtimeDirectory,FAF_NO_AUTO_OPEN:'1'},stderr:'pipe'});
      await client.connect(transport);transport.stderr?.resume();return client;
    })();
    this.clients.set(id,promise);
    promise.catch(()=>this.clients.delete(id));
    return promise;
  }
  async execute(job,token,generation){
    let result;
    try{
      const client=await this.session(job.session);
      result=await client.callTool(job.request.params,undefined,{timeout:160000});
    }catch(error){result={isError:true,content:[{type:'text',text:error.message}]};}
    // Retrying result delivery is safe. Never execute the command again.
    for(let attempt=0;attempt<4 && this.generation===generation;attempt++){
      try{await this.api('/device/result',{id:job.id,lease:job.lease,result},token);return;}
      catch(error){if(error.status===410||error.status===401)return;await wait(500*(attempt+1));}
    }
  }
  async stop(forget=false){
    this.generation++;
    const clients=[...this.clients.values()];this.clients.clear();
    for(const promise of clients){try{await (await promise).close();}catch{}}
    if(forget){try{await unlink(this.file);}catch{}}
    this.state={state:'disconnected',message:'Web connection stopped.'};
  }
}
