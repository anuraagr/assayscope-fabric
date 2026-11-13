import base64
import copy
import json

import pyarrow as pa
import pytest

from assayscope.generator import ROOT, build
from assayscope.ingest import tables
from research.knowledge import (
    ENTITY_NAMES,
    KEYS,
    PREFIX,
    RELATIONSHIPS,
    _types,
    data_agent_definition,
    knowledge_tables,
    ontology_definition,
    stable_id,
    validate_target,
)
from research.review import review_tables


@pytest.fixture(scope="module")
def knowledge():
    analytical = tables(build(ROOT / "data" / "core"))
    snapshot = json.loads((ROOT / "examples" / "lab-context.example.json").read_text())
    prepared = knowledge_tables(analytical, snapshot)
    manifest = [
        {"table": name, "rows": len(rows), "columns": _types(pa.Table.from_pylist(rows))}
        for name, rows in prepared.items()
    ]
    return analytical, prepared, manifest


def target():
    return {
        "workspaceId": "11111111-1111-4111-8111-111111111111",
        "lakehouseId": "22222222-2222-4222-8222-222222222222",
        "sqlDatabase": "33333333-3333-4333-8333-333333333333",
        "sqlEndpoint": "testendpoint.datawarehouse.fabric.microsoft.com",
        "environment": "unit-test", "lakehouseName": "assayscope_unit_test",
    }


def decoded(definition):
    return {
        part["path"]: base64.b64decode(part["payload"], validate=True).decode()
        for part in definition["parts"]
    }


def test_curated_rows_preserve_reduction_lineage_and_external_origin(knowledge):
    analytical, prepared, _ = knowledge
    expected = review_tables(analytical)
    assert {name.removeprefix(PREFIX): len(rows) for name, rows in prepared.items()} == {
        "experiments": 1, "runs": 2, "wells": 192, "images": 198, "qc": 192,
        "context": 4, "conditions": 48,
    }
    for row in prepared[f"{PREFIX}conditions"]:
        original = next(g for g in expected["conditions"] if g["run_id"] == row["run_id"]
                        and g["compound"] == row["compound"] and g["dose_um"] == row["dose_um"])
        for field in ("estimable_n", "included_mean_percent", "included_sd_percent",
                      "all_measured_mean_percent", "change_percentage_points"):
            assert row[field] == original[field]
    assert all(r["connection_state"] == "example-only" for r in prepared[f"{PREFIX}context"])
    assert all(r["record_url"].startswith("https://lims.example.invalid/")
               for r in prepared[f"{PREFIX}context"])
    for name, rows in prepared.items():
        assert len({row[KEYS[name.removeprefix(PREFIX)]] for row in rows}) == len(rows)
        assert all(row["data_origin"] == "Simulated screening experiment" for row in rows)
    for _, source, column, destination, key in RELATIONSHIPS:
        assert {r[column] for r in prepared[PREFIX + source]} <= {r[key] for r in prepared[PREFIX + destination]}
    flagged = next(r for r in prepared[PREFIX + "wells"] if r["well_id"] == "run1-F11")
    assert not flagged["included"] and flagged["flags"] == "Low focus"
    assert flagged["normalized_percent"] > 0


def test_ontology_uses_current_tmdl_bound_tables_keys_and_six_relationships(knowledge):
    _, _, manifest = knowledge
    definitions = decoded(ontology_definition(target(), manifest))
    assert len([p for p in definitions if p.startswith("entities/")]) == 7
    assert len([p for p in definitions if p.startswith("tables/")]) == 7
    assert "compatibilityLevel: 1000000" in definitions["database.tmdl"]
    assert "ref namespace default" in definitions["model.tmdl"]
    assert "testendpoint.datawarehouse.fabric.microsoft.com" in definitions["expressions.tmdl"]
    assert not any(path.startswith("EntityTypes/") for path in definitions)
    for suffix, entity in ENTITY_NAMES.items():
        text = definitions[f"entities/{entity}.tmdl"]
        assert f"keyProperty: {KEYS[suffix]}" in text
        assert f"backingTable: {PREFIX}{suffix}" in text
    assert definitions["entityRelationships.tmdl"].count("entityRelationship ") == 6
    assert definitions == decoded(ontology_definition(target(), manifest))


def test_agent_selection_and_publishing_never_include_private_or_arbitrary_sources(knowledge):
    _, _, manifest = knowledge
    draft = decoded(data_agent_definition(target(), manifest))
    assert not any("/published/" in key or "publish_info" in key for key in draft)
    published = decoded(data_agent_definition(target(), manifest, publish=True))
    assert "Files/Config/publish_info.json" in published
    for stage in ("draft", "published"):
        source = json.loads(published[f"Files/Config/{stage}/lakehouse-assayscope_unit_test/datasource.json"])
        assert source["artifactId"] == target()["lakehouseId"]
        assert source["workspaceId"] == target()["workspaceId"]
        assert {table["display_name"] for table in source["elements"][0]["children"]} == {
            item["table"] for item in manifest
        }
        assert all(table["is_selected"] for table in source["elements"][0]["children"])
        instructions = json.loads(published[f"Files/Config/{stage}/stage_config.json"])["aiInstructions"]
        assert "## Runtime instructions" not in instructions
        assert "do not" in instructions.lower() and "example-only" in instructions


@pytest.mark.parametrize("field,value", [
    ("workspaceId", "../another-workspace"),
    ("sqlEndpoint", 'attacker.invalid"; injected'),
    ("sqlDatabase", "00000000-0000-0000-0000-000000000000"),
    ("environment", "../outside"),
    ("lakehouseName", "arbitrary/path"),
])
def test_knowledge_target_rejects_unresolved_or_injectable_coordinates(field, value):
    invalid = copy.deepcopy(target())
    invalid[field] = value
    with pytest.raises(ValueError):
        validate_target(invalid)


def test_knowledge_ids_and_example_queries_are_stable_bounded_and_read_only():
    assert stable_id("Experiment") == stable_id("Experiment")
    assert stable_id("Experiment") != stable_id("Image")
    queries = json.loads((ROOT / "knowledge" / "query-examples.json").read_text())
    assert len({row["id"] for row in queries}) == 5
    for row in queries:
        assert row["query"].startswith("SELECT TOP (")
        assert "ORDER BY" in row["query"]
        assert "spheroid-screen-001" in row["query"]
        assert "ReviewDecision" not in row["query"]
    assert "LEFT JOIN" in next(q["query"] for q in queries if q["id"] == "flagged-context")
