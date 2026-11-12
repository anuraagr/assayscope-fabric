import type { ChannelSetting, Mode, View } from './domain';

export interface ViewState {
  mode: Mode; well: string; run: string; time: number; z: number; clip: number;
  view: View; compare: boolean; overlay: boolean; channels: ChannelSetting[] | null;
}

const bounded = (value: string | null, fallback: number, max: number) => {
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : fallback;
};

export function parseState(search: string): ViewState {
  const p = new URLSearchParams(search);
  const rawMode = p.get('mode');
  const mode: Mode = rawMode === 'public' || rawMode === 'connected' ? rawMode : 'simulated';
  const well = /^[A-H](0[1-9]|1[0-2])$/.test(p.get('well') ?? '') ? p.get('well')! : 'B11';
  let channels: ChannelSetting[] | null = null;
  const encoded = p.get('channels');
  if (encoded && encoded.length < 600) {
    const parsed: ChannelSetting[] = encoded.split('_').map(part => {
      const [visible, color, low, high] = part.split('-');
      return { visible: visible === '1', color: `#${color}`, low: Number(low), high: Number(high) };
    });
    if (parsed.length >= 1 && parsed.length <= 8 && parsed.every(c =>
      /^#[a-fA-F0-9]{6}$/.test(c.color) && Number.isFinite(c.low) && Number.isFinite(c.high) &&
      c.low >= 0 && c.high <= 255 && c.low < c.high)) channels = parsed;
  }
  return {
    mode, well, run: p.get('run') === 'run2' ? 'run2' : 'run1',
    time: bounded(p.get('time'), 0, 100), z: bounded(p.get('z'), 32, 4096),
    clip: bounded(p.get('clip'), 58, 100), view: p.get('view') === 'image' ? 'image' : 'volume',
    compare: p.get('compare') === '1', overlay: p.get('overlay') === '1', channels,
  };
}

export function shareUrl(origin: string, pathname: string, state: ViewState): string {
  const url = new URL(pathname, origin);
  url.search = '';
  // Deliberately reconstruct an allowlist; never forward a query string from storage/auth.
  const values = {
    mode: state.mode, well: state.well, run: state.run,
    time: String(state.time), z: String(state.z), clip: String(state.clip),
    view: state.view, compare: state.compare ? '1' : '0', overlay: state.overlay ? '1' : '0',
    channels: state.channels?.map(c =>
      `${c.visible ? 1 : 0}-${c.color.slice(1)}-${c.low}-${c.high}`).join('_') ?? '',
  };
  for (const [k, v] of Object.entries(values)) url.searchParams.set(k, v);
  url.hash = '';
  return url.toString();
}
