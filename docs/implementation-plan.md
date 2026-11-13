# Design decisions and acceptance

This document records implementation choices. Current results belong in
[verification](verification.md); it is not permission to deploy, publish or change policy.

## Key decisions

| Decision | Reason and trade-off |
|---|---|
| Independent repository and local runtime | No dependency on another project's infrastructure or assets |
| FastAPI/files/SQLite locally | A reproducible no-cloud path; deliberately not enterprise authentication |
| OpenSeadragon 2D and vtk.js volumes | Maintained renderers with real arrays; bounded derivatives instead of universal whole-slide streaming |
| TCZYX OME sources; ZYXC uint8 transport | Preserve canonical dimensions/calibration while bounding browser memory and reads |
| Deterministic image-only CPU baseline | Reproducible, inspectable methods; not a claim of learned AI or real-data validation |
| Private evaluation truth | Tests can measure synthetic segmentation/QC without leaking answers into analysis |
| Per-run technical-well reduction | Avoid pseudo-replication, unreviewed pooling and forced pharmacological fits |
| Separate analytical and transactional stores | Lakehouse for images/tables; caller-scoped app SQL for human reviews |
| Protected, authenticated frame proxy | No arbitrary storage path, browser token or unverified SAS/CORS assumption |
| One optional read-only research notebook | Adds control/QC/lineage review using existing data and capacity, without another service |
| Offline external-context contract first | Demonstrates exact LIMS/ELN joins without inventing a live vendor connection |
| Deployed ontology/data-agent layer | Seven curated tables preserve approved calculations and source relationships; external context remains explicitly example-only |

Viv was considered for direct OME rendering. The chosen bounded pack uses vtk.js and
OpenSeadragon to avoid adding another coupled rendering stack. The interface prioritizes
image area, calibrated sections, accessible controls and factual labels, not decorative
animations or promotional copy.

## Acceptance dimensions

| Area | Required evidence |
|---|---|
| Scientific correctness | Determinism, source axes/channels/units/time, label alignment, original measurements |
| Analytical reduction | Within-run controls, missing/zero denominators, technical n, sample SD and exclusions |
| Viewer behavior | Actual pixel/frame changes, volume clipping, linked comparison and explicit non-WebGL fallback |
| Review and export | Persistence across restart; values, images, citations and provenance agree |
| Cloud operation | Actual authorized image/SQL retrieval, persistence and independent authorization checks |
| Research notebook | Source freshness, local/notebook numerical parity and actual cloud execution receipt |
| External context | Exact study/run/well/image joins, version/rights/origin and explicit missing mappings |
| Repository portability | Required schema source included, no tenant/bulk data, fresh-extraction build |
| Documentation | Navigable links, readable diagrams, scientific limits and no unsupported deployment claims |

## Boundaries for future changes

New platform services need a concrete lab or operational requirement. New capacity,
role grants, tenant policy, sign-in, external-system access and public publishing are
separate authorizations. A successful local test or an enabled feature switch is not
proof of a working cloud integration.

The [lab research guide](lab-research-guide.md) defines useful evaluation tasks.
The [knowledge-layer boundary](knowledge-context.md) distinguishes the deployed managed
components from the still-unconnected external system and its fictional example records.
