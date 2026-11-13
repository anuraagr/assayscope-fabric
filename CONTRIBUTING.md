# Contributing

AssayScope is an independent, research-only sample. Contributions should improve
reproducibility, evidence review or portability without overstating scientific validity.
Read [AGENTS.md](AGENTS.md), the [scientific method](docs/scientific-method.md),
[architecture](docs/architecture.md) and [security boundaries](docs/security.md) first.

## Development setup

Use Node 24 and Python 3.12; tested versions are in `.nvmrc`, `.python-version` and
[verification](docs/verification.md). Follow the [native quickstart](README.md#native-development).
The local adapter is FastAPI/files/SQLite, not `rayfin dev`.

No Azure sign-in or capacity is needed for local development. Do not include
`.env`, `tenant.local.json`, deployment state, source/customer images, generated datasets,
review databases or credentials in a change. The root `/data/` directory is ignored;
**`rayfin/data/` is required source** and must remain in Git and source archives.
The ignore pattern must be `/data/`, not the recursive `data/`. The source collector
explicitly requires `rayfin/data/ReviewDecision.ts` and `rayfin/data/schema.ts`;
`npm run test:repository` reproduces the broad-ignore failure and verifies the fix.

## Scientific changes

Keep TCZYX source axes, physical units, anisotropy, time order, source hashes and label
alignment. Channel identities come from metadata, never colors or filenames. Analysis
cannot read private generator truth. Preserve original values and exclusion reasons.

Technical wells are not biological replicates. Missing/zero controls and unjustified
fits stay not estimable. Do not generalize synthetic benchmark scores to real specimens.
Keep local, public-reference and connected origins explicit.

Edit `contracts/catalog.schema.json` first for a contract change, then run `npm run contracts`.
Do not hand-edit `src/catalog.generated.d.ts` or generated Rayfin metadata. Keep all Rayfin
packages at exactly 1.36.2; a major SDK upgrade is a separate reviewed change.

## Required checks

From the repository root in Windows PowerShell:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run repo:check
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check assayscope research tests scripts
.\.venv\Scripts\python.exe -m scripts.build_research_notebook --check
pwsh -NoLogo -NoProfile -File scripts\verify_deployment.ps1
npm run fabric:plan -- --offline
npm run fabric:research:plan -- --offline
```

For Functions, restore their lockfile and build in `rayfin/functions`.
For behavior changes, run the real [browser acceptance](docs/verification.md#repeatable-local-verification),
inspect the resulting images and record browser, GPU and timings. CI defines these checks
but a workflow file is not proof that hosted CI or Docker ran.

The research notebook and diagrams are generated from tested source. Regenerate them
with `python -m scripts.build_research_notebook` and `npm run docs:diagrams`.
Do not commit notebook outputs or tenant bindings.

## Review and documentation

Keep changes focused. Explain the research question, behavior changed, evidence and
remaining limits. Add focused regression cases for scientific calculations and failure
paths. Update [progress](docs/progress.md) and [verification](docs/verification.md) with
actual evidence; distinguish local checks from live cloud checks.

Use factual labels. No slogans, unmeasured ROI, endorsements, invented instrument
integrations or clinical claims. Preserve [source/data attribution](THIRD_PARTY_NOTICES.md)
when distributing screenshots or derivatives.

## Before sharing source

Run `npm run repo:check`, then `npm run package:source`. Inspect the allowlisted manifest
and scan `test-results/source-package` with an approved secret scanner. Build/test a
fresh extraction rather than relying on dependencies or ignored files from your checkout.
Packaging never authorizes a push, public repository, public host or real-data upload.

Security findings belong in the [private reporting path](SECURITY.md), not a public issue.
