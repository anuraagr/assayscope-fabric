import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action, ...args] = process.argv.slice(2);
if (!['doctor', 'plan', 'apply', 'smoke', 'cleanup',
  'research-plan', 'research-apply', 'research-run', 'research-status',
  'knowledge-plan', 'knowledge-apply', 'knowledge-publish', 'knowledge-smoke', 'knowledge-evaluate'].includes(action)) {
  process.stderr.write('Expected a base, research or knowledge deployment action.\n');
  process.exit(2);
}
const knowledge = action.startsWith('knowledge-');
const mapped = ['-NoLogo', '-NoProfile', '-File', path.join(root, 'scripts', knowledge ? 'knowledge.ps1' : 'fabric.ps1'),
  '-Action', knowledge ? action.replace('knowledge-', '') : action];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' && args[i + 1]) mapped.push('-ConfigPath', args[++i]);
  else if (args[i] === '--offline') mapped.push('-Offline');
  else if (args[i] === '--confirm-costs') mapped.push('-ConfirmCosts');
  else if (args[i] === '--confirm-delete' && args[i + 1]) mapped.push('-ConfirmDelete', args[++i]);
  else if (args[i] === '--write-review') mapped.push('-WriteReview');
  else { process.stderr.write(`Unknown or incomplete option: ${args[i]}\n`); process.exit(2); }
}
const result = spawnSync('pwsh', mapped, { cwd: root, stdio: 'inherit', shell: false });
if (result.error) {
  process.stderr.write('PowerShell 7.4+ is required for guarded Fabric deployment on every OS.\n');
  process.exit(1);
}
process.exit(result.status ?? 1);
