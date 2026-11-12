# Scientific method and limitations

## What this demonstration tests

The operational question is whether an apparent reporter response remains interpretable
after image-quality review. It does not test a real drug, disease mechanism, clinical
effect, viability, apoptosis, toxicity, selectivity or safety.

Each run contains 96 wells: three fictional compounds, eight concentrations
(0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30 micromolar), three **technical** wells per
compound/dose, and 24 vehicle wells. Runs are two simulated acquisitions with a
controlled 6.5% intensity batch factor, not independent biological replicates.
No statistical significance or reproducibility claim is generalized beyond the simulation.

## Generator and separate truth

`assayscope/generator.py` uses seed 20261112 and per-acquisition deterministic random
streams. Images contain heterogeneous nuclear widths, textured fluorescence, Poisson
and read noise, and selected acquisition artifacts. Aster-17 has a simulated dose-linked
reporter change, Beryl-04 is a non-responder, and Cygnus-09 has apparent signal loss in
defocused high-dose fields. H11 has saturation; H12 has uneven background illumination.

The analysis is **not given these labels**. Ground-truth masks, counts, response factors
and artifact labels live in `data/private-truth`, outside the served asset catalog.
Only evaluation tests read them.

The 160x160 2D screen field and the 3D companion acquisition represent the same
simulated well/condition, but are **separately generated acquisitions**, not a claim
that a 2D screen field is a slice of the 3D volume. The UI/export state this explicitly.
Do not compare the 2D object count to the number of visible nuclei in the companion volume.

B11 (Aster-17, 10 micromolar), F11 (Cygnus-09, 10 micromolar) and G01 (vehicle) in both
runs have actual arrays of shape **T,C,Z,Y,X = 6,3,64,112,112**. Voxel spacing is
**3,1.5,1.5 micrometers in Z,Y,X**. Times are 0, 9.6, 19.2, 28.8, 38.4 and 48 hours.
Each timepoint has independently generated intensity/texture/morphology values and a
different frame hash. Rotating a camera does not create timepoints.

## Image-only baseline

The baseline is deterministic CPU image processing, **not AI**:

1. Smooth the nuclear channel with Gaussian sigma 0.65 pixels.
2. Use Otsu thresholding with a 28 ADU floor; remove objects smaller than 9 pixels.
3. Compute a Euclidean distance transform and local maxima with 3-pixel separation.
4. Apply marker-based watershed inside the foreground mask.
5. Measure objects with scikit-image region properties.

These are **segmented nuclear objects**, not necessarily cells. Watershed can split
or merge nuclei; crowded, unusual or weakly stained real specimens require validation.
No learned model or proprietary instrument algorithm is used.

| Measurement | Definition | Unit |
|---|---|---|
| Nuclear objects | Number of watershed labels | objects per 2D field |
| Median nuclear area | Median label pixel area x X spacing x Y spacing | square micrometers |
| Structural foreground | Hole-filled structure channel above 26 ADU | square micrometers |
| Mean reporter | Mean background-corrected reporter inside structural foreground | ADU |
| Integrated reporter | Sum of reporter minus its 10th percentile, clamped to zero, over the complete field | integrated ADU |
| Spheroid mask volume | Largest component of structure >30 after Gaussian sigma 1; hole fill; voxel count x voxel volume | cubic micrometers |

3D masking uses only the volume's structural pixels. Segmentation overlays are derived
boundaries, not the held-out truth. The screen metrics remain the 48 h endpoint when
the viewer changes time; the 3D mask volume displayed in the evidence panel is also
explicitly the 48 h value. Intermediate volume measurements are persisted separately
under `data/core/volume-measurements`.

## QC, inclusion and normalization

Defaults in [config/qc.json](../config/qc.json) are calibrated to this synthetic pack,
not universal biological or instrument thresholds. The UI exposes them; changing them
recomputes inclusion and normalization without modifying originals.

| Check | Calculation | Default |
|---|---|---|
| Focus | Variance of Laplacian / intensity variance of nuclear channel, values divided by 255 | at least 0.025 |
| Saturation | Fraction of channel-pixels at or above 254 ADU | at most 0.015 |
| Illumination | CV of the structural-channel mean in four corner patches | at most 0.55 |
| Count | Number of segmented nuclear objects | at least 12 |

A flag is an **observed image property**. Defocus is known to the evaluator in this
simulation; in a real experiment the same observation could have several causes.
Do not turn the QC flag into a proven root-cause diagnosis.

With exclusions on, unmeasured wells and any flagged field are omitted. Normalization
is performed **within one acquisition run**:

```text
normalized reporter (%) =
    100 * background-corrected integrated reporter in this well
        / median integrated reporter of included vehicle wells in this run
```

The original raw measurement and normalized value remain inspectable for excluded wells.
Exclusion changes whether they contribute to aggregates, not their source pixels.
No valid included control, or a zero control median, produces **Not estimable**.
Missing measurements are not imputed. Included + excluded + unmeasured equals 96.

Each plotted dot is a technical well. Aggregates are arithmetic means; variability is
sample standard deviation with denominator n-1. With one well, SD is not estimable.
Timepoints and cells do not increase n. Lines connect descriptive means; they are not
fitted pharmacological curves. **IC50 is not estimable** for this unvalidated reporter
proxy, so the app does not force a fit.

## Display and physical meaning

Canonical sources use OME-TIFF and NGFF 0.4 / Zarr v2, pinned with ome-zarr 0.11.1,
Zarr 2.18.7 and numcodecs 0.15.1. The browser receives a bounded, hash-checked uint8
ZYXC derivative for a single timepoint, not a bespoke microscopy file format.
vtk.js performs actual GPU volume ray casting; OpenSeadragon handles 2D navigation.

Synthetic display uses fixed 0..255 ADU mapping by default, with no per-image autoscaling.
Channel display and volume opacity weights are identical between treatment/control.
Changing display settings never changes measured values. Fluorescence colors are display
choices, not viability classes. The 3D compositor uses fixed component weights and
opacity curves; it is not a quantitatively linear projection image.
Orthogonal panels preserve physical aspect ratios, including anisotropic Z spacing.
Single-plane data has no implied depth and does not show invented orthogonal stacks.

Public Cell Painting derivatives have a separately disclosed per-source-channel display
conversion. Public source intensities must not be compared to synthetic ADU or pooled
with BT474 into a response curve. BT474's stain identities are not inferred from LUT colors.

## Evaluation and remaining gaps

The recorded implementation run yielded nuclear-mask Dice **0.9013**, exact count
65/65 on one deterministic evaluation field, 3D mask IoU **0.9487** on the hero endpoint,
and 22/22 seeded acquisition issues detected with zero extra flags across 192 wells.
These are tests against this generator's truth, **not independent real-data validation**.
See [verification](verification.md) for executable commands and bounds.

This is a small, favorable synthetic benchmark. It does not establish robustness to
real segmentation ambiguity, photobleaching, bleed-through, cell-density variation,
illumination drift, batch confounding, experimental bias or correlated biological effects.
Confirmatory research needs biological replication, independent acquisition checks and
orthogonal assays designed by the scientific team.
