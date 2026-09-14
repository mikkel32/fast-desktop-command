#!/usr/bin/env node
import './bootstrap.js';
import os from 'node:os';
import path from 'node:path';

// Set these before loading modules that resolve configuration or emit telemetry.
process.env.DC_CONFIG_DIR ??= path.join(os.homedir(), '.fast-as-fuck-desktop-command');
process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = 'true';
process.env.DC_LOCAL_PLUGIN = 'true';
(global as any).disableOnboarding = true;

const { FilteredStdioServerTransport } = await import('./custom-stdio.js');
const { configManager } = await import('./config-manager.js');
const { featureFlagManager } = await import('./utils/feature-flags.js');
const { server, flushDeferredMessages } = await import('./server.js');
const transport = new FilteredStdioServerTransport(true);
global.mcpTransport = transport;
await configManager.loadConfig();
await featureFlagManager.initialize();
server.oninitialized = () => {
  transport.enableNotifications();
  flushDeferredMessages();
};
// The local plugin does not need hosted feature flags or a Chrome pre-download.
// PDF rendering still resolves Chrome on demand through the original handler.
await server.connect(transport);
