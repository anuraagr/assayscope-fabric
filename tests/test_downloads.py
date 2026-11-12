import hashlib
import json

import httpx
import numpy as np
import pytest

from assayscope.assets import read_tczyx
from assayscope.generator import ROOT
from assayscope.public_data import DownloadError, fetch_file


@pytest.fixture
def download_spec():
    payload = b"bounded-public-fixture-data"
    return payload, {"name": "sample.tif", "url": "https://ftp.ebi.ac.uk/sample.tif",
                     "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


def test_download_resume_and_checksum(tmp_path, download_spec):
    payload, spec = download_spec
    (tmp_path / "sample.tif.part").write_bytes(payload[:8])

    def handle(request):
        assert request.headers["range"] == "bytes=8-"
        return httpx.Response(206, headers={"content-range": f"bytes 8-{len(payload)-1}/{len(payload)}"}, content=payload[8:])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        path = fetch_file(spec, tmp_path, client)
        assert path.read_bytes() == payload
        assert fetch_file(spec, tmp_path, client) == path


def test_server_ignoring_range_restarts_without_corruption(tmp_path, download_spec):
    payload, spec = download_spec
    (tmp_path / "sample.tif.part").write_bytes(payload[:8])
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=payload))) as client:
        assert fetch_file(spec, tmp_path, client).read_bytes() == payload


@pytest.mark.parametrize("status,payload", [(404, b""), (200, b"wrong"), (200, b"x" * 100)])
def test_failed_downloads_are_bounded_and_never_substitute(tmp_path, download_spec, monkeypatch, status, payload):
    _, spec = download_spec
    calls = []
    monkeypatch.setattr("assayscope.public_data.time.sleep", lambda _: None)

    def handle(request):
        calls.append(request)
        return httpx.Response(status, content=payload)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(DownloadError):
            fetch_file(spec, tmp_path, client)
    assert len(calls) == 3
    assert not (tmp_path / "sample.tif").exists()
    assert not (tmp_path / "catalog.json").exists()


def test_rejects_untrusted_paths_urls_and_changed_cached_source(tmp_path, download_spec):
    payload, spec = download_spec
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=payload))) as client:
        for altered in ({**spec, "url": "http://127.0.0.1/internal"}, {**spec, "name": "../escape"}):
            with pytest.raises(DownloadError):
                fetch_file(altered, tmp_path, client)
        (tmp_path / spec["name"]).write_bytes(b"corrupt")
        with pytest.raises(DownloadError, match="not overwritten"):
            fetch_file(spec, tmp_path, client)


def test_public_manifest_has_exact_sources_rights_and_bounds():
    manifest = json.loads((ROOT / "config" / "public-sources.json").read_text())
    files = [f for s in manifest["studies"] for f in s["files"]]
    assert sum(f["bytes"] for f in files) == manifest["totalOriginalImageBytes"] < 2 * 1024**3
    assert {s["license"] for s in manifest["studies"]} == {"CC0-1.0", "CC-BY-4.0"}
    assert all(len(f["sha256"]) == 64 and f["url"].startswith("https://") for f in files)
    assert manifest["studies"][0]["channels"] == ["Source channel 1", "Source channel 2", "Source channel 3"]


def test_actual_public_derivative_dimensions_and_time():
    path = ROOT / "data" / "public" / "reference.json"
    if not path.exists():
        pytest.skip("Optional public download pack is not installed; no synthetic replacement.")
    reference = json.loads(path.read_text())
    for study in reference["studies"]:
        asset = study["asset"]
        array, _ = read_tczyx(ROOT / "data" / "public" / "derived" / asset["path"])
        assert list(array.shape) == asset["shape"]
        assert array.shape[0] == 1
        assert np.std(array) > 2
        assert asset["timesHours"] == [0]
    assert reference["studies"][0]["asset"]["spacingUm"][0] > reference["studies"][0]["asset"]["spacingUm"][1]
