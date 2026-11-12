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
- No learned model/LLM receives data. Guided analysis is deterministic evidence retrieval.
- Deep links use a fresh allowlist of state fields; no inherited auth/storage query string.
- Imported private data is not labeled public or connected and is not automatically uploaded.

Downloaded files are still untrusted input to native decoding libraries. Use the pinned
verified public pack, or review input rights/format/bounds before local conversion.
The importer bounds decoded input and refuses path traversal, unsupported axes, channel/
time mismatches and unreviewed transforms. It is not a hardened public upload service.

## Known limitations and required review

Actual protected hosting, cross-user access denial and cloud functions authorization
are **unverified without a tenant and second test identity**. Schema decorators and
mock tests are not evidence of live enforcement.

Cloud review revisions are append-only but not a GxP audit log. A concurrent read/version
check is not a database-serializable transaction. Records are private to each author;
shared live editing and group-specific experiment entitlements are not implemented.

The dependency installation reported advisories in the Functions dependency graph.
The npm advisory endpoints were rate-limited/TLS-inaccessible on this host, so a complete
fresh dependency audit was **not verified**. Do not interpret successful unit tests as
a clean vulnerability audit. Before tenant use, run `npm audit` in both the project and
`rayfin/functions`, and review the pinned Python dependencies with your approved scanner.
Do not apply `npm audit fix --force` blindly: Rayfin packages must remain compatible at
one exact version. No production-readiness or zero-vulnerability claim is made.

Record a target-tenant security review, correct least-privilege app/data grants, explicit
negative identity tests, capacity policies, data retention and dependency decisions
before real scientific data or external sharing. No broad roles or tenant settings are
automatically changed by this repository.
