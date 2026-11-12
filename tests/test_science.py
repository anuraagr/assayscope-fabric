import copy
import hashlib
import json
import xml.etree.ElementTree as ET

import numpy as np
import pytest
import zarr

from assayscope.analysis import QCThresholds, analyze_image, analyze_volume, qc_flags, summarize
from assayscope.assets import read_tczyx, sha256, write_asset
from assayscope.generator import DOSES, ROOT, SEED, build, cell_field, validate_catalog, well_layout
from assayscope.ingest import tables


@pytest.fixture(scope="session")
def catalog():
    return build(ROOT / "data" / "core")


def test_plate_has_exact_technical_replicate_design():
    wells = well_layout()
    assert len({w["well"] for w in wells}) == 96
    assert len([w for w in wells if w["control"]]) == 24
    for compound in ["Aster-17", "Beryl-04", "Cygnus-09"]:
        for dose in DOSES:
            assert sorted(w["replicate"] for w in wells if w["compound"] == compound and w["doseUm"] == dose) == [1, 2, 3]


def test_generation_and_image_derived_analysis_are_deterministic():
    image, truth = cell_field(SEED)
    repeat, truth_again = cell_field(SEED)
    different, _ = cell_field(SEED + 1)
    assert np.array_equal(image, repeat)
    assert np.array_equal(truth, truth_again)
    assert not np.array_equal(image, different)
    metrics, labels = analyze_image(image)
    measured_again, labels_again = analyze_image(repeat)
    assert metrics == measured_again
    assert np.array_equal(labels, labels_again)
    assert metrics["objectCount"] == int(labels.max())
    assert metrics["integratedSignalAdu"] == np.maximum(
        image[2].astype(float) - np.percentile(image[2], 10), 0
    ).sum()


def test_segmentation_against_separate_truth():
    image, truth = cell_field(SEED)
    metrics, labels = analyze_image(image)
    predicted, actual = labels > 0, truth > 0
    dice = 2 * np.count_nonzero(predicted & actual) / (predicted.sum() + actual.sum())
    assert dice > 0.85
    assert abs(metrics["objectCount"] - truth.max()) / truth.max() < 0.1
    analysis_source = (ROOT / "assayscope" / "analysis.py").read_text()
    assert "from .generator" not in analysis_source
    assert "private-truth" not in analysis_source


@pytest.mark.parametrize("artifact,expected", [
    (None, []), ("defocus", ["Low focus"]),
    ("saturation", ["Saturation"]), ("illumination", ["Uneven illumination"]),
])
def test_qc_detects_pixels_not_artifact_labels(artifact, expected):
    image, _ = cell_field(SEED + 23, artifact=artifact)
    measurements, _ = analyze_image(image)
    assert qc_flags(measurements, QCThresholds()) == expected


def test_whole_pack_qc_against_held_out_truth(catalog):
    truth = json.loads((ROOT / "data" / "private-truth" / "truth.json").read_text())
    predicted = {w["id"] for w in catalog["wells"] if qc_flags(w["measurements"], QCThresholds())}
    actual = {t["id"] for t in truth if t["artifact"]}
    assert predicted == actual
    assert len(predicted) == 22


def test_ome_ngff_axes_channels_anisotropy_and_time(catalog):
    well = next(w for w in catalog["wells"] if w["id"] == "run1-B11")
    asset = well["volume"]
    data, _ = read_tczyx(ROOT / "data" / "core" / asset["path"])
    assert list(data.shape) == asset["shape"] == [6, 3, 64, 112, 112]
    assert len(set(asset["frameHashes"])) == 6
    for t in range(6):
        raw = np.ascontiguousarray(data[t].transpose(1, 2, 3, 0)).tobytes()
        assert hashlib.sha256(raw).hexdigest() == asset["frameHashes"][t]
    group = zarr.open_group(str(ROOT / "data" / "core" / "ngff" / f"{asset['id']}.ome.zarr"), mode="r")
    multiscale = group.attrs["multiscales"][0]
    assert multiscale["version"] == "0.4"
    assert [a["name"] for a in multiscale["axes"]] == list("tczyx")
    assert [a.get("unit") for a in multiscale["axes"]] == ["hour", None, "micrometer", "micrometer", "micrometer"]
    assert multiscale["datasets"][0]["coordinateTransformations"][0]["scale"] == [9.6, 1, 3, 1.5, 1.5]
    assert group["1"].shape == (6, 3, 64, 56, 56)
    np.testing.assert_array_equal(group["0"][:], data)
    assert group.attrs["omero"]["channels"][2]["label"] == "Reporter"
    assert not np.array_equal(data[0], data[5])
    assert data[5, 2].mean() < data[0, 2].mean()


def test_volume_measurement_and_label_alignment(catalog):
    well = next(w for w in catalog["wells"] if w["id"] == "run1-B11")
    asset = well["volume"]
    data, _ = read_tczyx(ROOT / "data" / "core" / asset["path"])
    size, mask = analyze_volume(data[-1], tuple(asset["spacingUm"]))
    truth = np.load(ROOT / "data" / "private-truth" / "run1-B11-volume.npz")["mask"][-1]
    iou = np.count_nonzero((mask > 0) & truth) / np.count_nonzero((mask > 0) | truth)
    assert iou > 0.85
    assert size == well["measurements"]["spheroidVolumeUm3"]
    labels = (ROOT / "data" / "core" / "labels" / f"{asset['id']}-5.bin").read_bytes()
    assert len(labels) == int(np.prod(data.shape[2:]))
    assert set(labels) == {0, 1}


def test_replicate_normalization_exclusions_and_not_estimable(catalog):
    wells = [w for w in catalog["wells"] if w["runId"] == "run1"]
    before = summarize(wells, QCThresholds(), exclude_qc=False)
    after = summarize(wells, QCThresholds(), exclude_qc=True)
    assert before["included"] == 96
    assert after["included"] == 85
    assert after["controlN"] == 22
    assert "run1-F11" in after["excluded"]
    group = next(g for g in after["groups"] if g["compound"] == "Cygnus-09" and g["doseUm"] == 10)
    assert group["n"] == 0 and group["mean"] is None and group["sd"] is None
    group = next(g for g in after["groups"] if g["compound"] == "Aster-17" and g["doseUm"] == 10)
    assert group["n"] == 3 and len(group["points"]) == 3
    assert group["mean"] < 45
    assert after["normalized"]["run1-B11"] == 100 * wells[22]["measurements"]["integratedSignalAdu"] / after["controlMedian"]
    assert after["fit"].startswith("Not estimable")


@pytest.mark.parametrize("case", ["missing", "zero", "excluded"])
def test_missing_or_zero_denominator_never_produces_infinity(catalog, case):
    wells = copy.deepcopy([w for w in catalog["wells"] if w["runId"] == "run1"])
    for well in wells:
        if not well["control"]:
            continue
        if case == "missing":
            well["measured"] = False
            well["measurements"] = None
        elif case == "zero":
            well["measurements"]["integratedSignalAdu"] = 0
        else:
            well["measurements"]["focusScore"] = 0
    result = summarize(wells, QCThresholds())
    assert result["controlMedian"] is None
    assert all(v is None for v in result["normalized"].values())
    assert all(g["n"] == 0 for g in result["groups"])


def test_one_technical_replicate_has_no_standard_deviation(catalog):
    wells = copy.deepcopy([w for w in catalog["wells"] if w["runId"] == "run1"])
    for w in wells:
        if not w["control"] and w["replicate"] != 1:
            w["measured"], w["measurements"] = False, None
    result = summarize(wells, QCThresholds())
    assert all(g["sd"] is None for g in result["groups"])
    assert result["unmeasured"] == 48


def test_cross_run_measurements_stay_separate(catalog):
    one = summarize([w for w in catalog["wells"] if w["runId"] == "run1"], QCThresholds())
    two = summarize([w for w in catalog["wells"] if w["runId"] == "run2"], QCThresholds())
    assert one["controlMedian"] != two["controlMedian"]
    assert abs(one["normalized"]["run1-B11"] - two["normalized"]["run2-B11"]) < 5
    assert all(g["n"] <= 3 for g in one["groups"] + two["groups"])


def test_schema_and_analytical_tables_trace_to_images(catalog):
    validate_catalog(catalog)
    analytical = tables(catalog)
    assert len(analytical["assayscope_measurements"]) == 192
    assert len(analytical["assayscope_provenance"]) == 198
    for row in analytical["assayscope_measurements"]:
        original = next(w for w in catalog["wells"] if w["id"] == row["well_id"])
        assert row["source_image_id"] == original["image"]["id"]
        assert row["integrated_signal_adu"] == original["measurements"]["integratedSignalAdu"]
    broken = copy.deepcopy(catalog)
    broken["wells"][0]["image"]["timesHours"] = [0, 1]
    with pytest.raises(ValueError, match="Time"):
        validate_catalog(broken)
    broken = copy.deepcopy(catalog)
    broken["wells"][0]["image"]["path"] = "../private-truth/truth.json"
    with pytest.raises(ValueError, match="traverse"):
        validate_catalog(broken)


def test_empty_and_invalid_images_are_explicit():
    metrics, labels = analyze_image(np.zeros((3, 20, 20), np.uint8))
    assert metrics["objectCount"] == 0 and labels.max() == 0
    assert metrics["meanSignalAdu"] is None
    with pytest.raises(ValueError):
        analyze_image(np.zeros((20, 20)))
    with pytest.raises(ValueError):
        QCThresholds(saturationMax=3)


@pytest.mark.parametrize("times", [[48.0], [48.0, 57.6, 67.2]])
def test_ome_file_bytes_are_reproducible_and_preserve_time_coordinates(tmp_path, times):
    import tifffile

    image, _ = cell_field(SEED)
    pixels = np.repeat(image[None, :, None], len(times), axis=0)
    first = write_asset(tmp_path / "first", "endpoint", pixels, (3, 1.5, 1.5), times,
                        write_ngff=True)
    second = write_asset(tmp_path / "second", "endpoint", pixels, (3, 1.5, 1.5), times,
                         write_ngff=True)
    assert first["sha256"] == second["sha256"]
    assert sha256(tmp_path / "first" / first["path"]) == first["sha256"]
    with tifffile.TiffFile(tmp_path / "first" / first["path"]) as tif:
        planes = ET.fromstring(tif.ome_metadata).findall(".//{*}Plane")
        assert len(planes) == len(times) * 3
        assert {int(p.get("TheT")) for p in planes} == set(range(len(times)))
        for plane in planes:
            assert float(plane.get("DeltaT")) == times[int(plane.get("TheT"))]
            assert plane.get("DeltaTUnit") == "h"
    group = zarr.open_group(str(tmp_path / "first" / "ngff" / "endpoint.ome.zarr"), mode="r")
    for level in group.attrs["multiscales"][0]["datasets"]:
        transforms = level["coordinateTransformations"]
        scale = next(t["scale"] for t in transforms if t["type"] == "scale")
        translation = next(t["translation"] for t in transforms if t["type"] == "translation")
        np.testing.assert_allclose(
            [translation[0] + t * scale[0] for t in range(len(times))], times
        )
    np.testing.assert_array_equal(group["0"][:], pixels)
