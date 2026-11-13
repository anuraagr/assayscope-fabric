import copy
import csv
import importlib.util
import json

import numpy as np
import pytest

from assayscope.analysis import QCThresholds, qc_flags, summarize
from assayscope.generator import ROOT, build
from assayscope.ingest import tables
from research.review import report_html, review_tables, write_report


@pytest.fixture(scope="module")
def analytical():
    return tables(build(ROOT / "data" / "core"))


def refresh_qc(analytical):
    rows = {row["well_id"]: row for row in analytical["assayscope_measurements"]}
    for row in analytical["assayscope_qc"]:
        m = rows[row["well_id"]]
        metrics = None if not m["measured"] else {
            "focusScore": m["focus_score"], "saturationFraction": m["saturation_fraction"],
            "illuminationCv": m["illumination_cv"], "objectCount": m["object_count"],
        }
        row["flags_json"] = json.dumps(qc_flags(metrics, QCThresholds()))


def test_research_reuses_within_run_reduction_and_preserves_originals(analytical):
    original = copy.deepcopy(analytical)
    report = review_tables(analytical)
    catalog = build(ROOT / "data" / "core")
    assert analytical == original
    assert len(report["well_evidence"]) == 192
    for run in report["runs"]:
        wells = [w for w in catalog["wells"] if w["runId"] == run["run_id"]]
        expected = summarize(wells, QCThresholds())
        assert run["included_wells"] == expected["included"] == 85
        assert run["excluded_wells"] == len(expected["excluded"]) == 11
        assert run["included_control_wells"] == expected["controlN"] == 22
        for group in expected["groups"]:
            row = next(r for r in report["conditions"] if r["run_id"] == run["run_id"]
                       and r["compound"] == group["compound"] and r["dose_um"] == group["doseUm"])
            assert row["estimable_n"] == group["n"] <= 3
            assert row["included_mean_percent"] == group["mean"]
            assert row["included_sd_percent"] == group["sd"]
        controls = [w["measurements"]["integratedSignalAdu"] for w in wells
                    if w["control"] and w["id"] not in expected["excluded"]]
        assert run["control_cv_percent"] == 100 * np.std(controls, ddof=1) / np.mean(controls)
    flagged = next(r for r in report["well_evidence"] if r["well_id"] == "run1-F11")
    assert flagged["flags"] == ["Low focus"] and not flagged["included"]
    assert flagged["normalized_percent"] > 0 and flagged["integrated_signal_adu"] > 0
    reordered = {name: list(reversed(rows)) for name, rows in analytical.items()}
    assert review_tables(reordered) == report


@pytest.mark.parametrize("control_case", ["absent", "zero", "excluded"])
def test_research_missing_denominators_are_not_zero_responses(analytical, control_case):
    changed = copy.deepcopy(analytical)
    for row in changed["assayscope_measurements"]:
        if row["is_control"]:
            if control_case == "absent":
                row["is_control"] = False
            elif control_case == "zero":
                row["integrated_signal_adu"] = 0
            else:
                row["focus_score"] = 0
    refresh_qc(changed)
    report = review_tables(changed)
    assert all(r["normalization"] == "Not estimable" for r in report["runs"])
    assert all(r["included_mean_percent"] is None and r["estimable_n"] == 0
               for r in report["conditions"])
    assert all(r["normalized_percent"] is None for r in report["well_evidence"])
    json.dumps(report, allow_nan=False)


def test_research_one_well_sd_and_sensitivity_use_scenario_controls(analytical):
    changed = copy.deepcopy(analytical)
    for row in changed["assayscope_measurements"]:
        if not row["is_control"] and row["replicate"] != 1:
            row["focus_score"] = 0
    refresh_qc(changed)
    report = review_tables(changed)
    assert all(r["estimable_n"] <= 1 and r["included_sd_percent"] is None
               for r in report["conditions"])
    aster = next(r for r in report["conditions"]
                 if r["run_id"] == "run1" and r["compound"] == "Aster-17" and r["dose_um"] == 10)
    assert aster["measured_technical_wells"] == 3 and aster["included_technical_wells"] == 1
    assert aster["change_percentage_points"] == (
        aster["included_mean_percent"] - aster["all_measured_mean_percent"]
    )


@pytest.mark.parametrize("damage,match", [
    ("duplicate", "Duplicate measurement"),
    ("missing_qc", "identities do not match"),
    ("mixed_experiment", "Mixed or unexpected"),
    ("real_data", "Real or unspecified"),
    ("stale_source", "different code version"),
    ("missing_source", "Source image/provenance"),
    ("stale_qc", "Stored QC flags disagree"),
    ("nonfinite", "finite, nonnegative"),
])
def test_research_rejects_broken_lineage_and_unreviewed_data(analytical, damage, match):
    changed = copy.deepcopy(analytical)
    rows = changed["assayscope_measurements"]
    if damage == "duplicate":
        rows.append(rows[0].copy())
    elif damage == "missing_qc":
        changed["assayscope_qc"].pop()
    elif damage == "mixed_experiment":
        rows[0]["experiment_id"] = "unrelated-study"
    elif damage == "real_data":
        rows[0]["synthetic"] = False
    elif damage == "stale_source":
        rows[0]["code_version"] = "another-code-version"
    elif damage == "missing_source":
        rows[0]["source_image_id"] = "missing-image"
    elif damage == "stale_qc":
        changed["assayscope_qc"][0]["flags_json"] = '["Unmeasured"]'
    else:
        rows[0]["integrated_signal_adu"] = float("nan")
    with pytest.raises(ValueError, match=match):
        review_tables(changed)


def test_report_escapes_text_and_csv_preserves_numeric_values(analytical, tmp_path):
    changed = copy.deepcopy(analytical)
    changed["assayscope_experiments"][0]["title"] = "<script>alert(1)</script>"
    changed["assayscope_measurements"][0]["compound"] = "=untrusted-label"
    report = review_tables(changed)
    write_report(report, tmp_path)
    rendered = report_html(report)
    assert "<script>" not in rendered and "&lt;script&gt;" in rendered
    assert "Not estimable" in rendered and "role=\"img\"" in rendered
    with (tmp_path / "well_evidence.csv").open(newline="", encoding="utf-8") as handle:
        records = list(csv.DictReader(handle))
    assert len(records) == 192
    assert records[0]["compound"] == "'=untrusted-label"
    assert float(records[0]["integrated_signal_adu"]) == report["well_evidence"][0]["integrated_signal_adu"]
    assert json.loads((tmp_path / "research-review.json").read_text()) == report


def test_notebook_shared_code_matches_local_research_results(analytical):
    path = ROOT / "scripts" / "build_research_notebook.py"
    spec = importlib.util.spec_from_file_location("build_research_notebook", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    notebook = module.notebook()
    namespace = {}
    source = "".join(next(c for c in notebook["cells"] if c["id"] == "shared-analysis")["source"])
    exec(compile(source, "shared-analysis", "exec"), namespace)
    assert namespace["review_tables"](analytical) == review_tables(analytical)
    for cell in notebook["cells"]:
        if cell["cell_type"] == "code":
            compile("".join(cell["source"]), cell["id"], "exec")
            assert cell["outputs"] == [] and cell["execution_count"] is None
    assert "dependencies" not in notebook["metadata"]
