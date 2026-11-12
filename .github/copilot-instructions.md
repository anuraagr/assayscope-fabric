# AssayScope engineering contract

Read AGENTS.md and docs/scientific-method.md. Keep the product research-only and
the synthetic/public/connected boundaries explicit. Never infer drug metadata,
biology or channel identities from a color or a filename.

The local adapter is FastAPI/files/SQLite, not a local managed Rayfin backend.
Cloud code uses documented Fabric/Rayfin 1.36.2 APIs, explicit entity permissions
and protected hosting. Missing tenant configuration/authentication fails closed.
Do not provision capacity, sign in for the user, change tenant settings, push or
publish without explicit authorization.

Scientific source arrays are TCZYX; frame transport is bounded ZYXC uint8.
Keep physical units, anisotropy, time order, source hashes and label alignment.
Image-derived analysis cannot consume generator truth. Preserve original
measurements and exclusions. n is technical wells per run; no forced IC50.

Use the shared JSON Schema and generated TypeScript declarations. Keep Python
and tenant analytical reduction behavior consistent, especially missing/zero
controls, technical replication and exclusions. Validate input, bound requests
and caches, and surface failures rather than silently using fixtures.

Run npm typecheck/lint/test/build, Python pytest/ruff and real browser acceptance
for behavioral changes. Record the browser/hardware/timings and cloud checks
independently. Use the existing scripts and tests; don't add unnecessary services.
PowerShell scripts are ASCII and use subscription-guarded Invoke-DemoAz and redacting
Write-DemoLog. Never commit bulk data, credentials or per-tenant state.
