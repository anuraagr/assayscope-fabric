"""Convert authorized OME-TIFF/OME-Zarr inputs without inventing screening metadata."""

import argparse
import csv
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import tifffile
import zarr
from skimage.measure import block_reduce

from .assets import read_tczyx, sha256, write_asset, write_json

REQUIRED = {
    "image_id", "file", "channel_names_json", "spacing_z_um", "spacing_y_um",
    "spacing_x_um", "timepoints_hours_json", "acquisition_id", "source_rights",
}


def convert(images: Path, metadata: Path, destination: Path):
    images = images.resolve()
    with metadata.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not REQUIRED.issubset(reader.fieldnames or []):
            raise ValueError(f"CSV requires: {', '.join(sorted(REQUIRED))}")
        rows = list(reader)
    if not 1 <= len(rows) <= 24:
        raise ValueError("Select between 1 and 24 specific images, not an unrestricted collection.")
    records, ids = [], set()
    for row in rows:
        identifier = row["image_id"]
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", identifier) or identifier in ids:
            raise ValueError("Image IDs must be unique, bounded identifiers.")
        ids.add(identifier)
        if not row["source_rights"].strip():
            raise ValueError("Record data rights before importing.")
        path = (images / row["file"]).resolve()
        if not path.is_relative_to(images):
            raise ValueError("Image path leaves the explicitly supplied source directory.")
        if (destination / "images" / f"{identifier}.ome.tif").exists():
            raise ValueError("A derivative with this ID already exists. Use a new output directory; originals are not overwritten.")
        names = json.loads(row["channel_names_json"])
        times = json.loads(row["timepoints_hours_json"])
        spacing = tuple(float(row[f"spacing_{axis}_um"]) for axis in "zyx")
        if len(names) < 1 or len(names) > 3 or not all(isinstance(n, str) and n for n in names):
            raise ValueError("This bounded adapter supports 1-3 explicitly named channels.")
        if min(spacing) <= 0 or not np.isfinite(spacing).all():
            raise ValueError("Positive, finite micrometer voxel spacing is required.")
        if path.is_dir() and path.name.endswith(".zarr"):
            group = zarr.open_group(str(path), mode="r")
            multi = group.attrs.get("multiscales", [{}])[0]
            if multi.get("version") != "0.4":
                raise ValueError("The pinned importer supports NGFF 0.4 / Zarr v2 only.")
            axes = "".join(a["name"].upper() for a in multi["axes"])
            if axes != "TCZYX":
                raise ValueError("Normalize the OME-Zarr axes to TCZYX before import.")
            source = group[multi["datasets"][0]["path"]]
            transform = multi["datasets"][0]["coordinateTransformations"]
            scale = next((t["scale"] for t in transform if t["type"] == "scale"), None)
            if scale is None or not np.allclose(scale[2:], spacing):
                raise ValueError("CSV voxel spacing disagrees with source NGFF metadata.")
            if any(a.get("unit") != "micrometer" for a in multi["axes"][2:]):
                raise ValueError("Convert source NGFF spatial units explicitly to micrometers.")
            if source.nbytes > 512 * 1024**2:
                raise ValueError("Source exceeds the 512 MiB decoded bound. Select a smaller reviewed ROI.")
            data = source[:]
            source_hash = None
            source_provenance = "OME-Zarr directory; derivative and frame SHA-256 recorded. Preserve the source store separately."
        elif path.name.endswith((".ome.tif", ".ome.tiff")):
            with tifffile.TiffFile(path) as tif:
                if not tif.ome_metadata:
                    raise ValueError("OME metadata is required; proprietary formats need an explicit conversion.")
                if tif.series[0].size * tif.series[0].dtype.itemsize > 512 * 1024**2:
                    raise ValueError("Source exceeds the 512 MiB decoded bound. Select a smaller reviewed ROI.")
                pixels = ET.fromstring(tif.ome_metadata).find(".//{*}Pixels")
                if pixels is None:
                    raise ValueError("OME Pixels metadata is missing.")
                for axis, declared in zip("ZYX", spacing, strict=True):
                    source_size = pixels.get(f"PhysicalSize{axis}")
                    unit = pixels.get(f"PhysicalSize{axis}Unit", "\u00b5m")
                    if source_size is not None and (
                        unit not in ("\u00b5m", "micrometer") or not np.isclose(float(source_size), declared)
                    ):
                        raise ValueError("CSV voxel spacing disagrees with source OME metadata.")
            data, _ = read_tczyx(path)
            source_hash, source_provenance = sha256(path), "Original OME-TIFF preserved without modification."
        else:
            raise ValueError("Only OME-TIFF and NGFF 0.4 OME-Zarr inputs are supported.")
        if data.shape[1] != len(names) or data.shape[0] != len(times) or data.shape[0] > 6:
            raise ValueError("Channel/time metadata disagrees with dimensions, or exceeds six timepoints.")
        if not all(isinstance(t, (int, float)) and np.isfinite(t) and t >= 0 for t in times) or times != sorted(set(times)):
            raise ValueError("Time coordinates must be finite, increasing, unique hours.")
        if len(times) > 2 and not np.allclose(np.diff(times), np.diff(times)[0]):
            raise ValueError("This OME derivative writer requires regular time intervals; do not invent missing frames.")
        if data.dtype not in (np.uint8, np.uint16) or not np.isfinite(data).all():
            raise ValueError("Review and explicitly convert non-uint8/uint16 data first.")
        factors = tuple(max(1, int(np.ceil(d / maximum))) for d, maximum in zip(data.shape[2:], (64, 112, 112), strict=True))
        if any(d % f for d, f in zip(data.shape[2:], factors, strict=True)):
            raise ValueError("Dimensions must be divisible by the bounded block-mean factors; select an explicit ROI first.")
        downsampled = block_reduce(data, (1, 1, *factors), np.mean)
        # A fixed dtype-wide mapping, not per-image stretching or a biological analysis.
        upper = np.iinfo(data.dtype).max
        derived = np.clip(np.rint(downsampled * 255 / upper), 0, 255).astype(np.uint8)
        new_spacing = tuple(s * f for s, f in zip(spacing, factors, strict=True))
        asset = write_asset(destination, identifier, derived, new_spacing, times, names, write_ngff=True)
        records.append({
            "asset": asset, "sourceKind": "tenant-owned-unconnected", "sourceSha256": source_hash,
            "sourceFile": row["file"], "sourceRights": row["source_rights"],
            "sourceProvenance": source_provenance, "acquisitionId": row["acquisition_id"],
            "channels": names, "sourceShape": list(data.shape), "sourceSpacingUm": spacing,
            "transform": {"blockMeanZYX": factors, "dtypeMaximumTo255": int(upper)},
            "analysis": "Not performed. Do not apply synthetic QC thresholds or response semantics without validation.",
        })
    write_json(destination / "import-manifest.json", {
        "mode": "Tenant-owned import, not connected or published", "images": records,
        "metadataCsvSha256": sha256(metadata),
    })
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = convert(args.images, args.metadata, args.out)
    print(f"Converted {len(result)} authorized input(s). No screening labels inferred; nothing uploaded.")
