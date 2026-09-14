import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, realpath, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const [manifestPath,report='benchmarks/images-commands.json']=process.argv.slice(2);
assert(manifestPath,'Pass installed .mcp.json');
const launch=JSON.parse(await readFile(manifestPath,'utf8')).mcpServers.fast_desktop_command;
launch.cwd=path.resolve(path.dirname(manifestPath),launch.cwd||'.');
const scratch=await realpath(await mkdtemp(path.join(os.tmpdir(),'faf-media-benchmark-')));
const configDir=path.join(scratch,'config');
await mkdir(configDir);
let defaultShell=process.env.SHELL || '/bin/zsh';
try { defaultShell=JSON.parse(await readFile(path.join(os.homedir(),'.fast-as-fuck-desktop-command','config.json'),'utf8')).defaultShell || defaultShell; } catch {}
await writeFile(path.join(configDir,'config.json'),JSON.stringify({
  defaultShell,allowedDirectories:[scratch,root],telemetryEnabled:false,
  welcomeOnboardingEligible:false,pendingWelcomeOnboarding:false,
}));
const logo=await readFile(path.join(root,'logo.png'));
const header=await readFile(path.join(root,'header.png'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedLogo=hash(logo);
const expectedHeader=hash(header);
const server=createServer((request,response)=>{
  response.setHeader('Content-Type','image/png');
  response.end(logo);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixtureUrl=`http://127.0.0.1:${server.address().port}/logo.png`;
const remoteUrl='https://raw.githubusercontent.com/wonderwhy-er/DesktopCommanderMCP/74bca3d642dec0973e55db641dcaffd49a70ca40/logo.png';
const measurements={};
const results={timestamp:new Date().toISOString(),manifestPath,defaultShell,
  imageBytes:{logo:logo.length,header:header.length},imageHashes:{logo:expectedLogo,header:expectedHeader},
  remoteUrl,scope:'Installed MCP configuration via SDK. Includes real image payload transfer and decoding to verify SHA-256; excludes model vision and Codex UI. WAN results include Internet latency.',checks:[]};
const client=new Client({name:'faf-image-command-benchmark',version:'1.0.0'});
const transport=new StdioClientTransport({...launch,stderr:'pipe',env:{...process.env,...launch.env,
  DC_CONFIG_DIR:configDir,FAF_TEST_HOME:scratch,
  NODE_OPTIONS:`--import=${new URL('./benchmark-home.mjs',import.meta.url).href}`,
}});
const text=result=>result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function timed(label,name,args,verify) {
  const start=performance.now();
  const result=await client.callTool({name,arguments:args});
  assert(!result.isError,`${name}: ${text(result)}`);
  await verify(result);
  (measurements[label]??=[]).push(performance.now()-start);
  return result;
}
function verifyImage(expected) {
  return result=>{
    const images=result.content.filter(c=>c.type==='image');
    assert.equal(images.length,1);
    assert.equal(images[0].mimeType,'image/png');
    assert.equal(hash(Buffer.from(images[0].data,'base64')),expected);
  };
}
const verifyCommand=result=>assert.match(text(result),/FAF_COMMAND_OK/);
try {
  let start=performance.now();
  await client.connect(transport);
  results.startupMs=performance.now()-start;
  transport.stderr?.on('data',()=>{});
  results.server=client.getServerVersion();
  await client.listTools();
  await timed('firstLocalImage','read_file',{path:path.join(root,'logo.png')},verifyImage(expectedLogo));
  for(let i=0;i<20;i++) await timed('localImage81KB','read_file',{path:path.join(root,'logo.png')},verifyImage(expectedLogo));
  for(let i=0;i<20;i++) await timed('localImage402KB','read_file',{path:path.join(root,'header.png')},verifyImage(expectedHeader));
  await timed('firstHttpImage','read_file',{path:fixtureUrl,isUrl:true},verifyImage(expectedLogo));
  for(let i=0;i<10;i++) await timed('loopbackHttpImage','read_file',{path:fixtureUrl,isUrl:true},verifyImage(expectedLogo));
  for(let i=0;i<5;i++) await timed(i===0?'firstInternetImage':'repeatedInternetImage','read_file',{path:remoteUrl,isUrl:true},verifyImage(expectedLogo));
  await timed('firstDefaultShell','start_process',{command:"printf 'FAF_COMMAND_OK\\n'",timeout_ms:1000},verifyCommand);
  for(let i=0;i<20;i++) await timed('defaultShellCommand','start_process',{command:"printf 'FAF_COMMAND_OK\\n'",timeout_ms:1000},verifyCommand);
  for(let i=0;i<20;i++) await timed('shCommand','start_process',{command:"printf 'FAF_COMMAND_OK\\n'",timeout_ms:1000,shell:'/bin/sh'},verifyCommand);
  for(let i=0;i<10;i++) await timed('nodeCommand','start_process',{
    command:`${quote(process.execPath)} -e ${quote("console.log('FAF_COMMAND_OK')")}`,timeout_ms:1000,shell:'/bin/sh',
  },verifyCommand);
  await timed('commandOnlyArgument','start_process',{command:"printf 'FAF_COMMAND_OK\\n'"},verifyCommand);
  const repl=await timed('nodeReplStartup','start_process',{
    command:`${quote(process.execPath)} -i`,shell:'/bin/sh',timeout_ms:1000,
  },r=>assert.match(text(r),/PID/));
  const replPid=Number(text(repl).match(/PID (\d+)/)?.[1]);
  await client.callTool({name:'interact_with_process',arguments:{pid:replPid,input:'globalThis.fafCounter = 0',timeout_ms:1000}});
  for(let i=1;i<=20;i++) await timed('persistentNodeCommand','interact_with_process',{
    pid:replPid,input:'console.log("COUNT_" + (++globalThis.fafCounter))',timeout_ms:1000,
  },r=>assert.match(text(r),new RegExp(`COUNT_${i}\\b`)));
  await client.callTool({name:'interact_with_process',arguments:{pid:replPid,input:'process.exit(0)',timeout_ms:1000}});
  // Real filesystem side effect and error/exit reporting, not just no-op timings.
  const proof=path.join(scratch,'command-proof.txt');
  await timed('writeAndReadCommand','start_process',{command:`printf 'FAF_COMMAND_OK' > ${quote(proof)}; cat ${quote(proof)}`,timeout_ms:1000,shell:'/bin/sh'},verifyCommand);
  assert.equal(await readFile(proof,'utf8'),'FAF_COMMAND_OK');
  const failed=await timed('nonzeroCommand','start_process',{command:"printf 'expected-error\\n' >&2; exit 7",timeout_ms:1000,shell:'/bin/sh'},r=>assert.match(text(r),/expected-error/));
  const pid=Number(text(failed).match(/PID (\d+)/)?.[1]);
  await timed('nonzeroReadback','read_process_output',{pid,timeout_ms:10},r=>assert.match(text(r),/exit code[: ]+7/i));
  results.checks=['PNG MIME and SHA-256 verified for every image','real HTTPS image fetched','stdout and stderr verified','file side effect read back','exit code 7 preserved','command-only arguments work','Node state persists across 20 commands'];
} finally {
  await client.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
results.rawMs=measurements;
results.measurements=Object.fromEntries(Object.entries(measurements).map(([label,values])=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return [label,{n:sorted.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],minMs:sorted[0],maxMs:sorted.at(-1)}];
}));
await mkdir(path.dirname(path.resolve(root,report)),{recursive:true});
await writeFile(path.resolve(root,report),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({...results,rawMs:undefined},null,2));
