import { useState } from 'react';
import type { Catalog } from '../catalog.generated';
import type { Analysis } from '../domain';
import { format } from '../domain';
import { METRICS, metricValue, spatialSummary } from '../lab';
import type { MetricId } from '../lab';

export function SpatialQuality({ catalog, analysis, run, onInspect }: {
  catalog: Catalog; analysis: Analysis; run: string; onInspect: (id: string) => void;
}) {
  const [metric, setMetric] = useState<MetricId>('focusScore');
  const [controlsOnly, setControlsOnly] = useState(false);
  const wells = catalog.wells.filter(well => well.runId === run);
  const definition = METRICS.find(item => item.id === metric)!;
  const summary = spatialSummary(wells, analysis, metric, controlsOnly);
  const values = wells.filter(well => !controlsOnly || well.control).map(well =>
    metricValue(well, analysis, metric)).filter((value): value is number => value !== null);
  const low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
  return <section className="spatial-quality" aria-label="Plate spatial diagnostics">
    <h3>Plate spatial diagnostics</h3>
    <p>Inspect row and edge patterns before assigning a cause. Treatment placement, control location and acquisition order can confound spatial differences.</p>
    <div className="lab-filters"><label>Map measurement<select aria-label="Spatial measurement" value={metric} onChange={e => {
      const found = METRICS.find(item => item.id === e.target.value); if (found) setMetric(found.id);
    }}>{METRICS.map(item => <option key={item.id} value={item.id}>{item.label} ({item.unit})</option>)}</select></label>
      <label className="checkbox-label"><input aria-label="Spatial controls only" type="checkbox" checked={controlsOnly}
        onChange={e => setControlsOnly(e.target.checked)} />Vehicle controls only</label></div>
    <div className="spatial-grid" role="group" aria-label="Spatial plate values">
      <span />{Array.from({ length: 12 }, (_, i) => <span className="plate-label" key={i}>{i + 1}</span>)}
      {[...'ABCDEFGH'].map(row => <div className="contents" key={row}><span className="plate-label">{row}</span>
        {Array.from({ length: 12 }, (_, index) => {
          const coordinate = `${row}${String(index + 1).padStart(2, '0')}`;
          const well = wells.find(well => well.well === coordinate);
          const value = well ? metricValue(well, analysis, metric) : null;
          const inactive = !well || controlsOnly && !well.control;
          const fraction = value === null ? 0 : (value - low) / (high - low || 1);
          return <button key={coordinate} disabled={inactive} className={well && analysis.flags[well.id]?.length ? 'spatial-flagged' : ''}
            style={{ backgroundColor: inactive || value === null ? '#edf1f4' : `hsl(184 36% ${94 - fraction * 52}%)` }}
            aria-label={`Spatial ${run} ${coordinate}: ${inactive ? 'outside filter' : `${format(value, definition.digits)} ${definition.unit}`}`}
            onClick={() => well && onInspect(well.id)}><span>{inactive ? '—' : value === null ? '?' : analysis.flags[well!.id]?.length ? '!' : '·'}</span>
            <title>{coordinate}: {format(value, definition.digits)} {definition.unit}</title></button>;
        })}</div>)}
    </div>
    <p className="microcopy">Color range {format(low, definition.digits)}–{format(high, definition.digits)} {definition.unit} within this map.
      “!” marks any configured QC observation; “?” is missing/not estimable. Map values retain excluded fields.</p>
    <div className="lab-table-scroll"><table className="data-table lab-table" aria-label="Row and edge summaries"><thead>
      <tr><th>Position</th><th>Registered wells</th><th>Included values</th><th>Median ({definition.unit})</th><th>Flagged</th></tr></thead>
      <tbody>{[...summary.rows, { label: 'Outer edge', ...summary.edge }, { label: 'Interior', ...summary.interior }].map(row =>
        <tr key={row.label}><td>{row.label}</td><td>{row.total}</td><td>{row.n}</td><td>{format(row.median, definition.digits)}</td><td>{row.flagged}</td></tr>)}</tbody></table></div>
    <p className="microcopy">Summaries use only included, estimable values. Outer edge = rows A/H or columns 1/12.
      These groups can contain different compounds and doses; this is not an edge-effect test or batch correction.</p>
  </section>;
}
