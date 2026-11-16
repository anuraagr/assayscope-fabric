import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

const roots = new Set([
  '.github', 'assayscope', 'config', 'contracts', 'docs', 'examples', 'knowledge', 'notebooks',
  'rayfin', 'research', 'scripts', 'src', 'tests',
]);
const rootFiles = new Set([
  '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.nvmrc', '.python-version',
  'AGENTS.md', 'CONTRIBUTING.md', 'Dockerfile', 'LICENSE', 'README.md', 'SECURITY.md', 'SUPPORT.md',
  'THIRD_PARTY_NOTICES.md', 'compose.yaml', 'eslint.config.js', 'index.html',
  'package.json', 'package-lock.json', 'pyproject.toml', 'requirements.txt',
  'tsconfig.json', 'vite.config.ts',
]);
export const forbidden = /^data(?:\/|$)|(?:^|\/)(?:node_modules|\.venv|\.deployment|\.azure|\.handoff|test-results|dist|__pycache__|\.git|\.agents|\.vscode|\.temp|\.ipynb_checkpoints|\.pytest_cache|\.ruff_cache)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|local\.settings\.json|\.deployments\.json)$|\.local\.json$|\.(?:pyc|tsbuildinfo|parquet|sqlite3|bin|whl)$|\.ome\.tiff?$/;
export const required = [
  'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'docs/index.md', 'docs/architecture.md', 'docs/lab-research-guide.md', 'docs/verification.md',
  'requirements.txt', 'contracts/catalog.schema.json', 'rayfin/data/ReviewDecision.ts',
  'rayfin/data/schema.ts', 'rayfin/rayfin.yml', 'rayfin/tsconfig.json',
  'rayfin/functions/src/function_app.ts', 'rayfin/functions/package-lock.json',
  'notebooks/research-review.ipynb', 'research/review.py',
  'contracts/lab-context.schema.json', 'knowledge/model.json', 'knowledge/data-agent-instructions.md',
  'research/knowledge.py', 'scripts/knowledge.ps1', 'knowledge/query-examples.json',
  'docs/end-to-end.md', 'docs/knowledge-deployment.md',
  'contracts/reviews.schema.json', 'src/reviews.generated.d.ts', 'assayscope/context.py',
  'examples/lab-context.example.json', 'docs/lab-workflows.md',
];

function walk(root, relative, result) {
  const absolute = path.join(root, relative);
  if (forbidden.test(relative)) return;
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Source refuses symbolic links: ${relative}`);
  if (stat.isFile()) result.push(relative);
  else if (stat.isDirectory()) {
    for (const name of readdirSync(absolute).sort()) walk(root, `${relative}/${name}`, result);
  } else throw new Error(`Source refuses non-regular entries: ${relative}`);
}

export function collectSourceFiles(root) {
  let candidates;
  if (existsSync(path.join(root, '.git'))) {
    candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root, encoding: 'utf8',
    }).split('\0').filter(Boolean);
  } else {
    candidates = [...rootFiles].filter(file => existsSync(path.join(root, file)));
    for (const directory of roots) {
      if (existsSync(path.join(root, directory))) walk(root, directory, candidates);
    }
  }
  const files = [...new Set(candidates)].sort();
  for (const relative of files) {
    const parts = relative.split('/');
    if (forbidden.test(relative) || (!roots.has(parts[0]) && !rootFiles.has(relative))
      || parts.some(part => part === '..' || part === '' || part.includes('\\'))) {
      throw new Error(`Not an approved source path: ${relative}`);
    }
    for (let count = 1; count <= parts.length; count++) {
      if (lstatSync(path.join(root, ...parts.slice(0, count))).isSymbolicLink()) {
        throw new Error(`Source refuses linked path components: ${relative}`);
      }
    }
    if (!lstatSync(path.join(root, relative)).isFile()) throw new Error(`Not a regular source file: ${relative}`);
  }
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`Required portable source is missing or ignored: ${file}`);
  }
  return files;
}
