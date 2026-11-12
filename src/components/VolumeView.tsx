import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import { useEffect, useRef, useState } from 'react';
import type { CameraPose, ChannelSetting, Frame } from '../domain';
import { colorRgb } from '../domain';

type Scene = {
  window: ReturnType<typeof vtkGenericRenderWindow.newInstance>;
  image: ReturnType<typeof vtkImageData.newInstance>;
  volume: ReturnType<typeof vtkVolume.newInstance>;
  mapper: ReturnType<typeof vtkVolumeMapper.newInstance>;
  clip: ReturnType<typeof vtkPlane.newInstance>;
};

export default function VolumeView({ frame, channels, clip, resetToken, pose, onPose, label, name }: {
  frame: Frame; channels: ChannelSetting[]; clip: number; resetToken: number;
  pose: CameraPose | null; onPose: (pose: CameraPose) => void; label: string; name: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const callback = useRef(onPose);
  callback.current = onPose;
  const applying = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const shapeKey = frame.asset.shape.slice(1).join(',');
  const spacingKey = frame.asset.spacingUm.join(',');

  useEffect(() => {
    if (!container.current) return;
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) {
      setError('WebGL 2 is unavailable. Use 2D images and orthogonal slices; volumetric rendering requires WebGL 2.');
      return;
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const window = vtkGenericRenderWindow.newInstance({ background: [0.027, 0.051, 0.09], listenWindowResize: false });
    window.setContainer(container.current);
    const renderer = window.getRenderer();
    const image = vtkImageData.newInstance();
    const dimensions = shapeKey.split(',').map(Number);
    const spacing = spacingKey.split(',').map(Number);
    image.setDimensions(dimensions[3], dimensions[2], dimensions[1]);
    image.setSpacing([spacing[2], spacing[1], spacing[0]]);
    const mapper = vtkVolumeMapper.newInstance();
    mapper.setInputData(image);
    mapper.setSampleDistance(Math.min(...spacing) * 0.85);
    mapper.setMaximumSamplesPerRay(512);
    mapper.setAutoAdjustSampleDistances(true);
    const volume = vtkVolume.newInstance();
    volume.setMapper(mapper);
    volume.setVisibility(false);
    volume.getProperty().setIndependentComponents(true);
    volume.getProperty().setInterpolationTypeToLinear();
    volume.getProperty().setShade(false);
    const plane = vtkPlane.newInstance({ normal: [-1, 0, 0] });
    mapper.addClippingPlane(plane);
    renderer.addVolume(volume);
    scene.current = { window, image, volume, mapper, clip: plane };
    const observer = new ResizeObserver(() => window.resize());
    observer.observe(container.current);
    window.resize();
    const camera = renderer.getActiveCamera();
    const subscription = window.getInteractor().onEndAnimation(() => {
      if (applying.current) return;
      if (container.current) container.current.dataset.camera = JSON.stringify(camera.getPosition());
      callback.current({
        position: [...camera.getPosition()], focalPoint: [...camera.getFocalPoint()],
        viewUp: [...camera.getViewUp()], parallelScale: camera.getParallelScale(), source: name,
      });
    });
    const renderSubscription = window.getInteractor().onRenderEvent(() => {
      if (container.current) {
        container.current.dataset.renderCount = String(Number(container.current.dataset.renderCount ?? 0) + 1);
        container.current.dataset.lastRender = String(performance.now());
      }
    });
    const canvas = container.current.querySelector('canvas');
    const lost = (event: Event) => {
      event.preventDefault();
      setError('The WebGL context was lost. Switch to 2D or reload this view.');
    };
    canvas?.addEventListener('webglcontextlost', lost);
    return () => {
      observer.disconnect(); subscription.unsubscribe(); renderSubscription.unsubscribe();
      canvas?.removeEventListener('webglcontextlost', lost);
      window.delete(); image.delete(); volume.delete(); mapper.delete(); plane.delete();
      scene.current = null;
    };
  }, [shapeKey, spacingKey, name]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const count = frame.asset.shape[1];
    let values = frame.values;
    const withLabels = Boolean(frame.labels);
    if (frame.labels && count === 3) {
      values = new Uint8Array(frame.labels.length * 4);
      for (let i = 0; i < frame.labels.length; i++) {
        values.set(frame.values.subarray(i * 3, i * 3 + 3), i * 4);
        values[i * 4 + 3] = frame.labels[i] * 255;
      }
    }
    s.image.getPointData().setScalars(vtkDataArray.newInstance({
      name: 'Fluorescence', numberOfComponents: withLabels ? count + 1 : count, values,
    }));
    s.image.modified();
    s.volume.setVisibility(true);
    const settings = withLabels
      ? [...channels, { visible: true, color: '#ffd282', low: 0, high: 255 }]
      : channels;
    const functions: { delete: () => void }[] = [];
    settings.forEach((setting, index) => {
      const rgb = colorRgb(setting.color).map(n => n / 255);
      const color = vtkColorTransferFunction.newInstance();
      color.addRGBPoint(setting.low, 0, 0, 0);
      color.addRGBPoint(setting.high, rgb[0], rgb[1], rgb[2]);
      const opacity = vtkPiecewiseFunction.newInstance();
      const floor = Math.max(setting.low, index === 1 ? 26 : 12);
      opacity.addPoint(0, 0);
      opacity.addPoint(floor, 0);
      opacity.addPoint(Math.max(floor + 1, setting.high), index === 1 ? 0.045 : 0.5);
      s.volume.getProperty().setRGBTransferFunction(index, color);
      s.volume.getProperty().setScalarOpacity(index, opacity);
      s.volume.getProperty().setScalarOpacityUnitDistance(index, 2.3);
      s.volume.getProperty().setComponentWeight(index, setting.visible ? [1.0, 0.45, 0.9, 0.65][index] : 0);
      functions.push(color, opacity);
    });
    s.window.getRenderWindow().render();
    setReady(true);
    if (!performance.getEntriesByName('assayscope-volume-ready').length)
      performance.mark('assayscope-volume-ready');
    return () => functions.forEach(f => f.delete());
  }, [frame, channels]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const maxX = (frame.asset.shape[4] - 1) * frame.asset.spacingUm[2];
    s.clip.setOrigin(clip >= 100 ? maxX + 1 : maxX * clip / 100, 0, 0);
    s.window.getRenderWindow().render();
  }, [clip, frame.asset]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const renderer = s.window.getRenderer();
    const center = s.image.getCenter();
    const camera = renderer.getActiveCamera();
    camera.setFocalPoint(...center);
    camera.setPosition(center[0] + 230, center[1] - 280, center[2] + 180);
    camera.setViewUp(0, 0, 1);
    renderer.resetCamera();
    camera.zoom(1.8);
    if (container.current) container.current.dataset.camera = JSON.stringify(camera.getPosition());
    renderer.resetCameraClippingRange();
    s.window.getRenderWindow().render();
  }, [shapeKey, resetToken]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !pose || pose.source === name) return;
    applying.current = true;
    const camera = s.window.getRenderer().getActiveCamera();
    camera.setPosition(...pose.position); camera.setFocalPoint(...pose.focalPoint);
    camera.setViewUp(...pose.viewUp); camera.setParallelScale(pose.parallelScale);
    s.window.getRenderer().resetCameraClippingRange();
    s.window.getRenderWindow().render();
    if (container.current) container.current.dataset.camera = JSON.stringify(camera.getPosition());
    applying.current = false;
  }, [pose, name]);

  return <div className="volume-view" data-testid={`volume-${name}`} data-frame={frame.time}
    data-asset={frame.asset.id} data-ready={ready && !error ? 'true' : 'false'}>
    <div ref={container} className="vtk" role="img" aria-label={label} />
    {error && <div role="alert" className="viewer-message">{error}</div>}
    <div className="volume-axis" aria-hidden="true"><i>Z</i><b>Y</b><span>X</span></div>
    <small className="canvas-instructions">Drag to orbit · scroll to zoom · coordinates in µm</small>
  </div>;
}
