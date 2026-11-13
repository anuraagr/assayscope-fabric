"""Original deterministic synthetic microscopy; truth is written outside served data."""

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import jsonschema
import numpy as np
from scipy import ndimage as ndi
from skimage.segmentation import find_boundaries

from .analysis import ANALYSIS_VERSION, analyze_image, analyze_volume
from .assets import CHANNELS, write_asset, write_json

ROOT = Path(__file__).resolve().parents[1]
SEED = 20261112
DOSES = [0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0]
COMPOUNDS = ["Aster-17", "Beryl-04", "Cygnus-09"]
HERO_WELLS = ("B11", "F11", "G01")


def well_layout() -> list[dict]:
    result = []
    for index in range(96):
        well = f"{'ABCDEFGH'[index // 12]}{index % 12 + 1:02d}"
        if index < 72:
            compound = COMPOUNDS[index // 24]
            offset = index % 24
            dose, replicate = DOSES[offset % 8], offset // 8 + 1
        else:
            compound, dose, replicate = "Vehicle", 0.0, index - 71
        result.append({"well": well, "compound": compound, "doseUm": dose,
                       "replicate": replicate, "control": index >= 72})
    return result


def response(compound: str, dose: float) -> float:
    return 1 - 0.76 * dose / (dose + 1.4) if compound == "Aster-17" else 1.0


def cell_field(seed: int, response_factor: float = 1, batch: float = 1,
               artifact: str | None = None, size=160) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[:size, :size]
    nuclei = np.zeros((size, size), np.float32)
    structure = np.zeros_like(nuclei)
    reporter = np.zeros_like(nuclei)
    truth = np.zeros((size, size), np.uint16)
    count = 0
    for y in range(23, size - 20, 13):
        for x in range(23, size - 20, 13):
            if ((x - size / 2) / 61)**2 + ((y - size / 2) / 58)**2 > 1:
                continue
            cx, cy = x + rng.uniform(-2, 2), y + rng.uniform(-2, 2)
            sx, sy = rng.uniform(2.1, 3.0), rng.uniform(2.1, 3.2)
            d = ((xx - cx) / sx)**2 + ((yy - cy) / sy)**2
            core = np.exp(-0.5 * d)
            cell = np.exp(-d / 6)
            nuclei += core * rng.uniform(150, 205)
            structure += cell * rng.uniform(35, 54)
            reporter += core * rng.uniform(145, 190) * response_factor
            count += 1
            truth[d < 3.1] = count
    textures = ndi.gaussian_filter(rng.normal(0, 1, nuclei.shape), 0.7)
    channels = np.stack([nuclei, structure, reporter])
    channels *= batch
    channels += 7 + textures * 2
    channels += rng.normal(0, 1.1, channels.shape)
    channels = rng.poisson(np.maximum(channels, 0) * 4) / 4
    if artifact == "defocus":
        channels = ndi.gaussian_filter(channels, (0, 3.4, 3.4))
        channels[2] *= 0.27  # acquisition signal loss, not a biological response
    elif artifact == "saturation":
        channels[:, 55:100, 60:103] = 255
    elif artifact == "illumination":
        channels += np.linspace(0, 100, size)[None, None, :]
    return np.clip(channels, 0, 255).astype(np.uint8), truth


def spheroid(seed: int, response_factor=1, batch=1, artifact=None):
    rng = np.random.default_rng(seed)
    shape = (64, 112, 112)
    zz, yy, xx = np.mgrid[:shape[0], :shape[1], :shape[2]].astype(np.float32)
    center = np.array([31.5, 55.5, 55.5])
    radii = np.array([25, 45, 45])
    centers = []
    for z in range(10, 57, 6):
        for y in range(14, 102, 9):
            for x in range(14, 102, 9):
                position = np.array([z, y, x]) + rng.uniform(-2.4, 2.4, 3)
                if np.sum(((position - center) / radii)**2) < 0.88:
                    sizes = np.array([rng.uniform(1.0, 1.5), rng.uniform(1.6, 2.6),
                                      rng.uniform(1.6, 2.6)])
                    centers.append((position, sizes, rng.uniform(0.7, 1.3)))
    raw_frames, truth_masks = [], []
    for t in range(6):
        fraction = t / 5
        # A small morphology shift is rendered and measured; this is not inferred viability.
        scale = 1 - 0.10 * (1 - response_factor) * fraction
        ellipsoid = (((zz - center[0]) / (radii[0] * scale))**2
                     + ((yy - center[1]) / (radii[1] * scale))**2
                     + ((xx - center[2]) / (radii[2] * scale))**2)
        envelope = 1 / (1 + np.exp(np.clip((ellipsoid - 1) * 30, -40, 40)))
        channels = np.zeros((3, *shape), np.float32)
        channels[1] = envelope * 36
        for pos, sizes, expression in centers:
            pz, py, px = center + (pos - center) * scale
            pz += 0.4 * np.sin(fraction * 2 + px)
            iz, iy, ix = np.round([pz, py, px]).astype(int)
            z0, z1 = max(0, iz - 4), min(shape[0], iz + 5)
            y0, y1 = max(0, iy - 6), min(shape[1], iy + 7)
            x0, x1 = max(0, ix - 6), min(shape[2], ix + 7)
            region = np.s_[z0:z1, y0:y1, x0:x1]
            d = ((zz[region] - pz) / sizes[0])**2 + ((yy[region] - py) / sizes[1])**2 \
                + ((xx[region] - px) / sizes[2])**2
            core = np.exp(-d / 2)
            channels[0][region] += core * 200
            channels[1][region] += np.exp(-d / 5) * 45
            reporter = np.maximum(np.exp(-d / 4.5) - 0.65 * core, 0)
            channels[2][region] += reporter * 185 * expression * (1 - fraction * (1 - response_factor))
        texture = ndi.gaussian_filter(rng.normal(0, 1, shape), 0.6)
        channels += envelope * texture * 12 + rng.normal(0, 1.2, channels.shape) + 2
        channels *= batch
        if artifact == "defocus":
            channels = ndi.gaussian_filter(channels, (0, 1.7, 3.2, 3.2))
            channels[2] *= 1 - 0.70 * fraction
        raw_frames.append(np.clip(channels, 0, 255).astype(np.uint8))
        truth_masks.append(ellipsoid <= 1)
    return np.stack(raw_frames), np.stack(truth_masks)


def build(root: Path, force=False) -> dict:
    catalog_path = root / "catalog.json"
    if catalog_path.exists() and not force:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        validate_catalog(catalog)
        return catalog
    started = time.perf_counter()
    root.mkdir(parents=True, exist_ok=True)
    truth_dir = root.parent / "private-truth"
    truth_dir.mkdir(parents=True, exist_ok=True)
    wells, truth_records = [], []
    for run in (1, 2):
        batch = (1.0, 1.065)[run - 1]
        for index, layout in enumerate(well_layout()):
            seed = SEED + run * 1000 + index
            artifact = None
            if layout["compound"] == "Cygnus-09" and layout["doseUm"] >= 3:
                artifact = "defocus"
            elif layout["well"] == "H11":
                artifact = "saturation"
            elif layout["well"] == "H12":
                artifact = "illumination"
            factor = response(layout["compound"], layout["doseUm"])
            image, truth = cell_field(seed, factor, batch, artifact)
            identifier = f"run{run}-{layout['well']}"
            asset = write_asset(root, identifier, image[None, :, None], (3, 1.5, 1.5), [48])
            metrics, labels = analyze_image(image)
            label_path = root / "labels" / f"{identifier}-0.bin"
            label_path.parent.mkdir(parents=True, exist_ok=True)
            label_path.write_bytes(find_boundaries(labels, mode="inner").astype(np.uint8).tobytes())
            np.savez_compressed(truth_dir / f"{identifier}.npz", nuclei=truth)
            volume = None
            if layout["well"] in HERO_WELLS:
                frames, masks = spheroid(seed, factor, batch, artifact)
                volume = write_asset(
                    root, f"{identifier}-volume", frames, (3, 1.5, 1.5),
                    [0, 9.6, 19.2, 28.8, 38.4, 48], write_ngff=True,
                )
                volume_metrics = []
                for t, frame in enumerate(frames):
                    size, mask = analyze_volume(frame, (3, 1.5, 1.5))
                    volume_metrics.append({"timeHours": volume["timesHours"][t],
                                           "spheroidVolumeUm3": size})
                    (root / "labels" / f"{identifier}-volume-{t}.bin").write_bytes(
                        find_boundaries(mask, mode="inner").astype(np.uint8).tobytes()
                    )
                metrics["spheroidVolumeUm3"] = volume_metrics[-1]["spheroidVolumeUm3"]
                write_json(root / "volume-measurements" / f"{identifier}.json", volume_metrics)
                np.savez_compressed(truth_dir / f"{identifier}-volume.npz", mask=masks)
            wells.append({
                **layout, "id": identifier, "runId": f"run{run}", "measured": True,
                "image": asset, "volume": volume, "measurements": metrics,
            })
            truth_records.append({"id": identifier, "artifact": artifact,
                                  "responseFactor": factor, "nucleiCount": int(truth.max())})
    source_files = sorted(Path(__file__).parent.glob("*.py"))
    code_hash = hashlib.sha256(b"".join(p.read_bytes() for p in source_files)).hexdigest()
    catalog = {
        "schemaVersion": "1.0",
        "experiment": {
            "id": "spheroid-screen-001", "title": "Synthetic spheroid screening experiment",
            "question": "How does acquisition quality affect the measured reporter response?",
            "summary": "Three fictional compounds, eight concentrations and three technical replicates per concentration, acquired in two simulated runs.",
            "assay": "High-content spheroid screen", "sample": "Synthetic cell-line-like spheroids",
            "disclosure": "Simulated screening experiment. Fictional compounds and acquisition metadata. Research only.",
            "seed": SEED,
        },
        "channels": CHANNELS,
        "runs": [
            {"id": f"run{r}", "label": f"Acquisition {r:02d}",
             "instrument": f"Simulated imager {'A' if r == 1 else 'B'}",
             "acquiredAt": f"2026-10-{12 + r:02d}T09:00:00Z", "synthetic": True}
            for r in (1, 2)
        ],
        "wells": wells,
        "provenance": {
            "generator": "spheroid-1", "analysis": ANALYSIS_VERSION,
            "codeVersion": f"0.1.0+sha256:{code_hash}",
            "processedAt": datetime.now(timezone.utc).isoformat(),
            "parameters": {
                "seed": SEED, "segmentation": "Gaussian sigma 0.65; Otsu floor 28; min 9 px; distance watershed min distance 3 px",
                "background": "10th percentile of reporter; subtract and clamp at zero",
                "volume": "Largest component of structure >30 after Gaussian sigma 1; fill holes",
                "replicates": "3 technical wells per compound/dose/run; runs are not biological replicates",
                "intensity": "uint8 ADU, fixed display 0..255; no per-image autoscaling",
                "screenTimeHours": 48,
            },
            "citations": [
                "Original seeded simulation, AssayScope contributors, MIT.",
                "https://scikit-image.org/docs/0.25.x/auto_examples/segmentation/plot_watershed.html",
                "https://ngff.openmicroscopy.org/0.4/",
            ],
        },
    }
    validate_catalog(catalog)
    write_json(truth_dir / "truth.json", truth_records)
    write_json(catalog_path, catalog)
    write_json(root / "generation.json", {
        "seconds": time.perf_counter() - started,
        "bytes": sum(p.stat().st_size for p in root.rglob("*") if p.is_file()),
    })
    return catalog


def validate_catalog(catalog: dict):
    schema = json.loads((ROOT / "contracts" / "catalog.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker()).validate(catalog)
    ids = set()
    for well in catalog["wells"]:
        if well["id"] in ids:
            raise ValueError(f"Duplicate acquisition/well ID: {well['id']}")
        ids.add(well["id"])
        for asset in (well["image"], well["volume"]):
            if asset is None:
                continue
            if asset["shape"][0] != len(asset["timesHours"]):
                raise ValueError("Time coordinates do not match array dimension.")
            if asset["shape"][0] != len(asset["frameHashes"]):
                raise ValueError("Frame checksums do not match array dimension.")
            if asset["shape"][1] != len(catalog["channels"]):
                raise ValueError("Channel metadata does not match array dimension.")
            if ".." in asset["path"].split("/") or asset["path"].startswith("/"):
                raise ValueError("Asset path must be relative and cannot traverse.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "core")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    build(args.out, force=args.force)
