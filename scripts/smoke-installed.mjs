import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Pass the installed .mcp.json path');
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const launch = manifest.mcpServers.fast_desktop_command;
assert(launch, 'installed server is missing');
const client = new Client({name:'faf-installed-plugin-smoke', version:'1.0.0'});
const transport = new StdioClientTransport({...launch, env:{...process.env,...launch.env}, stderr:'pipe'});
const receipt = {timestamp:new Date().toISOString(), manifestPath, launch, checks:[]};
const text = result => result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
async function call(name,args) {
  const start = performance.now();
  const result = await client.callTool({name, arguments:args});
  assert(!result.isError, `${name}: ${text(result)}`);
  receipt.checks.push({name, durationMs:performance.now()-start});
  return result;
}
try {
  const start = performance.now();
  await client.connect(transport);
  receipt.startupMs = performance.now()-start;
  transport.stderr?.on('data', () => {});
  receipt.server = client.getServerVersion();
  assert.equal(receipt.server.name, 'fast-as-fuck-desktop-command');
  assert.equal(receipt.server.version, '0.2.50+faf.3');
  const listStart = performance.now();
  const tools = await client.listTools();
  receipt.discoveryMs = performance.now()-listStart;
  receipt.toolNames = tools.tools.map(tool=>tool.name);
  assert(receipt.toolNames.includes('edit_block'));
  await call('list_sessions', {});
  const packageResult = await call('read_file', {path:path.join(root,'package.json'), length:8});
  assert.match(text(packageResult), /desktop-commander/);
  const smokeDir = path.join(root,'benchmarks',`smoke-${Date.now()}`);
  await call('create_directory', {path:smokeDir});
  const file = path.join(smokeDir,'proof.txt');
  await call('write_file', {path:file, content:'plugin write verified\n'});
  await call('edit_block', {file_path:file, old_string:'plugin write verified', new_string:'plugin edit verified'});
  const reread = await call('read_file', {path:file});
  assert.match(text(reread), /plugin edit verified/);
  assert.equal(await readFile(file,'utf8'), 'plugin edit verified\n');
  const search = await call('start_search', {path:smokeDir, pattern:'plugin edit verified', searchType:'content', literalSearch:true});
  const sessionId = text(search).match(/session: (\S+)/)?.[1];
  assert(sessionId, 'search session ID missing');
  let found = '';
  for (let attempt=0; attempt<20; attempt++) {
    const page = await call('get_more_search_results', {sessionId, offset:0, length:10});
    found = text(page);
    if (/Status: COMPLETED/.test(found)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(found, /proof\.txt/);
  assert.match(found, /plugin edit verified/);
  const processResult = await call('start_process', {command:"printf 'FAF_PLUGIN_OK\\n'", timeout_ms:1000, shell:'/bin/sh'});
  assert.match(text(processResult), /FAF_PLUGIN_OK/);
  receipt.proofFile = file;
  receipt.status = 'passed';
} finally { await client.close(); }
await mkdir(path.join(root,'benchmarks'), {recursive:true});
await writeFile(path.join(root,'benchmarks','installed-smoke.json'), JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
