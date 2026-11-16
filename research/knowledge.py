"""Prepare bounded, source-linked research tables and supported Fabric knowledge definitions."""

import argparse
import base64
import hashlib
import json
import re
import uuid
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .context import join_context
from .review import read_local_tables, review_tables

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "assayscope_knowledge_"
NAMESPACE = uuid.UUID("c19a70cc-6526-4842-ab4a-4fd33b5a6052")
ENTITY_NAMES = {
    "experiments": "Experiment", "runs": "Acquisition", "wells": "WellMeasurement",
    "images": "Image", "qc": "QCObservation", "context": "ExternalLabRecord",
    "conditions": "ConditionSummary",
}
KEYS = {
    "experiments": "experiment_id", "runs": "run_key", "wells": "well_key",
    "images": "image_key", "qc": "well_key", "context": "context_key",
    "conditions": "condition_key",
}
RELATIONSHIPS = (
    ("AcquisitionInExperiment", "runs", "experiment_id", "experiments", "experiment_id"),
    ("MeasurementInAcquisition", "wells", "run_key", "runs", "run_key"),
    ("MeasurementUsesImage", "wells", "image_key", "images", "image_key"),
    ("QCForMeasurement", "qc", "well_key", "wells", "well_key"),
    ("ContextForMeasurement", "context", "well_key", "wells", "well_key"),
    ("ConditionInAcquisition", "conditions", "run_key", "runs", "run_key"),
)
COLUMN_DESCRIPTIONS = {
    "source_system": "The literal external source name, for example Example LIMS export. Never substitute connection_state for this field.",
    "connection_state": "example-only means fictional export records and no live external LIMS connection. This is not a source-system name.",
    "snapshot_sha256": "SHA-256 of the entire external example-context snapshot, not an image hash. Return all 64 characters when citing.",
    "source_sha256": "SHA-256 of the original source image, not the external-context snapshot. Return the complete stored value.",
    "sha256": "SHA-256 of this canonical image, not a context snapshot.",
    "included_mean_percent": "Descriptive mean reporter percentage after QC within this run. Null means not estimable. This is not a validated hit metric.",
    "all_measured_mean_percent": "Descriptive mean reporter percentage before QC exclusions using that scenario's vehicle denominator. Not efficacy or viability.",
    "estimable_n": "Technical wells with an estimable same-run control denominator, never cells, timepoints or biological replicates.",
    "data_origin": "Always Simulated screening experiment for these tables. Fabric hosting does not change the data origin.",
    "flags": "Observed image-quality properties; these are not proven acquisition root causes or biological conclusions.",
}


def stable_id(name):
    return str(uuid.uuid5(NAMESPACE, name))


def _key(*parts):
    return json.dumps(parts, ensure_ascii=True, separators=(",", ":"), allow_nan=False)


def knowledge_tables(tables, snapshot):
    report = review_tables(tables)
    context = join_context(report, snapshot)
    experiment_id = report["experiment_id"]
    metadata = {
        "experiment_id": experiment_id, "data_origin": report["origin"],
        "input_tables_sha256": report["input_tables_sha256"], "code_version": report["code_version"],
        "qc_thresholds_json": json.dumps(report["thresholds"], sort_keys=True),
    }
    acquisitions = {row["id"]: row for row in tables["assayscope_acquisitions"]}
    original = {row["well_id"]: row for row in tables["assayscope_measurements"]}
    rows = {
        "experiments": [{
            **metadata, "title": report["title"],
            "question": tables["assayscope_experiments"][0]["question"],
            "n_definition": report["n_definition"],
            "external_connection_state": "Unconnected; fictional example export only",
        }],
        "runs": [{
            **metadata, **run, "run_key": _key(experiment_id, run["run_id"]),
            "instrument": acquisitions[run["run_id"]]["instrument"],
            "acquired_at": acquisitions[run["run_id"]]["acquiredAt"],
        } for run in report["runs"]],
        "wells": [{
            **metadata, **{key: value for key, value in well.items() if key != "flags"},
            "well_key": _key(experiment_id, well["well_id"]),
            "run_key": _key(experiment_id, well["run_id"]),
            "image_key": _key(experiment_id, well["source_image_id"]),
            "flags": "; ".join(well["flags"]), "flagged": bool(well["flags"]),
            "object_count": original[well["well_id"]]["object_count"],
            "focus_score": original[well["well_id"]]["focus_score"],
            "saturation_fraction": original[well["well_id"]]["saturation_fraction"],
            "illumination_cv": original[well["well_id"]]["illumination_cv"],
        } for well in report["well_evidence"]],
        "images": [{
            **metadata, **row, "image_key": _key(experiment_id, row["image_id"]),
        } for row in tables["assayscope_provenance"]],
        "qc": [{
            **metadata, "well_key": _key(experiment_id, well["well_id"]),
            "well_id": well["well_id"], "run_id": well["run_id"],
            "flags": "; ".join(well["flags"]), "flagged": bool(well["flags"]),
            "included": well["included"], "measured": well["measured"],
        } for well in report["well_evidence"]],
        "context": [],
        "conditions": [{
            **metadata, **{key: value for key, value in row.items() if key != "included_well_ids"},
            "condition_key": _key(experiment_id, row["run_id"], row["compound"], row["dose_um"]),
            "run_key": _key(experiment_id, row["run_id"]),
            "included_well_ids_json": json.dumps(row["included_well_ids"]),
        } for row in report["conditions"]],
    }
    for well in context["wells"]:
        record = well["external_record"]
        if record is None:
            continue
        rows["context"].append({
            **metadata, "well_key": _key(experiment_id, well["well_id"]),
            "context_key": _key(context["source_system"], record["externalRecordId"], record["recordVersion"]),
            "well_id": well["well_id"], "run_id": well["run_id"],
            "external_record_id": record["externalRecordId"], "record_version": record["recordVersion"],
            "source_system": context["source_system"], "sample_id": record["sampleId"],
            "batch_id": record["batchId"], "protocol_id": record["protocolId"],
            "protocol_version": record["protocolVersion"], "record_url": record["recordUrl"],
            "exported_at": context["snapshot_exported_at"], "updated_at": record["updatedAt"],
            "snapshot_sha256": context["snapshot_sha256"], "connection_state": "example-only",
        })
    for name, records in rows.items():
        if not 1 <= len(records) <= 10000:
            raise ValueError(f"{name} must have bounded, nonempty records.")
        if len({row[KEYS[name]] for row in records}) != len(records):
            raise ValueError(f"Duplicate knowledge entity key in {name}.")
    for _, source, column, target, key in RELATIONSHIPS:
        target_keys = {row[key] for row in rows[target]}
        if any(row[column] not in target_keys for row in rows[source]):
            raise ValueError(f"Broken knowledge relationship: {source} -> {target}.")
    return {f"{PREFIX}{name}": records for name, records in rows.items()}


def _types(table):
    result = {}
    for field in table.schema:
        if pa.types.is_string(field.type):
            kind = "string"
        elif pa.types.is_boolean(field.type):
            kind = "boolean"
        elif pa.types.is_integer(field.type):
            kind = "int64"
        elif pa.types.is_floating(field.type):
            kind = "double"
        else:
            raise ValueError(f"Unsupported knowledge column type: {field.name} / {field.type}")
        result[field.name] = kind
    return result


def prepare(directory, snapshot_path, output):
    if snapshot_path.is_symlink() or snapshot_path.stat().st_size > 8 * 1024 ** 2:
        raise ValueError("Context snapshot must be a regular local file below 8 MiB.")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    tables = knowledge_tables(read_local_tables(directory), snapshot)
    output.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, rows in tables.items():
        table = pa.Table.from_pylist(rows)
        path = output / f"{name}.parquet"
        pq.write_table(table, path, compression="snappy")
        manifest.append({
            "table": name, "file": path.name, "rows": len(rows),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "columns": _types(table),
        })
    (output / "tables.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output / "expected.json").write_text(json.dumps(tables, allow_nan=False) + "\n", encoding="utf-8")
    (output / "context-snapshot.json").write_text(
        json.dumps(snapshot, ensure_ascii=True, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return manifest


def validate_target(target):
    for field in ("workspaceId", "lakehouseId", "sqlDatabase"):
        value = target.get(field)
        if not isinstance(value, str) or str(uuid.UUID(value)) != value.lower() or uuid.UUID(value).int == 0:
            raise ValueError(f"Knowledge target requires a resolved {field} GUID.")
    if not re.fullmatch(r"[a-z0-9-]+\.datawarehouse\.fabric\.microsoft\.com", target.get("sqlEndpoint", ""), re.I):
        raise ValueError("Knowledge target requires the resolved Fabric SQL endpoint.")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", target.get("environment", "")):
        raise ValueError("Knowledge target requires a safe environment slug.")
    if not isinstance(target.get("lakehouseName"), str) or not re.fullmatch(r"[A-Za-z0-9_]{1,128}", target["lakehouseName"]):
        raise ValueError("Knowledge target requires a safe resolved Lakehouse name.")


def _part(path, content):
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    return {"path": path, "payload": base64.b64encode(content.encode()).decode(),
            "payloadType": "InlineBase64"}


def ontology_definition(target, manifest):
    validate_target(target)
    name = f"assayscope_{target['environment'].replace('-', '_')}_ontology"
    parts = [
        _part(".platform", {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
            "metadata": {"type": "Ontology", "displayName": name},
            "config": {"version": "2.0", "logicalId": stable_id("ontology")},
        }),
        _part("database.tmdl", "database AssayScope\n\tcompatibilityLevel: 1000000\n"),
        _part("namespaces/default.tmdl", "namespace default\n\tlineageTag: default\n"),
        _part("expressions.tmdl",
              f'expression DatabaseQuery =\n\t\tlet\n\t\t\tdatabase = Sql.Database("{target["sqlEndpoint"]}", "{target["sqlDatabase"]}")\n'
              f"\t\tin\n\t\t\tdatabase\n\tlineageTag: {stable_id('DatabaseQuery')}\n"),
    ]
    refs = ["model AssayScope", "", "ref namespace default"]
    for item in manifest:
        table = item["table"]
        suffix = table.removeprefix(PREFIX)
        entity = ENTITY_NAMES[suffix]
        columns = item["columns"]
        if KEYS[suffix] not in columns:
            raise ValueError("Knowledge entity has no key column.")
        table_lines = [f"table {table}", f"\tlineageTag: {stable_id(table)}",
                       f"\tsourceLineageTag: [dbo].[{table}]"]
        entity_lines = [
            f"/// {entity} for the simulated research study; no live external LIMS is connected.",
            f"entity {entity}", f"\tlineageTag: {stable_id(entity)}",
            f"\tbackingTable: {table}", f"\tkeyProperty: {KEYS[suffix]}",
        ]
        for column, kind in columns.items():
            if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", column):
                raise ValueError("Unsafe knowledge column identifier.")
            table_lines.extend([
                "", f"\tcolumn {column}", f"\t\tdataType: {kind}",
                f"\t\tlineageTag: {stable_id(f'{table}.{column}')}", f"\t\tsourceColumn: {column}",
                "\t\tsummarizeBy: none",
            ])
            entity_lines.extend([
                "", f"\tproperty {column}", f"\t\tdataType: {kind}",
                f"\t\tlineageTag: {stable_id(f'{entity}.{column}')}",
                "\t\tbackingConfiguration", f"\t\t\tvalueColumn: {table}.{column}",
            ])
        table_lines.extend([
            "", f"\tpartition {table} = entity", "\t\tmode: directLake", "\t\tsource",
            f"\t\t\tentityName: {table}", "\t\t\tschemaName: dbo",
            "\t\t\texpressionSource: DatabaseQuery",
        ])
        parts += [_part(f"tables/{table}.tmdl", "\n".join(table_lines) + "\n"),
                  _part(f"entities/{entity}.tmdl", "\n".join(entity_lines) + "\n")]
        refs += [f"ref table {table}", f"ref entity {entity}"]
    relationships, entity_relationships = [], []
    for name, source, column, target_table, key in RELATIONSHIPS:
        relationships.extend([
            f"relationship {name}", f"\tfromColumn: {PREFIX}{source}.{column}",
            f"\ttoColumn: {PREFIX}{target_table}.{key}", "\tcrossFilteringBehavior: oneDirection", "",
        ])
        entity_relationships.extend([
            f"entityRelationship {name}", f"\tlineageTag: {stable_id(name)}",
            f"\tfromEntity: {ENTITY_NAMES[source]}", f"\ttoEntity: {ENTITY_NAMES[target_table]}",
            "\tbackingConfiguration", f"\t\trelationship: {name}", "",
        ])
    parts += [_part("relationships.tmdl", "\n".join(relationships)),
              _part("entityRelationships.tmdl", "\n".join(entity_relationships))]
    rules = {
        "TechnicalReplication": (
            "n counts included technical wells within one condition and run. Objects and timepoints do not increase n. Do not pool runs as biological replicates.",
            ["WellMeasurement", "ConditionSummary", "Acquisition"],
        ),
        "ScientificInterpretation": (
            "This is simulated research evidence. QC flags are observations, not causal diagnoses. Do not infer efficacy, viability, toxicity, mechanism or a forced IC50.",
            ["QCObservation", "WellMeasurement", "Experiment"],
        ),
        "ExternalContextBoundary": (
            "ExternalLabRecord is a fictional example export, not a live LIMS connection. Missing mappings stay missing. Source relationships do not grant access or authorize writes.",
            ["ExternalLabRecord", "Image"],
        ),
    }
    for name, (statement, entities) in rules.items():
        parts.append(_part(
            f"rules/{name}.tmdl",
            f"rule {name}\n\tlineageTag: {stable_id(name)}\n\tstatement: {statement}\n"
            + "".join(f"\truleReferencedEntity {entity}\n" for entity in entities),
        ))
        refs.append(f"ref rule {name}")
    parts.append(_part("model.tmdl", "\n".join(refs) + "\n"))
    return {"parts": parts}


def data_agent_definition(target, manifest, publish=False):
    validate_target(target)
    instructions = (ROOT / "knowledge" / "data-agent-instructions.md").read_text(encoding="utf-8")
    instructions = instructions.split("## Runtime instructions\n", 1)[-1]
    definitions = {"Files/Config/data_agent.json": {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/definition/dataAgent/2.1.0/schema.json",
    }}
    examples = json.loads((ROOT / "knowledge" / "query-examples.json").read_text(encoding="utf-8"))
    source = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/definition/dataSource/1.0.0/schema.json",
        "artifactId": target["lakehouseId"], "workspaceId": target["workspaceId"],
        "displayName": target["lakehouseName"], "type": "lakehouse",
        "dataSourceInstructions": (
            "Use only the seven selected assayscope_knowledge_* tables. They contain validated, "
            "precomputed same-run statistics and source lineage. Do not recompute normalized values "
            "from an unreviewed formula. Every external context row is example-only, not a live connection. "
            "Use a LEFT JOIN for context so missing mappings remain visible. ReviewDecision is not selected."
        ),
        "elements": [{
            "display_name": "dbo", "type": "lakehouse_tables.schema", "is_selected": True,
            "children": [{
                "display_name": item["table"], "type": "lakehouse_tables.table", "is_selected": True,
                "children": [{
                    "display_name": column, "type": "lakehouse_tables.column",
                    "data_type": kind, "is_selected": True,
                    **({"description": COLUMN_DESCRIPTIONS[column]} if column in COLUMN_DESCRIPTIONS else {}),
                } for column, kind in item["columns"].items()],
            } for item in manifest],
        }],
    }
    for stage in (["draft", "published"] if publish else ["draft"]):
        definitions[f"Files/Config/{stage}/stage_config.json"] = {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/definition/stageConfiguration/1.0.0/schema.json",
            "aiInstructions": instructions,
        }
        folder = f"Files/Config/{stage}/lakehouse-{target['lakehouseName']}"
        definitions[f"{folder}/datasource.json"] = source
        definitions[f"{folder}/fewshots.json"] = {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/definition/fewShots/1.0.0/schema.json",
            "fewShots": [{"id": stable_id(example["id"]), "question": example["question"],
                          "query": example["query"]} for example in examples],
        }
    if publish:
        definitions["Files/Config/publish_info.json"] = {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/definition/publishInfo/1.0.0/schema.json",
            "description": "Read-only simulated microscopy evidence and explicitly fictional LIMS-export context.",
        }
    return {"parts": [_part(path, content) for path, content in definitions.items()]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tables", type=Path, default=ROOT / "data" / "core" / "tables")
    parser.add_argument("--snapshot", type=Path, default=ROOT / "examples" / "lab-context.example.json")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "knowledge")
    parser.add_argument("--target", type=Path)
    parser.add_argument("--definitions-out", type=Path)
    parser.add_argument("--publish-agent", action="store_true")
    args = parser.parse_args()
    manifest = prepare(args.tables, args.snapshot, args.out)
    if args.target:
        if args.definitions_out is None:
            parser.error("--target requires an explicit --definitions-out inside ignored deployment state.")
        target = json.loads(args.target.read_text(encoding="utf-8-sig"))
        args.definitions_out.mkdir(parents=True, exist_ok=True)
        for name, definition in (
            ("ontology", ontology_definition(target, manifest)),
            ("data-agent", data_agent_definition(target, manifest, args.publish_agent)),
        ):
            content = json.dumps({"definition": definition}, indent=2, allow_nan=False) + "\n"
            (args.definitions_out / f"{name}.json").write_text(content, encoding="utf-8")
    print(json.dumps({"tables": [{k: row[k] for k in ("table", "rows", "sha256")} for row in manifest],
                      "externalConnection": "Unconnected; fictional example export only"}, indent=2))


if __name__ == "__main__":
    main()
