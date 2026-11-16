import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, FlaskConical, Info, SlidersHorizontal } from 'lucide-react';
import type { Catalog } from '../catalog.generated';
import type { DataAdapter } from '../data';
import { download } from '../data';
import type { Analysis, AnalysisOptions, Thresholds } from '../domain';
import { DEFAULT_QC, format } from '../domain';
import { compareConditions, controlSummary, isDefaultQC, optionsKey, QC_FIELDS, scenarioChanges } from '../lab';
import { createLabPacket } from '../lab-export';
import { useStudyAnalyses } from '../lab-data';

type Props = {
  adapter: DataAdapter; catalog: Catalog; options: AnalysisOptions; analysis: Analysis;
  onInspect: (id: string) => void;
};

function LoadState({ error, retry }: { error: string; retry: () => void }) {
  return <div className={`lab-load ${error ? 'error-text' : ''}`} role={error ? 'alert' : 'status'}>
    {error || 'Loading the other acquisition run from the selected data source…'}
    {error && <button className="secondary compact" onClick={retry}>Retry run evidence</button>}
  </div>;
}

export function StudyOverview({ adapter, catalog, options, analysis, onInspect }: Props) {
  const { analyses, error, retry } = useStudyAnalyses(adapter, catalog, options, analysis);
  const [exportError, setExportError] = useState('');
  const volumes = catalog.wells.filter(well => well.volume);
  const measured = catalog.wells.filter(well => well.measured && well.measurements);
  const compounds = [...new Set(catalog.wells.filter(well => !well.control).map(well => well.compound))];
  const rows = analyses ? catalog.runs.map(run => {
    const result = analyses[run.id], controls = controlSummary(catalog, run.id, result);
    return { runId: run.id, instrument: run.instrument, acquiredAt: run.acquiredAt,
      measured: catalog.wells.filter(well => well.runId === run.id && well.measured && well.measurements).length,
      included: result.included, excluded: result.excluded.length, unmeasured: result.unmeasured,
      controls: controls.n, controlMedian: result.controlMedian, controlCV: controls.cvPercent,
      estimableConditions: result.groups.filter(group => group.mean !== null).length,
      totalConditions: result.groups.length };
  }) : [];
  const exportSummary = () => {
    try {
      download(createLabPacket(catalog, adapter.kind === 'fabric', 'Study and control review', rows, options,
        { nDefinition: analysis.nDefinition, missingDesign: ['Independent biological replication', 'Positive-reference controls', 'Validated pharmacological endpoint'] }),
      'assayscope-study-review.zip');
      setExportError('');
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Study export failed.'); }
  };
  return <section className="analysis-surface lab-surface" aria-label="Study overview">
    <div className="lab-heading"><div><span className="eyebrow">STUDY / ACQUISITIONS / CONTROLS</span>
      <h2>Study overview</h2></div><button className="secondary compact" disabled={!analyses} onClick={exportSummary}>
        <ArrowDownToLine size={15} />Export study review</button></div>
    <p>{catalog.experiment.title}. {catalog.experiment.summary}</p>
    <div className="lab-metrics">
      <div><span>Acquisition runs</span><strong>{catalog.runs.length}</strong><small>Not biological replicates</small></div>
      <div><span>Measured screen fields</span><strong>{measured.length}<small> / {catalog.wells.length}</small></strong><small>One per technical well</small></div>
      <div><span>Fictional compounds</span><strong>{compounds.length}</strong><small>{compounds.join(' · ')}</small></div>
      <div><span>3D companion acquisitions</span><strong>{volumes.length}</strong><small>Separate from 2D screen fields</small></div>
    </div>
    <div className="lab-callout"><Info size={17} /><div><b>What can be interpreted?</b>
      <p>Study completeness and descriptive control dispersion are review aids, not assay validation.
        n is technical wells within one condition and run. There is no positive-reference control design or independent biological replication here.</p></div></div>
    <h3>Control readiness by acquisition</h3>
    {!analyses ? <LoadState error={error} retry={retry} /> : <div className="lab-run-cards">
      {rows.map(row => <article key={row.runId} className="lab-run-card">
        <div className="lab-card-label"><FlaskConical size={18} /><b>{catalog.runs.find(run => run.id === row.runId)?.label}</b>
          <span className={`lab-pill ${row.controlMedian === null ? 'warn' : ''}`}>{row.controlMedian === null ? 'Not estimable' : 'Denominator available'}</span></div>
        <p>{row.instrument} · {row.acquiredAt.slice(0, 10)}</p>
        <div className="accounting-strip" role="img" aria-label={`${row.runId}: ${row.included} included, ${row.excluded} excluded, ${row.unmeasured} unmeasured`}>
          <span style={{ flex: row.included }} /><span className="excluded" style={{ flex: row.excluded }} /><span className="unmeasured" style={{ flex: row.unmeasured }} />
        </div><p><b>{row.included}</b> included · <b>{row.excluded}</b> excluded · <b>{row.unmeasured}</b> unmeasured</p>
        <dl className="lab-definition"><dt>Included vehicle wells</dt><dd>{row.controls}</dd>
          <dt>Vehicle median</dt><dd>{format(row.controlMedian, 0)} integrated ADU</dd>
          <dt>Vehicle CV</dt><dd>{format(row.controlCV, 2)}{row.controlCV === null ? '' : '%'}</dd>
          <dt>Estimable conditions</dt><dd>{row.estimableConditions} / {row.totalConditions}</dd></dl>
        <button className="text-button" disabled={!catalog.wells.some(well => well.runId === row.runId && well.control)} onClick={() => {
          const vehicle = catalog.wells.find(well => well.runId === row.runId && well.control);
          if (vehicle) onInspect(vehicle.id);
        }}>Inspect vehicle source <ArrowRight size={13} /></button>
      </article>)}
    </div>}
    <h3>Experimental design and evidence boundaries</h3>
    <div className="readiness-list">
      {[
        ['Declared controls', 'Vehicle wells are identified in the plate metadata. Eligibility follows the active QC settings.'],
        ['Positive-reference separation', 'Not estimable: no declared positive-reference control population. Z-prime is not computed.'],
        ['Independent replication', 'Not established: simulated acquisition runs and technical wells cannot establish biological reproducibility.'],
        ['Source coverage', `${catalog.wells.length} registered 2D image manifests; ${volumes.length} companion volumes. File/frame hashes and physical calibration are retained.`],
        ['Channel interpretation', catalog.channels.map(channel => `${channel.name}: ${channel.meaning}`).join(' ')],
      ].map(([label, text]) => <div key={label}><Info size={16} /><b>{label}</b><p>{text}</p></div>)}
    </div>
    <h3>Acquisition timeline</h3>
    <ol className="acquisition-timeline">{catalog.runs.map(run => <li key={run.id}><b>{run.label}</b>
      <time dateTime={run.acquiredAt}>{run.acquiredAt.replace('T', ' ').replace('Z', ' UTC')}</time>
      <span>{run.instrument} · {run.synthetic ? 'Simulated acquisition metadata' : 'Declared acquisition metadata'}</span></li>)}</ol>
    <p className="microcopy">Catalog completeness is not independent image-byte verification. The viewer checks the selected frame when it is loaded.
      Controls and compounds are study-specific; no generic biological acceptance threshold is imposed.</p>
    {exportError && <p className="error-text" role="alert">{exportError}</p>}
  </section>;
}

export function RunComparison({ adapter, catalog, options, analysis, onInspect, onApply }: Props & {
  onApply: (thresholds: Thresholds, excludeQC: boolean) => void;
}) {
  const { analyses, error, retry } = useStudyAnalyses(adapter, catalog, options, analysis);
  const [other, setOther] = useState(catalog.runs.find(run => run.id !== options.runId)?.id ?? options.runId);
  const [compound, setCompound] = useState('all');
  const [exportError, setExportError] = useState('');
  const rightRun = other === options.runId ? catalog.runs.find(run => run.id !== options.runId)?.id : other;
  const comparisons = analyses && rightRun ? compareConditions(catalog, options.runId, rightRun,
    analyses[options.runId], analyses[rightRun]).filter(row => compound === 'all' || row.compound === compound) : [];
  const exportComparison = () => {
    try {
      download(createLabPacket(catalog, adapter.kind === 'fabric', 'Within-run condition comparison', comparisons.map(row => ({
        compound: row.compound, doseUm: row.doseUm, leftRun: options.runId, rightRun: rightRun ?? '',
        leftTechnicalN: row.left?.n ?? 0, rightTechnicalN: row.right?.n ?? 0,
        leftMeanPercent: row.left?.mean ?? null, rightMeanPercent: row.right?.mean ?? null,
        leftSampleSDPercent: row.left?.sd ?? null, rightSampleSDPercent: row.right?.sd ?? null,
        differencePercentagePoints: row.difference, leftWellIds: row.leftWellIds.join('; '), rightWellIds: row.rightWellIds.join('; '),
      })), options, { comparison: 'Right minus left; each run uses its own eligible vehicle median. No pooled n, p-value or biological reproducibility claim.' }),
      'assayscope-run-comparison.zip');
      setExportError('');
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Comparison export failed.'); }
  };
  return <section className="analysis-surface lab-surface" aria-label="Run comparison">
    <div className="lab-heading"><div><span className="eyebrow">COMPARABILITY / TECHNICAL SUPPORT</span><h2>Run comparison</h2></div>
      <button className="secondary compact" disabled={!comparisons.length} onClick={exportComparison}><ArrowDownToLine size={15} />Export comparison</button></div>
    <p>Compare the same declared compound and concentration without pooling runs. Each run retains its own vehicle denominator, technical n and sample SD.</p>
    <div className="lab-filters"><label>Reference run<input readOnly value={catalog.runs.find(run => run.id === options.runId)?.label} /></label>
      <label>Comparison run<select aria-label="Comparison run" value={rightRun ?? ''} onChange={e => setOther(e.target.value)}>
        {catalog.runs.filter(run => run.id !== options.runId).map(run => <option key={run.id} value={run.id}>{run.label}</option>)}</select></label>
      <label>Compound<select aria-label="Comparison compound" value={compound} onChange={e => setCompound(e.target.value)}>
        <option value="all">All compounds</option>{[...new Set(catalog.wells.filter(well => !well.control).map(well => well.compound))].map(name => <option key={name}>{name}</option>)}
      </select></label></div>
    {!analyses ? <LoadState error={error} retry={retry} /> : !rightRun ? <p>Another acquisition run is required for a comparison.</p> : <>
      <div className="lab-table-scroll"><table className="data-table lab-table" aria-label="Condition comparison across runs">
        <thead><tr><th>Compound / µM</th><th>{options.runId}<br />n / mean ± SD (%)</th><th>{rightRun}<br />n / mean ± SD (%)</th><th>Difference (pp)</th><th>Source fields</th></tr></thead>
        <tbody>{comparisons.map(row => <tr key={`${row.compound}-${row.doseUm}`}>
          <td><b>{row.compound}</b><small>{row.doseUm} µM</small></td>
          <td><b>{row.left?.n ?? 0} / {row.leftExpected}</b><small>{format(row.left?.mean)} ± {format(row.left?.sd)}</small></td>
          <td><b>{row.right?.n ?? 0} / {row.rightExpected}</b><small>{format(row.right?.mean)} ± {format(row.right?.sd)}</small></td>
          <td className="numeric">{row.difference === null ? 'Not estimable' : `${row.difference > 0 ? '+' : ''}${format(row.difference, 2)}`}</td>
          <td><div className="well-links">{[...row.leftWellIds, ...row.rightWellIds].map(id =>
            <button key={id} onClick={() => onInspect(id)}>{id}</button>)}</div></td>
        </tr>)}</tbody></table></div>
      <p className="microcopy">n / registered technical wells. “Not estimable” can mean no included wells or no positive-valued eligible vehicle denominator.
        Differences are percentage points, not fold change or significance. Same coordinate does not establish a paired biological sample.</p>
    </>}
    {exportError && <p className="error-text" role="alert">{exportError}</p>}
    <QCScenario key={options.runId} adapter={adapter} catalog={catalog} options={options} analysis={analysis}
      onInspect={onInspect} onApply={onApply} />
  </section>;
}

function QCScenario({ adapter, catalog, options, analysis, onInspect, onApply }: Props & {
  onApply: (thresholds: Thresholds, excludeQC: boolean) => void;
}) {
  const [draft, setDraft] = useState<Thresholds>({ ...options.thresholds });
  const [exclude, setExclude] = useState(!options.excludeQC);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ baselineKey: string; candidateKey: string; result: Analysis } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const candidate = { ...options, excludeQC: exclude, thresholds: draft };
  const result = preview?.baselineKey === optionsKey(options) && preview.candidateKey === optionsKey(candidate) ? preview.result : null;
  const changes = result ? scenarioChanges(catalog, options.runId, analysis, result) : [];
  const runPreview = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true); setError(''); setPreview(null);
    try {
      const evaluated = await adapter.analyze(candidate, request.signal);
      request.signal.throwIfAborted();
      scenarioChanges(catalog, options.runId, analysis, evaluated);
      setPreview({ baselineKey: optionsKey(options), candidateKey: optionsKey(candidate), result: evaluated });
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Scenario failed; no replacement analysis was used.');
    } finally { if (!request.signal.aborted) setPending(false); }
  };
  const exportScenario = () => {
    if (!result) return;
    try {
      download(createLabPacket(catalog, adapter.kind === 'fabric', 'QC scenario sensitivity', catalog.wells.filter(well => well.runId === options.runId).map(well => ({
        wellId: well.id, compound: well.compound, doseUm: well.doseUm,
        baselineIncluded: well.measured && !analysis.excluded.includes(well.id),
        candidateIncluded: well.measured && !result.excluded.includes(well.id),
        baselineReporterPercent: analysis.normalized[well.id], candidateReporterPercent: result.normalized[well.id],
        originalIntegratedSignalAdu: well.measurements?.integratedSignalAdu ?? null,
        sourceImageId: well.image.id, sourceSha256: well.image.sha256,
      })), options, { candidate, baselineControlMedian: analysis.controlMedian, candidateControlMedian: result.controlMedian,
        interpretation: 'Exploratory inclusion sensitivity, not a validated threshold selection or scientific effect.' }),
      'assayscope-qc-scenario.zip');
    } catch (e) { setError(e instanceof Error ? e.message : 'Scenario export failed.'); }
  };
  return <section className="scenario-panel" aria-label="QC scenario comparison">
    <div className="lab-heading"><div><span className="eyebrow">EXPLORATORY / NOT APPLIED UNTIL YOU CHOOSE</span>
      <h3><SlidersHorizontal size={18} />QC scenario comparison</h3></div><span className="lab-pill">{options.runId}</span></div>
    <p>Preview an alternative inclusion rule against the current view. Original measurements and saved decisions never change.
      Do not select thresholds merely to favor a condition.</p>
    <div className="lab-filters scenario-fields">{QC_FIELDS.map(field => <label key={field.key}>{field.label}
      <input aria-label={`Scenario ${field.label.toLowerCase()}`} type="number" min={0} max={field.max} step={field.step}
        value={draft[field.key]} onChange={e => {
          const value = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(value) && value >= 0 && value <= field.max &&
              (field.key !== 'objectCountMin' || Number.isInteger(value))) setDraft(previous => ({ ...previous, [field.key]: value }));
        }} /></label>)}</div>
    <div className="lab-actions"><label className="checkbox-label"><input type="checkbox" checked={exclude} aria-label="Scenario exclude flagged wells"
      onChange={e => setExclude(e.target.checked)} />Exclude flagged wells in candidate</label>
      <button className="secondary compact" onClick={() => setDraft({ ...DEFAULT_QC })}>Use default thresholds</button>
      <button className="primary compact" disabled={pending} onClick={runPreview}>{pending ? 'Evaluating…' : 'Preview QC scenario'}</button></div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {result && <div data-testid="scenario-result">
      <div className="scenario-accounting"><div><span>Current view</span><strong>{analysis.included} included</strong>
        <small>{analysis.controlN} vehicle wells · median {format(analysis.controlMedian, 0)} ADU</small></div>
        <ArrowRight size={20} /><div><span>Candidate preview</span><strong>{result.included} included</strong>
          <small>{result.controlN} vehicle wells · median {format(result.controlMedian, 0)} ADU</small></div></div>
      <p><b>{changes.length}</b> wells change inclusion. Both technical-well membership and the vehicle denominator can change.</p>
      <div className="well-links">{changes.map(({ well, after }) => <button key={well.id} onClick={() => onInspect(well.id)}
        title={`${well.id}: ${after}`}>{well.well} · {after}</button>)}</div>
      <div className="lab-actions"><button className="secondary compact" onClick={exportScenario}><ArrowDownToLine size={14} />Export scenario</button>
        <button className="primary compact" onClick={() => onApply({ ...draft }, exclude)}>Apply candidate to view</button></div>
    </div>}
    {!isDefaultQC(options) && <p className="microcopy">The current view differs from the demo's default QC thresholds.</p>}
  </section>;
}
