import { AlertTriangle, Check, ExternalLink, Fingerprint } from 'lucide-react';
import type { Catalog, Well } from '../catalog.generated';
import { format } from '../domain';
import type { Analysis } from '../domain';
import { SpatialQuality } from './SpatialQuality';

const COLORS: Record<string, string> = { 'Aster-17': '#148a8c', 'Beryl-04': '#7b7dab', 'Cygnus-09': '#b9508d' };

export function ResponsePanel({ analysis, onSelect }: { analysis: Analysis; onSelect: (well: string) => void }) {
  const [width, height] = [680, 330];
  const x = (dose: number) => 64 + (Math.log10(dose) + 2) / Math.log10(3000) * (width - 100);
  const y = (value: number) => height - 50 - Math.min(130, Math.max(0, value)) / 130 * (height - 82);
  return <section className="analysis-surface">
    <span className="eyebrow">RESPONSE &amp; EVIDENCE</span><h2>Reporter response by concentration</h2>
    <p>Each dot is one technical well. Lines connect arithmetic means, not fitted response curves.
      Error bars show sample standard deviation when n &gt; 1.</p>
    <div className="plot-legend">{Object.entries(COLORS).map(([name, color]) => <span key={name}><i style={{ background: color }} />{name}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} className="response-plot" role="img" aria-label="Concentration response with technical replicate points">
      {[0, 25, 50, 75, 100, 125].map(v => <g key={v}><line x1={60} y1={y(v)} x2={width - 22} y2={y(v)} stroke="#d8e2e8" strokeDasharray={v === 100 ? '5 4' : undefined} />
        <text x={49} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      {[0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30].map(d => <text key={d} x={x(d)} y={height - 25} textAnchor="middle">{d}</text>)}
      <text x={width / 2} y={height - 4} textAnchor="middle">Concentration (µM, logarithmic)</text>
      <text x={16} y={height / 2} transform={`rotate(-90,16,${height / 2})`} textAnchor="middle">Reporter / vehicle (%)</text>
      {Object.entries(COLORS).map(([compound, color]) => {
        const groups = analysis.groups.filter(g => g.compound === compound);
        const path = groups.map((g, i) => g.mean === null ? '' : `${i === 0 || groups[i - 1].mean === null ? 'M' : 'L'}${x(g.doseUm)},${y(g.mean)}`).join(' ');
        return <g key={compound} stroke={color} fill={color}>
          <path d={path} fill="none" strokeWidth={2} />
          {groups.map(g => <g key={g.doseUm}>
            {g.mean !== null && g.sd !== null && <line x1={x(g.doseUm)} x2={x(g.doseUm)} y1={y(g.mean - g.sd)} y2={y(g.mean + g.sd)} strokeWidth={2} />}
            {g.points.map((value, i) => <circle key={i} cx={x(g.doseUm) + (i - 1) * 4} cy={y(value)} r={4}
              tabIndex={0} role="button" aria-label={`Inspect ${g.wellIds[i]}`}
              onClick={() => onSelect(g.wellIds[i].split('-')[1])}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(g.wellIds[i].split('-')[1]); }}>
              <title>{g.wellIds[i]}: {format(value)}% · {g.n} technical wells</title>
            </circle>)}
          </g>)}
        </g>;
      })}
    </svg>
    <div className="method-callout"><b>IC50: not estimable</b><span>{analysis.fit.replace('Not estimable: ', '')}</span></div>
    <div className="response-foot"><div><h3>Normalization</h3><p>{analysis.formula}.</p><small>{analysis.controlN} included vehicle wells; median {format(analysis.controlMedian, 0)} integrated ADU.</small></div>
      <div><h3>Well inclusion</h3><p>{analysis.included} included, {analysis.excluded.length} excluded, {analysis.unmeasured} unmeasured.</p><small>{analysis.nDefinition}. No biological-replicate inference.</small></div></div>
    <details><summary>Replicate accounting by concentration</summary><table className="data-table"><thead><tr><th>Compound</th><th>µM</th><th>n</th><th>Mean (%)</th><th>SD</th></tr></thead>
      <tbody>{analysis.groups.map(g => <tr key={`${g.compound}-${g.doseUm}`}><td>{g.compound}</td><td>{g.doseUm}</td><td>{g.n}</td><td>{format(g.mean)}</td><td>{format(g.sd)}</td></tr>)}</tbody></table></details>
  </section>;
}

export function QualityPanel({ analysis, catalog, run, onSelect }: {
  analysis: Analysis; catalog: Catalog; run: string; onSelect: (well: string, run?: string) => void;
}) {
  const flagged = catalog.wells.filter(w => analysis.flags[w.id]?.length && w.runId === run);
  return <section className="analysis-surface">
    <span className="eyebrow">LAB QUALITY / TWO SIMULATED ACQUISITIONS</span><h2>Acquisition quality by run</h2>
    <p>These checks are computed from pixels, not generator labels. A QC association is a reason to investigate,
      not proof of an instrument fault or a biological effect.</p>
    <div className="run-comparison">{analysis.crossRun.map(r => <button key={r.runId} onClick={() => onSelect('F11', r.runId)}>
      <span>{r.instrument}</span><strong>{r.flagged}<small> / {r.total}</small></strong><b>flagged fields</b><small>Median focus {format(r.medianFocus, 4)}</small>
    </button>)}</div>
    <h3><AlertTriangle size={18} /> Image-derived flags</h3>
    <table className="data-table"><thead><tr><th>Source well</th><th>Observed issue</th><th>Focus</th><th>Saturated</th><th>Illum. CV</th></tr></thead>
      <tbody>{flagged.map(w => <tr key={w.id}><td><button className="text-button" onClick={() => onSelect(w.well)}>{w.well} · {w.compound} ↗</button></td>
        <td>{analysis.flags[w.id].join(', ')}</td><td>{format(w.measurements?.focusScore, 4)}</td>
        <td>{format(100 * (w.measurements?.saturationFraction ?? 0), 2)}%</td><td>{format(w.measurements?.illuminationCv, 3)}</td></tr>)}</tbody>
    </table>
    {flagged.length === 0 && <div className="empty-state"><Check />No thresholds exceeded in this run. This does not establish biological validity.</div>}
    <div className="method-callout"><b>Current thresholds</b><span>Focus ≥ {analysis.thresholds.focusMin}; saturated pixels ≤ {analysis.thresholds.saturationMax * 100}%;
      peripheral illumination CV ≤ {analysis.thresholds.illuminationMax}; nuclear objects ≥ {analysis.thresholds.objectCountMin}.</span></div>
    <p className="microcopy">Focus = variance of the Laplacian / intensity variance (nuclear channel).
      Saturation = fraction of channel-pixels ≥ 254 ADU. Illumination = coefficient of variation across
      four corner-background patches (structure channel). Thresholds are demo-calibrated, not universal.</p>
    <SpatialQuality catalog={catalog} analysis={analysis} run={run} onInspect={id => {
      const well = catalog.wells.find(well => well.id === id);
      if (well) onSelect(well.well, well.runId);
    }} />
  </section>;
}

export function ProvenancePanel({ catalog, well }: { catalog: Catalog; well: Well }) {
  return <section className="analysis-surface">
    <span className="eyebrow">PROVENANCE</span><h2>Source images and analysis methods</h2>
    <div className="trace-chain">{['Experiment', 'Acquisition', 'Source image', 'CPU analysis', 'Research review'].map((s, i) =>
      <span key={s}><b>{s}</b><small>{[catalog.experiment.id, well.runId, well.image.id, catalog.provenance.analysis, 'Human-authored rationale'][i]}</small></span>)}</div>
    <h3><Fingerprint size={19} />Selected source</h3>
    <dl className="provenance-grid">
      <dt>Well</dt><dd>{well.id} · technical replicate {well.replicate}</dd>
      <dt>OME-TIFF</dt><dd>{well.image.path}</dd>
      <dt>SHA-256</dt><dd className="hash">{well.image.sha256}</dd>
      <dt>Source axes</dt><dd>TCZYX · {well.image.shape.join(' × ')}</dd>
      <dt>Spacing (Z, Y, X)</dt><dd>{well.image.spacingUm.join(' × ')} µm</dd>
      <dt>Analysis code</dt><dd className="hash">{catalog.provenance.codeVersion}</dd>
      <dt>Processed</dt><dd>{catalog.provenance.processedAt}</dd>
      <dt>Generator</dt><dd>{catalog.provenance.generator} · seed {catalog.experiment.seed}</dd>
    </dl>
    <h3>Method parameters</h3><dl className="provenance-grid">{Object.entries(catalog.provenance.parameters).map(([key, value]) =>
      <div className="contents" key={key}><dt>{key}</dt><dd>{typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)}</dd></div>)}</dl>
    <div className="method-callout"><b>Data preservation</b><span>Display controls do not alter analysis. Labels are derived, not ground truth.
      Generator truth is stored separately and never served to the workbench.</span></div>
    <h3>References</h3>{catalog.provenance.citations.map(c => c.startsWith('https://')
      ? <p key={c}><a href={c} target="_blank" rel="noreferrer">{c} <ExternalLink size={12} /></a></p> : <p key={c}>{c}</p>)}
  </section>;
}
