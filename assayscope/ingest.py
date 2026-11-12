"""Prepare bounded, queryable image-derived analytical tables for Fabric's load API."""

import argparse
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .analysis import QCThresholds, qc_flags
from .assets import write_json
from .generator import ROOT, build, validate_catalog


def tables(catalog: dict) -> dict[str, list[dict]]:
    validate_catalog(catalog)
    experiment = catalog["experiment"]
    experiment_id = experiment["id"]
    measurements, qc, provenance = [], [], []
    for well in catalog["wells"]:
        m = well["measurements"]
        row = {
            "experiment_id": experiment_id, "well_id": well["id"], "well_name": well["well"],
            "run_id": well["runId"], "compound": well["compound"], "dose_um": float(well["doseUm"]),
            "replicate": well["replicate"], "is_control": well["control"], "measured": well["measured"],
            "source_image_id": well["image"]["id"],
            "object_count": m["objectCount"] if m else None,
            "median_area_um2": m["medianAreaUm2"] if m else None,
            "foreground_area_um2": m["foregroundAreaUm2"] if m else None,
            "mean_signal_adu": m["meanSignalAdu"] if m else None,
            "integrated_signal_adu": m["integratedSignalAdu"] if m else None,
            "spheroid_volume_um3": m["spheroidVolumeUm3"] if m else None,
            "focus_score": m["focusScore"] if m else None,
            "saturation_fraction": m["saturationFraction"] if m else None,
            "illumination_cv": m["illuminationCv"] if m else None,
            "synthetic": True,
            "code_version": catalog["provenance"]["codeVersion"],
        }
        measurements.append(row)
        qc.append({"experiment_id": experiment_id, "well_id": well["id"],
                   "flags_json": json.dumps(qc_flags(m, QCThresholds())),
                   "thresholds_json": json.dumps(QCThresholds().__dict__)})
        for asset in (well["image"], well["volume"]):
            if asset is None:
                continue
            provenance.append({
                "experiment_id": experiment_id, "well_id": well["id"], "image_id": asset["id"],
                "path": asset["path"], "sha256": asset["sha256"],
                "axes": asset["axes"], "shape_json": json.dumps(asset["shape"]),
                "voxel_um_json": json.dumps(asset["spacingUm"]),
                "times_hours_json": json.dumps(asset["timesHours"]),
                "code_version": catalog["provenance"]["codeVersion"],
                "analysis": catalog["provenance"]["analysis"],
                "parameters_json": json.dumps(catalog["provenance"]["parameters"]),
                "processed_at": catalog["provenance"]["processedAt"],
            })
    return {
        "assayscope_experiments": [{
            "id": experiment_id, "title": experiment["title"], "question": experiment["question"],
            "assay": experiment["assay"], "sample": experiment["sample"], "synthetic": True,
        }],
        "assayscope_acquisitions": [{"experiment_id": experiment_id, **run} for run in catalog["runs"]],
        "assayscope_measurements": measurements,
        "assayscope_qc": qc,
        "assayscope_provenance": provenance,
    }


def prepare(core: Path, out: Path):
    catalog = build(core)
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, rows in tables(catalog).items():
        path = out / f"{name}.parquet"
        pq.write_table(pa.Table.from_pylist(rows), path, compression="snappy")
        manifest.append({"table": name, "file": path.name, "rows": len(rows)})
    write_json(out / "tables.json", manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", type=Path, default=ROOT / "data" / "core")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "core" / "tables")
    args = parser.parse_args()
    result = prepare(args.core, args.out)
    print(json.dumps(result, indent=2))
