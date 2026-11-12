import { strToU8, zipSync } from 'fflate';
import type { Catalog, Well } from './catalog.generated';
import type { Analysis, ExportOptions, Frame, Review } from './domain';
import { slicePixels } from './domain';

const escape = (text: string) => text.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export async function makeCloudBundle(catalog: Catalog, well: Well, analysis: Analysis,
  options: ExportOptions, frame: Frame, review: Review | null): Promise<Blob> {
  const { pixels, width, height } = slicePixels(frame, options.view.channels, 'xy', options.view.z);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b =>
    b ? resolve(b) : reject(new Error('Snapshot could not be encoded.'))));
  const metricNames = Object.keys(well.measurements ?? {});
  const columns = ['wellId', 'runId', 'well', 'compound', 'doseUm', 'replicate', 'synthetic', 'included', 'qcFlags',
    'normalizedReporterPercent', ...metricNames];
  const rows = catalog.wells.filter(w => w.runId === well.runId).map(w => [
    w.id, w.runId, w.well, w.compound, w.doseUm, w.replicate, true,
    w.measured && !analysis.excluded.includes(w.id), analysis.flags[w.id].join('; '),
    analysis.normalized[w.id], ...Object.values(w.measurements ?? {}),
  ].map(csv).join(','));
  const provenance = {
    exportVersion: '1.0', mode: 'Connected tenant data', dataOrigin: 'Simulated screening experiment',
    disclosure: catalog.experiment.disclosure, experimentId: catalog.experiment.id,
    exportedAt: new Date().toISOString(), well, analysis, review, view: options.view,
    processing: catalog.provenance, sourceFrameSha256: frame.asset.frameHashes[frame.time],
    snapshot: 'XY slice, not a 3D rendering. The 48 h screen is a separate synthetic field.',
  };
  const text = `<html lang="en"><meta charset="utf-8"><title>AssayScope evidence</title>
<style>body{font:16px system-ui;max-width:980px;margin:40px auto;padding:24px;color:#182a3a}
pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:500px;width:100%}</style>
<h1>AssayScope | ${escape(well.id)}</h1><p>${escape(catalog.experiment.disclosure)}</p>
<p>Retrieved through authorized Fabric access. Synthetic origin remains synthetic.</p>
<p>Normalized reporter: ${analysis.normalized[well.id]?.toFixed(1) ?? 'Not estimable'}%.
${analysis.included} included / ${analysis.excluded.length} excluded / ${analysis.unmeasured} unmeasured.</p>
<p>${escape(analysis.formula)}. ${escape(analysis.nDefinition)}.</p>
<img src="selected-slice.png" alt="Selected XY microscopy slice">
<h2>Review and provenance</h2><pre>${escape(JSON.stringify(provenance, null, 2))}</pre>
<p>Research only. No clinical, GxP, efficacy, safety or mechanism-of-action claims.</p></html>`;
  const zipped = zipSync({
    'report.html': strToU8(text),
    'measurements.csv': strToU8([columns.join(','), ...rows].join('\n')),
    'provenance.json': strToU8(JSON.stringify(provenance, null, 2)),
    'selected-slice.png': new Uint8Array(await image.arrayBuffer()),
    'citations.txt': strToU8(catalog.provenance.citations.join('\n')),
  });
  return new Blob([new Uint8Array(zipped).buffer], { type: 'application/zip' });
}
