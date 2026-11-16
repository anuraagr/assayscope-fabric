"""Validate explicit offline lab records without requesting an external URL."""

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import Draft7Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]


def validate_context(snapshot: dict, experiment_id: str, wells: dict) -> dict:
    schema = json.loads((ROOT / "contracts" / "lab-context.schema.json").read_text(encoding="utf-8"))
    Draft7Validator(schema, format_checker=FormatChecker()).validate(snapshot)
    if snapshot["origin"] != "simulated" or snapshot["connectionState"] != "example-only":
        raise ValueError("Real external records cannot be attached to a simulated assay.")
    exported = datetime.fromisoformat(snapshot["exportedAt"].replace("Z", "+00:00"))
    seen_wells, identities = set(), set()
    for record in snapshot["records"]:
        identity = (snapshot["sourceSystem"], record["externalRecordId"], record["recordVersion"])
        if identity in identities or record["wellId"] in seen_wells:
            raise ValueError("Duplicate or ambiguous external-record/well mapping; choose a reviewed snapshot.")
        well = wells.get(record["wellId"])
        if (well is None or record["experimentId"] != experiment_id
                or record["runId"] != well["run_id"]
                or record["sourceImageId"] != well["source_image_id"]):
            raise ValueError("External record must match experiment, run, well and source image exactly.")
        if datetime.fromisoformat(record["updatedAt"].replace("Z", "+00:00")) > exported:
            raise ValueError("An external record cannot be newer than its declared snapshot export.")
        url = urlsplit(record["recordUrl"])
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.port not in (None, 443) or url.query or url.fragment):
            raise ValueError("External record URLs must be HTTPS without credentials, query or fragment.")
        if not url.hostname.endswith(".example.invalid"):
            raise ValueError("Example context must use a reserved example.invalid host, not a real LIMS.")
        identities.add(identity)
        seen_wells.add(record["wellId"])
    return snapshot
