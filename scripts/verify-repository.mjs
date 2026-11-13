import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles } from './source-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = collectSourceFiles(root);
const text = file => readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(text(file));
let links = 0;
const anchors = new Map();
function headings(file) {
  if (!anchors.has(file)) {
    const seen = new Map();
    const result = new Set();
    for (const line of text(file).split(/\r?\n/)) {
      const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      if (!match) continue;
      const base = match[1].toLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
      const count = seen.get(base) ?? 0;
      result.add(count ? `${base}-${count}` : base);
      seen.set(base, count + 1);
    }
    anchors.set(file, result);
  }
  return anchors.get(file);
}
for (const file of files) {
  if (!file.endsWith('.md')) continue;
  const body = text(file).replace(/```[\s\S]*?```/g, '');
  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split(/\s+"/)[0].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) continue;
    const [relative, anchor] = target.split('#');
    const resolved = path.resolve(path.dirname(path.join(root, file)), decodeURIComponent(relative || path.basename(file)));
    const portable = path.relative(root, resolved).split(path.sep).join('/');
    if (portable.startsWith('../') || !existsSync(resolved)) throw new Error(`${file}: missing/outside link ${target}`);
    if (anchor && portable.endsWith('.md') && !headings(portable).has(decodeURIComponent(anchor))) {
      throw new Error(`${file}: unknown heading ${target}`);
    }
    if (!statSync(resolved).isDirectory() && !files.includes(portable)) {
      throw new Error(`${file}: link is not portable source: ${target}`);
    }
    links++;
  }
}
const example = json('config/tenant.example.json');
for (const key of ['tenantId', 'workspaceId', 'capacityId', 'subscriptionId', 'expectedAccount', 'lakehouseId', 'appItemId']) {
  if (example[key] !== '') throw new Error(`Tenant example must not ship an actual ${key}.`);
}
for (const file of ['package.json', 'rayfin/functions/package.json']) {
  const manifest = json(file);
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if ((name.startsWith('@microsoft/rayfin-') || name === '@microsoft/fabric-user-data-functions') && version !== '1.36.2') {
      throw new Error(`Unexpected Rayfin version: ${name} ${version}`);
    }
  }
}
for (const file of files.filter(file => file.endsWith('.ipynb'))) {
  const notebook = json(file);
  if (notebook.nbformat !== 4 || notebook.metadata.dependencies) throw new Error(`Notebook is not a portable unbound v4 source: ${file}`);
  for (const cell of notebook.cells) {
    if (cell.cell_type === 'code' && (cell.execution_count !== null || cell.outputs.length)) {
      throw new Error(`Notebook source contains execution outputs: ${file}`);
    }
  }
}
for (const file of files.filter(file => file.endsWith('.ps1'))) {
  if ([...text(file)].some(char => char.charCodeAt(0) > 127)) throw new Error(`PowerShell source must be ASCII: ${file}`);
}
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-diagrams.mjs'), '--check'], { cwd: root, stdio: 'inherit' });
process.stdout.write(`Repository checks passed: ${files.length} source files, ${links} portable Markdown links; schema source, notebook hygiene and version guards present.\n`);
