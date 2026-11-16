import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFunctionsTypes } from '../node_modules/@microsoft/rayfin-cli/dist/utils/functions-types-generator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = JSON.parse(readFileSync(path.join(root, 'node_modules', '@microsoft', 'rayfin-cli', 'package.json'), 'utf8'));
if (cli.version !== '1.36.2') throw new Error('Function metadata generation requires the pinned Rayfin 1.36.2 CLI.');
await generateFunctionsTypes(path.join(root, 'rayfin', 'functions'));
process.stdout.write('Generated function types and runtime metadata with Rayfin 1.36.2; no cloud access.\n');
