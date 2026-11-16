import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Link2, RefreshCw } from 'lucide-react';
import type { Catalog, Well } from '../catalog.generated';
import type { LabContextSnapshot } from '../lab-context.generated';
import type { DataAdapter } from '../data';
import { download } from '../data';
import { validateLabContext } from '../lab-context';

export function LabContextPanel({ adapter, catalog, selected, onSelect }: {
  adapter: DataAdapter; catalog: Catalog; selected: Well; onSelect: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<LabContextSnapshot | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const request = new AbortController();
    setSnapshot(null); setError('');
    adapter.labContext(request.signal).then(raw => {
      if (!request.signal.aborted) setSnapshot(validateLabContext(raw, catalog));
    }).catch((e: unknown) => {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Lab context is unavailable. No replacement metadata was used.');
    });
    return () => request.abort();
  }, [adapter, catalog, retry]);
  const record = snapshot?.records.find(record => record.wellId === selected.id);
  const visible = snapshot?.records.filter(record =>
    `${record.wellId} ${record.sampleId} ${record.protocolId} ${record.externalRecordId}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className="analysis-surface lab-surface" aria-label="Lab context">
    <div className="lab-heading"><div><span className="eyebrow">SAMPLE / PROTOCOL / IMAGE LINEAGE</span><h2>Lab context</h2></div>
      <button className="secondary compact" disabled={snapshot === null && !error}
        onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />Refresh context</button></div>
    <div className="lab-callout warning"><Link2 size={19} /><div><b>No live LIMS or ELN connection</b>
      <p>These are explicitly fictional export records joined by experiment, run, well and source image. Hosting the snapshot in Fabric does not make it a live external system.</p></div></div>
    {!snapshot ? <div className="lab-load" role={error ? 'alert' : 'status'}>{error || 'Loading the context snapshot from the selected data source…'}</div> : <>
      <div className="lab-metrics three"><div><span>Explicit mappings</span><strong>{snapshot.records.length}</strong><small>Fictional export records</small></div>
        <div><span>Wells without context</span><strong>{catalog.wells.length - snapshot.records.length}</strong><small>Not imputed from nearby wells</small></div>
        <div><span>Exported snapshot</span><strong className="date-value">{snapshot.exportedAt.slice(0, 10)}</strong><small>{snapshot.sourceSystem}</small></div></div>
      <h3>Selected source: {selected.id}</h3>
      {record ? <div className="context-record">
        <div className="lab-pill">Example record matched</div>
        <dl className="provenance-grid"><dt>External record / version</dt><dd>{record.externalRecordId} / {record.recordVersion}</dd>
          <dt>Sample / batch</dt><dd>{record.sampleId} / {record.batchId}</dd>
          <dt>Protocol / version</dt><dd>{record.protocolId} / {record.protocolVersion}</dd>
          <dt>External record updated</dt><dd>{record.updatedAt}</dd>
          <dt>Acquisition / field</dt><dd>{record.runId} / {record.wellId}</dd>
          <dt>Source image</dt><dd>{record.sourceImageId}</dd>
          <dt>Image SHA-256</dt><dd className="hash">{selected.image.sha256}</dd>
          <dt>Example link</dt><dd><code>{record.recordUrl}</code><small>Reserved, non-routable address. Not opened or fetched.</small></dd></dl>
      </div> : <div className="lab-empty" data-testid="missing-lab-context"><p><b>External context missing for {selected.id}.</b></p>
        <p>Source image and measurements remain available. No sample, protocol or batch has been inferred.</p></div>}
      <div className="lab-heading"><h3>Snapshot records</h3><button className="secondary compact" onClick={() =>
        download(new Blob([JSON.stringify({ snapshot, experimentId: catalog.experiment.id,
          sourceImageHashes: Object.fromEntries(snapshot.records.map(record => [record.sourceImageId, catalog.wells.find(well => well.id === record.wellId)!.image.sha256])),
          transport: adapter.kind, externalConnection: 'Unconnected example export; no external request was made' }, null, 2)], { type: 'application/json' }),
        'assayscope-lab-context.json')}><ArrowDownToLine size={14} />Export context snapshot</button></div>
      <label className="field-label">Find a record<input aria-label="Search lab context" maxLength={100} value={search}
        onChange={e => setSearch(e.target.value)} placeholder="Source well, sample, protocol or record" /></label>
      <div className="lab-table-scroll"><table className="data-table lab-table" aria-label="Lab context mappings">
        <thead><tr><th>Source field</th><th>External record</th><th>Sample / batch</th><th>Protocol</th></tr></thead>
        <tbody>{visible.map(record => <tr key={record.externalRecordId}><td><button className="text-button" onClick={() => onSelect(record.wellId)}>
          {record.wellId} <ArrowUpRight size={12} /></button></td><td>{record.externalRecordId}<small>Version {record.recordVersion}</small></td>
          <td>{record.sampleId}<small>{record.batchId}</small></td><td>{record.protocolId}<small>Version {record.protocolVersion}</small></td></tr>)}</tbody>
      </table></div>
      <p className="microcopy">{snapshot.sourceRights} A sample/batch association is not a QC cause or biological relationship.
        Live integration requires an authorized endpoint, data rights, reviewed metadata mapping and separate validation.</p>
    </>}
  </section>;
}
