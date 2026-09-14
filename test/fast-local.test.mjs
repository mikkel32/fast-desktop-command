import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'faf-dc-tests-')));
process.env.DC_CONFIG_DIR = scratch;
process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = 'true';
const { terminalManager, TerminalManager } = await import('../dist/terminal-manager.js');
const { readProcessOutput, interactWithProcess } = await import('../dist/tools/improved-process-tools.js');
const { configManager } = await import('../dist/config-manager.js');
const { featureFlagManager } = await import('../dist/utils/feature-flags.js');
const { shouldShowMcpUiPreviews } = await import('../dist/utils/mcp-ui-ab-test.js');
await configManager.loadConfig();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const command = code => `${quote(process.execPath)} -e ${quote(code)}`;
const text = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const closeSession = async pid => {
  const session = terminalManager.getSession(pid);
  if (!session) return;
  const done = new Promise(resolve => session.process.once('close', resolve));
  session.process.kill('SIGTERM');
  await done;
};
after(async () => {
  for (const {pid} of terminalManager.listActiveSessions()) await closeSession(pid);
  await rm(scratch, {recursive:true, force:true});
});

test('silent exit wakes a pending output read before its deadline', async () => {
  const {pid} = await terminalManager.executeCommand(command('setTimeout(() => process.exit(0), 100)'), 1, '/bin/sh');
  const start = performance.now();
  const result = await readProcessOutput({pid, timeout_ms: 1500});
  assert(performance.now() - start < 800, 'should wake on completion, not timeout');
  assert.match(text(result), /completed|exit code/i);
  assert.equal(terminalManager.outputListeners.size, 0);
});

test('interactive silent exit reports finished and cleans subscriptions', async () => {
  const {pid} = await terminalManager.executeCommand(command("process.stdout.write('> ');process.stdin.once('data', () => process.exit(0))"), 1000, '/bin/sh');
  const start = performance.now();
  const result = await interactWithProcess({pid, input:'exit', timeout_ms:1500});
  assert(performance.now() - start < 800);
  assert.match(text(result), /finished execution/);
  assert.doesNotMatch(text(result), /timeout reached/);
  assert.equal(terminalManager.outputListeners.size, 0);
});

test('stderr prompts wake interaction; timeout keeps process alive', async () => {
  const {pid} = await terminalManager.executeCommand(command("process.stdout.write('> ');process.stdin.on('data', data => {if(data.toString().trim() === 'reply') process.stderr.write('stderr-answer\\n> ');})"), 1000, '/bin/sh');
  try {
    const reply = await interactWithProcess({pid, input:'reply', timeout_ms:1500});
    assert.match(text(reply), /stderr-answer/);
    const start = performance.now();
    const timeout = await interactWithProcess({pid, input:'silent', timeout_ms:80});
    assert(performance.now()-start >= 65);
    assert.match(text(timeout), /timeout reached/);
    assert(terminalManager.getSession(pid));
    assert.equal(terminalManager.outputListeners.size, 0);
    const again = await interactWithProcess({pid, input:'reply', timeout_ms:1500});
    assert.match(text(again), /stderr-answer/);
  } finally { await closeSession(pid); }
});

test('final output is drained before completion is exposed', async () => {
  const {pid} = await terminalManager.executeCommand(command("process.stdout.write('x'.repeat(200000), () => process.stderr.write('final-marker\\n'))"), 2000, '/bin/sh');
  const result = terminalManager.readOutputPaginated(pid, 0, 1000);
  assert.equal(result.isComplete, true);
  assert.match(result.lines.join('\n'), /final-marker/);
  assert.equal(result.lines.join('\n').split('x').length-1, 200000);
});

test('partial line updates remain readable', async () => {
  const {pid} = await terminalManager.executeCommand(command("process.stdout.write('> ');process.stdin.on('data', () => process.stdout.write('tail'))"), 1000, '/bin/sh');
  try {
    terminalManager.readOutputPaginated(pid);
    const waiting = readProcessOutput({pid, timeout_ms:1500});
    terminalManager.sendInputToProcess(pid, 'go');
    assert.match(text(await waiting), /> tail/);
  } finally { await closeSession(pid); }
});

test('snapshot offsets match retained output across partial lines and eviction', () => {
  const manager = new TerminalManager();
  const session = {pid:42, outputLines:[], lastReadIndex:0, bufferedChars:0, evictedChars:0, evictedLines:0};
  manager.sessions.set(42, session);
  const chunks = ['alpha', '\nbeta\n', '', '\ngamma', '😀', '\n', 'tail'];
  const snapshots = [{totalChars:0, lineCount:0}];
  for (let round=0; round<30; round++) {
    manager.appendToLineBuffer(session, chunks[round % chunks.length]);
    for (const snapshot of snapshots) {
      assert.equal(manager.getOutputSinceSnapshot(42, snapshot), session.outputLines.join('\n').slice(Math.max(0, snapshot.totalChars-session.evictedChars)));
    }
    snapshots.push(manager.captureOutputSnapshot(42));
    if (session.outputLines.length > 4) {
      const removed = session.outputLines.shift();
      session.evictedChars += removed.length+1;
      session.bufferedChars -= removed.length+1;
      session.evictedLines++;
    }
  }
});

test('snapshots and tiny tail reads do not traverse 40 MB of old output', () => {
  const manager = new TerminalManager();
  const lines = Array.from({length:40000}, () => 'x'.repeat(1000));
  const session = {pid:43, outputLines:lines, lastReadIndex:0,
    bufferedChars:lines.join('\n').length, evictedChars:0, evictedLines:0};
  manager.sessions.set(43, session);
  let reads = 0;
  session.outputLines = new Proxy(lines, {get(target, key, receiver) {
    if (/^\d+$/.test(String(key))) reads++;
    if (key === 'join') throw new Error('whole-buffer join');
    return Reflect.get(target, key, receiver);
  }});
  const snapshot = manager.captureOutputSnapshot(43);
  lines[lines.length-1] += 'new-tail';
  session.bufferedChars += 8;
  assert.equal(manager.getOutputSinceSnapshot(43, snapshot), 'new-tail');
  assert(reads < 5, `read ${reads} old lines`);
});

test('first-run local feature flags resolve without a network request or 5s wait', async () => {
  process.env.DC_LOCAL_PLUGIN = 'true';
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected network request'); };
  try {
    const start = performance.now();
    await featureFlagManager.initialize();
    assert.equal(await shouldShowMcpUiPreviews(), true);
    assert(performance.now()-start < 500);
  } finally { globalThis.fetch = savedFetch; }
});
