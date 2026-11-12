import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { slicePixels, boundedFrameTime } from './domain';
import type { Frame } from './domain';
import { parseState, shareUrl } from './state';
import { checkedFetch, verifyFrame } from './data';
import { requireFabricConfig } from './fabric';

const frame: Frame = {
  asset: {
    id: 'axes', path: 'images/axes.ome.tif', axes: 'TCZYX', shape: [2, 3, 2, 2, 3],
    spacingUm: [4, 2, 1], timesHours: [0, 6], bytes: 36, sha256: '0'.repeat(64),
    frameHashes: ['0'.repeat(64), '1'.repeat(64)],
  },
  time: 0,
  values: Uint8Array.from({ length: 36 }, (_, i) => i * 6),
  labels: Uint8Array.from({ length: 12 }, (_, i) => i === 7 ? 1 : 0),
};
const settings = [
  { visible: true, color: '#ff0000', low: 0, high: 255 },
  { visible: true, color: '#00ff00', low: 0, high: 255 },
  { visible: true, color: '#0000ff', low: 0, high: 255 },
];

describe('physical array interpretation', () => {
  it('uses ZYXC bytes for XY/XZ/YZ without swapping channels or axes', () => {
    const xy = slicePixels(frame, settings, 'xy', 1);
    expect([xy.width, xy.height]).toEqual([3, 2]);
    expect([...xy.pixels.slice(0, 4)]).toEqual([108, 114, 120, 255]);
    const xz = slicePixels(frame, settings, 'xz', 1);
    expect([xz.width, xz.height]).toEqual([3, 2]);
    expect([...xz.pixels.slice(0, 4)]).toEqual([54, 60, 66, 255]);
    const yz = slicePixels(frame, settings, 'yz', 2);
    expect([yz.width, yz.height]).toEqual([2, 2]);
    expect([...yz.pixels.slice(0, 4)]).toEqual([36, 42, 48, 255]);
  });
  it('applies channel controls and aligned labels to actual pixel output', () => {
    const hidden = slicePixels(frame, [{ ...settings[0], visible: false }, ...settings.slice(1)], 'xy', 1);
    expect(hidden.pixels[0]).toBe(0);
    const labeled = slicePixels(frame, settings, 'xy', 1, true);
    expect([...labeled.pixels.slice(4, 8)]).toEqual([255, 210, 130, 255]);
    expect(() => slicePixels(frame, settings, 'xy', 2)).toThrow('outside');
    expect(boundedFrameTime(frame.asset, 10)).toBe(1);
  });
  it('rejects corrupt array byte count and hash', async () => {
    vi.stubGlobal('crypto', webcrypto);
    await expect(verifyFrame(frame.asset, 0, new Uint8Array(2))).rejects.toThrow('size');
    await expect(verifyFrame(frame.asset, 0, frame.values)).rejects.toThrow('checksum');
    vi.unstubAllGlobals();
  });
});

describe('authorized, reproducible links', () => {
  it('round-trips the intended display state and discards token-like query input', () => {
    const state = { ...parseState(''), well: 'F11', time: 4, z: 12, clip: 72, compare: true, channels: settings };
    const url = shareUrl('https://host.example', '/?unexpected=remove', state);
    expect(parseState(new URL(url).search)).toEqual(state);
    expect(new URL(url).searchParams.has('unexpected')).toBe(false);
    expect(url).not.toContain('access_token');
  });
  it('bounds invalid state instead of allowing paths or nonfinite indexes', () => {
    expect(parseState('?well=../outside&time=NaN&z=-99&channels=bad').well).toBe('B11');
    expect(parseState('?z=-99').z).toBe(0);
    expect(parseState('?channels=1-00ff00-30-10').channels).toBeNull();
  });
  it('fails closed without real tenant configuration', () => {
    expect(() => requireFabricConfig({})).toThrow('No local fallback');
    const valid = {
      VITE_RAYFIN_API_URL: 'https://app.rayfin.windows.net/',
      VITE_RAYFIN_PUBLISHABLE_KEY: ['public', 'test'].join('-'),
      VITE_FABRIC_WORKSPACE_ID: crypto.randomUUID(), VITE_FABRIC_ITEM_ID: crypto.randomUUID(),
    };
    expect(requireFabricConfig(valid).workspaceId).toBe(valid.VITE_FABRIC_WORKSPACE_ID);
    expect(() => requireFabricConfig({ ...valid, VITE_RAYFIN_API_URL: 'https://outside.invalid' })).toThrow('HTTPS Rayfin');
  });
});

describe('visible access failures', () => {
  it.each([401, 403])('does not silently replace HTTP %i with fixtures', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'No' }), { status })));
    await expect(checkedFetch('/api/catalog')).rejects.toThrow(status === 401 ? 'Access expired' : 'Permission denied');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
