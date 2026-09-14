import {createConnection} from 'node:net';
import {access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=process.env.FAF_APP_RUNTIME_DIR || path.join(os.homedir(),'.fast-as-fuck-desktop-command','app');
const socketPath=path.join(directory,'mcp.sock');
async function connect() {
  return new Promise((resolve,reject)=>{
    const socket=createConnection(socketPath);
    socket.once('connect',()=>{socket.removeListener('error',reject);resolve(socket);});
    socket.once('error',reject);
  });
}
let socket;
try {socket=await connect();} catch {
  const paused=await access(path.join(directory,'paused')).then(()=>true,()=>false);
  if(paused) throw new Error('The connection is stopped. Open Fast Desktop Command and click Start connection.');
  if(process.env.FAF_NO_AUTO_OPEN==='1') throw new Error('Open Fast Desktop Command and start the connection.');
  // Opening the native app is the only launch path; never silently start a second service.
  await new Promise((resolve,reject)=>execFile('/usr/bin/open',['-gj',process.env.FAF_APP_BUNDLE || path.join(root,'Fast Desktop Command.app')],error=>error?reject(error):resolve()));
  const deadline=Date.now()+12000;
  while(!socket && Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,100));
    try {socket=await connect();} catch {}
  }
  if(!socket) throw new Error('Open Fast Desktop Command and click Start connection.');
}
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on('error',error=>{process.stderr.write(`Fast Desktop Command: ${error.message}\n`);process.exitCode=1;});
socket.on('close',()=>process.exit());
process.stdin.on('end',()=>socket.end());
process.on('SIGTERM',()=>{socket.destroy();process.exit();});
