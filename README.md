# AssayScope

## From Microscopy to Scientific Decisions

**A research-only microscopy evidence workbench.** Follow a plate result back to its
images, distinguish a reproducible-looking signal from an acquisition problem, and
preserve the rationale for the next experiment.

![AssayScope running at 1440x900: a multichannel spheroid cutaway, synchronized orthogonal slices, plate map, QC and image-derived evidence](docs/screenshots/workbench-1440.png)

The story is deliberately narrow: three fictional compounds, two simulated acquisition
runs, and one question: **which apparent spheroid responses survive quality review?**
This is not a medical device, diagnostic tool, GxP-validated system, or production-ready
regulated workflow. A response here is not evidence of efficacy, safety or mechanism.

## Run locally

From this directory, with Docker Engine/Desktop and Compose v2:

```sh
docker compose up --build
```

Open **http://localhost:8000**. First startup generates the seeded dataset on CPU and
persists it, with SQLite reviews, in the named `assayscope-data` volume. No Azure
subscription, Fabric capacity, model endpoint or GPU is required to start the app.
3D rendering requires WebGL 2; 2D and orthogonal slices remain available without it.
After dependencies/images and data are prepared, the showcase works offline.

Run these commands from the root of the independent `assayscope-fabric` repository.
No other demo's deployment scripts or assets are required. Nothing has been pushed or published.

**Verification boundary:** native Windows execution was tested. Docker was not available
on the implementation host, so the actual container build/start is **unverified**.
The [verification report](docs/verification.md) separates measured results from configuration.

### Native development

Use **Node 24**, **Python 3.12** and npm. Rayfin 1.36.2 supports Node 20/22/24, not Node 26.
The local Vite application also ran on Node 26.13.0 during development.

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
npm run dev
```

If `python` is not 3.12, select your installed 3.12 interpreter to create `.venv`.
macOS/Linux:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run dev
```

Open **http://localhost:5173**. The command starts Vite and the explicitly local Python
adapter; it does **not** run `rayfin dev` or provision a managed backend. Ctrl+C stops
both child processes. For a production frontend served by the same local API:

```powershell
npm run build
.\.venv\Scripts\python.exe -m uvicorn assayscope.server:app --host 127.0.0.1 --port 8000 --no-access-log
```

On macOS/Linux replace the Python executable with `.venv/bin/python`.

## What works, and what is not claimed

| Capability | Status |
|---|---|
| 96 wells/run, 3 compounds x 8 doses x 3 technical wells, 24 controls; 2 runs | Implemented and tested |
| Image-only watershed baseline, focus/saturation/illumination/count QC | Implemented; tested against separate synthetic truth |
| vtk.js multichannel 3D cutaway, six real volume frames, physical orthogonal slices | Implemented and browser-tested |
| OpenSeadragon 2D zoom/pan, channel/color/intensity controls, scale bar, labels | Implemented and browser-tested |
| Linked treatment/control camera, time and display settings | Implemented and browser-tested |
| Replicate points, sample SD, explicit exclusions and control normalization | Implemented; no forced IC50 |
| Local reviews across restart; evidence ZIP; state-only deep links; presenter/reset | Implemented and browser-tested |
| Cell Painting CC0 and BT474 CC BY 4.0 reference packs | Real selected files downloaded, hashed, converted and viewed |
| Deterministic Guided analysis | Implemented; calculations/records, not generative AI |
| OneLake delivery, analytical ingestion/query, protected Rayfin reviews | Code/configuration implemented and locally checked; live tenant execution unverified |
| Docker Compose, Linux/macOS runtime | Packaged; actual execution unverified on this Windows host |
| Optional learned segmentation or Foundry LLM | Not implemented; not needed by the core product |
| Arbitrary instrument/LIMS connector or clinical validation | Not claimed |

### Three unmistakable data experiences

**Simulated screening experiment:** original generated images, fictional compounds and
synthetic instruments/runs. Measurements come from those images. Nuclear counts,
reporter signal and morphology are proxies, not viability or toxicity.

**Public microscopy reference:** two independent, attributed studies. They are not paired
samples, are not part of the simulated response curve, and do not become time series.

**Connected tenant data:** protected Fabric access. The delivered tenant pipeline hosts
the same explicitly synthetic research demo in your tenant; connecting it does not turn
synthetic data into a real experiment. Missing configuration/authentication fails closed.
Local fixtures are never substituted. Imported real assays require a reviewed metadata
mapping and validated analysis, as explained in the [adapter guide](docs/adapter-guide.md).

## Fetch the real reference pack separately

The core showcase does not need this download. Four exact image files total
**117,326,500 bytes**; no multi-terabyte collection is synchronized.

```powershell
.\.venv\Scripts\python.exe -m assayscope.public_data plan
.\.venv\Scripts\python.exe -m assayscope.public_data fetch
```

Or, after Compose starts:

```sh
docker compose exec showcase python -m assayscope.public_data fetch
```

Select **Public microscopy reference** in the app. Downloads expose byte progress,
resume partial files, use three bounded attempts and validate exact lengths/SHA-256.
Changed sources fail visibly, never become synthetic replacements. A selection over
2 GiB requires `--allow-over-2gb`.

See the [source manifest](config/public-sources.json), [data cards](docs/data-cards.md)
and [attribution](THIRD_PARTY_NOTICES.md). BT474's source TIFF does not identify its
three stains: the app deliberately says "Source channel 1/2/3" rather than inventing them.

## Deploy into your own Fabric tenant

**No tenant deployment was performed.** Requires an explicitly chosen tenant, workspace
on an existing active capacity, permission to create/edit the app and Lakehouse,
Fabric Apps/Functions availability, scoped app-identity data access, Node 24, Python
3.12, PowerShell 7.4+, Azure CLI, and your own completed sign-in.

Copy `config/tenant.example.json` to ignored `config/tenant.local.json` and fill the
intended IDs/account and owner-confirmed prerequisites. Then:

```sh
npm run fabric:doctor -- --config config/tenant.local.json
npm run fabric:plan -- --config config/tenant.local.json
npm run fabric:apply -- --config config/tenant.local.json --confirm-costs
npm run fabric:smoke -- --config config/tenant.local.json
```

`npm run fabric:plan -- --offline` checks the local plan without credentials or network.
`--confirm-costs` authorizes applying to the configured existing capacity, not creating
or resizing capacity, changing tenant settings or granting broad roles. A separate
`--write-review` smoke option tests a real caller-scoped review write under an approved
test identity. Another authenticated unauthorized identity was not supplied/tested.

[Deployment, permissions and portability](docs/deployment.md) explain provisioning,
per-environment ignored state, source replay, preview limits, costs, and
[cleanup](docs/cleanup.md).

## Architecture

```text
Original seeded generator / selected public OME inputs
        |
        +--> OME-TIFF + OME-NGFF 0.4 (Zarr v2, Blosc zstd)
        |       --> bounded verified ZYXC frame derivatives --> vtk.js / OpenSeadragon
        |
        +--> CPU image analysis --> measurements + QC + source hashes
                                      |
              Local showcase          |         Fabric tenant
              FastAPI + files         |         OneLake Lakehouse Files
              SQLite reviews          |         Parquet -> Load Table API -> Delta
                                      |         SQL analytical queries via Functions
                                      |         Rayfin MSSQL caller-scoped review revisions
```

The shared catalog JSON Schema generates TypeScript declarations and validates Python
output. Generator truth stays outside served assets. The browser caches at most 32 MiB
of frame data, cancels/discards stale reads, and verifies frame hashes.
The app's transactional database does not contain every segmented object.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npm run build
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check assayscope tests scripts
.\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe scripts\verify_browser.py --software-webgl
```

On a Windows machine with Edge, `scripts\verify_browser.py --edge --record` measures the
actual browser/GPU, checks all 13 flows on an isolated server, restarts that server,
captures screenshots and records a walkthrough. Software WebGL is an explicit test
option, never represented as hardware-accelerated performance.

Generated test evidence lives in ignored `test-results/`; the measured implementation
run is summarized in [verification](docs/verification.md). CI builds the frontend,
checks the scientific pipeline, tests browser behavior and uploads build/evidence artifacts.

## Present and adapt

- [Five-minute executive and fifteen-minute scientific walkthroughs](docs/demo-scripts.md)
- [Separate pharma, lab/instrument and Merck KGaA talk tracks](docs/audience-talk-tracks.md)
- [Scientific methods and limitations](docs/scientific-method.md)
- [Bring your own images and example metadata contracts](docs/adapter-guide.md)
- [Security](docs/security.md), [troubleshooting](docs/troubleshooting.md), [cleanup](docs/cleanup.md)
- [Implementation plan](docs/implementation-plan.md) and [current handoff](docs/progress.md)

Business value is easier evidence retrieval, more consistent review and less manual
stitching of images, metadata and spreadsheets. No customer ROI, proprietary integration,
endorsement, avoided clinical trial or guaranteed R&D outcome is claimed.

Original code is [MIT licensed](LICENSE). Data keeps its own license.
