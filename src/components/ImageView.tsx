import OpenSeadragon from 'openseadragon';
import { useEffect, useRef, useState } from 'react';
import type { ChannelSetting, Frame } from '../domain';
import { slicePixels } from '../domain';

type Props = {
  frame: Frame; channels: ChannelSetting[]; z: number; overlay: boolean;
  resetToken: number; label: string;
};

export function ImageView({ frame, channels, z, overlay, resetToken, label }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<OpenSeadragon.Viewer | null>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const v = OpenSeadragon({
      element: container.current, showNavigationControl: false, showNavigator: false,
      animationTime: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.2,
      minZoomImageRatio: 0.7, maxZoomPixelRatio: 12, visibilityRatio: 0.7,
      gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
    });
    viewer.current = v;
    const updateScale = () => {
      const item = v.world.getItemAt(0);
      if (item) setScale(item.viewportToImageZoom(v.viewport.getZoom()));
    };
    v.addHandler('animation', updateScale);
    v.addHandler('open', updateScale);
    v.addHandler('open-failed', () => setError('The 2D image could not be displayed.'));
    return () => { v.destroy(); viewer.current = null; };
  }, []);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const { pixels, width, height } = slicePixels(frame, channels, 'xy', z, overlay);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
    const bounds = v.world.getItemCount() ? v.viewport.getBounds() : null;
    v.addOnceHandler('open', () => {
      if (bounds) v.viewport.fitBounds(bounds, true);
    });
    v.open({ tileSource: { type: 'image', url: canvas.toDataURL(), buildPyramid: false } });
  }, [frame, channels, z, overlay]);
  useEffect(() => { viewer.current?.viewport.goHome(true); }, [resetToken, frame.asset.id]);
  const length = Math.min(180, 50 / frame.asset.spacingUm[2] * scale);
  return <div className="image-view" data-testid="image-view" data-asset={frame.asset.id}>
    <div className="osd" ref={container} role="img" aria-label={label} tabIndex={0} />
    <div className="image-zoom">
      <button onClick={() => viewer.current?.viewport.zoomBy(1.4)} aria-label="Zoom in">+</button>
      <button onClick={() => viewer.current?.viewport.zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
    </div>
    <div className="scale-bar"><span style={{ width: length }} />{(length / scale * frame.asset.spacingUm[2]).toFixed(0)} µm</div>
    {error && <div role="alert" className="viewer-message">{error}</div>}
  </div>;
}

export function Slice({ frame, channels, plane, index, overlay }: {
  frame: Frame; channels: ChannelSetting[]; plane: 'xy' | 'xz' | 'yz'; index: number; overlay: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { pixels, width, height } = slicePixels(frame, channels, plane, index, overlay);
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [frame, channels, plane, index, overlay]);
  const [, , nz, ny, nx] = frame.asset.shape;
  const [sz, sy, sx] = frame.asset.spacingUm;
  const ratio = plane === 'xy' ? nx * sx / (ny * sy) : plane === 'xz' ? nx * sx / (nz * sz) : ny * sy / (nz * sz);
  return <div className="slice">
    <span>{plane.toUpperCase()} <b>{index}</b></span>
    <canvas ref={ref} style={{ aspectRatio: ratio }} aria-label={`${plane.toUpperCase()} orthogonal slice ${index}`} />
    <small>{plane === 'xy' ? 'X / Y' : plane === 'xz' ? 'X / Z' : 'Y / Z'} · µm</small>
  </div>;
}
