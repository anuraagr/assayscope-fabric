"""Summarize QC sensitivity and technical replication without changing source data."""

import argparse
import csv
import hashlib
import html
import json
import math
import re
from dataclasses import asdict
from pathlib import Path

import numpy as np

from assayscope.analysis import QCThresholds, qc_flags, summarize

TABLE_NAMES = (
    "assayscope_experiments", "assayscope_acquisitions", "assayscope_measurements",
    "assayscope_qc", "assayscope_provenance",
)
MAX_ROWS = 10000
CSV_FIELDS = {
    "runs": (
        "run_id", "total_wells", "included_wells", "excluded_wells", "unmeasured_wells",
        "included_control_wells", "control_median_adu", "control_mean_adu", "control_sd_adu",
        "control_cv_percent", "normalization",
    ),
    "conditions": (
        "run_id", "compound", "dose_um", "measured_technical_wells", "included_technical_wells",
        "estimable_n", "all_measured_mean_percent", "included_mean_percent", "included_sd_percent",
        "change_percentage_points", "included_well_ids",
    ),
    "well_evidence": (
        "run_id", "well_id", "well_name", "compound", "dose_um", "control", "measured", "included",
        "flags", "integrated_signal_adu", "normalized_percent", "source_image_id", "source_path",
        "source_sha256",
    ),
}
METRICS = {
    "objectCount": "object_count", "medianAreaUm2": "median_area_um2",
    "foregroundAreaUm2": "foreground_area_um2", "meanSignalAdu": "mean_signal_adu",
    "integratedSignalAdu": "integrated_signal_adu", "spheroidVolumeUm3": "spheroid_volume_um3",
    "focusScore": "focus_score", "saturationFraction": "saturation_fraction",
    "illuminationCv": "illumination_cv",
}


def _text(value, label, maximum=256):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{label} must be nonempty text of at most {maximum} characters.")
    return value


def _number(value, label, optional=False):
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite, nonnegative number.")
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{label} must be a finite, nonnegative number.")
    return value


def _index(rows, keys, label):
    result = {}
    for row in rows:
        key = tuple(_text(row.get(k), f"{label}.{k}") for k in keys)
        if key in result:
            raise ValueError(f"Duplicate {label} identity: {key}.")
        result[key] = row
    return result


def validate_tables(tables, experiment_id):
    """Fail on partial joins, mixed experiments, stale QC or inconsistent provenance."""
    for name in TABLE_NAMES:
        rows = tables.get(name)
        if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
            raise ValueError(f"{name} must contain 1..{MAX_ROWS} rows.")
        if not all(isinstance(row, dict) for row in rows):
            raise ValueError(f"{name} contains a non-record value.")
        for row in rows:
            key = "id" if name == "assayscope_experiments" else "experiment_id"
            if row.get(key) != experiment_id:
                raise ValueError("Mixed or unexpected experiment identity; no pooling is allowed.")
    experiments = tables["assayscope_experiments"]
    if len(experiments) != 1 or experiments[0].get("synthetic") is not True:
        raise ValueError("This review is configured only for the explicitly simulated assay.")
    _text(experiments[0].get("title"), "experiment.title")
    runs = _index(tables["assayscope_acquisitions"], ("id",), "acquisition")
    measurements = _index(tables["assayscope_measurements"], ("well_id",), "measurement")
    quality = _index(tables["assayscope_qc"], ("well_id",), "QC")
    sources = _index(tables["assayscope_provenance"], ("well_id", "image_id"), "source")
    if measurements.keys() != quality.keys():
        raise ValueError("Measurement and QC well identities do not match.")
    versions = set()
    recorded_thresholds = None
    wells = []
    for key, row in measurements.items():
        if (row.get("run_id"),) not in runs:
            raise ValueError("A measurement refers to an unknown acquisition.")
        if row.get("synthetic") is not True:
            raise ValueError("Real or unspecified-origin measurements cannot enter this review.")
        if type(row.get("measured")) is not bool or type(row.get("is_control")) is not bool:
            raise ValueError("Measurement/control indicators must be actual booleans.")
        _text(row.get("well_name"), "measurement.well_name", 40)
        _text(row.get("compound"), "measurement.compound")
        _number(row.get("dose_um"), "measurement.dose_um")
        if type(row.get("replicate")) is not int or row["replicate"] < 1:
            raise ValueError("Technical replicate identifiers must be positive integers.")
        version = _text(row.get("code_version"), "measurement.code_version")
        versions.add(version)
        metrics = None
        if row["measured"]:
            metrics = {
                name: _number(row.get(column), column,
                              optional=name in ("medianAreaUm2", "meanSignalAdu", "spheroidVolumeUm3"))
                for name, column in METRICS.items()
            }
            if type(metrics["objectCount"]) is not int or metrics["saturationFraction"] > 1:
                raise ValueError("Object count must be an integer and saturation a fraction.")
        elif any(row.get(column) is not None for column in METRICS.values()):
            raise ValueError("An unmeasured well cannot carry measured values.")
        source = sources.get((key[0], row.get("source_image_id")))
        if source is None or source.get("code_version") != version:
            raise ValueError("Source image/provenance is missing or has a different code version.")
        baseline = json.loads(quality[key]["thresholds_json"])
        if not isinstance(baseline, dict) or set(baseline) != set(asdict(QCThresholds())):
            raise ValueError("Recorded QC thresholds do not match the analytical contract.")
        for name, value in baseline.items():
            _number(value, f"QC.{name}")
        if type(baseline["objectCountMin"]) is not int:
            raise ValueError("QC object-count threshold must be an integer.")
        baseline = QCThresholds(**baseline)
        if recorded_thresholds is None:
            recorded_thresholds = baseline
        if baseline != recorded_thresholds:
            raise ValueError("Recorded QC thresholds differ within this experiment.")
        if json.loads(quality[key]["flags_json"]) != qc_flags(metrics, baseline):
            raise ValueError("Stored QC flags disagree with the original measurements and thresholds.")
        wells.append({
            "id": key[0], "well": row["well_name"], "runId": row["run_id"],
            "compound": row["compound"], "doseUm": row["dose_um"], "replicate": row["replicate"],
            "control": row["is_control"], "measured": row["measured"], "measurements": metrics,
        })
    if len(versions) != 1:
        raise ValueError("Measurements contain mixed processing code versions.")
    for (well_id, _), source in sources.items():
        if (well_id,) not in measurements or source.get("code_version") not in versions:
            raise ValueError("Orphan or stale provenance row.")
        if not re.fullmatch(r"[a-fA-F0-9]{64}", str(source.get("sha256", ""))):
            raise ValueError("Source provenance requires a SHA-256.")
        path = _text(source.get("path"), "source.path", 512)
        if not re.fullmatch(r"images/[a-zA-Z0-9_-]+\.ome\.tif", path):
            raise ValueError("Source paths must stay inside the canonical image directory.")
    if {w["runId"] for w in wells} != {key[0] for key in runs}:
        raise ValueError("An acquisition has no measurement records.")
    wells.sort(key=lambda well: (well["runId"], well["id"]))
    return wells, recorded_thresholds, next(iter(versions))


def review_tables(tables, experiment_id="spheroid-screen-001", thresholds=None):
    wells, baseline, code_version = validate_tables(tables, experiment_id)
    thresholds = thresholds or baseline
    if not isinstance(thresholds, QCThresholds):
        raise ValueError("Supply validated QCThresholds, not an unvalidated mapping.")
    runs, conditions, evidence = [], [], []
    acquisitions = {row["id"]: row for row in tables["assayscope_acquisitions"]}
    measurements = {row["well_id"]: row for row in tables["assayscope_measurements"]}
    sources = {(row["well_id"], row["image_id"]): row for row in tables["assayscope_provenance"]}
    for run_id in sorted(acquisitions):
        members = [w for w in wells if w["runId"] == run_id]
        before = summarize(members, thresholds, exclude_qc=False)
        after = summarize(members, thresholds, exclude_qc=True)
        controls = [
            w["measurements"]["integratedSignalAdu"] for w in members
            if w["control"] and w["measured"] and w["id"] not in after["excluded"]
        ]
        mean = float(np.mean(controls)) if controls else None
        sd = float(np.std(controls, ddof=1)) if len(controls) > 1 else None
        runs.append({
            "run_id": run_id, "total_wells": len(members), "included_wells": after["included"],
            "excluded_wells": len(after["excluded"]), "unmeasured_wells": after["unmeasured"],
            "included_control_wells": after["controlN"], "control_median_adu": after["controlMedian"],
            "control_mean_adu": mean, "control_sd_adu": sd,
            "control_cv_percent": 100 * sd / mean if sd is not None and mean > 0 else None,
            "normalization": "Estimable" if after["controlMedian"] is not None else "Not estimable",
        })
        before_groups = {(g["compound"], g["doseUm"]): g for g in before["groups"]}
        for group in after["groups"]:
            original = before_groups[group["compound"], group["doseUm"]]
            conditions.append({
                "run_id": run_id, "compound": group["compound"], "dose_um": group["doseUm"],
                "measured_technical_wells": len(original["wellIds"]),
                "included_technical_wells": len(group["wellIds"]), "estimable_n": group["n"],
                "all_measured_mean_percent": original["mean"], "included_mean_percent": group["mean"],
                "included_sd_percent": group["sd"],
                "change_percentage_points": (
                    group["mean"] - original["mean"]
                    if group["mean"] is not None and original["mean"] is not None else None
                ),
                "included_well_ids": group["wellIds"],
            })
        for well in members:
            row = measurements[well["id"]]
            source = sources[well["id"], row["source_image_id"]]
            evidence.append({
                "run_id": run_id, "well_id": well["id"], "well_name": well["well"],
                "compound": well["compound"], "dose_um": well["doseUm"], "control": well["control"],
                "measured": well["measured"],
                "included": well["measured"] and well["id"] not in after["excluded"],
                "flags": qc_flags(well["measurements"], thresholds),
                "integrated_signal_adu": row["integrated_signal_adu"],
                "normalized_percent": after["normalized"][well["id"]],
                "source_image_id": row["source_image_id"], "source_path": source["path"],
                "source_sha256": source["sha256"],
            })
    canonical = {
        name: sorted(tables[name], key=lambda row: json.dumps(row, sort_keys=True, allow_nan=False))
        for name in TABLE_NAMES
    }
    snapshot = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return {
        "schema_version": 1, "experiment_id": experiment_id,
        "origin": "Simulated screening experiment", "read_only": True,
        "title": tables["assayscope_experiments"][0]["title"],
        "code_version": code_version, "input_tables_sha256": hashlib.sha256(snapshot).hexdigest(),
        "table_rows": {name: len(tables[name]) for name in TABLE_NAMES},
        "thresholds": asdict(thresholds), "recorded_thresholds": asdict(baseline),
        "n_definition": "Technical wells per condition within one run; not cells or timepoints.",
        "normalization": "100 x integrated reporter / median included vehicle reporter in the same run.",
        "limitations": [
            "Two simulated acquisitions are not independent biological replicates.",
            "QC flags are observed image properties, not proven causes.",
            "Control CV is descriptive technical variability, not an assay acceptance criterion.",
            "Changing QC inclusion also changes the eligible control denominator.",
            "No fitted IC50, Z-prime, significance test, efficacy or viability conclusion.",
            "A human must inspect source images and decide whether to repeat or investigate.",
        ],
        "runs": runs, "conditions": conditions, "well_evidence": evidence,
    }


def _format(value):
    if value is None:
        return "Not estimable"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or "None"
    if isinstance(value, float):
        return f"{value:,.2f}"
    return str(value)


def _table(caption, rows, columns):
    head = "".join(f'<th scope="col">{html.escape(label)}</th>' for _, label in columns)
    body = "".join(
        "<tr>" + "".join(f"<td>{html.escape(_format(row[key]))}</td>" for key, _ in columns) + "</tr>"
        for row in rows
    )
    return (
        f'<div class="table-wrap"><table><caption>{html.escape(caption)}</caption>'
        f"<thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>"
    )


def report_html(report):
    run_table = _table("Run quality and control dispersion", report["runs"], (
        ("run_id", "Run"), ("included_wells", "Included"), ("excluded_wells", "Excluded"),
        ("unmeasured_wells", "Unmeasured"), ("included_control_wells", "Included controls"),
        ("control_median_adu", "Control median (integrated ADU)"),
        ("control_cv_percent", "Control CV (%)"), ("normalization", "Normalization"),
    ))
    condition_table = _table("QC exclusion sensitivity by condition and run", report["conditions"], (
        ("run_id", "Run"), ("compound", "Fictional compound"), ("dose_um", "Dose (micromolar)"),
        ("measured_technical_wells", "Measured wells"), ("included_technical_wells", "Included wells"),
        ("estimable_n", "Estimable n"), ("all_measured_mean_percent", "Before QC (%)"),
        ("included_mean_percent", "After QC (%)"), ("included_sd_percent", "Sample SD (%)"),
        ("change_percentage_points", "Change (percentage points)"),
    ))
    flagged = [row for row in report["well_evidence"] if row["flags"]]
    evidence_table = _table("Wells requiring image review; no review decision is written", flagged, (
        ("run_id", "Run"), ("well_name", "Well"), ("flags", "Observed QC flags"),
        ("integrated_signal_adu", "Original reporter (integrated ADU)"),
        ("normalized_percent", "Normalized reporter (%)"), ("source_image_id", "Source image"),
    ))
    lineage = _table("Source lineage for every technical well", report["well_evidence"], (
        ("well_id", "Well ID"), ("source_path", "Canonical image path"), ("source_sha256", "SHA-256"),
    ))
    bars = []
    for i, run in enumerate(report["runs"]):
        y = 44 + i * 58
        x = 130
        for key, fill, label in (
            ("included_wells", "#0f766e", "Included"), ("excluded_wells", "#b45309", "Excluded"),
            ("unmeasured_wells", "#64748b", "Unmeasured"),
        ):
            width = 620 * run[key] / run["total_wells"]
            bars.append(f'<rect x="{x}" y="{y}" width="{width}" height="22" fill="{fill}">'
                        f'<title>{html.escape(label)}: {run[key]}</title></rect>')
            x += width
        bars.append(f'<text x="12" y="{y + 16}">{html.escape(run["run_id"])}</text>')
        bars.append(f'<text x="130" y="{y + 40}">Included {run["included_wells"]}; '
                    f'excluded {run["excluded_wells"]}; unmeasured {run["unmeasured_wells"]}</text>')
    chart = (
        f'<svg viewBox="0 0 780 {60 + 58 * len(report["runs"])}" role="img" '
        'aria-label="Included, excluded and unmeasured technical wells by run">'
        '<text x="12" y="22" font-weight="600">Technical-well accounting</text>'
        + "".join(bars) + "</svg>"
    )
    limits = "".join(f"<li>{html.escape(item)}</li>" for item in report["limitations"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>AssayScope research review</title>
<style>
body{{font:15px/1.6 system-ui,sans-serif;color:#172b3a;background:#f5f7f9;margin:0}}
main{{max-width:1180px;margin:auto;padding:32px}}h1{{font-size:32px;margin:6px 0}}
h2{{margin:32px 0 12px}}.label{{font-size:13px;font-weight:600;color:#0f5e59}}
.table-wrap{{overflow-x:auto;background:white;border:1px solid #d5dee4;margin:16px 0}}
table{{border-collapse:collapse;width:100%;font-size:13px}}caption{{text-align:left;padding:12px;font-weight:600}}
th,td{{text-align:left;padding:9px 12px;border-top:1px solid #e0e6ea;vertical-align:top}}
th{{background:#eaf0f3}}td{{font-variant-numeric:tabular-nums}}code{{overflow-wrap:anywhere}}
svg{{background:white;max-width:780px;width:100%;font:13px system-ui,sans-serif}}
details{{margin:24px 0}}summary{{cursor:pointer;font-weight:600}}
@media print{{body{{background:white}}main{{padding:0}}.table-wrap{{overflow:visible}}}}
</style></head><body><main>
<div class="label">RESEARCH ONLY | SIMULATED SCREENING EXPERIMENT | READ-ONLY</div>
<h1>AssayScope research review</h1><p>{html.escape(report["title"])}</p>
<p>Inspect control dispersion and the effect of QC exclusions before interpreting a condition.
This report reads analytical tables. It does not modify images, measurements or review decisions.</p>
{chart}{run_table}
<h2>Interpretation rules</h2><p>{html.escape(report["n_definition"])}
{html.escape(report["normalization"])}</p><ul>{limits}</ul>
<h2>What changes when flagged wells are excluded?</h2>
<p>Both technical-well membership and the vehicle denominator are recomputed. A difference is a
sensitivity observation, not an estimated treatment effect. Missing means and one-well SD stay
not estimable; runs are never pooled.</p>{condition_table}
<h2>Which acquisitions need inspection?</h2>{evidence_table}
<p>Open the indicated run and well in AssayScope. Inspect focus, saturation, illumination,
segmentation and acquisition metadata before recording a human research decision.</p>
<details><summary>Source-image lineage</summary>{lineage}</details>
<h2>Reproducibility</h2>
<p>Experiment: <code>{html.escape(report["experiment_id"])}</code><br>
Analysis source: <code>{html.escape(report["code_version"])}</code><br>
Input-table snapshot SHA-256: <code>{report["input_tables_sha256"]}</code><br>
Active QC thresholds: <code>{html.escape(json.dumps(report["thresholds"], sort_keys=True))}</code></p>
<p>Canonical arrays remain TCZYX with recorded physical units and source hashes.
Table lineage checks do not replace re-hashing the actual image bytes.</p>
</main></body></html>"""


def read_local_tables(directory):
    import pyarrow.parquet as pq

    tables = {}
    for name in TABLE_NAMES:
        path = directory / f"{name}.parquet"
        if path.is_symlink() or path.stat().st_size > 32 * 1024 ** 2:
            raise ValueError(f"{name} is linked or exceeds the 32 MiB input bound.")
        parquet = pq.ParquetFile(path)
        if not 1 <= parquet.metadata.num_rows <= MAX_ROWS:
            raise ValueError(f"{name} exceeds the {MAX_ROWS}-row bound or is empty.")
        tables[name] = parquet.read().to_pylist()
    return tables


def write_report(report, directory):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "research-review.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    (directory / "research-review.html").write_text(report_html(report), encoding="utf-8")
    for key in ("runs", "conditions", "well_evidence"):
        with (directory / f"{key}.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS[key])
            writer.writeheader()
            for row in report[key]:
                values = {}
                for name, value in row.items():
                    if isinstance(value, list):
                        value = json.dumps(value)
                    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                        value = "'" + value
                    values[name] = value
                writer.writerow(values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tables", type=Path, default=Path("data/core/tables"))
    parser.add_argument("--out", type=Path, default=Path("test-results/research"))
    args = parser.parse_args()
    report = review_tables(read_local_tables(args.tables))
    write_report(report, args.out)
    print(f"Read-only research report: {args.out / 'research-review.html'}")


if __name__ == "__main__":
    main()
