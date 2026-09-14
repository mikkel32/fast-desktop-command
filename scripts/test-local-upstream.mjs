import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultTests = [
  'test/test-read-completed-process.js',
  'test/test-process-pagination.js',
  'test/test-spawn-error-no-crash.js',
  'test/test-blocked-commands.js',
  'test/test-allowed-directories.js',
  'test/test-symlink-security.js',
  'test/test-edit-block-occurrences.js',
  'test/test-excel-files.js',
  'test/test-file-handlers.js',
  'test/test-telemetry-handling.js',
  'test/integration/terminal-output-buffer-leak.js',
];
const selectedTests=process.argv.slice(2);
const tests=selectedTests.length?selectedTests:defaultTests;
const results = [];
await mkdir(path.join(root, 'benchmarks', 'test-logs'), {recursive:true});
for (const file of tests) {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'faf-dc-upstream-test-')));
  const start = Date.now();
  let output = '';
  const exitCode = await new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/run-test-module.mjs',file], {cwd:root, env: {
      ...process.env, FAF_TEST_HOME:scratch,
      DC_CONFIG_DIR:path.join(scratch, '.claude-server-commander'),
      DESKTOP_COMMANDER_DISABLE_TELEMETRY:'true',
      NODE_OPTIONS:`--import=${new URL('./benchmark-home.mjs', import.meta.url).href}`,
    }, stdio:['ignore','pipe','pipe']});
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timeout = setTimeout(() => { output += '\nTEST DEADLINE EXCEEDED\n'; child.kill('SIGTERM'); }, 45000);
    child.on('error', error => { output += error.stack; });
    child.on('close', code => {clearTimeout(timeout); resolve(code);});
  });
  const result = {file, exitCode, durationMs:Date.now()-start};
  results.push(result);
  console.log(JSON.stringify(result));
  await writeFile(path.join(root, 'benchmarks', 'test-logs', path.basename(file)+'.log'), output);
  if (exitCode !== 0) console.log(output.slice(-3500));
  await rm(scratch, {recursive:true, force:true});
}
await writeFile(path.join(root,'benchmarks',selectedTests.length?'upstream-tests-selected.json':'upstream-tests.json'), JSON.stringify(results,null,2)+'\n');
process.exitCode = results.some(result => result.exitCode !== 0) ? 1 : 0;
