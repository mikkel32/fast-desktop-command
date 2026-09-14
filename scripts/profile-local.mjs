// Diagnostic entrypoint: use benchmark-local.mjs with this file as the server.
import inspector from 'node:inspector';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const records = {};
function record(name, duration) { (records[name] ??= []).push(duration); }
function wrap(object, key, label) {
  const original = object[key];
  object[key] = function(...args) {
    const start = performance.now();
    const result = original.apply(this, args);
    if (result?.then) return result.finally(() => record(label, performance.now()-start));
    record(label, performance.now()-start);
    return result;
  };
}
for (const key of ['readFile','writeFile','appendFile','stat','realpath','open','rename','mkdir']) wrap(fsp,key,`fs.${key}`);
for (const key of ['readFileSync','writeFileSync','appendFileSync','statSync']) wrap(fs,key,`fs.${key}`);
syncBuiltinESMExports();
const session = new inspector.Session();
session.connect();
const post = (method, params={}) => new Promise((resolve,reject) => session.post(method,params,(error,value)=>error?reject(error):resolve(value)));
await post('Profiler.enable');
await post('Profiler.start');
const startup = performance.now();
await import('../dist/local.js');
record('localModuleLoad', performance.now()-startup);
const {configManager} = await import('../dist/config-manager.js');
const {usageTracker} = await import('../dist/utils/usageTracker.js');
for (const key of ['getConfig','getValue','setValue','updateValueNonBlocking','performConfigMutation']) wrap(configManager,key,`config.${key}`);
for (const key of ['trackSuccess','shouldShowOnboarding','shouldPromptForFeedback']) wrap(usageTracker,key,`usage.${key}`);
let persisted = false;
async function persist() {
  if (persisted) return;
  persisted = true;
  const {profile} = await post('Profiler.stop');
  const directory = fileURLToPath(new URL('../benchmarks/',import.meta.url));
  fs.writeFileSync(directory+'local.cpuprofile',JSON.stringify(profile));
  const summary = Object.fromEntries(Object.entries(records).map(([name,values])=>[name,{
    count:values.length, totalMs:values.reduce((a,b)=>a+b,0),
    meanMs:values.reduce((a,b)=>a+b,0)/values.length, maxMs:Math.max(...values),
  }]));
  fs.writeFileSync(directory+'profile-spans.json',JSON.stringify(summary,null,2)+'\n');
  process.exit(0);
}
process.on('SIGTERM', persist);
process.on('beforeExit', persist);
