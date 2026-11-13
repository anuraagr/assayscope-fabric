"""Join an explicitly offline LIMS/ELN snapshot to image-linked research records."""

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import Draft7Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]


def join_context(report, snapshot):
    schema = json.loads((ROOT / "contracts" / "lab-context.schema.json").read_text(encoding="utf-8"))
    Draft7Validator(schema, format_checker=FormatChecker()).validate(snapshot)
    if report.get("origin") != "Simulated screening experiment":
        raise ValueError("This context preview requires the reviewed simulated-assay report.")
    if snapshot["origin"] != "simulated" or snapshot["connectionState"] != "example-only":
        raise ValueError("Real external records cannot be attached to a simulated assay.")
    wells = {row["well_id"]: row for row in report["well_evidence"]}
    if len(wells) != len(report["well_evidence"]) or not 1 <= len(wells) <= 10000:
        raise ValueError("Research well identities must be unique and bounded.")
    exported = datetime.fromisoformat(snapshot["exportedAt"].replace("Z", "+00:00"))
    linked, identities = {}, set()
    for record in snapshot["records"]:
        identity = (snapshot["sourceSystem"], record["externalRecordId"], record["recordVersion"])
        if identity in identities or record["wellId"] in linked:
            raise ValueError("Duplicate or ambiguous external-record/well mapping; choose a reviewed snapshot.")
        identities.add(identity)
        well = wells.get(record["wellId"])
        if (well is None or record["experimentId"] != report["experiment_id"]
                or record["runId"] != well["run_id"]
                or record["sourceImageId"] != well["source_image_id"]):
            raise ValueError("External record must match experiment, run, well and source image exactly.")
        updated = datetime.fromisoformat(record["updatedAt"].replace("Z", "+00:00"))
        if updated > exported:
            raise ValueError("An external record cannot be newer than its declared snapshot export.")
        url = urlsplit(record["recordUrl"])
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.port not in (None, 443) or url.query or url.fragment):
            raise ValueError("External record URLs must be HTTPS without credentials, query or fragment.")
        if not url.hostname.endswith(".example.invalid"):
            raise ValueError("Example context must use a reserved example.invalid host, not a real LIMS.")
        linked[record["wellId"]] = record
    results = []
    for well in sorted(report["well_evidence"], key=lambda row: (row["run_id"], row["well_id"])):
        record = linked.get(well["well_id"])
        results.append({
            "experiment_id": report["experiment_id"], "run_id": well["run_id"],
            "well_id": well["well_id"], "flags": well["flags"],
            "source_image_id": well["source_image_id"], "source_sha256": well["source_sha256"],
            "context_status": "Example record matched" if record else "External context missing",
            "external_record": record,
        })
    encoded = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return {
        "mode": "Offline example context join; not a live LIMS, ontology or data agent",
        "source_system": snapshot["sourceSystem"], "connection_state": snapshot["connectionState"],
        "snapshot_exported_at": snapshot["exportedAt"],
        "snapshot_sha256": hashlib.sha256(encoded).hexdigest(),
        "analytical_input_sha256": report["input_tables_sha256"],
        "matched_wells": len(linked), "missing_context_wells": len(wells) - len(linked),
        "flagged_wells": sum(bool(row["flags"]) for row in results),
        "flagged_with_context": sum(bool(row["flags"]) and row["external_record"] is not None
                                    for row in results),
        "limitations": [
            "No external endpoint is contacted and no record URL is fetched.",
            "Matching sample or batch identifiers does not prove a biological relationship or QC cause.",
            "Missing context remains missing; four example records do not describe the whole plate.",
            "No record, review decision or repeat-acquisition task is created.",
        ],
        "wells": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, default=Path("test-results/research/research-review.json"))
    parser.add_argument("--snapshot", type=Path, default=Path("examples/lab-context.example.json"))
    parser.add_argument("--out", type=Path, default=Path("test-results/research/lab-context-review.json"))
    args = parser.parse_args()
    inputs = []
    for path in (args.review, args.snapshot):
        if path.is_symlink() or path.stat().st_size > 8 * 1024 ** 2:
            raise ValueError("Context inputs must be regular local files of at most 8 MiB.")
        inputs.append(json.loads(path.read_text(encoding="utf-8")))
    result = join_context(*inputs)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Offline example context: {result['matched_wells']} matched wells; "
          f"{result['missing_context_wells']} explicitly missing. No external connection.")


if __name__ == "__main__":
    main()
