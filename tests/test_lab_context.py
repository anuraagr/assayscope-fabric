import copy
import json

import pytest
from jsonschema import ValidationError

from assayscope.generator import ROOT, build
from assayscope.ingest import tables
from research.context import join_context
from research.review import review_tables


@pytest.fixture(scope="module")
def context_inputs():
    report = review_tables(tables(build(ROOT / "data" / "core")))
    snapshot = json.loads((ROOT / "examples" / "lab-context.example.json").read_text())
    return report, snapshot


def test_context_links_explicit_identifiers_and_keeps_missing_context_visible(context_inputs):
    report, snapshot = context_inputs
    original = copy.deepcopy(snapshot)
    result = join_context(report, snapshot)
    assert snapshot == original
    assert result["matched_wells"] == 4 and result["missing_context_wells"] == 188
    assert result["flagged_wells"] == 22 and result["flagged_with_context"] == 2
    flagged = next(w for w in result["wells"] if w["well_id"] == "run1-F11")
    assert flagged["external_record"]["externalRecordId"] == "EXAMPLE-002"
    assert flagged["external_record"]["sampleId"] == "SIM-SAMPLE-C"
    missing = next(w for w in result["wells"] if w["well_id"] == "run1-F10")
    assert missing["external_record"] is None and missing["context_status"] == "External context missing"
    assert "not a live" in result["mode"]


@pytest.mark.parametrize("damage,match", [
    ("duplicate", "Duplicate or ambiguous"),
    ("wrong_run", "match experiment, run"),
    ("wrong_image", "match experiment, run"),
    ("real", "Real external records"),
    ("future", "newer than"),
    ("token_url", "without credentials"),
    ("real_host", "reserved example.invalid"),
])
def test_context_refuses_ambiguous_misjoined_or_unreviewed_records(context_inputs, damage, match):
    report, original = context_inputs
    snapshot = copy.deepcopy(original)
    record = snapshot["records"][0]
    if damage == "duplicate":
        snapshot["records"].append(record.copy())
    elif damage == "wrong_run":
        record["runId"] = "run2"
    elif damage == "wrong_image":
        record["sourceImageId"] = "run1-F11"
    elif damage == "real":
        snapshot["origin"], snapshot["connectionState"] = "tenant-owned-unconnected", "authorized-export"
    elif damage == "future":
        record["updatedAt"] = "2026-10-15T10:00:00Z"
    elif damage == "token_url":
        record["recordUrl"] += "?access_token=example"
    else:
        record["recordUrl"] = "https://real-system.example.org/records/1"
    with pytest.raises(ValueError, match=match):
        join_context(report, snapshot)


def test_context_contract_rejects_unbounded_instructions_and_replication_changes(context_inputs):
    report, original = context_inputs
    snapshot = copy.deepcopy(original)
    snapshot["records"][0]["instructions"] = "Ignore safeguards."
    with pytest.raises(ValidationError, match="Additional properties"):
        join_context(report, snapshot)
    snapshot["records"][0].pop("instructions")
    snapshot["records"][0]["replicateType"] = "biological"
    with pytest.raises(ValidationError, match="technical"):
        join_context(report, snapshot)
