import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(),'faf-lazy-tests-')));
process.env.DC_CONFIG_DIR = scratch;
process.env.DC_LOCAL_PLUGIN = 'true';
process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = 'true';
const { getFileHandler, isExcelFile } = await import('../dist/utils/files/factory.js');
const { capture } = await import('../dist/utils/capture.js');
const { configManager } = await import('../dist/config-manager.js');
const { toolHistory } = await import('../dist/utils/toolHistory.js');
const require = createRequire(import.meta.url);
await configManager.loadConfig();
after(async () => {
  await toolHistory.cleanup();
  await rm(scratch,{recursive:true,force:true});
});

test('ordinary server and text reads do not load document engines', async () => {
  const file = path.join(scratch,'sample.txt');
  await writeFile(file,'plain text\n');
  const handler = await getFileHandler(file);
  assert.equal(handler.constructor.name,'TextFileHandler');
  assert.match((await handler.read(file)).content,/plain text/);
  assert(isExcelFile('REPORT.XLSX'));
  assert(!isExcelFile('REPORT.XLSX.txt'));
  for (const module of ['exceljs','md-to-pdf','pdf-lib']) {
    assert.equal(require.cache[require.resolve(module)],undefined,`${module} loaded eagerly`);
  }
});

test('environment opt-out skips property collection, config access and identity creation', async () => {
  let accesses=0;
  const originalGetValue=configManager.getValue;
  const originalIdentity=configManager.getOrCreateClientId;
  configManager.getValue=async()=>{accesses++; throw new Error('unexpected config read');};
  configManager.getOrCreateClientId=async()=>{accesses++; throw new Error('unexpected identity');};
  try {
    for (const value of ['true','1',' YES ','on']) {
      process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY=value;
      await capture('test-opt-out',{toJSON(){accesses++; return {};}});
    }
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(accesses,0);
  } finally {
    configManager.getValue=originalGetValue;
    configManager.getOrCreateClientId=originalIdentity;
    process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY='true';
  }
});

test('persisted opt-out also skips payload and identity creation', async () => {
  const originalGetValue=configManager.getValue;
  const originalIdentity=configManager.getOrCreateClientId;
  let collections=0;
  try {
    delete process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY;
    configManager.getOrCreateClientId=async()=>{collections++; return 'unexpected';};
    for (const disabled of [false,'false','FALSE']) {
      configManager.getValue=async key=>{
        assert.equal(key,'telemetryEnabled');
        return disabled;
      };
      await capture('test-opt-out',{toJSON(){collections++; return {};}});
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.equal(collections,0);
  } finally {
    configManager.getValue=originalGetValue;
    configManager.getOrCreateClientId=originalIdentity;
    process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY='true';
  }
});

test('history respects the same isolated config directory', () => {
  assert.equal(toolHistory.getStats().historyFile,path.join(scratch,'tool-history.jsonl'));
});

test('concurrent first Excel requests share a handler and read actual cells', async () => {
  const file=path.join(scratch,'lazy.XLSX');
  const [first,second]=await Promise.all([getFileHandler(file),getFileHandler(file)]);
  assert.equal(first,second);
  await first.write(file,[['name','value'],['lazy-verified',42]]);
  const result=await second.read(file);
  assert.match(result.content,/lazy-verified/);
  assert.match(result.content,/42/);
});

test('DOCX still loads on demand and round-trips document text', async () => {
  const file=path.join(scratch,'lazy.docx');
  const handler=await getFileHandler(file);
  assert.equal(handler.constructor.name,'DocxFileHandler');
  await handler.write(file,'# Lazy document\nverified document content');
  const result=await handler.read(file);
  assert.match(result.content,/verified document content/);
});

test('PDF still loads on demand and extracts a real sample', async () => {
  const file=fileURLToPath(new URL('./samples/01_sample_simple.pdf',import.meta.url));
  const handler=await getFileHandler(file);
  assert.equal(handler.constructor.name,'PdfFileHandler');
  const result=await handler.read(file,{offset:0,length:1});
  assert(!result.metadata?.error,JSON.stringify(result.metadata));
  assert.equal(result.metadata.isPdf,true);
  assert(result.metadata.pages.length>0);
  assert(result.metadata.pages.some(page=>page.text.trim().length>0));
});
