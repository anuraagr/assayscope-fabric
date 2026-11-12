"""Bounded public-data retrieval. A failed download never becomes synthetic data."""

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import numpy as np
import tifffile
from skimage.measure import block_reduce

from .assets import CHANNELS, read_tczyx, sha256, write_asset, write_json
from .generator import ROOT

MAX_DOWNLOAD = 2 * 1024**3
ALLOWED_HOSTS = {"ftp.ebi.ac.uk", "cellpainting-gallery.s3.amazonaws.com"}


class DownloadError(RuntimeError):
    pass


def fetch_file(item: dict, folder: Path, client: httpx.Client, progress=None):
    url = urlparse(item["url"])
    if url.scheme != "https" or url.hostname not in ALLOWED_HOSTS or url.query:
        raise DownloadError("Source URL is not an approved public dataset URL.")
    if Path(item["name"]).name != item["name"]:
        raise DownloadError("Source filename cannot contain a directory.")
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / item["name"]
    if target.exists():
        if target.stat().st_size == item["bytes"] and sha256(target) == item["sha256"]:
            if progress:
                progress(item["name"], item["bytes"], item["bytes"])
            return target
        raise DownloadError(f"Existing {item['name']} failed validation. Move it aside and rerun; it was not overwritten.")
    partial = target.with_suffix(target.suffix + ".part")
    for attempt in range(3):
        size = partial.stat().st_size if partial.exists() else 0
        if size == item["bytes"]:
            if sha256(partial) == item["sha256"]:
                partial.replace(target)
                return target
            partial.unlink()
            size = 0
        if size > item["bytes"]:
            partial.unlink()
            size = 0
        headers = {"Range": f"bytes={size}-"} if size else {}
        try:
            with client.stream("GET", item["url"], headers=headers, follow_redirects=False) as response:
                if response.status_code not in (200, 206):
                    raise DownloadError(f"HTTP {response.status_code} for {item['name']}. No replacement data will be used.")
                if response.status_code == 206:
                    expected_range = f"bytes {size}-"
                    if not response.headers.get("content-range", "").startswith(expected_range):
                        raise DownloadError(f"Invalid resumed range for {item['name']}.")
                else:
                    size = 0
                with partial.open("ab" if size else "wb") as stream:
                    for chunk in response.iter_bytes(256 * 1024):
                        size += len(chunk)
                        if size > item["bytes"]:
                            raise DownloadError("Source exceeded its pinned size; download stopped.")
                        stream.write(chunk)
                        if progress:
                            progress(item["name"], size, item["bytes"])
            if size != item["bytes"]:
                raise DownloadError(f"Interrupted {item['name']}: {size}/{item['bytes']} bytes; rerun to resume.")
            if sha256(partial) != item["sha256"]:
                partial.unlink()
                raise DownloadError(f"SHA-256 mismatch for {item['name']}; untrusted partial removed.")
            partial.replace(target)
            return target
        except (httpx.HTTPError, DownloadError) as exc:
            if attempt == 2:
                raise DownloadError(f"{item['name']} failed after 3 attempts: {exc}") from exc
            time.sleep(0.5 * 2**attempt)
    raise DownloadError("Download did not complete.")


def prepare(root: Path, manifest: dict):
    studies = []
    for source in manifest["studies"]:
        originals = [root / "original" / item["name"] for item in source["files"]]
        for path, spec in zip(originals, source["files"], strict=True):
            if not path.exists() or path.stat().st_size != spec["bytes"] or sha256(path) != spec["sha256"]:
                raise DownloadError(f"Source validation failed: {path.name}. Fetch the exact source first.")
        transforms = [source["transform"], source["channelCaution"], source["temporalCaution"]]
        spacing = source["spacingUmZYX"].copy()
        if source["id"] == "biad610-bt474":
            data, metadata = read_tczyx(originals[0])
            if list(data.shape) != [1, 3, 35, 1024, 1024] or metadata["axes"] != "ZCYX":
                raise ValueError("BT474 dimensions changed; review the primary source before conversion.")
            data = block_reduce(data, (1, 1, 1, 4, 4), np.mean).round().astype(np.uint8)
            spacing[1] *= 4
            spacing[2] *= 4
        elif source["id"] == "cpg0000-field":
            channels, ranges = [], []
            for path in originals:
                array = tifffile.imread(path)
                if array.shape != (1080, 1080) or array.dtype != np.uint16:
                    raise ValueError("Cell Painting source dimensions or dtype changed.")
                reduced = block_reduce(array, (2, 2), np.mean)
                low, high = np.percentile(reduced, [1, 99.8])
                if high <= low:
                    raise ValueError("Public channel has no usable display range.")
                channels.append(np.clip((reduced - low) * 255 / (high - low), 0, 255).astype(np.uint8))
                ranges.append({"file": path.name, "low": float(low), "high": float(high)})
            data = np.stack(channels)[None, :, None]
            spacing[1] *= 2
            spacing[2] *= 2
            transforms.append("Recorded display conversion ranges: " + json.dumps(ranges))
            transforms.append("XY calibration uses primary Index.idx.xml, not TIFF resolution tags; no physical Z measurement.")
        else:
            raise ValueError("No reviewed conversion for this source.")
        asset = write_asset(root / "derived", source["id"], data, spacing, [0],
                            source["channels"], write_ngff=True)
        studies.append({
            "id": source["id"], "title": source["title"],
            "description": source["instrument"], "license": source["license"],
            "citation": source["citation"], "sourceUrl": source["record"],
            "asset": asset,
            "defaultVisibility": source.get("defaultVisibility", [True] * len(source["channels"])),
            "channels": [
                {"id": f"ch{i}", "name": name, "color": CHANNELS[i % 3]["color"],
                 "meaning": source["channelCaution"]}
                for i, name in enumerate(source["channels"])
            ],
            "transformations": transforms,
        })
    result = {"available": True, "studies": studies}
    write_json(root / "reference.json", result)
    write_json(root / "derived" / "source-manifest.json", manifest)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "fetch", "prepare"])
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "public")
    parser.add_argument("--allow-over-2gb", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "config" / "public-sources.json").read_text(encoding="utf-8"))
    files = [f for s in manifest["studies"] for f in s["files"]]
    total = sum(f["bytes"] for f in files)
    print(f"Public originals: {total:,} bytes in {len(files)} pinned files; no synthetic fallback.")
    if args.command == "plan":
        for f in files:
            print(f"{f['name']}: {f['bytes']:,} bytes, SHA-256 {f['sha256']}")
        return
    if total > MAX_DOWNLOAD and not args.allow_over_2gb:
        raise SystemExit("Over 2 GiB: review plan and pass --allow-over-2gb to opt in.")
    if args.command == "fetch":
        previous = {}

        def progress(name, size, maximum):
            percent = int(size / maximum * 10) * 10
            if previous.get(name) != percent:
                print(f"{name}: {size:,}/{maximum:,} bytes ({percent}%)")
                previous[name] = percent

        with httpx.Client(timeout=httpx.Timeout(30, read=60)) as client:
            for f in files:
                fetch_file(f, args.out / "original", client, progress)
    prepare(args.out, manifest)
    print("Public derivatives ready. These references are independent studies, not screening replicates.")


if __name__ == "__main__":
    main()
