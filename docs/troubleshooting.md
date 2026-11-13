# Troubleshooting

| Symptom | Meaning and exact next action |
|---|---|
| First startup is waiting | CPU generation runs before service readiness. It is real work, not fake progress. Check `docker compose logs showcase` or the native Uvicorn terminal; do not start a second generator against the same output. |
| `docker` not found | Install Docker/Compose yourself or use the documented native path. Container execution was not verified on the implementation host. |
| `.venv` missing | Use Python 3.12 to create `.venv`, install `requirements.txt`, then `npm run dev`. |
| Package mirror lacks a pin or wheel metadata | Obtain the exact wheel and dependency metadata from an approved source. Verify compatibility with the current resolver and run `pip check`; do not use the legacy resolver to ignore conflicts or disable TLS. The available FastAPI 0.162.0 / Starlette 1.3.1 pair passed final checks. |
| Local execution is denied by the tool permission layer | Obtain explicit execution approval. Do not reroute the same command through a different executable. Fresh Python/browser results cannot be claimed while this gate is blocked. |
| Public PyPI/npm TLS failure | Use an approved reachable registry/mirror. Do not log credentials or disable certificate checks. Record unavailable audit/download checks honestly. |
| Rayfin reports unsupported Node | Use Node 24. Node 26 worked for local Vite but is not supported by Rayfin 1.36.2. |
| WebGL 2 unavailable | Use 2D image and orthogonal slices, or a browser with WebGL 2 enabled. Native Edge used the integrated Adreno GPU here; bundled headless Chromium did not expose WebGL without explicit software rendering. |
| Context lost | Switch to 2D or reload. The app displays the error instead of showing an unrelated screenshot as a volume. |
| No volume for a well | Only B11, F11 and G01 in each run have volumetric acquisitions. Other wells have generated 2D screen fields; no 3D stack is inferred. |
| BT474 appears as a bright slab | Source channel 1 has high background. The current manifest sets it initially hidden; an older prepared index needs `python -m assayscope.public_data prepare` after the dependency gate is resolved. No stain identity is inferred. |
| Public pack not installed | Run `python -m assayscope.public_data plan`, then `python -m assayscope.public_data fetch` with the project virtual environment. Reload/select Public microscopy reference. |
| Interrupted public download | Rerun the same fetch command. `.part` files resume with a validated range. Three failed attempts stop with a useful error. |
| Cached original hash mismatch | Move only the named corrupt public file aside, review source availability/rights, then fetch again. The downloader will not silently overwrite it or substitute simulation. |
| Frame checksum mismatch | For the synthetic pack, stop the local service, run `python -m assayscope.generator --force`, then restart. For public data, validate originals and rerun `public_data prepare`. Never disable verification. |
| A review changed while saving | Local writes check a revision under a SQLite transaction. Refresh/review the existing record before saving; do not silently overwrite someone else's revision. |
| IC50 or SD says Not estimable | This is deliberate for an unjustified fit, no control denominator, missing data or insufficient technical wells. It is not a spinner or a missing implementation pretending to fit. |
| Connected mode says missing configuration | Supply a specific tenant target and run `npm run fabric:doctor -- --config config/tenant.local.json`. Local fixtures are intentionally not shown as connected data. |
| Fabric permission denied/expired | Reauthenticate yourself or have the owner review minimal app/Lakehouse access. The app will not bypass tenant policy or embed a storage key. |
| AppBackend creation: 403 "The feature is not available" | Check **Enable Fabric App Items (preview)** (`AppBackendTenant`), including capacity overrides and group exclusions. **Allow public-facing Fabric apps** is a different toggle and does not enable creation. This initially blocked the demo and was resolved by operator enablement at capacity scope. See the [capacity-scoped resolution](deployment.md#enable-app-creation-at-the-intended-scope); policy changes require approval. |
| `No rayfin/.temp/compiled/data/*.js files found` | Keep `rayfin/tsconfig.json` output at `.temp/compiled`, as required by the pinned 1.36.2 CLI. Do not copy or hand-edit generated metadata to hide the missing schema build. |
| Functions output produces `"[object Object]" is not valid JSON` | The pinned SDK can already decode JSON string outputs. Use the validated function-result boundary in `src/fabric.ts`, not unconditional `JSON.parse` on an object. |
| Direct CLI smoke says `Entra authentication failed` | The existing CLI token may lack delegated `Item.Execute.All`. Open the app through its Fabric portal item using normal SSO, or supply an appropriately consented identity for scripted tests. Do not broaden grants or extract browser tokens to make a smoke test pass. |
| Direct static-host URL returns 401 | Protected hosting requires authenticated Fabric context. Use the app's Fabric portal URL from `rayfin up status`; anonymous 401 is expected, not a reason to make assets public. |
| SQL/image provenance differs | Wait for table load and SQL synchronization, then rerun the smoke check. The app refuses to combine mismatched processing revisions. |
| Same-name tenant item collision | Review its exact ID and ownership. Adopt only by explicit config ID, or use a distinct environment. Never delete or rename the unrelated item to make the script proceed. |
| Anonymous/second-user security check not proven | Treat the gate as unverified. Run approved positive/negative identity checks before real-data sharing; deployment success alone is not authorization proof. |
| Port already in use | Stop only the specific demo process/container you started, or run the native API on a different explicit port. Never terminate unrelated processes by name. |
| A shared local URL does not work on another computer | A localhost link points at the recipient's own computer. They need the same prepared app/data, or an authorized tenant-hosted URL. |

## Verification commands

Use [README verification](../README.md#verify). The browser script owns an isolated API
process and temporary SQLite store; it never resets the presenter's real local reviews.
Its `test-results/browser-acceptance.json` identifies the last completed gate/failure.
`docs/progress.md` records known remaining work and the next command.

## Stop safely

Use Ctrl+C for the native command or `docker compose down`. The named volume persists.
Review [cleanup](cleanup.md) before deleting a volume or tenant resources.
