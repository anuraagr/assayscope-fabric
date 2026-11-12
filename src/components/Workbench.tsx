import { lazy, Suspense, useEffect, useState } from 'react';
import { Box, Camera, Columns2, Eye, Layers3, Link2, Pause, Play, RotateCcw, ScanLine } from 'lucide-react';
import type { Asset, Channel } from '../catalog.generated';
import type { DataAdapter } from '../data';
import { download, useFrame } from '../data';
import { boundedFrameTime, format, slicePixels } from '../domain';
import type { CameraPose, ChannelSetting, View } from '../domain';
import { ImageView, Slice } from './ImageView';

const VolumeView = lazy(() => import('./VolumeView'));

interface Props {
  adapter: DataAdapter; asset: Asset; control: Asset | null; title: string; subtitle: string;
  channelInfo: Channel[]; channels: ChannelSetting[]; onChannels: (c: ChannelSetting[]) => void;
  time: number; onTime: (t: number) => void; z: number; onZ: (z: number) => void;
  clip: number; onClip: (clip: number) => void; overlay: boolean; onOverlay: (v: boolean) => void;
  compare: boolean; onCompare: (v: boolean) => void; view: View; onView: (v: View) => void;
  hasVolume: boolean; reference: boolean; resetToken: number;
  defaults?: ChannelSetting[];
}

export function Workbench(p: Props) {
  const [playing, setPlaying] = useState(false);
  const [syncCamera, setSyncCamera] = useState(true);
  const [pose, setPose] = useState<CameraPose | null>(null);
  const [reset, setReset] = useState(0);
  const [snapshotError, setSnapshotError] = useState('');
  const time = boundedFrameTime(p.asset, p.time);
  const z = Math.max(0, Math.min(p.asset.shape[2] - 1, p.z));
  const result = useFrame(p.adapter, p.asset, time, p.overlay);
  const compareTime = p.control ? boundedFrameTime(p.control, time) : 0;
  const control = useFrame(p.adapter, p.compare ? p.control : null, compareTime, p.overlay);
  const ready = Boolean(result.frame && !result.loading && (!p.compare || (control.frame && !control.loading)));
  useEffect(() => { setPlaying(false); setPose(null); }, [p.asset.id, p.resetToken]);
  useEffect(() => {
    if (!playing || !ready || p.asset.shape[0] < 2) return;
    const timer = window.setTimeout(() => p.onTime((time + 1) % p.asset.shape[0]), 900);
    return () => window.clearTimeout(timer);
  }, [playing, ready, time, p]);
  const snapshot = () => {
    setSnapshotError('');
    if (!result.frame) return;
    const { pixels, width, height } = slicePixels(result.frame, p.channels, 'xy', z, p.overlay);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
    canvas.toBlob(blob => {
      if (blob) download(blob, `${p.asset.id}-t${time}-z${z}.png`);
      else setSnapshotError('Snapshot encoding failed. Try another view.');
    });
  };
  const render = (frame: typeof result.frame, name: string) => frame && (
    p.view === 'volume' && p.asset.shape[2] > 1
      ? <Suspense fallback={<div className="viewer-message">Preparing the volume renderer…</div>}>
        <VolumeView frame={frame} channels={p.channels} clip={p.clip} resetToken={reset + p.resetToken}
          pose={syncCamera ? pose : null} onPose={setPose} name={name} label={`${name} multichannel 3D microscopy volume`} />
      </Suspense>
      : <ImageView frame={frame} channels={p.channels} z={Math.min(z, frame.asset.shape[2] - 1)}
        overlay={p.overlay} resetToken={reset + p.resetToken} label={`${name} multichannel microscopy image`} />
  );
  return <section className="workbench" aria-label="Microscopy workbench">
    <div className="workbench-heading"><div><span className="eyebrow">{p.reference ? 'INDEPENDENT PUBLIC REFERENCE' : 'SELECTED ACQUISITION'}</span>
      <h2>{p.title}</h2><p>{p.subtitle}</p></div><span className="dimension-tag">{p.asset.shape[0] > 1 ? '3D + TIME' : p.asset.shape[2] > 1 ? '3D STACK' : '2D FIELD'}</span></div>
    <div className="viewer-toolbar">
      <div className="segmented">
        <button aria-pressed={p.view === 'volume'} disabled={!p.hasVolume} onClick={() => p.onView('volume')}><Box size={14} />3D volume</button>
        <button aria-pressed={p.view === 'image'} onClick={() => p.onView('image')}><ScanLine size={14} />2D image</button>
      </div>
      <button className={p.compare ? 'tool active' : 'tool'} disabled={!p.control || p.reference} aria-pressed={p.compare}
        onClick={() => p.onCompare(!p.compare)}><Columns2 size={15} />Compare control</button>
      <div className="toolbar-spacer" />
      <button className="icon-button" title="Save selected XY slice" aria-label="Save slice snapshot" disabled={!result.frame} onClick={snapshot}><Camera size={17} /></button>
      <button className="icon-button" title="Reset camera and display" aria-label="Reset view" onClick={() => {
        setReset(r => r + 1); setPose(null); p.onClip(58); p.onZ(32); p.onTime(0);
        p.onChannels(p.defaults ?? p.channelInfo.map(c => ({ visible: true, color: c.color, low: 0, high: 255 })));
      }}><RotateCcw size={16} /></button>
    </div>
    <div className={`image-stage ${p.compare ? 'comparing' : ''}`}>
      <div className="main-image" data-testid="main-image" aria-busy={!ready}>
        <span className="image-corner-label">{p.compare ? 'TREATMENT / SELECTED' : p.asset.shape[2] > 1 ? 'OPTICAL VOLUME' : 'OPTICAL FIELD'}</span>
        {render(result.frame, 'primary')}
        {!result.frame && <div className="viewer-message" role={result.error ? 'alert' : 'status'}>
          {result.error ?? 'Loading image data…'}</div>}
      </div>
      {p.compare ? <div className="main-image"><span className="image-corner-label">MATCHED VEHICLE / G01</span>
        {render(control.frame, 'control')}
        {!control.frame && <div className="viewer-message" role={control.error ? 'alert' : 'status'}>{control.error ?? 'Loading matched control…'}</div>}
      </div> : <div className="orthogonal-views" aria-label="Synchronized orthogonal slices">
        {result.frame ? <>
          <Slice frame={result.frame} channels={p.channels} plane="xy" index={z} overlay={p.overlay} />
          {p.asset.shape[2] > 1 ? <>
            <Slice frame={result.frame} channels={p.channels} plane="xz" index={Math.floor(p.asset.shape[3] / 2)} overlay={p.overlay} />
            <Slice frame={result.frame} channels={p.channels} plane="yz" index={Math.floor(p.asset.shape[4] / 2)} overlay={p.overlay} />
          </> : <div className="no-depth"><ScanLine size={22} /><b>One optical field</b><span>No Z stack.<br />No time series.<br />No depth inferred.</span></div>}
        </> : <span className="subtle">Slices load with the volume</span>}
      </div>}
    </div>
    <div className="canvas-footer"><span>{p.asset.shape[2] > 1
      ? `${p.asset.shape.slice(2).join(' × ')} voxels · Z/Y/X ${p.asset.spacingUm.map(n => format(n, 2)).join('/')} µm`
      : `${p.asset.shape.slice(3).join(' × ')} pixels · Y/X ${p.asset.spacingUm.slice(1).map(n => format(n, 2)).join('/')} µm · no Z calibration`}</span>
      <span>{result.loading ? 'Loading requested frame…' : `${format(result.ms / 1000, 2)} s load`} · fixed intensity mapping</span></div>
    <div className="spatial-controls">
      {p.asset.shape[2] > 1 ? <label><Layers3 size={14} />Z <b data-testid="z-label">{z}</b><input aria-label="Z slice" type="range" min={0} max={p.asset.shape[2] - 1} value={z}
        onChange={e => p.onZ(Number(e.target.value))} /><small>{format(z * p.asset.spacingUm[0])} µm</small></label>
        : <label><ScanLine size={14} />Single optical field · no Z navigation</label>}
      <label><Box size={14} />Cutaway<input aria-label="3D clipping" type="range" min={10} max={100} value={p.clip} disabled={p.view !== 'volume'}
        onChange={e => p.onClip(Number(e.target.value))} /><b>{p.clip === 100 ? 'Off' : `${p.clip}%`}</b></label>
    </div>
    <div className="timeline">
      <button className="play-button" aria-label={playing ? 'Pause time playback' : 'Play time playback'} disabled={p.asset.shape[0] < 2 || !ready}
        onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <div className="time-control"><div><span>{p.asset.shape[0] > 1 ? 'VOLUMETRIC TIMEPOINT' : 'SINGLE ENDPOINT · NO TIME SERIES'}</span>
        <b data-testid="time-label">{p.asset.shape[0] > 1 ? `${format(p.asset.timesHours[time])} h` : 'Fixed acquisition'}</b></div>
        <input aria-label="Timepoint" type="range" min={0} max={p.asset.shape[0] - 1} value={time}
          disabled={p.asset.shape[0] < 2} onChange={e => { setPlaying(false); p.onTime(Number(e.target.value)); }} />
        <div className="time-ticks">{p.asset.shape[0] > 1 && p.asset.timesHours.map(t => <span key={t}>{format(t)} h</span>)}</div>
      </div>
      {p.compare && <label className="sync-label"><input type="checkbox" checked={syncCamera} onChange={e => setSyncCamera(e.target.checked)} /><Link2 size={14} />Sync camera<small>Time &amp; channels always linked</small></label>}
    </div>
    <div className="channel-strip">
      {p.channelInfo.map((c, i) => <div className="channel" key={c.id}>
        <label><input aria-label={`${c.name} channel`} type="checkbox" checked={p.channels[i]?.visible ?? true}
          onChange={e => p.onChannels(p.channels.map((s, j) => i === j ? { ...s, visible: e.target.checked } : s))} />
          <i style={{ background: p.channels[i]?.color }} />{c.name}</label>
        <details><summary aria-label={`${c.name} display controls`}>Display</summary><div className="channel-popover">
          <p>{c.meaning}</p>
          <label>Color<input aria-label={`${c.name} color`} type="color" value={p.channels[i]?.color ?? c.color} onChange={e => p.onChannels(p.channels.map((s, j) => i === j ? { ...s, color: e.target.value } : s))} /></label>
          <label>Black (ADU)<input aria-label={`${c.name} minimum intensity`} type="number" min={0} max={(p.channels[i]?.high ?? 255) - 1} value={p.channels[i]?.low ?? 0}
            onChange={e => { const n = Number(e.target.value); if (n >= 0 && n < p.channels[i].high) p.onChannels(p.channels.map((s, j) => i === j ? { ...s, low: n } : s)); }} /></label>
          <label>White (ADU)<input aria-label={`${c.name} maximum intensity`} type="number" min={(p.channels[i]?.low ?? 0) + 1} max={255} value={p.channels[i]?.high ?? 255}
            onChange={e => { const n = Number(e.target.value); if (n > p.channels[i].low && n <= 255) p.onChannels(p.channels.map((s, j) => i === j ? { ...s, high: n } : s)); }} /></label>
        </div></details>
      </div>)}
      <label className="overlay-control" title={p.reference ? 'No segmentation is asserted for public reference data' : 'Derived mask boundaries, not generator truth'}>
        <input aria-label="Segmentation overlay" type="checkbox" disabled={p.reference} checked={p.overlay}
          onChange={e => p.onOverlay(e.target.checked)} /><Eye size={14} />Segmentation
      </label>
    </div>
    {snapshotError && <p role="alert">{snapshotError}</p>}
    <p className="display-disclosure">{p.reference
      ? 'Published endpoint only. Derivative transforms are disclosed in the source panel; no drug response or live-cell trajectory is inferred.'
      : 'Simulated fluorescence · no per-image autoscaling · shared display settings preserve intensity differences. 3D and 2D are separate acquisitions of the same simulated condition.'}</p>
  </section>;
}
