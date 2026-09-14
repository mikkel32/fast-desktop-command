import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [entry = 'dist/local.js', report = 'benchmarks/local.json'] = process.argv.slice(2);
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'faf-dc-benchmark-')));
const configDir = path.join(scratch, '.claude-server-commander');
await mkdir(configDir);
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({
  allowedDirectories: [scratch, root], telemetryEnabled: false,
  defaultShell: '/bin/sh', welcomeOnboardingEligible: false,
  pendingWelcomeOnboarding: false, fileReadLineLimit: 1000,
}));
const fixture = path.join(scratch, 'fixture.cjs');
await writeFile(fixture, `
const readline = require('node:readline');
process.stdout.write('FAF> ');
readline.createInterface({input: process.stdin}).on('line', line => {
  if (line === 'quit') process.exit(0);
  if (line === 'silent-exit') return setTimeout(() => process.exit(0), 30);
  process.stdout.write('reply:' + line + '\\nFAF> ');
});
`);
const sampleFile = path.join(scratch, 'sample.txt');
await writeFile(sampleFile, 'alpha\nbeta\ngamma\n');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const textOf = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const pidOf = result => Number(textOf(result).match(/PID (\d+)/)?.[1]);
const measurements = {};
async function timed(name, action) {
  const start = performance.now();
  const result = await action();
  (measurements[name] ??= []).push(performance.now() - start);
  return result;
}
function summary(samples) {
  const sorted = [...samples].sort((a,b) => a-b);
  return { n: sorted.length, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length/2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95)-1], maxMs: sorted.at(-1) };
}
let launch = { command: process.execPath, args: [path.resolve(root, entry), '--no-onboarding'], cwd: root };
if (entry.endsWith('.mcp.json')) {
  const manifest = JSON.parse(await readFile(entry, 'utf8'));
  launch = Object.values(manifest.mcpServers)[0];
  launch.cwd = path.resolve(path.dirname(entry), launch.cwd || '.');
}
const client = new Client({ name: 'faf-desktop-command-benchmark', version: '1.0.0' });
const transport = new StdioClientTransport({ ...launch, stderr: 'pipe', env: {
  ...process.env, ...launch.env,
  FAF_TEST_HOME: scratch, DC_CONFIG_DIR: configDir,
  DESKTOP_COMMANDER_DISABLE_TELEMETRY: 'true',
  NODE_OPTIONS: `--import=${new URL('./benchmark-home.mjs', import.meta.url).href}`,
}});
let stderr = '';
let tools;
let serverVersion;
try {
  await timed('startupHandshake', () => client.connect(transport));
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  serverVersion = client.getServerVersion();
  tools = await timed('toolDiscovery', () => client.listTools());
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, `${name}: ${textOf(result)}`);
    return result;
  };
  for (let i=0; i<30; i++) await timed('protocolPing', () => client.ping());
  for (let i=0; i<20; i++) await timed('listSessions', () => call('list_sessions', {}));
  for (let i=0; i<20; i++) {
    const result = await timed('readSmallFile', () => call('read_file', {path: sampleFile}));
    assert(textOf(result).includes('beta'));
  }
  const edited = path.join(scratch, 'edited.txt');
  await call('write_file', {path: edited, content: 'before\n'});
  await call('edit_block', {file_path: edited, old_string: 'before', new_string: 'after'});
  assert.equal(await readFile(edited, 'utf8'), 'after\n');
  for (let i=0; i<5; i++) {
    const result = await timed('shortProcess', () => call('start_process', {
      command: `${quote(process.execPath)} -e ${quote("process.stdout.write('done')")}`,
      timeout_ms: 1000, shell: '/bin/sh',
    }));
    assert(textOf(result).includes('done'));
  }
  const started = await call('start_process', {
    command: `${quote(process.execPath)} ${quote(fixture)}`, timeout_ms: 1000, shell: '/bin/sh',
  });
  const pid = pidOf(started);
  assert(pid > 0);
  for (let i=0; i<20; i++) {
    const result = await timed('interactiveReply', () => call('interact_with_process', {
      pid, input: `hello-${i}`, timeout_ms: 1000,
    }));
    assert(textOf(result).includes(`reply:hello-${i}`));
  }
  await timed('silentInteractiveExit', () => call('interact_with_process', {
    pid, input: 'silent-exit', timeout_ms: 800,
  }));
  const silent = await call('start_process', {
    command: `${quote(process.execPath)} -e ${quote('setTimeout(() => process.exit(0), 120)')}`,
    timeout_ms: 1, shell: '/bin/sh',
  });
  const completed = await timed('silentOutputWait', () => call('read_process_output', {
    pid: pidOf(silent), timeout_ms: 800,
  }));
  assert(/completed|exit code/i.test(textOf(completed)));
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  await client.close();
  await rm(scratch, {recursive: true, force: true});
}
const result = {
  timestamp: new Date().toISOString(), entry, serverVersion,
  upstreamCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding:'utf8'}).trim(),
  node: process.version, platform: `${process.platform}/${process.arch}`,
  toolCount: tools.tools.length,
  scope: launch.args.some(value=>value.endsWith('app-connect.mjs'))
    ? 'Local MCP SDK client through the native app connection to a real stdio engine; excludes model and Codex UI. Test files are isolated; the app uses its active configuration.'
    : 'Local MCP SDK client to a real stdio server; excludes model, Codex UI, and remote connector overhead. Test config and files are isolated.',
  measurements: Object.fromEntries(Object.entries(measurements).map(([name, samples]) => [name, summary(samples)])),
  rawMs: measurements,
};
await mkdir(path.dirname(path.resolve(root, report)), {recursive:true});
await writeFile(path.resolve(root, report), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({...result, rawMs: undefined}, null, 2));
