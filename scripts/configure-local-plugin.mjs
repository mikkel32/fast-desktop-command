import { writeFile, lstat, symlink, realpath, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = 'fast-as-fuck-desktop-command';
const plugin = path.join(root, 'plugins', name);
const marketplaceLink = path.join(os.homedir(), 'plugins', name);
// Codex resolves personal-marketplace ./plugins/<name> relative to the user's home.
await mkdir(path.dirname(marketplaceLink), {recursive:true});
try {
  await lstat(marketplaceLink);
  if (await realpath(marketplaceLink) !== await realpath(plugin)) {
    throw new Error(`An unrelated plugin already exists at ${marketplaceLink}`);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await symlink(plugin, marketplaceLink, 'dir');
}
// Remove only the earlier link created by this setup script, if it is ours.
const oldLink = path.join(os.homedir(), '.agents', 'plugins', 'plugins', name);
try {
  if ((await lstat(oldLink)).isSymbolicLink() && await realpath(oldLink) === await realpath(plugin)) {
    await unlink(oldLink);
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(path.join(plugin, '.mcp.json'), JSON.stringify({mcpServers: {
  fast_desktop_command: {
    command: '/bin/sh',
    args: ['./scripts/connect.sh'],
    cwd: '.',
    env: {DESKTOP_COMMANDER_DISABLE_TELEMETRY: 'true'},
  },
}}, null, 2) + '\n');
console.log(`Configured ${name} against ${root}`);
