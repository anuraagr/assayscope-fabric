# Deploy the research ontology and data agent

This optional extension reuses the already configured AssayScope workspace, Lakehouse,
identity and capacity. It adds seven small curated tables, a new-experience TMDL ontology
and a read-only Fabric data agent. It does not modify the five original scientific tables,
upload public originals, expose private reviews, connect a real LIMS or grant permissions.

## Prerequisites

Complete the [base deployment](deployment.md) first. Use Node 24 and the existing Python
3.12 environment. The configured user must already have an appropriate workspace
author role, Lakehouse access and access to the relevant Fabric IQ/data-agent features.
Tenant/capacity policies and current regional availability must permit the operations.
The scripts never enable these settings or obtain new consent.

The data agent uses the tenant-managed service; no separate Foundry project or model
resource is deployed. Model calls and other processing still consume Fabric resources.

## Preview, apply, publish, verify

```powershell
npm run fabric:knowledge:plan -- --offline
npm run fabric:knowledge:plan -- --config config\tenant.local.json
npm run fabric:knowledge:apply -- --config config\tenant.local.json --confirm-costs
npm run fabric:knowledge:publish -- --config config\tenant.local.json --confirm-costs
npm run fabric:knowledge:smoke -- --config config\tenant.local.json
npm run fabric:knowledge:evaluate -- --config config\tenant.local.json --confirm-costs
```

The live plan resolves the actual workspace/capacity, Lakehouse and SQL endpoint, then
generates environment-specific definitions under ignored deployment state. Review the
exact scope before apply. The plan itself performs no cloud writes.

Apply validates the existing prefix's ownership, checks for unowned table/item name
collisions, uploads only the seven bounded Parquet files and loads the curated tables.
SQL metadata can lag Lakehouse table loading; only that specific missing-table condition
has a bounded synchronization wait. Permission failures and mismatched values fail.
All **637 rows** are compared with local image-derived output before managed definitions
are deployed. Fixed query examples are also executed against real SQL.

The ontology uses the current generation-2 TMDL definition, not the retired JSON-tree
experience. It has seven entities, six explicit relationships, stable keys/lineage tags
and scientific rules. Original images and raw analytical rows remain authoritative.

The data agent has **one Lakehouse source with exactly seven selected tables**. Private
`ReviewDecision`, generator truth and arbitrary Files access are excluded. It uses
precomputed within-run summaries rather than inventing normalization formulas.
Its source is the curated Lakehouse; the ontology uses the same source relationships.
Do not claim a direct ontology-to-agent source binding unless that separate route has
been configured and verified.

Apply creates a draft. Publish installs the reviewed version for consumption **inside
the authorized tenant**; it does not grant access or make anything anonymous.
Definition read-back verifies the actual source coordinates and table allowlist.
External edits stop automatic replacement rather than being overwritten.

## Table and entity inventory

| Table suffix under `assayscope_knowledge_` | Rows | Ontology entity |
|---|---:|---|
| `experiments` | 1 | Experiment |
| `runs` | 2 | Acquisition |
| `wells` | 192 | WellMeasurement |
| `images` | 198 | Image |
| `qc` | 192 | QCObservation |
| `context` | 4 | ExternalLabRecord |
| `conditions` | 48 | ConditionSummary |

Keys encode the registered study plus the source identity; well names alone never join
studies. Context records retain `connection_state = example-only`, external record/version,
export timestamp and snapshot hash. All 188 unmatched wells remain without external
context; no missing sample identity is inferred.

The **data projection is regenerated from the tested shared reduction** by
`python -m research.knowledge`. It preserves non-estimable nulls, original measurements,
technical n, exclusions and processing hashes. No learned model is used to prepare data.

## Actual model evaluation is a separate gate

Smoke checks SQL and persisted definitions. Evaluate uses the documented published
Fabric data-agent **MCP** endpoint: initialization, tool discovery and bounded questions.
The retired OpenAI Assistants sample is not used. Tokens are obtained through the guarded
Azure CLI helper, kept in memory and restored/cleared after use.

The client supports JSON and SSE responses, checks request IDs, bounds response size
and duration, never follows redirects and never automatically repeats a model request.
It saves actual answers in ignored `test-results/data-agent-runtime.json`.
Inspect responses against [evaluation cases](../knowledge/evaluation.json) and deterministic
source values. Collected answers are not automatically labeled correct.

Examples test run accounting, QC-confounded conditions, missing/existing external
context, private-review/write refusal, untrusted record text and public-study separation.
A separate unauthorized identity is still needed for an independent authorization test.

## Access, reruns and cleanup

App permission, notebook permission, ontology access, data-agent access and Lakehouse
read access are distinct. An ontology relationship or instruction cannot grant any of them.
No workspace Contributor role is granted to app viewers.

State records created ontology/data-agent IDs, source hashes and read-back hashes.
Reruns reuse unchanged owned tables and definitions, then verify actual values.
Same-name unowned resources and externally edited definitions require review.
Managed item creation is not automatically repeated after an ambiguous error.

[Cleanup](cleanup.md) previews exact recorded resources and deletes knowledge items
before the notebook/app and owned Lakehouse only after explicit confirmation. Adopted
items are not cleanup-owned. Preserve required notebook/agent evidence before deletion.

## References and evidence

The [verification record](verification.md) is authoritative for the actual deployed
status and remaining gates.

- [Current ontology TMDL definition](https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/ontology-definition)
- [Create ontology](https://learn.microsoft.com/en-us/rest/api/fabric/ontology/items/create-ontology)
- [Data-agent definition](https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/data-agent-definition)
- [Create data agent](https://learn.microsoft.com/en-us/rest/api/fabric/dataagent/items/create-data-agent)
- [Published data-agent MCP protocol](https://learn.microsoft.com/en-us/fabric/data-science/data-agent-mcp-server)
