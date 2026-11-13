import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Download, ExternalLink, Fingerprint,
  FlaskConical, Grid2X2, Link2, LoaderCircle, LockKeyhole, Moon, PanelLeftOpen, Play, RotateCcw, Sun, X } from 'lucide-react';
import type { Catalog } from './catalog.generated';
import { download, localAdapter } from './data';
import type { DataAdapter } from './data';
import { channelDefaults, DEFAULT_QC, format } from './domain';
import type { Analysis, Mode, PublicIndex, Thresholds } from './domain';
import { parseState, shareUrl } from './state';
import type { ViewState } from './state';
import { Plate } from './components/Plate';
import { Workbench } from './components/Workbench';
import { Evidence } from './components/Evidence';
import { ProvenancePanel, QualityPanel, ResponsePanel } from './components/AnalyticalPanels';
import type { FabricSession } from './fabric';

type Tab = 'workbench' | 'response' | 'quality' | 'provenance';
const TAB_ITEMS = [
  { id: 'workbench', title: 'Microscopy workbench', icon: Grid2X2 },
  { id: 'response', title: 'Response & evidence', icon: Activity },
  { id: 'quality', title: 'Lab quality', icon: FlaskConical },
  { id: 'provenance', title: 'Provenance', icon: Fingerprint },
] as const;
const TOUR = [
  { title: 'Experiment design', body: 'Review reporter measurements and acquisition quality across two runs. Compounds, images and acquisition metadata in this screen are simulated.', well: 'B11', tab: 'workbench' as Tab },
  { title: 'Volume and sections', body: 'Adjust the cutaway, Z section and channel visibility. Orthogonal sections and the 3D rendering use the same voxel array.', well: 'B11', tab: 'workbench' as Tab },
  { title: 'Timepoints and control comparison', body: 'Inspect six simulated volumetric timepoints. Compare the vehicle control using synchronized time, camera and display settings.', well: 'B11', tab: 'workbench' as Tab },
  { title: 'Acquisition QC', body: 'Cygnus-09 has a low reporter signal and a low-focus flag. Review the source field before interpreting the signal change as a biological response.', well: 'F11', tab: 'workbench' as Tab },
  { title: 'QC exclusions', body: 'Toggle exclusions and inspect the included wells and control denominator. Replicates are technical wells, not cells or timepoints. No IC50 is estimated.', well: 'F11', tab: 'response' as Tab },
  { title: 'Review and export', body: 'Save a rationale and annotation. Export measurements, the selected image, exclusions and provenance. Shared links restore view settings without granting access.', well: 'B11', tab: 'provenance' as Tab },
];

function FabricGate({ onReady }: { onReady: (adapter: DataAdapter) => void }) {
  const [session, setSession] = useState<FabricSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    import('./fabric').then(module => module.createFabricSession()).then(async s => {
      await s.initialize();
      if (!active) return;
      setSession(s); setBusy(false);
      if (s.isAuthenticated()) onReady(s.adapter);
    }).catch((e: unknown) => {
      if (active) { setError(e instanceof Error ? e.message : 'Fabric configuration is unavailable.'); setBusy(false); }
    });
    return () => { active = false; };
  }, [onReady]);
  return <section className="connection-gate" aria-label="Fabric connection">
    <LockKeyhole size={36} /><span className="eyebrow">TENANT DATA / AUTHORIZATION REQUIRED</span>
    <h1>Not connected to Fabric.</h1>
    <p>{error || 'Sign in with an identity authorized to access the configured Fabric app and dataset.'}</p>
    <p className="subtle">Local fixtures are never used as a fallback for connected mode.</p>
    {session && <button className="primary" disabled={busy} onClick={() => {
      // Sign-in starts synchronously in this user gesture so the browser permits the popup.
      const request = session.signIn();
      setBusy(true); setError('');
      request.then(() => onReady(session.adapter)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sign-in failed.'))
        .finally(() => setBusy(false));
    }}>Sign in to your Fabric tenant <ArrowRight size={16} /></button>}
    {busy && <p role="status">Checking tenant configuration…</p>}
    {error && <div className="command-note"><code>npm run fabric:doctor -- --config config/tenant.local.json</code><small>Requires a tenant/workspace/capacity target and Fabric Apps enabled.</small></div>}
  </section>;
}

export default function App() {
  const tenantBuild = import.meta.env.VITE_DATA_MODE === 'fabric';
  const [state, setState] = useState<ViewState>(() => {
    const saved = parseState(window.location.search);
    return tenantBuild ? { ...saved, mode: 'connected' } : saved;
  });
  const [adapter, setAdapter] = useState<DataAdapter | null>(state.mode === 'connected' ? null : localAdapter);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [publicIndex, setPublicIndex] = useState<PublicIndex | null>(null);
  const [studyId, setStudyId] = useState('biad610-bt474');
  const [tab, setTab] = useState<Tab>('workbench');
  const [excludeQC, setExcludeQC] = useState(true);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_QC);
  const [collapsed, setCollapsed] = useState(false);
  const [light, setLight] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState('');
  const update = useCallback((patch: Partial<ViewState>) => setState(s => ({ ...s, ...patch })), []);
  const connected = useCallback((data: DataAdapter) => { setAdapter(data); }, []);
  const options = useMemo(() => ({ runId: state.run, excludeQC, thresholds }), [state.run, excludeQC, thresholds]);
  useEffect(() => {
    const authChanged = () => {
      setAdapter(null); setCatalog(null); setAnalysis(null); setShare('');
      update({ mode: 'connected' });
    };
    window.addEventListener('assayscope-auth-changed', authChanged);
    return () => window.removeEventListener('assayscope-auth-changed', authChanged);
  }, [update]);

  useEffect(() => {
    if (!adapter) return;
    const controller = new AbortController();
    setError(''); setCatalog(null); setAnalysis(null);
    adapter.catalog(controller.signal).then(result => {
      if (!controller.signal.aborted) {
        setCatalog(result);
        performance.mark('assayscope-shell-ready');
      }
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Experiment could not be loaded.');
    });
    return () => controller.abort();
  }, [adapter, resetToken]);
  useEffect(() => {
    if (!adapter || !catalog || state.mode === 'public') return;
    const controller = new AbortController();
    setAnalysis(null);
    adapter.analyze(options, controller.signal).then(result => {
      if (!controller.signal.aborted) setAnalysis(result);
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Analysis could not be loaded.');
    });
    return () => controller.abort();
  }, [adapter, catalog, options, state.mode]);
  useEffect(() => {
    if (!adapter || state.mode !== 'public') return;
    const controller = new AbortController();
    adapter.publicIndex(controller.signal).then(setPublicIndex).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Public reference could not be loaded.');
    });
    return () => controller.abort();
  }, [adapter, state.mode]);
  useEffect(() => {
    document.documentElement.dataset.reportTheme = light ? 'light' : 'dark';
  }, [light]);

  const well = catalog?.wells.find(w => w.runId === state.run && w.well === state.well);
  const study = publicIndex?.studies.find(s => s.id === studyId);
  const publicMode = state.mode === 'public';
  const asset = publicMode ? study?.asset : state.view === 'volume' && well?.volume ? well.volume : well?.image;
  const channelInfo = publicMode ? study?.channels : catalog?.channels;
  const defaultChannels = useMemo(() => {
    if (!channelInfo) return [];
    return channelDefaults(channelInfo).map((c, i) => ({
      ...c, visible: publicMode ? study?.defaultVisibility?.[i] ?? true : true,
    }));
  }, [channelInfo, publicMode, study?.defaultVisibility]);
  const channels = state.channels && channelInfo && state.channels.length === channelInfo.length ? state.channels : defaultChannels;
  useEffect(() => {
    if (well && !publicMode && state.view === 'volume' && !well.volume) update({ view: 'image' });
  }, [well, publicMode, state.view, update]);
  useEffect(() => {
    if (!well || publicMode || !asset || !channels.length) return;
    const url = shareUrl(window.location.origin, window.location.pathname, {
      ...state, channels, time: Math.min(state.time, asset.shape[0] - 1), z: Math.min(state.z, asset.shape[2] - 1),
    });
    window.history.replaceState(null, '', url);
  }, [well, publicMode, asset, channels, state]);
  const controlWell = catalog?.wells.find(w => w.runId === state.run && w.well === 'G01');
  const control = asset?.shape[2] && asset.shape[2] > 1 ? controlWell?.volume : controlWell?.image;
  const selectWell = useCallback((selected: string, run?: string) => {
    const found = catalog?.wells.find(w => w.well === selected && w.runId === (run ?? state.run));
    update({ well: selected, ...(run ? { run } : {}), time: 0,
      view: found?.volume ? 'volume' : 'image', z: found?.volume ? 32 : 0 });
    setTab('workbench'); setNotice('');
  }, [catalog, state.run, update]);
  const changeMode = (mode: Mode) => {
    if (tenantBuild && mode !== 'connected') return;
    update({ mode, compare: false, overlay: false, channels: null, time: 0, view: 'volume', z: 17 });
    setError(''); setNotice(''); setTab('workbench'); setShare(''); setTour(null);
    setAdapter(mode === 'connected' ? null : localAdapter);
    if (mode === 'connected') { setCatalog(null); setAnalysis(null); }
  };
  const exportEvidence = async () => {
    if (!adapter || !well || !asset) return;
    setBusy(true); setError('');
    try {
      const blob = await adapter.export({ ...options, wellId: well.id,
        view: { assetId: asset.id, time: Math.min(state.time, asset.shape[0] - 1),
          z: Math.min(state.z, asset.shape[2] - 1), channels } });
      download(blob, `assayscope-${well.id}-evidence.zip`);
      setNotice('Evidence ZIP exported with measurements, selected slice and provenance.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!adapter || adapter.kind !== 'local') return;
    setBusy(true); setError('');
    try {
      await adapter.reset();
      setState(parseState('')); setExcludeQC(true); setThresholds(DEFAULT_QC); setTab('workbench');
      setResetToken(t => t + 1); setTour(null); setShare(''); setResetConfirm(false);
      window.history.replaceState(null, '', window.location.pathname);
      setNotice('Demo review state reset. Source data and public reference packs were preserved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed.'); }
    finally { setBusy(false); }
  };
  const advanceTour = (step: number) => {
    if (step >= TOUR.length) { setTour(null); return; }
    setTour(step); selectWell(TOUR[step].well); setTab(TOUR[step].tab);
    update({ compare: step === 2, overlay: false });
  };
  const shareState = () => {
    const url = shareUrl(window.location.origin, window.location.pathname, { ...state, channels });
    setShare(url); window.history.replaceState(null, '', url);
    setNotice('This link restores a view. It does not grant access or contain credentials.');
  };

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to microscopy workbench</a>
    <header className="app-header">
      <a className="wordmark" href={window.location.pathname} aria-label="AssayScope home"><span className="brand-symbol"><i /><i /><i /></span>
        <span>Assay<span>Scope</span><small>MICROSCOPY REVIEW</small></span></a>
      <div className="header-divider" />
      <label className="mode-selector"><span className={`status-dot ${state.mode === 'connected' && !adapter ? 'offline' : ''}`} />
        <span className="sr-only">Data experience</span>
        <select aria-label="Data experience" value={state.mode} onChange={e => changeMode(e.target.value as Mode)}>
          {!tenantBuild && <option value="simulated">Simulated screening experiment</option>}
          {!tenantBuild && <option value="public">Public microscopy reference</option>}
          <option value="connected">{adapter?.kind === 'fabric' ? 'Connected tenant data' : 'Connected tenant data · not connected'}</option>
        </select>
      </label>
      <div className="header-actions">
        <span className="research-badge">RESEARCH ONLY</span>
        <button className="icon-button" aria-label={light ? 'Use dark image surround' : 'Use light report theme'} onClick={() => setLight(v => !v)}>{light ? <Moon size={18} /> : <Sun size={18} />}</button>
        <button className="secondary compact" disabled={publicMode || !catalog} onClick={() => advanceTour(0)}><Play size={13} />Presenter</button>
        <button className="primary compact" disabled={publicMode || !well || !analysis || busy} onClick={exportEvidence}><Download size={15} />{busy ? 'Working…' : 'Export evidence'}</button>
      </div>
    </header>
    {state.mode === 'connected' && !adapter ? <FabricGate onReady={connected} /> : <>
      <nav className="tab-bar" aria-label="Product surfaces">
        {TAB_ITEMS.map(t => <button key={t.id} className={tab === t.id ? 'selected' : ''} aria-current={tab === t.id ? 'page' : undefined}
          disabled={publicMode && t.id !== 'workbench'} onClick={() => setTab(t.id)}><t.icon size={16} />{t.title}</button>)}
        <span className="tab-spacer" /><button onClick={shareState} disabled={publicMode || !well}><Link2 size={15} />Share view</button>
        <button disabled={adapter?.kind !== 'local' || busy} onClick={() => setResetConfirm(true)}><RotateCcw size={14} />Reset demo</button>
      </nav>
      <section className="question-banner">
        <div><span className="eyebrow">{publicMode ? 'PUBLIC REFERENCE / NOT PART OF THE SCREEN' : 'THE RESEARCH QUESTION'}</span>
          <h1>{publicMode ? 'Public microscopy datasets' : catalog?.experiment.question ?? 'Loading experiment…'}</h1>
          <p>{publicMode ? 'Independent endpoint studies with source metadata, attribution and preprocessing records. No paired samples or treatment assignments.'
            : 'Compare image-derived reporter measurements, technical replicates and acquisition QC across two simulated runs.'}</p></div>
        {!publicMode && catalog && <label className="run-select"><span>ACQUISITION RUN</span><select aria-label="Acquisition run" value={state.run}
          onChange={e => update({ run: e.target.value, time: 0 })}>{catalog.runs.map(r => <option key={r.id} value={r.id}>{r.label} · {r.instrument}</option>)}</select></label>}
      </section>
      {(error || notice) && <div className={`notice-bar ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
        {error || notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={14} /></button></div>}
      {share && <div className="share-panel"><label>View link<input aria-label="Shareable view link" readOnly value={share} onFocus={e => e.target.select()} /></label>
        <small>Only app state is shared. Recipients need this local app or authorized tenant access and the same dataset.</small></div>}
      {publicMode ? <main id="main" className="public-layout">
        <aside className="study-panel"><span className="eyebrow">REFERENCE LIBRARY</span><h2>Available datasets</h2>
          <p className="subtle">A cell-painting field and a cell-line-derived spheroid. They are independent studies.</p>
          {publicIndex?.studies.map(s => <button className={`reference-pick ${s.id === studyId ? 'selected' : ''}`} key={s.id}
            onClick={() => { setStudyId(s.id); update({ time: 0, z: Math.floor(s.asset.shape[2] / 2), view: s.asset.shape[2] > 1 ? 'volume' : 'image', channels: null }); }}>
            <BookOpen size={18} /><span>{s.title}<small>{s.license}</small></span><ChevronRight size={15} /></button>)}
          <div className="local-note">No public images are bundled in Git.<br />No synthetic fallback.</div>
        </aside>
        {!publicIndex?.available || !study ? <section className="empty-state public-empty"><BookOpen size={36} /><h2>The public pack is not installed.</h2>
          <p>{publicIndex?.message ?? 'Checking the local reference library…'}</p><code>python -m assayscope.public_data fetch</code>
          <p>117.3 MB of original image files. Checksummed, resumable downloads from the primary publishers.</p></section>
          : <><div className="main-column">{asset && channelInfo && adapter && <Workbench
            adapter={adapter} asset={asset} control={null} title={study.title} subtitle={study.description}
            channelInfo={channelInfo} channels={channels} onChannels={c => update({ channels: c })}
            time={state.time} onTime={t => update({ time: t })} z={state.z} onZ={z => update({ z })}
            clip={state.clip} onClip={clip => update({ clip })} overlay={false} onOverlay={() => undefined}
            compare={false} onCompare={() => undefined} view={state.view} onView={view => update({ view })}
            hasVolume={asset.shape[2] > 1} reference defaults={defaultChannels} resetToken={resetToken} />}</div>
            <aside className="evidence-panel public-evidence"><span className="eyebrow">SOURCE / ATTRIBUTION</span><h2>{study.license}</h2><p>{study.citation}</p>
              <a href={study.sourceUrl} target="_blank" rel="noreferrer">Primary dataset record <ExternalLink size={14} /></a>
              <h3>Image preprocessing</h3><ul>{study.transformations.map(t => <li key={t}>{t}</li>)}</ul>
              <h3>Derivative SHA-256</h3><p className="hash">{study.asset.sha256}</p>
              <p>Reference images are not included in the screening response analysis.</p></aside></>}
      </main> : !catalog || !well || !adapter ? <main id="main" className="empty-state">
        {error ? <><CircleHelp size={32} /><h2>Experiment unavailable</h2><p>Resolve the error above, then reload. No fabricated results are shown.</p></>
          : <><LoaderCircle className="loading-icon" size={32} /><h2>Preparing source images and analysis</h2><p>The first start generates a bounded synthetic pack on CPU. Subsequent starts reuse it.</p></>}
      </main> : <main id="main" className={`workspace ${collapsed ? 'navigation-collapsed' : ''}`}>
        {!collapsed ? <Plate catalog={catalog} run={state.run} selected={well} analysis={analysis}
          onSelect={selectWell} onCollapse={() => setCollapsed(true)} />
          : <aside className="collapsed-rail"><button className="icon-button" aria-label="Expand experiment navigation" onClick={() => setCollapsed(false)}><PanelLeftOpen size={19} /></button><span>EXPERIMENT 001</span></aside>}
        <div className="main-column">
          <div className="analysis-options"><label><input aria-label="Exclude QC flagged wells" type="checkbox" checked={excludeQC} onChange={e => setExcludeQC(e.target.checked)} />
            Exclude QC-flagged wells</label><details><summary>QC thresholds</summary><div className="threshold-popover">
              <h3>Demo-calibrated thresholds</h3>
              {([['focusMin', 'Minimum focus', 0.001, 1], ['saturationMax', 'Maximum saturated fraction', 0.001, 1],
                ['illuminationMax', 'Maximum illumination CV', 0.01, 5], ['objectCountMin', 'Minimum nuclear count', 1, 10000]] as const).map(([key, title, step, max]) =>
                <label key={key}>{title}<input type="number" aria-label={title} min={0} max={max} step={step} value={thresholds[key]}
                  onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= max) setThresholds(q => ({ ...q, [key]: n })); }} /></label>)}
              <button className="secondary" onClick={() => setThresholds(DEFAULT_QC)}>Restore thresholds</button><small>Changes recompute inclusion, not original measurements.</small>
            </div></details><span>{analysis ? `${analysis.controlN} vehicle controls included` : 'Recalculating…'}</span></div>
          {tab === 'workbench' && asset && channelInfo && <Workbench
            adapter={adapter} asset={asset} control={control ?? null}
            title={`${well.compound} ${well.control ? 'control' : `· ${format(well.doseUm, 2)} µM`}`}
            subtitle={`Well ${well.well} · technical replicate ${well.replicate} · ${state.view === 'volume' && well.volume ? 'synthetic 3D companion acquisition' : '48 h screen field'}`}
            channelInfo={channelInfo} channels={channels} onChannels={c => update({ channels: c })}
            time={state.time} onTime={t => update({ time: t })} z={state.z} onZ={z => update({ z })}
            clip={state.clip} onClip={clip => update({ clip })} overlay={state.overlay} onOverlay={overlay => update({ overlay })}
            compare={state.compare} onCompare={compare => update({ compare })} view={state.view} onView={view => update({ view, time: 0 })}
            hasVolume={Boolean(well.volume)} reference={false} resetToken={resetToken} />}
          {tab === 'response' && analysis && <ResponsePanel analysis={analysis} onSelect={selectWell} />}
          {tab === 'quality' && analysis && <QualityPanel analysis={analysis} catalog={catalog} run={state.run} onSelect={selectWell} />}
          {tab === 'provenance' && <ProvenancePanel catalog={catalog} well={well} />}
          {(tab === 'response' || tab === 'quality') && !analysis && <div className="empty-state" role="status">Recalculating the evidence…</div>}
          {tab === 'workbench' && <div className="takeaway"><span><Check size={17} />INTERPRETATION LIMITS</span>
            <p>{analysis?.flags[well.id]?.length ? 'This acquisition exceeds a configured QC threshold. Review the source images before interpreting the reporter measurement.'
              : 'No configured acquisition threshold is exceeded. Biological interpretation requires independent replication and orthogonal assays.'}</p></div>}
        </div>
        <Evidence well={well} analysis={analysis} adapter={adapter} resetToken={resetToken} catalog={catalog} />
      </main>}
    </>}
    {tour !== null && <div className="presenter-card" role="region" aria-label="Guided presenter">
      <span className="eyebrow">GUIDED PRESENTER / {tour + 1} OF {TOUR.length}</span><button className="icon-button close" aria-label="Close presenter" onClick={() => setTour(null)}><X size={16} /></button>
      <h3>{TOUR[tour].title}</h3><p>{TOUR[tour].body}</p><div><button className="text-button" disabled={tour === 0} onClick={() => advanceTour(tour - 1)}>Previous</button>
        <button className="primary compact" onClick={() => advanceTour(tour + 1)}>{tour === TOUR.length - 1 ? 'Finish walkthrough' : 'Next'}<ArrowRight size={14} /></button></div>
    </div>}
    {resetConfirm && <div className="modal-backdrop" onKeyDown={e => {
      if (e.key === 'Escape') setResetConfirm(false);
      if (e.key === 'Tab') {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="reset-title" className="reset-dialog">
        <h2 id="reset-title">Reset demo-only state?</h2><p>This deletes saved reviews of the synthetic screen on this computer and resets the view.
          Original images, public datasets and tenant data are not deleted.</p><div><button className="secondary" autoFocus onClick={() => setResetConfirm(false)}>Keep reviews</button>
          <button className="primary" disabled={busy} onClick={reset}>Reset synthetic demo</button></div>
      </section>
    </div>}
    <footer className="app-footer"><span>AssayScope · research demonstration</span><span>No clinical, diagnostic, GxP or efficacy claims.</span>
      <span>{adapter?.kind === 'fabric' ? 'Tenant-owned data · authorized access' : 'Local instance · no sign-in'}</span></footer>
  </div>;
}
