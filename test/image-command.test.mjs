import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import cp from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=await realpath(await mkdtemp(path.join(os.tmpdir(),'faf-image-tests-')));
process.env.DC_CONFIG_DIR=scratch;
process.env.DC_LOCAL_PLUGIN='true';
process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY='true';
let editorProbes=0;
const originalExec=cp.execFile;
const probe=async()=>{
  editorProbes++;
  return {stdout:'TestViewer\n/Applications/Preview.app\n',stderr:''};
};
cp.execFile=Object.assign(()=>{throw new Error('unexpected callback invocation');},{[promisify.custom]:probe});
syncBuiltinESMExports();
const { handleReadFile }=await import('../dist/handlers/filesystem-handlers.js');
const { readFileFromUrl }=await import('../dist/tools/filesystem.js');
const { StartProcessArgsSchema }=await import('../dist/tools/schemas.js');
const { startProcess, readProcessOutput }=await import('../dist/tools/improved-process-tools.js');
const {configManager}=await import('../dist/config-manager.js');
await configManager.loadConfig();
const logoPath=path.join(root,'logo.png');
const logo=await readFile(logoPath);
after(async()=>{
  cp.execFile=originalExec;
  syncBuiltinESMExports();
  await rm(scratch,{recursive:true,force:true});
});

test('first model image read returns exact bytes without probing the default editor',async()=>{
  const result=await handleReadFile({path:logoPath});
  assert(!result.isError);
  const image=result.content.find(c=>c.type==='image');
  assert.equal(image.mimeType,'image/png');
  assert.deepEqual(Buffer.from(image.data,'base64'),logo);
  assert.equal(result.structuredContent,undefined);
  assert.equal(editorProbes,0);
});

test('widget image read retains text payload and local editor metadata',async()=>{
  const result=await handleReadFile({path:logoPath,origin:'ui'});
  assert(!result.isError);
  assert(result.content.every(c=>c.type==='text'));
  assert.deepEqual(Buffer.from(result.content[0].text,'base64'),logo);
  if(os.platform()==='darwin') {
    assert.equal(result.structuredContent.defaultEditorName,'TestViewer');
    assert.equal(editorProbes,1);
  }
});

test('URL images normalize MIME headers and do not probe a local editor',async()=>{
  const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'IMAGE/PNG; charset=binary'});res.end(logo);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const before=editorProbes;
    const url=`http://127.0.0.1:${server.address().port}/image`;
    const result=await handleReadFile({path:url,isUrl:true});
    const image=result.content.find(c=>c.type==='image');
    assert.equal(image.mimeType,'image/png');
    assert.deepEqual(Buffer.from(image.data,'base64'),logo);
    const widget=await handleReadFile({path:url,isUrl:true,origin:'ui'});
    assert.equal(widget.structuredContent.defaultEditorName,undefined);
    assert.equal(editorProbes,before);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('URL timeout remains active while image body is stalled after headers',async()=>{
  let headersSent=false;
  const server=createServer((req,res)=>{
    res.writeHead(200,{'Content-Type':'image/png'});
    res.write(logo.subarray(0,8));
    headersSent=true;
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const originalTimeout=globalThis.setTimeout;
  // Scale the real production deadline so this regression takes milliseconds.
  globalThis.setTimeout=(callback,delay,...args)=>originalTimeout(callback,delay===30000?60:delay,...args);
  try {
    await assert.rejects(()=>readFileFromUrl(`http://127.0.0.1:${server.address().port}/stalled`),/URL fetch timed out/);
    assert(headersSent);
  } finally {
    globalThis.setTimeout=originalTimeout;
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('commands need only command; early completion and nonzero exit are preserved',async()=>{
  assert.equal(StartProcessArgsSchema.parse({command:'printf ok'}).timeout_ms,1000);
  const result=await startProcess({command:"printf 'command-default-ok\\n'; exit 7",shell:'/bin/sh'});
  assert.match(result.content[0].text,/command-default-ok/);
  const pid=Number(result.content[0].text.match(/PID (\d+)/)?.[1]);
  const output=await readProcessOutput({pid,timeout_ms:1});
  assert.match(output.content[0].text,/exit code[: ]+7/i);
});
