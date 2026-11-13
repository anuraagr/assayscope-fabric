"""Generate a credential-free Fabric notebook from the tested shared research functions."""

import argparse
import hashlib
import inspect
import json
from pathlib import Path

from assayscope.analysis import QCThresholds, qc_flags, summarize
from research import review

ROOT = Path(__file__).resolve().parents[1]


def notebook():
    shared = [
        QCThresholds, qc_flags, summarize, review._text, review._number, review._index,
        review.validate_tables, review.review_tables, review._format, review._table, review.report_html,
    ]
    code = "import hashlib\nimport html\nimport json\nimport math\nimport re\n"
    code += "from dataclasses import asdict, dataclass\nimport numpy as np\n\n"
    code += f"TABLE_NAMES = {review.TABLE_NAMES!r}\nMAX_ROWS = {review.MAX_ROWS}\n"
    code += f"METRICS = {review.METRICS!r}\n\n"
    code += "\n\n".join(inspect.getsource(item) for item in shared)

    def cell(kind, identifier, source):
        value = {"cell_type": kind, "id": identifier, "metadata": {},
                 "source": source.splitlines(keepends=True)}
        if kind == "code":
            value.update(execution_count=None, outputs=[])
        return value

    return {
        "nbformat": 4, "nbformat_minor": 5,
        "metadata": {
            "kernel_info": {"name": "synapse_pyspark"},
            "kernelspec": {"display_name": "Synapse PySpark", "language": "python",
                           "name": "synapse_pyspark"},
            "language_info": {"name": "python"},
            "assayscope": {"shared_source_sha256": hashlib.sha256(code.encode()).hexdigest(),
                          "read_only": True, "origin": "Simulated screening experiment"},
        },
        "cells": [
            cell("markdown", "purpose", """# AssayScope research review

**Research only. Simulated screening experiment. Read-only.**

Review control dispersion, QC exclusion sensitivity, technical replication and source lineage.
This notebook reads the five AssayScope Delta tables in its attached Lakehouse. It does not
change tables, images or review decisions. The generated code is the same tested reduction
used by the local research report; it is not a second scientific implementation.

Deploy with `npm run fabric:research:apply -- --config config/tenant.local.json --confirm-costs`.
That command binds the existing Lakehouse and does **not** start Spark. Run explicitly when
ready. Execution consumes existing Fabric capacity; no schedule or additional service is created.
The notebook needs separate Lakehouse read access; app-viewer permission alone is insufficient.

Keep outputs inside your authorized workspace. Do not commit notebook outputs or tenant bindings.
"""),
            cell("code", "parameters", 'EXPERIMENT_ID = "spheroid-screen-001"\n'),
            cell("markdown", "methods", """## Shared analytical rules

Normalization is within run against included vehicle wells. n is technical wells, not cells,
timepoints or biological replicates. Missing/zero controls remain not estimable. Sample SD
requires at least two wells. Before/after QC uses each scenario's own eligible controls.
No IC50, Z-prime, p-value or biological conclusion is inferred.

The following cell is generated from repository source. Edit the source and regenerate it,
rather than maintaining a separate notebook calculation.
"""),
            cell("code", "shared-analysis", code),
            cell("markdown", "read-boundary", """## Read bounded analytical records

The Lakehouse attachment is set at deployment, not hardcoded in source. Each table read is
filtered to the registered experiment and limited to 10,001 records so an oversized input
fails before collection grows without bound. No network download, model or private generator
truth is used. Missing tables, joins, QC consistency or source versions are errors.
"""),
            cell("code", "read-tables", """from pyspark.sql import functions as F

tables = {}
for name in TABLE_NAMES:
    key = "id" if name == "assayscope_experiments" else "experiment_id"
    frame = spark.table(name).where(F.col(key) == F.lit(EXPERIMENT_ID)).limit(MAX_ROWS + 1)
    tables[name] = [row.asDict(recursive=True) for row in frame.collect()]
report = review_tables(tables, EXPERIMENT_ID)
"""),
            cell("code", "review-output", """from IPython.display import HTML, display

display(HTML(report_html(report)))
print(json.dumps({
    "experiment_id": report["experiment_id"],
    "input_tables_sha256": report["input_tables_sha256"],
    "table_rows": report["table_rows"],
    "runs": report["runs"],
}, indent=2, allow_nan=False))
"""),
            cell("markdown", "next-review", """## Scientific review

1. Check control count and dispersion separately for each run. CV is descriptive, not a
   validated acceptance threshold.
2. Compare before/after QC means together with included well counts and the changed control
   denominator. Missing response is not zero response.
3. Inspect each flagged well in the workbench, including original intensities and source hash.
4. Record any repeat-acquisition or confirmatory-study decision explicitly in AssayScope.
   The notebook never saves or changes that decision.

For a real assay, review metadata, controls, thresholds, segmentation validity and biological
replicate design first. This notebook deliberately refuses real or unspecified-origin rows.
"""),
            cell("code", "execution-receipt", """from notebookutils import mssparkutils

mssparkutils.notebook.exit(json.dumps({
    "experiment_id": report["experiment_id"],
    "input_tables_sha256": report["input_tables_sha256"],
    "code_version": report["code_version"],
    "table_rows": report["table_rows"],
    "runs": report["runs"],
    "condition_count": len(report["conditions"]),
    "flagged_well_count": sum(bool(row["flags"]) for row in report["well_evidence"]),
}, allow_nan=False))
"""),
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = ROOT / "notebooks" / "research-review.ipynb"
    content = json.dumps(notebook(), indent=2, ensure_ascii=True) + "\n"
    if args.check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            raise SystemExit("Research notebook is stale. Run python -m scripts.build_research_notebook.")
        print("Research notebook matches the shared, tested source.")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"Generated {path.relative_to(ROOT)} without outputs or tenant bindings.")


if __name__ == "__main__":
    main()
