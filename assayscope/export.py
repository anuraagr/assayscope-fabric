import csv
import html
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from .analysis import QCThresholds, qc_flags, summarize


def snapshot(frame: np.ndarray, settings: list[dict], z: int) -> bytes:
    if not 0 <= z < frame.shape[0] or len(settings) != frame.shape[3]:
        raise ValueError("Snapshot plane or channels do not match the source.")
    composite = np.zeros((*frame.shape[1:3], 3), dtype=float)
    for channel, setting in enumerate(settings):
        if not setting["visible"]:
            continue
        color = setting["color"].lstrip("#")
        rgb = np.array([int(color[i:i + 2], 16) for i in (0, 2, 4)])
        low, high = setting["low"], setting["high"]
        if not 0 <= low < high <= 255:
            raise ValueError("Display range must satisfy 0 <= low < high <= 255.")
        intensity = np.clip((frame[z, :, :, channel].astype(float) - low) / (high - low), 0, 1)
        composite += intensity[:, :, None] * rgb
    image = Image.fromarray(np.clip(composite, 0, 255).astype(np.uint8))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def evidence_bundle(root: Path, catalog: dict, well: dict, options: dict, review) -> bytes:
    thresholds = QCThresholds(**options["thresholds"])
    wells = [w for w in catalog["wells"] if w["runId"] == well["runId"]]
    analysis = summarize(wells, thresholds, options["excludeQC"])
    view = options["view"]
    asset = next((a for a in (well["image"], well["volume"])
                  if a and a["id"] == view["assetId"]), None)
    if asset is None:
        raise ValueError("Selected image does not belong to this well.")
    t = view["time"]
    if not 0 <= t < asset["shape"][0]:
        raise ValueError("Invalid timepoint.")
    path = root / "frames" / f"{asset['id']}-{t}.bin"
    shape = (*asset["shape"][2:], asset["shape"][1])
    frame = np.frombuffer(path.read_bytes(), np.uint8).reshape(shape)
    image = snapshot(frame, view["channels"], view["z"])
    table = io.StringIO(newline="")
    columns = [
        "wellId", "runId", "well", "compound", "doseUm", "replicate",
        "synthetic", "included", "qcFlags", "normalizedReporterPercent",
        *well["measurements"].keys(),
    ]
    writer = csv.DictWriter(table, fieldnames=columns)
    writer.writeheader()
    for row in wells:
        writer.writerow({
            "wellId": row["id"], "runId": row["runId"], "well": row["well"],
            "compound": row["compound"], "doseUm": row["doseUm"], "replicate": row["replicate"],
            "synthetic": True,
            "included": row["measured"] and row["id"] not in analysis["excluded"],
            "qcFlags": "; ".join(qc_flags(row["measurements"], thresholds)),
            "normalizedReporterPercent": analysis["normalized"][row["id"]],
            **(row["measurements"] or {}),
        })
    manifest = {
        "exportVersion": "1.0", "mode": "Simulated screening experiment",
        "disclosure": catalog["experiment"]["disclosure"],
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "experimentId": catalog["experiment"]["id"], "well": well,
        "processing": catalog["provenance"], "analysis": analysis, "review": review,
        "view": view, "snapshot": "XY slice, not a 3D rendering; fixed display unless explicitly changed",
        "sourceFrameSha256": asset["frameHashes"][t],
    }
    value = analysis["normalized"][well["id"]]
    displayed = f"{value:.1f}%" if value is not None else "Not estimable"
    esc = html.escape
    report = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<title>AssayScope evidence | {esc(well['id'])}</title>
<style>body{{font:16px system-ui;max-width:980px;margin:40px auto;padding:24px;color:#182a3a}}
img{{image-rendering:auto;max-width:500px;background:#070d17;width:100%}}
small{{color:#40566a}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}
table{{border-collapse:collapse}}td,th{{padding:8px;border:1px solid #c8d7e2}}</style>
<h1>AssayScope evidence report</h1>
<p><strong>{esc(catalog['experiment']['disclosure'])}</strong></p>
<h2>{esc(well['compound'])} / {well['doseUm']:g} uM / {esc(well['id'])}</h2>
<p>{esc(catalog['experiment']['question'])}</p>
<p>48 h screen reporter: <strong>{displayed}</strong> of included vehicle median.
{analysis['included']} included; {len(analysis['excluded'])} excluded;
{analysis['unmeasured']} unmeasured.</p>
<p>{esc(analysis['formula'])}. {esc(analysis['nDefinition'])}.</p>
<img src="selected-slice.png" alt="Selected microscopy XY slice">
<p>Selected volume/image time: {asset['timesHours'][t]:g} h; Z slice {view['z']}.
The 2D screen measurement is a separate endpoint field at 48 h; not this volume slice.</p>
<h2>Review</h2><pre>{esc(json.dumps(review, indent=2))}</pre>
<h2>Provenance and methods</h2><pre>{esc(json.dumps(catalog['provenance'], indent=2))}</pre>
<p>No claim of efficacy, safety, viability, selectivity or mechanism of action.
No independent biological replicates. This export contains data, not access credentials.</p>
</html>"""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("report.html", report)
        archive.writestr("measurements.csv", table.getvalue())
        archive.writestr("selected-slice.png", image)
        archive.writestr("provenance.json", json.dumps(manifest, indent=2, allow_nan=False))
        archive.writestr("citations.txt", "\n".join(catalog["provenance"]["citations"]))
    return out.getvalue()
