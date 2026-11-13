import { useState } from 'react';
import { AlertTriangle, ChevronLeft, FlaskConical } from 'lucide-react';
import type { Catalog, Well } from '../catalog.generated';
import type { Analysis } from '../domain';
import { format } from '../domain';

export function Plate({ catalog, run, selected, analysis, onSelect, onCollapse }: {
  catalog: Catalog; run: string; selected: Well; analysis: Analysis | null;
  onSelect: (well: string) => void; onCollapse: () => void;
}) {
  const [compound, setCompound] = useState('All compounds');
  const [dose, setDose] = useState('all');
  const [replicate, setReplicate] = useState('all');
  const [metric, setMetric] = useState('reporter');
  const wells = catalog.wells.filter(w => w.runId === run);
  const match = (w: Well) => (compound === 'All compounds' || w.compound === compound)
    && (dose === 'all' || w.doseUm === Number(dose))
    && (replicate === 'all' || w.replicate === Number(replicate));
  const values = wells.map(w => metric === 'count' ? w.measurements?.objectCount ?? 0 : analysis?.normalized[w.id] ?? 100);
  return <aside className="study-panel" aria-label="Experiment navigation">
    <div className="panel-title"><span>EXPERIMENT / 001</span>
      <button className="icon-button" aria-label="Collapse experiment navigation" onClick={onCollapse}><ChevronLeft size={17} /></button>
    </div>
    <div className="study-heading"><FlaskConical size={22} /><h2>Spheroid screen</h2></div>
    <div className="study-meta"><span>96-well plate</span><span>48 h endpoint</span></div>
    <p className="subtle">Three fictional compounds. Eight concentrations. Three technical replicate wells per dose.</p>
    <label className="field-label">Plate color
      <select aria-label="Plate metric" value={metric} onChange={e => setMetric(e.target.value)}>
        <option value="reporter">Reporter / vehicle (%)</option><option value="count">Nuclear objects / field</option>
      </select>
    </label>
    <div className="plate-grid" role="group" aria-label="96-well plate">
      <span />{Array.from({ length: 12 }, (_, c) => <span className="plate-label" key={c}>{c + 1}</span>)}
      {'ABCDEFGH'.split('').map((row, r) => <div className="plate-row" key={row}>
        <span className="plate-label">{row}</span>
        {wells.slice(r * 12, r * 12 + 12).map((w, i) => {
          const flags = analysis?.flags[w.id] ?? [];
          const value = values[r * 12 + i];
          const opacity = Math.max(0.18, Math.min(1, value / (metric === 'count' ? 70 : 110)));
          return <button key={w.id} className={`well ${w.id === selected.id ? 'selected' : ''} ${flags.length ? 'flagged' : ''} ${match(w) ? '' : 'filtered'}`}
            style={{ '--well-color': `rgba(87, 190, 185, ${opacity})` } as React.CSSProperties}
            aria-label={`Well ${w.well}, ${w.compound}, ${w.doseUm} micromolar${flags.length ? `, QC: ${flags.join(', ')}` : ''}`}
            aria-pressed={w.id === selected.id} onClick={() => onSelect(w.well)}
            title={`${w.well}: ${format(value)}${metric === 'reporter' ? '%' : ' objects'}${flags.length ? ` | ${flags.join(', ')}` : ''}`}>
            {flags.length > 0 && <span aria-hidden="true">!</span>}
          </button>;
        })}
      </div>)}
    </div>
    <div className="plate-legend"><span><i className="legend-low" />Low</span><span><i />High</span><span><AlertTriangle size={11} />QC flag</span></div>
    <div className="counts" aria-live="polite">
      <span><b data-testid="included-count">{analysis?.included ?? '—'}</b>Included</span>
      <span><b data-testid="excluded-count">{analysis?.excluded.length ?? '—'}</b>Excluded</span>
      <span><b>{analysis?.unmeasured ?? '—'}</b>Unmeasured</span>
    </div>
    <details className="filters"><summary>Filter plate <span>{wells.filter(match).length} shown</span></summary>
      <label className="field-label">Compound<select value={compound} onChange={e => setCompound(e.target.value)}>
        {['All compounds', 'Aster-17', 'Beryl-04', 'Cygnus-09', 'Vehicle'].map(c => <option key={c}>{c}</option>)}
      </select></label>
      <div className="field-pair"><label className="field-label">Dose (µM)<select value={dose} onChange={e => setDose(e.target.value)}>
        <option value="all">All doses</option>{[0, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30].map(d => <option key={d}>{d}</option>)}
      </select></label><label className="field-label">Replicate<select value={replicate} onChange={e => setReplicate(e.target.value)}>
        <option value="all">All</option>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}
      </select></label></div>
      <p className="microcopy">Filters dim the plate; they do not silently change the analysis cohort.</p>
    </details>
    <div className="story-picks"><span className="eyebrow">WELL SHORTCUTS</span>
      <button onClick={() => onSelect('B11')}><span className="pick-code">B11</span><span>Aster-17<small>10 µM treatment</small></span><b>↗</b></button>
      <button onClick={() => onSelect('F11')}><span className="pick-code warn">F11</span><span>Cygnus-09<small>10 µM treatment</small></span><b>↗</b></button>
      <button onClick={() => onSelect('G01')}><span className="pick-code">G01</span><span>Vehicle control<small>Matched control acquisition</small></span><b>↗</b></button>
    </div>
    <div className="local-note"><span className="status-dot" />Synthetic source images preserved<br /><small>Seed {catalog.experiment.seed} · two simulated runs</small></div>
  </aside>;
}
