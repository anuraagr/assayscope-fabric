import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results');
const stage = path.join(output, 'source-package');
const roots = new Set([
  '.github', 'assayscope', 'config', 'contracts', 'docs', 'examples', 'rayfin', 'scripts', 'src', 'tests',
]);
const rootFiles = new Set([
  '.dockerignore', '.gitignore', 'AGENTS.md', 'Dockerfile', 'LICENSE', 'README.md',
  'THIRD_PARTY_NOTICES.md', 'compose.yaml', 'eslint.config.js', 'index.html',
  'package.json', 'package-lock.json', 'pyproject.toml', 'requirements.txt',
  'tsconfig.json', 'vite.config.ts',
]);
const forbidden = /(?:^|\/)(?:node_modules|\.venv|data|\.deployment|\.handoff|test-results|dist|__pycache__|\.git|\.agents|\.vscode)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|local\.settings\.json|\.deployments\.json)$|\.local\.json$|\.pyc$|\.tsbuildinfo$/;
const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean);
const paths = [...new Set(candidates)].sort();
const files = [];
const zip = {};
let bytes = 0;
for (const relative of paths) {
  const first = relative.split('/')[0];
  // rayfin/data is source code, unlike the root's generated data directory.
  const checked = relative.startsWith('rayfin/data/') ? relative.replace('rayfin/data/', 'rayfin/entities/') : relative;
  if (forbidden.test(checked) || (!roots.has(first) && !rootFiles.has(relative)) || relative.split('/').includes('..')) {
    throw new Error(`Not an approved source-package path: ${relative}`);
  }
  const source = path.join(root, relative);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Source package refuses non-regular files: ${relative}`);
  bytes += stat.size;
  if (stat.size > 8 * 1024 ** 2 || bytes > 48 * 1024 ** 2) throw new Error('Source package exceeds its bounded size; review for bulk data.');
  const contents = readFileSync(source);
  files.push({ path: relative, bytes: stat.size, sha256: createHash('sha256').update(contents).digest('hex') });
  zip[`assayscope-fabric/${relative}`] = [contents, { mtime: new Date('2026-01-01T00:00:00Z') }];
}
for (const required of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/verification.md', 'requirements.txt']) {
  if (!files.some(file => file.path === required)) throw new Error(`Required handoff file is missing: ${required}`);
}
if (existsSync(stage)) throw new Error('test-results/source-package already exists. Review and remove that exact generated staging directory before rerunning.');
mkdirSync(stage, { recursive: true });
for (const file of files) {
  const destination = path.join(stage, file.path);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(root, file.path), destination, { errorOnExist: true, force: false });
}
const archive = zipSync(zip, { level: 6 });
const archivePath = path.join(output, 'assayscope-source.zip');
writeFileSync(archivePath, archive);
const manifest = {
  createdAt: new Date().toISOString(), fileCount: files.length, sourceBytes: bytes,
  zipBytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'),
  verification: 'Read docs/verification.md; this package is not proof of final runtime or cloud verification.',
  secretScan: 'Run the approved scanner on test-results/source-package before distributing this archive.',
  files,
};
writeFileSync(path.join(output, 'source-package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Source-only archive: ${archivePath}\n${files.length} files, ${archive.length} bytes. Secret scanning remains a separate gate.\n`);
