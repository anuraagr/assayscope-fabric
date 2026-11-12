import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { useEffect, useState } from 'react';
import schema from '../contracts/catalog.schema.json';
import type { Asset, Catalog } from './catalog.generated';
import type { Analysis, AnalysisOptions, ExportOptions, Frame, PublicIndex, Review, ReviewInput } from './domain';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile<Catalog>(schema);

export function validateCatalog(input: unknown): Catalog {
  if (!validate(input)) throw new Error(`Catalog validation failed: ${ajv.errorsText(validate.errors)}`);
  const ids = new Set<string>();
  for (const well of input.wells) {
    if (ids.has(well.id)) throw new Error('Catalog contains duplicate well IDs.');
    ids.add(well.id);
    for (const asset of [well.image, well.volume]) {
      if (!asset) continue;
      if (asset.shape[0] !== asset.timesHours.length || asset.shape[0] !== asset.frameHashes.length ||
          asset.shape[1] !== input.channels.length) throw new Error('Array axes do not match metadata.');
      if (asset.path.startsWith('/') || asset.path.split('/').includes('..')) throw new Error('Unsafe asset path.');
    }
  }
  return input;
}

export interface DataAdapter {
  kind: 'local' | 'fabric';
  cacheNamespace?: string;
  catalog(signal?: AbortSignal): Promise<Catalog>;
  analyze(options: AnalysisOptions, signal?: AbortSignal): Promise<Analysis>;
  frame(asset: Asset, time: number, signal?: AbortSignal): Promise<Uint8Array>;
  labels(asset: Asset, time: number, signal?: AbortSignal): Promise<Uint8Array>;
  review(well: string, signal?: AbortSignal): Promise<Review | null>;
  saveReview(well: string, review: ReviewInput): Promise<Review>;
  export(options: ExportOptions): Promise<Blob>;
  reset(): Promise<void>;
  publicIndex(signal?: AbortSignal): Promise<PublicIndex>;
}

export async function checkedFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;
    if ([502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 200 * 2 ** attempt));
      init?.signal?.throwIfAborted();
      continue;
    }
    let detail = `Request failed (${response.status}).`;
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') detail = body.detail;
    if (response.status === 401) detail = 'Access expired. Sign in again; local data will not replace tenant data.';
    if (response.status === 403) detail = 'Permission denied. Ask the owner for access to this app and experiment.';
    throw new Error(detail);
  }
  throw new Error('Service is unavailable.');
}

const jsonRequest = (value: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal,
});

export async function verifyFrame(asset: Asset, time: number, bytes: Uint8Array) {
  const expected = asset.shape.slice(1).reduce((a, b) => a * b, 1);
  if (expected !== bytes.byteLength || expected > 32 * 1024 * 1024)
    throw new Error('Frame size is corrupt or exceeds the 32 MiB browser limit.');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
  const hex = [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== asset.frameHashes[time]) throw new Error('Image checksum mismatch. Rebuild or re-ingest the dataset.');
  return bytes;
}

export const localAdapter: DataAdapter = {
  kind: 'local',
  async catalog(signal) { return validateCatalog(await (await checkedFetch('/api/catalog', { signal })).json()); },
  async analyze(options, signal) { return (await checkedFetch('/api/analysis', jsonRequest(options, signal))).json(); },
  async frame(asset, time, signal) {
    const response = await checkedFetch(`/api/assets/${asset.id}/frames/${time}`, { signal });
    return verifyFrame(asset, time, new Uint8Array(await response.arrayBuffer()));
  },
  async labels(asset, time, signal) {
    const r = await checkedFetch(`/api/assets/${asset.id}/labels/${time}`, { signal });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length !== asset.shape.slice(2).reduce((a, b) => a * b, 1))
      throw new Error('Label dimensions do not match the image.');
    return bytes;
  },
  async review(well, signal) { return (await checkedFetch(`/api/reviews/${well}`, { signal })).json(); },
  async saveReview(well, review) {
    return (await checkedFetch(`/api/reviews/${well}`, { ...jsonRequest(review), method: 'PUT' })).json();
  },
  async export(options) { return (await checkedFetch('/api/export', jsonRequest(options))).blob(); },
  async reset() { await checkedFetch('/api/reset', jsonRequest({})); cache.clear(); },
  async publicIndex(signal) { return (await checkedFetch('/api/public', { signal })).json(); },
};

const cache = new Map<string, Uint8Array>();
const CACHE_LIMIT = 32 * 1024 * 1024;
function remember(key: string, bytes: Uint8Array) {
  cache.delete(key);
  cache.set(key, bytes);
  let size = [...cache.values()].reduce((sum, item) => sum + item.byteLength, 0);
  while (size > CACHE_LIMIT && cache.size > 1) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    size -= cache.get(first)!.byteLength;
    cache.delete(first);
  }
}

export function useFrame(adapter: DataAdapter, asset: Asset | null, time: number, overlay: boolean) {
  const [state, setState] = useState<{ frame: Frame | null; error: string | null; ms: number }>({
    frame: null, error: null, ms: 0,
  });
  useEffect(() => {
    if (!asset) return;
    const controller = new AbortController();
    const start = performance.now();
    setState(previous => ({
      frame: previous.frame?.asset.id === asset.id ? previous.frame : null, error: null, ms: 0,
    }));
    const key = `${adapter.cacheNamespace ?? adapter.kind}:${asset.frameHashes[time]}`;
    const existing = cache.get(key);
    const image = existing ? Promise.resolve(existing) : adapter.frame(asset, time, controller.signal);
    const labels = overlay ? adapter.labels(asset, time, controller.signal) : Promise.resolve(undefined);
    Promise.all([image, labels]).then(([values, mask]) => {
      if (controller.signal.aborted) return;
      remember(key, values);
      setState({ frame: { values, labels: mask, asset, time }, error: null, ms: performance.now() - start });
    }).catch((e: unknown) => {
      if (!controller.signal.aborted)
        setState({ frame: null, error: e instanceof Error ? e.message : 'Unable to load image.', ms: 0 });
    });
    return () => controller.abort();
  }, [adapter, asset, time, overlay]);
  // Keep the renderer alive during time reads, but never show another well's image.
  const frame = state.frame?.asset.id === asset?.id ? state.frame : null;
  return { ...state, frame, loading: !frame || frame.time !== time };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
