# AssayScope implementation progress and independent-project handoff

## Project boundary

The user clarified that AssayScope is an **independent project**, not an extension of
the Database Hub demo. Its intended standalone root is
`C:\Users\ranganathana\assayscope-fabric`. The implementation, generated assets,
dependencies and evidence are being transferred intact. Do not reintroduce a dependency
on the original checkout or publish/provision anything without approval.

The full original 573-line product brief is preserved in the ignored
`.handoff/original-brief.txt`. Complete that brief; this handoff is not a completion claim.

## Implemented

- React/TypeScript/Vite scientific workbench with OpenSeadragon 6.1.1 and vtk.js 38.0.5.
- Seeded 192-well, two-run microscopy pack, three channels, six actual 3D timepoints
  for B11/F11/G01 in both runs. OME-TIFF and NGFF 0.4/Zarr v2, bounded frame delivery.
- Image-only CPU watershed/measurements/QC; generator truth is separate and not served.
- Plate filtering, linked comparison, response points/SD, explicit exclusions and no forced IC50.
- SQLite decisions/annotations, ZIP evidence export, state-only links, presenter/reset,
  deterministic Guided analysis, explicit non-WebGL error and 2D fallback.
- Exact public files downloaded, SHA-256 checked, converted and viewed: Cell Painting
  channels 5/1/2 for one specified field (CC0), BT474.tif from S-BIAD610 (CC BY 4.0).
- Bounded OME import converter, example instrument/LIMS CSV contracts and extensive docs.
- Rayfin 1.36.2 entity/functions adapter, scoped OneLake delivery, fixed cross-run SQL,
  analytical Parquet ingestion and guarded doctor/plan/apply/smoke/cleanup scripts.
- Compose/Docker packaging and standalone CI definition (actual Docker execution unverified).

## Actual evidence already obtained

- All **13 requested Playwright flows passed** on an isolated local server, including
  actual image-pixel changes, synchronized camera/time/display, a real server restart,
  ZIP values/citations/provenance, deep-link restoration, reset and missing-config failure.
- Both actual public reference viewers passed; no invented public time series.
- Last recorded Edge run: shell 232.2 ms, first hero volume 782.6 ms, approximately
  60.47 vtk render events/second during a real pointer orbit.
- Host: Windows ARM64, Snapdragon X1E80100, about 32 GiB RAM, integrated Adreno X1-85.
  Edge 157.0.4341.46 uses hardware D3D11. Bundled Chromium 140 lacks default WebGL here;
  explicit software WebGL works, and the no-WebGL fallback was separately checked.
- 33 Python tests passed before the latest additions; two additional import tests passed.
  One newly added deterministic OME/DeltaT test still needs running.
- 11 Vitest tests, ESLint, TypeScript and the Rayfin Functions build passed on supported
  Node 24.22.2 after the JavaScript dependency/security updates.
- Measured core ZIP before the newest OME metadata change: 142,964,958 bytes compressed;
  nuclear Dice 0.90125; hero volume IoU 0.94870; 65/65 nuclear count; 22/22 seeded
  quality problems detected across 192 fields, with no extra flags.
- Evidence: `test-results/browser-acceptance.json`, `science-measurements.json`,
  `verified-evidence.zip`, `core-pack.zip`, `walkthrough.webm` (about 3 MB).
  Real screenshots are in `docs/screenshots/`.

These are real earlier results, not proof of changes made afterward. Re-run the final
checks after finishing the dependency and metadata work below.

## Remaining work, in order

1. **Resolve the latest Python dependency update.** `requirements.txt` now pins
   FastAPI 0.162.5, Starlette 1.3.1 and pip 26.2.0 to address reviewed advisories.
   The approved package mirror has FastAPI only through 0.162.0, so that last install
   failed. Verify whether 0.162.0 supports Starlette 1.3.1 and use a compatible patched
   available version, or a verified approved wheel. Do not disable TLS or leave a
   requirements/environment mismatch. Pillow 13.0.0, PyArrow 23.0.1 and pytest 9.0.3
   installed and their focused tests passed.
2. Verify the newest OME writer changes: deterministic UUIDs and explicit Plane DeltaT,
   plus nonzero NGFF time translation. Run the new focused test, then regenerate the core
   with `python -m assayscope.generator --force` and re-run `assayscope.ingest`.
   Re-prepare public derivatives after the writer changes. The screenshot default now
   hides BT474's high-background source channel 1, and 2D fields no longer show fake Z views.
3. Finish local deployment-script behavior tests (mocked guards/LRO/failure behavior),
   source hygiene and packaging. Review script correctness; no live tenant is authorized.
4. Update CI Action pins/config version inventory. Current standalone CI still uses
   older full-SHA Action pins; latest checked setup-python v7.1.0 resolves to
   `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`. The independent repository does not inherit
   the original demo's version policy. Keep all actions exactly pinned and preserve
   the scientific dependency compatibility. No parent CI workflow should remain.
5. Add the still-missing `docs/verification.md`; update README/data cards/security notes,
   implementation-plan checklist and this progress file with final actual results.
   Do not leave broken documentation links or stale completion claims.
6. Re-run Python/TypeScript/lint/build/browser checks, inspect fresh screenshots at both
   target sizes, and remeasure the final compressed core pack. Refresh the recording.
7. Run the verified secret scanner against **source-only** package files, excluding
   .venv/node_modules/data/.deployment/.handoff/test-results. Never scan/print credentials.
8. Optionally create a shareable source ZIP (no dependencies, raw data or credentials),
   start a verified responsive native showcase for the user, and give the requested
   honest final report with exact local and deploy commands.

## Dependency/security findings and tools

The npm audit endpoints are unavailable (mirror 429, public registry TLS failure).
The documented GitHub global advisory API was used instead. Frontend runtime and
Functions graphs returned no active reviewed advisories after fixes. Python transitive
review found the pending Starlette/pip updates above. Do not claim a complete clean audit.

JavaScript patches: AJV 8.18.0, fflate 0.8.3, Zod override 4.6.7; CLI overrides for
MSAL Node 7.2.1, affected glob 14.0.3 and minimatch 11.0.4. Rayfin packages remain
exactly 1.36.2. Full Node-24 validation of these changes completed successfully.

Session-local tools (verified against upstream SHA-256) available on this host:

- Node: `C:\Users\ranganathana\.copilot\session-state\b2dd532f-3dc2-4769-8248-478fd2ddf707\files\node-v24.22.2-win-x64\node.exe`
- gitleaks: `C:\Users\ranganathana\.copilot\session-state\b2dd532f-3dc2-4769-8248-478fd2ddf707\files\gitleaks-8.30.1\gitleaks.exe`

Default Node on PATH is 26.13.0, unsupported by Rayfin. Use the supported Node directory
at the front of PATH for each validation call. The moved `.venv` can be used via
`.venv\Scripts\python.exe -m ...`; if relocation invalidates a script launcher, recreate
only that virtual environment from requirements rather than changing the code.

No showcase server is currently running. All browser-test servers were isolated and stopped.
The prior long-running local port-8000 service was intentionally stopped before regeneration.

## External blockers, not fabricated successes

- No supplied authorized Fabric tenant/workspace/capacity or test identity. Actual
  cloud retrieval, SQL, cloud persistence and negative identity tests remain unverified.
- Docker is not installed; container build/start is unverified.
- No Linux/macOS runtime or 16-GiB machine was tested.
- No Foundry/learned-model integration is needed; deterministic Guided analysis is implemented.
- No remote repository was created, no commit was pushed, no paid resources were provisioned.

## Immediate next commands

```powershell
Set-Location C:\Users\ranganathana\assayscope-fabric
.\.venv\Scripts\python.exe -m pip --version
.\.venv\Scripts\python.exe -m pip show fastapi starlette
```

Then resolve the available patched FastAPI/Starlette pair, run focused tests, regenerate
the OME assets, and finish the remaining acceptance/reporting work above.
