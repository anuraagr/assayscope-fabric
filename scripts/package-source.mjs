import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { collectSourceFiles } from './source-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results');
const stage = path.join(output, 'source-package');
const paths = collectSourceFiles(root);
const files = [];
const zip = {};
let bytes = 0;
for (const relative of paths) {
  const source = path.join(root, relative);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Source package refuses non-regular files: ${relative}`);
  bytes += stat.size;
  if (stat.size > 8 * 1024 ** 2 || bytes > 48 * 1024 ** 2) throw new Error('Source package exceeds its bounded size; review for bulk data.');
  const contents = readFileSync(source);
  files.push({ path: relative, bytes: stat.size, sha256: createHash('sha256').update(contents).digest('hex') });
  zip[`assayscope-fabric/${relative}`] = [contents, { mtime: new Date('2026-01-01T00:00:00Z') }];
}
if (existsSync(stage)) throw new Error('test-results/source-package already exists. Review and remove that exact generated staging directory before rerunning.');
mkdirSync(stage, { recursive: true });
for (const file of files) {
  const destination = path.join(stage, file.path);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, zip[`assayscope-fabric/${file.path}`][0], { flag: 'wx' });
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
