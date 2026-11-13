# Implementation status

Updated 2026-11-13. AssayScope is an independent research-only repository. The protected
sample deployment uses its dedicated Fabric workspace and an existing capacity; the
portable source contains no deployment coordinates or credentials.

## Delivered

- React/TypeScript workbench with actual multichannel 3D/time arrays, physical sections,
  2D inspection, plate selection, comparison, QC, response evidence and provenance.
- Image-only CPU analysis, separate synthetic evaluation truth, explicit technical-well
  accounting and non-estimable results when controls or fits are unjustified.
- Local FastAPI/files/SQLite runtime, review persistence, evidence ZIPs and state-only links.
- Two independently attributed public reference packs and a bounded OME importer.
- Protected Rayfin 1.36.2 app, authenticated Functions, OneLake images, five analytical
  Delta tables and caller-scoped append-only review schema.
- Read-only local research report and an actual Fabric notebook run over the existing
  Lakehouse: control dispersion, QC sensitivity, condition-level technical n and lineage.
- Customer-oriented documentation, scientific workflow/architecture/data diagrams,
  editable Excalidraw sources, support/contribution guidance and issue/PR templates.
- Seven curated knowledge tables, a deployed generation-2 Fabric IQ ontology and a
  tenant-published read-only data agent. All 637 curated rows and five SQL examples
  match the validated reduction; seven real MCP requests exercised evidence/refusal cases.
- A tested LIMS/ELN context join with four explicitly fictional export records.
  The managed knowledge layer is deployed; a live external system is not connected.

## Repository portability

The original broad `data/` ignore pattern also hid required `rayfin/data` source.
It is now scoped to `/data/`, and source packaging explicitly requires the review entity
and schema. Packaging supports both a Git checkout and a source ZIP extraction.
Repository checks validate portable links, notebook hygiene, diagram freshness and
exact Rayfin versions. Regression tests cover the ignored-schema defect and accidental
tenant-state inclusion.

Generated data, dependencies, execution outputs and per-tenant state remain ignored.
A private GitHub repository has been created and populated at `anuraagr/assayscope-fabric`.
Its first real Ubuntu Actions run passed, including browser and scientific checks.
Source publication and hosted-run evidence are tracked separately in verification.
Application hosting remains protected, not public.

## Cloud evidence

The base app was opened through actual Fabric SSO, loaded OneLake images and SQL-derived
results, and produced a matching cloud evidence export. Anonymous hosting and Functions
requests returned HTTP 401. The research notebook subsequently completed a real Spark
run; its execution receipt contains the five expected table counts, 48 condition/run
rows and 22 flagged wells. Its results are checked separately from local browser tests.

The operator enabled app creation at capacity scope during the initial deployment.
No tenant settings, permissions, capacity size or sign-in context were changed by the
repository-cleanup work. Read-only inspection found ontology/Copilot settings enabled;
the subsequent definition readbacks, SQL checks and real MCP evaluation establish
deployment independently of those settings.

## Remaining independent gates

| Gate | State |
|---|---|
| Cloud review write followed by independent read-back | Not performed without approval for a labeled test record |
| Separate authenticated unauthorized identity | Not supplied; cross-user denial remains unverified |
| Direct Entra-to-Rayfin scripted smoke | Current CLI token lacks the required `Item.Execute.All`; portal SSO works independently |
| Docker build/start; macOS; 16-GiB machine | Unverified; Linux software-WebGL CI passed independently |
| Real assay adaptation | Requires rights, reviewed metadata, method validation and biological replicate design |
| Managed ontology and data agent | Deployed and exercised; broader scientific evaluation and separate-user authorization remain independent |
| External LIMS/ELN | No authorized endpoint or mapping supplied; the example stays unconnected |
| Public source publication | Repository is private; public visibility was not requested |

Use the [verification record](verification.md) for exact executed checks, evidence
locations, measurements and limitations. The [documentation index](index.md) is the
entry point for a new reader.

## Preserved implementation history

Earlier detailed engineering notes, previous source archive and browser evidence were
preserved under ignored `test-results/history/pre-customer-repository-20261113`.
Earlier scientific/browser assets also remain under
`test-results/history/pre-deployment-20261113`. They are historical evidence, not proof
that a later source revision was tested. Do not copy ignored deployment state into a
source package or recreate existing cloud resources from their names.
