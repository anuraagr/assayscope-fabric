import { strToU8, zipSync } from 'fflate';
import type { Catalog } from './catalog.generated';
import type { AnalysisOptions } from './domain';

type Cell = string | number | boolean | null;
export type ExportRow = Record<string, Cell>;
const escape = (text: string) => text.replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
));
export function csvCell(value: Cell) {
  let text = value === null ? '' : String(value);
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function createLabPacket(catalog: Catalog, connected: boolean, title: string,
  rows: ExportRow[], options: AnalysisOptions, detail: Record<string, unknown> = {}) {
  if (!rows.length || rows.length > 1000) throw new Error('Select between 1 and 1,000 records for a research packet.');
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (columns.length > 64 || rows.some(row => Object.values(row).some(value =>
    typeof value === 'number' && !Number.isFinite(value)))) throw new Error('Research packet contains invalid or unbounded records.');
  const mode = connected ? 'Connected tenant data' : 'Local simulated experiment';
  const selectedWells = new Set(rows.map(row => row.wellId).filter((value): value is string => typeof value === 'string'));
  const manifest = {
    exportVersion: '1.0', title, exportedAt: new Date().toISOString(), mode,
    dataOrigin: 'Simulated screening experiment', experiment: catalog.experiment,
    processing: catalog.provenance, options, detail, rowCount: rows.length, columns, records: rows,
    sourceImages: catalog.wells.filter(well => !selectedWells.size || selectedWells.has(well.id)).map(well => ({
      wellId: well.id, runId: well.runId, imageId: well.image.id, sha256: well.image.sha256,
      axes: well.image.axes, spacingUm: well.image.spacingUm, timesHours: well.image.timesHours,
    })),
    scope: 'Tabular research worksheet. No external task or review is created. Original images are not embedded; use Export evidence for image snapshots.',
  };
  const csv = [columns.map(csvCell).join(','), ...rows.map(row =>
    columns.map(column => csvCell(row[column] ?? null)).join(','))].join('\r\n');
  const header = columns.map(column => `<th scope="col">${escape(column)}</th>`).join('');
  const body = rows.map(row => `<tr>${columns.map(column => `<td>${escape(String(row[column] ?? 'Not recorded / not estimable'))}</td>`).join('')}</tr>`).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(title)}</title><style>body{font:14px/1.6 system-ui;color:#172e3b;margin:32px}
table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd9df;padding:8px;text-align:left;overflow-wrap:anywhere}
th{background:#e8f1f3}pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow:auto}</style>
<h1>${escape(title)}</h1><p>${escape(mode)} · Simulated screening experiment · Research only.</p>
<p>${escape(manifest.scope)}</p><p>n means technical wells within one run; no biological pooling, efficacy or forced IC50.</p>
<div class="table"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>
<h2>Scope and provenance</h2><pre>${escape(JSON.stringify({ ...manifest, records: undefined }, null, 2))}</pre></html>`;
  const files = {
    'report.html': strToU8(html), 'records.csv': strToU8(csv),
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'citations.txt': strToU8(catalog.provenance.citations.join('\n')),
  };
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > 16 * 1024 * 1024) {
    throw new Error('Research packet exceeds the 16 MiB bound. Narrow the selection.');
  }
  return new Blob([new Uint8Array(zipSync(files)).buffer], { type: 'application/zip' });
}
