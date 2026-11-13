import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles, required } from './source-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const parent = path.join(root, 'test-results');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'source-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const relative of required) {
    const file = path.join(directory, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'fixture\n');
  }
  return directory;
}

test('a broad data ignore cannot silently omit the review schema', t => {
  const directory = fixture(t);
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  writeFileSync(path.join(directory, '.gitignore'), 'data/\n');
  assert.throws(() => collectSourceFiles(directory), /missing or ignored: rayfin\/data/);
  writeFileSync(path.join(directory, '.gitignore'), '/data/\n');
  assert.ok(collectSourceFiles(directory).includes('rayfin/data/ReviewDecision.ts'));
});

test('an extracted source package works without Git and omits local state', t => {
  const directory = fixture(t);
  writeFileSync(path.join(directory, 'contracts', 'tenant.local.json'), '{"notSource":true}');
  mkdirSync(path.join(directory, 'rayfin', '.temp'), { recursive: true });
  writeFileSync(path.join(directory, 'rayfin', '.temp', 'generated.js'), 'not source');
  const files = collectSourceFiles(directory);
  assert.ok(files.includes('rayfin/data/schema.ts'));
  assert.ok(!files.some(file => file.includes('.temp') || file.endsWith('.local.json')));
});

test('accidentally tracked or unignored tenant state fails closed', t => {
  const directory = fixture(t);
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  mkdirSync(path.join(directory, 'config'), { recursive: true });
  writeFileSync(path.join(directory, 'config', 'tenant.local.json'), '{"notSource":true}');
  assert.throws(() => collectSourceFiles(directory), /Not an approved source path/);
});
