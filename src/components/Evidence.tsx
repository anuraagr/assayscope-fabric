import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, FileCheck2, MessageSquareText, Save } from 'lucide-react';
import type { Catalog, Well } from '../catalog.generated';
import type { DataAdapter } from '../data';
import { format, REVIEW_STATES } from '../domain';
import type { Analysis, Review, ReviewState } from '../domain';

export function Evidence({ well, analysis, adapter, resetToken, catalog }: {
  well: Well; analysis: Analysis | null; adapter: DataAdapter; resetToken: number; catalog: Catalog;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [state, setState] = useState<ReviewState>('Investigate');
  const [rationale, setRationale] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [question, setQuestion] = useState('Why was this well flagged?');
  useEffect(() => {
    const controller = new AbortController();
    setPending(true); setReview(null); setRationale(''); setAnnotation(''); setError(''); setNotice('');
    setState('Investigate'); setAnswer(null);
    adapter.review(well.id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setReview(result);
      if (result) { setState(result.state); setRationale(result.rationale); setAnnotation(result.annotation); }
      setPending(false);
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Review could not be loaded.');
        setPending(false);
      }
    });
    return () => controller.abort();
  }, [adapter, well.id, resetToken]);
  const flags = analysis?.flags[well.id] ?? [];
  const metrics = well.measurements;
  const normalized = analysis?.normalized[well.id];
  const included = !analysis?.excluded.includes(well.id);
  const save = async () => {
    setPending(true); setError(''); setNotice('');
    try {
      const saved = await adapter.saveReview(well.id, { state, rationale, annotation, version: review?.version ?? 0 });
      setReview(saved); setNotice(adapter.kind === 'local' ? 'Saved on this computer' : 'Saved to your authorized review');
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed. Your text has not been saved.'); }
    finally { setPending(false); }
  };
  const guide = () => {
    if (!analysis || !metrics) { setAnswer('Insufficient measured evidence.'); return; }
    const reference = `[${catalog.experiment.id} / ${well.id} / ${well.image.id} / ${catalog.provenance.analysis}]`;
    const responses: Record<string, string> = {
      'Why was this well flagged?': flags.length
        ? `${flags.join(', ')}. Focus is ${format(metrics.focusScore, 4)} (minimum ${analysis.thresholds.focusMin}); saturation is ${format(100 * metrics.saturationFraction, 2)}%. This is an observed acquisition-quality association, not proof of its cause.`
        : 'No configured QC threshold was exceeded. Passing these checks does not prove biological validity.',
      'Which measurements support this comparison?': `${format(normalized)}% normalized reporter, ${metrics.objectCount} nuclear objects, and median nuclear area ${format(metrics.medianAreaUm2)} µm². The control median is ${format(analysis.controlMedian, 0)} integrated ADU from ${analysis.controlN} vehicle wells.`,
      'What changed after QC exclusion?': `${analysis.excluded.length} wells are excluded in this view: ${analysis.excluded.join(', ') || 'none'}. There are ${analysis.included} included wells. ${well.id} is ${included ? 'included' : 'excluded'}; its original measurement is preserved.`,
      'Which source images support this finding?': `The 48 h endpoint comes from ${well.image.id}; SHA-256 ${well.image.sha256}. ${well.volume ? `A separate synthetic 3D acquisition of the same condition is ${well.volume.id}.` : 'No 3D acquisition exists for this well.'}`,
      'What should be investigated next?': flags.length
        ? 'Repeat acquisition of flagged wells using matched settings. Examine focus and illumination independently. Do not rank this signal as a biological effect before confirming the acquisition.'
        : 'Examine both simulated runs, vehicle variability and an orthogonal assay. Technical wells are not independent biological experiments; prioritize only for confirmatory research.',
    };
    setAnswer(`${responses[question]} ${reference}`);
  };
  return <aside className="evidence-panel" aria-label="Selected well evidence">
    <div className="panel-title"><span>EVIDENCE / {well.well}</span><FileCheck2 size={16} /></div>
    <div className={`qc-banner ${flags.length ? 'warning' : 'good'}`}>
      {flags.length ? <AlertTriangle size={17} /> : <Check size={17} />}
      <div><b>{flags.length ? flags.join(' · ') : 'Within configured QC limits'}</b>
        <small>{included ? 'Included in the current analysis' : 'Excluded · original data retained'}</small></div>
    </div>
    <div className="headline-metric"><span className="eyebrow">48 H REPORTER / VEHICLE</span>
      <div><strong data-testid="normalized-value">{format(normalized)}</strong><span>{normalized == null ? '' : '%'}</span></div>
      <p>Background-corrected integrated signal.<br />A descriptive proxy, not viability.</p>
    </div>
    <dl className="measurements">
      <div><dt>Nuclear objects</dt><dd>{format(metrics?.objectCount, 0)} <small>/ field</small></dd></div>
      <div><dt>Median nuclear area</dt><dd>{format(metrics?.medianAreaUm2)} <small>µm²</small></dd></div>
      <div><dt>3D mask volume, 48 h</dt><dd>{metrics?.spheroidVolumeUm3 == null ? 'Not acquired' : `${format(metrics.spheroidVolumeUm3 / 1e6, 2)} × 10⁶ µm³`}</dd></div>
      <div><dt>Focus score</dt><dd>{format(metrics?.focusScore, 4)}</dd></div>
    </dl>
    <details className="method-details"><summary>How these values were measured <ArrowUpRight size={12} /></summary>
      <p>Gaussian smoothing, Otsu threshold and distance-transform watershed. No learned model.
        The screen is a separate 2D endpoint field, not the current 3D slice.</p>
      <p>{analysis?.formula}. {analysis?.nDefinition}.</p>
    </details>
    <section className="review-section">
      <h3><MessageSquareText size={17} />Research review</h3>
      <label className="field-label">Decision<select aria-label="Research decision" value={state}
        onChange={e => setState(e.target.value as ReviewState)}>
        {REVIEW_STATES.map(s => <option key={s}>{s}</option>)}
      </select></label>
      <label className="field-label">Rationale<textarea aria-label="Decision rationale" value={rationale}
        maxLength={4000} onChange={e => setRationale(e.target.value)} placeholder="Record the evidence and reason for this decision" rows={3} /></label>
      <label className="field-label">Image annotation<textarea aria-label="Image annotation" value={annotation}
        maxLength={4000} onChange={e => setAnnotation(e.target.value)} placeholder="Record an observation about this image" rows={2} /></label>
      <button className="primary full" disabled={pending || !rationale.trim()} onClick={save}><Save size={14} />{pending ? 'Loading review…' : 'Save review'}</button>
      {notice && <p className="success-text" role="status">{notice}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <small className="storage-note">{adapter.kind === 'local' ? 'Local SQLite · no sign-in · persists across restarts' : 'Fabric · private, caller-scoped review'}</small>
    </section>
    <details className="guided-analysis"><summary>Guided analysis <span>Deterministic</span></summary>
      <label className="sr-only" htmlFor="evidence-question">Evidence question</label>
      <select id="evidence-question" value={question} onChange={e => setQuestion(e.target.value)}>
        {['Why was this well flagged?', 'Which measurements support this comparison?', 'What changed after QC exclusion?',
          'Which source images support this finding?', 'What should be investigated next?'].map(q => <option key={q}>{q}</option>)}
      </select>
      <button className="secondary full" onClick={guide}>Explain this evidence</button>
      {answer && <p className="guided-answer" role="status">{answer}</p>}
      <small>Calculated records and explicit rules. Not generative AI.</small>
    </details>
  </aside>;
}
