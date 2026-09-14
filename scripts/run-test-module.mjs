import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Some upstream scripts compare an encoded import.meta.url to an unencoded path.
// Import their exported runner explicitly so checkout paths with spaces work.
const file = path.resolve(process.argv[2]);
const module = await import(pathToFileURL(file).href);
if (typeof module.default === 'function') {
  const success = await module.default();
  console.log(`EXPORTED TEST RUNNER EXECUTED: ${path.basename(file)}`);
  process.exit(success === false ? 1 : 0);
}
