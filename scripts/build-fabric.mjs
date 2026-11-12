import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnv } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...loadEnv('production', root, 'VITE_'), ...process.env };
for (const name of ['VITE_RAYFIN_API_URL', 'VITE_RAYFIN_PUBLISHABLE_KEY', 'VITE_FABRIC_WORKSPACE_ID', 'VITE_FABRIC_ITEM_ID']) {
  if (!environment[name]) {
    process.stderr.write(`Missing ${name}. Use the guarded fabric:apply command; no local build will be relabeled connected.\n`);
    process.exit(1);
  }
}
const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: root, stdio: 'inherit', env: { ...environment, VITE_DATA_MODE: 'fabric' },
});
process.exit(result.status ?? 1);
