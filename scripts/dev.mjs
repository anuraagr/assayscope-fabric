import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
if (!existsSync(python)) {
  process.stderr.write('Create .venv and install requirements.txt first. See README native quickstart.\n');
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
function start(program, args) {
  const child = spawn(program, args, { cwd: root, stdio: 'inherit', shell: false });
  children.push(child);
  child.on('error', error => { process.stderr.write(`${error.message}\n`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
  return child;
}
start(python, ['-m', 'uvicorn', 'assayscope.server:app', '--host', '127.0.0.1', '--port', '8000', '--no-access-log']);
start(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1']);
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
