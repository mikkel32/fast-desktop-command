// Test-only isolation for upstream builds that do not support DC_CONFIG_DIR.
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
if (!process.env.FAF_TEST_HOME) throw new Error('FAF_TEST_HOME is required');
os.homedir = () => process.env.FAF_TEST_HOME;
syncBuiltinESMExports();
