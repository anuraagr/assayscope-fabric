# Troubleshooting

| Symptom | Meaning and exact next action |
|---|---|
| First startup is waiting | CPU generation runs before service readiness. It is real work, not fake progress. Check `docker compose logs showcase` or the native Uvicorn terminal; do not start a second generator against the same output. |
| `docker` not found | Install Docker/Compose yourself or use the documented native path. Container execution was not verified on the implementation host. |
| `.venv` missing | Use Python 3.12 to create `.venv`, install `requirements.txt`, then `npm run dev`. |
| Package mirror returns a missing wheel metadata sidecar | Try your approved mirror's full-wheel path or `pip install --use-deprecated=legacy-resolver -r requirements.txt`, then run `pip check`. This worked on the implementation host. Do not disable TLS validation. |
| Public PyPI/npm TLS failure | Use an approved reachable registry/mirror. Do not log credentials or disable certificate checks. Record unavailable audit/download checks honestly. |
| Rayfin reports unsupported Node | Use Node 24. Node 26 worked for local Vite but is not supported by Rayfin 1.36.2. |
| WebGL 2 unavailable | Use 2D image and orthogonal slices, or a browser with WebGL 2 enabled. Native Edge used the integrated Adreno GPU here; bundled headless Chromium did not expose WebGL without explicit software rendering. |
| Context lost | Switch to 2D or reload. The app displays the error instead of showing an unrelated screenshot as a volume. |
| No volume for a well | Only B11, F11 and G01 in each run have bounded hero volumes. Other wells have real generated 2D screen fields; no 3D stack is invented. |
| BT474 appears as a bright slab | Source channel 1 has high background and is initially hidden. Toggle it only when useful; no stain identity is inferred. Inspect 2D/orthogonal sections as well as the volume. |
| Public pack not installed | Run `python -m assayscope.public_data plan`, then `python -m assayscope.public_data fetch` with the project virtual environment. Reload/select Public microscopy reference. |
| Interrupted public download | Rerun the same fetch command. `.part` files resume with a validated range. Three failed attempts stop with a useful error. |
| Cached original hash mismatch | Move only the named corrupt public file aside, review source availability/rights, then fetch again. The downloader will not silently overwrite it or substitute simulation. |
| Frame checksum mismatch | For the synthetic pack, stop the local service, run `python -m assayscope.generator --force`, then restart. For public data, validate originals and rerun `public_data prepare`. Never disable verification. |
| A review changed while saving | Local writes check a revision under a SQLite transaction. Refresh/review the existing record before saving; do not silently overwrite someone else's revision. |
| IC50 or SD says Not estimable | This is deliberate for an unjustified fit, no control denominator, missing data or insufficient technical wells. It is not a spinner or a missing implementation pretending to fit. |
| Connected mode says missing configuration | Supply a specific tenant target and run `npm run fabric:doctor -- --config config/tenant.local.json`. Local fixtures are intentionally not shown as connected data. |
| Fabric permission denied/expired | Reauthenticate yourself or have the owner review minimal app/Lakehouse access. The app will not bypass tenant policy or embed a storage key. |
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
