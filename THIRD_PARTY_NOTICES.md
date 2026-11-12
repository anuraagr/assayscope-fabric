# Third-party and data notices

Original AssayScope application and synthetic generator code is MIT. Dependencies
retain their own notices in their distributions; npm's lockfile records their resolved
versions and integrity hashes. React is MIT; OpenSeadragon is BSD-3-Clause; vtk.js is
BSD-3-Clause; NumPy, SciPy, scikit-image, tifffile and the OME ecosystem retain their
respective upstream licenses. IBM Plex and Barlow fonts are SIL Open Font License 1.1.
Redistributors must preserve dependency license files, not substitute AssayScope's MIT
license for them.

## Inspected design reference

[SanjayNarendran/MS101-public-patient-imaging-2D-3D-4D-fabric-rayfin-GHC](https://github.com/SanjayNarendran/MS101-public-patient-imaging-2D-3D-4D-fabric-rayfin-GHC),
commit `49be12f4906ac2dcf5cd28aa3efd31a5ace4d2d4`, inspected 2026-11-12.
Its README, package.json, MIT license, local-data adapter, volume viewer, Fabric
configuration and OneLake approach were inspected, along with the requested
`docs/screenshots/fetal-face-3d.jpg`.

Borrowed **ideas**, not source code or images: generous image canvas, collapsible
navigation, contextual scientific explanation, local-data separation, tenant ownership
and explicit attribution. AssayScope independently implements microscopy arrays,
image-derived QC, plate/replicate analysis and research review. No patient viewer code,
fetal image, DICOM/OHIF dependency, clinical banner or radiology workflow is reused.
The reference's author is Sanjay Narendran, copyright 2026, MIT licensed. No substantial
code adaptation requiring its copyright notice was made.

## Cell Painting Gallery

**CC0 1.0 Universal.** Exact source: cpg0000-jump-pilot / source_4 /
2020_11_04_CPJUMP1 / BR00116991__2020-11-05T19_51_35-Measurement1 /
Images / r01c01f01p01, channels 5, 1 and 2.

Credit Chandrasekaran et al. (2024), [Nature Methods](https://doi.org/10.1038/s41592-024-02241-6),
and Weisbart et al. (2024), [Cell Painting Gallery](https://doi.org/10.1038/s41592-024-02399-z).
We thank the AWS Open Data Sponsorship Program for sponsoring data storage.
[Primary license/citation statement](https://github.com/broadinstitute/cellpainting-gallery).

The 540x540 display derivatives use 2x2 block means and a recorded per-source-channel
1st/99.8th-percentile uint16-to-uint8 conversion. This is disclosed display scaling,
not a normalization used to compare separate studies.

## BioImage Archive S-BIAD610

**CC BY 4.0.** D'Imprima E, Mahamid J, *Light and electron microscopy
continuum-resolution imaging of 3D cell cultures*, [S-BIAD610](https://www.ebi.ac.uk/biostudies/bioimages/studies/S-BIAD610),
2023; [publication/preprint DOI](https://doi.org/10.1101/2021.07.02.450855).
[License](https://creativecommons.org/licenses/by/4.0/).

Selected **BT474.tif**, not the study's patient-derived colorectal material.
This is a human cell-line-derived **spheroid**, not an asserted organoid. It is one
published confocal stack, not a live-cell trajectory. The source record identifies
Zeiss LSM 780 NLO; no Thermo Fisher acquisition claim is made.

Changes: full-field 4x4 XY block means from 1024x1024 to 256x256, all 35 Z sections
retained, original uint8 intensity range preserved, OME-TIFF/OME-NGFF derivatives
and viewer recoloring. Source channel 1 is initially hidden due to high background,
not deleted or inferred to be a particular stain. Attribution also appears beside
the image. Public screenshots are reproductions of these attributed derivatives.

All exact URLs, byte lengths, SHA-256 values, channel names, calibration sources and
transforms are recorded in [config/public-sources.json](config/public-sources.json).
No bulk original data is committed. Never remove these notices when sharing derivatives.
