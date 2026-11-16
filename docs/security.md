# Security and access boundaries

**Research demonstration, not a production or regulated security certification.**
Cloud authorization must be verified in the target tenant before real data is introduced.

## Local showcase

There is deliberately **no simulated enterprise sign-in**. The local FastAPI service
binds to loopback in native use; Compose publishes only `127.0.0.1:8000`.
Host allowlisting rejects non-loopback hosts, cross-origin writes are rejected, writes
require JSON, and bounded review/request bodies are validated. Responses prevent MIME
sniffing and framing. Do not expose this service through a public tunnel or a shared
network without adding a real authenticated boundary.

SQLite stores local reviews on the host/volume. Every local browser using that instance
shares that store. This is not per-user enterprise authorization. Files are not
encrypted by the app; use device/volume protection appropriate to the data.
Public files are public licensed sources; real customer data is never bundled.

## Tenant boundary

The Rayfin configuration explicitly enables Entra authentication and
`staticHosting.assetAccess: protected`. Each entity has explicit action permissions.
Review rows require caller-subject ownership and permit create/read only.
Functions use the caller-scoped data client for permission checks and the app identity
for the configured OneLake/SQL source. App Run/Interact permission is an intentional
grant to the single registered demonstration experiment, not an arbitrary storage proxy.

The function accepts registered image IDs/time indexes only. It resolves paths from the
catalog; it cannot fetch a supplied URL, leave the fixed prefix, follow a redirect, or
execute user SQL. Query text is fixed and its experiment parameter is bound.
Missing configuration, authorization, frames or analytical rows produces an error.
Expired SDK sessions are not replaced with local fixtures; cached frames are separated
by session instance and the UI clears tenant data on identity changes.

No long-lived key or SAS is embedded in the frontend. Runtime Storage/SQL tokens remain
inside Functions. Deployment obtains tokens through subscription/tenant/account-guarded
Azure CLI calls, keeps them in process memory, uses ambient Rayfin authentication and
restores environment values afterward. `Write-DemoLog` redacts registered values,
token-shaped strings and credential query patterns. Never enable verbose token logging.

## Data integrity and untrusted input

- Exact SHA-256 and length checks protect downloaded public sources and delivered frames.
- Original inputs and generator truth remain separate from image-derived results.
- Shared catalog schema validates arrays, channels, time, paths and measurement contracts.
- App annotations are plain text rendered by React; HTML export escapes them.
- Decisions require an explicit human save; Guided analysis cannot change them.
- Core Guided analysis is deterministic evidence retrieval. The optional deployed Fabric
  data agent uses the tenant-managed generative service over explicitly selected curated
  tables; this is a separate data-processing/capacity boundary, not the core image pipeline.
- Deep links use a fresh allowlist of state fields; no inherited auth/storage query string.
- Imported private data is not labeled public or connected and is not automatically uploaded.

Downloaded files are still untrusted input to native decoding libraries. Use the pinned
verified public pack, or review input rights/format/bounds before local conversion.
The importer bounds decoded input and refuses path traversal, unsupported axes, channel/
time mismatches and unreviewed transforms. It is not a hardened public upload service.

## Known limitations and required review

Actual protected hosting and anonymous Functions denial were verified with HTTP 401
responses, and the authorized owner loaded the app through Fabric SSO. A different
authenticated identity and a real cloud review write remain **unverified**. Schema
decorators and mock tests are not evidence of cross-user enforcement.

Cloud review revisions are append-only but not a GxP audit log. A concurrent read/version
check is not a database-serializable transaction. Records are private to each author;
shared live editing and group-specific experiment entitlements are not implemented.

The previous patch pass checked the frontend runtime and Functions graphs against
GitHub's documented reviewed-advisory API after scoped dependency updates; those queries
returned no active reviewed advisories for the checked graphs. The normal npm audit
endpoints were rate-limited/TLS-inaccessible, so this is not a complete clean audit.

**The Python mismatch is resolved.** Approved-mirror wheel metadata confirms FastAPI
0.162.0 accepts Starlette 1.3.1. Both and pip 26.2.0 are installed; `pip check`, all Python
tests and fresh browser acceptance pass. Targeted reviewed-advisory queries returned
no active entries for these exact candidates. This is not a full transitive audit.
See [verification](verification.md) for versions, evidence and remaining cloud gates.

Before production tenant use, run `npm audit` in both the project and
`rayfin/functions` through an approved registry, and review the Python graph with an
approved scanner. Do not disable TLS, bypass the dependency resolver, or apply
`npm audit fix --force`: Rayfin packages must remain at one exact compatible version.
Successful tests do not establish production readiness or absence of vulnerabilities.

Local deployment tests exercise account/subscription guards, strict configuration
booleans and GUIDs, redaction, bounded API retries/LROs, cleanup ownership and the upload
allowlist. Authenticated requests do not follow redirects. The OneLake owner marker is
created conditionally and checked against tenant, workspace and environment. These
controls were exercised against the intended tenant; independent second-identity checks
are still required. Regional LRO locations are not trusted as new authenticated origins:
the documented operation ID is polled on the canonical Fabric API.

## Research notebook and external context

The browser review queue uses the same caller-scoped ReviewDecision entity, not a new
shared table. It queries only the registered experiment, paginates 100 revisions at a
time and fails if 2,000 revisions cannot provide a complete inventory. Local inventory
selects only registered well IDs with parameterized SQLite queries. Denied/partial reads
are not represented as an empty queue. Repeat worksheets require an explicit saved
human decision and do not submit an external action.

The lab-context Function reads only `knowledge/context-snapshot.json` under the fixed
owned experiment prefix, capped at 128 KiB, after the existing authorization check.
The browser validates the shared schema, exact experiment/run/well/image joins,
record-version uniqueness, timestamp order, example-only origin and unsigned reserved
record URLs. It never follows those URLs. Missing/denied cloud context fails visibly
without using a bundled local fallback. No new caller/agent access permissions were added.

View links now include an allowlisted surface and bounded QC parameters, not filters,
draft scenarios, selected queue IDs, review text or credentials. Exported tabular
packets include their scope, source-image hashes and original measurements. HTML is
escaped and spreadsheet-formula prefixes are neutralized; numeric values are retained.

The notebook needs separate Lakehouse read and execution permissions. App Run/Interact
does not grant these. It reads bounded analytical rows, validates lineage/QC and does not
write tables or private reviews. Source deployment stops on external notebook edits,
and execution checks that deployed code matches the reviewed source. Accepted job IDs
are recorded before polling; run POSTs are not automatically retried.

Notebook outputs, execution receipts and exported reports can contain scientific
measurements. Keep them within approved workspace/retention boundaries and out of Git.
The source notebook is output-free and has no resolved Lakehouse coordinates.

The LIMS/ELN example is a local, schema-validated snapshot. No URL is fetched and no
external task is created. It rejects ambiguous/mismatched identities and token-bearing
record links. Real external records cannot be attached to the supplied simulated assay.
Data-agent instructions do not enforce security: the deployed agent needs real source
permissions and independent negative-identity tests. Model/content-filter results are
recorded separately from authorization evidence. Private review rows are excluded from
the shared ontology/agent. Its one selected source is the seven curated Lakehouse tables,
not the transactional review store or arbitrary Files. All 637 curated rows were checked
against the local scientific reduction before managed definitions were created.

The operator resolved the feature gate by enabling `AppBackendTenant` on the existing
capacity only. The agent did not change tenant-wide policy, anonymous/public hosting,
roles or capacity. The protected app and dedicated Lakehouse are deployed, with actual
OneLake hashes and SQL row/provenance checks recorded in [verification](verification.md).

Direct Entra exchange with this host's existing Azure CLI token is unavailable because
it lacks `Item.Execute.All`. No new consent or alternate identity was used. Browser SSO
used the existing authorized Fabric session instead. Cloud test-write approval was
requested but unavailable, so no review record was created on the user's behalf.

Record a target-tenant security review, correct least-privilege app/data grants, explicit
negative identity tests, capacity policies, data retention and dependency decisions
before real scientific data or external sharing. No broad roles or tenant settings are
automatically changed by this repository.
