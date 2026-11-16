import { useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Search } from 'lucide-react';
import type { Catalog, Well } from '../catalog.generated';
import type { Analysis, AnalysisOptions } from '../domain';
import { format } from '../domain';
import { download } from '../data';
import { filterMeasurements, inclusion, METRICS, metricValue } from '../lab';
import type { Inclusion, MetricId } from '../lab';
import { createLabPacket } from '../lab-export';

function extent(values: number[]) {
  if (!values.length) return [0, 1];
  const low = Math.min(...values), high = Math.max(...values);
  const pad = (high - low || Math.abs(high) || 1) * .08;
  return [Math.max(0, low - pad), high + pad];
}

export function MeasurementExplorer({ catalog, analysis, options, connected, selected, onInspect }: {
  catalog: Catalog; analysis: Analysis; options: AnalysisOptions; connected: boolean; selected: Well;
  onInspect: (id: string) => void;
}) {
  const [xMetric, setXMetric] = useState<MetricId>('focusScore');
  const [yMetric, setYMetric] = useState<MetricId>('normalized');
  const [compound, setCompound] = useState('all');
  const [status, setStatus] = useState<'all' | Inclusion>('all');
  const [search, setSearch] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const wells = catalog.wells.filter(well => well.runId === options.runId);
  const low = minimum === '' ? null : Number(minimum), high = maximum === '' ? null : Number(maximum);
  const invalidRange = (low !== null && !Number.isFinite(low)) || (high !== null && !Number.isFinite(high)) ||
    (low !== null && high !== null && low > high);
  const matched = invalidRange ? [] : filterMeasurements(wells, analysis, yMetric,
    { compound, inclusion: status, search, minimum: low, maximum: high }).sort((a, b) => {
    const av = metricValue(a, analysis, yMetric), bv = metricValue(b, analysis, yMetric);
    if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
    if (bv === null) return -1;
    return (ascending ? av - bv : bv - av) || a.id.localeCompare(b.id);
  });
  const points = matched.flatMap(well => {
    const x = metricValue(well, analysis, xMetric), y = metricValue(well, analysis, yMetric);
    return x === null || y === null ? [] : [{ well, x, y }];
  });
  const x = METRICS.find(metric => metric.id === xMetric)!, y = METRICS.find(metric => metric.id === yMetric)!;
  const [minX, maxX] = extent(points.map(point => point.x));
  const [minY, maxY] = extent(points.map(point => point.y));
  const px = (value: number) => 78 + (value - minX) / (maxX - minX) * 570;
  const py = (value: number) => 310 - (value - minY) / (maxY - minY) * 265;
  const pageCount = Math.max(1, Math.ceil(matched.length / 24)), currentPage = Math.min(page, pageCount - 1);
  const exported = matched.map(well => ({
    experimentId: catalog.experiment.id, runId: well.runId, wellId: well.id, compound: well.compound,
    doseUm: well.doseUm, technicalReplicate: well.replicate, control: well.control,
    inclusion: inclusion(well, analysis), flags: analysis.flags[well.id].join('; '),
    xMetric: x.id, xUnit: x.unit, xValue: metricValue(well, analysis, xMetric),
    yMetric: y.id, yUnit: y.unit, yValue: metricValue(well, analysis, yMetric),
    sourceImageId: well.image.id, sourceSha256: well.image.sha256,
  }));
  const exportRows = () => {
    try {
      download(createLabPacket(catalog, connected, 'Measurement exploration', exported, options,
        { filters: { compound, status, search, minimum: low, maximum: high }, xMetric, yMetric,
          plotted: points.length, missingAxisValue: matched.length - points.length }),
      `assayscope-${options.runId}-measurements.zip`);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Measurement export failed.'); }
  };
  return <section className="analysis-surface lab-surface" aria-label="Measurement explorer">
    <div className="lab-heading"><div><span className="eyebrow">MULTIPARAMETER / IMAGE-DERIVED</span><h2>Measurement explorer</h2></div>
      <button className="secondary compact" disabled={!matched.length || invalidRange} onClick={exportRows}><ArrowDownToLine size={15} />Export filtered measurements</button></div>
    <p>Inspect associations between reporter signal, morphology and acquisition quality. Each point is one screen field / technical well.
      An association is not a biological mechanism or proof of an instrument fault.</p>
    <div className="lab-filters">
      <label>X measurement<select aria-label="X measurement" value={xMetric} onChange={event => {
        const found = METRICS.find(metric => metric.id === event.target.value);
        if (found) setXMetric(found.id);
      }}>{METRICS.map(metric => <option key={metric.id} value={metric.id}>{metric.label} ({metric.unit})</option>)}</select></label>
      <label>Y measurement<select aria-label="Y measurement" value={yMetric} onChange={event => {
        const found = METRICS.find(metric => metric.id === event.target.value);
        if (found) { setYMetric(found.id); setMinimum(''); setMaximum(''); setPage(0); }
      }}>{METRICS.map(metric => <option key={metric.id} value={metric.id}>{metric.label} ({metric.unit})</option>)}</select></label>
    </div>
    <div className="lab-filters">
      <label>Condition<select aria-label="Explorer condition" value={compound} onChange={e => { setCompound(e.target.value); setPage(0); }}>
        <option value="all">All conditions</option><option value="controls">Vehicle controls only</option>
        {[...new Set(wells.filter(well => !well.control).map(well => well.compound))].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Inclusion<select aria-label="Explorer inclusion" value={status} onChange={e => {
        const value = e.target.value;
        if (value === 'all' || value === 'included' || value === 'excluded' || value === 'unmeasured') { setStatus(value); setPage(0); }
      }}>{['all', 'included', 'excluded', 'unmeasured'].map(value => <option key={value} value={value}>{value === 'all' ? 'All wells' : value}</option>)}</select></label>
      <label><span><Search size={12} />Well / source search</span><input aria-label="Search measurements" maxLength={100}
        value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="F11, source ID or compound" /></label>
    </div>
    <details className="explorer-range"><summary>Numeric Y range {minimum !== '' || maximum !== '' ? '(active)' : '(optional)'}</summary>
    <div className="lab-filters range-filters"><label>Minimum Y<input aria-label="Minimum Y measurement" type="number" value={minimum}
      placeholder="No lower bound" onChange={e => { setMinimum(e.target.value); setPage(0); }} /></label>
      <label>Maximum Y<input aria-label="Maximum Y measurement" type="number" value={maximum}
        placeholder="No upper bound" onChange={e => { setMaximum(e.target.value); setPage(0); }} /></label>
      <button className="text-button" onClick={() => { setSearch(''); setCompound('all'); setStatus('all'); setMinimum(''); setMaximum(''); setPage(0); }}>Clear filters</button></div></details>
    {invalidRange && <p className="error-text" role="alert">Use finite bounds with minimum no greater than maximum.</p>}
    <div className="explorer-summary" role="status"><b data-testid="explorer-matched">{matched.length}</b> matched wells · {points.length} plotted ·
      {matched.length - points.length} missing / not estimable on an axis. <span>Source: {options.runId}</span></div>
    <div className="scatter-legend"><span><i />Included technical well</span><span className="excluded"><i />Excluded (original retained)</span><span>◇ Vehicle control</span></div>
    <svg viewBox="0 0 700 365" className="measurement-plot" role="group" aria-label={`${x.label} versus ${y.label}`}>
      {[0, 1, 2, 3, 4].map(tick => {
        const xv = minX + (maxX - minX) * tick / 4, yv = minY + (maxY - minY) * tick / 4;
        return <g key={tick}><line x1={78} x2={648} y1={py(yv)} y2={py(yv)} />
          <text x={68} y={py(yv) + 4} textAnchor="end">{format(yv, y.digits)}</text>
          <text x={px(xv)} y={330} textAnchor="middle">{format(xv, x.digits)}</text></g>;
      })}
      <text x={363} y={353} textAnchor="middle">{x.label} ({x.unit})</text>
      <text x={16} y={180} transform="rotate(-90,16,180)" textAnchor="middle">{y.label} ({y.unit})</text>
      {points.map(point => <g key={point.well.id} role="button" tabIndex={0}
        aria-label={`Inspect measurement ${point.well.id}`} className={`${inclusion(point.well, analysis)} ${point.well.id === selected.id ? 'selected' : ''}`}
        onClick={() => onInspect(point.well.id)} onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInspect(point.well.id); }
        }}>
        {point.well.control ? <path d={`M${px(point.x)},${py(point.y) - 5}l5,5 -5,5 -5,-5Z`} /> :
          <circle cx={px(point.x)} cy={py(point.y)} r={4.5} />}
        <title>{point.well.id}: {x.label} {format(point.x, x.digits)} {x.unit}; {y.label} {format(point.y, y.digits)} {y.unit}; {inclusion(point.well, analysis)}</title>
      </g>)}
      {!points.length && <text x={350} y={160} textAnchor="middle">No estimable coordinate pairs under these filters</text>}
    </svg>
    <div className="lab-table-scroll"><table className="data-table lab-table" aria-label="Filtered measurements">
      <thead><tr><th>Source well</th><th>Condition</th><th>{x.label}</th><th><button className="text-button"
        aria-label={`Sort ${y.label} ${ascending ? 'descending' : 'ascending'}`} onClick={() => setAscending(value => !value)}>{y.label} {ascending ? '↑' : '↓'}</button></th><th>Inclusion / observations</th></tr></thead>
      <tbody>{matched.slice(currentPage * 24, currentPage * 24 + 24).map(well => <tr key={well.id}>
        <td><button className="text-button" onClick={() => onInspect(well.id)}>{well.well} <ArrowUpRight size={12} /></button><small>{well.image.id}</small></td>
        <td>{well.compound}<small>{well.control ? 'Vehicle' : `${well.doseUm} µM · technical well ${well.replicate}`}</small></td>
        <td className="numeric">{format(metricValue(well, analysis, xMetric), x.digits)}</td>
        <td className="numeric">{format(metricValue(well, analysis, yMetric), y.digits)}</td>
        <td><span className={`lab-pill ${inclusion(well, analysis) !== 'included' ? 'warn' : ''}`}>{inclusion(well, analysis)}</span>
          <small>{analysis.flags[well.id].join(', ') || 'No configured flags'}</small></td>
      </tr>)}</tbody></table></div>
    <div className="table-pagination"><button className="secondary compact" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous fields</button>
      <span>{matched.length ? currentPage * 24 + 1 : 0}–{Math.min((currentPage + 1) * 24, matched.length)} of {matched.length}</span>
      <button className="secondary compact" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next fields</button></div>
    <p className="microcopy">Filters only change this exploratory view, not QC eligibility or stored measurements.
      Exports include all matching rows, including missing axis values. The 3D mask volume is a separate 48 h companion acquisition.</p>
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
