import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from '../rayfin/functions/node_modules/mssql/index.js';
import { normalizeSqlRows } from './knowledge-values.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = JSON.parse(readFileSync(path.join(root, 'data', 'knowledge', 'expected.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'data', 'knowledge', 'tables.json'), 'utf8'));
const suffixes = ['experiments', 'runs', 'wells', 'images', 'qc', 'context', 'conditions'];
const names = suffixes.map(suffix => `assayscope_knowledge_${suffix}`);
if (Object.keys(expected).sort().join() !== [...names].sort().join()) throw new Error('Unexpected knowledge table inventory.');
const pool = new sql.ConnectionPool({
  server: process.env.ASSAYSCOPE_SQL_SERVER,
  database: process.env.ASSAYSCOPE_SQL_DATABASE,
  options: { encrypt: true, trustServerCertificate: false },
  authentication: { type: 'azure-active-directory-access-token', options: { token: process.env.ASSAYSCOPE_SQL_TOKEN } },
  connectionTimeout: 20000, requestTimeout: 30000, pool: { max: 1, min: 0 },
});
const canonical = rows => rows.map(row => JSON.stringify(Object.fromEntries(
  Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
))).sort();
try {
  await pool.connect();
  const counts = {};
  const snapshots = {};
  for (const name of names) {
    const result = await pool.request().query(`SELECT TOP (10001) * FROM dbo.${name}`);
    const declared = manifest.find(item => item.table === name);
    if (!declared || result.recordset.length !== declared.rows
      || result.recordset.some(row => row.experiment_id !== 'spheroid-screen-001')) {
      throw new Error(`Unexpected row count or experiment in ${name}.`);
    }
    const want = canonical(expected[name]);
    const got = canonical(normalizeSqlRows(result.recordset, declared.columns));
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      const differences = [];
      for (let index = 0; index < want.length; index++) {
        const desired = JSON.parse(want[index]);
        const actual = JSON.parse(got[index]);
        for (const key of Object.keys(desired)) {
          if (desired[key] !== actual[key]) differences.push({ column: key, expected: desired[key], actual: actual[key] });
        }
      }
      writeFileSync(path.join(root, 'test-results', 'knowledge-sql-mismatch.json'),
        `${JSON.stringify({ table: name, differences: differences.slice(0, 20) }, null, 2)}\n`);
      throw new Error(`Actual SQL values differ from the shared image-derived reduction: ${name}; details recorded in knowledge-sql-mismatch.json.`);
    }
    counts[name] = result.recordset.length;
    snapshots[name] = createHash('sha256').update(JSON.stringify(got)).digest('hex');
  }
  const examples = JSON.parse(readFileSync(path.join(root, 'knowledge', 'query-examples.json'), 'utf8'));
  const queries = [];
  for (const example of examples) {
    if (!/^SELECT TOP \(\d+\) /i.test(example.query) || /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|EXEC|MERGE)\b/i.test(example.query)) {
      throw new Error('Knowledge examples must be fixed, bounded read-only queries.');
    }
    const result = await pool.request().query(example.query);
    if (!result.recordset.length || result.recordset.length > 50) throw new Error('Example returned unexpected rows.');
    queries.push({ id: example.id, rows: result.recordset });
  }
  const report = { checkedAt: new Date().toISOString(), status: 'Pass', tableCounts: counts,
    actualSqlMatchesLocalRows: true, tableSnapshots: snapshots, queries,
    scope: 'Actual SQL readback; not evidence of an LLM answer or a live LIMS connection.' };
  writeFileSync(path.join(root, 'test-results', 'knowledge-sql-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Knowledge SQL verified: ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, seven tables, ${queries.length} query examples.\n`);
} catch (error) {
  process.stderr.write(`Knowledge SQL verification failed: ${error.message}\n`);
  process.exitCode = error.number === 208 ? 75 : 1;
} finally {
  await pool.close();
}
