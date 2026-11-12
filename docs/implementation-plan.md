# Implementation plan and acceptance checklist

## Boundaries

This is an independent, self-contained, separately shareable repository.
It does not depend on another demo's deployment scripts, infrastructure or data.
No cloud resources, sign-in, permissions, public publishing or paid capacity are authorized.
The local Python service is **not** a locally running managed Rayfin backend.

## Phases

1. Inspect the reference at `49be12f4906ac2dcf5cd28aa3efd31a5ace4d2d4`, current Rayfin
   1.36.2 documentation, NGFF, primary dataset records and viewer dependencies.
2. Generate two seeded 96-well acquisitions; measure images with a CPU baseline,
   independent of private generator truth. Establish plate -> image -> QC -> provenance.
3. Implement a microscopy workbench: actual multichannel volumes and six timepoints,
   orthogonal slices, clipping, channel settings and synchronized control comparison.
4. Add separately downloaded CC0 Cell Painting and CC BY 4.0 BT474 reference data.
5. Finish durable local review, reproducible exports, share-state, presenter mode and Compose.
6. Implement fail-closed Fabric/Rayfin auth, OneLake retrieval, analytical ingestion,
   review entities and guarded doctor/plan/apply/smoke/cleanup.
7. Test behavior and numerical edge cases; inspect real screenshots; record measured
   performance, failed gates and cloud verification separately.

## Design direction

The signature is a **specimen evidence desk**: a broad indigo-black fluorescence canvas,
with physical sections arranged alongside the cutaway rather than dashboard tiles.
Quiet pale-blue instrument chrome frames it. The plate is a navigable map of evidence.
Barlow Condensed display, IBM Plex Sans body and IBM Plex Mono measurement captions are
bundled locally. Palette: ink `#101b29`, canvas `#070d17`, paper `#edf3f7`,
cyan `#60d8ed`, teal `#58d4bd`, magenta `#ee8ccb`.
No decorative particles, fabricated counters, customer branding or medical viewer UI.

Viv was evaluated: it provides direct OME-NGFF/OME-TIFF rendering but adds deck.gl/luma
version coupling. For this bounded CPU-derived pack, OpenSeadragon handles microscopy
2D zoom/pan, and vtk.js performs real multicomponent WebGL ray casting. Python's
tifffile and ome-zarr preserve canonical source dimensions; browser delivery is a
bounded typed array derivative, never a new imaging file format.

## Required gates

- [ ] Shared schema, axes TCZYX, channel order, voxel units, labels and time indexing
- [ ] Determinism and image-derived measurements; no truth leakage into analysis
- [ ] Segmentation/QC evaluated against separately held synthetic truth
- [ ] Normalization, missing/zero controls, exclusions and technical-replicate accounting
- [ ] Typecheck, lint, frontend tests, Python tests and production build
- [ ] Thirteen requested Playwright flows, including persistence across server restart
- [ ] Corrupt assets/downloads/expired authorization/cloud unavailability fail visibly
- [ ] ZIP matches visible analysis, source hashes and citations
- [ ] Real data checked, transformed, attributed and isolated from simulated screening
- [ ] No secrets/bulk data tracked; protected, explicit cloud authorization
- [ ] Compose configuration and native path; Docker execution recorded independently
- [ ] Measured startup/render/interaction; screenshots from running application
- [ ] Deployment automation locally checked; real tenant smoke tests explicitly unverified

Live results and next commands are maintained in [progress](progress.md).
