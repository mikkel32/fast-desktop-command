import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const entry=process.argv[2];
if (!entry) throw new Error('Pass the installed .mcp.json path');
const directory=path.join(root,'benchmarks','v2');
await mkdir(directory,{recursive:true});
const runs=[];
for(let i=1;i<=5;i++) {
  const report=`benchmarks/v2/installed-${i}.json`;
  execFileSync(process.execPath,['scripts/benchmark-local.mjs',entry,report],{cwd:root,stdio:'pipe'});
  runs.push(JSON.parse(await readFile(path.join(root,report),'utf8')));
  console.log(`Verified installed plugin benchmark ${i}/5`);
}
const samples={};
for(const run of runs) for(const [name,values] of Object.entries(run.rawMs)) (samples[name]??=[]).push(...values);
const measurements=Object.fromEntries(Object.entries(samples).map(([name,values])=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return [name,{n:sorted.length,medianMs:sorted[Math.floor(sorted.length/2)],
    p95Ms:sorted[Math.ceil(sorted.length*.95)-1],minMs:sorted[0],maxMs:sorted.at(-1)}];
}));
const result={timestamp:new Date().toISOString(),entry,server:runs[0].serverVersion,
  independentServerStarts:runs.length,toolCount:runs[0].toolCount,scope:runs[0].scope,measurements};
await writeFile(path.join(directory,'summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
