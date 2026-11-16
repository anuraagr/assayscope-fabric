import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, ClipboardList, RefreshCw } from 'lucide-react';
import type { Catalog, Well } from '../catalog.generated';
import type { DataAdapter } from '../data';
import { download } from '../data';
import type { Analysis, AnalysisOptions, Review } from '../domain';
import { REVIEW_STATES } from '../domain';
import { reviewQueue } from '../lab';
import { createLabPacket, csvCell } from '../lab-export';

export function ReviewQueue({ adapter, catalog, analysis, options, revision, selected, onInspect, onReview }: {
  adapter: DataAdapter; catalog: Catalog; analysis: Analysis; options: AnalysisOptions; revision: number;
  selected: Well; onInspect: (id: string) => void; onReview: (id: string) => void;
}) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('Needs review');
  const [run, setRun] = useState('all');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  useEffect(() => {
    const request = new AbortController();
    setReviews(null); setError('');
    adapter.reviews(request.signal).then(result => {
      if (!request.signal.aborted) {
        const known = new Set(catalog.wells.map(well => well.id));
        if (result.some(review => !known.has(review.well_id))) throw new Error('Review inventory does not match this study.');
        setReviews(result);
      }
    }).catch((e: unknown) => {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Reviews could not be loaded. No empty queue was substituted.');
    });
    return () => request.abort();
  }, [adapter, catalog, revision, refresh]);
  const rows = reviews ? reviewQueue(catalog, analysis, reviews) : [];
  const visible = rows.filter(row => (run === 'all' || row.well.runId === run) &&
    (filter === 'All fields' || (filter === 'Needs review' ? row.flags.length > 0 && !row.review :
      filter === 'No saved review' ? !row.review : row.review?.state === filter)) &&
    `${row.well.id} ${row.well.compound} ${row.review?.rationale ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = rows.filter(row => selection.includes(row.well.id));
  const toggle = (id: string) => {
    setError(''); setNotice('');
    if (!selection.includes(id) && selection.length >= 50) { setError('A review packet is bounded to 50 fields. Clear a selection before adding another.'); return; }
    setSelection(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  };
  const exportRows = chosen.map(({ well, review, flags }) => ({
    dataOrigin: 'Simulated screening experiment', accessMode: adapter.kind === 'fabric' ? 'Connected tenant data' : 'Local instance',
    worksheetStatus: 'Research worksheet; no external task submitted',
    experimentId: catalog.experiment.id, runId: well.runId, wellId: well.id,
    compound: well.compound, doseUm: well.doseUm, technicalReplicate: well.replicate,
    observedQC: flags.join('; '), decision: review?.state ?? 'No saved review',
    rationale: review?.rationale ?? '', annotation: review?.annotation ?? '', reviewVersion: review?.version ?? null,
    reviewUpdatedAt: review?.updated_at ?? null, originalIntegratedReporterAdu: well.measurements?.integratedSignalAdu ?? null,
    sourceImageId: well.image.id, sourceSha256: well.image.sha256,
    spacingZYXMicrometers: well.image.spacingUm.join('; '), sourceTimesHours: well.image.timesHours.join('; '),
    exportAnalysisCodeVersion: catalog.provenance.codeVersion, exportQcThresholdsJson: JSON.stringify(options.thresholds),
    reviewAnalysisContext: 'QC/source revision at decision time was not stored; exported observations describe the current view',
  }));
  const exportPacket = (repeatOnly: boolean) => {
    try {
      if (!chosen.length) throw new Error('Select at least one source field.');
      if (repeatOnly && chosen.some(row => row.review?.state !== 'Repeat acquisition')) {
        throw new Error('A repeat worksheet requires a saved human Repeat acquisition decision for every selected field.');
      }
      if (repeatOnly) {
        const columns = Object.keys(exportRows[0]);
        const csv = [columns.map(csvCell).join(','), ...exportRows.map(row =>
          Object.values(row).map(csvCell).join(','))].join('\r\n');
        download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'assayscope-repeat-acquisition.csv');
      } else {
        download(createLabPacket(catalog, adapter.kind === 'fabric', 'Research review queue', exportRows, options,
          { selection: chosen.map(row => row.well.id), reviewScope: adapter.kind === 'fabric' ? 'Caller-scoped private revisions' : 'This local SQLite instance',
            externalAction: 'No LIMS task, email, scheduling or instrument command was created.' }), 'assayscope-review-packet.zip');
      }
      setError(''); setNotice('Worksheet downloaded. No external task, acquisition or review decision was created.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Review export failed.'); }
  };
  return <section className="analysis-surface lab-surface" aria-label="Research review queue">
    <div className="lab-heading"><div><span className="eyebrow">HUMAN REVIEW / SOURCE-LINKED FOLLOW-UP</span><h2>Review queue</h2></div>
      <button className="secondary compact" disabled={reviews === null && !error}
        onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />Refresh reviews</button></div>
    <p>{adapter.kind === 'fabric' ? 'Only your authorized private review revisions are shown.' : 'Reviews are shared by browsers using this local SQLite instance.'}
      {' '}A QC flag is a request to inspect evidence, not an automatically assigned decision.</p>
    <div className="lab-metrics three">
      <div><span>Flagged without a saved review</span><strong>{reviews ? rows.filter(row => row.flags.length && !row.review).length : '—'}</strong></div>
      <div><span>Saved review decisions</span><strong>{reviews?.length ?? '—'}</strong></div>
      <div><span>Repeat-acquisition decisions</span><strong>{reviews ? reviews.filter(review => review.state === 'Repeat acquisition').length : '—'}</strong></div>
    </div>
    <div className="lab-filters"><label>Queue<select aria-label="Review queue filter" value={filter} onChange={e => setFilter(e.target.value)}>
      {['Needs review', 'All fields', 'No saved review', ...REVIEW_STATES].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Acquisition<select aria-label="Review queue run" value={run} onChange={e => setRun(e.target.value)}><option value="all">All declared runs</option>
        {catalog.runs.map(run => <option key={run.id} value={run.id}>{run.label}</option>)}</select></label>
      <label>Search<input aria-label="Search review queue" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} placeholder="Well, compound or saved rationale" /></label></div>
    <div className="selection-bar"><span>{selection.length} / 50 selected · {visible.length} visible</span>
      <button className="text-button" disabled={!reviews || !visible.length} onClick={() => {
        if (visible.length > 50) { setError('Narrow this queue to 50 fields or fewer before selecting all.'); return; }
        setSelection(visible.map(row => row.well.id)); setError('');
      }}>Select visible</button><button className="text-button" onClick={() => setSelection([])}>Clear selection</button></div>
    {reviews === null ? <div className="lab-load" role={error ? 'alert' : 'status'}>{error || 'Reading saved review revisions…'}</div> :
      <div className="lab-table-scroll"><table className="data-table lab-table" aria-label="Review queue records"><thead><tr>
        <th>Select</th><th>Source / condition</th><th>QC observation</th><th>Saved decision / rationale</th><th>Actions</th>
      </tr></thead><tbody>{visible.map(({ well, flags, review }) => <tr key={well.id} className={well.id === selected.id ? 'active-row' : ''}>
        <td><input type="checkbox" checked={selection.includes(well.id)} aria-label={`Select review ${well.id}`} onChange={() => toggle(well.id)} /></td>
        <td><b>{well.id}</b><small>{well.compound} {well.control ? 'vehicle' : `${well.doseUm} µM`}</small></td>
        <td>{flags.join(', ') || 'No configured flags'}</td>
        <td>{review ? <><b>{review.state}</b><p className="rationale-preview">{review.rationale}</p>
          <small>Revision {review.version} · {review.updated_at}</small></> : <span className="lab-pill warn">No saved review</span>}</td>
        <td><div className="review-row-actions"><button className="text-button" onClick={() => onReview(well.id)}>Review rationale</button>
          <button className="text-button" onClick={() => onInspect(well.id)}>Inspect image <ArrowUpRight size={12} /></button></div></td>
      </tr>)}</tbody></table>
      {!visible.length && <div className="lab-empty"><ClipboardList size={23} /><p>No fields match this queue. Change the filter to inspect saved decisions or other fields.</p></div>}</div>}
    <div className="lab-actions"><button className="secondary compact" disabled={!reviews || !chosen.length} onClick={() => exportPacket(false)}>
      <ArrowDownToLine size={14} />Export selected review packet</button>
      <button className="primary compact" disabled={!reviews || !chosen.length || chosen.some(row => row.review?.state !== 'Repeat acquisition')}
        onClick={() => exportPacket(true)}>Export repeat worksheet</button></div>
    <p className="microcopy">Selection is temporary; saved decisions persist. Repeat worksheets require an explicit saved human decision and retain source hashes,
      calibration and reasons. They do not schedule instruments, update a LIMS or grant another reviewer access.</p>
    <p className="microcopy">Existing review records do not store an immutable QC/source snapshot from decision time.
      Worksheet QC and processing fields are explicitly the current export context, not a reconstruction of past settings.</p>
    {notice && <p role="status" className="success-text">{notice}</p>}
    {error && reviews !== null && <p role="alert" className="error-text">{error}</p>}
  </section>;
}
