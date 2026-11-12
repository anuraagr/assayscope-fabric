import csv
import io
import json
import shutil
import zipfile

import numpy as np
import pytest
from fastapi.testclient import TestClient

from assayscope.analysis import QCThresholds
from assayscope.generator import ROOT, build
from assayscope.server import create_app


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv("ASSAYSCOPE_CORE", raising=False)
    monkeypatch.delenv("ASSAYSCOPE_PUBLIC", raising=False)
    build(ROOT / "data" / "core")
    core = tmp_path / "core"
    core.mkdir()
    shutil.copy2(ROOT / "data" / "core" / "catalog.json", core / "catalog.json")
    for folder in ("frames", "labels"):
        (core / folder).mkdir()
        for name in ("run1-B11-volume-0.bin", "run1-B11-0.bin", "run1-F11-0.bin"):
            shutil.copy2(ROOT / "data" / "core" / folder / name, core / folder / name)
    with TestClient(create_app(tmp_path)) as client:
        yield client, tmp_path


def test_populated_catalog_and_real_frame(api):
    client, _ = api
    assert client.get("/api/status").json()["mode"] == "local"
    catalog = client.get("/api/catalog").json()
    assert len(catalog["wells"]) == 192
    response = client.get("/api/assets/run1-B11-volume/frames/0")
    assert response.status_code == 200 and len(response.content) == 64 * 112 * 112 * 3
    assert np.frombuffer(response.content, np.uint8).std() > 5


def test_corrupt_data_unknown_images_and_time_fail(api):
    client, root = api
    assert client.get("/api/assets/private-truth/frames/0").status_code == 404
    assert client.get("/api/assets/run1-B11-volume/frames/6").status_code == 422
    (root / "core" / "frames" / "run1-B11-volume-0.bin").write_bytes(b"corrupt")
    assert client.get("/api/assets/run1-B11-volume/frames/0").status_code == 409
    assert client.get("/api/assets/not-registered/labels/0").status_code == 404


def test_local_request_boundary_and_validation(api):
    client, _ = api
    assert client.post("/api/reset", json={}, headers={"Origin": "https://untrusted.invalid"}).status_code == 403
    assert client.get("/api/catalog", headers={"Host": "untrusted.invalid"}).status_code == 403
    assert client.post("/api/reset", content="{}").status_code == 415
    assert client.post("/api/reset", json={"oversized": "x" * 33000}).status_code == 413
    assert client.post("/api/analysis", json={"thresholds": {"focusMin": -1}}).status_code == 422
    assert client.post("/api/analysis", json={"runId": "unexpected"}).status_code == 422


def test_analysis_exclusion_has_explicit_accounting(api):
    client, _ = api
    before = client.post("/api/analysis", json={"excludeQC": False}).json()
    after = client.post("/api/analysis", json={"excludeQC": True}).json()
    assert before["included"] == 96 and after["included"] == 85
    assert after["flags"]["run1-F11"] == ["Low focus"]
    assert len(after["crossRun"]) == 2
    assert sum(r["flagged"] for r in after["crossRun"]) == 22


def test_reviews_survive_new_server_and_reject_stale_writes(api):
    client, root = api
    body = {"state": "Repeat acquisition", "rationale": "Focus is below threshold.",
            "annotation": "Inspect the source field.", "version": 0}
    saved = client.put("/api/reviews/run1-F11", json=body)
    assert saved.status_code == 200
    assert client.put("/api/reviews/run1-F11", json=body).status_code == 409
    with TestClient(create_app(root)) as restarted:
        assert restarted.get("/api/reviews/run1-F11").json()["rationale"] == body["rationale"]
        assert restarted.get("/api/reviews/run1-F11").json()["annotation"] == body["annotation"]
        assert restarted.put("/api/reviews/run1-F11", json={**body, "state": "Clinical efficacy"}).status_code == 422
        assert restarted.put("/api/reviews/run1-F11", json={**body, "rationale": "   "}).status_code == 422


def test_export_matches_visible_analysis_and_escapes_annotation(api):
    client, _ = api
    annotation = "<img src=x onerror=alert(1)>"
    client.put("/api/reviews/run1-B11", json={"state": "Investigate", "rationale": annotation,
                                            "annotation": "research only", "version": 0})
    catalog = client.get("/api/catalog").json()
    options = {
        "wellId": "run1-B11", "runId": "run1", "excludeQC": True,
        "thresholds": QCThresholds().__dict__,
        "view": {"assetId": "run1-B11-volume", "time": 0, "z": 32, "channels": [
            {"visible": True, "color": c["color"], "low": 0, "high": 255} for c in catalog["channels"]
        ]},
    }
    response = client.post("/api/export", json=options)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {"report.html", "measurements.csv", "selected-slice.png", "provenance.json", "citations.txt"}
        manifest = json.loads(archive.read("provenance.json"))
        row = next(r for r in csv.DictReader(io.StringIO(archive.read("measurements.csv").decode())) if r["wellId"] == "run1-B11")
        visible = client.post("/api/analysis", json={"runId": "run1", "excludeQC": True}).json()
        assert float(row["normalizedReporterPercent"]) == visible["normalized"]["run1-B11"]
        assert manifest["analysis"]["excluded"] == visible["excluded"]
        assert manifest["sourceFrameSha256"] == next(w for w in catalog["wells"] if w["id"] == "run1-B11")["volume"]["frameHashes"][0]
        assert archive.read("selected-slice.png").startswith(b"\x89PNG")
        assert b"&lt;img" in archive.read("report.html") and annotation.encode() not in archive.read("report.html")
        assert "scikit-image.org" in archive.read("citations.txt").decode()
    options["view"]["assetId"] = "run1-F11-volume"
    assert client.post("/api/export", json=options).status_code == 422


def test_reset_is_scoped_and_missing_cloud_never_connects(api):
    client, root = api
    source = (root / "core" / "catalog.json").read_bytes()
    client.put("/api/reviews/run1-B11", json={"state": "Investigate", "rationale": "Reset me", "version": 0})
    assert client.post("/api/reset", json={}).status_code == 200
    assert client.get("/api/reviews/run1-B11").json() is None
    assert (root / "core" / "catalog.json").read_bytes() == source
    assert client.get("/api/fabric/status").status_code == 503
    assert client.get("/api/public").json()["available"] is False
