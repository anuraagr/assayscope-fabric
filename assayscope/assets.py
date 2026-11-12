import hashlib
import json
import uuid
from pathlib import Path

import numpy as np
import tifffile
import zarr
from numcodecs import Blosc
from ome_zarr.writer import write_image

CHANNELS = [
    {"id": "nuclei", "name": "Nuclei", "color": "#60d8ed",
     "meaning": "Simulated nuclear stain; object count is not viability."},
    {"id": "structure", "name": "Structure", "color": "#58d4bd",
     "meaning": "Simulated structural fluorescence; a morphology proxy."},
    {"id": "reporter", "name": "Reporter", "color": "#ee8ccb",
     "meaning": "Simulated response reporter; not apoptosis, toxicity or efficacy."},
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def write_asset(root: Path, asset_id: str, data: np.ndarray, spacing, times,
                channel_names=None, write_ngff=False) -> dict:
    if data.ndim != 5 or data.dtype != np.uint8:
        raise ValueError("Browser derivatives must be uint8 TCZYX.")
    if len(times) != data.shape[0] or len(spacing) != 3 or min(spacing) <= 0:
        raise ValueError("Asset dimensions and physical metadata disagree.")
    dest = root / "images" / f"{asset_id}.ome.tif"
    dest.parent.mkdir(parents=True, exist_ok=True)
    names = channel_names or [c["name"] for c in CHANNELS]
    metadata = {
        "UUID": f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, asset_id + hashlib.sha256(data.tobytes()).hexdigest())}",
        "Creator": "AssayScope 0.1.0",
        "axes": "TCZYX", "PhysicalSizeX": spacing[2], "PhysicalSizeY": spacing[1],
        "PhysicalSizeZ": spacing[0], "PhysicalSizeXUnit": "\u00b5m",
        "PhysicalSizeYUnit": "\u00b5m", "PhysicalSizeZUnit": "\u00b5m",
        "Channel": {"Name": names},
        "Plane": {
            "DeltaT": [float(times[t]) for t in range(data.shape[0])
                       for _ in range(data.shape[1] * data.shape[2])],
            "DeltaTUnit": ["h"] * (data.shape[0] * data.shape[1] * data.shape[2]),
        },
    }
    if len(times) > 1:
        metadata["TimeIncrement"] = times[1] - times[0]
        metadata["TimeIncrementUnit"] = "h"
    tifffile.imwrite(dest, data, ome=True, photometric="minisblack",
                     compression="deflate", metadata=metadata)
    frame_hashes = []
    for t, frame in enumerate(data):
        interleaved = np.ascontiguousarray(frame.transpose(1, 2, 3, 0))
        raw = interleaved.tobytes()
        frame_hashes.append(hashlib.sha256(raw).hexdigest())
        path = root / "frames" / f"{asset_id}-{t}.bin"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    if write_ngff:
        group = zarr.open_group(str(root / "ngff" / f"{asset_id}.ome.zarr"), mode="w")
        axes = [
            {"name": "t", "type": "time", "unit": "hour"},
            {"name": "c", "type": "channel"},
            *[{"name": d, "type": "space", "unit": "micrometer"} for d in ("z", "y", "x")],
        ]
        dt = times[1] - times[0] if len(times) > 1 else 1
        transformations = [
            [{"type": "scale", "scale": [dt, 1, spacing[0], spacing[1] * 2**i,
                                       spacing[2] * 2**i]}]
            + ([{"type": "translation", "translation": [times[0], 0, 0, 0, 0]}] if times[0] else [])
            for i in range(3)
        ]
        from ome_zarr.scale import Scaler

        write_image(
            data, group, axes=axes, scaler=Scaler(max_layer=2),
            coordinate_transformations=transformations,
            storage_options={"chunks": (1, 1, min(16, data.shape[2]), 64, 64),
                             "compressor": Blosc(cname="zstd", clevel=5, shuffle=Blosc.SHUFFLE)},
        )
        group.attrs["omero"] = {
            "channels": [{"label": name, "color": CHANNELS[i % 3]["color"][1:],
                          "window": {"start": 0, "end": 255, "min": 0, "max": 255}}
                         for i, name in enumerate(names)]
        }
    return {
        "id": asset_id, "path": dest.relative_to(root).as_posix(), "sha256": sha256(dest),
        "axes": "TCZYX", "shape": list(data.shape), "spacingUm": list(spacing),
        "timesHours": times, "bytes": dest.stat().st_size, "frameHashes": frame_hashes,
    }


def read_tczyx(path: Path) -> tuple[np.ndarray, dict]:
    with tifffile.TiffFile(path) as tif:
        series = tif.series[0]
        data, axes = series.asarray(), series.axes
        metadata = {"axes": axes, "ome": tif.ome_metadata, "imagej": tif.imagej_metadata}
    for axis in axes:
        if axis not in "TCZYX":
            raise ValueError(f"Unsupported source axis {axis}; provide an explicit conversion.")
    for axis in "TCZYX":
        if axis not in axes:
            data = np.expand_dims(data, 0)
            axes = axis + axes
    return data.transpose([axes.index(axis) for axis in "TCZYX"]), metadata
