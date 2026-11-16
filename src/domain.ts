import type { Asset, Channel } from './catalog.generated';
import type { ResearchReview } from './reviews.generated';

export type Mode = 'simulated' | 'public' | 'connected';
export type View = 'volume' | 'image';
export type ChannelSetting = { visible: boolean; color: string; low: number; high: number };
export type Thresholds = {
  focusMin: number; saturationMax: number; illuminationMax: number; objectCountMin: number;
};
export const DEFAULT_QC: Thresholds = {
  focusMin: 0.025, saturationMax: 0.015, illuminationMax: 0.55, objectCountMin: 12,
};
export type AnalysisOptions = { runId: string; excludeQC: boolean; thresholds: Thresholds };
export interface DoseGroup {
  compound: string; doseUm: number; n: number; wellIds: string[];
  points: number[]; mean: number | null; sd: number | null;
}
export interface Analysis {
  included: number; excluded: string[]; unmeasured: number;
  controlMedian: number | null; controlN: number;
  normalized: Record<string, number | null>; groups: DoseGroup[];
  formula: string; nDefinition: string; fit: string; thresholds: Thresholds;
  flags: Record<string, string[]>;
  crossRun: { runId: string; instrument: string; flagged: number; total: number; medianFocus: number | null }[];
}
export const REVIEW_STATES = [
  'Investigate', 'Repeat acquisition', 'Prioritize for confirmatory research',
] as const;
export type ReviewState = typeof REVIEW_STATES[number];
export type Review = ResearchReview;
export type ReviewInput = Pick<Review, 'state' | 'rationale' | 'annotation' | 'version'>;
export type ExportOptions = AnalysisOptions & {
  wellId: string;
  view: { assetId: string; time: number; z: number; channels: ChannelSetting[] };
};
export interface PublicStudy {
  id: string; title: string; description: string; license: string; citation: string;
  sourceUrl: string; channels: Channel[]; asset: Asset; transformations: string[];
  defaultVisibility?: boolean[];
}
export interface PublicIndex {
  available: boolean; studies: PublicStudy[]; message?: string;
}
export type Frame = { values: Uint8Array; labels?: Uint8Array; asset: Asset; time: number };
export type CameraPose = {
  position: [number, number, number]; focalPoint: [number, number, number];
  viewUp: [number, number, number]; parallelScale: number; source: string;
};

export function channelDefaults(channels: Channel[]): ChannelSetting[] {
  return channels.map(c => ({ visible: true, color: c.color, low: 0, high: 255 }));
}

export function format(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value)
    ? 'Not estimable'
    : value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function colorRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function slicePixels(
  frame: Frame, settings: ChannelSetting[], plane: 'xy' | 'xz' | 'yz', index: number,
  overlay = false,
) {
  const [, channels, nz, ny, nx] = frame.asset.shape;
  const [width, height] = plane === 'xy' ? [nx, ny] : plane === 'xz' ? [nx, nz] : [ny, nz];
  const limit = plane === 'xy' ? nz : plane === 'xz' ? ny : nx;
  if (!Number.isInteger(index) || index < 0 || index >= limit) throw new Error('Slice is outside the volume.');
  if (frame.values.length !== channels * nz * ny * nx) throw new Error('Corrupt volume dimensions.');
  const pixels = new Uint8ClampedArray(width * height * 4);
  const colors = settings.map(c => colorRgb(c.color));
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const [x, y, z] = plane === 'xy' ? [u, v, index] : plane === 'xz' ? [u, index, v] : [index, u, v];
      const voxel = (z * ny + y) * nx + x;
      const out = (v * width + u) * 4;
      for (let c = 0; c < channels; c++) {
        const s = settings[c];
        if (!s?.visible) continue;
        const intensity = Math.min(1, Math.max(0, (frame.values[voxel * channels + c] - s.low) / (s.high - s.low)));
        for (let rgb = 0; rgb < 3; rgb++) pixels[out + rgb] += intensity * colors[c][rgb];
      }
      if (overlay && frame.labels?.[voxel]) {
        pixels[out] = 255; pixels[out + 1] = 210; pixels[out + 2] = 130;
      }
      pixels[out + 3] = 255;
    }
  }
  return { pixels, width, height };
}

export function boundedFrameTime(asset: Asset, time: number) {
  return Math.max(0, Math.min(asset.shape[0] - 1, Math.floor(time)));
}
